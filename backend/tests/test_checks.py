"""Checks & records: profiles, trench as-built + OSHA prompts, ADA slopes, settlement."""
from __future__ import annotations

import importlib.util
import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import checks, service, sites
from app.main import app

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
DEMO_SITE = "riverside_commons"
HAVE_DEMO = os.path.exists(os.path.join(DATA, f"{DEMO_SITE}.site.json"))
demo_only = pytest.mark.skipif(not HAVE_DEMO, reason="run scripts/make_jobsite_demo.py first")


def _cloud(fn, x0, x1, y0, y1, density, noise=0.0, seed=1):
    rng = np.random.default_rng(seed)
    n = int((x1 - x0) * (y1 - y0) * density)
    x, y = rng.uniform(x0, x1, n), rng.uniform(y0, y1, n)
    return np.column_stack([x, y, fn(x, y) + rng.normal(0, noise, n) if noise else fn(x, y)])


# ---------------------------------------------------------------- geometry + profiles

def test_project_gives_station_and_right_offset():
    p, cum, length = checks.polyline([[0, 0], [10, 0], [10, 10]])
    assert length == 20
    along, off = checks.project(p, cum, np.array([[5.0, -2.0], [12.0, 5.0], [-3.0, 1.0]]))
    assert along == pytest.approx([5, 15, -3])
    assert off == pytest.approx([2, 2, -1])  # south of an eastward line, east of a northward one: right


def test_profile_of_a_plane_is_exact_and_has_gaps_where_nothing_was_scanned():
    pts = _cloud(lambda x, y: 100 + 0.02 * x, 0, 50, -2, 2, 50)
    pts = pts[(pts[:, 0] < 20) | (pts[:, 0] > 25)]  # a 5 m hole
    prof = checks.sample_profile(pts, [[0, 0], [50, 0]], step=0.5, band=0.25)
    s, z = prof["station"], prof["z"]
    ok = np.isfinite(z)
    clear = ok & ((s < 19) | (s > 26))  # beside the hole a window widens to one side only
    assert z[clear] == pytest.approx(100 + 0.02 * s[clear], abs=0.005)
    assert z[ok] == pytest.approx(100 + 0.02 * s[ok], abs=0.02)
    assert not ok[(s > 21.5) & (s < 23.5)].any()


def test_profile_ignores_a_few_wild_points():
    pts = _cloud(lambda x, y: np.full_like(x, 50.0), 0, 20, -1, 1, 100, noise=0.01)
    pts[::40, 2] += 3.0  # a few hits on a passing truck
    prof = checks.sample_profile(pts, [[0, 0], [20, 0]], step=0.25, band=0.25)
    assert np.nanmax(np.abs(prof["z"] - 50)) < 0.03


def test_cross_sections_run_left_to_right_at_the_interval():
    secs = checks.cross_section_lines([[0, 0], [30, 0]], 10, 5)
    assert [s["station"] for s in secs] == [0, 10, 20, 30]
    assert secs[1]["line"] == [[10, 5], [10, -5]]  # left (north) to right (south)


def test_surface_at_interpolates_a_lattice():
    gx, gy = np.meshgrid(np.arange(0, 10.1, 0.5), np.arange(0, 10.1, 0.5))
    lattice = np.column_stack([gx.ravel() + 5e5, gy.ravel() + 4e6, 3 + 0.1 * gx.ravel()])
    z = checks.surface_at(lattice, np.array([[5e5 + 2.25, 4e6 + 3.0], [5e5 + 20, 4e6]]))
    assert z[0] == pytest.approx(3.225)
    assert np.isnan(z[1])


# ---------------------------------------------------------------- trench

def _trench_site(depth=2.0, half_w=0.6, spoil_setback=0.4, slope=0.01, pipe=True, seed=3):
    """A 40 m trench along y = 0 (x 0..40) in flat ground at 100 m, spoil on the north side."""
    rng = np.random.default_rng(seed)

    def ground(x, y):
        z = np.full_like(x, 100.0)
        inside = (np.abs(y) <= half_w) & (x >= 0) & (x <= 40)
        z = np.where(inside, 100 - depth + slope * x, z)
        mid = half_w + spoil_setback + 1.25
        return z + 1.0 * np.clip(1 - np.abs(y - mid) / 1.25, 0, 1) * ((x >= 0) & (x <= 40))

    g = _cloud(ground, -5, 45, -8, 8, 40, noise=0.01, seed=seed)
    objs = np.zeros((0, 3))
    if pipe:
        n = 800
        x = rng.uniform(1, 39, n)
        ang = rng.uniform(-1.2, 1.2, n)
        r = 0.15
        invert = 100 - depth + slope * x + 0.1
        objs = np.column_stack([x, r * np.sin(ang), invert + r + r * np.cos(ang)])
    return checks.FlightPoints(g, objs, True)


def test_trench_measures_size_walls_pipe_and_spoil():
    r = checks.analyse_trench(_trench_site(), [[0, 0], [40, 0]], diameter=0.3)
    assert r["open"]
    assert r["trench_length_m"] == pytest.approx(40, abs=0.5)
    assert r["width_m"] == pytest.approx(1.2, abs=0.08)
    assert r["depth_mean_m"] == pytest.approx(2.0 - 0.01 * 20, abs=0.05)
    assert r["walls"]["left"]["vertical"] and r["walls"]["right"]["vertical"]
    assert r["pipe"]["slope_pct"] == pytest.approx(1.0, abs=0.05)
    assert r["pipe"]["invert_start_m"] == pytest.approx(98.1, abs=0.03)  # floor 98.0 + 0.1 bedding
    assert r["spoil"]["left"]["present"] and not r["spoil"]["right"]["present"]  # north = left going east
    assert r["spoil"]["left"]["setback_m"] == pytest.approx(0.4, abs=0.12)
    codes = {f["code"] for f in r["flags"]}
    assert {"protective_system", "spoil_setback", "ladder"} <= codes
    assert r["table"][0]["station"] == 0 and r["table"][-1]["station"] == 40


def test_shallow_trench_with_spoil_set_back_raises_no_osha_flags():
    r = checks.analyse_trench(_trench_site(depth=1.0, spoil_setback=1.5, slope=0.0), [[0, 0], [40, 0]], 0.3)
    codes = {f["code"] for f in r["flags"]}
    assert not codes & {"protective_system", "spoil_setback", "ladder"}


def test_flat_ground_is_not_an_open_trench():
    flat = checks.FlightPoints(_cloud(lambda x, y: np.full_like(x, 5.0), -5, 45, -8, 8, 20), np.zeros((0, 3)), True)
    assert checks.analyse_trench(flat, [[0, 0], [40, 0]], 0.3)["open"] is False


def test_missing_pipe_is_said_not_guessed():
    r = checks.analyse_trench(_trench_site(pipe=False), [[0, 0], [40, 0]], 0.3)
    assert r["pipe"] == {"seen": False}
    assert r["table"][0]["invert"] is None
    assert "pipe_not_seen" in {f["code"] for f in r["flags"]}


# ---------------------------------------------------------------- ADA

def _walk(bad=(20.0, 30.0, 0.034), good=0.015, density=60, noise=0.005, seed=5):
    def z(x, y):
        s = np.where((x >= bad[0]) & (x < bad[1]), bad[2], good)
        return 50 + 0.01 * x + s * (y - 1)
    pts = _cloud(z, 0, 50, 0, 2, density, noise=noise, seed=seed)
    return pts, [[0, 0], [50, 0], [50, 2], [0, 2]]


def test_ada_finds_a_steep_stretch_where_it_is():
    pts, poly = _walk()
    r = checks.analyse_flatwork(pts, poly, "walk")
    fails = [s for s in r["stretches"] if s["status"] == "fail"]
    assert len(fails) == 1
    f = fails[0]
    assert f["cross_status"] == "fail" and f["running_status"] == "ok"
    assert f["start"][0] == pytest.approx(20, abs=0.6) and f["end"][0] == pytest.approx(30, abs=0.6)
    assert abs(f["cross_pct"]) == pytest.approx(3.4, abs=0.15)
    assert all(abs(s["running_pct"] - 1.0) < 0.2 for s in r["stretches"] if s["length_m"] >= 2)


def test_ada_running_limit_depends_on_the_kind():
    pts = _cloud(lambda x, y: 10 + 0.07 * x, 0, 20, 0, 2, 60, noise=0.003)
    poly = [[0, 0], [20, 0], [20, 2], [0, 2]]
    walk = checks.analyse_flatwork(pts, poly, "walk")
    ramp = checks.analyse_flatwork(pts, poly, "ramp")
    assert walk["stretches"][0]["running_status"] == "fail"  # 7 % > 5 %
    assert all(s["running_status"] == "ok" for s in ramp["stretches"])  # 7 % < 8.33 %


def test_ada_noise_alone_raises_no_failures():
    for seed in range(5):  # sparse, noisy points over a compliant 1.5 % walk
        pts, poly = _walk(bad=(0, 0, 0), density=4, noise=0.02, seed=seed)
        r = checks.analyse_flatwork(pts, poly, "walk")
        assert not [s for s in r["stretches"] if s["status"] == "fail"], seed


def test_ada_needs_points():
    r = checks.analyse_flatwork(np.zeros((0, 3)), [[0, 0], [5, 0], [5, 2], [0, 2]], "walk")
    assert r["enough"] is False


# ---------------------------------------------------------------- settlement

def test_auto_baseline_waits_for_the_fill_and_ignores_grading_trims():
    k = 6
    z = np.zeros((k, 1, 3))
    z[:, 0, 0] = [0, 0, 1.0, 1.0, 0.99, 0.98]  # filled at flight 2, then settles 2 cm
    z[:, 0, 1] = [0, 0, 0, 0, -0.04, -0.04]  # trimmed 4 cm at flight 4: grading, not settlement
    z[:, 0, 2] = [0, 0.6, 0.9, 1.0, 1.0, 0.99]  # filled in lifts until flight 3
    assert checks.auto_baseline(z, 0.05).ravel().tolist() == [2, 4, 3]


def test_monitor_measures_settlement_against_the_baseline():
    K, ny, nx = 4, 12, 12
    rng = np.random.default_rng(0)
    z = 10 + rng.normal(0, 0.002, (K, ny, nx))
    z[1:] += 1.0  # filled before flight 1
    z[2, 3:9, 3:9] -= 0.02
    z[3, 3:9, 3:9] -= 0.04  # the middle settles 4 cm
    z[3] += 0.03  # flight 3 came back 3 cm high …
    offsets = np.array([0, 0, 0, 0.03])  # … and the check points say so
    inside = np.ones((ny, nx), dtype=bool)
    r = checks.analyse_monitor(z, inside, 1.0, 0.05, 0.025, offsets=offsets, offset_se=np.full(K, 0.002), window=3)
    last = r["flights"][3]
    assert last["settled_max_m"] == pytest.approx(0.04, abs=0.005)
    assert last["alert"]
    assert r["flights"][2]["settled_max_m"] == pytest.approx(0.02, abs=0.005) and not r["flights"][2]["alert"]
    assert not r["flights"][0]["measured"]


# ---------------------------------------------------------------- the demo's exact answers

@pytest.fixture
def demo(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    return sites.load(DEMO_SITE), truth, TestClient(app)


def _demo_model():
    spec = importlib.util.spec_from_file_location("demo_model", os.path.join(DATA, "..", "scripts", "make_jobsite_demo.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@demo_only
def test_demo_road_profile_sits_at_subgrade_under_the_design(demo):
    site, _, client = demo
    al = site.alignments[0]
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/sections",
                    json={"scan": "riverside_2026-10-19", "points": al.points, "interval_m": 10, "half_width_m": 10})
    assert r.status_code == 200
    body = r.json()
    long = body["long"]
    st = np.array(long["station"])
    f = np.array([np.nan if v is None else v for v in long["flight"]])
    d = np.array([np.nan if v is None else v for v in long["design"]])
    x = 180 - st  # the centreline runs from the entrance (x 180) west
    away = (x > 106) & (x < 174)  # clear of the batters
    assert np.nanmedian((f - d)[away]) == pytest.approx(-0.20, abs=0.02)  # cut to subgrade: 0.20 m under finished grade
    assert len(body["sections"]) == 9 and body["previous_scan"] == "riverside_2026-10-05"


@demo_only
def test_demo_trench_record_matches_the_truth(demo):
    site, truth, client = demo
    t = truth["trench"]
    ab = site.asbuilts[0]
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/trench",
                    json={"scan": ab.scan, "line": ab.line, "diameter_m": t["pipe_diameter_m"]}).json()
    assert r["date"] == t["flight"]
    assert r["trench_length_m"] == pytest.approx(t["length_m"], abs=1.0)
    assert r["width_m"] == pytest.approx(t["width_m"], abs=0.1)
    assert r["depth_mean_m"] == pytest.approx(t["depth_mean_m"], abs=0.05)
    assert r["depth_max_m"] == pytest.approx(t["depth_max_m"], abs=0.08)
    assert abs(r["pipe"]["slope_pct"]) == pytest.approx(t["pipe_slope_pct"], abs=0.05)
    # the line runs east → west: its start is the east (upper) end
    assert r["pipe"]["invert_start_m"] == pytest.approx(t["invert_east_m"], abs=0.03)
    assert r["pipe"]["invert_end_m"] == pytest.approx(t["invert_west_m"], abs=0.03)
    assert r["walls"]["left"]["vertical"] and r["walls"]["right"]["vertical"]
    spoil = [v for v in r["spoil"].values() if v["present"]]
    assert len(spoil) == 1 and spoil[0]["setback_m"] == pytest.approx(t["spoil_setback_m"], abs=0.1)
    codes = {f["code"] for f in r["flags"]}
    assert {"protective_system", "spoil_setback", "ladder"} <= codes


@demo_only
def test_demo_sidewalk_finds_the_steep_stretch_and_nothing_else(demo):
    site, truth, client = demo
    sw = truth["sidewalk"]
    fw = site.flatwork[0]
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/flatwork",
                    json={"scan": "riverside_2026-11-02", "kind": fw.kind, "polygon": fw.polygon}).json()
    fails = [s for s in r["stretches"] if s["status"] != "ok"]
    assert len(fails) == 1 and fails[0]["status"] == "fail" and fails[0]["cross_status"] == "fail"
    f = fails[0]
    e0, e1 = sorted([f["start"][0], f["end"][0]])
    overlap = min(e1, sw["bad_to_e"]) - max(e0, sw["bad_from_e"])
    # 4 points per m² and ±2 cm noise put the stretch's ends within a few metres
    assert overlap >= 5.0 and 6.0 <= e1 - e0 <= 14.0
    assert abs(f["cross_pct"]) == pytest.approx(sw["bad_cross_slope_pct"], abs=0.8)
    for s in r["stretches"]:
        if s is not f:
            assert abs(s["cross_pct"]) < sw["ada_max_pct"] + 0.3  # the rest passes (1.6 % as built)


@demo_only
def test_demo_parking_fill_settles_about_3_cm(demo):
    site, truth, client = demo
    mo = site.monitors[0]
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/monitor",
                    json={"polygon": mo.polygon, "baseline_scan": None, "alert_m": mo.alert_m}).json()
    assert r["levelled"]  # the 21 Sep flight's 3.5 cm error is taken out by the check points
    last = r["flights"][-1]
    assert last["alert"]
    assert last["settled_max_m"] == pytest.approx(truth["settlement"]["max_m"], abs=0.01)
    assert last["heave_max_m"] < mo.alert_m  # nothing comes up
    model = _demo_model()
    x, y = last["settled_e"] - model.E0, last["settled_n"] - model.N0
    assert float(model.settlement(np.array([x]), np.array([y]), 7)[0]) >= 0.02  # the worst spot really settled
    early = r["flights"][2]
    assert not early.get("alert")  # nothing to see before the fill is in


@demo_only
def test_demo_untouched_ground_does_not_move(demo):
    _, _, client = demo
    e0, n0 = 612400.0, 4270150.0
    poly = [[e0 + 1, n0 + 40], [e0 + 8, n0 + 40], [e0 + 8, n0 + 60], [e0 + 1, n0 + 60]]  # the wetland buffer: never worked
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/monitor",
                    json={"polygon": poly, "baseline_scan": "riverside_2026-07-27", "alert_m": 0.02}).json()
    measured = [f for f in r["flights"] if f["measured"]]
    assert measured and all(abs(f["mean_m"]) < 0.01 for f in measured)


def test_unknown_flight_is_a_404(demo):
    if not HAVE_DEMO:
        pytest.skip("no demo")
    _, _, client = demo
    r = client.post(f"/api/sites/{DEMO_SITE}/checks/trench", json={"scan": "nope", "line": [[0, 0], [1, 1]]})
    assert r.status_code == 404
