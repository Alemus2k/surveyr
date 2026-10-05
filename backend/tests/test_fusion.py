"""Phase 2 tests: point-cloud IO, ICP registration, sub-map fusion, coverage.

Uses the generated fixtures (data/scan_a.*, data/scan_b.*) plus synthetic
rigid-transforms to validate:
  - LAS and PLY read/write round-trip correctly (xyz + channels)
  - ICP recovers a known rigid transform
  - a revisited pass FUSES into an existing sub-map (not remapped as new)
  - a genuinely different region starts a new sub-map
  - coverage metrics (covered %, revisited %) behave as expected
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from app import fusion
from app.io import load_point_cloud, write_ply

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
SCAN_A = os.path.join(DATA, "scan_a.las")
SCAN_B = os.path.join(DATA, "scan_b.las")
PLY_A = os.path.join(DATA, "scan_a.ply")


@pytest.fixture(scope="module")
def scan_a():
    return load_point_cloud(SCAN_A)


@pytest.fixture(scope="module")
def scan_b():
    return load_point_cloud(SCAN_B)


# --------------------------------------------------------------------------
# IO
# --------------------------------------------------------------------------
def test_las_loads_points_and_channels(scan_a):
    assert scan_a.size > 100_000
    # channels populated (PF3 has intensity)
    assert scan_a.has("intensity")
    assert scan_a.points.shape[1] == 3


def test_ply_roundtrip_matches_las(scan_a):
    cloud = load_point_cloud(PLY_A)
    assert cloud.size == scan_a.size
    # LAS stores integer-scaled coords (0.001 m); PLY uses float32. Allow that rounding.
    err = np.abs(cloud.points - scan_a.points).max()
    assert err < 0.002, f"PLY vs LAS positions differ by up to {err}"


def test_ply_write_read_roundtrip(tmp_path):
    pts = np.random.default_rng(1).uniform(-5, 5, (500, 3))
    path = str(tmp_path / "rnd.ply")
    write_ply(path, pts)
    back = load_point_cloud(path)
    assert back.size == 500
    assert np.abs(back.points - pts).max() < 1e-6


# --------------------------------------------------------------------------
# ICP
# --------------------------------------------------------------------------
def test_icp_recovers_known_transform():
    rng = np.random.default_rng(3)
    base = rng.uniform(-20, 20, (4000, 3))
    # build a known rigid transform and a "scene B" that is base shifted
    theta = np.deg2rad(6)
    R = np.array([[np.cos(theta), -np.sin(theta), 0],
                  [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
    t = np.array([2.0, -1.5, 0.3])
    scene_b = base @ R.T + t
    res = fusion.icp_point_to_point(scene_b, base, max_match_dist=1.5, max_corr_dist=12.0)
    aligned = fusion._apply(res["transform"], scene_b)
    assert np.abs(aligned - base).mean() < 1e-3
    assert res["overlap"] > 0.99


# --------------------------------------------------------------------------
# Fusion decision
# --------------------------------------------------------------------------
def test_revisited_scan_fuses_into_existing_submap(scan_a, scan_b):
    project = fusion.FusedProject(scan_a.points[:, :3], first_epoch=0)
    outcome = project.add_scan(scan_b.points[:, :3], max_match_dist=1.5)
    assert outcome["action"] == "fused", f"expected fusion, got {outcome['action']}"
    assert outcome["into"] == 0
    assert outcome["overlap"] > 0.5
    # stored as its own epoch sub-map (coverage needs per-pass counts)
    assert len(project.sub_maps) == 2


def test_distinct_region_starts_new_submap(tmp_path):
    rng = np.random.default_rng(5)
    region_a = rng.uniform(0, 10, (3000, 3))
    region_b = rng.uniform(100, 110, (3000, 3))  # clearly disjoint
    project = fusion.FusedProject(region_a)
    outcome = project.add_scan(region_b, max_match_dist=1.5)
    assert outcome["action"] == "new_submap"
    assert outcome["overlap"] < 0.05, "disjoint clouds must show negligible overlap"
    assert len(project.sub_maps) == 2


def test_coverage_revisited_fraction(scan_a, scan_b):
    project = fusion.register_multi_scan([scan_a.points[:, :3], scan_b.points[:, :3]])
    cov = project.coverage(cell_size=2.0)
    assert cov["n_submaps"] == 2  # pass A + pass B, each its own epoch sub-map
    assert cov["covered_pct"] > 95.0
    assert cov["revisited_pct"] > 0.0, "the overlap region should count as revisited"
    assert len(cov["counts"]) > 0
    # counts grid should show some cells with >1 pass
    counts = np.asarray(cov["counts"])
    assert (counts >= 2).sum() > 0


def test_full_back_to_back_fusion(scan_a):
    # Adding a transformed copy of the SAME scan must fuse (overlap ~100%).
    rng = np.random.default_rng(2)
    sub = scan_a.points[np.random.default_rng(2).choice(scan_a.size, 40000), :3]
    theta = np.deg2rad(2)
    R = np.array([[np.cos(theta), -np.sin(theta), 0],
                  [np.sin(theta), np.cos(theta), 0], [0, 0, 1]])
    copy_b = sub @ R.T + np.array([1.0, 1.0, 0.1])
    project = fusion.FusedProject(scan_a.points[:40000, :3])
    outcome = project.add_scan(copy_b, max_match_dist=1.5)
    assert outcome["action"] == "fused"