"""Sub-map fusion + localization for multi-pass captures.

"Does it know it's been here before?" logic:

  * A project is a set of overlapping *sub-maps* (captured point clouds) in a
    shared project frame.
  * Adding a new scan *registers* it to each existing sub-map with a BOUNDED
    point-to-point ICP (numpy/scipy — free). "Bounded" means correspondences
    are only accepted within a maximum distance cap, so ICP refines a roughly
    correct placement but can never "walk" a distant, unrelated cloud onto the
    map. That single bound separates genuine REVISITS (overlapping, high match
    fraction) from genuinely NEW territory (no overlap).
  * A revisit is recognised as such (``fused``); otherwise a new sub-map is
    started. Every capture stays its own sub-map so per-pass coverage is kept.

Coverage = per-cell count of how many sub-maps covered each raster cell, so
"revisited areas" = cells seen by >= 2 passes.

This is intentionally dependency-light (numpy + scipy) and free. Registration
without a pose prior is a known hard problem (see PROFESSOR_QUESTIONS.md); the
bounded ICP above is the pragmatic refinement typically paired with a coarse
GPS/odometry prior supplied via ``FusedProject.add_scan(scan, prior=...)``.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np
from scipy.spatial import cKDTree

# Distance (m) below which a matched pair counts as "overlapping" when
# reporting match fraction.
DEFAULT_MATCH_DIST = 1.0
# Correspondence cap for ICP: matches farther than this are ignored each
# iteration, so ICP only refines locally and cannot jump a disjoint cloud.
DEFAULT_MAX_CORR_DIST = 4.0
# Match fraction of the source above which we call the scan a revisit.
DEFAULT_OVERLAP_THRESHOLD = 0.30


def _apply(transform: np.ndarray, pts: np.ndarray) -> np.ndarray:
    return (pts @ transform[:3, :3].T) + transform[:3, 3]


def icp_point_to_point(
    source: np.ndarray,
    target: np.ndarray,
    init: Optional[np.ndarray] = None,
    max_iter: int = 40,
    tol: float = 1e-8,
    max_corr_dist: float = DEFAULT_MAX_CORR_DIST,
    max_match_dist: float = DEFAULT_MATCH_DIST,
    subsample: int = 20000,
) -> dict:
    """Refine ``source`` onto ``target`` with bounded point-to-point ICP.

    Returns the 4x4 transform (source -> target frame), RMS error, and the
    match fraction (share of source points within ``max_match_dist`` of the
    target after alignment). Correspondences farther than ``max_corr_dist``
    are excluded each iteration, bounding the refinement basin.
    """
    source = np.asarray(source, dtype=float)
    target = np.asarray(target, dtype=float)
    if source.shape[0] < 3 or target.shape[0] < 3:
        raise ValueError("ICP needs at least 3 points on each side")
    rng = np.random.default_rng(0)
    if subsample and source.shape[0] > subsample:
        source = source[rng.choice(source.shape[0], subsample, replace=False)]
    if subsample and target.shape[0] > subsample:
        target = target[rng.choice(target.shape[0], subsample, replace=False)]

    T = np.eye(4) if init is None else np.asarray(init, dtype=float)
    tree = cKDTree(target)

    for _ in range(max_iter):
        src = _apply(T, source)
        d, i = tree.query(src, k=1)
        keep = d <= max_corr_dist
        if int(keep.sum()) < 6:
            break  # not enough in-window matches: stop refining
        A = src[keep]
        B = target[i[keep]]
        Ac, Bc = A.mean(0), B.mean(0)
        H = (A - Ac).T @ (B - Bc)
        U, _S, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        if np.linalg.det(R) < 0:
            Vt[-1] *= -1
            R = Vt.T @ U.T
        t = Bc - R @ Ac
        dT = np.eye(4)
        dT[:3, :3] = R
        dT[:3, 3] = t
        T = dT @ T
        if (np.linalg.norm(dT[:3, :3] - np.eye(3)) < tol
                and np.linalg.norm(dT[:3, 3]) < tol):
            break

    src_final = _apply(T, source)
    d, _i = tree.query(src_final, k=1)
    matched = d <= max_match_dist
    return {
        "transform": T,
        "rmse": float(np.sqrt(np.mean(d ** 2))),
        "overlap": float(matched.mean()),
        "n_matched": int(matched.sum()),
        "n_source": int(source.shape[0]),
    }


@dataclass
class SubMap:
    """A captured pass in the shared project frame."""
    id: int
    points: np.ndarray
    epoch: int  # capture order index
    transform: np.ndarray = field(default_factory=lambda: np.eye(4))


class FusedProject:
    """A set of overlapping sub-maps + the revisit/new-territory decision."""
    def __init__(self, first: np.ndarray, first_epoch: int = 0):
        self.sub_maps: List[SubMap] = [SubMap(0, np.asarray(first, float), first_epoch)]
        self._next_id = 1
        self._epoch = first_epoch

    def add_scan(
        self,
        scan: np.ndarray,
        prior: Optional[np.ndarray] = None,
        overlap_threshold: float = DEFAULT_OVERLAP_THRESHOLD,
        max_match_dist: float = DEFAULT_MATCH_DIST,
    ) -> dict:
        """Register ``scan`` (optionally coarsely placed by a pose ``prior``)
        to the best existing sub-map.

        Every capture is stored as its own sub-map in the project frame so
        per-pass coverage is preserved. ``action`` is ``fused`` when the scan
        is recognised as a REVISIT of covered ground, else ``new_submap``.
        A pose ``prior`` (GPS / odometry) narrows the registration basin.
        """
        self._epoch += 1
        scan = np.asarray(scan, dtype=float)
        prior = np.eye(4) if prior is None else np.asarray(prior, dtype=float)
        placed = _apply(prior, scan)  # coarse placement into project frame

        best_result = None
        best_sub: Optional[SubMap] = None
        for sm in self.sub_maps:
            res = icp_point_to_point(
                placed, sm.points, max_match_dist=max_match_dist, subsample=20000,
            )
            if best_result is None or res["overlap"] > best_result["overlap"]:
                best_result = res
                best_sub = sm

        is_revisit = best_result["overlap"] >= overlap_threshold
        if is_revisit:
            T = best_result["transform"] @ prior
            action = "fused"
        else:
            T = prior
            action = "new_submap"
        points_proj = _apply(T, scan)

        new_id = self._next_id
        self._next_id += 1
        self.sub_maps.append(SubMap(new_id, points_proj, self._epoch, T))
        return {
            "action": action,
            "into": best_sub.id if is_revisit else None,
            "new_submap": new_id,
            "epoch": self._epoch,
            "overlap": best_result["overlap"],
            "rmse": best_result["rmse"],
        }

    def fused_points(self) -> np.ndarray:
        return np.vstack([sm.points for sm in self.sub_maps])

    def coverage(
        self, cell_size: float, bounds: Optional[tuple] = None
    ) -> dict:
        """Per-cell multi-pass coverage over the union of all sub-maps.

        Returns per-cell scan counts, last epoch per cell, and summary
        percentages (covered = >=1 pass, revisited = >=2 passes).
        """
        all_pts = self.fused_points()
        if bounds is None:
            x0, y0, x1, y1 = (all_pts[:, 0].min(), all_pts[:, 1].min(),
                              all_pts[:, 0].max(), all_pts[:, 1].max())
        else:
            x0, y0, x1, y1 = bounds
        nx = max(1, int(np.ceil((x1 - x0) / cell_size)))
        ny = max(1, int(np.ceil((y1 - y0) / cell_size)))

        counts = np.zeros((ny, nx), dtype=int)
        last = np.full((ny, nx), -1, dtype=int)
        present = np.zeros((ny, nx), dtype=bool)
        per_scan = []
        for sm in self.sub_maps:
            p = sm.points
            ix = np.floor((p[:, 0] - x0) / cell_size).astype(int)
            iy = np.floor((p[:, 1] - y0) / cell_size).astype(int)
            ok = (ix >= 0) & (ix < nx) & (iy >= 0) & (iy < ny)
            this = np.zeros((ny, nx), dtype=bool)
            this[iy[ok], ix[ok]] = True
            counts += this.astype(int)
            last[this] = sm.epoch
            present |= this
            per_scan.append(float(this.mean()))
        covered = bool(present.sum())
        return {
            "counts": counts.tolist(),
            "last_epoch": last.tolist(),
            "covered_pct": 100.0 * present.mean() if covered else 0.0,
            "revisited_pct": 100.0 * (counts >= 2).mean() if covered else 0.0,
            "per_scan_pct": per_scan,
            "n_submaps": len(self.sub_maps),
            "bounds": (x0, y0, x1, y1),
            "cell_size": cell_size,
        }


def register_multi_scan(
    scans: List[np.ndarray],
    overlap_threshold: float = DEFAULT_OVERLAP_THRESHOLD,
) -> "FusedProject":
    """Convenience: build a FusedProject from an ordered list of scans."""
    project = FusedProject(scans[0], first_epoch=0)
    for scan in scans[1:]:
        project.add_scan(scan, overlap_threshold=overlap_threshold)
    return project