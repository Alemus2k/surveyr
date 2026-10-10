"""Job sites: the site file, its endpoints, and the shared elevation grid."""
from __future__ import annotations

import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import service, sites, storage
from app.main import app

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
DEMO_SITE = "riverside_commons"


def _write_plane(folder, name: str, z: float, n: int = 3000, w: float = 20.0) -> None:
    rng = np.random.default_rng(len(name))
    pts = np.column_stack([rng.uniform(0, w, n), rng.uniform(0, w, n), np.full(n, z)])
    np.savetxt(folder / f"{name}.xyz", pts)


@pytest.fixture
def folder(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    _write_plane(tmp_path, "week1", 10.0)
    _write_plane(tmp_path, "week2", 10.5)
    _write_plane(tmp_path, "design", 11.0)
    return tmp_path


def test_create_lists_the_site_and_sorts_scans_by_date(folder):
    entry = sites.create("North Lot", [{"project_id": "week2", "date": "2026-09-14"},
                                       {"project_id": "week1", "date": "2026-09-07"}], "design")

    assert entry == {"id": "north_lot", "name": "North Lot", "source": "north_lot.site.json", "type": "site"}
    assert [s.project_id for s in sites.load("north_lot").scans] == ["week1", "week2"]


def test_scans_in_a_site_are_marked_with_it(folder):
    sites.create("North Lot", [{"project_id": "week1", "date": "2026-09-07"}], "design")

    registry = service.discover_projects()

    assert registry["week1"]["site"] == "north_lot"
    assert registry["design"]["site"] == "north_lot"
    assert "site" not in registry["week2"]


def test_create_rejects_unknown_scans_and_missing_dates(folder):
    with pytest.raises(sites.SiteInvalid):
        sites.create("X", [{"project_id": "nope", "date": "2026-09-07"}], None)
    with pytest.raises(sites.SiteInvalid):
        sites.create("X", [{"project_id": "week1", "date": "Sept 7"}], None)
    with pytest.raises(sites.SiteInvalid):
        sites.create("X", [], None)


def test_a_site_cannot_contain_another_site(folder):
    sites.create("A", [{"project_id": "week1", "date": "2026-09-07"}], None)
    with pytest.raises(sites.SiteInvalid):
        sites.create("B", [{"project_id": "a", "date": "2026-09-07"}], None)


def test_load_drops_deleted_scans_and_design(folder):
    sites.create("A", [{"project_id": "week1", "date": "2026-09-07"},
                       {"project_id": "week2", "date": "2026-09-14"}], "design")
    os.remove(folder / "week2.xyz")
    os.remove(folder / "design.xyz")

    site = sites.load("a")

    assert [s.project_id for s in site.scans] == ["week1"]
    assert site.design_id is None


def test_grids_share_one_grid_and_measure_the_difference(folder):
    sites.create("A", [{"project_id": "week1", "date": "2026-09-07"},
                       {"project_id": "week2", "date": "2026-09-14"}], "design")

    g = sites.grids("a")

    cells = g["nx"] * g["ny"]
    assert len(g["design"]) == cells and all(len(s["z"]) == cells for s in g["scans"])
    both = [(a, b) for a, b in zip(g["scans"][0]["z"], g["scans"][1]["z"]) if a is not None and b is not None]
    assert len(both) > 1000  # sparse test scans: plenty of cells still overlap
    assert np.allclose([b - a for a, b in both], 0.5, atol=1e-6)


def test_site_endpoints_round_trip_zones_and_pay_apps(folder):
    client = TestClient(app)
    res = client.post("/api/sites", json={"name": "A", "design_id": "design",
                                          "scans": [{"project_id": "week1", "date": "2026-09-07"}]})
    assert res.status_code == 201
    site = client.get("/api/sites/a").json()
    site["zones"] = [{"id": "z1", "name": "Pad", "polygon": [[0, 0], [10, 0], [10, 10]], "finish": "2026-10-01"}]
    site["pay_apps"] = [{"id": "p1", "date": "2026-09-07", "zone_id": "z1", "kind": "cut", "claimed_m3": 120}]

    assert client.put("/api/sites/a", json=site).status_code == 200
    saved = client.get("/api/sites/a").json()

    assert saved["zones"][0]["name"] == "Pad"
    assert saved["pay_apps"][0]["claimed_m3"] == 120
    assert client.get("/api/sites/a/grids").json()["nx"] > 0


def test_sites_have_no_single_terrain_and_delete_only_their_own_file(folder):
    sites.create("A", [{"project_id": "week1", "date": "2026-09-07"}], None)
    client = TestClient(app)

    assert client.get("/api/analysis/a").status_code == 400
    assert client.delete("/api/projects/a").status_code == 200
    assert (folder / "week1.xyz").exists()


def test_seeding_adds_the_site_demo_to_folders_seeded_before_it_existed(tmp_path):
    demo = tmp_path / "demo"
    demo.mkdir()
    for name in storage.SITE_DEMO_FILES:
        (demo / name).write_text("x")
    target = tmp_path / "projects"
    target.mkdir()
    (target / "mine.xyz").write_text("0 0 0")
    (target / storage.SEED_MARKER).touch()  # seeded by an older version

    storage.seed_demo_data(target, demo)
    (target / "riverside_design.laz").unlink()  # the user deletes part of it
    storage.seed_demo_data(target, demo)

    assert (target / "riverside_commons.site.json").exists()
    assert not (target / "riverside_design.laz").exists()  # never comes back


# ---------------------------------------------------------------- demo accuracy

@pytest.mark.skipif(not os.path.exists(os.path.join(DATA, f"{DEMO_SITE}.site.json")),
                    reason="run scripts/make_jobsite_demo.py first")
def test_demo_site_volumes_match_the_analytic_truth(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    g = sites.grids(DEMO_SITE)
    site = sites.load(DEMO_SITE)
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)

    nx, ny, c = g["nx"], g["ny"], g["cell_size"]
    gx, gy = np.meshgrid(g["x0"] + (np.arange(nx) + 0.5) * c, g["y0"] + (np.arange(ny) + 0.5) * c)
    grid = lambda flat: np.array([np.nan if v is None else v for v in flat], dtype=float).reshape(ny, nx)
    design = grid(g["design"])
    first, last = grid(g["scans"][0]["z"]), grid(g["scans"][-1]["z"])

    for zone in site.zones:
        poly = np.array(zone.polygon)
        inside = np.zeros(gx.shape, dtype=bool)
        for (x1, y1), (x2, y2) in zip(poly, np.roll(poly, -1, axis=0)):
            with np.errstate(divide="ignore", invalid="ignore"):
                inside ^= ((y1 > gy) != (y2 > gy)) & (gx < x1 + (gy - y1) * (x2 - x1) / (y2 - y1))
        for k, surface in ((0, first), (-1, last)):
            diff = (surface - design)[inside]
            diff = diff[np.isfinite(diff)]
            diff = np.where(np.abs(diff) <= site.tolerance_m, 0.0, diff)
            want = truth["zones"][zone.id][k]
            assert np.clip(diff, 0, None).sum() * c * c == pytest.approx(want["remaining_cut"], abs=25, rel=0.05)
            assert np.clip(-diff, 0, None).sum() * c * c == pytest.approx(want["remaining_fill"], abs=25, rel=0.05)
