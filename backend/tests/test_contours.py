"""Contour lines: marching squares on masked grids, checked against shapes with known answers."""
from __future__ import annotations

import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import contours, service
from app.main import app


def _cone(n: int = 101, slope: float = 0.1, top: float = 100.0):
    """Cone peaking at the grid centre: elevation falls ``slope`` m per m of distance (1 m cells)."""
    xs = np.arange(n, dtype=float)
    gx, gy = np.meshgrid(xs, xs)
    c = (n - 1) / 2
    return top - slope * np.hypot(gx - c, gy - c), c


def test_cone_gives_concentric_closed_rings_at_the_right_radii():
    z, c = _cone()
    res = contours.contours(z, x0=1000.0, y0=5000.0, cell=1.0, interval=1.0, simplify_tolerance=0)
    centre = np.array([1000.0 + c + 0.5, 5000.0 + c + 0.5])  # node (i, j) sits at the cell centre
    rings = [lv for lv in res["levels"] if lv["elevation"] > 100 - 0.1 * c]  # levels fully inside the grid
    assert [lv["elevation"] for lv in rings] == [96.0, 97.0, 98.0, 99.0]
    for lv in rings:
        (line,) = lv["lines"]
        assert contours.is_closed(line)
        r = np.hypot(*(line - centre).T)
        want = (100 - lv["elevation"]) / 0.1
        # vertices lie on grid edges: linear interpolation of a cone is exact to within a few mm here
        assert r.max() == pytest.approx(want, abs=0.01)
        assert r.min() == pytest.approx(want, abs=0.05)


def test_plane_gives_straight_parallel_lines_at_the_right_spacing():
    ny, nx = 40, 60
    z = np.tile(0.1 * (np.arange(nx) + 0.5), (ny, 1))  # rises 0.1 m per m eastward; cell centre x + 0.5
    res = contours.contours(z, x0=0.0, y0=0.0, cell=1.0, interval=1.0)
    xs = []
    for lv in res["levels"]:
        (line,) = lv["lines"]
        assert not contours.is_closed(line)
        assert np.ptp(line[:, 0]) < 1e-9  # straight north–south
        assert line[:, 0][0] == pytest.approx(lv["elevation"] / 0.1)
        assert len(line) == 2  # simplification leaves only the two ends
        assert np.ptp(line[:, 1]) == pytest.approx(ny - 1)  # spans every scanned row centre
        xs.append(line[0, 0])
    assert np.diff(xs) == pytest.approx(np.full(len(xs) - 1, 10.0))


def test_lines_stop_at_unscanned_ground_and_never_cross_it():
    ny, nx = 40, 60
    z = np.tile(0.1 * np.arange(nx, dtype=float), (ny, 1))
    r0, r1, c0, c1 = 15, 24, 20, 39  # a hole nobody scanned
    z[r0:r1 + 1, c0:c1 + 1] = np.nan
    res = contours.contours(z, x0=0.0, y0=0.0, cell=1.0, interval=1.0)
    lo = np.array([c0 - 1 + 0.5, r0 - 1 + 0.5])  # last measured node before the hole
    hi = np.array([c1 + 1 + 0.5, r1 + 1 + 0.5])
    split = 0
    for lv in res["levels"]:
        for line in lv["lines"]:
            strictly_inside = np.all((line > lo + 1e-9) & (line < hi - 1e-9), axis=1)
            assert not strictly_inside.any()
        if c0 <= lv["elevation"] / 0.1 <= c1:
            assert len(lv["lines"]) == 2  # one line south of the hole, one north
            split += 1
    assert split == 2  # x = 20 and 30 m lines are cut by the hole


def test_saddle_is_settled_by_the_centre_value():
    # bottom-left and top-right low (0), the other two corners high (1)
    z = np.array([[0.0, 1.0], [1.0, 0.0]])
    high_centre = contours.trace_level(z, 0.5)  # centre 0.5 >= level: the high corners join
    low_centre = contours.trace_level(z, 0.6)  # centre below the level: the low corners join
    assert len(high_centre) == 2 and len(low_centre) == 2

    def cut_off(lines):
        # which corner each segment isolates: the corner nearest the segment's midpoint
        corners = {(0, 0): "bl", (1, 0): "br", (1, 1): "tr", (0, 1): "tl"}
        out = set()
        for line in lines:
            mid = line.mean(axis=0)
            out.add(corners[min(corners, key=lambda k: np.hypot(mid[0] - k[0], mid[1] - k[1]))])
        return out

    assert cut_off(high_centre) == {"bl", "tr"}  # the low corners are cut off
    assert cut_off(low_centre) == {"br", "tl"}  # the high corners are cut off
    # same rule whichever way round the grid is: the transpose is the same saddle
    assert cut_off(contours.trace_level(z.T.copy(), 0.5)) == {"bl", "tr"}


def test_node_exactly_on_a_level_counts_as_above_and_lines_stay_unique():
    z = np.tile(np.arange(6, dtype=float), (5, 1))  # integer elevations: every level hits nodes
    res = contours.contours(z, 0.0, 0.0, 1.0, interval=1.0, simplify_tolerance=0)
    for lv in res["levels"]:
        for line in lv["lines"]:
            assert np.all(np.any(np.diff(line, axis=0) != 0, axis=1))  # no repeated vertices
    assert [lv["elevation"] for lv in res["levels"]] == [1.0, 2.0, 3.0, 4.0, 5.0]


def test_output_is_deterministic_and_majors_are_every_nth_level():
    rng = np.random.default_rng(3)
    z = rng.normal(0, 1, (60, 80)).cumsum(0).cumsum(1) / 10
    a = contours.contours(z, 0.0, 0.0, 0.5, interval=0.5, major_every=4)
    b = contours.contours(z.copy(), 0.0, 0.0, 0.5, interval=0.5, major_every=4)
    assert contours.to_json(a) == contours.to_json(b)
    for lv in a["levels"]:
        assert lv["major"] == (round(lv["elevation"] / 0.5) % 4 == 0)


def test_simplify_keeps_shape_within_tolerance_and_rings_closed():
    t = np.linspace(0, 2 * np.pi, 400)
    ring = np.column_stack([10 * np.cos(t), 10 * np.sin(t)])
    ring[-1] = ring[0]
    out = contours.simplify(ring, 0.01)
    assert len(out) < len(ring) / 2
    assert np.all(out[0] == out[-1])
    assert np.hypot(*out.T) == pytest.approx(np.full(len(out), 10.0))


def test_smoothing_never_spreads_into_unscanned_cells():
    z = np.full((20, 20), 5.0)
    z[:, :10] = 1.0
    z[8:12, 8:12] = np.nan
    s = contours.smooth_masked(z, 1.0)
    assert np.isnan(s[8:12, 8:12]).all()
    assert np.isfinite(s[~np.isnan(z)]).all()


def test_auto_interval_is_round_in_metres_or_feet():
    assert contours.auto_interval(4.0, "m") == 0.2  # 20 lines
    assert contours.auto_interval(40.0, "m") == 2.0
    assert contours.auto_interval(4.0, "ft") == pytest.approx(0.3048)  # 13.1 ft of relief → 1 ft
    assert contours.auto_interval(40.0, "ft") == pytest.approx(3.048)  # 131 ft → 10 ft (5 ft would be 26 lines)
    assert contours.auto_interval(4.0, "us_ft") == pytest.approx(1200 / 3937)


def test_intervals_round_in_feet_land_on_whole_feet():
    z = np.tile(np.linspace(-0.1, 3.0, 50), (10, 1))  # -0.33 to 9.84 ft
    res = contours.contours(z, 0.0, 0.0, 1.0, interval=0.6096, major_every=5)  # 2 ft
    feet = [lv["elevation"] / 0.3048 for lv in res["levels"]]
    assert feet == pytest.approx([0.0, 2.0, 4.0, 6.0, 8.0])
    assert [lv["major"] for lv in res["levels"]] == [True, False, False, False, False]


def test_too_fine_an_interval_is_refused():
    z = np.tile(np.linspace(0.0, 100.0, 20), (5, 1))
    with pytest.raises(contours.ContourError):
        contours.contours(z, 0.0, 0.0, 1.0, interval=0.01)


def test_a_300_by_300_grid_contours_interactively():
    rng = np.random.default_rng(7)
    z = rng.normal(0, 1, (300, 300)).cumsum(0).cumsum(1) / 30
    z[100:140, 50:200] = np.nan
    best = min(_timed(lambda: contours.contours(z, 612000.0, 4270000.0, 0.5)) for _ in range(2))
    assert best < 0.5


def _timed(fn) -> float:
    t = time.perf_counter()
    fn()
    return time.perf_counter() - t


def test_keeps_full_precision_for_survey_coordinates():
    z, _ = _cone(41)
    res = contours.to_json(contours.contours(z, 612345.678, 4270123.456, 0.25, interval=0.5))
    e, n = res["levels"][-1]["lines"][0][0]
    assert 612345.678 < e < 612345.678 + 41 * 0.25 and 4270123.456 < n < 4270123.456 + 41 * 0.25
    assert res["bounds"] == [612345.678, 4270123.456, 612345.678 + 41 * 0.25, 4270123.456 + 41 * 0.25]


# ------------------------------------------------------------------ endpoints


@pytest.fixture
def folder(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    rng = np.random.default_rng(1)
    x, y = rng.uniform(0, 40, 20000), rng.uniform(0, 40, 20000)
    np.savetxt(tmp_path / "ct_slope.xyz", np.column_stack([x, y, 100 + 0.1 * x]))
    np.savetxt(tmp_path / "ct_later.xyz", np.column_stack([x, y, 101 + 0.1 * x]))
    yield tmp_path
    service.invalidate("ct_slope")
    service.invalidate("ct_later")


def test_project_contours_endpoint(folder):
    client = TestClient(app)
    res = client.get("/api/projects/ct_slope/contours", params={"interval": 1.0, "major_every": 2})
    assert res.status_code == 200
    body = res.json()
    assert body["interval"] == 1.0 and body["major_every"] == 2
    assert [lv["elevation"] for lv in body["levels"]] == [101.0, 102.0, 103.0]
    assert [lv["major"] for lv in body["levels"]] == [False, True, False]
    for lv in body["levels"]:
        (line,) = lv["lines"]
        assert {round(p[0]) for p in line} == {round((lv["elevation"] - 100) / 0.1)}
    assert client.get("/api/projects/nope/contours").status_code == 404
    assert client.get("/api/projects/ct_slope/contours", params={"interval": 0.0001}).status_code == 400


def test_site_contours_endpoint(folder):
    from app import sites

    sites.create("Ct Site", [{"project_id": "ct_slope", "date": "2026-09-01"},
                             {"project_id": "ct_later", "date": "2026-09-08"}], None)
    client = TestClient(app)
    latest = client.get("/api/sites/ct_site/contours", params={"interval": 1.0}).json()
    first = client.get("/api/sites/ct_site/contours", params={"interval": 1.0, "scan": "ct_slope"}).json()
    assert latest["scan"] == "ct_later" and first["scan"] == "ct_slope"
    assert latest["levels"][0]["elevation"] == 102.0 and first["levels"][0]["elevation"] == 101.0
    bad = client.get("/api/sites/ct_site/contours", params={"scan": "design"})
    assert bad.status_code == 400 and "design" in bad.json()["detail"]
    assert client.get("/api/sites/nope/contours").status_code == 404
