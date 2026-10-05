"""Multi-channel point cloud model — the foundational survey data structure.

Phase 0 uses the geometry channels (x, y, z) plus whatever optional metadata
channels a source provides. Real survey lidar (a drone) supplies extra per-point
channels (intensity, echo return info, GPS time, classification, scan angle);
phone LiDAR supplies only x/y/z. Downstream code MUST treat optional channels
as absent-safe via :meth:`PointCloud.has`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

import numpy as np

# Canonical optional channel names this app understands. Keeping them as one
# canonical list future-proofs the schema for real drone lidar (see PROFESSOR_QUESTIONS.md).
KNOWN_CHANNELS: tuple = (
    "intensity",            # reflectivity (real lidar; None from phone)
    "return_number",        # echo index within a pulse
    "number_of_returns",    # total echoes for the pulse
    "gps_time",             # per-point timestamp
    "classification",       # ground / vegetation / building
    "scan_angle",           # off-nadir angle
)


@dataclass
class PointCloud:
    """A collection of 3D points with optional per-point channels.

    Attributes
    ----------
    points:
        float array shape (N, 3); columns (x, y, z) in project-local metres.
    channels:
        mapping of channel name -> float array shape (N,). A channel that is
        absent or all-NaN means "unknown for this source".
    """
    points: np.ndarray
    channels: Dict[str, np.ndarray] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.points.ndim != 2 or self.points.shape[1] != 3:
            raise ValueError("points must be an (N, 3) array of (x, y, z).")

    @property
    def size(self) -> int:
        return int(self.points.shape[0])

    @property
    def x(self) -> np.ndarray:
        return self.points[:, 0]

    @property
    def y(self) -> np.ndarray:
        return self.points[:, 1]

    @property
    def z(self) -> np.ndarray:
        return self.points[:, 2]

    def has(self, name: str) -> bool:
        """True if a channel is present and carries real values."""
        if name not in self.channels or self.channels[name] is None:
            return False
        arr = self.channels[name]
        return bool(arr.size) and not bool(np.isnan(arr).all())

    def add_channel(self, name: str, values: np.ndarray) -> None:
        values = np.asarray(values, dtype=float)
        if values.shape[0] != self.size:
            raise ValueError(f"channel '{name}' length must match point count")
        self.channels[name] = values

    def bounds(self) -> np.ndarray:
        """(xmin, ymin, xmax, ymax) in project-local metres."""
        return np.array(
            [
                self.points[:, 0].min(),
                self.points[:, 1].min(),
                self.points[:, 0].max(),
                self.points[:, 1].max(),
            ]
        )

    def crop(self, xmin: float, ymin: float, xmax: float, ymax: float) -> "PointCloud":
        mask = (
            (self.x >= xmin)
            & (self.x <= xmax)
            & (self.y >= ymin)
            & (self.y <= ymax)
        )
        pts = self.points[mask]
        ch = {k: v[mask] for k, v in self.channels.items()} if self.channels else {}
        return PointCloud(pts, ch)

    def mask(self, keep: np.ndarray) -> "PointCloud":
        keep = np.asarray(keep, dtype=bool)
        pts = self.points[keep]
        ch = {k: v[keep] for k, v in self.channels.items()} if self.channels else {}
        return PointCloud(pts, ch)
