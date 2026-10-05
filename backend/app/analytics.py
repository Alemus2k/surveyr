"""High-level terrain analytics built on the DEM + derivative surfaces.

These are the numbers the dashboard reports: percent-flat/level, relief, area,
elevation & slope histograms, cut/fill volume to a target grade, a buildable
mask, and contour isolines.
"""
from __future__ import annotations

from typing import Iterable, List

import numpy as np

# Default slope bins (degrees) used for the slope histogram. "Flat" is whatever
# the user sets via the threshold slider; these bins just give a full picture.
SLOPE_BINS = (0.0, 2.0, 5.0, 10.0, 20.0, 45.0, 90.0)


def stats(z: np.ndarray) -> dict:
    """Elevation summary over valid (non-NaN) cells."""
    zf = z[np.isfinite(z)]
    if zf.size == 0:
        return {"min": None, "max": None, "mean": None, "std": None, "n": 0}
    return {
        "min": float(np.min(zf)),
        "max": float(np.max(zf)),
        "mean": float(np.mean(zf)),
        "std": float(np.std(zf)),
        "n": int(zf.size),
    }


def relief(z: np.ndarray) -> float:
    """Total rise from the lowest to the highest cell (metres)."""
    zf = z[np.isfinite(z)]
    if zf.size == 0:
        return 0.0
    return float(zf.max() - zf.min())


def area_m2(dem: dict) -> float:
    """Horizontal area of the valid (non-NaN) cells, in square metres."""
    return float(np.count_nonzero(np.isfinite(dem["z"])) * dem["cell_size"] ** 2)


def percent_flat(slope: np.ndarray, threshold_deg: float) -> float:
    """Percent of valid cells whose slope is at or below ``threshold_deg``."""
    valid = np.isfinite(slope)
    if not valid.any():
        return 0.0
    return 100.0 * float(np.count_nonzero(valid & (slope <= threshold_deg))) / valid.sum()


def slope_histogram(slope: np.ndarray, bins: Iterable = SLOPE_BINS) -> dict:
    """Counts of cells in each slope bin (degrees), plus the edges."""
    bins = np.asarray(bins, dtype=float)
    valid = slope[np.isfinite(slope)]
    counts, edges = np.histogram(valid, bins=bins)
    return {"edges": edges.tolist(), "counts": counts.tolist()}


def elevation_histogram(z: np.ndarray, bins: int = 40) -> dict:
    """Elevation histogram (counts + bin edges, metres)."""
    valid = z[np.isfinite(z)]
    if valid.size == 0:
        return {"counts": [], "edges": []}
    counts, edges = np.histogram(valid, bins=bins)
    return {"counts": counts.tolist(), "edges": edges.tolist()}


def cut_fill(z: np.ndarray, cell_size: float, target_elev: float) -> dict:
    """Cut/fill volume (cubic metres) needed to grade the site to ``target_elev``.

        cut   - earth to remove (cells above target)
        fill  - earth to import (cells below target)
        net   - fill - cut; positive net means importing dirt.

    Volumes use simple prismatic cell-area; professional grading uses a TIN or
    more rigorous method — flagged for the GIS professor (see PROFESSOR_QUESTIONS.md).
    """
    area = cell_size * cell_size
    above = z - target_elev
    cut = float(np.nansum(np.maximum(above, 0.0)) * area)
    fill = float(np.nansum(np.maximum(-above, 0.0)) * area)
    return {"cut": cut, "fill": fill, "net": fill - cut}


def buildable_mask(
    slope: np.ndarray,
    curvature: np.ndarray,
    slope_thresh_deg: float,
    curvature_thresh: float,
) -> np.ndarray:
    """Composite 'buildable' cell mask: gentle slope AND low curvature."""
    ok_slope = np.isfinite(slope) & (slope <= slope_thresh_deg)
    ok_curv = np.isfinite(curvature) & (curvature <= curvature_thresh)
    return ok_slope & ok_curv


def buildable_percent(stats_mask: np.ndarray) -> float:
    valid = np.isfinite(stats_mask)  # treat bools as valid
    if not valid.any():
        return 0.0
    return 100.0 * float(np.count_nonzero(stats_mask)) / stats_mask.size


def contour_lines(z: np.ndarray, x: np.ndarray, y: np.ndarray, levels: List[float]) -> List[dict]:
    """Extract contour isolines (list of {level, line}) using matplotlib.

    ``x``/``y`` are the 1-D cell-centre coordinates of the grid.
    """
    import matplotlib

    matplotlib.use("Agg")  # headless, no display needed
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots()
    cs = ax.contour(x, y, z, levels=levels)
    result = []
    for level, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if seg.size == 0:
                continue
            result.append({"level": float(level), "line": seg.tolist()})
    plt.close(fig)
    return result