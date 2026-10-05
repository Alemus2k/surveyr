"""Generate a synthetic terrain with KNOWN analytics (the test oracle).

Why this exists: when you can't yet judge geospatial correctness by eye, you
need ground truth. This script draws a deterministic analytic landscape
(hill + valley + a near-flat plateau + a gentle global tilt), samples it into
a noisy point cloud, and writes:

  data/synthetic_topo.xyz                 - the point cloud (like a capture)
  data/synthetic_ground_truth.json        - the TRUE analytics for that terrain

The pipeline's percent-flat/relief/cut-fill are compared against this JSON in
tests/test_pipeline.py, independent of how the pipeline computes them.

Usage from backend/:  ./.venv/bin/python scripts/make_synthetic_terrain.py [--preview]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
DATA = os.path.join(BASE, "data")
XYZ_PATH = os.path.join(DATA, "synthetic_topo.xyz")
TRUTH_PATH = os.path.join(DATA, "synthetic_ground_truth.json")
PREVIEW_PATH = os.path.join(DATA, "synthetic_preview.png")

# ---- project parameters (metres) ----
X0, X1, Y0, Y1 = -100.0, 100.0, -100.0, 100.0
DOMAIN_AREA_M2 = (X1 - X0) * (Y1 - Y0)  # 40_000 m2
TRUTH_CELL = 0.5          # fine grid for analytic ground truth
FLAT_THRESH_DEG = 3.0     # definition of "flat" used by the oracle
TILT = 0.010              # gentle planar slope (dz/dx ~ 0.010)
NOISE_SIGMA = 0.05        # per-point measurement noise (m)
N_POINTS = 300_000
N_OUTLIERS = 400


# --------------------------------------------------------------------------
# Analytic landscape + its exact gradient (used for oracle ground truth)
# --------------------------------------------------------------------------
def smoothstep_profile(r: np.ndarray, R: float, w: float) -> np.ndarray:
    """1 on the cap (r<=R) -> 0 beyond (r>=R+w), with zero slope at both ends."""
    t = np.clip((r - R) / w, 0.0, 1.0)
    return 1.0 - t * t * (3.0 - 2.0 * t)


def gaussian(r: np.ndarray, s: float) -> np.ndarray:
    return np.exp(-(r ** 2) / (2.0 * s ** 2))


def terrain_z(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    z = TILT * x                                                    # gentle tilt
    rP = np.hypot(x - 30.0, y - 20.0)                               # near-flat plateau (cap R=30)
    z = z + 8.0 * smoothstep_profile(rP, 30.0, 15.0)
    rH = np.hypot(x + 40.0, y + 40.0)                               # hill at (-40,-40)
    z = z + 12.0 * gaussian(rH, 28.0)
    rV = np.hypot(x - 10.0, y + 50.0)                               # valley at (10,-50)
    z = z - 9.0 * gaussian(rV, 22.0)
    return z


def terrain_gradient(x: np.ndarray, y: np.ndarray) -> tuple:
    """Analytic (dz/dx, dz/dy) — independent of any numeric differentiation."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    zx = TILT * np.ones_like(x)
    zy = np.zeros_like(x)

    def radial(cx, cy, r):
        rx = np.where(r > 1e-9, (x - cx) / np.maximum(r, 1e-9), 0.0)
        ry = np.where(r > 1e-9, (y - cy) / np.maximum(r, 1e-9), 0.0)
        return rx, ry

    # plateau
    r = np.hypot(x - 30.0, y - 20.0)
    gP = 8.0 * _dsmooth_dr(r, 30.0, 15.0)
    rx, ry = radial(30.0, 20.0, r)
    zx += gP * rx
    zy += gP * ry
    # hill
    r = np.hypot(x + 40.0, y + 40.0)
    gH = 12.0 * _dg_dr(r, 28.0)
    rx, ry = radial(-40.0, -40.0, r)
    zx += gH * rx
    zy += gH * ry
    # valley
    r = np.hypot(x - 10.0, y + 50.0)
    gV = -9.0 * _dg_dr(r, 22.0)
    rx, ry = radial(10.0, -50.0, r)
    zx += gV * rx
    zy += gV * ry
    return zx, zy


def _dsmooth_dr(r: np.ndarray, R: float, w: float) -> np.ndarray:
    t = np.clip((r - R) / w, 0.0, 1.0)
    d = np.zeros_like(r)
    inside = (r > R) & (r < R + w)
    d[inside] = -6.0 * t[inside] * (1.0 - t[inside]) / w
    return d


def _dg_dr(r: np.ndarray, s: float) -> np.ndarray:
    return -(r / (s * s)) * gaussian(r, s)


def slope_analytic_deg(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    zx, zy = terrain_gradient(x, y)
    return np.degrees(np.arctan(np.hypot(zx, zy)))


# --------------------------------------------------------------------------
# Ground truth + point cloud sampling
# --------------------------------------------------------------------------
def compute_ground_truth() -> dict:
    xs = np.arange(X0, X1 + TRUTH_CELL, TRUTH_CELL)
    ys = np.arange(Y0, Y1 + TRUTH_CELL, TRUTH_CELL)
    Xg, Yg = np.meshgrid(xs, ys)
    z = terrain_z(Xg, Yg)
    sl = slope_analytic_deg(Xg, Yg)
    dA = TRUTH_CELL ** 2
    return {
        "domain": [X0, Y0, X1, Y1],
        "truth_cell_m": TRUTH_CELL,
        "flat_threshold_deg": FLAT_THRESH_DEG,
        "area_m2": float(z.size * dA),
        "percent_flat_2deg": float(100.0 * (sl <= 2.0).mean()),
        "percent_flat_3deg": float(100.0 * (sl <= 3.0).mean()),
        "percent_flat_5deg": float(100.0 * (sl <= 5.0).mean()),
        "relief_m": float(z.max() - z.min()),
        "max_elev_m": float(z.max()),
        "min_elev_m": float(z.min()),
        "mean_elev_m": float(z.mean()),
        "target_elev_m": float(z.mean()),       # level to mean grade
        "cut_m3": float(np.sum(np.maximum(z - z.mean(), 0.0)) * dA),
        "fill_m3": float(np.sum(np.maximum(z.mean() - z, 0.0)) * dA),
        "net_m3": 0.0,
    }


def sample_cloud(rng: np.random.Generator) -> np.ndarray:
    x = rng.uniform(X0, X1, N_POINTS)
    y = rng.uniform(Y0, Y1, N_POINTS)
    z = terrain_z(x, y) + rng.normal(0.0, NOISE_SIGMA, N_POINTS)
    # gross outliers (to exercise the cleaner)
    ox = rng.uniform(X0, X1, N_OUTLIERS)
    oy = rng.uniform(Y0, Y1, N_OUTLIERS)
    oz = rng.uniform(-60.0, 90.0, N_OUTLIERS)
    return np.column_stack([np.concatenate([x, ox]),
                            np.concatenate([y, oy]),
                            np.concatenate([z, oz])])


def write_preview(truth: dict) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    xs = np.arange(X0, X1 + TRUTH_CELL, TRUTH_CELL)
    ys = np.arange(Y0, Y1 + TRUTH_CELL, TRUTH_CELL)
    Xg, Yg = np.meshgrid(xs, ys)
    z = terrain_z(Xg, Yg)
    sl = slope_analytic_deg(Xg, Yg)
    flat = sl <= FLAT_THRESH_DEG

    fig, axes = plt.subplots(2, 2, figsize=(11, 9))
    e0 = axes[0, 0].imshow(z, extent=[X0, X1, Y0, Y1], origin="lower", cmap="terrain")
    axes[0, 0].set_title("Elevation (m)")
    plt.colorbar(e0, ax=axes[0, 0])
    e1 = axes[0, 1].imshow(sl, extent=[X0, X1, Y0, Y1], origin="lower", cmap="YlOrRd")
    axes[0, 1].set_title(f"Slope (deg), truth %-flat(3°) = {truth['percent_flat_3deg']:.1f}%")
    plt.colorbar(e1, ax=axes[0, 1])
    axes[1, 0].imshow(flat, extent=[X0, X1, Y0, Y1], origin="lower", cmap="Greens")
    axes[1, 0].set_title("Flat mask (slope <= 3°)")
    axes[1, 1].imshow(z, extent=[X0, X1, Y0, Y1], origin="lower", cmap="terrain")
    axes[1, 1].contour(Xg, Yg, z, levels=np.arange(np.floor(z.min()), np.ceil(z.max()), 2.0),
                       colors="k", linewidths=0.6)
    axes[1, 1].set_title("Elevation + contours (2 m)")
    plt.tight_layout()
    fig.savefig(PREVIEW_PATH, dpi=110)
    plt.close(fig)
    print(f"preview  -> {PREVIEW_PATH}")


def main() -> None:
    os.makedirs(DATA, exist_ok=True)
    truth = compute_ground_truth()
    rng = np.random.default_rng(0)
    cloud = sample_cloud(rng)

    np.savetxt(XYZ_PATH, cloud, fmt="%.4f")
    with open(TRUTH_PATH, "w") as f:
        json.dump(truth, f, indent=2)

    print(f"points   -> {XYZ_PATH}  ({N_POINTS + N_OUTLIERS} pts)")
    print(f"truth    -> {TRUTH_PATH}")
    for k, v in truth.items():
        print(f"  {k:22s} {v}")
    if "--preview" in sys.argv:
        write_preview(truth)


if __name__ == "__main__":
    main()