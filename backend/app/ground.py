"""Automatic ground classification: which points are bare earth, when the scan
file doesn't say (or says it badly).

Built for construction sites, where the hard part is removing machines, trucks
and trees *without* shaving stockpiles, windrows, trench walls or pond slopes.
A missed machine costs a few m³; a shaved stockpile costs hundreds. So the
filter only removes a bump when it looks like an object, never just because it
sticks up.

Method (all on a grid of cell size ``c`` chosen from point density):

1. **Lowest point per cell** (``zmin``). When the scan has returns, only *last*
   returns are used (a pulse with more echoes after this one passed through
   something: canopy, brush). Empty cells take their nearest neighbour.
2. **Pits**: a cell lower than every cell within two cells by more than
   ``pit_m`` is a low outlier (multipath, a bird below the drone…); it takes
   its neighbours' lowest value.
3. **Grey opening** of ``zmin`` with a square window of ``window_m``: the
   surface you'd get by pressing a ``window_m``-wide flat plate up from below.
   Anything narrower than the plate sticks up: ``D = zmin - opening``.
4. **Bumps** are cells with ``D > bump_m``. With ``steep = max_slope * c * √2
   + 0.15`` (the most real terrain can rise across one cell), a bump cell is an
   object *core* if its points span more than ``steep`` vertically (a canopy
   or a machine has points at many heights in one cell) or ``D > max_slope *
   window_m / 2`` (taller than terrain that steep could be under the plate).
   Objects grow from their cores, two cells at most, into neighbouring bump
   cells no higher than the core — never the whole bump, so a tree beside a
   stockpile doesn't take the pile with it. A connected bump with no core is an
   object if it rises steeply on most sides: the 25th percentile, over its edge
   cells, of the rise above the *highest* ground cell beside them exceeds
   ``steep`` (a box clears all its neighbours; a windrow against a trench
   doesn't clear the field behind it, so it stays).
5. **Bare-earth surface** ``S``: ``zmin`` on every other cell; cells under
   objects are filled from the surrounding ground (nearest value, then
   relaxed towards the average of the neighbours, like a stretched membrane).
6. **Points**: with ``lo``/``hi`` the lowest/highest ``S`` in the 3 × 3 cells
   around a point and ``s`` its own cell's, the point is ground if
   ``lo - low_m <= z <= max(hi, 2s - lo) + height_m`` — so points on a slope,
   a trench rim or a ridge crest, which sit well above their own cell's lowest
   point, still count. A non-last echo of a multi-echo pulse must also be
   within ``return_height_m`` of ``s``. Below ``lo - low_m`` is low noise.

``classify`` additionally splits the non-ground points into vegetation and
objects, per cluster, from returns, colour or porosity (whether pulses reached
the ground underneath).

Only numpy and scipy: this runs in the bundled engine.
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from scipy import ndimage

GROUND, LOW_VEG, HIGH_VEG, OTHER, LOW_NOISE = 2, 3, 5, 1, 7

DEFAULTS = {
    "cell": None,  # metres; None = from point density (~4 points per cell)
    "window_m": 7.0,  # widest object to remove (must be wider than a machine: an excavator is ~3.2 m)
    "bump_m": 0.2,  # a bump lower than this is never looked at as an object
    "max_slope": 0.7,  # steepest real terrain (rise / run): ~35°, loose fill's angle of repose
    "height_m": 0.15,  # how far above the bare earth a point may be and still count as ground
    "return_height_m": 0.08,  # the same, for a non-last echo (something was below it)
    "low_m": 0.5,  # further below the bare earth than this = low noise
    "pit_m": 0.5,  # a cell this much below every cell within two is an outlier
    "tall_veg_m": 2.0,  # vegetation points higher than this above the bare earth are trees (5), else brush (3)
}
_NICE = (0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1.0, 2.0, 5.0)
MAX_GRID_CELLS = 4_000_000
POINTS_PER_CELL = 4.0
SQRT2 = float(np.sqrt(2.0))


def _params(overrides: dict) -> dict:
    unknown = set(overrides) - set(DEFAULTS)
    if unknown:
        raise TypeError(f"unknown ground parameter(s): {', '.join(sorted(unknown))}")
    return {**DEFAULTS, **overrides}


def cell_size(xy: np.ndarray) -> float:
    """A tidy cell size holding ~POINTS_PER_CELL points where the scan has points."""
    span = np.ptp(xy, axis=0)
    area = float(max(span[0], 1e-6) * max(span[1], 1e-6))
    c0 = max(np.sqrt(area / len(xy)) * 2.0, 1e-3)  # ~4 points per cell if the footprint were a full rectangle
    ix = ((xy[:, 0] - xy[:, 0].min()) / c0).astype(np.int64)
    iy = ((xy[:, 1] - xy[:, 1].min()) / c0).astype(np.int64)
    occupied = len(np.unique(ix * (int(iy.max()) + 1) + iy)) * c0 * c0
    wanted = np.sqrt(POINTS_PER_CELL * occupied / len(xy))
    for c in _NICE:
        if c >= wanted * 0.9:
            return c
    return _NICE[-1]


def _channel(channels: Optional[dict], name: str) -> Optional[np.ndarray]:
    if not channels or channels.get(name) is None:
        return None
    a = np.asarray(channels[name], dtype=float)
    return None if a.size == 0 or np.isnan(a).all() else a


def _cell_reduce(flat: np.ndarray, values: np.ndarray, cells: int, how: str) -> np.ndarray:
    out = np.full(cells, np.inf if how == "min" else -np.inf)
    (np.minimum if how == "min" else np.maximum).at(out, flat, values)
    return out


def _fill(z: np.ndarray, known: np.ndarray, relax: int) -> np.ndarray:
    """Unknown cells: nearest known value, then relaxed towards their neighbours' mean."""
    if known.all() or not known.any():
        return z if known.all() else np.zeros_like(z)
    idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
    out = z[tuple(idx)]
    for _ in range(relax):
        out = np.where(known, out, ndimage.uniform_filter(out, size=3, mode="nearest"))
    return out


def _group_quantile(groups: np.ndarray, values: np.ndarray, ngroups: int, q: float) -> np.ndarray:
    """Per-group quantile (groups numbered 1..ngroups); -inf for groups with no values."""
    out = np.full(ngroups, -np.inf)
    if len(groups) == 0:
        return out
    order = np.lexsort((values, groups))
    g, v = groups[order], values[order]
    start = np.searchsorted(g, np.arange(1, ngroups + 1), side="left")
    end = np.searchsorted(g, np.arange(1, ngroups + 1), side="right")
    has = end > start
    pick = start + np.floor((end - start - 1) * q).astype(np.int64)
    out[has] = v[pick[has]]
    return out


def _analyse(points: np.ndarray, channels: Optional[dict], p: dict) -> dict:
    pts = np.asarray(points, dtype=float)
    n = len(pts)
    x, y, z = pts[:, 0], pts[:, 1], pts[:, 2]
    c = float(p["cell"] or cell_size(pts[:, :2]))
    x0, y0 = x.min(), y.min()
    nx = int((x.max() - x0) / c) + 1
    ny = int((y.max() - y0) / c) + 1
    while nx * ny > MAX_GRID_CELLS:  # very large or very dense: coarsen
        c *= 2
        nx, ny = int((x.max() - x0) / c) + 1, int((y.max() - y0) / c) + 1
    ix = ((x - x0) / c).astype(np.int64)
    iy = ((y - y0) / c).astype(np.int64)
    flat = iy * nx + ix
    cells = nx * ny

    ret, nret = _channel(channels, "return_number"), _channel(channels, "number_of_returns")
    has_returns = ret is not None and nret is not None and bool((nret > 1).any())
    if has_returns:
        through = (nret > 1) & (ret < nret)  # an earlier echo: the pulse carried on below it
    else:
        through = np.zeros(n, dtype=bool)
    base = ~through

    # 1. lowest (last-return) point per cell; the highest and lowest of every point, for spread
    zmin = _cell_reduce(flat[base], z[base], cells, "min").reshape(ny, nx)
    zmax = _cell_reduce(flat, z, cells, "max").reshape(ny, nx)
    zlow_all = _cell_reduce(flat, z, cells, "min").reshape(ny, nx)
    occupied = np.isfinite(zmin)
    if not occupied.any():
        occupied = np.isfinite(zlow_all)
        zmin = zlow_all
    zf = _fill(np.where(occupied, zmin, 0.0), occupied, relax=0)

    # 2. single-cell pits: low outliers. Compared with every cell within two, so a trench
    # cell next to one that happened to get no bottom returns isn't mistaken for a pit
    ring = np.ones((5, 5), dtype=bool)
    ring[2, 2] = False
    nb_low = ndimage.minimum_filter(zf, footprint=ring, mode="nearest")
    pit = occupied & (zf < nb_low - p["pit_m"])
    zf = np.where(pit, nb_low, zf)

    # 3. opening with the plate
    w = max(3, int(np.ceil(p["window_m"] / c)) | 1)
    opened = ndimage.maximum_filter(ndimage.minimum_filter(zf, size=w, mode="nearest"), size=w, mode="nearest")
    d = zf - opened

    # 4. bumps that look like objects
    steep = p["max_slope"] * c * SQRT2 + 0.15
    bump = occupied & (d > p["bump_m"])
    spread = np.where(np.isfinite(zmax) & np.isfinite(zlow_all), zmax - zlow_all, 0.0)
    core = bump & ((spread > steep) | (d > p["max_slope"] * p["window_m"] / 2))
    # objects grow from their core cells over the bump they stand in, into lower cells only
    # (an object's fringe is lower than its core; a tree beside a stockpile, or a pipe in a
    # trench beside a windrow, must not take the higher ground with it)
    obj_cells = core.copy()
    for _ in range(2):
        top = ndimage.maximum_filter(np.where(obj_cells, zf, -np.inf), size=3, mode="nearest")
        grow = bump & ~obj_cells & (zf <= top + 0.1)
        if not grow.any():
            break
        obj_cells |= grow
    fp = np.ones((3, 3), dtype=bool)
    fp[1, 1] = False
    labels, nlab = ndimage.label(bump & ~obj_cells, structure=np.ones((3, 3)))
    if nlab:  # bumps without a core: objects if they rise steeply on most sides
        # how far each edge cell rises above the *highest* ground beside it: a box clears
        # every neighbour, a windrow against a trench doesn't clear the field behind it
        outside = np.where((labels > 0) | obj_cells | ~occupied, -np.inf, zf)
        step = zf - ndimage.maximum_filter(outside, footprint=fp, mode="nearest")
        rim = (labels > 0) & np.isfinite(step)
        edge_p25 = _group_quantile(labels[rim], step[rim], nlab, 0.25)
        obj_cells |= np.concatenate([[False], edge_p25 > steep])[labels]

    # 5. bare-earth surface
    known = occupied & ~obj_cells
    surface = _fill(zf, known, relax=int(np.ceil(p["window_m"] / c)) * 2)

    # 6. points against it: between the lowest and highest bare earth of the cell and its
    # eight neighbours (so points on a slope, a trench rim or a pile flank, which sit well
    # above their own cell's lowest point, still count), plus the height allowance
    hi = ndimage.maximum_filter(surface, size=3, mode="nearest").ravel()[flat]
    lo = ndimage.minimum_filter(surface, size=3, mode="nearest").ravel()[flat]
    s = surface.ravel()[flat]
    h = z - s
    low = z < lo - p["low_m"]
    # on a crest every neighbour is lower: allow the fall to the lowest one as rise above this one
    ground = ~low & (z <= np.maximum(hi, 2 * s - lo) + p["height_m"])
    ground &= ~through | (h <= p["return_height_m"])
    return {"ground": ground, "low": low, "h": h, "flat": flat, "shape": (ny, nx), "cell": c,
            "through": through, "has_returns": has_returns,
            "objects": obj_cells, "core": core, "bump": d, "spread": spread, "origin": (x0, y0)}


def classify_ground(points: np.ndarray, channels: Optional[dict] = None, **params) -> np.ndarray:
    """True for points on the bare earth. Works from x, y, z alone; uses returns when the scan has them."""
    pts = np.asarray(points, dtype=float)
    p = _params(params)
    if len(pts) < 10:
        return np.ones(len(pts), dtype=bool)
    return _analyse(pts, channels, p)["ground"]


def classify(points: np.ndarray, channels: Optional[dict] = None, **params) -> np.ndarray:
    """ASPRS-style classes: 2 ground, 3 low / 5 high vegetation, 1 other objects, 7 low noise.

    Non-ground points are called vegetation or objects by what the scan
    carries, in order of trust: echo returns (most non-ground points in the
    3 x 3 cells around come from multi-echo pulses), else colour (most of them
    are green), else porosity — per cluster of touching cells, whether pulses
    reached the ground under most of its interior (canopy lets them through; a
    machine or a roof doesn't). Vegetation points more than ``tall_veg_m``
    above the bare earth are high vegetation (5), the rest low (3).
    """
    pts = np.asarray(points, dtype=float)
    p = _params(params)
    out = np.full(len(pts), GROUND, dtype=np.uint8)
    if len(pts) < 10:
        return out
    a = _analyse(pts, channels, p)
    ground, flat, (ny, nx) = a["ground"], a["flat"], a["shape"]
    above = ~ground & ~a["low"]
    out[a["low"]] = LOW_NOISE
    if not above.any():
        return out
    cells = ny * nx
    has_above = np.bincount(flat[above], minlength=cells).reshape(ny, nx) > 0
    has_ground = np.bincount(flat[ground], minlength=cells).reshape(ny, nx) > 0
    labels, nlab = ndimage.label(has_above, structure=np.ones((3, 3)))
    lab_pt = labels.ravel()[flat]
    k = nlab + 1

    def local_majority(mask: np.ndarray) -> np.ndarray:
        """Per point: do most non-ground points in the 3 x 3 cells around it have ``mask``?

        Decided locally, not per cluster, so a truck parked under a tree stays a truck.
        """
        yes = np.bincount(flat[above & mask], minlength=cells).reshape(ny, nx).astype(float)
        all_ = np.bincount(flat[above], minlength=cells).reshape(ny, nx).astype(float)
        frac = ndimage.uniform_filter(yes, size=3, mode="constant") / np.maximum(
            ndimage.uniform_filter(all_, size=3, mode="constant"), 1e-9)
        return (frac > 0.5).ravel()[flat[above]]

    nret = _channel(channels, "number_of_returns")
    rgb = [_channel(channels, ch) for ch in ("red", "green", "blue")]
    if a["has_returns"]:
        is_veg = local_majority(nret > 1)
    elif all(v is not None for v in rgb):
        is_veg = local_majority(_vegetation_colour(*rgb))
    else:
        # porosity: interior cells of the cluster's footprint that still got ground returns
        # (a canopy lets some pulses through; a machine or a roof hides the ground)
        interior = ndimage.binary_erosion(has_above, structure=np.ones((3, 3)))
        use = np.where(np.bincount(labels[interior], minlength=k)[labels] > 0, interior, has_above)
        lab = labels[use]
        porous = np.bincount(lab, weights=has_ground[use], minlength=k) / np.maximum(np.bincount(lab, minlength=k), 1)
        is_veg = (porous > 0.5)[lab_pt[above]]
    tall = a["h"][above] > p["tall_veg_m"]
    out[above] = np.where(is_veg, np.where(tall, HIGH_VEG, LOW_VEG), OTHER)
    return out


def _vegetation_colour(r: np.ndarray, g: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Green and saturated enough: hue 65°–145° (yellow machines are ~45°, a teal pipe ~150°)."""
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    span = np.maximum(mx - mn, 1e-9)
    green_top = (g >= r) & (g >= b)
    hue = np.where(green_top, 120 + 60 * (b - r) / span,
                   np.where(r >= b, (60 * (g - b) / span) % 360, 240 + 60 * (r - g) / span))
    sat = (mx - mn) / np.maximum(mx, 1e-9)
    return (hue >= 65) & (hue <= 145) & (sat > 0.15)


def suggest(points: np.ndarray, sample: int = 100_000) -> bool:
    """Cheap check: does this unclassified scan clearly have things standing on the ground?

    On a random sample, bins points at twice the density-based cell size and
    looks for cells with at least three points far above the cell's lowest
    point — more than max(1 m, 1.4 cells, 6x the typical cell's height range) —
    such as a canopy, a machine or a wall. True when at least 0.5 % of occupied
    cells have them. Plain terrain (even steep) and lone outliers stay False.
    """
    pts = np.asarray(points, dtype=float)
    if len(pts) < 1000:
        return False
    if len(pts) > sample:
        pts = pts[np.random.default_rng(0).choice(len(pts), sample, replace=False)]
    c = cell_size(pts[:, :2]) * 2  # ~16 points per cell
    ix = ((pts[:, 0] - pts[:, 0].min()) / c).astype(np.int64)
    iy = ((pts[:, 1] - pts[:, 1].min()) / c).astype(np.int64)
    nx, ny = int(ix.max()) + 1, int(iy.max()) + 1
    flat = iy * nx + ix
    cells = nx * ny
    lo = _cell_reduce(flat, pts[:, 2], cells, "min")
    hi = _cell_reduce(flat, pts[:, 2], cells, "max")
    occupied = np.isfinite(lo)
    typical = float(np.median((hi - lo)[occupied]))
    thr = max(1.0, 1.4 * c, 6 * typical)
    # a lone low outlier must not make the whole cell look tall: base on the neighbourhood
    filled = _fill(np.where(occupied, lo, 0.0).reshape(ny, nx), occupied.reshape(ny, nx), relax=0)
    med = ndimage.median_filter(filled, size=3, mode="nearest").ravel()
    base = np.where(lo < med - thr, med, lo)
    h = pts[:, 2] - base[flat]
    above = (h > thr) & (h < 100 * thr)
    # several points up there, not one stray return (spikes and birds are outliers, not objects)
    tall = np.bincount(flat[above], minlength=cells) >= 3
    return bool(tall.sum() >= 0.005 * occupied.sum())
