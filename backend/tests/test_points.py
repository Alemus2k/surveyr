"""Point sampling for the 3D particle view."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import service
from app.main import app


@pytest.fixture
def phone_scan(tmp_path, monkeypatch):
    rng = np.random.default_rng(1)
    pts = np.column_stack([rng.uniform(0, 3, 5000), rng.uniform(0, 2, 5000),
                           rng.normal(0, 0.01, 5000)])
    np.savetxt(tmp_path / "phone_scan.xyz", pts)
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setattr(service, "_points_cache", {})
    return pts


def test_sample_points_caps_count_and_keeps_coordinates(phone_scan):
    origin, sampled = service.sample_points_with_origin("phone_scan", limit=1000)

    assert sampled.shape == (1000, 3)
    assert sampled.dtype == np.float32
    x = sampled[:, 0] + origin[0]
    assert x.min() >= 0 and x.max() <= 3


def test_sample_points_returns_all_when_under_limit(phone_scan):
    _, sampled = service.sample_points_with_origin("phone_scan", limit=100_000)

    # outlier cleaning may drop a handful, never add
    assert 4900 <= len(sampled) <= 5000


def test_points_endpoint_returns_float32_xyz(phone_scan):
    res = TestClient(app).get("/api/points/phone_scan?limit=500")

    assert res.status_code == 200
    assert res.headers["content-type"] == "application/octet-stream"
    assert len(res.content) == 3 * 8 + 500 * 3 * 4  # float64 origin + float32 points


def test_points_endpoint_unknown_project_is_404(phone_scan):
    assert TestClient(app).get("/api/points/nope").status_code == 404
