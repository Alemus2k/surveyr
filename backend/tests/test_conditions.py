"""Site conditions maths on hand-made grids and point sets (numbers you can check by hand)."""
from __future__ import annotations

import numpy as np

from app import conditions as C


def test_flight_offset_finds_a_whole_flight_shift_but_not_real_work():
    rng = np.random.default_rng(1)
    dz = 0.035 + rng.normal(0, 0.01, (50, 50))
    dz[:20] -= 0.8  # 40 % of the site really dug
    assert abs(C.flight_offset(dz) - 0.035) < 0.003

    assert C.flight_offset(np.full((10, 10), 0.3)) == 0.0  # everything rose 30 cm: real fill, not an offset
    assert C.flight_offset(np.full((10, 10), np.nan)) == 0.0


def test_despeckle_drops_single_cells_and_keeps_patches():
    m = np.zeros((10, 10), dtype=bool)
    m[1, 1] = True  # a lone noisy cell
    m[4:8, 4:8] = True  # a 4 x 4 patch
    out = C.despeckle(m)
    assert not out[1, 1]
    assert out[4:8, 4:8].all()  # corners have 4 marked cells in their block, themselves included


def test_vegetation_counts_canopy_peaks_and_brush():
    veg = np.full((20, 20), np.nan)
    yy, xx = np.mgrid[0:20, 0:20]
    for cx, cy in ((5, 5), (14, 5)):  # two trees 9 m apart, 3 m crowns, 8 m tall in the middle
        r = np.hypot(xx - cx, yy - cy)
        veg = np.where(r <= 3, np.fmax(np.nan_to_num(veg), 8 - r), veg)
    veg[15:18, 2:6] = 0.8  # a 3 x 4 m brush patch
    v = C.vegetation(veg, 1.0)
    assert v["trees"] == 2
    assert v["canopy_patches"] == 2
    assert v["brush_m2"] == 12.0
    assert v["brush_patches"] == 1
    # 29 cells per crown (within 3 cells of the centre): 13 inside, 16 on the edge counting 3/4
    assert v["canopy_m2"] == 2 * (13 + 0.75 * 16)


def test_two_trees_with_one_shared_top_count_once():
    yy, xx = np.mgrid[0:7, 0:10]
    dist = np.hypot(np.clip(xx, 4, 5) - xx, yy - 3)  # distance from a two-cell top at (4-5, 3)
    veg = np.where(dist <= 3, 7.0 - dist, np.nan)  # one crown, flat-topped across two cells
    assert C.vegetation(veg, 1.0)["trees"] == 1


def test_machines_are_machine_sized_blobs_and_a_pipe_is_not():
    obj = np.full((40, 40), np.nan)
    obj[5:8, 5:14] = 3.0  # a 9 x 3 m excavator
    obj[5:8, 9] = 1.2  # its lower middle (tracks) still part of it
    obj[20:24, 20:23] = 2.5  # a 3 x 4 m dozer
    obj[30, 2:38] = 1.6  # a 36 m pipe on a bank: long and thin
    obj[12, 30] = 3.0  # a post: too small
    found = C.machines(obj, 1.0)
    assert len(found) == 2
    exc = next(m for m in found if m["length_m"] > 8)
    assert (exc["col"], exc["row"]) == (9.5, 6.5)
    assert exc["height_m"] == 3.0


def test_pieces_of_one_machine_join_but_two_machines_parked_close_stay_two():
    obj = np.full((30, 40), np.nan)
    obj[5:8, 5:9] = 3.0  # house
    obj[5:8, 10:14] = 3.0  # arm, 1 m gap: same 9 m machine
    obj[20:23, 2:11] = 3.0  # a 9 m truck...
    obj[20:23, 12:21] = 3.0  # ...and another 1 m away: 19 m together is no machine
    found = C.machines(obj, 1.0)
    assert sorted(m["length_m"] for m in found) == [9.0, 9.0, 9.0]


def test_thin_ground_is_under_one_ground_point_per_m2():
    gd = np.array([[0, 1, 4], [2, 0, 9]])
    cov = np.array([[1, 1, 1], [1, 0, 1]])
    # 1 m cells: 0 points is thin; the empty cell the flight didn't cover isn't counted
    assert C.thin_ground(gd, cov, 1.0).tolist() == [[True, False, False], [False, False, False]]
    # 2 m cells: 1 or 2 points in 4 m² is thin too
    assert C.thin_ground(gd, cov, 2.0).tolist() == [[True, True, False], [True, False, False]]


def test_no_return_patch_inside_covered_ground_is_possible_water():
    density = np.full((30, 30), 4)
    density[10:14, 10:13] = 0  # 12 m² hole
    density[2, 2] = 0  # a random gap
    density[0:5, 25:30] = 0  # off the edge of the flight
    before = np.full((30, 30), 4)
    mask, found = C.no_return_patches(density, before, 1.0)
    assert len(found) == 1
    assert found[0]["area_m2"] == 12.0  # neighbours fully covered: no partial share
    assert mask.sum() == 12
    _, again = C.no_return_patches(density, density, 1.0)  # the flight before had the same hole
    assert again == []


def test_dark_ground_is_relative_to_the_flight():
    inten = np.array([[400.0, 400, 150], [420, 380, 0]])
    n = np.array([[3, 3, 3], [3, 3, 0]])
    assert C.dark_ground(inten, n).tolist() == [[False, False, True], [False, False, False]]


def _ground(rng, w=40.0, h=30.0, per_m2=4.0):
    n = int(w * h * per_m2)
    return rng.uniform(0, w, n), rng.uniform(0, h, n)


def test_a_rill_on_a_slope_is_found_and_a_step_is_not():
    rng = np.random.default_rng(3)
    x, y = _ground(rng)
    slope = lambda x, y: 100 + 0.1 * y  # noqa: E731  rising north
    before = slope(*np.meshgrid(np.arange(40) + 0.5, np.arange(30) + 0.5))
    # a rill 0.3 m deep, 0.8 m wide, running downslope from y = 8 to 22 at x = 12
    depth = 0.3 * np.clip(1 - np.abs(x - 12) / 0.4, 0, 1) * ((y > 8) & (y < 22))
    # and a 15 cm step: everything east of x = 30 was cut down
    step = np.where(x > 30, -0.15, 0.0)
    z = slope(x, y) - depth + step + rng.normal(0, 0.02, len(x))
    mask, found = C.rills(x, y, z, before, 1.0, 0.05)
    assert len(found) == 1
    r = found[0]
    assert abs(r["x"] - 12) < 0.5 and abs(r["y"] - 15) < 2
    assert 9 <= r["length_m"] <= 15
    assert 0.12 <= r["depth_m"] <= 0.3
    # true volume: 0.3 x 0.8 / 2 x 14 m = 1.68 m³
    assert 0.8 <= r["volume_m3"] <= 2.2
    assert mask[8:22, 11:13].sum() >= 5 and mask.sum() == mask[8:22, 11:13].sum()


def test_a_dug_trench_is_not_a_rill():
    rng = np.random.default_rng(4)
    x, y = _ground(rng)
    before = np.full((30, 40), 100.0)
    z = 100 - 1.8 * ((np.abs(x - 20) < 0.6) & (y > 5) & (y < 25)) + rng.normal(0, 0.02, len(x))
    _, found = C.rills(x, y, z, before, 1.0, 0.05)
    assert found == []


def test_unchanged_ground_has_no_rills():
    rng = np.random.default_rng(5)
    x, y = _ground(rng)
    before = np.full((30, 40), 100.0)
    _, found = C.rills(x, y, 100 + rng.normal(0, 0.02, len(x)), before, 1.0, 0.05)
    assert found == []


def test_polygon_cells_and_site_summary_outside_the_limits():
    inside = C.polygon_cells([[0, 0], [4, 0], [4, 3], [0, 3]], 6, 5, 1.0, 0.0, 0.0)
    assert inside.sum() == 12 and inside[0, 0] and not inside[0, 4] and not inside[3, 0]

    class Site:  # just what site_summary reads
        lod = [[0, 0], [4, 0], [4, 3], [0, 3]]
        zones, ponds = [], []

    marks = np.zeros((5, 6), dtype=np.uint8)
    marks[1:4, 2:6] |= C.MOVED  # 12 cells moved, 4 of them (columns 4-5, rows 1-2) outside... plus row 3
    header = {"nx": 6, "ny": 5, "cell_size": 1.0, "x0": 0.0, "y0": 0.0, "threshold_m": 0.05, "flights": [{}]}
    out = C.site_summary(Site(), header, [("marks0", marks)])
    # outside = columns 4-5 of rows 1-3 (6 cells) + row 3 columns 2-3 (2 cells)
    assert out[0]["outside_lod_m2"] == 8.0
