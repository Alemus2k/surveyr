"""LandXML design surfaces: reading TINs, sampling them, importing and choosing a surface."""
from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import landxml, service
from app.main import app

US_FT = 1200 / 3937


def _square_tin(z0: float, size: float = 20.0, n: int = 5, tilt: float = 0.1):
    """Regular-grid TIN of the plane z = z0 + tilt * easting over a size x size square."""
    xs = np.linspace(0.0, size, n)
    gx, gy = np.meshgrid(xs, xs)
    pts = np.column_stack([gx.ravel() + 1000, gy.ravel() + 5000, z0 + tilt * gx.ravel()])
    tri = []
    for r in range(n - 1):
        for c in range(n - 1):
            a, b, d, e = r * n + c, r * n + c + 1, (r + 1) * n + c, (r + 1) * n + c + 1
            tri += [(a, b, e), (a, e, d)]
    return pts, np.array(tri)


@pytest.fixture
def grading(tmp_path):
    path = tmp_path / "grading.xml"
    landxml.write(str(path), [("EG - Existing ground", *_square_tin(100.0)), ("FG - Finished grade", *_square_tin(101.0))],
                  unit="USSurveyFoot", crs_name="State Plane (ftUS)")
    return path


def test_reads_units_coordinate_system_and_surfaces(grading):
    info = landxml.read_info(str(grading))

    assert info["units"] == "us_ft"
    assert info["crs_name"] == "State Plane (ftUS)"
    assert [s["name"] for s in info["surfaces"]] == ["EG - Existing ground", "FG - Finished grade"]
    assert info["surfaces"][1] == {"name": "FG - Finished grade", "desc": "", "points": 25, "faces": 32}


@pytest.mark.parametrize(
    "names, expected",
    [
        (["EG", "FG"], "FG"),
        (["Existing Ground", "Proposed"], "Proposed"),
        (["Design Surface", "Original Ground"], "Design Surface"),
        (["Topo 2026", "Pad grades"], "Pad grades"),
        (["Only one"], "Only one"),
    ],
)
def test_default_surface_prefers_the_design(names, expected):
    assert landxml.default_surface(names) == expected


def test_lattice_follows_the_tin_exactly_and_stays_inside_it(grading):
    pts, tri, name = landxml.read_tin(str(grading), "FG - Finished grade")
    half = tri[::2]  # one triangle per grid square: a sawtooth with gaps between
    sampled = landxml.sample_tin(pts, half, across=100)

    assert name == "FG - Finished grade"
    assert np.allclose(sampled[:, 2], 101.0 + 0.1 * (sampled[:, 0] - 1000), atol=1e-9)  # linear TIN of a plane
    full = landxml.sample_tin(pts, tri, across=100)
    assert 0.4 * len(full) < len(sampled) < 0.6 * len(full)  # lattice points in the gaps are dropped


def test_hidden_faces_are_holes(tmp_path):
    pts, tri = _square_tin(10.0, n=3)
    path = tmp_path / "holes.xml"
    landxml.write(str(path), [("S", pts, tri)])
    text = path.read_text().replace("<F>1 2 5</F>", '<F i="1">1 2 5</F>')
    path.write_text(text)

    assert landxml.read_info(str(path))["surfaces"][0]["faces"] == len(tri) - 1
    assert len(landxml.read_tin(str(path))[1]) == len(tri) - 1


def test_unnamed_surfaces_are_numbered_consistently(tmp_path):
    pts, tri = _square_tin(10.0)
    path = tmp_path / "unnamed.xml"
    landxml.write(str(path), [("A", pts, tri), ("B", pts + [0, 0, 5], tri)])
    path.write_text(path.read_text().replace(' name="A"', "").replace(' name="B"', ""))

    names = [s["name"] for s in landxml.read_info(str(path))["surfaces"]]
    assert names == ["Surface 1", "Surface 2"]
    assert landxml.read_tin(str(path), "Surface 2")[0][:, 2].min() == pytest.approx(15.0)


# ---------------------------------------------------------------- through the app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path / "projects"))
    (tmp_path / "projects").mkdir()
    return TestClient(app)


def test_import_reads_feet_and_lists_the_surfaces(client, grading):
    res = client.post("/api/scans", files={"file": ("Grading Plan.xml", grading.read_bytes(), "application/xml")})
    assert res.status_code == 201
    pid = res.json()["id"]
    assert res.json()["detected"]["unit"] == "us_ft"

    settings = client.get(f"/api/projects/{pid}/settings").json()
    assert settings["settings"]["unit"] == "us_ft"
    assert settings["surfaces"]["default"] == "FG - Finished grade"
    assert len(settings["surfaces"]["available"]) == 2

    stats = client.get(f"/api/analysis/{pid}").json()["stats"]
    assert stats["mean"] == pytest.approx((101.0 + 0.1 * 10) * US_FT, abs=0.02)  # finished grade, in metres


def test_switching_surface_changes_the_terrain(client, grading):
    pid = client.post("/api/scans", files={"file": ("g.xml", grading.read_bytes(), "application/xml")}).json()["id"]
    settings = client.get(f"/api/projects/{pid}/settings").json()["settings"]

    client.put(f"/api/projects/{pid}/settings", json={**settings, "surface": "EG - Existing ground"})

    stats = client.get(f"/api/analysis/{pid}").json()["stats"]
    assert stats["mean"] == pytest.approx((100.0 + 0.1 * 10) * US_FT, abs=0.02)


def test_xml_without_a_surface_is_rejected(client):
    res = client.post("/api/scans", files={"file": ("notes.xml", b"<root><item/></root>", "application/xml")})
    assert res.status_code == 400
    assert "LandXML" in res.json()["detail"]
    assert client.get("/api/projects").json() == []


def test_sampling_works_without_matplotlib(grading):
    """The bundled desktop engine excludes Matplotlib: LandXML must not need it."""
    import subprocess
    import sys

    code = (
        "import sys; sys.modules['matplotlib'] = None\n"
        "from app import landxml\n"
        f"pts, tri, _ = landxml.read_tin(r'{grading}')\n"
        "print(len(landxml.sample_tin(pts, tri, across=50)))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=str(__import__('pathlib').Path(__file__).resolve().parents[1]))
    assert out.returncode == 0, out.stderr
    assert int(out.stdout) > 2000
