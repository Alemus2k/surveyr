"""Job sites: dated scans of one site plus its design surface, work zones and
pay-app claims, for tracking construction progress over time.

Saved as ``<id>.site.json`` beside the scans; the scans are never modified.
Scans of a site must share a coordinate system (e.g. a drone with RTK flying
the same survey control each time) — they are compared cell by cell on one
common grid, with no re-alignment.
"""
from __future__ import annotations

import json
import os
import re
import threading
from typing import Dict, List, Literal, Optional, Union

import numpy as np
from pydantic import BaseModel, Field, ValidationError, field_validator

from . import clean, dem, service

SUFFIX = service.SITE_SUFFIX
MAX_SCANS = 60
MAX_ZONES = 40
TARGET_CELLS_ACROSS = 200  # site grids are a little finer than single-scan analysis
MAX_CELLS_ACROSS = 300
_DATE = r"^\d{4}-\d{2}-\d{2}$"
_COLOR = r"^#[0-9a-f]{6}$"


class SiteInvalid(ValueError):
    """Requested site content can't be saved (unknown scans, bad values)."""


class SiteScan(BaseModel):
    project_id: str
    date: str = Field(pattern=_DATE)


class Zone(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)
    kind: Literal["grading", "stockpile"] = "grading"
    color: str = Field("#eeb02b", pattern=_COLOR)
    polygon: List[List[float]] = Field(min_length=3, max_length=500)  # [easting, northing]
    start: Optional[str] = Field(None, pattern=_DATE)
    finish: Optional[str] = Field(None, pattern=_DATE)
    # finished-grade spec inside the zone: a flat pad at this elevation, else
    # the design surface raised (+) or lowered (−) by the offset
    target_elevation_m: Optional[float] = Field(None, ge=-1000, le=10000)
    design_offset_m: float = Field(0.0, ge=-50, le=50)

    @field_validator("polygon")
    @classmethod
    def _pairs(cls, v: List[List[float]]) -> List[List[float]]:
        if any(len(p) != 2 for p in v):
            raise ValueError("polygon vertices must be [easting, northing] pairs")
        return v


def _check_pairs(v: List[List[float]]) -> List[List[float]]:
    if any(len(p) != 2 for p in v):
        raise ValueError("vertices must be [easting, northing] pairs")
    return v


class _Shape(BaseModel):
    """Something drawn on the site plan, with an id and a display name."""

    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=60)


class Layer(_Shape):
    """A material layer placed on a finished surface (base course, paving, topsoil…),
    measured as the rise between the scan flown before it was placed and later scans."""

    material: str = Field("", max_length=60)
    polygon: List[List[float]] = Field(min_length=3, max_length=500)
    base_scan: Optional[str] = None  # project id of the scan it sits on; None = the scan before it first appears
    target_thickness_m: float = Field(gt=0, le=5)
    tolerance_m: float = Field(0.03, ge=0, le=1)  # thinner than target − tolerance is flagged
    density_t_m3: Optional[float] = Field(None, gt=0, le=10)  # for tonnage; None = volume only

    _pairs = field_validator("polygon")(_check_pairs)


class Flatwork(_Shape):
    """Paved walking surface checked against accessibility (ADA) slope limits."""

    kind: Literal["walk", "ramp", "landing", "parking"] = "walk"
    polygon: List[List[float]] = Field(min_length=3, max_length=500)

    _pairs = field_validator("polygon")(_check_pairs)


class Alignment(_Shape):
    """A centreline to cut cross-sections along (road, trench, swale)."""

    points: List[List[float]] = Field(min_length=2, max_length=500)
    interval_m: float = Field(10.0, gt=0, le=1000)  # station spacing
    half_width_m: float = Field(10.0, gt=0, le=500)  # how far each section reaches either side

    _pairs = field_validator("points")(_check_pairs)


class Monitor(_Shape):
    """An area watched for settlement or heave between flights."""

    polygon: List[List[float]] = Field(min_length=3, max_length=500)
    baseline_scan: Optional[str] = None  # project id; None = the first scan after the area stops changing
    alert_m: float = Field(0.025, gt=0, le=2)  # movement that raises a flag

    _pairs = field_validator("polygon")(_check_pairs)


class AsBuilt(_Shape):
    """A record of something that gets buried: where it ran and how deep, from the scan that saw it."""

    kind: Literal["trench"] = "trench"
    scan: str  # project id of the flight that captured it open
    line: List[List[float]] = Field(min_length=2, max_length=500)
    note: str = Field("", max_length=200)

    _pairs = field_validator("line")(_check_pairs)


class Pond(BaseModel):
    """A detention / retention basin whose storage is checked against the design."""

    zone_id: str
    spill_elevation_m: float = Field(ge=-1000, le=10000)  # outlet: storage is the volume below it
    required_storage_m3: Optional[float] = Field(None, ge=0)


class PayApp(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    date: str = Field(pattern=_DATE)  # period end: the scan that measures it
    zone_id: Optional[str] = None  # None = whole site
    kind: Literal["cut", "fill"] = "cut"
    claimed_m3: float = Field(ge=0)
    contractor: str = Field("", max_length=80)
    note: str = Field("", max_length=200)


SpecField = Literal["design_id", "tolerance_m", "grade", "start", "finish"]
# a spec's stored value: scan id or date (str), tolerance (float),
# finished grade ({"target_elevation_m": …, "design_offset_m": …}), or unset
SpecValue = Optional[Union[float, str, Dict[str, Optional[float]]]]


class SpecValues(BaseModel):
    before: SpecValue = None
    after: SpecValue = None


class SpecChange(BaseModel):
    """One spec edited by a change order, as it read before and after."""

    field: SpecField
    zone_id: Optional[str] = None  # None = a site-wide spec
    zone_name: Optional[str] = Field(None, max_length=60)  # kept so the log reads right if the zone goes
    before: str = Field(max_length=200)
    after: str = Field(max_length=200)
    values: Optional[SpecValues] = None  # the stored values, so a void can restore them exactly


class KeptSpec(BaseModel):
    """A spec a void left alone: a later order changed it again, or its zone is gone."""

    field: SpecField
    zone_id: Optional[str] = None
    zone_name: Optional[str] = Field(None, max_length=60)
    by_number: Optional[int] = None  # the later order now in effect; None = the zone was deleted


class VoidRecord(BaseModel):
    date: str = Field(pattern=_DATE)
    reason: str = Field(min_length=1, max_length=1000)
    voided_by: str = Field("", max_length=80)
    voided_at: str = Field(max_length=40)  # ISO timestamp
    restored: List[SpecChange] = Field(default_factory=list, max_length=200)  # what the void changed back
    kept: List[KeptSpec] = Field(default_factory=list, max_length=200)


class ChangeOrder(BaseModel):
    """A logged revision of the job specs. Append-only once saved; may only gain a void record."""

    id: str = Field(min_length=1, max_length=40)
    number: int = Field(ge=1)
    date: str = Field(pattern=_DATE)  # effective date
    title: str = Field(min_length=1, max_length=80)
    reason: str = Field("", max_length=1000)
    requested_by: str = Field("", max_length=80)
    created_at: str = Field(max_length=40)  # ISO timestamp it was logged
    changes: List[SpecChange] = Field(min_length=1, max_length=200)
    voided: Optional[VoidRecord] = None


class Site(BaseModel):
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=80)
    scans: List[SiteScan] = Field(max_length=MAX_SCANS)
    design_id: Optional[str] = None
    tolerance_m: float = Field(0.05, gt=0, le=2)  # on grade when within this of design
    change_threshold_m: float = Field(0.05, ge=0, le=2)  # smaller scan-to-scan changes are noise
    overbill_pct: float = Field(10.0, ge=0, le=100)  # flag claims this far above measured
    control_id: Optional[str] = None  # check points every flight is graded against
    zones: List[Zone] = Field(default_factory=list, max_length=MAX_ZONES)
    pay_apps: List[PayApp] = Field(default_factory=list, max_length=500)
    change_orders: List[ChangeOrder] = Field(default_factory=list, max_length=500)
    # what else to measure on each flight (all optional; older site files simply lack them)
    lod: Optional[List[List[float]]] = Field(None, min_length=3, max_length=2000)  # limits of disturbance polygon
    layers: List[Layer] = Field(default_factory=list, max_length=100)
    flatwork: List[Flatwork] = Field(default_factory=list, max_length=200)
    alignments: List[Alignment] = Field(default_factory=list, max_length=50)
    monitors: List[Monitor] = Field(default_factory=list, max_length=100)
    asbuilts: List[AsBuilt] = Field(default_factory=list, max_length=200)
    ponds: List[Pond] = Field(default_factory=list, max_length=20)

    _lod_pairs = field_validator("lod")(lambda v: v if v is None else _check_pairs(v))


def _path(site_id: str) -> str:
    return os.path.join(service.DATA_DIR, site_id + SUFFIX)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "_", name.lower()).strip("_-")[:60] or "site"


def _check_members(site: Site) -> None:
    registry = service.discover_projects()
    for pid in [s.project_id for s in site.scans] + ([site.design_id] if site.design_id else []):
        info = registry.get(pid)
        if info is None:
            raise SiteInvalid(f"unknown scan '{pid}'")
        if info["type"] not in ("single", "fused"):
            raise SiteInvalid("a site can only contain scans")


def _write(site_id: str, site: Site) -> None:
    path = _path(site_id)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(site.model_dump_json(indent=2))
    os.replace(tmp, path)  # atomic: a crash never leaves a half-written file


def _sorted(site: Site) -> Site:
    site.scans = sorted(site.scans, key=lambda s: s.date)
    return site


def create(name: str, scans: List[dict], design_id: Optional[str]) -> dict:
    """Make a new site from existing scans; returns its project entry."""
    try:
        site = _sorted(Site(name=name.strip(), scans=scans, design_id=design_id or None))
    except ValidationError as exc:
        raise SiteInvalid(str(exc)) from exc
    if not site.scans:
        raise SiteInvalid("a site needs at least one dated scan")
    _check_members(site)
    base = _slug(site.name)
    site_id, n = base, 2
    while site_id in service.discover_projects():
        site_id, n = f"{base}_{n}", n + 1
    _write(site_id, site)
    return service.discover_projects()[site_id]


def _info(site_id: str) -> dict:
    info = service.discover_projects().get(site_id)
    if info is None or info["type"] != "site":
        raise service.ProjectNotFound(site_id)
    return info


def load(site_id: str) -> Site:
    """Read a site, dropping scans (and the design) that no longer exist."""
    _info(site_id)
    with open(_path(site_id)) as f:
        site = Site.model_validate(json.load(f))
    registry = service.discover_projects()
    site.scans = [s for s in site.scans if s.project_id in registry]
    if site.design_id not in registry:
        site.design_id = None
    if site.control_id and not os.path.exists(os.path.join(service.DATA_DIR, site.control_id + ".control.json")):
        site.control_id = None
    return _sorted(site)


def _check_change_orders(site_id: str, site: Site) -> None:
    """Change orders are a record: new ones may be added and a logged one may be
    voided once; otherwise logged orders (and their voids) never change."""
    with open(_path(site_id)) as f:
        logged = Site.model_validate(json.load(f)).change_orders
    incoming = {co.id: co for co in site.change_orders}
    for co in logged:
        new = incoming.get(co.id)
        if new is None:
            raise SiteInvalid("logged change orders can't be removed")
        if new == co:
            continue
        voiding = co.voided is None and new.voided is not None
        if not voiding or new.model_copy(update={"voided": None}) != co:
            raise SiteInvalid("logged change orders can't be edited, and a void can't be undone")
    numbers = [co.number for co in site.change_orders]
    if len(set(numbers)) != len(numbers):
        raise SiteInvalid("change order numbers must be unique")


def save(site_id: str, site: Site) -> Site:
    _info(site_id)
    _check_members(site)
    _check_change_orders(site_id, site)
    _write(site_id, _sorted(site))
    return site


# ------------------------------------------------------------------ common grid

_grid_cache: Dict[tuple, dict] = {}
_grid_lock = threading.Lock()


def _member_stamp(pid: str) -> tuple:
    """Changes whenever a member scan or its manual adjustments change."""
    info = service.discover_projects()[pid]
    stamps = []
    for fname in service._project_files(info):
        p = os.path.join(service.DATA_DIR, fname)
        stamps.append(os.path.getmtime(p) if os.path.exists(p) else 0.0)
    return (pid, *stamps)


def _cell_size(extent: float) -> float:
    wanted = max(extent / TARGET_CELLS_ACROSS, extent / MAX_CELLS_ACROSS, service.MIN_CELL)
    for cell in service._NICE_CELLS:
        if cell >= wanted:
            return cell
    return service._NICE_CELLS[-1]


def _flat(z: np.ndarray) -> list:
    """Row-major list in mm precision, None where nothing was scanned."""
    return [None if not np.isfinite(v) else round(float(v), 3) for v in z.ravel()]


def grids(site_id: str) -> dict:
    """Every scan and the design rasterised onto one shared grid. Cached.

    Cells are the mean elevation of the points in them; cells nobody scanned
    are null (pinholes closed, nothing interpolated), so volumes only ever
    count ground that was really measured.
    """
    site = load(site_id)
    members = [s.project_id for s in site.scans] + ([site.design_id] if site.design_id else [])
    if not members:
        return {"cell_size": 1.0, "nx": 0, "ny": 0, "x0": 0.0, "y0": 0.0, "design": None, "scans": []}
    key = (site_id, *(_member_stamp(pid) for pid in dict.fromkeys(members)))
    with _grid_lock:
        if key in _grid_cache:
            return _grid_cache[key]

    clouds = {}
    for pid in dict.fromkeys(members):
        cloud, _ = service._load_cloud(pid)
        clouds[pid] = clean.remove_z_outliers(cloud)
    lo = np.min([c.points[:, :2].min(axis=0) for c in clouds.values() if c.size], axis=0)
    hi = np.max([c.points[:, :2].max(axis=0) for c in clouds.values() if c.size], axis=0)
    cell = _cell_size(float(np.max(hi - lo)))
    # snap the grid origin to whole cells so the same site always grids the same way
    x0, y0 = np.floor(lo / cell) * cell
    bounds = (float(x0), float(y0), float(hi[0]), float(hi[1]))

    def surface(pid: str) -> np.ndarray:
        d = dem.rasterize(clouds[pid], cell_size=cell, bounds=bounds)
        mask = dem.scanned_mask(d)
        z = np.where(mask, dem.fill_holes(d), np.nan)  # closes pinholes only, inside the mask
        return z

    first = dem.rasterize(clouds[members[0]], cell_size=cell, bounds=bounds)
    result = {
        "cell_size": cell,
        "nx": int(first["z"].shape[1]),
        "ny": int(first["z"].shape[0]),
        "x0": bounds[0],
        "y0": bounds[1],
        "design": _flat(surface(site.design_id)) if site.design_id else None,
        "scans": [{"project_id": s.project_id, "date": s.date, "z": _flat(surface(s.project_id))} for s in site.scans],
    }
    with _grid_lock:
        for k in [k for k in _grid_cache if k[0] == site_id]:
            del _grid_cache[k]
        _grid_cache[key] = result
    return result


def qa(site_id: str) -> List[dict]:
    """Every flight's vertical accuracy against the site's control set (empty without one)."""
    from . import control

    site = load(site_id)
    if not site.control_id:
        return []
    out = []
    for s in site.scans:
        res = control.check(s.project_id, site.control_id)
        out.append({"project_id": s.project_id, "date": s.date, "stats": res["stats"], "points": len(res["points"])})
    return out


# ------------------------------------------------------------------ what else each flight saw

GROUND_CLASS = 2
VEGETATION_CLASSES = (3, 4, 5)  # ASPRS: low, medium, high vegetation
NOISE_CLASSES = (7, 18)  # low / high noise: never drawn or measured
_raster_cache: Dict[tuple, tuple] = {}


def _grid_array(flat: list, ny: int, nx: int) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in flat], dtype=float).reshape(ny, nx)


def rasters(site_id: str, project_id: str) -> tuple:
    """Everything one flight recorded besides the ground shape, on the site's shared grid.

    Returns ``(header, arrays)`` for ``binary.pack``; every array is (ny, nx[, 3]),
    row 0 = south, like ``grids``:

    - ``coverage`` (u1): 1 where the flight has any points.
    - ``photo`` (u1 x 3): what the cell looks like from above — the mean colour of
      the points over the ground (canopy, machines) if there are any, else of the
      ground itself. Only when the scan has colour.
    - ``intensity`` (u1): mean ground reflectance, contrast-stretched (raw range in
      the header). Bright = aggregate / concrete, dark = wet or organic.
    - ``veg_height`` / ``object_height`` (f4, NaN = none): the highest vegetation /
      other non-ground point above the cell's ground. Objects are machines,
      structures, pipe — anything not ground, vegetation or noise.
    - ``density`` / ``ground_density`` (u2): points per cell, all classes / ground.

    Scans with no classification are treated as all ground, so the height layers
    are simply empty. Cached until the flight, its settings or the grid change.
    """
    g = grids(site_id)
    scan = next((s for s in g["scans"] if s["project_id"] == project_id), None)
    if scan is None:
        raise service.ProjectNotFound(project_id)
    nx, ny, cell = g["nx"], g["ny"], g["cell_size"]
    key = (site_id, project_id, _member_stamp(project_id), cell, g["x0"], g["y0"], nx, ny)
    with _grid_lock:
        if key in _raster_cache:
            return _raster_cache[key]

    full, _ = service._load_full(project_id)
    x, y, z = full.points[:, 0], full.points[:, 1], full.points[:, 2]
    ix = np.floor((x - g["x0"]) / cell).astype(np.int64)
    iy = np.floor((y - g["y0"]) / cell).astype(np.int64)
    cls = full.channels["classification"].astype(int) if full.has("classification") else None
    classified = cls is not None and bool((cls == GROUND_CLASS).any())
    noise = np.isin(cls, NOISE_CLASSES) if cls is not None else np.zeros(full.size, dtype=bool)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny) & ~noise
    flat = iy * nx + ix
    ground = (cls == GROUND_CLASS) if classified else np.ones(full.size, dtype=bool)
    veg = np.isin(cls, VEGETATION_CLASSES) if classified else np.zeros(full.size, dtype=bool)
    obj = ~ground & ~veg
    cells = nx * ny

    def count(mask: np.ndarray) -> np.ndarray:
        return np.bincount(flat[ok & mask], minlength=cells)

    def mean(values: np.ndarray, mask: np.ndarray, n: np.ndarray) -> np.ndarray:
        return np.bincount(flat[ok & mask], weights=values[ok & mask], minlength=cells) / np.maximum(n, 1)

    n_all, n_ground, n_above = count(np.ones(full.size, dtype=bool)), count(ground), count(~ground)
    ground_z = _grid_array(scan["z"], ny, nx).ravel()  # the same ground surface the volumes use

    def height(mask: np.ndarray) -> np.ndarray:
        top = np.full(cells, -np.inf)
        np.maximum.at(top, flat[ok & mask], z[ok & mask])
        h = np.where(np.isfinite(top), top - ground_z, np.nan)
        return np.where(h > 0, h, np.nan).astype(np.float32).reshape(ny, nx)

    header = {"project_id": project_id, "nx": nx, "ny": ny, "cell_size": cell, "x0": g["x0"], "y0": g["y0"],
              "classified": classified}
    arrays = [("coverage", (n_all > 0).astype(np.uint8).reshape(ny, nx))]
    if all(full.has(c) for c in ("red", "green", "blue")):
        photo = np.zeros((cells, 3))
        for i, c in enumerate(("red", "green", "blue")):
            col = full.channels[c]
            photo[:, i] = np.where(n_above > 0, mean(col, ~ground, n_above), mean(col, ground, n_ground))
        arrays.append(("photo", np.clip(photo * 255, 0, 255).astype(np.uint8).reshape(ny, nx, 3)))
    if full.has("intensity"):
        m = mean(full.channels["intensity"], ground, n_ground)
        u8, lo, hi = service._stretch_u8(m[n_ground > 0])
        out = np.zeros(cells, dtype=np.uint8)
        out[n_ground > 0] = u8
        arrays.append(("intensity", out.reshape(ny, nx)))
        header["intensity_range"] = [lo, hi]
    arrays += [
        ("veg_height", height(veg)),
        ("object_height", height(obj)),
        ("density", np.minimum(n_all, 65535).astype(np.uint16).reshape(ny, nx)),
        ("ground_density", np.minimum(n_ground, 65535).astype(np.uint16).reshape(ny, nx)),
    ]
    result = (header, arrays)
    with _grid_lock:
        for k in [k for k in _raster_cache if k[0] == site_id and k[1] == project_id]:
            del _raster_cache[k]
        _raster_cache[key] = result
    return result
