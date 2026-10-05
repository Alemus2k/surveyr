"""Auto cell size: small phone scans get fine rasters, big sites keep 2 m."""
from __future__ import annotations

import numpy as np
import pytest

from app import service
from app.pcd import PointCloud


def _cloud(width: float, depth: float) -> PointCloud:
    pts = np.array([[0.0, 0.0, 0.0], [width, depth, 0.5]])
    return PointCloud(pts)


@pytest.mark.parametrize(
    "width, depth, expected",
    [
        (200.0, 200.0, 2.0),   # survey-scale site keeps the default
        (800.0, 50.0, 2.0),    # up to 400 cells across, sites stay at 2 m
        (1000.0, 50.0, 5.0),   # bigger sites coarsen so the grid stays ≤ 400 across
        (12000.0, 8000.0, 50.0),  # e.g. a mm file read as metres: still a sane grid
        (3.3, 2.5, 0.05),      # phone LiDAR scan of a small patch
        (20.0, 8.0, 0.25),     # larger phone scan
        (0.5, 0.4, 0.01),      # never finer than the minimum
    ],
)
def test_auto_cell_size_fits_scan_footprint(width, depth, expected):
    assert service.auto_cell_size(_cloud(width, depth)) == expected


def test_analysis_without_cell_uses_auto_size(tmp_path, monkeypatch):
    rng = np.random.default_rng(0)
    pts = np.column_stack([rng.uniform(0, 3, 5000), rng.uniform(0, 2, 5000),
                           rng.normal(0, 0.01, 5000)])
    np.savetxt(tmp_path / "phone_scan.xyz", pts)
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(service, "_cache", {})

    result = service.analyze("phone_scan")

    assert result["grid"]["cell_size"] == 0.05
