"""Per-scan manual adjustments (units, up axis, ground-only), unit detection,
LAS/LAZ from real scanners, and coordinate precision for survey-grid data."""
from __future__ import annotations

import io as stdio

import laspy
import numpy as np
import pyproj
import pytest
from fastapi.testclient import TestClient

from app import scan_settings, service, storage
from app.main import app

FT = 0.3048
US_FT = 1200 / 3937


def _plane(n: int = 6000, w: float = 10.0, d: float = 6.0, seed: int = 9) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return np.column_stack([rng.uniform(0, w, n), rng.uniform(0, d, n), 0.1 * rng.uniform(0, 1, n)])


def _write_las(path, pts: np.ndarray, classes=None, epsg: int | None = None, offset=(0.0, 0.0, 0.0)) -> None:
    header = laspy.LasHeader(point_format=3, version="1.4")
    header.scales = [0.001, 0.001, 0.001]
    header.offsets = list(offset)
    if epsg:
        header.add_crs(pyproj.CRS.from_epsg(epsg))
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0] + offset[0], pts[:, 1] + offset[1], pts[:, 2] + offset[2]
    if classes is not None:
        las.classification = classes
    las.write(str(path))


@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(service, "TRASH_DIR", str(tmp_path / "Trash"))
    (tmp_path / "Trash").mkdir()
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setattr(service, "_points_cache", {})
    return tmp_path


# ---------------------------------------------------------------- settings + units

def test_defaults_are_metres_z_up_ground_only(data):
    np.savetxt(data / "site.xyz", _plane())

    s = scan_settings.load("site")

    assert (s.unit, s.up_axis, s.ground_only) == ("m", "z", True)


def test_unit_setting_rescales_every_metric(data):
    np.savetxt(data / "site.xyz", _plane())
    area_m = service.analyze("site")["area_m2"]

    scan_settings.save("site", scan_settings.ScanSettings(unit="ft"))

    area_ft = service.analyze("site")["area_m2"]  # cache must be invalidated by save
    assert area_ft == pytest.approx(area_m * FT * FT, rel=0.06)


def test_points_come_back_converted(data):
    np.savetxt(data / "site.xyz", _plane())
    scan_settings.save("site", scan_settings.ScanSettings(unit="mm"))

    origin, pts = service.sample_points_with_origin("site", limit=10_000)

    width = np.ptp(pts[:, 0])
    assert width == pytest.approx(10.0 * 0.001, rel=0.02)


def test_y_up_exports_are_turned_z_up(data):
    p = _plane()
    y_up = np.column_stack([p[:, 0], p[:, 2] * 20, -p[:, 1]])  # vertical spread lives in "y"
    np.savetxt(data / "yup.xyz", y_up)
    scan_settings.save("yup", scan_settings.ScanSettings(up_axis="y"))

    result = service.analyze("yup")

    assert result["dimensions"]["height_m"] == pytest.approx(2.0, rel=0.05)
    assert result["dimensions"]["depth_m"] == pytest.approx(6.0, rel=0.05)


def test_dimensions_reported(data):
    np.savetxt(data / "site.xyz", _plane())

    dims = service.analyze("site")["dimensions"]

    assert dims["width_m"] == pytest.approx(10.0, rel=0.02)
    assert dims["depth_m"] == pytest.approx(6.0, rel=0.02)
    assert dims["height_m"] == pytest.approx(0.1, rel=0.1)


def test_settings_file_goes_to_trash_with_the_project(data):
    np.savetxt(data / "site.xyz", _plane())
    scan_settings.save("site", scan_settings.ScanSettings(unit="ft"))

    removed = service.delete_project("site")

    assert sorted(removed) == ["site.settings.json", "site.xyz"]


# ---------------------------------------------------------------- ground classification

def test_ground_only_ignores_trees_when_classified(data):
    ground = _plane()
    trees = _plane(800, seed=3) + [0, 0, 8.0]  # 8 m up: canopy
    pts = np.vstack([ground, trees])
    classes = np.concatenate([np.full(len(ground), 2), np.full(len(trees), 5)]).astype(np.uint8)
    _write_las(data / "forest.las", pts, classes)

    with_ground_only = service.analyze("forest")
    scan_settings.save("forest", scan_settings.ScanSettings(ground_only=False))
    everything = service.analyze("forest")

    assert with_ground_only["points"]["captured"] == len(ground)
    assert with_ground_only["points"]["ground_only"] is True
    assert with_ground_only["relief_m"] < 0.5
    assert everything["points"]["captured"] == len(ground) + len(trees)
    assert everything["points"]["ground_only"] is False


def test_ground_only_is_a_no_op_without_ground_class(data):
    _write_las(data / "plain.las", _plane())  # classification all 0

    result = service.analyze("plain")

    assert result["points"]["ground_only"] is False
    assert result["points"]["kept"] > 5000


# ---------------------------------------------------------------- detection

def test_detects_feet_from_las_coordinate_system(data):
    _write_las(data / "survey.las", _plane(), epsg=2227)

    det = scan_settings.detect("survey")

    assert det["unit"] == "us_ft"
    assert det["source"] == "crs"
    assert "California" in det["crs_name"]


def test_flags_suspicious_size_for_unitless_files(data):
    np.savetxt(data / "mm_scan.xyz", _plane() * 1000)  # a 10 m room exported in mm

    det = scan_settings.detect("mm_scan")

    assert det["unit"] == "mm"
    assert det["source"] == "size"


def test_metre_scans_raise_no_flag(data):
    np.savetxt(data / "site.xyz", _plane())

    assert scan_settings.detect("site")["unit"] is None


def test_import_applies_units_found_in_the_file_but_not_guesses(data):
    buf = stdio.BytesIO()
    _write_las(data / "tmp_src.las", _plane(), epsg=2227)
    buf.write((data / "tmp_src.las").read_bytes())
    buf.seek(0)
    (data / "tmp_src.las").unlink()

    name = storage.import_scan(data, "survey.las", buf)
    scan_settings.apply_detected_on_import(name)

    assert scan_settings.load("survey").unit == "us_ft"


# ---------------------------------------------------------------- LAZ + precision

def test_laz_files_import_and_analyse(data):
    pts = _plane()
    las_path = data / "src.las"
    _write_las(las_path, pts)
    laspy.read(str(las_path)).write(str(data / "flight.laz"))
    las_path.unlink()

    result = service.analyze("flight")

    assert result["dimensions"]["width_m"] == pytest.approx(10.0, rel=0.02)


def test_points_keep_mm_precision_at_survey_grid_coordinates(data):
    # UTM-like coordinates: ~6,000,000 m north; float32 alone would round to ~0.5 m
    pts = _plane(2000)
    _write_las(data / "utm.las", pts, offset=(500_000.0, 6_000_000.0, 120.0))

    origin, rel = service.sample_points_with_origin("utm", limit=10_000)

    absolute_y = rel[:, 1].astype(np.float64) + origin[1]
    got = np.sort(absolute_y)[:5]
    want = np.sort(pts[:, 1] + 6_000_000.0)[:5]
    assert np.abs(got - want).max() < 0.002


def test_points_endpoint_sends_origin_header_then_float32(data):
    _write_las(data / "utm.las", _plane(2000), offset=(500_000.0, 6_000_000.0, 120.0))

    body = TestClient(app).get("/api/points/utm?limit=1000").content

    origin = np.frombuffer(body[:24], dtype="<f8")
    rel = np.frombuffer(body[24:], dtype="<f4").reshape(-1, 3)
    assert origin[1] == pytest.approx(6_000_003.0, abs=5)  # centre of the footprint
    assert len(rel) == 1000


# ---------------------------------------------------------------- endpoints

def test_settings_endpoints(data):
    np.savetxt(data / "site.xyz", _plane())
    client = TestClient(app)

    got = client.get("/api/projects/site/settings").json()
    assert got["settings"]["unit"] == "m"
    assert got["detected"]["unit"] is None

    put = client.put("/api/projects/site/settings", json={"version": 1, "unit": "ft", "up_axis": "z", "ground_only": True})
    assert put.status_code == 200
    assert client.get("/api/projects/site/settings").json()["settings"]["unit"] == "ft"
    bad = client.put("/api/projects/site/settings", json={"version": 1, "unit": "furlong", "up_axis": "z", "ground_only": True})
    assert bad.status_code == 422
    assert client.get("/api/projects/nope/settings").status_code == 404
