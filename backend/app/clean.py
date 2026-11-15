"""Cleaning: gross outlier removal, and ground/non-ground segmentation.

A robust elevation-outlier filter using median/median-absolute-deviation so a
handful of bad points never skew the DEM. Ground segmentation lives in
``app.ground``; ``classify_ground`` here is a PointCloud-shaped entry point.
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
    """Ground vs. non-ground for a cloud (True = ground): see ``app.ground``."""
    from . import ground

    return ground.classify_ground(cloud.points, cloud.channels)
