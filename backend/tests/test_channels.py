"""Using the whole flight: colour, intensity, classes and returns from file to API."""
from __future__ import annotations

import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import binary, io, service, sites
from app.main import app

DATA = os.path.join(os.path.dirname(__file__), "..", "data")


def unpack(blob: bytes) -> tuple:
    """Reverse of binary.pack: (header, {name: array})."""
    n = int.from_bytes(blob[:4], "little")
    header = json.loads(blob[4:4 + n])
    data = blob[4 + n:]
    arrays = {a["name"]: np.frombuffer(data, dtype="<" + a["dtype"], count=int(np.prod(a["shape"])), offset=a["offset"])
              .reshape(a["shape"]) for a in header["arrays"]}
    return header, arrays


def write_las(path, pts, cls, rgb=None, intensity=None) -> None:
    import laspy

    header = laspy.LasHeader(point_format=7 if rgb is not None else 6, version="1.4")
    header.scales, header.offsets = np.array([0.001] * 3), pts.min(axis=0)
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    las.classification = cls.astype(np.uint8)
    if rgb is not None:
        las.red, las.green, las.blue = (rgb[:, i].astype(np.uint16) * 257 for i in range(3))
    if intensity is not None:
        las.intensity = intensity.astype(np.uint16)
    las.write(str(path))


def test_pack_round_trips_and_aligns_arrays():
    blob = binary.pack({"note": "x"}, [("a", np.arange(5, dtype=np.uint8)), ("b", np.arange(6, dtype=np.float32).reshape(2, 3))])
    header, arrays = unpack(blob)
    assert header["note"] == "x"
    assert arrays["a"].tolist() == [0, 1, 2, 3, 4]
    assert arrays["b"].tolist() == [[0, 1, 2], [3, 4, 5]]
    data_start = 4 + int.from_bytes(blob[:4], "little")
    assert data_start % 8 == 0 and all(a["offset"] % 8 == 0 for a in header["arrays"])  # typed-array friendly


@pytest.mark.parametrize("values, scale", [((255, 0, 128), 255), ((65535, 0, 32896), 65535), ((1.0, 0.0, 0.5), 1)])
def test_colour_is_normalised_whatever_the_bit_depth(tmp_path, values, scale):
    rows = "\n".join(f"{i} 0 0 {values[0]} {values[1]} {values[2]}" for i in range(4))
    (tmp_path / "c.xyz").write_text(rows)
    cloud = io.load_point_cloud(str(tmp_path / "c.xyz"))
    assert cloud.channels["red"][0] == pytest.approx(1.0)
    assert cloud.channels["green"][0] == 0.0
    assert cloud.channels["blue"][0] == pytest.approx(values[2] / scale, abs=0.01)


def test_ply_keeps_its_colour(tmp_path):
    header = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n" \
             "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
    (tmp_path / "phone.ply").write_text(header + "0 0 0 255 0 0\n1 0 0 0 255 0\n0 1 0 0 0 255\n")
    cloud = io.load_point_cloud(str(tmp_path / "phone.ply"))
    assert cloud.channels["red"].tolist() == [1.0, 0.0, 0.0]
    assert cloud.channels["blue"].tolist() == [0.0, 0.0, 1.0]


@pytest.fixture
def scan(tmp_path, monkeypatch):
    """A flat field (ground, green) with a 6 m tree (high vegetation) and a 3 m machine (unclassified)."""
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    rng = np.random.default_rng(3)
    n = 20_000
    ground = np.column_stack([rng.uniform(0, 40, n), rng.uniform(0, 40, n), np.full(n, 100.0)])
    tree = np.column_stack([rng.uniform(10, 14, 400), rng.uniform(10, 14, 400), rng.uniform(103, 106, 400)])
    machine = np.column_stack([rng.uniform(30, 34, 300), rng.uniform(20, 23, 300), rng.uniform(102, 103, 300)])
    pts = np.vstack([ground, tree, machine])
    cls = np.concatenate([np.full(n, 2), np.full(400, 5), np.full(300, 1)])
    rgb = np.vstack([np.tile([90, 120, 60], (n, 1)), np.tile([40, 90, 40], (400, 1)), np.tile([230, 180, 30], (300, 1))])
    intensity = np.concatenate([np.full(n, 20000), np.full(400, 8000), np.full(300, 50000)])
    write_las(tmp_path / "flight.las", pts, cls, rgb, intensity)
    return tmp_path


def test_analysis_reports_channels_and_classes(scan):
    points = service.analyze("flight")["points"]
    assert points["channels"][0] == "rgb" and "intensity" in points["channels"] and "classification" in points["channels"]
    assert points["classes"] == {"1": 300, "2": 20000, "5": 400}
    assert points["total"] == 20700 and points["ground_only"] is True


def test_attributes_match_the_points_in_order(scan):
    client = TestClient(app)
    for everything, expect_classes in ((False, {2}), (True, {1, 2, 5})):
        q = f"?limit=5000&everything={str(everything).lower()}"
        pts = client.get(f"/api/points/flight{q}").content
        header, a = unpack(client.get(f"/api/points/flight/attributes{q}").content)
        xyz = np.frombuffer(pts, dtype="<f4", offset=24).reshape(-1, 3)
        z = xyz[:, 2] + np.frombuffer(pts, dtype="<f8", count=3)[2]

        assert header["count"] == len(xyz) == len(a["classification"]) == len(a["rgb"])
        assert set(a["classification"].tolist()) == expect_classes
        if everything:  # each point's class and colour belong to that point
            assert set(a["classification"][z > 102.5].tolist()) <= {1, 5}
            assert a["rgb"][a["classification"] == 1].mean(axis=0).tolist() == pytest.approx([230, 180, 30], abs=1)
            assert a["intensity"][a["classification"] == 1].min() > a["intensity"][a["classification"] == 5].max()


def test_site_rasters_show_what_stands_on_the_ground(scan):
    sites.create("Field", [{"project_id": "flight", "date": "2026-09-07"}], None)
    header, a = unpack(TestClient(app).get("/api/sites/field/rasters/flight").content)
    nx, cell = header["nx"], header["cell_size"]
    at = lambda e, n: (int((n - header["y0"]) / cell), int((e - header["x0"]) / cell))  # noqa: E731
    block = lambda arr, e0, e1, n0, n1: arr[at(e0, n0)[0]:at(e1, n1)[0], at(e0, n0)[1]:at(e1, n1)[1]]  # noqa: E731

    assert header["classified"] is True
    assert np.nanmax(block(a["veg_height"], 10, 14, 10, 14)) == pytest.approx(6.0, abs=0.2)  # the tree's top above the ground
    assert np.isnan(block(a["veg_height"], 30, 34, 20, 23)).all()
    assert np.nanmax(block(a["object_height"], 30, 34, 20, 23)) == pytest.approx(3.0, abs=0.2)  # the machine
    assert np.isnan(block(a["object_height"], 2, 8, 28, 34)).all()
    seen = lambda e0, e1, n0, n1: block(a["photo"], e0, e1, n0, n1)[block(a["coverage"], e0, e1, n0, n1) == 1]  # noqa: E731
    assert seen(2, 8, 28, 34).mean(axis=0).tolist() == pytest.approx([90, 120, 60], abs=1)  # open ground
    over_machine = block(a["photo"], 30, 34, 20, 23)[np.isfinite(block(a["object_height"], 30, 34, 20, 23))]
    assert over_machine.mean(axis=0).tolist() == pytest.approx([230, 180, 30], abs=1)  # the machine, seen from above
    assert a["coverage"].shape == (header["ny"], nx) and set(np.unique(a["coverage"]).tolist()) <= {0, 1}
    assert block(a["density"], 10, 14, 10, 14).sum() > block(a["ground_density"], 10, 14, 10, 14).sum()


def test_unknown_scan_is_a_404(scan):
    sites.create("Field", [{"project_id": "flight", "date": "2026-09-07"}], None)
    assert TestClient(app).get("/api/sites/field/rasters/nope").status_code == 404


@pytest.mark.skipif(not os.path.exists(os.path.join(DATA, "riverside_commons.site.json")),
                    reason="run scripts/make_jobsite_demo.py first")
def test_demo_flights_carry_colour_trees_and_machines(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    first = sites.rasters("riverside_commons", "riverside_2026-07-27")
    last = sites.rasters("riverside_commons", "riverside_2026-11-02")
    names = lambda r: {n: arr for n, arr in r[1]}  # noqa: E731
    cell2 = first[0]["cell_size"] ** 2

    trees = lambda r: (np.nan_to_num(names(r)["veg_height"]) > 1.5).sum() * cell2  # taller than brush  # noqa: E731
    assert trees(first) == pytest.approx(truth["vegetation"]["canopy_m2"][0], rel=0.25)
    assert trees(last) == pytest.approx(truth["vegetation"]["canopy_m2"][-1], rel=0.25)
    assert trees(first) > 1.5 * trees(last)  # clearing happened
    assert not np.isfinite(names(first)["object_height"]).any()  # no machines before work starts
    machines = np.isfinite(names(last)["object_height"]).sum() * cell2
    assert 40 < machines < 400  # four machines' footprints
    assert "photo" in names(last) and "intensity" in names(last)
