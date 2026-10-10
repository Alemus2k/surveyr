"""Ground control / check points and scan accuracy checks.

A control set is a surveyor's list of measured points (ID, northing, easting,
elevation, description) — typically a PNEZD CSV from a total station or GNSS
rover. It is stored in metres as ``<id>.control.json`` beside the scans.

Checking a scan against a control set compares each point's surveyed
elevation with the scan's ground there (a plane fitted to the nearby LiDAR
points), and summarises the differences the way survey QA reports do: mean
(bias), standard deviation, RMSE and a 95 % figure (1.96 x RMSE, assuming the
bias has been removed). Only vertical accuracy is checked: horizontal checks
need targets that are visible in the point cloud.
"""
from __future__ import annotations

import csv
import json
import os
import re
import threading
from typing import Dict, List, Literal, Optional

import numpy as np
from pydantic import BaseModel, Field
from scipy.spatial import cKDTree

from . import clean, service
from .scan_settings import UNIT_TO_M

SUFFIX = ".control.json"
Order = Literal["PNEZD", "PENZD", "NEZ", "ENZ"]
MIN_POINTS = 3
SEARCH_RADII_M = (0.5, 1.0, 2.0)  # widen until enough scan points surround the check point
MIN_NEIGHBOURS = 6
Z95 = 1.96  # NSSDA: 95 % confidence for a normally distributed, unbiased error

# column names surveyors' exports use, mapped to our fields
_HEADER_NAMES = {
    "p": "id", "pt": "id", "point": "id", "pnt": "id", "name": "id", "id": "id", "number": "id", "pointid": "id",
    "n": "n", "north": "n", "northing": "n", "y": "n",
    "e": "e", "east": "e", "easting": "e", "x": "e",
    "z": "z", "elev": "z", "elevation": "z", "height": "z", "h": "z",
    "d": "desc", "desc": "desc", "description": "desc", "code": "desc", "note": "desc",
}
_ORDERS = {"PNEZD": ["id", "n", "e", "z", "desc"], "PENZD": ["id", "e", "n", "z", "desc"],
           "NEZ": ["n", "e", "z"], "ENZ": ["e", "n", "z"]}


class ControlInvalid(ValueError):
    """The file can't be read as control points."""


class ControlPoint(BaseModel):
    id: str = Field(max_length=40)
    e: float
    n: float
    z: float
    desc: str = Field("", max_length=80)


class ControlSet(BaseModel):
    version: Literal[1] = 1
    name: str = Field(min_length=1, max_length=80)
    source_unit: str = "m"  # the CSV's unit; points below are in metres
    points: List[ControlPoint]


# ------------------------------------------------------------------ parsing

def _number(s: str) -> Optional[float]:
    try:
        v = float(s.strip())
    except ValueError:
        return None
    return v if np.isfinite(v) else None


def parse_points(text: str, unit: str = "m", order: Order = "PNEZD") -> List[ControlPoint]:
    """Read control points from CSV / whitespace-delimited text.

    A header row (``Point,Northing,Easting,Elevation,Description`` or similar)
    sets the columns; without one, ``order`` does. Rows that aren't points
    (comments, blank lines, a stray title) are skipped.
    """
    if unit not in UNIT_TO_M:
        raise ControlInvalid(f"unknown unit '{unit}'")
    scale = UNIT_TO_M[unit]
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        raise ControlInvalid("the file is empty")
    sample = "\n".join(lines[:20])
    if "," in sample:
        rows = list(csv.reader(lines))
    elif "\t" in sample or ";" in sample:
        rows = list(csv.reader(lines, delimiter="\t" if "\t" in sample else ";"))
    else:
        rows = [ln.split() for ln in lines]

    columns = _ORDERS[order]
    first = [c.strip().lower().replace(" ", "").replace("_", "") for c in rows[0]]
    mapped = [_HEADER_NAMES.get(c) for c in first]
    if sum(m in ("n", "e", "z") for m in mapped) == 3:  # a recognisable header row
        columns = [m or "" for m in mapped]
        rows = rows[1:]

    points: List[ControlPoint] = []
    for k, row in enumerate(rows, 1):
        vals = dict(zip(columns, row))
        coords = {c: _number(vals.get(c, "")) for c in ("n", "e", "z")}
        if any(v is None for v in coords.values()):
            continue  # not a point row
        pid = (vals.get("id") or str(k)).strip()[:40] or str(k)
        points.append(ControlPoint(id=pid, e=coords["e"] * scale, n=coords["n"] * scale, z=coords["z"] * scale,
                                   desc=(vals.get("desc") or "").strip()[:80]))
    if len(points) < MIN_POINTS:
        raise ControlInvalid(f"found {len(points)} usable points; a control set needs at least {MIN_POINTS}")
    return points


# ------------------------------------------------------------------ storage

def _path(control_id: str) -> str:
    return os.path.join(service.DATA_DIR, control_id + SUFFIX)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "_", name.lower()).strip("_-")[:60] or "control"


def list_sets() -> List[dict]:
    out = []
    for fname in sorted(os.listdir(service.DATA_DIR)):
        if not fname.endswith(SUFFIX):
            continue
        cid = fname[: -len(SUFFIX)]
        try:
            s = load(cid)
        except (OSError, ValueError):
            continue  # damaged file: leave it out
        out.append({"id": cid, "name": s.name, "count": len(s.points), "source_unit": s.source_unit})
    return out


def load(control_id: str) -> ControlSet:
    path = _path(control_id)
    if not os.path.exists(path):
        raise service.ProjectNotFound(control_id)
    with open(path) as f:
        return ControlSet.model_validate(json.load(f))


def create(name: str, text: str, unit: str, order: Order) -> dict:
    cs = ControlSet(name=name.strip() or "Control", source_unit=unit, points=parse_points(text, unit, order))
    base = _slug(cs.name)
    cid, n = base, 2
    while os.path.exists(_path(cid)):
        cid, n = f"{base}_{n}", n + 1
    tmp = _path(cid) + ".tmp"
    with open(tmp, "w") as f:
        f.write(cs.model_dump_json(indent=2))
    os.replace(tmp, _path(cid))
    return {"id": cid, "name": cs.name, "count": len(cs.points), "source_unit": unit}


def delete(control_id: str) -> None:
    from . import storage

    path = _path(control_id)
    if not os.path.exists(path):
        raise service.ProjectNotFound(control_id)
    storage.move_to_trash(path, service.TRASH_DIR)


# ------------------------------------------------------------------ checking

_cache: Dict[tuple, dict] = {}
_lock = threading.Lock()


def _ground_at(tree: cKDTree, pts: np.ndarray, e: float, n: float) -> Optional[tuple]:
    """Scan ground elevation at (e, n): a least-squares plane through nearby points."""
    for r in SEARCH_RADII_M:
        idx = tree.query_ball_point([e, n], r)
        if len(idx) >= MIN_NEIGHBOURS:
            near = pts[idx]
            dx, dy = near[:, 0] - e, near[:, 1] - n
            a = np.column_stack([np.ones(len(near)), dx, dy])
            coef, *_ = np.linalg.lstsq(a, near[:, 2], rcond=None)
            resid = near[:, 2] - a @ coef
            return float(coef[0]), r, len(idx), float(np.std(resid))
    return None


def summarise(dz: np.ndarray) -> dict:
    """Vertical accuracy statistics for scan-minus-control differences (metres)."""
    if len(dz) == 0:
        return {"n": 0, "mean": None, "std": None, "rmse": None, "max_abs": None, "ci95": None}
    rmse = float(np.sqrt(np.mean(dz ** 2)))
    return {
        "n": int(len(dz)),
        "mean": float(np.mean(dz)),
        "std": float(np.std(dz, ddof=1)) if len(dz) > 1 else 0.0,
        "rmse": rmse,
        "max_abs": float(np.max(np.abs(dz))),
        "ci95": Z95 * rmse,
    }


def check(project_id: str, control_id: str) -> dict:
    """Compare a scan's ground with every control point. Cached until either changes."""
    from .sites import _member_stamp  # file + settings stamps

    stamp = (_member_stamp(project_id), control_id, os.path.getmtime(_path(control_id)) if os.path.exists(_path(control_id)) else 0)
    with _lock:
        if stamp in _cache:
            return _cache[stamp]
    cs = load(control_id)
    cloud, _ = service._load_cloud(project_id)
    pts = clean.remove_z_outliers(cloud).points
    tree = cKDTree(pts[:, :2])
    rows, dz = [], []
    for p in cs.points:
        hit = _ground_at(tree, pts, p.e, p.n)
        if hit is None:
            rows.append({**p.model_dump(), "scan_z": None, "dz": None, "radius_m": None, "neighbours": 0, "spread_m": None})
            continue
        z, r, k, spread = hit
        rows.append({**p.model_dump(), "scan_z": z, "dz": z - p.z, "radius_m": r, "neighbours": k, "spread_m": spread})
        dz.append(z - p.z)
    result = {"project_id": project_id, "control_id": control_id, "control_name": cs.name,
              "points": rows, "stats": summarise(np.array(dz))}
    with _lock:
        _cache[stamp] = result
    return result
