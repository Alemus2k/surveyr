"""DEM hole filling on non-square grids (phone scans are rarely square)."""
from __future__ import annotations

import numpy as np

from app import dem


def test_fill_holes_on_rectangular_grid_interpolates_each_cell():
    xs = np.arange(6) + 0.5  # nx = 6
    ys = np.arange(4) + 0.5  # ny = 4
    gx, gy = np.meshgrid(xs, ys)
    z = gx + 10 * gy  # plane: distinguishes x from y
    holed = z.copy()
    holed[1, 2] = np.nan
    holed[2, 4] = np.nan

    filled = dem.fill_holes({"z": holed, "x": xs, "y": ys})

    assert filled.shape == z.shape
    np.testing.assert_allclose(filled, z)
