"""Control / check points: CSV import, accuracy checks and the elevation correction."""
from __future__ import annotations

import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import control, scan_settings, service, sites
from app.main import app

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
US_FT = 1200 / 3937


# ---------------------------------------------------------------- parsing

def test_header_row_sets_columns_and_feet_convert_to_metres():
    text = "Point,Easting,Northing,Elevation,Description\nCP1,1000,2000,100,IRON\nCP2,1010,2000,101,\nCP3,1000,2010,102,NAIL\n"
    pts = control.parse_points(text, unit="us_ft", order="PNEZD")  # header wins over the order
    assert [p.id for p in pts] == ["CP1", "CP2", "CP3"]
    assert pts[0].e == pytest.approx(1000 * US_FT)
    assert pts[0].n == pytest.approx(2000 * US_FT)
    assert pts[2].z == pytest.approx(102 * US_FT)
    assert pts[0].desc == "IRON"


def test_headerless_whitespace_file_uses_the_chosen_order_and_skips_junk():
    text = "# site control\nJob 42 checkpoints\n500.0 900.0 10.0\n510.0 900.0 10.5\n\n500.0 910.0 11.0\n"
    pts = control.parse_points(text, order="ENZ")
    assert [(p.e, p.n, p.z) for p in pts] == [(500.0, 900.0, 10.0), (510.0, 900.0, 10.5), (500.0, 910.0, 11.0)]


def test_too_few_points_is_rejected():
    with pytest.raises(control.ControlInvalid):
        control.parse_points("1,0,0,0\n2,1,1,1\n")


def test_summary_statistics():
    s = control.summarise(np.array([0.01, -0.01, 0.03, 0.01]))
    assert s["n"] == 4
    assert s["mean"] == pytest.approx(0.01)
    assert s["rmse"] == pytest.approx(np.sqrt(np.mean([1e-4, 1e-4, 9e-4, 1e-4])))
    assert s["ci95"] == pytest.approx(1.96 * s["rmse"])
    assert s["max_abs"] == pytest.approx(0.03)


# ---------------------------------------------------------------- checking a scan

@pytest.fixture
def folder(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    trash = tmp_path / "trash"
    trash.mkdir()
    monkeypatch.setattr(service, "TRASH_DIR", str(trash))  # never touch the real recycle bin
    rng = np.random.default_rng(1)
    n = 40_000
    x, y = rng.uniform(0, 40, n), rng.uniform(0, 40, n)
    z = 10.0 + 0.02 * x  # gentle plane
    np.savetxt(tmp_path / "flight.xyz", np.column_stack([x, y, z]))
    return tmp_path


def _control_text(offset: float) -> str:
    rows = ["P,N,E,Z,D"]
    for k, (e, n) in enumerate([(5, 5), (20, 30), (35, 10), (30, 35)], 1):
        rows.append(f"CP{k},{n},{e},{10.0 + 0.02 * e - offset:.4f},CHK")
    rows.append("FAR,500,500,10,OFF-SCAN")
    return "\n".join(rows)


def test_check_measures_scan_minus_control_and_skips_points_off_the_scan(folder):
    cid = control.create("Survey", _control_text(offset=0.05), "m", "PNEZD")["id"]

    res = control.check("flight", cid)

    by_id = {p["id"]: p for p in res["points"]}
    assert by_id["FAR"]["dz"] is None
    assert res["stats"]["n"] == 4
    assert res["stats"]["mean"] == pytest.approx(0.05, abs=1e-6)  # scan is 5 cm above control
    assert res["stats"]["std"] == pytest.approx(0.0, abs=1e-6)


def test_elevation_correction_moves_the_scan_onto_control(folder):
    cid = control.create("Survey", _control_text(offset=0.05), "m", "PNEZD")["id"]
    scan_settings.save("flight", scan_settings.ScanSettings(z_offset_m=-0.05))

    assert control.check("flight", cid)["stats"]["mean"] == pytest.approx(0.0, abs=1e-6)


def test_control_endpoints_import_list_check_and_delete(folder):
    client = TestClient(app)
    res = client.post("/api/control", files={"file": ("job 42 control.csv", _control_text(0.0), "text/csv")},
                      data={"unit": "m", "order": "PNEZD"})
    assert res.status_code == 201
    cid = res.json()["id"]
    assert res.json()["count"] == 5
    assert [c["id"] for c in client.get("/api/control").json()] == [cid]

    check = client.get(f"/api/projects/flight/control-check?control={cid}").json()
    assert check["stats"]["n"] == 4

    assert client.delete(f"/api/control/{cid}").status_code == 200
    assert client.get("/api/control").json() == []
    assert client.post("/api/control", files={"file": ("x.csv", "nothing useful", "text/csv")}).status_code == 400


def test_a_site_grades_every_flight_against_its_control(folder):
    cid = control.create("Survey", _control_text(0.0), "m", "PNEZD")["id"]
    sites.create("Lot", [{"project_id": "flight", "date": "2026-09-07"}], None)
    site = sites.load("lot")
    site.control_id = cid
    sites.save("lot", site)

    qa = sites.qa("lot")

    assert [q["project_id"] for q in qa] == ["flight"]
    assert qa[0]["stats"]["rmse"] == pytest.approx(0.0, abs=1e-6)


@pytest.mark.skipif(not os.path.exists(os.path.join(DATA, "riverside_control.control.json")),
                    reason="run scripts/make_jobsite_demo.py first")
def test_demo_qa_catches_the_high_flight(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    qa = {q["date"]: q["stats"] for q in sites.qa("riverside_commons")}

    assert qa["2026-09-21"]["mean"] == pytest.approx(0.035, abs=0.008)
    assert all(abs(s["mean"]) < 0.01 and s["rmse"] < 0.02 for d, s in qa.items() if d != "2026-09-21")
