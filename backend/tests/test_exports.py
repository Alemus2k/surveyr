"""Exports: every file format re-read and checked, naming, the reveal guard, and
the progress snapshot against hand-checkable numbers and the demo's truth."""
from __future__ import annotations

import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import export_formats as fmt
from app import exports, landxml, service, sites
from app.main import app

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
US_FT = 1200 / 3937
E0, N0 = 612400.0, 4270150.0  # UTM-sized coordinates: precision must survive them


# ------------------------------------------------------------------ helpers


def parse_dxf(text: str) -> list:
    """(code, value) pairs of an ASCII DXF."""
    lines = text.split("\n")
    assert lines[-1] == ""
    return [(int(lines[i]), lines[i + 1]) for i in range(0, len(lines) - 1, 2)]


def dxf_entities(pairs: list) -> list:
    """Entities of the ENTITIES section as dicts: {"type", "layer", "groups": [(code, value)], "vertices": [...]}."""
    start = next(i for i, p in enumerate(pairs) if p == (2, "ENTITIES"))
    out, cur = [], None
    for code, value in pairs[start + 1:]:
        if code == 0:
            if value in ("ENDSEC",):
                break
            if value == "VERTEX":
                cur = {"type": "VERTEX", "groups": []}
                out[-1]["vertices"].append(cur)
                continue
            if value == "SEQEND":
                cur = {"type": "SEQEND", "groups": []}
                continue
            cur = {"type": value, "groups": [], "vertices": []}
            out.append(cur)
        else:
            cur["groups"].append((code, value))
    for e in out:
        e["layer"] = dict(e["groups"]).get(8)
    return out


def write_las(path, pts, cls, rgb=None, intensity=None, epsg=None) -> None:
    import laspy

    header = laspy.LasHeader(point_format=7 if rgb is not None else 6, version="1.4")
    header.scales, header.offsets = np.array([0.001] * 3), np.floor(pts.min(axis=0))
    if epsg:
        from pyproj import CRS

        header.add_crs(CRS.from_epsg(epsg))
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    las.classification = cls.astype(np.uint8)
    las.gps_time = np.arange(len(pts), dtype=float)
    if rgb is not None:
        las.red, las.green, las.blue = (rgb[:, i].astype(np.uint16) * 257 for i in range(3))
    if intensity is not None:
        las.intensity = intensity.astype(np.uint16)
    las.write(str(path))


@pytest.fixture
def out(tmp_path):
    d = tmp_path / "out"
    d.mkdir()
    return str(d)


def _surface():
    """A tilted 6 x 4 grid (1 m cells) at UTM coordinates with one unscanned cell."""
    z = 200.0 + 0.5 * np.arange(6)[None, :] + 0.25 * np.arange(4)[:, None]
    z[2, 3] = np.nan
    return exports.Surface(z, E0, N0, 1.0, "test", "test")


# ------------------------------------------------------------------ naming and reveal


def test_never_overwrites_and_companion_files_share_a_number(out):
    a = exports.reserve(out, "Grid", [".asc", ".prj"])
    assert [os.path.basename(p) for p in a] == ["Grid.asc", "Grid.prj"]
    open(a[1], "w").close()  # only the .prj exists: the pair still moves on together
    b = exports.reserve(out, "Grid", [".asc", ".prj"])
    assert [os.path.basename(p) for p in b] == ["Grid (2).asc", "Grid (2).prj"]
    o = exports.ExportOptions()
    first = exports.write_csv(out, "Pts", _surface(), o)
    second = exports.write_csv(out, "Pts", _surface(), o)
    assert first["filename"] == "Pts.csv" and second["filename"] == "Pts (2).csv"
    assert exports.safe_stem('a/b:c*?"<>|. ') == "a b c"


def test_reveal_only_opens_files_in_the_export_folder(out, tmp_path):
    inside = os.path.join(out, "x.csv")
    open(inside, "w").close()
    outside = tmp_path / "secret.txt"
    outside.write_text("no")
    calls = []
    assert exports.reveal(inside, folder=out, opener=calls.append) == os.path.realpath(inside)
    assert len(calls) == 1 and os.path.realpath(inside) in " ".join(calls[0])
    for bad in (str(outside), os.path.join(out, "..", "secret.txt"), out, os.path.join(out, "missing.csv")):
        with pytest.raises(exports.ExportInvalid):
            exports.reveal(bad, folder=out, opener=calls.append)
    assert len(calls) == 1


def test_reveal_endpoint_refuses_outside_paths(tmp_path, monkeypatch):
    monkeypatch.setattr(exports, "EXPORT_DIR", str(tmp_path / "exports"))
    res = TestClient(app).post("/api/exports/reveal", json={"path": str(tmp_path / "elsewhere.txt")})
    assert res.status_code == 400 and "export folder" in res.json()["detail"]


# ------------------------------------------------------------------ DXF


def test_dxf_structure_layers_vertices_and_units(out):
    s = _surface()
    o = exports.ExportOptions(interval_m=0.5, major_every=2, spacing_m=2.0)
    res = exports.write_dxf(out, "c", s, o)
    text = open(res["path"], encoding="utf-8").read()
    pairs = parse_dxf(text)
    assert pairs[:2] == [(0, "SECTION"), (2, "HEADER")] and pairs[-1] == (0, "EOF")
    sections = [pairs[i + 1][1] for i, p in enumerate(pairs) if p == (0, "SECTION")]
    assert sections == ["HEADER", "TABLES", "ENTITIES"]
    assert (1, "AC1009") in pairs
    header = dict(pairs[: pairs.index((0, "ENDSEC"))])
    i = pairs.index((9, "$INSUNITS"))
    assert pairs[i + 1] == (70, "6")
    layers = {pairs[i + 1][1] for i, p in enumerate(pairs) if p == (0, "LAYER")}
    assert set(fmt.DXF_LAYERS) <= layers
    assert header

    ents = dxf_entities(pairs)
    polys = [e for e in ents if e["type"] == "POLYLINE"]
    result = exports._contours_for(s, o)
    want = [len(line) for lv in result["levels"] for line in lv["lines"]]
    assert [len(p["vertices"]) for p in polys] == want  # open lines: every vertex
    for p, (lv, line) in zip(polys, [(lv, line) for lv in result["levels"] for line in lv["lines"]]):
        assert p["layer"] == ("CONTOUR_MAJOR" if lv["major"] else "CONTOUR_MINOR")
        assert dict(p["groups"])[70] == "8"  # 3D polyline
        zs = {float(dict(v["groups"])[30]) for v in p["vertices"]}
        assert zs == {lv["elevation"]}
        e0 = float(dict(p["vertices"][0]["groups"])[10])
        assert e0 == pytest.approx(line[0][0], abs=1e-4)  # 4 decimals at UTM scale
    spots = [e for e in ents if e["type"] == "POINT"]
    assert spots and all(e["layer"] == "SPOT" for e in spots)
    assert res["entities"]["SPOT"] == len(spots)


def test_dxf_feet_scale_coordinates_and_elevations(out):
    s = _surface()
    o = exports.ExportOptions(unit="us_ft", contours=False, spacing_m=1.0)
    pairs = parse_dxf(open(exports.write_dxf(out, "f", s, o)["path"], encoding="utf-8").read())
    i = pairs.index((9, "$INSUNITS"))
    assert pairs[i + 1] == (70, "21")
    points = [dict(e["groups"]) for e in dxf_entities(pairs) if e["type"] == "POINT"]
    first = points[0]  # south-west cell centre
    assert float(first[10]) == pytest.approx((E0 + 0.5) / US_FT, abs=1e-4)
    assert float(first[20]) == pytest.approx((N0 + 0.5) / US_FT, abs=1e-4)
    assert float(first[30]) == pytest.approx(200.0 / US_FT, abs=1e-4)
    assert len(points) == np.isfinite(s.z).sum()


def test_site_dxf_has_zones_lod_alignments_and_closed_rings(out):
    s = _surface()
    site = sites.Site(name="S", scans=[], lod=[[E0, N0], [E0 + 6, N0], [E0 + 6, N0 + 4]],
                      zones=[{"id": "a", "name": "Pad, east", "polygon": [[E0, N0], [E0 + 3, N0], [E0 + 3, N0 + 3]]}],
                      alignments=[{"id": "r", "name": "Road", "points": [[E0, N0 + 1], [E0 + 5, N0 + 1]]}])
    res = exports.write_dxf(out, "s", s, exports.ExportOptions(interval_m=0.5, spots=False), site)
    ents = dxf_entities(parse_dxf(open(res["path"], encoding="utf-8").read()))
    by_layer = {}
    for e in ents:
        by_layer.setdefault((e["layer"], e["type"]), []).append(e)
    (zone,) = by_layer[("ZONES", "POLYLINE")]
    assert dict(zone["groups"])[70] == "1" and len(zone["vertices"]) == 3  # closed flag, no repeated vertex
    assert [dict(t["groups"])[1] for t in by_layer[("ZONES", "TEXT")]] == ["Pad, east"]
    assert len(by_layer[("LOD", "POLYLINE")]) == 1
    (road,) = by_layer[("ALIGNMENTS", "POLYLINE")]
    assert dict(road["groups"])[70] == "0" and len(road["vertices"]) == 2


def test_closed_contours_are_closed_polylines_without_repeated_vertex(out):
    n = 21
    gx, gy = np.meshgrid(np.arange(n), np.arange(n))
    z = 10 - 0.1 * np.hypot(gx - 10, gy - 10)
    s = exports.Surface(z, E0, N0, 1.0, "cone", "cone")
    pairs = parse_dxf(open(exports.write_dxf(out, "r", s, exports.ExportOptions(interval_m=0.5, spots=False))["path"],
                           encoding="utf-8").read())
    polys = [e for e in dxf_entities(pairs) if e["type"] == "POLYLINE"]
    closed = [p for p in polys if dict(p["groups"])[70] == "9"]
    assert closed
    for p in closed:
        first, last = (tuple(dict(v["groups"])[c] for c in (10, 20)) for v in (p["vertices"][0], p["vertices"][-1]))
        assert first != last


# ------------------------------------------------------------------ LandXML


def test_landxml_tin_round_trips_through_the_reader(out):
    s = _surface()
    res = exports.write_landxml(out, "surf", s, exports.ExportOptions(unit="us_ft"), {"name": "UTM 17N"})
    # 6 x 4 nodes minus the hole; squares touching it are skipped
    assert res["triangles"] == 2 * (5 * 3 - 4)
    info = landxml.read_info(res["path"])
    assert info["units"] == "us_ft" and info["crs_name"] == "UTM 17N"
    pts, tri, name = landxml.read_tin(res["path"])
    assert name == "surf" and len(tri) == res["triangles"] and len(pts) == res["points"]
    back = pts * US_FT
    xs, ys = fmt.cell_centres(6, 4, E0, N0, 1.0)
    col = np.rint(back[:, 0] - xs[0]).astype(int)
    row = np.rint(back[:, 1] - ys[0]).astype(int)
    assert back[:, 0] == pytest.approx(xs[col], abs=1e-3)
    assert back[:, 2] == pytest.approx(s.z[row, col], abs=1e-3)
    assert not np.any((row == 2) & (col == 3))  # the unscanned node is not in the TIN
    u, v = back[tri[:, 1], :2] - back[tri[:, 0], :2], back[tri[:, 2], :2] - back[tri[:, 0], :2]
    area = 0.5 * np.abs(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0])
    assert area.sum() == pytest.approx(11.0, abs=1e-3)  # 11 measured squares of 1 m²


def test_landxml_metric_units(out):
    res = exports.write_landxml(out, "m", _surface(), exports.ExportOptions(), None)
    assert landxml.read_info(res["path"])["units"] == "m"
    assert 'areaUnit="squareMeter"' in open(res["path"], encoding="utf-8").read()


# ------------------------------------------------------------------ CSV


def test_csv_pnezd_values_spacing_and_units(out):
    s = _surface()
    res = exports.write_csv(out, "p", s, exports.ExportOptions(spacing_m=2.0))
    rows = open(res["path"], encoding="utf-8").read().splitlines()
    assert rows[0] == "Point,Northing,Easting,Elevation,Description"
    first = rows[1].split(",")
    # spacing 2 cells: lattice starts one cell in, at the centre of cell (1, 1)
    assert first == ["1", f"{N0 + 1.5:.4f}", f"{E0 + 1.5:.4f}", f"{s.z[1, 1]:.4f}", "GROUND"]
    assert res["points"] == len(rows) - 1 == 6  # rows 1, 3 x cols 1, 3, 5
    feet = exports.write_csv(out, "p", s, exports.ExportOptions(spacing_m=2.0, unit="ft", header=False))
    frows = open(feet["path"], encoding="utf-8").read().splitlines()
    assert len(frows) == 6
    assert float(frows[0].split(",")[3]) == pytest.approx(s.z[1, 1] / 0.3048, abs=1e-4)


def test_csv_skips_unscanned_cells_and_stays_inside_a_zone():
    z = np.full((10, 10), 5.0)
    z[0, 0] = np.nan
    inside = fmt.polygon_mask([[0, 0], [4, 0], [4, 4], [0, 4]], 10, 10, 0.0, 0.0, 1.0)
    spots, _ = fmt.spot_grid(z, 0.0, 0.0, 1.0, 1.0, inside)
    assert len(spots) == 15  # 4 x 4 centres inside, less the unscanned one
    assert spots[:, :2].max() < 4 and spots[:, :2].min() > 0


# ------------------------------------------------------------------ ESRI ASCII grid


def test_asc_header_values_and_nodata(out):
    s = _surface()
    crs = {"name": "WGS 84 / UTM zone 17N", "epsg": 32617, "unit": "m", "wkt": 'PROJCS["x"]'}
    res = exports.write_asc(out, "g", s, exports.ExportOptions(), crs)
    lines = open(res["path"], encoding="utf-8").read().splitlines()
    head = dict(line.split() for line in lines[:6])
    assert head == {"ncols": "6", "nrows": "4", "xllcorner": f"{E0:.4f}", "yllcorner": f"{N0:.4f}",
                    "cellsize": "1.000000", "NODATA_value": "-9999"}
    grid = np.array([[float(v) for v in line.split()] for line in lines[6:]])
    assert grid.shape == (4, 6)
    assert grid[0] == pytest.approx(s.z[3])  # first row is the north edge
    assert grid[1, 3] == -9999  # the unscanned cell (row 2 from the south)
    assert res["prj"] and open(res["files"][1]["path"]).read() == 'PROJCS["x"]'
    feet = exports.write_asc(out, "g", s, exports.ExportOptions(unit="ft"), crs)
    assert not feet["prj"] and len(feet["files"]) == 1 and "no .prj" in feet["note"]


# ------------------------------------------------------------------ scans on disk (LAS, GeoJSON, endpoints)


@pytest.fixture
def scans(tmp_path, monkeypatch):
    """Two LAS flights of a 40 m square at UTM coordinates (EPSG:32617), with trees and noise."""
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    rng = np.random.default_rng(5)
    n = 8000
    x, y = E0 + rng.uniform(0, 40, n), N0 + rng.uniform(0, 40, n)
    cls = np.where(rng.random(n) < 0.2, 5, 2)  # 20 % high vegetation
    for name, rise in (("ex_week1", 0.0), ("ex_week2", 0.5)):
        z = 200 + 0.05 * (x - E0) + rise + np.where(cls == 5, 8.0, 0.0)
        rgb = rng.integers(0, 256, (n, 3))
        write_las(tmp_path / f"{name}.las", np.column_stack([x, y, z]), cls, rgb=rgb,
                  intensity=rng.integers(0, 4000, n), epsg=32617)
    np.savetxt(tmp_path / "ex_design.xyz", np.column_stack([x, y, np.full(n, 201.5)]))
    yield tmp_path
    for pid in ("ex_week1", "ex_week2", "ex_design"):
        service.invalidate(pid)


def test_las_export_is_the_cleaned_ground_with_channels_and_crs(scans, out):
    import laspy

    res = exports.export_scan("ex_week1", exports.ScanExport(format="las"), folder=out)
    las = laspy.read(res["path"])
    src = laspy.read(str(scans / "ex_week1.las"))
    ground = src.classification == 2
    assert res["ground_only"] is True
    assert len(las.points) == res["points"] == int(ground.sum())  # no outliers in this scan
    assert set(np.unique(las.classification)) == {2}
    assert np.asarray(las.x) == pytest.approx(np.asarray(src.x)[ground], abs=1e-3)
    assert np.asarray(las.z) == pytest.approx(np.asarray(src.z)[ground], abs=1e-3)
    assert np.array_equal(np.asarray(las.intensity), np.asarray(src.intensity)[ground])
    assert np.array_equal(np.asarray(las.red) // 257, np.asarray(src.red)[ground] // 257)
    assert np.asarray(las.gps_time) == pytest.approx(np.asarray(src.gps_time)[ground])
    assert las.header.parse_crs().to_epsg() == 32617 and res["crs"] is True
    assert {"rgb", "intensity", "classification", "gps_time"} <= set(res["channels"])


def test_laz_export_is_compressed_and_feet_drop_a_metre_crs(scans, out):
    import laspy

    laz = exports.export_scan("ex_week1", exports.ScanExport(format="las", options={"compressed": True}), folder=out)
    las_file = exports.export_scan("ex_week1", exports.ScanExport(format="las"), folder=out)
    assert laz["filename"].endswith(".laz") and laz["bytes"] < las_file["bytes"]
    assert len(laspy.read(laz["path"]).points) == laz["points"]
    feet = exports.export_scan("ex_week1", exports.ScanExport(format="las", options={"unit": "us_ft"}), folder=out)
    f = laspy.read(feet["path"])
    assert feet["crs"] is False and f.header.parse_crs() is None
    assert float(np.min(f.x)) == pytest.approx(float(np.min(laspy.read(las_file["path"]).x)) / US_FT, abs=2e-3)


def _make_site():
    sites.create("Ex Site", [{"project_id": "ex_week1", "date": "2026-09-01"},
                             {"project_id": "ex_week2", "date": "2026-09-15"}], "ex_design")
    site = sites.load("ex_site")
    site.zones = [
        sites.Zone(id="z1", name="Pad", polygon=[[E0 + 5, N0 + 5], [E0 + 25, N0 + 5], [E0 + 25, N0 + 25], [E0 + 5, N0 + 25]],
                   start="2026-08-25", finish="2026-10-01"),
        sites.Zone(id="pile", name="Pile", kind="stockpile",
                   polygon=[[E0 + 26, N0 + 26], [E0 + 36, N0 + 26], [E0 + 36, N0 + 36], [E0 + 26, N0 + 36]]),
    ]
    site.lod = [[E0, N0], [E0 + 40, N0], [E0 + 40, N0 + 40], [E0, N0 + 40]]
    site.alignments = [sites.Alignment(id="cl", name="Centreline", points=[[E0, N0 + 20], [E0 + 40, N0 + 20]])]
    site.pay_apps = [sites.PayApp(id="pa", date="2026-09-20", zone_id="pile", kind="fill", claimed_m3=1000.0)]
    sites.save("ex_site", site)
    return site


def test_geojson_in_scan_crs_plus_wgs84(scans, out):
    _make_site()
    res = exports.export_site("ex_site", exports.SiteExport(format="geojson"), folder=out)
    assert [f["filename"] for f in res["files"]] == ["Ex Site plan.geojson", "Ex Site plan_wgs84.geojson"]
    doc = json.load(open(res["files"][0]["path"]))
    assert doc["type"] == "FeatureCollection" and doc["crs"]["properties"]["name"] == "urn:ogc:def:crs:EPSG::32617"
    kinds = [(f["properties"]["layer"], f["geometry"]["type"]) for f in doc["features"]]
    assert kinds == [("zone", "Polygon"), ("zone", "Polygon"), ("lod", "Polygon"), ("alignment", "LineString")]
    ring = doc["features"][0]["geometry"]["coordinates"][0]
    assert ring[0] == ring[-1] and ring[0] == [E0 + 5, N0 + 5]
    assert fmt._signed_area(ring) > 0  # counter-clockwise exterior
    wgs = json.load(open(res["files"][1]["path"]))
    assert "crs" not in wgs  # RFC 7946: WGS84 longitude/latitude is the default
    lon, lat = wgs["features"][0]["geometry"]["coordinates"][0][0]
    assert -84 < lon < -78 and 0 < lat < 84  # UTM zone 17N
    from pyproj import Transformer

    want = Transformer.from_crs(32617, 4326, always_xy=True).transform(E0 + 5, N0 + 5)
    assert (lon, lat) == pytest.approx(want, abs=1e-7)


def test_geojson_without_a_crs_skips_the_wgs84_copy(tmp_path, monkeypatch, out):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    np.savetxt(tmp_path / "ex_plain.xyz", np.random.default_rng(0).uniform(0, 20, (2000, 3)))
    sites.create("Plain", [{"project_id": "ex_plain", "date": "2026-09-01"}], None)
    site = sites.load("plain")
    site.lod = [[0, 0], [20, 0], [20, 20]]
    sites.save("plain", site)
    res = exports.export_site("plain", exports.SiteExport(format="geojson"), folder=out)
    assert len(res["files"]) == 1 and res["wgs84"] is False
    assert "crs" not in json.load(open(res["path"]))
    service.invalidate("ex_plain")


# ------------------------------------------------------------------ progress snapshot


def test_progress_json_hand_checked(scans, out):
    _make_site()
    res = exports.export_site("ex_site", exports.SiteExport(format="progress"), folder=out)
    assert res["filename"] == "surveyr-progress.json"
    doc = json.load(open(res["path"]))
    assert doc["schema"] == "surveyr-progress" and doc["schema_version"] == 1 and doc["units"] == "metric"
    assert doc["generated_at"].endswith("+00:00")
    assert doc["site"]["crs"] == {"name": "WGS 84 / UTM zone 17N", "epsg": 32617, "unit": "m"}
    assert doc["flights"] == [{"id": "ex_week1", "date": "2026-09-01"}, {"id": "ex_week2", "date": "2026-09-15"}]
    assert doc["zones"][0]["planned_start"] == "2026-08-25"
    assert doc["zones"][0]["grade"] == {"target_elevation_m": None, "design_offset_m": 0.0}

    cell = doc["grid"]["cell_size_m"]
    pad, pile = doc["quantities"]
    # pad vs a flat 201.5 m design: ground is 200 + 0.05·(x − E0) (+0.5 at week 2); every cell
    # measured in both. Recompute by hand from the shared grid.
    g = sites.grids("ex_site")
    nx, ny = g["nx"], g["ny"]
    w1, w2 = (sites._grid_array(s["z"], ny, nx) for s in g["scans"])
    design = sites._grid_array(g["design"], ny, nx)
    inside = fmt.polygon_mask(doc["zones"][0]["polygon"], nx, ny, g["x0"], g["y0"], cell)
    assert pad["cells"] == int(inside.sum())

    def remaining(scan):
        d = (scan - design)[inside]
        d = d[np.isfinite(d)]
        d = np.where(np.abs(d) <= 0.05, 0.0, d)
        return d.clip(0).sum() * cell ** 2, (-d).clip(0).sum() * cell ** 2

    (c1, f1), (c2, f2) = remaining(w1), remaining(w2)
    a, b = pad["flights"]
    assert a["remaining_cut_m3"] == pytest.approx(c1, abs=1e-3) and a["remaining_fill_m3"] == pytest.approx(f1, abs=1e-3)
    assert b["remaining_cut_m3"] == pytest.approx(c2, abs=1e-3) and b["remaining_fill_m3"] == pytest.approx(f2, abs=1e-3)
    assert a["pct_complete"] == 0.0
    assert 0 < b["pct_complete"] == pytest.approx(100 * (1 - (c2 + f2) / (c1 + f1)), abs=0.01)
    # the whole pad rose 0.5 m (same points, raised): placed 0.5 m over every cell measured both times
    both = lambda m: int((np.isfinite(w1) & np.isfinite(w2) & m).sum())  # noqa: E731
    assert b["fill_since_previous_m3"] == pytest.approx(0.5 * both(inside) * cell ** 2, rel=1e-3)
    assert b["cut_since_previous_m3"] == pytest.approx(0.0, abs=0.5)
    assert a["cut_since_previous_m3"] is None and a["stockpile_m3"] is None
    # the stockpile zone: volume above the first flight's ground
    assert pile["graded_against_design"] is False and pile["flights"][0]["stockpile_m3"] == 0.0
    pile_cells = fmt.polygon_mask(doc["zones"][1]["polygon"], nx, ny, g["x0"], g["y0"], cell)
    assert pile["cells"] == int(pile_cells.sum())
    assert pile["flights"][1]["stockpile_m3"] == pytest.approx(0.5 * both(pile_cells) * cell ** 2, rel=1e-3)
    assert pile["flights"][1]["remaining_cut_m3"] is None
    # pay app: claimed 1000 m³ of fill in the pile zone, far more than measured → flagged
    check = doc["pay_apps"][0]["check"]
    assert check["from_date"] == "2026-09-01" and check["to_date"] == "2026-09-15"
    assert check["measured_m3"] == pytest.approx(pile["flights"][1]["fill_since_previous_m3"])
    assert check["flagged"] is True


def test_progress_flat_pad_spec_replaces_the_design(scans):
    site = _make_site()
    site.zones[0].target_elevation_m = 200.5 + 0.05 * 15  # roughly the week-2 surface at the pad's middle
    sites.save("ex_site", site)
    doc = exports.progress_snapshot("ex_site")
    pad = doc["quantities"][0]
    assert doc["zones"][0]["grade"]["target_elevation_m"] == pytest.approx(201.25)
    # week 2 ranges 200.75–201.75 over the pad: half above, half below the flat target
    b = pad["flights"][1]
    assert b["remaining_cut_m3"] == pytest.approx(b["remaining_fill_m3"], rel=0.15)


def test_progress_matches_the_demo_truth(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    doc = exports.progress_snapshot("riverside_commons")
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    assert [f["date"] for f in doc["flights"]] == truth["dates"]
    by_id = {q["zone_id"]: q for q in doc["quantities"]}
    for zone in doc["zones"]:
        q = by_id[zone["id"]]
        if zone["kind"] == "grading":
            # first and last flights are free of equipment over the zones; truth applies the 5 cm tolerance
            for k in (0, -1):
                got, want = q["flights"][k], truth["zones"][zone["id"]][k]
                assert got["remaining_cut_m3"] == pytest.approx(want["remaining_cut"], abs=25, rel=0.05)
                assert got["remaining_fill_m3"] == pytest.approx(want["remaining_fill"], abs=25, rel=0.05)
        else:
            vols = [f["stockpile_m3"] for f in q["flights"]]
            assert vols == pytest.approx(truth["stockpiles"][zone["id"]], abs=25, rel=0.05)
    # % complete follows remaining work: the pad is essentially finished by the last flight
    assert by_id["pad"]["flights"][-1]["pct_complete"] > 98
    assert by_id["pad"]["flights"][0]["pct_complete"] == 0.0


# ------------------------------------------------------------------ endpoints


def test_export_endpoints_write_files_and_explain_bad_requests(scans, tmp_path, monkeypatch):
    monkeypatch.setattr(exports, "EXPORT_DIR", str(tmp_path / "Surveyr"))
    opened = []
    monkeypatch.setattr(exports.subprocess, "Popen", opened.append)  # never open a real file manager
    _make_site()
    client = TestClient(app)
    assert client.get("/api/exports/folder").json() == {"folder": str(tmp_path / "Surveyr")}

    res = client.post("/api/exports/scan/ex_week1", json={"format": "csv", "options": {"spacing_m": 5}})
    assert res.status_code == 200
    body = res.json()
    assert body["filename"] == "Ex Week1 points.csv" and body["bytes"] == os.path.getsize(body["path"])
    assert os.path.dirname(body["path"]) == str(tmp_path / "Surveyr")

    site = client.post("/api/exports/site/ex_site", json={"format": "dxf", "options": {"unit": "ft", "scan": "design"}})
    assert site.status_code == 200 and site.json()["filename"] == "Ex Site design contours.dxf"
    assert client.post("/api/exports/reveal", json={"path": body["path"]}).status_code == 200
    assert len(opened) == 1 and os.path.realpath(body["path"]) in " ".join(opened[0])

    def detail(url, payload):
        r = client.post(url, json=payload)
        assert r.status_code == 400, r.text
        return r.json()["detail"]

    assert "format" in detail("/api/exports/scan/ex_week1", {"format": "pdf"})
    assert "'las'" in detail("/api/exports/scan/ex_week1", {"format": "geojson"})  # site-only format: lists scan ones
    assert "colour" in detail("/api/exports/scan/ex_week1", {"format": "csv", "options": {"colour": True}})
    assert "unit" in detail("/api/exports/scan/ex_week1", {"format": "csv", "options": {"unit": "yards"}})
    assert "site exports" in detail("/api/exports/scan/ex_week1", {"format": "csv", "options": {"zone_id": "z1"}})
    assert "unknown zone" in detail("/api/exports/site/ex_site", {"format": "csv", "options": {"zone_id": "nope"}})
    assert "not a flight" in detail("/api/exports/site/ex_site", {"format": "asc", "options": {"scan": "zzz"}})
    assert "flights" in detail("/api/exports/site/ex_site", {"format": "las", "options": {"scan": "design"}})
    assert "spacing_m" in detail("/api/exports/scan/ex_week1", {"format": "csv", "options": {"spacing_m": -1}})
    assert client.post("/api/exports/scan/nope", json={"format": "csv"}).status_code == 404
    assert client.post("/api/exports/site/nope", json={"format": "progress"}).status_code == 404
