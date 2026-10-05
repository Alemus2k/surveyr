"""Cleaning: gross outlier removal and a stub for ground/non-ground segmentation.

Phase 0 keeps cleaning light — a robust elevation-outlier filter using median/
median-absolute-deviation so a handful of bad points never skew the DEM. Real
ground/non-ground segmentation (needs the classification channel or echo
returns from real lidar) is a later-phase task and is stubbed here.
"""
from __future__ import annotations

import numpy as np

from .pcd import PointCloud

MAD_SCALE = 1.4826  # converts MAD -> Gaussian sigma


def remove_z_outliers(cloud: PointCloud, z_sigma: float = 8.0) -> PointCloud:
    """Drop points whose elevation is more than ``z_sigma`` robust sigmas from
    the median. Robust sigma = MAD * 1.4826 (falls back to std if MAD is zero).
    """
    z = cloud.z
    med = float(np.median(z))
    mad = float(np.median(np.abs(z - med)))
    scale = mad * MAD_SCALE if mad > 0 else float(np.std(z))
    if scale <= 0:
        return cloud
    keep = np.abs(z - med) <= z_sigma * scale
    return cloud.mask(keep)


def classify_ground(cloud: PointCloud) -> np.ndarray:
    """Placeholder for ground vs. non-ground classification.

    Returns a boolean array (True = ground point). Phase 0 returns True for all
    points; a real implementation will use the ``classification`` channel or
    multi-return geometry. This keeps the API stable so later phases swap in a
    real method without touching callers.
    """
    return np.ones(cloud.size, dtype=bool)