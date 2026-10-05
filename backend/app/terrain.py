"""Terrain derivative surfaces computed from a DEM grid.

All functions operate on a 2-D elevation array ``z`` and the cell size in
metres. Array axes are (y, x): ``z[iy, ix]``. ``np.gradient(z, cell, cell)``
returns ``(dz/dy, dz/dx)``.

Terminology used throughout (see docs/METRICS_GLOSSARY.md):
  slope      - steepness in degrees (arctan of the gradient magnitude)
  aspect     - compass direction of steepest descent, degrees clockwise from north
  curvature  - total curvature (Frobenius norm of the elevation Hessian)
  roughness  - local standard deviation of elevation in a small window
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage


def _gradients(z: np.ndarray, cell_size: float) -> tuple:
    return np.gradient(z, cell_size, cell_size)  # (dz/dy, dz/dx)


def slope_degrees(z: np.ndarray, cell_size: float) -> np.ndarray:
    """Surface gradient magnitude as an angle in degrees [0, 90]."""
    dzdy, dzdx = _gradients(z, cell_size)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def aspect_degrees(z: np.ndarray, cell_size: float) -> np.ndarray:
    """Compass direction of steepest descent, degrees clockwise from north."""
    dzdy, dzdx = _gradients(z, cell_size)
    aspect = np.degrees(np.arctan2(-dzdy, -dzdx))  # radians -> degrees, N=0
    return aspect % 360.0


def curvature(z: np.ndarray, cell_size: float) -> np.ndarray:
    """Total curvature: Frobenius norm of the elevation Hessian.

    Captures both convex (ridge) and concave (depression) shape; helpful for
    water-ponding / drainage reasoning. Higher = more strongly shaped.
    """
    dzdy, dzdx = _gradients(z, cell_size)
    dzyy, dzxy = np.gradient(dzdy, cell_size, cell_size)
    dzyx, dzxx = np.gradient(dzdx, cell_size, cell_size)
    return np.sqrt(dzxx ** 2 + 2.0 * dzxy ** 2 + dzyy ** 2)


def roughness(z: np.ndarray, cell_size: float, radius_cells: int = 1) -> np.ndarray:
    """Local std of elevation within a square window of radius ``radius_cells``.

    Computed via uniform filters of z and z^2 for speed.
    """
    win = 2 * int(radius_cells) + 1
    mean = ndimage.uniform_filter(z, size=win)
    mean_sq = ndimage.uniform_filter(z ** 2, size=win)
    var = np.maximum(mean_sq - mean ** 2, 0.0)
    return np.sqrt(var)


def normal_vectors(z: np.ndarray, cell_size: float) -> np.ndarray:
    """Unit surface normals (shape [ny, nx, 3]) for each grid cell.

    Useful for rendering lighting and QA. Computed from the two first
    derivatives along x and y.
    """
    gx = np.gradient(z, cell_size, axis=1)
    gy = np.gradient(z, cell_size, axis=0)
    n = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
    norm = np.linalg.norm(n, axis=-1, keepdims=True)
    n = np.divide(n, norm, out=n, where=norm > 0)
    return n