"""Scan import + first-run demo seeding for the desktop app."""
from __future__ import annotations

import io as stdio

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import service, storage
from app.main import app


def _xyz_bytes(n: int = 200) -> bytes:
    rng = np.random.default_rng(2)
    pts = np.column_stack([rng.uniform(0, 3, n), rng.uniform(0, 2, n), rng.normal(0, 0.01, n)])
    buf = stdio.StringIO()
    np.savetxt(buf, pts)
    return buf.getvalue().encode()


# ---------------------------------------------------------------- filenames

@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Scaniverse 2026-10-04 003046.ply", "scaniverse_2026-10-04_003046.ply"),
        ("../../etc/passwd.las", "passwd.las"),
        ("Back Garden!!.LAZ", "back_garden.laz"),
        ("....ply", "scan.ply"),
    ],
)
def test_safe_filename_strips_paths_and_odd_characters(raw, expected):
    assert storage.safe_filename(raw) == expected


def test_safe_filename_rejects_unsupported_extension():
    with pytest.raises(storage.ImportRejected):
        storage.safe_filename("notes.txt")


# ---------------------------------------------------------------- import

def test_import_scan_saves_valid_cloud(tmp_path):
    name = storage.import_scan(tmp_path, "garden.xyz", stdio.BytesIO(_xyz_bytes()))

    assert name == "garden.xyz"
    assert (tmp_path / "garden.xyz").exists()


def test_import_scan_never_overwrites_existing_project(tmp_path):
    storage.import_scan(tmp_path, "garden.xyz", stdio.BytesIO(_xyz_bytes()))

    second = storage.import_scan(tmp_path, "garden.xyz", stdio.BytesIO(_xyz_bytes()))

    assert second == "garden_2.xyz"


def test_import_scan_rejects_and_removes_unreadable_file(tmp_path):
    with pytest.raises(storage.ImportRejected):
        storage.import_scan(tmp_path, "junk.ply", stdio.BytesIO(b"not a point cloud"))

    assert list(tmp_path.iterdir()) == []


def test_import_scan_rejects_oversized_upload(tmp_path):
    with pytest.raises(storage.ImportRejected):
        storage.import_scan(tmp_path, "big.xyz", stdio.BytesIO(_xyz_bytes()), max_bytes=100)

    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------- seeding

def test_seed_demo_data_fills_an_empty_folder(tmp_path):
    demo = tmp_path / "demo"
    demo.mkdir()
    (demo / "synthetic_topo.xyz").write_bytes(_xyz_bytes())
    target = tmp_path / "projects"

    storage.seed_demo_data(target, demo)

    assert (target / "synthetic_topo.xyz").exists()


def test_seed_demo_data_leaves_existing_projects_alone(tmp_path):
    demo = tmp_path / "demo"
    demo.mkdir()
    (demo / "synthetic_topo.xyz").write_bytes(_xyz_bytes())
    target = tmp_path / "projects"
    target.mkdir()
    (target / "mine.xyz").write_bytes(_xyz_bytes())

    storage.seed_demo_data(target, demo)

    assert sorted(p.name for p in target.iterdir() if not p.name.startswith(".")) == ["mine.xyz"]


# ---------------------------------------------------------------- endpoint

def test_upload_endpoint_creates_a_project(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    client = TestClient(app)

    res = client.post("/api/scans", files={"file": ("Back Garden.xyz", _xyz_bytes(), "text/plain")})

    assert res.status_code == 201
    assert res.json()["id"] == "back_garden"
    assert any(p["id"] == "back_garden" for p in client.get("/api/projects").json())


def test_upload_endpoint_rejects_bad_file_with_400(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))

    res = TestClient(app).post("/api/scans", files={"file": ("x.ply", b"nope", "application/octet-stream")})

    assert res.status_code == 400
    assert "point cloud" in res.json()["detail"]


def test_seed_demo_data_only_ever_runs_once(tmp_path):
    demo = tmp_path / "demo"
    demo.mkdir()
    (demo / "synthetic_topo.xyz").write_bytes(_xyz_bytes())
    target = tmp_path / "projects"
    storage.seed_demo_data(target, demo)
    (target / "synthetic_topo.xyz").unlink()  # user deleted every project

    storage.seed_demo_data(target, demo)

    assert not (target / "synthetic_topo.xyz").exists()
