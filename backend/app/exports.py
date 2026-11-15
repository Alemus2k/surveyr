"""Contours and exports: getting results out of Surveyr in the formats a general
contractor's partners use (CAD, civil design, GIS, survey, project management).

Endpoints (all in metres unless an export's ``unit`` option says otherwise):

- ``GET  /api/projects/{id}/contours``      contour lines of a scan or design surface
- ``GET  /api/sites/{id}/contours``         contour lines of one flight / the design on the site grid
- ``GET  /api/exports/folder``              where exports are written
- ``POST /api/exports/scan/{project_id}``   write a scan export ``{format, options}``
- ``POST /api/exports/site/{site_id}``      write a site export ``{format, options}``
- ``POST /api/exports/reveal``              show an exported file in the system file manager

Exports are written into ``EXPORT_DIR`` (``~/Downloads/Surveyr``) and never
overwrite: a name already taken gets " (2)", " (3)" … Scans are never modified.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import clean, contours, export_formats as fmt, service, site_progress, sites

router = APIRouter()

EXPORT_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "Surveyr")
PROGRESS_SCHEMA_VERSION = 1
MAX_SPOTS = 1_000_000
AUTO_SPOTS_ACROSS = 40  # automatic spot spacing: about this many spots on the long side
Unit = Literal["m", "us_ft", "ft"]


class ExportInvalid(ValueError):
    """The export can't be made as asked (bad option, nothing measured)."""


# ------------------------------------------------------------------ surfaces


@dataclass
class Surface:
    """A gridded surface in metres: row 0 = south, NaN = not scanned."""

    z: np.ndarray
    x0: float  # south-west corner of the grid (outer edge of the first cell)
    y0: float
    cell: float
    label: str  # human name, used in file names
    project_id: str  # the scan (or design) it came from


def scan_surface(project_id: str) -> Surface:
    """A scan's gridded terrain, exactly as the app analyses it (unscanned cells NaN)."""
    a = service.analyze(project_id)
    z = np.array(a["maps"]["elevation"]["data"], dtype=float)
    mask = np.array(a["maps"]["mask"]["data"], dtype=bool)
    g = a["grid"]
    return Surface(np.where(mask, z, np.nan), float(g["bounds"][0]), float(g["bounds"][1]), float(g["cell_size"]),
                   a["project"].get("name") or project_id, project_id)


def site_surface(site_id: str, scan: Optional[str]) -> Tuple[Surface, dict]:
    """One flight (project id), the design (``"design"``) or — when ``scan`` is empty — the
    latest flight, on the site's shared grid. Returns ``(surface, grids)``."""
    g = sites.grids(site_id)
    if not g["nx"]:
        raise ExportInvalid("this site has no scans yet")
    if scan == "design":
        if g["design"] is None:
            raise ExportInvalid("this site has no design surface")
        flat, pid, label = g["design"], sites.load(site_id).design_id, "design"
    else:
        entry = g["scans"][-1] if not scan else next((s for s in g["scans"] if s["project_id"] == scan), None)
        if entry is None:
            raise ExportInvalid(f"'{scan}' is not a flight of this site (use a flight's project id or 'design')")
        flat, pid, label = entry["z"], entry["project_id"], entry["date"]
    z = sites._grid_array(flat, g["ny"], g["nx"])
    return Surface(z, float(g["x0"]), float(g["y0"]), float(g["cell_size"]), label, pid), g


# ------------------------------------------------------------------ coordinate system


def crs_of(project_id: Optional[str]) -> Optional[dict]:
    """The scan file's coordinate system: ``{name, epsg, unit, wkt}`` or None.

    ``unit`` is the CRS's own horizontal unit ("m", "us_ft", "ft" or None);
    ``wkt`` (ESRI flavour, for .prj files) only for LAS/LAZ files that carry one.
    """
    if not project_id:
        return None
    try:
        info = service._resolve(project_id)
    except service.ProjectNotFound:
        return None
    source = service.FUSED_SOURCES[0] if info["type"] == "fused" else info.get("source", "")
    path = os.path.join(service.DATA_DIR, source)
    if not source.lower().endswith((".las", ".laz")):
        return None
    try:
        import laspy

        with laspy.open(path) as f:
            crs = f.header.parse_crs()
    except Exception:  # unreadable / missing CRS records
        return None
    if crs is None:
        return None
    from . import scan_settings

    unit_name = (crs.axis_info[0].unit_name if crs.axis_info else "").lower()
    try:
        wkt = crs.to_wkt("WKT1_ESRI")
    except Exception:
        wkt = None
    return {"name": crs.name, "epsg": crs.to_epsg(), "unit": scan_settings._CRS_UNITS.get(unit_name), "wkt": wkt,
            "crs": crs}


def _crs_public(crs: Optional[dict]) -> Optional[dict]:
    return None if crs is None else {k: crs[k] for k in ("name", "epsg", "unit")}


# ------------------------------------------------------------------ export folder


def export_dir() -> str:
    os.makedirs(EXPORT_DIR, exist_ok=True)
    return EXPORT_DIR


def safe_stem(name: str) -> str:
    """A file-name stem that is valid on Windows, macOS and Linux."""
    stem = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", name)
    stem = re.sub(r"\s+", " ", stem).strip(" .")
    return stem[:120] or "export"


def reserve(folder: str, stem: str, exts: List[str]) -> List[str]:
    """Paths ``folder/stem<ext>`` for every extension, none of which exist yet.

    A taken name becomes "stem (2)", "stem (3)" … — the same number for every
    extension, so companion files (.asc + .prj) keep matching names.
    """
    n = 1
    while True:
        s = stem if n == 1 else f"{stem} ({n})"
        paths = [os.path.join(folder, s + e) for e in exts]
        if not any(os.path.exists(p) for p in paths):
            return paths
        n += 1


def _write_text(path: str, text: str) -> None:
    with open(path, "x", encoding="utf-8", newline="") as f:  # "x": never overwrite
        f.write(text)


def _result(paths: List[str], **extra) -> dict:
    files = [{"path": p, "filename": os.path.basename(p), "bytes": os.path.getsize(p)} for p in paths]
    return {**files[0], "files": files, **extra}


def reveal(path: str, folder: Optional[str] = None, opener: Optional[Callable[[List[str]], None]] = None) -> str:
    """Open the system file manager at ``path``; refuses anything outside the export folder."""
    root = os.path.realpath(folder or EXPORT_DIR)
    target = os.path.realpath(path)
    try:
        inside = os.path.commonpath([root, target]) == root and target != root
    except ValueError:  # different drives on Windows
        inside = False
    if not inside:
        raise ExportInvalid("only files in the Surveyr export folder can be shown")
    if not os.path.exists(target):
        raise ExportInvalid("that export no longer exists")
    if sys.platform.startswith("win"):
        cmd = ["explorer", f"/select,{target}"]
    elif sys.platform == "darwin":
        cmd = ["open", "-R", target]
    else:
        cmd = ["xdg-open", os.path.dirname(target)]
    (opener or (lambda c: subprocess.Popen(c)))(cmd)
    return target


# ------------------------------------------------------------------ options


class ExportOptions(BaseModel):
    """Options shared by every format; each format reads the ones it needs."""

    model_config = ConfigDict(extra="forbid")

    unit: Unit = "m"  # output coordinates and elevations
    scan: Optional[str] = None  # site exports: a flight's project id, "design", or None = latest flight
    interval_m: Optional[float] = Field(None, gt=0, le=1000)  # contour interval; None = automatic
    major_every: int = Field(contours.DEFAULT_MAJOR_EVERY, ge=1, le=50)
    smooth: float = Field(0.0, ge=0, le=3)  # contour smoothing, Gaussian sigma in cells
    contours: bool = True  # DXF: contour lines
    labels: bool = True  # DXF: elevation labels on major contours
    spots: bool = True  # DXF: spot elevations
    spacing_m: Optional[float] = Field(None, gt=0, le=10000)  # spot / CSV point spacing; None = automatic
    zone_id: Optional[str] = None  # site CSV: only points inside this zone
    header: bool = True  # CSV: header row
    description: str = Field("GROUND", max_length=40)  # CSV description column
    compressed: bool = False  # LAS: write .laz
    wgs84: bool = True  # GeoJSON: also write a WGS84 (longitude/latitude) copy when the CRS allows


ScanFormat = Literal["dxf", "landxml", "csv", "asc", "las"]
SiteFormat = Literal["dxf", "landxml", "csv", "asc", "las", "geojson", "progress"]


class ScanExport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: ScanFormat
    options: ExportOptions = Field(default_factory=ExportOptions)


class SiteExport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    format: SiteFormat
    options: ExportOptions = Field(default_factory=ExportOptions)


class RevealRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


def _validation_message(exc: ValidationError) -> str:
    parts = []
    for err in exc.errors():
        where = ".".join(str(p) for p in err["loc"]) or "body"
        parts.append(f"{where}: {err['msg']}")
    return "; ".join(parts)


# ------------------------------------------------------------------ contours (cached)

_contour_cache: Dict[tuple, tuple] = {}
_contour_lock = threading.Lock()


def _cached(key: tuple, source: object, compute: Callable[[], dict]) -> dict:
    """Cache keyed on ``key`` and valid while ``source`` (the cached grid it came from) is unchanged."""
    with _contour_lock:
        hit = _contour_cache.get(key)
        if hit is not None and hit[0] is source:
            return hit[1]
    result = compute()
    with _contour_lock:
        if len(_contour_cache) > 64:
            _contour_cache.clear()
        _contour_cache[key] = (source, result)
    return result


def surface_contours(s: Surface, interval: Optional[float], major_every: int, smooth: float, unit: str) -> dict:
    return contours.contours(s.z, s.x0, s.y0, s.cell, interval=interval, major_every=major_every, unit=unit,
                             smooth=smooth)


def project_contours(project_id: str, interval: Optional[float], major_every: int, smooth: float, unit: str) -> dict:
    analysis = service.analyze(project_id)
    key = ("project", project_id, interval, major_every, smooth, unit)
    return _cached(key, analysis, lambda: contours.to_json(
        surface_contours(scan_surface(project_id), interval, major_every, smooth, unit)))


def site_contours(site_id: str, scan: Optional[str], interval: Optional[float], major_every: int, smooth: float,
                  unit: str) -> dict:
    s, g = site_surface(site_id, scan)
    key = ("site", site_id, s.project_id if scan != "design" else "design", interval, major_every, smooth, unit)
    result = _cached(key, g, lambda: contours.to_json(surface_contours(s, interval, major_every, smooth, unit)))
    return {**result, "scan": "design" if scan == "design" else s.project_id}


# ------------------------------------------------------------------ writers


def _auto_spacing(s: Surface) -> float:
    ny, nx = s.z.shape
    return max(s.cell, max(nx, ny) * s.cell / AUTO_SPOTS_ACROSS)


def _spots(s: Surface, spacing: Optional[float], inside: Optional[np.ndarray] = None) -> Tuple[np.ndarray, float]:
    spacing = spacing or _auto_spacing(s)
    ny, nx = s.z.shape
    k = max(1, int(round(spacing / s.cell)))
    if (ny / k) * (nx / k) > MAX_SPOTS * 1.05:
        raise ExportInvalid(f"a {spacing:g} m spacing would write over {MAX_SPOTS:,} points; use a larger spacing")
    return fmt.spot_grid(s.z, s.x0, s.y0, s.cell, spacing, inside)


def _text_height(s: Surface) -> float:
    ny, nx = s.z.shape
    return max(s.cell, max(nx, ny) * s.cell / 150)


def _contours_for(s: Surface, o: ExportOptions) -> dict:
    return surface_contours(s, o.interval_m, o.major_every, o.smooth, o.unit)


def write_dxf(folder: str, stem: str, s: Surface, o: ExportOptions, site: Optional[sites.Site] = None) -> dict:
    """Contours, spot elevations and (for a site) zones, limits of disturbance and alignments."""
    dxf = fmt.DxfWriter(o.unit)
    h = _text_height(s)
    counts: Dict[str, int] = {}
    interval = None
    if o.contours:
        try:
            result = _contours_for(s, o)
        except contours.ContourError as exc:
            raise ExportInvalid(str(exc)) from exc
        interval = result["interval"]
        counts.update(fmt.add_contours(dxf, result, labels=o.labels, text_height_m=h))
    if o.spots:
        counts["SPOT"] = fmt.add_spots(dxf, _spots(s, o.spacing_m)[0], h * 0.6)
    if site is not None:
        for z in site.zones:
            dxf.polyline2d("ZONES", z.polygon, closed=True)
            cx, cy = np.mean(np.asarray(z.polygon, dtype=float), axis=0)
            dxf.text("ZONES", cx, cy, 0.0, h, z.name)
        counts["ZONES"] = len(site.zones)
        if site.lod:
            dxf.polyline2d("LOD", site.lod, closed=True)
            counts["LOD"] = 1
        for a in site.alignments:
            dxf.polyline2d("ALIGNMENTS", a.points)
            dxf.text("ALIGNMENTS", a.points[0][0], a.points[0][1], 0.0, h, a.name)
        counts["ALIGNMENTS"] = len(site.alignments)
    (path,) = reserve(folder, stem, [".dxf"])
    _write_text(path, dxf.render())
    return _result([path], entities=counts, interval_m=interval)


def write_landxml(folder: str, stem: str, s: Surface, o: ExportOptions, crs: Optional[dict]) -> dict:
    from . import landxml

    pts, tri = fmt.grid_tin(s.z, s.x0, s.y0, s.cell)
    if not len(tri):
        raise ExportInvalid("nothing measured to triangulate")
    (path,) = reserve(folder, stem, [".xml"])
    tmp = path + ".part"
    landxml.write(tmp, [(f"{stem}", pts * fmt.scale_of(o.unit), tri)], unit=fmt.LANDXML_UNIT[o.unit],
                  crs_name=crs["name"] if crs else None)
    os.rename(tmp, path)  # written aside, then moved into the name reserve() found free
    return _result([path], points=int(len(pts)), triangles=int(len(tri)))


def write_csv(folder: str, stem: str, s: Surface, o: ExportOptions, inside: Optional[np.ndarray] = None) -> dict:
    spots, spacing = _spots(s, o.spacing_m, inside)
    (path,) = reserve(folder, stem, [".csv"])
    _write_text(path, fmt.write_pnezd(spots, o.unit, o.description, o.header))
    return _result([path], points=int(len(spots)), spacing_m=spacing)


def write_asc(folder: str, stem: str, s: Surface, o: ExportOptions, crs: Optional[dict]) -> dict:
    with_prj = bool(crs and crs.get("wkt") and crs.get("unit") == o.unit)
    paths = reserve(folder, stem, [".asc", ".prj"] if with_prj else [".asc"])
    _write_text(paths[0], fmt.write_asc(s.z, s.x0, s.y0, s.cell, o.unit))
    if with_prj:
        _write_text(paths[1], crs["wkt"])
    note = None
    if crs and not with_prj:
        note = (f"no .prj written: the coordinate system ({crs['name']}) is in "
                f"{crs.get('unit') or 'unknown units'}, the export in {o.unit}")
    return _result(paths, prj=with_prj, note=note)


def write_las(folder: str, stem: str, project_id: str, o: ExportOptions) -> dict:
    """The cleaned ground the app measures (ground only when classified, outliers removed,
    scan settings applied), with every channel the scan carries."""
    import laspy

    cloud, ground_only = service._load_cloud(project_id)
    cloud = clean.remove_z_outliers(cloud)
    if cloud.size == 0:
        raise ExportInvalid("this scan has no ground points to export")
    crs = crs_of(project_id)
    k = fmt.scale_of(o.unit)
    pts = cloud.points * k
    ch = cloud.channels
    rgb = all(cloud.has(c) for c in ("red", "green", "blue"))
    header = laspy.LasHeader(point_format=7 if rgb else 6, version="1.4")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.floor(pts.min(axis=0))
    with_crs = bool(crs and crs.get("unit") == o.unit)
    if with_crs:
        header.add_crs(crs["crs"])
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts[:, 0], pts[:, 1], pts[:, 2]
    if cloud.has("intensity"):
        las.intensity = np.clip(np.round(ch["intensity"]), 0, 65535).astype(np.uint16)
    if cloud.has("classification"):
        las.classification = np.clip(ch["classification"], 0, 255).astype(np.uint8)
    for name in ("return_number", "number_of_returns"):
        if cloud.has(name):
            las[name] = np.clip(ch[name], 0, 15).astype(np.uint8)
    if cloud.has("gps_time"):
        las.gps_time = ch["gps_time"]
    if cloud.has("scan_angle"):
        las.scan_angle = np.clip(np.round(ch["scan_angle"]), -32768, 32767).astype(np.int16)
    if rgb:
        for c in ("red", "green", "blue"):
            las[c] = np.clip(np.round(ch[c] * 65535), 0, 65535).astype(np.uint16)
    ext = ".laz" if o.compressed else ".las"
    (path,) = reserve(folder, stem, [ext])
    tmp = path[: -len(ext)] + ".part" + ext  # laspy picks compression from the suffix
    try:
        las.write(tmp, do_compress=o.compressed)
    except Exception as exc:  # e.g. no LAZ backend
        if os.path.exists(tmp):
            os.remove(tmp)
        raise ExportInvalid(f"couldn't write {ext[1:].upper()}: {exc}") from exc
    os.rename(tmp, path)
    channels = [c for c in ("intensity", "classification", "return_number", "number_of_returns", "gps_time",
                            "scan_angle") if cloud.has(c)] + (["rgb"] if rgb else [])
    return _result([path], points=int(cloud.size), ground_only=ground_only, channels=channels, crs=with_crs)


def write_geojson(folder: str, stem: str, site: sites.Site, o: ExportOptions, crs: Optional[dict]) -> dict:
    """Zones, limits of disturbance and alignments in the scan's CRS (its own units),
    plus a WGS84 copy when the CRS has an EPSG code pyproj can transform."""
    if not (site.zones or site.lod or site.alignments):
        raise ExportInvalid("this site has no zones, limits of disturbance or alignments to export")
    native = crs.get("unit") if crs else None
    k = fmt.scale_of(native) if native in fmt.UNIT_TO_M else 1.0
    feats = fmt.site_features(site, k)
    crs_name = f"urn:ogc:def:crs:EPSG::{crs['epsg']}" if crs and crs.get("epsg") else (crs["name"] if crs else None)
    meta = {"surveyr": {"site": site.name, "units": native or "m",
                        "crs_name": crs["name"] if crs else None, "epsg": crs.get("epsg") if crs else None}}
    wgs = None
    if o.wgs84 and crs and crs.get("epsg"):
        try:
            from pyproj import Transformer

            tr = Transformer.from_crs(crs["epsg"], 4326, always_xy=True)
            wgs = fmt.transform_features(feats, lambda x, y: tr.transform(x, y))
        except Exception:
            wgs = None
    paths = reserve(folder, stem, [".geojson", "_wgs84.geojson"] if wgs is not None else [".geojson"])
    _write_text(paths[0], fmt.feature_collection(feats, site.name, crs_name, meta))
    if wgs is not None:
        _write_text(paths[1], fmt.feature_collection(wgs, site.name, None,
                                                     {"surveyr": {**meta["surveyr"], "units": "degrees"}}))
    return _result(paths, features=len(feats), wgs84=wgs is not None)


def progress_snapshot(site_id: str, now: Optional[datetime] = None) -> dict:
    """The ``surveyr-progress.json`` document (schema in docs/features/exports.md)."""
    site = sites.load(site_id)
    g = sites.grids(site_id)
    nx, ny, cell, x0, y0 = g["nx"], g["ny"], float(g["cell_size"]), float(g["x0"]), float(g["y0"])
    order = {s.project_id: s.date for s in site.scans}
    entries = [s for s in g["scans"] if s["project_id"] in order]
    scans = [sites._grid_array(s["z"], ny, nx) for s in entries]
    dates = [order[s["project_id"]] for s in entries]
    ids = [s["project_id"] for s in entries]
    design = sites._grid_array(g["design"], ny, nx) if g["design"] is not None else None
    masks = site_progress.zone_masks(site.zones, nx, ny, x0, y0, cell) if nx else []
    grade = site_progress.finished_grade(design, site.zones, masks, (ny, nx)) if nx else None
    zones_out = [site_progress.zone_series(z, m, scans, dates, ids, grade, cell, site.tolerance_m,
                                           site.change_threshold_m) for z, m in zip(site.zones, masks)]
    masks_by_id = {z.id: m for z, m in zip(site.zones, masks)}
    crs = crs_of(ids[0] if ids else None)
    return {
        "schema": "surveyr-progress",
        "schema_version": PROGRESS_SCHEMA_VERSION,
        "generated_at": (now or datetime.now(timezone.utc)).isoformat(timespec="seconds"),
        "generator": "Surveyr",
        "units": "metric",
        "site": {"id": site_id, "name": site.name, "design_id": site.design_id, "tolerance_m": site.tolerance_m,
                 "change_threshold_m": site.change_threshold_m, "overbill_pct": site.overbill_pct,
                 "crs": _crs_public(crs)},
        "grid": {"cell_size_m": cell, "x0": x0, "y0": y0, "nx": nx, "ny": ny},
        "flights": [{"id": pid, "date": d} for pid, d in zip(ids, dates)],
        "zones": [{"id": z.id, "name": z.name, "kind": z.kind, "polygon": z.polygon, "planned_start": z.start,
                   "planned_finish": z.finish,
                   "grade": {"target_elevation_m": z.target_elevation_m, "design_offset_m": z.design_offset_m}}
                  for z in site.zones],
        "pay_apps": [{**pa.model_dump(), "check": site_progress.pay_app_check(
            pa, site.zones, masks_by_id, scans, dates, cell, site.change_threshold_m, site.overbill_pct, (ny, nx))}
            for pa in site.pay_apps],
        "layers": [layer.model_dump() for layer in site.layers],
        "quantities": zones_out,
    }


def write_progress(folder: str, site_id: str) -> dict:
    doc = progress_snapshot(site_id)
    (path,) = reserve(folder, "surveyr-progress", [".json"])
    _write_text(path, json.dumps(doc, indent=2))
    return _result([path], zones=len(doc["zones"]), flights=len(doc["flights"]))


# ------------------------------------------------------------------ orchestration


def export_scan(project_id: str, req: ScanExport, folder: Optional[str] = None) -> dict:
    folder = folder or export_dir()
    o = req.options
    if o.scan or o.zone_id:
        raise ExportInvalid("'scan' and 'zone_id' only apply to site exports")
    if req.format == "las":
        name = service._resolve(project_id).get("name") or project_id
        return write_las(folder, safe_stem(f"{name} ground"), project_id, o)
    s = scan_surface(project_id)
    stem = safe_stem(f"{s.label} {_FORMAT_WORD[req.format]}")
    if req.format == "dxf":
        return write_dxf(folder, stem, s, o)
    if req.format == "landxml":
        return write_landxml(folder, stem, s, o, crs_of(project_id))
    if req.format == "csv":
        return write_csv(folder, stem, s, o)
    return write_asc(folder, stem, s, o, crs_of(project_id))


_FORMAT_WORD = {"dxf": "contours", "landxml": "surface", "csv": "points", "asc": "grid", "las": "ground"}


def export_site(site_id: str, req: SiteExport, folder: Optional[str] = None) -> dict:
    folder = folder or export_dir()
    o = req.options
    site = sites.load(site_id)
    if req.format == "progress":
        return write_progress(folder, site_id)
    if req.format == "geojson":
        first = site.scans[0].project_id if site.scans else site.design_id
        return write_geojson(folder, safe_stem(f"{site.name} plan"), site, o, crs_of(first))
    if req.format == "las":
        if o.scan == "design" or (o.scan and o.scan not in {s.project_id for s in site.scans}):
            raise ExportInvalid("choose one of the site's flights for a LAS export")
        pid = o.scan or (site.scans[-1].project_id if site.scans else None)
        if not pid:
            raise ExportInvalid("this site has no scans yet")
        date = next(s.date for s in site.scans if s.project_id == pid)
        return write_las(folder, safe_stem(f"{site.name} {date} ground"), pid, o)
    s, _ = site_surface(site_id, o.scan)
    stem = safe_stem(f"{site.name} {s.label} {_FORMAT_WORD[req.format]}")
    crs = crs_of(s.project_id if o.scan != "design" else (site.scans[0].project_id if site.scans else None))
    if req.format == "dxf":
        return write_dxf(folder, stem, s, o, site)
    if req.format == "landxml":
        return write_landxml(folder, stem, s, o, crs)
    if req.format == "csv":
        inside = None
        if o.zone_id:
            zone = next((z for z in site.zones if z.id == o.zone_id), None)
            if zone is None:
                raise ExportInvalid(f"unknown zone '{o.zone_id}'")
            ny, nx = s.z.shape
            inside = fmt.polygon_mask(zone.polygon, nx, ny, s.x0, s.y0, s.cell)
            stem = safe_stem(f"{site.name} {s.label} {zone.name} points")
        return write_csv(folder, stem, s, o, inside)
    return write_asc(folder, stem, s, o, crs)


# ------------------------------------------------------------------ routes


def _http(fn: Callable[[], dict], what: str) -> dict:
    try:
        return fn()
    except (ExportInvalid, contours.ContourError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except service.NotAnalyzable:
        raise HTTPException(status_code=400, detail="comparisons and sites have no single terrain; pick a scan")
    except service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=f"unknown {what} '{exc.args[0]}'")


@router.get("/api/projects/{project_id}/contours")
def get_project_contours(
    project_id: str,
    interval: Optional[float] = Query(None, gt=0, le=1000, description="metres; omit for automatic"),
    major_every: int = Query(contours.DEFAULT_MAJOR_EVERY, ge=1, le=50),
    smooth: float = Query(0.0, ge=0, le=3),
    unit: Unit = Query("m", description="unit system the automatic interval is round in"),
) -> dict:
    """Contour lines of a scan (or a LandXML design surface) in survey coordinates."""
    return _http(lambda: project_contours(project_id, interval, major_every, smooth, unit), "project")


@router.get("/api/sites/{site_id}/contours")
def get_site_contours(
    site_id: str,
    scan: Optional[str] = Query(None, description="a flight's project id, 'design', or omit for the latest flight"),
    interval: Optional[float] = Query(None, gt=0, le=1000),
    major_every: int = Query(contours.DEFAULT_MAJOR_EVERY, ge=1, le=50),
    smooth: float = Query(0.0, ge=0, le=3),
    unit: Unit = Query("m"),
) -> dict:
    """Contour lines of one flight (or the design) on the site's shared grid."""
    return _http(lambda: site_contours(site_id, scan, interval, major_every, smooth, unit), "site")


@router.get("/api/exports/folder")
def get_export_folder() -> dict:
    return {"folder": export_dir()}


@router.post("/api/exports/scan/{project_id}")
def post_scan_export(project_id: str, body: dict = Body(...)) -> dict:
    """Write a scan export. Body: ``{"format": "dxf"|"landxml"|"csv"|"asc"|"las", "options": {...}}``."""
    try:
        req = ScanExport.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_validation_message(exc))
    return _http(lambda: export_scan(project_id, req), "project")


@router.post("/api/exports/site/{site_id}")
def post_site_export(site_id: str, body: dict = Body(...)) -> dict:
    """Write a site export. Body: ``{"format": ... | "geojson" | "progress", "options": {...}}``."""
    try:
        req = SiteExport.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=_validation_message(exc))
    return _http(lambda: export_site(site_id, req), "site")


@router.post("/api/exports/reveal")
def post_reveal(body: RevealRequest) -> dict:
    """Show an exported file in Explorer / Finder / the Linux file manager."""
    try:
        return {"path": reveal(body.path)}
    except ExportInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"couldn't open the file manager: {exc}")
