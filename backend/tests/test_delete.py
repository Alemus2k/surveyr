"""Deleting projects: files go to the Trash, caches are cleared, demos don't reappear."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import service, storage
from app.main import app


def _write_xyz(path, n: int = 300) -> None:
    rng = np.random.default_rng(3)
    pts = np.column_stack([rng.uniform(0, 3, n), rng.uniform(0, 2, n), rng.normal(0, 0.01, n)])
    np.savetxt(path, pts)


@pytest.fixture
def projects_dir(tmp_path, monkeypatch):
    data = tmp_path / "projects"
    data.mkdir()
    trash = tmp_path / "Trash"
    trash.mkdir()
    monkeypatch.setattr(service, "DATA_DIR", str(data))
    monkeypatch.setattr(service, "TRASH_DIR", str(trash))
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setattr(service, "_points_cache", {})
    return data, trash


# ---------------------------------------------------------------- discovery

def test_demo_projects_are_not_listed_when_their_files_are_gone(projects_dir):
    data, _ = projects_dir
    _write_xyz(data / "garden.xyz")

    ids = set(service.discover_projects())

    assert ids == {"garden"}


# ---------------------------------------------------------------- service

def test_delete_moves_scan_to_trash(projects_dir):
    data, trash = projects_dir
    _write_xyz(data / "garden.xyz")

    removed = service.delete_project("garden")

    assert removed == ["garden.xyz"]
    assert not (data / "garden.xyz").exists()
    assert (trash / "garden.xyz").exists()
    assert "garden" not in service.discover_projects()


def test_delete_fused_project_removes_both_passes(projects_dir):
    data, trash = projects_dir
    (data / "scan_a.las").write_bytes(b"a")
    (data / "scan_b.las").write_bytes(b"b")

    removed = service.delete_project("multiscan")

    assert sorted(removed) == ["scan_a.las", "scan_b.las"]
    assert sorted(p.name for p in trash.iterdir()) == ["scan_a.las", "scan_b.las"]


def test_delete_clears_cached_results(projects_dir):
    data, _ = projects_dir
    _write_xyz(data / "garden.xyz")
    service.analyze("garden")
    service.sample_points_with_origin("garden", limit=100)

    service.delete_project("garden")

    assert not any(k.startswith("garden@") for k in service._cache)
    assert not any(k.startswith("garden@") for k in service._points_cache)


def test_delete_unknown_project_raises(projects_dir):
    with pytest.raises(service.ProjectNotFound):
        service.delete_project("nope")


# ---------------------------------------------------------------- trash

def test_move_to_trash_never_overwrites(tmp_path):
    trash = tmp_path / "Trash"
    trash.mkdir()
    (trash / "garden.xyz").write_text("older")
    src = tmp_path / "garden.xyz"
    src.write_text("newer")

    storage.move_to_trash(src, trash)

    assert (trash / "garden.xyz").read_text() == "older"
    assert (trash / "garden 2.xyz").read_text() == "newer"


# ---------------------------------------------------------------- endpoint

def test_delete_endpoint(projects_dir):
    data, _ = projects_dir
    _write_xyz(data / "garden.xyz")
    client = TestClient(app)

    res = client.delete("/api/projects/garden")

    assert res.status_code == 200
    assert res.json() == {"id": "garden", "removed": ["garden.xyz"]}
    assert client.delete("/api/projects/garden").status_code == 404
