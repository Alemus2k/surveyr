"""Site conditions on the Riverside demo, against the generator's exact answers.

The engine works on the site's 1 m grid and the flights' points; the truth is
the analytic model on a 0.25 m grid with no scan noise. Tolerances are what
the method achieves (and are documented in docs/features/site-conditions.md).
"""
from __future__ import annotations

import json
import math
import os

import numpy as np
import pytest

from app import conditions, service, sites

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
DEMO_SITE = "riverside_commons"
E0, N0 = 612_400.0, 4_270_150.0  # the demo's south-west corner (make_jobsite_demo.py)
POND_SEDIMENT_M = 0.08  # silt depth the generator lays in the pond (make_jobsite_demo.py POND_SEDIMENT)

pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(DATA, f"{DEMO_SITE}.site.json")),
                                reason="demo data not generated")


@pytest.fixture(scope="module")
def demo():
    mp = pytest.MonkeyPatch()
    mp.setattr(service, "DATA_DIR", DATA)
    header, arrays = conditions.analyse(DEMO_SITE)
    site = sites.load(DEMO_SITE)
    g = sites.grids(DEMO_SITE)
    surfaces = [sites._grid_array(s["z"], g["ny"], g["nx"]) for s in g["scans"]]
    summary = conditions.site_summary(site, header, arrays, surfaces)
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    yield header, arrays, summary, truth
    mp.undo()


def test_trees_and_canopy(demo):
    header, _, _, truth = demo
    for k, f in enumerate(header["flights"]):
        v = f["vegetation"]
        # canopy peaks: within 2 trees (two trees whose tops merge count once; a lopsided crown can show two tops)
        assert abs(v["trees"] - truth["vegetation"]["trees"][k]) <= 2, (k, v["trees"])
        # crown area on 1 m cells, edge cells counted 3/4: within 6 %
        assert v["canopy_m2"] == pytest.approx(truth["vegetation"]["canopy_m2"][k], rel=0.06)
        # brush patches that touch merge: never more than there are, at least 3/4 of them
        assert 0.75 * truth["vegetation"]["brush_patches"][k] <= v["brush_patches"] <= truth["vegetation"]["brush_patches"][k]


def test_canopy_cleared_between_flights(demo):
    header, _, _, truth = demo
    canopy = [f["vegetation"]["canopy_m2"] for f in header["flights"]]
    true = truth["vegetation"]["canopy_m2"]
    lost = canopy[0] - canopy[1]
    assert lost == pytest.approx(true[0] - true[1], rel=0.06)  # most clearing happens before the second flight


def test_machines_per_flight(demo):
    header, _, _, truth = demo
    for k, f in enumerate(header["flights"]):
        found = [(m["e"], m["n"]) for m in f["machines"]]
        want = [(m["e"], m["n"]) for m in truth["equipment"][k]]
        assert len(found) == len(want), (k, found, want)
        for e, n in want:  # every machine found within 3 m of where it stood
            assert min(math.hypot(e - fe, n - fn) for fe, fn in found) < 3.0, (k, e, n, found)


def test_disturbed_area_and_outside_the_limits(demo):
    header, _, summary, truth = demo
    t = truth["disturbance"]
    assert t["threshold_m"] == header["threshold_m"]
    for k, f in enumerate(header["flights"]):
        # ground moved since the first flight: within 1.5 % (+ 20 m² of edge cells)
        assert f["disturbed"]["moved_m2"] == pytest.approx(t["disturbed_m2"][k], rel=0.015, abs=20)
        # moved outside the limits: the truth's 55.75 m² within 6 m² (a 1 m cell straddles the edge)
        assert summary[k]["moved_outside_lod_m2"] == pytest.approx(t["outside_lod_m2"][k], abs=6)
        # with clearing counted, never less than the ground moved
        assert f["disturbed"]["total_m2"] >= f["disturbed"]["moved_m2"]
        assert summary[k]["outside_lod_m2"] >= summary[k]["moved_outside_lod_m2"]


def test_the_high_flight_is_compared_without_its_offset(demo):
    header, _, _, _ = demo
    by_date = {f["date"]: f for f in header["flights"]}
    assert by_date["2026-09-21"]["offset_vs_first_m"] == pytest.approx(0.035, abs=0.005)
    assert all(abs(f["offset_vs_first_m"]) < 0.005 for d, f in by_date.items() if d != "2026-09-21")


def test_storm_rills_water_and_sediment(demo):
    header, _, summary, truth = demo
    storm = truth["storm"]
    k = next(i for i, f in enumerate(header["flights"]) if f["date"] == storm["flight"])
    s = header["flights"][k]["storm"]
    xs = [r["e"] - E0 for r in s["rills"]]
    for x in storm["rill_x"]:  # all three rills, within 1 m
        assert min(abs(x - fx) for fx in xs) < 1.0, (x, xs)
    true_rills = [r for r in s["rills"] if min(abs(r["e"] - E0 - x) for x in storm["rill_x"]) < 1.0]
    assert len(true_rills) == storm["rills"]
    # depth "up to": the deepest points of an 0.8 m channel, noise ±2 cm: 60–110 % of 0.28 m
    for r in true_rills:
        assert 0.6 * storm["rill_max_depth_m"] <= r["depth_m"] <= 1.1 * storm["rill_max_depth_m"]
    # eroded volume: the part of each rill outside the fill being placed: 50–120 % of 1.9 m³
    assert 0.5 * storm["eroded_volume_m3"] <= sum(r["volume_m3"] for r in true_rills) <= 1.2 * storm["eroded_volume_m3"]
    # at most one extra (short, shallow) finding on the storm flight
    assert len(s["rills"]) <= storm["rills"] + 1

    # standing water at the pond's low point: 64 m² within 15 %
    assert len(s["water"]) == 1
    assert s["water"][0]["area_m2"] == pytest.approx(storm["standing_water_m2"], rel=0.15)

    # sediment: 14.72 m³ at 8 cm deep = 184 m², of which the water hides 64 m². The pond was
    # being dug in the same fortnight, so the silt shows as fresh dark ground (intensity), not a rise.
    visible = storm["pond_sediment_m3"] / POND_SEDIMENT_M - storm["standing_water_m2"]
    assert 0.6 * visible <= summary[k]["sediment_m2"] <= 1.1 * visible


def test_no_false_alarms_on_dry_flights(demo):
    header, _, summary, truth = demo
    for k, f in enumerate(header["flights"]):
        if f["date"] == truth["storm"]["flight"]:
            continue
        s = f["storm"]
        assert s["water"] == [], (f["date"], s["water"])
        assert summary[k]["sediment_m2"] < 10, (f["date"], summary[k]["sediment_m2"])
        assert len(s["rills"]) <= 1, (f["date"], s["rills"])  # documented: one short find at a pile's toe
    assert sum(len(f["storm"]["rills"]) for f in header["flights"] if f["date"] != truth["storm"]["flight"]) <= 1


def test_thin_coverage_is_small_on_a_good_flight(demo):
    header, _, _, _ = demo
    for f in header["flights"]:
        c = f["coverage"]
        assert c["ground_per_m2"] >= 3
        assert c["thin_m2"] / c["covered_m2"] < 0.05  # under canopy and machines only


def test_endpoint_packs_marks_per_flight(demo, monkeypatch):
    from fastapi.testclient import TestClient

    from app import binary  # noqa: F401  (the endpoint packs with it)
    from app.main import app

    monkeypatch.setattr(service, "DATA_DIR", DATA)
    res = TestClient(app).get(f"/api/sites/{DEMO_SITE}/conditions")
    assert res.status_code == 200
    raw = res.content
    n = int.from_bytes(raw[:4], "little")
    head = json.loads(raw[4:4 + n])
    assert len(head["flights"]) == 8
    assert [a["name"] for a in head["arrays"]] == [f"marks{k}" for k in range(8)]
    assert head["arrays"][0]["shape"] == [head["ny"], head["nx"]]
    assert TestClient(app).get("/api/sites/nope/conditions").status_code == 404
