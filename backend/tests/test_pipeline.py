"""Phase 0 pipeline tests: validate analytics against the synthetic oracle.

The oracle (scripts/make_synthetic_terrain.py) writes a point cloud plus a JSON
of TRUE analytics computed from the analytic landscape. These tests run the
real pipeline (clean -> rasterize -> terrain -> analytics) and require it to
reproduce the truth within tolerance.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from app import analytics, clean, dem, terrain
from app.pcd import PointCloud

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
XYZ_PATH = os.path.join(DATA, "synthetic_topo.xyz")
TRUTH_PATH = os.path.join(DATA, "synthetic_ground_truth.json")
CELL = 2.0  # metres per raster cell (matches oracle domain / 100)


@pytest.fixture(scope="module")
def truth():
    with open(TRUTH_PATH) as f:
        return json.load(f)


@pytest.fixture(scope="module")
def surface():
    """Run the full pipeline once; expose the DEM + derivative surfaces."""
    pts = np.loadtxt(XYZ_PATH)
    cloud = PointCloud(pts)
    assert cloud.size == pts.shape[0]
    # 1) cleaning removes gross outliers
    cleaned = clean.remove_z_outliers(cloud)
    assert cleaned.size < cloud.size, "expected some outliers to be removed"

    # 2) rasterize -> DEM
    d = dem.rasterize(cleaned, cell_size=CELL)

    # 3) fill holes + smooth
    z = dem.fill_holes(d)
    assert not np.isnan(z).any()
    d["z"] = dem.smooth(z, sigma=0.5)

    # 4) derivative surfaces
    d["slope"] = terrain.slope_degrees(d["z"], CELL)
    d["curv"] = terrain.curvature(d["z"], CELL)
    d["rough"] = terrain.roughness(d["z"], CELL, radius_cells=1)
    d["aspect"] = terrain.aspect_degrees(d["z"], CELL)
    return d


def test_metrics_are_finite_and_nonnegative(surface):
    for key in ("z", "slope", "curv", "rough", "aspect"):
        arr = surface[key]
        assert np.isfinite(arr).all(), f"{key} has non-finite values"
    # elevation may be negative (valleys); the derived surfaces must not be.
    for key in ("slope", "curv", "rough", "aspect"):
        assert (surface[key] >= 0).all(), f"{key} has negative values"


def test_percent_flat_matches_truth(surface, truth):
    pf = analytics.percent_flat(surface["slope"], 3.0)
    assert abs(pf - truth["percent_flat_3deg"]) < 4.0, f"got {pf:.2f}% vs truth {truth['percent_flat_3deg']:.2f}%"


def test_flat_thresholds_monotonic(surface):
    lo = analytics.percent_flat(surface["slope"], 2.0)
    mid = analytics.percent_flat(surface["slope"], 3.0)
    hi = analytics.percent_flat(surface["slope"], 5.0)
    assert lo <= mid <= hi, "%-flat must not shrink when the threshold loosens"


def test_relief_matches_truth(surface, truth):
    r = analytics.relief(surface["z"])
    assert abs(r - truth["relief_m"]) < 2.0, f"relief {r:.2f} vs {truth['relief_m']:.2f}"


def test_elevation_stats_sane(surface, truth):
    st = analytics.stats(surface["z"])
    assert truth["min_elev_m"] - 1.0 <= st["min"] <= truth["max_elev_m"] + 1.0
    assert truth["min_elev_m"] - 1.0 <= st["max"] <= truth["max_elev_m"] + 1.0
    assert abs(st["mean"] - truth["mean_elev_m"]) < 0.5


def test_area_matches_domain(surface, truth):
    a = analytics.area_m2(surface)
    assert abs(a - truth["area_m2"]) / truth["area_m2"] < 0.05


def test_cut_fill_matches_truth(surface, truth):
    target = float(np.mean(surface["z"]))  # level to the pipeline's mean grade
    cf = analytics.cut_fill(surface["z"], CELL, target)
    assert cf["cut"] > 0 and cf["fill"] > 0
    assert abs(cf["cut"] - truth["cut_m3"]) / truth["cut_m3"] < 0.15
    assert abs(cf["fill"] - truth["fill_m3"]) / truth["fill_m3"] < 0.15
    # because target == mean grade, cut and fill must balance
    assert abs(cf["net"]) / max(cf["fill"], 1e-9) < 0.05


def test_cut_fill_net_sign(surface):
    target = float(np.mean(surface["z"]))
    high = analytics.cut_fill(surface["z"], CELL, target + 5.0)
    low = analytics.cut_fill(surface["z"], CELL, target - 5.0)
    assert high["cut"] < low["cut"], "higher target grade should need less cut"
    assert high["fill"] > low["fill"], "higher target grade should need more fill"


def test_buildable_mask_subsets_flat(surface):
    b_lo = analytics.buildable_mask(surface["slope"], surface["curv"], 3.0, 1e9)
    b_hi = analytics.buildable_mask(surface["slope"], surface["curv"], 5.0, 1e9)
    assert np.count_nonzero(b_lo) <= np.count_nonzero(b_hi)


def test_histograms_shape(surface):
    sh = analytics.slope_histogram(surface["slope"])
    assert len(sh["counts"]) == len(sh["edges"]) - 1
    assert abs(sum(sh["counts"]) - surface["slope"].size) < 10
    eh = analytics.elevation_histogram(surface["z"], bins=20)
    assert len(eh["counts"]) == 20


def test_contours_return_polylines(surface):
    levels = [-4.0, 0.0, 4.0, 8.0]
    lines = analytics.contour_lines(surface["z"], surface["x"], surface["y"], levels)
    assert isinstance(lines, list)
    if lines:
        assert {"level", "line"} <= set(lines[0].keys())
