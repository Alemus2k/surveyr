"""Comparisons (multi-layer overlays) and the scanned-area mask for surfaces."""
from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import compare, service
from app.main import app


def _write_xyz(path, x0: float = 0.0, n: int = 400) -> None:
    rng = np.random.default_rng(4)
    pts = np.column_stack([x0 + rng.uniform(0, 3, n), rng.uniform(0, 2, n), rng.normal(0, 0.01, n)])
    np.savetxt(path, pts)


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(service, "TRASH_DIR", str(tmp_path / "Trash"))
    (tmp_path / "Trash").mkdir()
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setattr(service, "_points_cache", {})
    _write_xyz(tmp_path / "pass_one.xyz")
    _write_xyz(tmp_path / "pass_two.xyz", x0=0.2)
    return tmp_path


# ---------------------------------------------------------------- service

def test_create_comparison_lists_as_a_project(data):
    ref = compare.create("Garden repeat", ["pass_one", "pass_two"])

    assert ref["id"] == "garden_repeat"
    listed = service.discover_projects()["garden_repeat"]
    assert listed["type"] == "compare"
    assert listed["name"] == "Garden repeat"


def test_new_layers_get_distinct_colours_and_identity_transforms(data):
    compare.create("Repeat", ["pass_one", "pass_two"])

    comp = compare.load("repeat")

    colours = [layer.color for layer in comp.layers]
    assert len(set(colours)) == 2
    assert all(layer.transform.tx == 0 and layer.transform.yaw_deg == 0 for layer in comp.layers)
    assert all(layer.opacity == 1 for layer in comp.layers)


def test_comparison_names_never_collide(data):
    compare.create("Repeat", ["pass_one"])
    second = compare.create("Repeat", ["pass_two"])

    assert second["id"] == "repeat_2"


def test_create_rejects_unknown_or_nested_projects(data):
    with pytest.raises(compare.CompositionInvalid):
        compare.create("Bad", ["nope"])
    compare.create("Inner", ["pass_one"])
    with pytest.raises(compare.CompositionInvalid):
        compare.create("Nested", ["inner"])  # comparisons can't contain comparisons


def test_save_round_trips_layer_settings(data):
    compare.create("Repeat", ["pass_one", "pass_two"])
    comp = compare.load("repeat")
    comp.layers[1].transform.tx = 0.25
    comp.layers[1].transform.yaw_deg = 12.5
    comp.layers[1].opacity = 0.4
    comp.layers[1].render = "surface"

    compare.save("repeat", comp)

    again = compare.load("repeat")
    assert again.layers[1].transform.tx == 0.25
    assert again.layers[1].transform.yaw_deg == 12.5
    assert again.layers[1].opacity == 0.4
    assert again.layers[1].render == "surface"


def test_delete_comparison_trashes_only_its_file(data):
    compare.create("Repeat", ["pass_one", "pass_two"])

    removed = service.delete_project("repeat")

    assert removed == ["repeat.compare.json"]
    assert (data / "pass_one.xyz").exists()


def test_comparison_skips_layers_whose_scan_was_deleted(data):
    compare.create("Repeat", ["pass_one", "pass_two"])
    service.delete_project("pass_two")

    comp = compare.load("repeat")

    assert [layer.project_id for layer in comp.layers] == ["pass_one"]


# ---------------------------------------------------------------- endpoints

def test_comparison_endpoints(data):
    client = TestClient(app)

    created = client.post("/api/compositions", json={"name": "Repeat", "project_ids": ["pass_one", "pass_two"]})
    assert created.status_code == 201
    body = client.get("/api/compositions/repeat").json()
    body["layers"][0]["opacity"] = 0.5
    assert client.put("/api/compositions/repeat", json=body).status_code == 200
    assert client.get("/api/compositions/repeat").json()["layers"][0]["opacity"] == 0.5


def test_put_rejects_invalid_values(data):
    client = TestClient(app)
    client.post("/api/compositions", json={"name": "Repeat", "project_ids": ["pass_one"]})
    body = client.get("/api/compositions/repeat").json()
    body["layers"][0]["opacity"] = 3
    body["layers"][0]["color"] = "red"

    assert client.put("/api/compositions/repeat", json=body).status_code == 422


def test_analysis_of_a_comparison_is_a_clear_400(data):
    client = TestClient(app)
    client.post("/api/compositions", json={"name": "Repeat", "project_ids": ["pass_one"]})

    res = client.get("/api/analysis/repeat")

    assert res.status_code == 400


def test_unknown_comparison_is_404(data):
    assert TestClient(app).get("/api/compositions/nope").status_code == 404


# ---------------------------------------------------------------- surface mask

def test_analysis_includes_scanned_area_mask(data):
    _write_xyz(data / "dense.xyz", n=20000)

    result = service.analyze("dense")

    mask = np.array(result["maps"]["mask"]["data"])
    assert mask.shape == (result["grid"]["ny"], result["grid"]["nx"])
    assert set(np.unique(mask)) <= {0, 1}
    assert mask.mean() > 0.5  # most of a dense rectangular scan is covered


def test_mask_leaves_unscanned_corners_out(data):
    # an L-shaped scan: the missing quadrant must not be treated as scanned
    rng = np.random.default_rng(5)
    a = np.column_stack([rng.uniform(0, 4, 4000), rng.uniform(0, 2, 4000), np.zeros(4000)])
    b = np.column_stack([rng.uniform(0, 2, 4000), rng.uniform(2, 4, 4000), np.zeros(4000)])
    np.savetxt(data / "ell.xyz", np.vstack([a, b]))

    result = service.analyze("ell")

    mask = np.array(result["maps"]["mask"]["data"])
    ny, nx = mask.shape
    assert mask[ny * 3 // 4:, nx * 3 // 4:].mean() < 0.1  # north-east quadrant empty


# ---------------------------------------------------------------- metrics use scanned cells only

def test_site_metrics_ignore_unscanned_corners(data):
    # L-shape: 4x2 m strip + 2x2 m block = 12 m² scanned inside a 4x4 m box
    rng = np.random.default_rng(6)
    a = np.column_stack([rng.uniform(0, 4, 20000), rng.uniform(0, 2, 20000), np.zeros(20000)])
    b = np.column_stack([rng.uniform(0, 2, 10000), rng.uniform(2, 4, 10000), np.zeros(10000)])
    np.savetxt(data / "ell.xyz", np.vstack([a, b]))

    result = service.analyze("ell")

    assert result["area_m2"] == pytest.approx(12.0, rel=0.08)  # not the 16 m² bounding box
    assert sum(result["histograms"]["slope"]["counts"]) == pytest.approx(12.0 / result["grid"]["cell_size"] ** 2, rel=0.08)
