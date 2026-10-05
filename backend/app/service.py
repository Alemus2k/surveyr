"""Analysis service: runs the pipeline + fusion and caches results per project.

Provides a stable interface for the FastAPI routes. Supports:
  - single-capture projects (a .xyz/.las/.ply point cloud)
  - a fused multi-pass project ("multiscan") that registers a revisit into a
    sub-map and reports coverage / revisited areas.

Results are cached so repeated API calls do not recompute the pipeline.
"""
from __future__ import annotations

import json
import os
import sys
import threading
from typing import Dict, List, Optional

import numpy as np

from . import analytics, clean, dem, fusion, io, storage, terrain
from .pcd import PointCloud

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
DEFAULT_CELL = 2.0  # metres per raster cell (survey-scale sites)
MIN_CELL = 0.01  # metres; finer than phone LiDAR noise is pointless
TARGET_CELLS_ACROSS = 100  # auto cell size aims for ~this many cells on the long side
MAX_CELLS_ACROSS = 400  # never build a grid wider than this (keeps big surveys responsive)
_NICE_CELLS = (0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0)
FUSED_PROJECT_ID = "multiscan"
FUSED_SOURCES = ("scan_a.las", "scan_b.las")
COMPARE_SUFFIX = ".compare.json"
_MAC_TRASH = os.path.expanduser("~/.Trash")
# macOS: deleted projects are moved into the Trash folder so a mistake can be
# undone. None (Windows/Linux) = the system recycle bin via send2trash.
TRASH_DIR: Optional[str] = _MAC_TRASH if sys.platform == "darwin" and os.path.isdir(_MAC_TRASH) else None


def discover_projects() -> Dict[str, dict]:
    """Register single-capture projects from point-cloud files + the fused demo.

    Demo projects are listed only while their files exist, so deleting them
    sticks.
    """
    found: Dict[str, dict] = {}
    for fname in sorted(os.listdir(DATA_DIR)):
        if fname.lower().endswith((".xyz", ".las", ".laz", ".ply")):
            pid = os.path.splitext(fname)[0]
            found[pid] = {"id": pid, "name": pid.replace("_", " ").title(),
                          "source": fname, "type": "single"}
    if "synthetic_topo" in found:
        v = found.pop("synthetic_topo")
        v["id"] = "synthetic"
        found["synthetic"] = v
    # the raw passes are shown only as the fused project
    for k in ("scan_a", "scan_b"):
        found.pop(k, None)
    for fname in sorted(os.listdir(DATA_DIR)):
        if fname.endswith(COMPARE_SUFFIX):
            pid = fname[: -len(COMPARE_SUFFIX)]
            found[pid] = {"id": pid, "name": _compare_name(fname, pid), "source": fname, "type": "compare"}
    if all(os.path.exists(os.path.join(DATA_DIR, f)) for f in FUSED_SOURCES):
        found[FUSED_PROJECT_ID] = {
            "id": FUSED_PROJECT_ID, "name": "Two-Pass Revisit", "type": "fused",
            "source": " + ".join(FUSED_SOURCES),
        }
    return found


def _compare_name(fname: str, fallback: str) -> str:
    """Display name stored inside a comparison file (tolerates a damaged file)."""
    try:
        with open(os.path.join(DATA_DIR, fname)) as f:
            name = json.load(f).get("name")
        return name if isinstance(name, str) and name else fallback
    except (OSError, ValueError):
        return fallback


class NotAnalyzable(ValueError):
    """The project is a comparison, which has no single terrain to analyse."""


SETTINGS_SUFFIX = ".settings.json"


def _project_files(info: dict) -> List[str]:
    """Every file belonging to a project (scan(s) plus its settings, if saved)."""
    if info["type"] == "compare":
        return [info["source"]]
    scans = list(FUSED_SOURCES) if info["type"] == "fused" else [info["source"]]
    return scans + [info["id"] + SETTINGS_SUFFIX]


def invalidate(project_id: str) -> None:
    """Forget cached analysis/points for a project (after its settings change)."""
    for cache in (_cache, _points_cache):
        for key in [k for k in cache if k.startswith(f"{project_id}@")]:
            del cache[key]


def delete_project(project_id: str) -> List[str]:
    """Move a project's scan file(s) to the Trash and forget cached results.

    Returns the filenames removed. Raises ProjectNotFound for unknown ids.
    """
    info = _resolve(project_id)
    removed = []
    with _lock:
        for fname in _project_files(info):
            path = os.path.join(DATA_DIR, fname)
            if os.path.exists(path):
                storage.move_to_trash(path, TRASH_DIR)
                removed.append(fname)
        invalidate(project_id)
    return removed


_cache: Dict[str, dict] = {}
_points_cache: Dict[str, tuple] = {}
_lock = threading.Lock()

DEFAULT_POINT_LIMIT = 200_000  # enough for a dense 3D view, ~2.4 MB on the wire


class ProjectNotFound(KeyError):
    pass


def _resolve(project_id: str) -> dict:
    registry = discover_projects()
    if project_id not in registry:
        raise ProjectNotFound(project_id)
    return registry[project_id]


def _path(project_id: str) -> str:
    info = _resolve(project_id)
    return os.path.join(DATA_DIR, info["source"])


def auto_cell_size(cloud: PointCloud) -> float:
    """Pick a tidy cell size giving ~TARGET_CELLS_ACROSS cells on the long side.

    Small phone scans get cm-scale cells; ordinary sites are capped at
    DEFAULT_CELL; only sites that would then exceed MAX_CELLS_ACROSS coarsen
    further, so large surveys stay responsive.
    """
    extent = float(np.ptp(cloud.points[:, :2], axis=0).max())
    wanted = min(extent / TARGET_CELLS_ACROSS, DEFAULT_CELL)
    wanted = max(wanted, extent / MAX_CELLS_ACROSS)
    for cell in _NICE_CELLS:
        if cell >= wanted:
            return max(cell, MIN_CELL)
    return _NICE_CELLS[-1]


def analyze(project_id: str, cell_size: Optional[float] = None) -> dict:
    """Run analytics (and fusion, if applicable) for ``project_id``. Cached.

    ``cell_size=None`` picks a size from the scan footprint (see auto_cell_size).
    """
    if _resolve(project_id)["type"] == "compare":
        raise NotAnalyzable(project_id)
    key = f"{project_id}@{cell_size or 'auto'}"
    with _lock:
        if key not in _cache:
            if project_id == FUSED_PROJECT_ID:
                _cache[key] = _compute_fused(cell_size or DEFAULT_CELL)
            else:
                _cache[key] = _compute_single(project_id, cell_size)
        return _cache[key]


def sample_points_with_origin(project_id: str, limit: int = DEFAULT_POINT_LIMIT) -> tuple:
    """Cleaned points for the 3D view, randomly thinned to ``limit``. Cached.

    Returns ``(origin, rel)``: a float64 origin (footprint centre) and an (N, 3)
    float32 array relative to it. Real LiDAR uses survey-grid coordinates in the
    millions of metres, where float32 alone would round to ~0.5 m.
    """
    key = f"{project_id}@{limit}"
    with _lock:
        if key not in _points_cache:
            cloud, _ = _load_cloud(project_id)
            pts = clean.remove_z_outliers(cloud).points
            if len(pts) > limit:
                idx = np.random.default_rng(0).choice(len(pts), size=limit, replace=False)
                pts = pts[np.sort(idx)]
            origin = (pts.min(axis=0) + pts.max(axis=0)) / 2 if len(pts) else np.zeros(3)
            rel = np.ascontiguousarray(pts[:, :3] - origin, dtype=np.float32)
            _points_cache[key] = (origin.astype(np.float64), rel)
        return _points_cache[key]


def _load_cloud(project_id: str):
    """A project's cloud with its manual adjustments applied.

    Returns ``(cloud, ground_only)``: points converted to metres and Z-up, and
    — when the user wants it and the scan is ground-classified — only ground
    points, with ``ground_only`` saying whether that filter was applied.
    """
    from . import scan_settings  # local: scan_settings imports this module

    if project_id == FUSED_PROJECT_ID:
        return PointCloud(_fuse_demo_passes()[0].fused_points()), False
    info = _resolve(project_id)
    if info["type"] == "compare":
        raise NotAnalyzable(project_id)
    settings = scan_settings.load(project_id)
    raw = io.load_point_cloud(os.path.join(DATA_DIR, info["source"]))
    cloud = PointCloud(scan_settings.apply(raw.points, settings), dict(raw.channels))
    ground = scan_settings.ground_mask(cloud.channels.get("classification")) if settings.ground_only else None
    if ground is not None:
        return cloud.mask(ground), True
    return cloud, False


def _fuse_demo_passes():
    from . import scan_settings

    settings = scan_settings.load(FUSED_PROJECT_ID)
    scan_a, scan_b = (
        PointCloud(scan_settings.apply(io.load_point_cloud(os.path.join(DATA_DIR, f)).points, settings))
        for f in FUSED_SOURCES
    )
    project = fusion.FusedProject(scan_a.points, first_epoch=0)
    setup = project.add_scan(scan_b.points, max_match_dist=1.5)
    return project, setup


def _compute_single(project_id: str, cell_size: Optional[float]) -> dict:
    info = _resolve(project_id)
    cloud, ground_only = _load_cloud(project_id)
    result = _build_analysis(cloud, cell_size or auto_cell_size(cloud), info)
    result["points"]["ground_only"] = ground_only
    return result


def _compute_fused(cell_size: float) -> dict:
    """Fuse the two demo passes, then run the pipeline on the combined cloud."""
    project, setup = _fuse_demo_passes()
    combined = PointCloud(project.fused_points())

    info = _resolve(FUSED_PROJECT_ID)
    result = _build_analysis(combined, cell_size, info)
    result["points"]["ground_only"] = False
    cov = project.coverage(cell_size)

    result["coverage"] = {
        "revisited_pct": cov["revisited_pct"],
        "covered_pct": cov["covered_pct"],
        "n_submaps": cov["n_submaps"],
    }
    result["registration"] = setup
    result["maps"]["coverage"] = {
        "data": cov["counts"], "min": 0, "max": cov["n_submaps"] or 1,
    }
    return result


def _build_analysis(cloud: PointCloud, cell_size: float, info: dict) -> dict:
    cleaned = clean.remove_z_outliers(cloud)
    d = dem.rasterize(cleaned, cell_size=cell_size)
    d["z"] = dem.smooth(dem.fill_holes(d), sigma=0.5)
    d["slope"] = terrain.slope_degrees(d["z"], cell_size)
    d["curv"] = terrain.curvature(d["z"], cell_size)
    d["rough"] = terrain.roughness(d["z"], cell_size, radius_cells=1)
    d["aspect"] = terrain.aspect_degrees(d["z"], cell_size)

    # Site metrics count only ground that was actually scanned. The filled grid
    # (d["z"]) still drives the maps and derivatives, but its interpolated
    # corners must not inflate area, cut/fill or the distributions.
    mask = dem.scanned_mask(d)
    z_site = np.where(mask, d["z"], np.nan)
    slope_site = np.where(mask, d["slope"], np.nan)

    elev_stats = analytics.stats(z_site)
    target = float(elev_stats["mean"]) if elev_stats["mean"] is not None else 0.0
    cf = analytics.cut_fill(z_site, cell_size, target)

    return {
        "project": dict(info),
        "grid": {
            "cell_size": cell_size,
            "bounds": list(d["bounds"]),
            "nx": int(d["z"].shape[1]),
            "ny": int(d["z"].shape[0]),
            "x": [float(v) for v in d["x"]],
            "y": [float(v) for v in d["y"]],
        },
        "points": {"captured": int(cloud.size), "kept": int(cleaned.size),
                   "outliers_removed": int(cloud.size - cleaned.size)},
        "dimensions": _dimensions(cleaned),
        "stats": elev_stats,
        "percent_flat": {
            str(th): float(analytics.percent_flat(slope_site, th))
            for th in (0.5, 1.0, 2.0, 3.0, 5.0, 10.0)
        },
        "relief_m": float(analytics.relief(z_site)),
        "area_m2": float(analytics.area_m2({"z": z_site, "cell_size": cell_size})),
        "cut_fill": {**cf, "target_elev_m": target},
        "histograms": {
            "elevation": analytics.elevation_histogram(z_site, bins=30),
            "slope": analytics.slope_histogram(slope_site),
        },
        "maps": {
            "elevation": {"data": _to_lists(d["z"]), "min": elev_stats["min"], "max": elev_stats["max"]},
            "slope": {"data": _to_lists(d["slope"])},
            "aspect": {"data": _to_lists(d["aspect"])},
            "curvature": {"data": _to_lists(d["curv"])},
            "roughness": {"data": _to_lists(d["rough"])},
            "mask": {"data": mask.astype(np.uint8).tolist()},
        },
    }


def _dimensions(cloud: PointCloud) -> dict:
    """Bounding size of the (cleaned) scan in metres: east–west, north–south, vertical."""
    if cloud.size == 0:
        return {"width_m": 0.0, "depth_m": 0.0, "height_m": 0.0}
    w, d, h = np.ptp(cloud.points, axis=0)
    return {"width_m": float(w), "depth_m": float(d), "height_m": float(h)}


def _to_lists(a: np.ndarray) -> list:
    return a.tolist()


def list_projects() -> list:
    return list(discover_projects().values())