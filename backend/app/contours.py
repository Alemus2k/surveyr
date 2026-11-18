"""Contour lines from a gridded surface: marching squares in NumPy.

The grid's cell centres are the nodes. A contour is traced through the squares
between four neighbouring centres, and only through squares whose four corners
were all measured — so a line never crosses ground nobody scanned; it simply
stops at the edge of the data.

Each crossing sits on a grid edge by linear interpolation. Segments are joined
by the *edge* they share (not by comparing coordinates), so lines are exact,
closed where the ground closes them, and the output is deterministic. A node
exactly at a contour level counts as above it, and the saddle case (two
opposite corners above, two below) is settled by the square's mean.

Everything is metres. Intervals that are round in feet (0.3048, 0.6096, 1.524 …)
work like any other: levels are whole multiples of the interval.
"""
from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np
from scipy import ndimage

FT = 0.3048
US_FT = 1200 / 3937
# 1-2-5 series so every 5th line (the major one) is also a round number
_NICE = (0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0, 200.0, 500.0, 1000.0)
_UNIT_M = {"m": 1.0, "ft": FT, "us_ft": US_FT}
TARGET_LINES = 25  # the automatic interval draws at most about this many lines
MAX_LEVELS = 400  # refuse intervals that would draw more lines than anyone can read
DEFAULT_MAJOR_EVERY = 5
SIMPLIFY_FRACTION = 0.02  # Douglas–Peucker tolerance as a share of the cell size


class ContourError(ValueError):
    """The request can't be drawn (interval too fine, nothing measured)."""


def auto_interval(relief_m: float, unit: str = "m") -> float:
    """A tidy contour interval in metres for ``relief_m`` of relief.

    The smallest interval of the 1-2-5 series — in metres, or in feet when
    ``unit`` is "ft" / "us_ft" — that draws no more than TARGET_LINES lines.
    """
    scale = _UNIT_M[unit]
    for nice in _NICE:
        if relief_m / (nice * scale) <= TARGET_LINES:
            return nice * scale
    return _NICE[-1] * scale


def level_indices(zmin: float, zmax: float, interval: float) -> Tuple[int, int]:
    """First and last whole multiples of ``interval`` within [zmin, zmax]."""
    eps = 1e-9
    return int(np.ceil(zmin / interval - eps)), int(np.floor(zmax / interval + eps))


def smooth_masked(z: np.ndarray, sigma_cells: float) -> np.ndarray:
    """Gaussian-smooth a surface without letting unscanned (NaN) cells bleed in.

    Smoothing the *surface* (rather than each line) is what keeps contours from
    crossing: they are still level sets of one function.
    """
    if sigma_cells <= 0:
        return z
    valid = np.isfinite(z)
    weight = ndimage.gaussian_filter(valid.astype(float), sigma=sigma_cells, mode="constant")
    total = ndimage.gaussian_filter(np.where(valid, z, 0.0), sigma=sigma_cells, mode="constant")
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(valid, total / weight, np.nan)


# Marching-squares segments per case. Corner bits: bottom-left 1, bottom-right 2,
# top-right 4, top-left 8 (set = at or above the level; row 0 is the bottom).
# Edges: 0 bottom, 1 right, 2 top, 3 left. Cases 16 / 17 are the saddles 5 / 10
# when the square's centre is above the level (the high corners join up).
_SEGMENTS = np.full((18, 4), -1, dtype=np.int64)
for _case, _edges in {
    1: (3, 0), 2: (0, 1), 3: (3, 1), 4: (1, 2), 5: (3, 0, 1, 2), 6: (0, 2), 7: (3, 2),
    8: (2, 3), 9: (0, 2), 10: (0, 1, 2, 3), 11: (1, 2), 12: (3, 1), 13: (0, 1), 14: (3, 0),
    16: (0, 1, 2, 3), 17: (3, 0, 1, 2),
}.items():
    _SEGMENTS[_case, : len(_edges)] = _edges


def trace_level(z: np.ndarray, level: float, quad_ok: Optional[np.ndarray] = None) -> List[np.ndarray]:
    """Polylines of one level in grid units: (N, 2) arrays of (column, row).

    Coordinates are fractional node indices (node = cell centre). A closed line
    repeats its first point at the end. ``quad_ok`` (ny-1, nx-1) marks squares
    whose four corners are measured; computed from NaNs when omitted.
    """
    ny, nx = z.shape
    if ny < 2 or nx < 2:
        return []
    if quad_ok is None:
        f = np.isfinite(z)
        quad_ok = f[:-1, :-1] & f[:-1, 1:] & f[1:, 1:] & f[1:, :-1]
    with np.errstate(invalid="ignore"):
        above = z >= level
    case = (above[:-1, :-1].astype(np.uint8) + 2 * above[:-1, 1:] + 4 * above[1:, 1:] + 8 * above[1:, :-1])
    rr, cc = np.nonzero(quad_ok & (case > 0) & (case < 15))
    if len(rr) == 0:
        return []
    k = case[rr, cc].astype(np.int64)
    saddle = (k == 5) | (k == 10)
    if saddle.any():
        r, c = rr[saddle], cc[saddle]
        centre = (z[r, c] + z[r, c + 1] + z[r + 1, c + 1] + z[r + 1, c]) / 4.0
        k[saddle] = np.where(centre >= level, np.where(k[saddle] == 5, 16, 17), k[saddle])

    # edge ids: horizontal edges (node → its east neighbour) first, then vertical ones
    n_h = ny * (nx - 1)
    edges = np.stack([rr * (nx - 1) + cc, n_h + rr * nx + cc + 1, (rr + 1) * (nx - 1) + cc, n_h + rr * nx + cc], axis=1)
    seg = _SEGMENTS[k]
    rows = np.arange(len(k))
    second = seg[:, 2] >= 0
    a = np.concatenate([edges[rows, seg[:, 0]], edges[rows[second], seg[second, 2]]])
    b = np.concatenate([edges[rows, seg[:, 1]], edges[rows[second], seg[second, 3]]])

    # every crossed edge becomes a node of a graph in which no node has more than two neighbours
    uniq, inv = np.unique(np.concatenate([a, b]), return_inverse=True)
    m = len(a)
    partner = np.concatenate([inv[m:], inv[:m]])
    order = np.argsort(inv, kind="stable")
    degree = np.bincount(inv, minlength=len(uniq))
    first = np.cumsum(degree) - degree
    by_node = partner[order]
    nb1 = by_node[first]
    nb2 = np.where(degree == 2, by_node[np.minimum(first + 1, len(by_node) - 1)], -1)

    # where the level crosses each edge
    horizontal = uniq < n_h
    r = np.where(horizontal, uniq // (nx - 1), (uniq - n_h) // nx)
    c = np.where(horizontal, uniq % (nx - 1), (uniq - n_h) % nx)
    za = z[r, c]
    zb = np.where(horizontal, z[r, np.minimum(c + 1, nx - 1)], z[np.minimum(r + 1, ny - 1), c])
    t = np.clip((level - za) / (zb - za), 0.0, 1.0)
    px = np.where(horizontal, c + t, c.astype(float))
    py = np.where(horizontal, r.astype(float), r + t)

    n1, n2 = nb1.tolist(), nb2.tolist()
    seen = [False] * len(uniq)
    paths: List[Tuple[List[int], bool]] = []

    def walk(start: int) -> Tuple[List[int], bool]:
        path, prev, cur = [start], -1, start
        seen[start] = True
        while True:
            nxt = n1[cur] if n1[cur] != prev else n2[cur]
            if nxt == start and len(path) > 2:
                return path + [start], True
            if nxt < 0 or seen[nxt]:
                return path, False
            seen[nxt] = True
            path.append(nxt)
            prev, cur = cur, nxt

    for start in np.nonzero(degree == 1)[0].tolist():  # open lines: from each loose end
        if not seen[start]:
            paths.append(walk(start))
    for start in range(len(uniq)):  # what is left are closed rings
        if not seen[start]:
            paths.append(walk(start))

    lines = []
    for path, _closed in paths:
        pts = np.column_stack([px[path], py[path]])
        keep = np.ones(len(pts), dtype=bool)
        keep[1:] = np.any(np.abs(np.diff(pts, axis=0)) > 1e-12, axis=1)  # a node exactly on the level repeats
        pts = pts[keep]
        if len(pts) >= 2 and not (len(pts) == 2 and np.allclose(pts[0], pts[1])):
            lines.append(pts)
    return lines


def simplify(points: np.ndarray, tolerance: float) -> np.ndarray:
    """Douglas–Peucker: drop vertices that lie within ``tolerance`` of the simplified line.

    End points are kept, so a closed ring (first point repeated last) stays closed.
    """
    return simplify_many([points], tolerance)[0]


def simplify_many(lines: List[np.ndarray], tolerance: float) -> List[np.ndarray]:
    """Douglas–Peucker on many polylines at once, vectorised by recursion depth.

    Each round splits every still-open span at its farthest interior vertex (the
    first one on ties, as the recursive form would), so the result is exactly the
    classic algorithm's, in a handful of NumPy passes instead of one per vertex.
    """
    if tolerance <= 0 or not lines:
        return lines
    sizes = np.array([len(line) for line in lines])
    pts = np.concatenate(lines)
    ends = np.cumsum(sizes) - 1
    starts = ends - sizes + 1
    keep = np.zeros(len(pts), dtype=bool)
    keep[starts] = keep[ends] = True
    s, e = starts, ends
    while len(s):
        cnt = e - s - 1
        open_ = cnt > 0
        s, e, cnt = s[open_], e[open_], cnt[open_]
        if not len(s):
            break
        first = np.cumsum(cnt) - cnt
        seg = np.repeat(np.arange(len(s)), cnt)
        idx = np.repeat(s + 1, cnt) + (np.arange(int(cnt.sum())) - np.repeat(first, cnt))
        a, b, p = pts[s][seg], pts[e][seg], pts[idx]
        d = b - a
        length = np.hypot(d[:, 0], d[:, 1])
        cross = np.abs(d[:, 0] * (p[:, 1] - a[:, 1]) - d[:, 1] * (p[:, 0] - a[:, 0]))
        with np.errstate(divide="ignore", invalid="ignore"):
            # a ring's two ends coincide: measure from that point instead
            dist = np.where(length > 1e-12, cross / length, np.hypot(p[:, 0] - a[:, 0], p[:, 1] - a[:, 1]))
        top = np.maximum.reduceat(dist, first)
        at_top = np.flatnonzero(dist == top[seg])
        _, pick = np.unique(seg[at_top], return_index=True)  # first farthest vertex of each span
        far = idx[at_top[pick]]
        split = top > tolerance
        keep[far[split]] = True
        s, e = np.concatenate([s[split], far[split]]), np.concatenate([far[split], e[split]])
    return [pts[a: b + 1][keep[a: b + 1]] for a, b in zip(starts, ends)]


def is_closed(line: np.ndarray) -> bool:
    return len(line) > 3 and bool(np.all(line[0] == line[-1]))


def contours(
    z: np.ndarray,
    x0: float,
    y0: float,
    cell: float,
    interval: Optional[float] = None,
    major_every: int = DEFAULT_MAJOR_EVERY,
    unit: str = "m",
    smooth: float = 0.0,
    simplify_tolerance: Optional[float] = None,
) -> dict:
    """Contour lines of a gridded surface, as survey-coordinate polylines.

    ``z`` is (ny, nx) elevations in metres, row 0 the southernmost, NaN where
    nothing was scanned; ``x0`` / ``y0`` is the grid's south-west corner (the
    outer edge of the first cell) and ``cell`` the cell size. ``interval`` in
    metres (None = chosen from the relief, in the 1-2-5 series of ``unit``).
    ``smooth`` is a Gaussian sigma in cells applied to the surface first (0 =
    exactly as measured). ``simplify_tolerance`` in metres (None = 2 % of a cell).

    Returns ``{"interval", "major_every", "levels": [{"elevation", "major",
    "lines": [(N, 2) float arrays of easting, northing]}], "bounds", "cell_size"}``.
    A closed line repeats its first point at the end. Levels with no lines are left out.
    """
    z = np.asarray(z, dtype=float)
    ny, nx = z.shape
    bounds = [float(x0), float(y0), float(x0 + nx * cell), float(y0 + ny * cell)]
    if major_every < 1:
        raise ContourError("major_every must be at least 1")
    if interval is not None and not interval > 0:
        raise ContourError("the contour interval must be greater than zero")
    out: Dict = {"interval": interval, "major_every": major_every, "levels": [], "bounds": bounds, "cell_size": float(cell)}
    valid = np.isfinite(z)
    if not valid.any():
        out["interval"] = interval or auto_interval(0.0, unit)
        return out
    z = smooth_masked(z, smooth)
    zmin, zmax = float(z[valid].min()), float(z[valid].max())
    if interval is None:
        interval = auto_interval(zmax - zmin, unit)
    out["interval"] = float(interval)
    k0, k1 = level_indices(zmin, zmax, interval)
    if k1 - k0 + 1 > MAX_LEVELS:
        raise ContourError(
            f"a {interval:g} m interval would draw {k1 - k0 + 1} contour levels over {zmax - zmin:.1f} m of relief; "
            f"use a larger interval (at most {MAX_LEVELS} levels)"
        )
    tol_cells = SIMPLIFY_FRACTION if simplify_tolerance is None else simplify_tolerance / cell
    quad_ok = valid[:-1, :-1] & valid[:-1, 1:] & valid[1:, 1:] & valid[1:, :-1] if ny > 1 and nx > 1 else None
    origin = np.array([x0 + cell / 2, y0 + cell / 2])  # node (0, 0) is the first cell's centre
    for k in range(k0, k1 + 1):
        level = k * interval
        lines = [origin + line * cell for line in simplify_many(trace_level(z, level, quad_ok), tol_cells)]
        if lines:
            out["levels"].append({"elevation": float(level), "major": k % major_every == 0, "lines": lines})
    return out


def to_json(result: dict, decimals: int = 3) -> dict:
    """The API payload: lines as nested lists rounded to millimetres."""
    return {
        **result,
        "levels": [
            {"elevation": lv["elevation"], "major": lv["major"],
             "lines": [np.round(line, decimals).tolist() for line in lv["lines"]]}
            for lv in result["levels"]
        ],
    }
