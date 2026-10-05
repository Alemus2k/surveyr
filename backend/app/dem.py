"""Rasterization: convert an unstructured point cloud into a regular grid (DEM).

A Digital Elevation Model is a 2-D array where each cell holds a representative
elevation. Everything downstream (slope, curvature, cut/fill) is a cheap numpy
array operation once we have this grid. ``dem`` values are project-local metres.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from scipy import ndimage
from scipy.interpolate import griddata

from .pcd import PointCloud


def rasterize(
    cloud: PointCloud, cell_size: float, bounds: Optional[tuple] = None
) -> dict:
    """Bin points into ``cell_size`` cells and average elevation per cell.

    Empty cells are left ``np.nan`` (with a count of 0 in ``density``).
    Returns a dict of numpy arrays / metadata consumed by the rest of the app.
    """
    pts = cloud.points
    if bounds is None:
        x0, y0, x1, y1 = cloud.bounds()
    else:
        x0, y0, x1, y1 = bounds
    nx = max(1, int(np.ceil((x1 - x0) / cell_size)))
    ny = max(1, int(np.ceil((y1 - y0) / cell_size)))

    ix = np.floor((pts[:, 0] - x0) / cell_size).astype(np.int64)
    iy = np.floor((pts[:, 1] - y0) / cell_size).astype(np.int64)
    ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
    ix, iy, z = ix[ok], iy[ok], pts[ok, 2]

    zsum = np.zeros((ny, nx))
    cnt = np.zeros((ny, nx))
    np.add.at(zsum, (iy, ix), z)
    np.add.at(cnt, (iy, ix), 1)
    zc = np.where(cnt > 0, zsum / np.maximum(cnt, 1), np.nan)

    xs = x0 + (np.arange(nx) + 0.5) * cell_size
    ys = y0 + (np.arange(ny) + 0.5) * cell_size
    return {
        "z": zc,
        "density": cnt,
        "x": xs,
        "y": ys,
        "cell_size": cell_size,
        "bounds": (x0, y0, x1, y1),
    }


def fill_holes(dem: dict) -> np.ndarray:
    """Interpolate over empty cells so the grid has no NaN (smooth data).

    Uses linear interpolation; falls back to nearest for cells still missing.
    """
    z = dem["z"]
    if not np.isnan(z).any():
        return z
    xs, ys = dem["x"], dem["y"]
    mesh_x, mesh_y = np.meshgrid(xs, ys)  # (ny, nx), same layout as z
    valid = ~np.isnan(z)
    source_pts = np.column_stack([mesh_x[valid].ravel(), mesh_y[valid].ravel()])
    source_vals = z[valid].ravel()
    target_pts = np.column_stack([mesh_x.ravel(), mesh_y.ravel()])
    filled = griddata(source_pts, source_vals, target_pts, method="linear")
    if np.isnan(filled).any():
        nearest = griddata(source_pts, source_vals, target_pts, method="nearest")
        filled = np.where(np.isnan(filled), nearest, filled)
    return filled.reshape(z.shape)


def smooth(z: np.ndarray, sigma: float = 1.0) -> np.ndarray:
    """Gaussian smoothing of the DEM. Sigma is in cells."""
    return ndimage.gaussian_filter(z, sigma=sigma)


def coverage_mask(dem: dict, min_points_per_cell: int = 0) -> np.ndarray:
    """Boolean mask of well-covered cells (point density above a threshold).

    Drives the 'coverage / should-we-refly-this-area' view from the fusion phase.
    """
    return dem["density"] >= min_points_per_cell


def scanned_mask(dem: dict) -> np.ndarray:
    """Cells that are genuinely part of the scan, for drawing surfaces.

    A morphological closing fills single-cell pinholes between scanned cells
    but doesn't reach out into areas nobody scanned (unlike ``fill_holes``,
    which interpolates everywhere so analytics have a complete grid).
    """
    valid = dem["density"] > 0
    block = np.ones((3, 3), dtype=bool)
    grown = ndimage.binary_dilation(valid, structure=block)
    # border_value=1: the grid edge must not eat into scanned cells on erosion
    closed = ndimage.binary_erosion(grown, structure=block, border_value=1)
    return closed | valid
