"""Per-scan manual adjustments: source units, which axis is up, ground-only,
and an elevation correction (e.g. from checking the scan against control).

Stored as ``<project>.settings.json`` beside the scan (the scan file itself is
never modified) and applied every time the scan is loaded, so all analytics,
points, surfaces and comparisons see converted, Z-up, metre coordinates.

Also detects a scan's units: authoritatively from a LAS/LAZ coordinate system,
or as a size-based *suggestion* for unit-less PLY/XYZ files.
"""
from __future__ import annotations

import json
import os
from typing import Literal, Optional

import numpy as np
from pydantic import BaseModel, Field

from . import service

SUFFIX = ".settings.json"
Unit = Literal["m", "cm", "mm", "ft", "us_ft", "in"]
UNIT_TO_M = {"m": 1.0, "cm": 0.01, "mm": 0.001, "ft": 0.3048, "us_ft": 1200 / 3937, "in": 0.0254}
UNIT_NAMES = {
    "m": "metres",
    "cm": "centimetres",
    "mm": "millimetres",
    "ft": "feet",
    "us_ft": "US survey feet",
    "in": "inches",
}
# pyproj axis unit names → our unit codes
_CRS_UNITS = {
    "metre": "m",
    "meter": "m",
    "us survey foot": "us_ft",
    "foot_us": "us_ft",
    "foot": "ft",
    "international foot": "ft",
}
# A unit-less file this wide (in its own units) is very unlikely to be metres
# from a phone/handheld scanner; flag it as probably millimetres.
SUSPICIOUS_EXTENT = 2000.0
GROUND_CLASS = 2  # ASPRS LAS classification code for ground


class ScanSettings(BaseModel):
    version: Literal[1] = 1
    unit: Unit = "m"
    up_axis: Literal["z", "y"] = "z"
    ground_only: bool = True
    z_offset_m: float = Field(0.0, ge=-100, le=100)  # added to every elevation, after unit conversion


def _path(project_id: str) -> str:
    return os.path.join(service.DATA_DIR, project_id + SUFFIX)


def _scan_info(project_id: str) -> dict:
    info = service._resolve(project_id)
    if info["type"] in service.GROUP_TYPES:
        raise service.NotAnalyzable(project_id)
    return info


def load(project_id: str) -> ScanSettings:
    _scan_info(project_id)
    try:
        with open(_path(project_id)) as f:
            return ScanSettings.model_validate(json.load(f))
    except FileNotFoundError:
        return ScanSettings()
    except (OSError, ValueError):
        return ScanSettings()  # damaged settings file: fall back to defaults


def save(project_id: str, settings: ScanSettings) -> ScanSettings:
    _scan_info(project_id)
    path = _path(project_id)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        f.write(settings.model_dump_json(indent=2))
    os.replace(tmp, path)
    service.invalidate(project_id)
    return settings


def apply(points: np.ndarray, settings: ScanSettings) -> np.ndarray:
    """Return a converted copy: Y-up → Z-up (right-handed), scaled to metres, then
    shifted vertically by the elevation correction."""
    pts = np.asarray(points, dtype=float)
    if settings.up_axis == "y":
        pts = np.column_stack([pts[:, 0], -pts[:, 2], pts[:, 1]])
    pts = pts * UNIT_TO_M[settings.unit]
    if settings.z_offset_m:
        pts[:, 2] += settings.z_offset_m
    return pts


def ground_mask(classification: Optional[np.ndarray]) -> Optional[np.ndarray]:
    """Boolean mask of ground points, or None if the scan isn't ground-classified."""
    if classification is None:
        return None
    is_ground = np.asarray(classification) == GROUND_CLASS
    return is_ground if is_ground.any() else None


# ------------------------------------------------------------------ detection

def crs_info(path: str) -> Optional[dict]:
    """Name, EPSG and horizontal unit of a LAS/LAZ file's coordinate system, if any."""
    if not path.lower().endswith((".las", ".laz")):
        return None
    try:
        import laspy

        with laspy.open(path) as f:
            crs = f.header.parse_crs()
    except Exception:  # missing/unparseable CRS records: treat as "no CRS"
        return None
    if crs is None:
        return None
    unit_name = (crs.axis_info[0].unit_name if crs.axis_info else "").lower()
    return {"name": crs.name, "epsg": crs.to_epsg(), "unit": _CRS_UNITS.get(unit_name)}


def _raw_extent(path: str) -> float:
    from . import io

    pts = io.load_point_cloud(path).points
    return float(np.ptp(pts[:, :2], axis=0).max()) if len(pts) else 0.0


def detect(project_id: str) -> dict:
    """What units the file appears to be in, and how sure we are.

    ``source`` is "crs" (from the file's coordinate system: trustworthy),
    "size" (a heuristic suggestion for unit-less files) or None.
    """
    info = _scan_info(project_id)
    first = service.FUSED_SOURCES[0] if info["type"] == "fused" else info["source"]
    path = os.path.join(service.DATA_DIR, first)
    crs = crs_info(path)
    if crs and crs["unit"]:
        return {
            "unit": crs["unit"],
            "source": "crs",
            "reason": f"Coordinate system {crs['name']} is in {UNIT_NAMES[crs['unit']]}.",
            "crs_name": crs["name"],
            "epsg": crs["epsg"],
        }
    base = {"crs_name": crs["name"] if crs else None, "epsg": crs["epsg"] if crs else None}
    extent = _raw_extent(path)
    if extent >= SUSPICIOUS_EXTENT and not path.lower().endswith((".las", ".laz")):
        return {
            **base,
            "unit": "mm",
            "source": "size",
            "reason": f"Read as metres this scan is {extent:,.0f} m across — it may be in millimetres.",
        }
    return {**base, "unit": None, "source": None, "reason": None}


def apply_detected_on_import(filename: str) -> dict:
    """After an import, adopt units stated by the file itself (never guesses)."""
    project_id = os.path.splitext(filename)[0]
    det = detect(project_id)
    if det["source"] == "crs" and det["unit"] and det["unit"] != "m":
        save(project_id, ScanSettings(unit=det["unit"]))
    return det
