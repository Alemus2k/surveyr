"""Generate a multi-pass capture used to exercise fusion + coverage.

Writes into data/:
  scan_a.las, scan_a.ply   - full-site pass (reference frame)
  scan_b.las, scan_b.ply   - a rehearsed sub-region, in its OWN local frame
                             (offset/rotated from reference to mimic a second,
                             slightly different viewpoint)
  scan_b_meta.json         - the known transform (for verifying registration)

The point-cloud pipeline (app.io) reads these; app.fusion aligns scan B to
scan A and should recognise it as a *revisit* (fuse, not new sub-map).

Usage:  ./.venv/bin/python scripts/make_multi_scan.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Optional

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # noqa: E402
DATA = os.path.join(BASE, "data")

sys.path.insert(0, BASE)  # allow `import app.io`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import make_synthetic_terrain as synth  # reuse the oracle landscape  # noqa: E402

from app.io import write_ply  # noqa: E402


N_SCAN_A = 200_000
N_SCAN_B = 60_000
NOISE = 0.03

# Known rigid transform taking reference coordinates into scan B's local frame.
THETA_DEG = 5.0
TRANSLATION = np.array([3.0, -2.0, 0.15])
SUBREGION = (-60.0, 20.0, -70.0, 25.0)  # x0, x1, y0, y1


def rotation_z(deg: float) -> np.ndarray:
    a = np.deg2rad(deg)
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0.0], [s, c, 0.0], [0.0, 0.0, 1.0]])


def known_transform() -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = rotation_z(THETA_DEG)
    T[:3, 3] = TRANSLATION
    return T


def write_las(path: str, pts: np.ndarray, intensity: Optional[np.ndarray] = None) -> None:
    import laspy

    header = laspy.LasHeader(point_format=3, version="1.2")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = pts.min(axis=0)
    las = laspy.LasData(header)
    las.x = pts[:, 0]
    las.y = pts[:, 1]
    las.z = pts[:, 2]
    las.intensity = (intensity if intensity is not None
                     else np.full(len(pts), 128, dtype=np.uint16))
    las.write(path)


def sample_site(rng, n: int, x0: float, x1: float, y0: float, y1: float) -> np.ndarray:
    x = rng.uniform(x0, x1, n)
    y = rng.uniform(y0, y1, n)
    z = synth.terrain_z(x, y) + rng.normal(0.0, NOISE, n)
    return np.column_stack([x, y, z])


def main() -> None:
    os.makedirs(DATA, exist_ok=True)
    rng = np.random.default_rng(7)

    scan_a = sample_site(rng, N_SCAN_A, synth.X0, synth.X1, synth.Y0, synth.Y1)

    # Scan B is a revisit of a sub-region, captured in its own local frame.
    ref_sub = sample_site(rng, N_SCAN_B, *SUBREGION)
    T = known_transform()
    scan_b = (ref_sub @ T[:3, :3].T) + T[:3, 3]

    write_las(os.path.join(DATA, "scan_a.las"), scan_a)
    write_las(os.path.join(DATA, "scan_b.las"), scan_b)
    from app.io import write_ply

    write_ply(os.path.join(DATA, "scan_a.ply"), scan_a)
    write_ply(os.path.join(DATA, "scan_b.ply"), scan_b)

    with open(os.path.join(DATA, "scan_b_meta.json"), "w") as f:
        json.dump({"theta_deg": THETA_DEG, "translation": TRANSLATION.tolist(),
                   "transform": T.tolist(), "subregion": list(SUBREGION)},
                  f, indent=2)

    print(f"scan_a.las  {scan_a.shape[0]} pts")
    print(f"scan_b.las  {scan_b.shape[0]} pts  (local frame)")
    print("known transform (ref -> scan_b local):")
    print(T)


if __name__ == "__main__":
    main()