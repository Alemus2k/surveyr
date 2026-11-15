"""Site progress quantities computed in the engine, for ``surveyr-progress.json``.

A NumPy mirror of the definitions in ``frontend/src/site/progress.ts`` and
``finishedGrade`` in ``frontend/src/site/specs.ts`` — keep them in step:

- Cells: a zone owns the shared-grid cells whose centre is inside its polygon.
- Finished grade: the design surface, with each zone's grade spec applied
  inside its outline (flat ``target_elevation_m``, else design +
  ``design_offset_m``; later zones win where outlines overlap).
- Remaining cut / fill: prismatic volume of the flight above / below finished
  grade over cells measured in both; differences within ``tolerance_m`` are 0.
- Cut / fill since the previous flight: ground that went down / up, ignoring
  changes within ``change_threshold_m``.
- % complete: 100 × (1 − remaining / remaining at the first flight), clamped to
  0–100; null when the first flight had less than 1 m³ to do.
- Stockpile volume: what was placed above the first flight's ground (change
  threshold applies).
"""
from __future__ import annotations

from typing import List, Optional

import numpy as np

from .export_formats import polygon_mask

MIN_BASELINE_M3 = 1.0  # progress.ts: less than this to move and there's nothing to track


def finished_grade(design: Optional[np.ndarray], zones, masks: List[np.ndarray], shape) -> Optional[np.ndarray]:
    specified = [(z, m) for z, m in zip(zones, masks) if z.target_elevation_m is not None or z.design_offset_m]
    if not specified:
        return design
    out = design.copy() if design is not None else np.full(shape, np.nan)
    for z, m in specified:
        if z.target_elevation_m is not None:
            out[m] = z.target_elevation_m
        elif design is not None:
            out[m] = design[m] + z.design_offset_m
    return out


def cut_fill(a: np.ndarray, b: np.ndarray, mask: np.ndarray, cell_area: float, deadband: float) -> dict:
    """Volume of ``a`` above (cut) / below (fill) ``b`` over ``mask``; |difference| ≤ deadband is zero."""
    d = (a - b)[mask]
    d = d[np.isfinite(d)]
    cut = float(d[d > deadband].sum()) * cell_area
    fill = float(-d[d < -deadband].sum()) * cell_area
    return {"cut": cut, "fill": fill, "area": len(d) * cell_area}


def on_grade_pct(scan: np.ndarray, grade: np.ndarray, mask: np.ndarray, tol: float) -> Optional[float]:
    d = (scan - grade)[mask]
    d = d[np.isfinite(d)]
    return float(100.0 * np.count_nonzero(np.abs(d) <= tol) / len(d)) if len(d) else None


def _r(v: Optional[float], nd: int = 3) -> Optional[float]:
    return None if v is None else round(float(v), nd)


def zone_series(zone, mask: np.ndarray, scans: List[np.ndarray], dates: List[str], ids: List[str],
                grade: Optional[np.ndarray], cell: float, tolerance: float, threshold: float) -> dict:
    area = cell * cell
    grading = zone.kind == "grading" and grade is not None
    baseline = 0.0
    flights = []
    for k, scan in enumerate(scans):
        vs = cut_fill(scan, grade, mask, area, tolerance) if grading else None
        change = cut_fill(scans[k - 1], scan, mask, area, threshold) if k > 0 else None
        pile = cut_fill(scans[0], scan, mask, area, threshold) if zone.kind == "stockpile" and k > 0 else None
        remaining = vs["cut"] + vs["fill"] if vs else 0.0
        if k == 0:
            baseline = remaining
        pct = None
        if grading and baseline >= MIN_BASELINE_M3:
            pct = min(100.0, max(0.0, 100.0 * (1.0 - remaining / baseline)))
        flights.append({
            "project_id": ids[k],
            "date": dates[k],
            "measured_area_m2": _r(vs["area"] if vs else change["area"] if change else 0.0),
            "remaining_cut_m3": _r(vs["cut"]) if vs else None,
            "remaining_fill_m3": _r(vs["fill"]) if vs else None,
            "on_grade_pct": _r(on_grade_pct(scan, grade, mask, tolerance), 2) if grading else None,
            "pct_complete": _r(pct, 2),
            "stockpile_m3": _r(pile["fill"] if pile else 0.0) if zone.kind == "stockpile" else None,
            "cut_since_previous_m3": _r(change["cut"]) if change else None,
            "fill_since_previous_m3": _r(change["fill"]) if change else None,
        })
    return {"zone_id": zone.id, "cells": int(mask.sum()), "graded_against_design": grading,
            "baseline_m3": _r(baseline) if grading else None, "flights": flights}


def pay_app_check(pa, zones, masks_by_id: dict, scans: List[np.ndarray], dates: List[str], cell: float,
                  threshold: float, overbill_pct: float, shape) -> dict:
    """Mirror of ``checkPayApp``: the change in the pay app's zone between the flight
    on (or last before) its period end and the flight before that."""
    k = -1
    for i, d in enumerate(dates):
        if d <= pa.date:  # ISO dates compare as strings
            k = i
    base = {"id": pa.id, "from_date": None, "to_date": None, "measured_m3": None, "difference_m3": None,
            "difference_pct": None, "flagged": False}
    if k < 1:
        return base
    mask = masks_by_id.get(pa.zone_id) if pa.zone_id else None
    if mask is None:
        mask = np.ones(shape, dtype=bool)
    ch = cut_fill(scans[k - 1], scans[k], mask, cell * cell, threshold)
    measured = ch["cut"] if pa.kind == "cut" else ch["fill"]
    diff = pa.claimed_m3 - measured
    diff_pct = 100.0 * diff / measured if measured > 0 else None
    flagged = pa.claimed_m3 > 0 if diff_pct is None else diff_pct > overbill_pct
    return {**base, "from_date": dates[k - 1], "to_date": dates[k], "measured_m3": _r(measured),
            "difference_m3": _r(diff), "difference_pct": _r(diff_pct, 2), "flagged": bool(flagged)}


def zone_masks(zones, nx: int, ny: int, x0: float, y0: float, cell: float) -> List[np.ndarray]:
    return [polygon_mask(z.polygon, nx, ny, x0, y0, cell) for z in zones]
