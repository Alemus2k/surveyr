"""Site conditions: everything a flight shows besides earthworks.

For each flight of a job site, on the site's shared grid (``sites.grids``) and
from the flight's per-cell extras (``sites.rasters``) plus its ground points:

- vegetation: tree canopy (> 1.5 m tall) and brush (0.3–1.5 m), trees counted
  as canopy peaks, and what was cleared since the previous flight;
- machines: blobs of non-ground, non-vegetation points 1.5–5 m tall with a
  machine-sized footprint (long thin things such as a pipe are left out);
- disturbed ground: cells whose elevation moved more than the site's change
  threshold since the first flight (speckle removed), and vegetation cleared
  since then;
- coverage: cells with fewer than one ground point per m² (volumes there lean
  on interpolation);
- storm check against the previous flight: erosion rills (narrow channels cut
  below the ground on both sides, found from the ground points themselves,
  not the 1 m grid, which smears a 0.8 m rill to a few centimetres), patches
  with no laser return at all (possibly standing water), and ground that rose
  where no fill is designed or turned dark and wet (pond sediment candidates).

Everything here is geometry-free: the site's limits of disturbance, ponds and
zone names are applied by the interface (``frontend/src/site/conditions.ts``)
so redrawing the limits answers instantly; ``site_summary`` below is the same
few lines in numpy, used by the tests against the demo's truth.

Pure functions take numpy arrays (row-major, row 0 = south, NaN = not
scanned) so they can be tested on hand-made grids. Results are cached until a
member scan, its settings, or the site's change threshold / tolerance change.
"""
from __future__ import annotations

import threading
import warnings
from typing import Dict, List, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException, Response
from scipy import ndimage

from . import binary, service, sites

router = APIRouter()

CANOPY_M = 1.5  # vegetation taller than this is tree canopy
BRUSH_M = 0.3  # 0.3–1.5 m is brush; lower is grass / noise
TREE_MIN_M = 2.0  # a canopy peak lower than this isn't counted as a tree
MACHINE_MIN_M, MACHINE_MAX_M = 1.5, 5.0  # how tall a machine stands above the ground
MACHINE_GROW_M = 1.0  # a machine's lower parts (tracks, bucket) join its blob down to this height
MACHINE_MIN_M2 = 6.0  # footprint of the tall part: smaller is a person, a post, a portable toilet…
MACHINE_JOIN_M = 2.0  # pieces closer than this are one machine (an excavator's arm and its house)...
MACHINE_MAX_LENGTH_M, MACHINE_MAX_WIDTH_M = 13.0, 6.0  # ...if together they're no bigger than a machine
THIN_GROUND_PER_M2 = 1.0  # fewer ground points than this per m² and the ground there is mostly interpolated
WATER_MIN_M2 = 6.0  # a no-return patch at least this big may be water (smaller: random gaps)
WATER_RING_COVERED = 0.9  # ...and must be surrounded by ground the flight did see
DARK_FRACTION = 0.5  # darker than half the flight's typical ground reflectance: wet ground
DARK_MIN_M2 = 4.0
RILL_CELL_M = 0.5  # rill points are clustered on this finer grid
RILL_MIN_POINTS = 8
RILL_MIN_LENGTH_M = 3.0
RILL_MIN_ELONGATION = 3.0
RILL_MAX_DEPTH_M = 1.0  # deeper than this, a channel was dug on purpose (a trench), not eroded
RILL_SIGMA = 3.5  # a rill point sits this many noise-sigmas below its surroundings (at least the threshold)
RILL_SIDE_M = (1.0, 2.5)  # where the banks are sampled, either side of the channel's centre line
OFFSET_BAND_M = 0.15  # a whole-flight vertical offset is estimated from cells that moved less than this
OFFSET_MAX_M = 0.10  # ...and only removed if it's smaller than this (bigger is real work, or a bad flight)
OFFSET_MIN_SHARE = 0.3  # ...and at least this share of the site looks unmoved

# bits of the per-flight ``marks`` raster
MOVED, CLEARED, CANOPY, BRUSH, THIN, WATER, SEDIMENT, RILL = (1 << i for i in range(8))

B8 = np.ones((3, 3), dtype=bool)  # 8-connected neighbourhood


# ------------------------------------------------------------------ small tools


def flight_offset(dz: np.ndarray) -> float:
    """A whole-flight vertical offset between two surfaces (m), or 0.

    A bad base-station height lifts every cell of a flight by the same amount;
    left in, it reads as "everything moved". Estimated as the median change of
    the cells that look unmoved (two passes: within ±15 cm, then ±4 cm of the
    first estimate). Only returned when most of the site is unmoved and the
    offset is small — a real, site-wide change is never cancelled.
    """
    fin = np.isfinite(dz)
    band = fin & (np.abs(dz) < OFFSET_BAND_M)
    if band.sum() < OFFSET_MIN_SHARE * max(fin.sum(), 1):
        return 0.0
    first = float(np.median(dz[band]))
    still = fin & (np.abs(dz - first) < 0.04)
    if still.sum() < OFFSET_MIN_SHARE * fin.sum():
        return 0.0
    off = float(np.median(dz[still]))
    return off if abs(off) <= OFFSET_MAX_M else 0.0


def despeckle(mask: np.ndarray, min_neighbours: int = 4) -> np.ndarray:
    """Keep cells with at least ``min_neighbours`` marked cells in their 3x3 block (themselves included).

    Scan noise flips scattered single cells over a threshold; real change
    comes in patches. Patch edges keep (an edge cell has ~6 marked neighbours).
    """
    n = ndimage.convolve(mask.astype(np.int16), np.ones((3, 3), dtype=np.int16), mode="constant")
    return mask & (n >= min_neighbours)


def _shape(cols: np.ndarray, rows: np.ndarray, cell: float) -> Tuple[float, float, np.ndarray, np.ndarray]:
    """Length and width (m) of a set of cell or point positions, and its centre and long axis."""
    pts = np.column_stack([cols, rows]).astype(float)
    centre = pts.mean(axis=0)
    if len(pts) < 2:
        return cell, cell, centre, np.array([1.0, 0.0])
    cov = np.cov((pts - centre).T)
    vals, vecs = np.linalg.eigh(cov)
    axis = vecs[:, 1]
    along = (pts - centre) @ axis
    length = float(np.ptp(along)) + cell
    width = max(float(np.sqrt(12 * max(vals[0], 0.0))), cell)  # a uniform strip of width w has variance w²/12
    return length, width, centre, axis


def _patches(mask: np.ndarray, min_cells: float) -> np.ndarray:
    """Only the 8-connected patches of ``mask`` with at least ``min_cells`` cells."""
    lab, n = ndimage.label(mask, structure=B8)
    if not n:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    return np.isin(lab, 1 + np.flatnonzero(sizes >= min_cells))


def edge_weighted_area(mask: np.ndarray, cell: float, edge_share: float = 0.75) -> float:
    """Area of a mask, counting cells on its edge (a 4-neighbour outside) as ``edge_share`` of a cell.

    A crown marks every cell any of its points falls in, so whole edge cells
    overstate it (by ~17 % on the demo's 1 m grid) and half cells understate
    it (~10 %): a crown edge cell is mostly covered. Three quarters lands
    within ~5 % of the demo's true crown area.
    """
    inner = ndimage.binary_erosion(mask, structure=ndimage.generate_binary_structure(2, 1), border_value=0)
    edge = mask & ~inner
    return float((inner.sum() + edge_share * edge.sum()) * cell * cell)


# ------------------------------------------------------------------ vegetation


def vegetation(veg: np.ndarray, cell: float) -> dict:
    """Canopy and brush from a vegetation-height raster (m above ground, NaN = none).

    Trees are canopy peaks: a cell taller than every neighbour (and > 2 m).
    Neighbouring trees whose crowns touch still count separately if each has
    its own top; two trees with one merged top count once.
    """
    v = np.where(np.isfinite(veg), veg, 0.0)
    canopy = v > CANOPY_M
    brush = (v >= BRUSH_M) & ~canopy
    peaks = canopy & (v > TREE_MIN_M) & (v >= ndimage.maximum_filter(v, size=3, mode="constant"))
    _, trees = ndimage.label(peaks, structure=B8)  # equal-height neighbours are one top
    _, canopy_patches = ndimage.label(canopy, structure=B8)
    lab, n = ndimage.label(brush, structure=B8)
    sizes = ndimage.sum(brush, lab, range(1, n + 1)) if n else np.zeros(0)
    return {
        "canopy_m2": edge_weighted_area(canopy, cell),
        "brush_m2": float(brush.sum() * cell * cell),
        "trees": int(trees),
        "canopy_patches": int(canopy_patches),
        "brush_patches": int((sizes * cell * cell >= 3.0).sum()),
        "canopy": canopy,
        "brush": brush,
    }


# ------------------------------------------------------------------ machines


def machines(obj: np.ndarray, cell: float) -> List[dict]:
    """Machines seen in an object-height raster (m above ground, NaN = nothing).

    A machine is a blob of cells at least ``MACHINE_GROW_M`` tall with at
    least ``MACHINE_MIN_M2`` standing 1.5–5 m tall. Pieces closer than
    ``MACHINE_JOIN_M`` are one machine when together they're still machine-sized
    (an excavator's arm and its house), so two machines parked close stay two.
    Long thin blobs (a pipe, a fence, a wall) are left out. Returns grid
    positions (col, row as floats, cell centres at +0.5) and size.
    """
    from scipy.spatial.distance import cdist

    h = np.where(np.isfinite(obj), obj, 0.0)
    low = h >= MACHINE_GROW_M
    lab, n = ndimage.label(low, structure=B8)
    pieces = [np.argwhere(lab == i) for i in range(1, n + 1)]
    pieces = [p for p in pieces if len(p)]

    def fits(p: np.ndarray) -> bool:
        length, width, _, _ = _shape(p[:, 1] * cell, p[:, 0] * cell, cell)
        return length <= MACHINE_MAX_LENGTH_M and width <= MACHINE_MAX_WIDTH_M

    merged = True
    while merged:  # join the closest pair that still makes one machine, until none does
        merged = False
        for a in range(len(pieces)):
            for b in range(a + 1, len(pieces)):
                gap = (cdist(pieces[a], pieces[b]).min() - 1) * cell
                both = np.vstack([pieces[a], pieces[b]])
                if gap <= MACHINE_JOIN_M and fits(both):
                    pieces[a] = both
                    del pieces[b]
                    merged = True
                    break
            if merged:
                break

    out = []
    for p in pieces:
        rows, cols = p[:, 0], p[:, 1]
        heights = h[rows, cols]
        tall = (heights >= MACHINE_MIN_M) & (heights <= MACHINE_MAX_M)
        if tall.sum() * cell * cell < MACHINE_MIN_M2 or np.percentile(heights, 95) > MACHINE_MAX_M:
            continue
        length, width, centre, _ = _shape(cols * cell, rows * cell, cell)
        if length / width >= 6 and width <= 1.5:  # a pipe in a trench, a fence: not a machine
            continue
        out.append({
            "col": float(cols.mean() + 0.5), "row": float(rows.mean() + 0.5),
            "length_m": round(length, 1), "width_m": round(width, 1),
            "height_m": round(float(np.percentile(heights[tall], 95)), 2),
            "area_m2": float(len(rows) * cell * cell),
        })
    return sorted(out, key=lambda m: (-m["row"], m["col"]))  # north to south, then west to east


# ------------------------------------------------------------------ coverage and water


def thin_ground(ground_density: np.ndarray, coverage: np.ndarray, cell: float) -> np.ndarray:
    """Cells the flight covered but with fewer than one ground point per m²."""
    return (coverage > 0) & (ground_density / (cell * cell) < THIN_GROUND_PER_M2)


def no_return_patches(density: np.ndarray, density_before: Optional[np.ndarray], cell: float) -> Tuple[np.ndarray, List[dict]]:
    """Patches with no laser return at all, inside ground the flight did see — possibly standing water.

    Water absorbs or mirrors the laser away, so a puddle is a hole in the
    points. Random gaps are single cells; a patch must be at least
    ``WATER_MIN_M2``, mostly surrounded by covered ground (not the edge of the
    flight), and seen by the previous flight. Area counts each empty cell
    fully, plus the empty share of its partly-covered neighbours (a 4.5 m
    puddle covers half of many edge cells).
    """
    empty = density == 0
    lab, n = ndimage.label(empty)
    mask = np.zeros(density.shape, dtype=bool)
    found = []
    covered = density[density > 0]
    typical = float(np.median(covered)) if covered.size else 1.0
    ny, nx = density.shape
    for i in range(1, n + 1):
        blob = lab == i
        cells = int(blob.sum())
        if cells * cell * cell < WATER_MIN_M2:
            continue
        rows, cols = np.nonzero(blob)
        if rows.min() == 0 or cols.min() == 0 or rows.max() == ny - 1 or cols.max() == nx - 1:
            continue  # the edge of the flight, not a puddle
        ring = ndimage.binary_dilation(blob, structure=B8) & ~blob
        if (density[ring] > 0).mean() < WATER_RING_COVERED:
            continue
        if density_before is not None and (density_before[blob] > 0).mean() < 0.8:
            continue  # the previous flight didn't see it either: not new
        partial = float(np.clip(1 - density[ring] / typical, 0, 1).sum())
        mask |= blob
        found.append({"col": float(cols.mean() + 0.5), "row": float(rows.mean() + 0.5),
                      "area_m2": round((cells + partial) * cell * cell, 1)})
    return mask, found


def dark_ground(intensity: np.ndarray, ground_n: np.ndarray) -> np.ndarray:
    """Ground cells much darker than the flight's typical ground (wet soil, silt, organic matter).

    ``intensity`` is the mean raw ground reflectance per cell. Relative to the
    flight's own median, so it works whatever scale the sensor records in.
    """
    seen = ground_n > 0
    if not seen.any():
        return np.zeros(intensity.shape, dtype=bool)
    typical = float(np.median(intensity[seen]))
    return seen & (intensity < DARK_FRACTION * typical)


# ------------------------------------------------------------------ rills


def _bilinear(z: np.ndarray, x: np.ndarray, y: np.ndarray, cell: float) -> np.ndarray:
    """Surface ``z`` (cell centres at (i + 0.5)·cell) sampled at local x, y; nearest cell where a corner is missing."""
    ny, nx = z.shape
    fx = np.clip(x / cell - 0.5, 0, nx - 1)
    fy = np.clip(y / cell - 0.5, 0, ny - 1)
    c0 = np.minimum(np.floor(fx).astype(int), nx - 2) if nx > 1 else np.zeros(len(x), int)
    r0 = np.minimum(np.floor(fy).astype(int), ny - 2) if ny > 1 else np.zeros(len(y), int)
    c1, r1 = np.minimum(c0 + 1, nx - 1), np.minimum(r0 + 1, ny - 1)
    tx, ty = fx - c0, fy - r0
    v = ((1 - tx) * (1 - ty) * z[r0, c0] + tx * (1 - ty) * z[r0, c1] + (1 - tx) * ty * z[r1, c0] + tx * ty * z[r1, c1])
    near = z[np.clip(np.round(fy).astype(int), 0, ny - 1), np.clip(np.round(fx).astype(int), 0, nx - 1)]
    return np.where(np.isfinite(v), v, near)


def _cell_median(values: np.ndarray, cells: np.ndarray, n_cells: int) -> np.ndarray:
    """Median of ``values`` per cell index (NaN where a cell has none)."""
    out = np.full(n_cells, np.nan)
    if not len(values):
        return out
    order = np.lexsort((values, cells))
    c, v = cells[order], values[order]
    starts = np.flatnonzero(np.r_[True, c[1:] != c[:-1]])
    counts = np.diff(np.r_[starts, len(c)])
    lo = v[starts + (counts - 1) // 2]
    hi = v[starts + counts // 2]
    out[c[starts]] = (lo + hi) / 2
    return out


def _nan_median3(a: np.ndarray) -> np.ndarray:
    """3x3 median ignoring NaN."""
    ny, nx = a.shape
    p = np.pad(a, 1, constant_values=np.nan)
    stack = np.stack([p[r:r + ny, c:c + nx] for r in range(3) for c in range(3)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN blocks are expected: unscanned ground
        return np.nanmedian(stack, axis=0)


def rills(px: np.ndarray, py: np.ndarray, pz: np.ndarray, before: np.ndarray, cell: float, threshold: float,
          offset: float = 0.0, blocked: Optional[np.ndarray] = None) -> Tuple[np.ndarray, List[dict]]:
    """Erosion rills: narrow channels cut into the ground since the previous flight.

    ``px, py, pz``: this flight's ground points in grid-local metres (x east
    from the grid's west edge, y north from its south edge). ``before``: the
    previous flight's surface on the grid. ``blocked``: cells to ignore
    (machines). Steps:

    1. each point's change since before (bilinear on the old surface, minus
       any whole-flight offset);
    2. the surrounding change: the 3x3-cell median of the per-cell median
       change — fill being placed, a cut going down — and each point's drop
       below it;
    3. points that dropped more than the threshold and 3.5 noise sigmas below
       their surroundings, clustered on a 0.5 m grid (gaps up to 1 m bridged);
    4. a cluster is a rill if it is at least 3 m long, 3x longer than wide,
       shallower than 1 m (deeper was dug: a trench), and lower than the ground
       on BOTH sides by more than the threshold (the edge of a cut or a kerb is
       a step, low on one side only).

    Returns a cell mask of rill cells and, per rill, its centre, end points (local
    metres), length, width, depth (90th percentile of the drop, so "up to"),
    and eroded volume (mean drop over a strip around the channel × its area).
    """
    ny, nx = before.shape
    mask = np.zeros((ny, nx), dtype=bool)
    if len(px) < 50:
        return mask, []
    ci = np.clip((px / cell).astype(int), 0, nx - 1)
    ri = np.clip((py / cell).astype(int), 0, ny - 1)
    flat = ri * nx + ci
    old = _bilinear(before, px, py, cell)
    ok = np.isfinite(old)
    if blocked is not None:
        ok &= ~blocked.ravel()[flat]
    px, py, z, flat, ci, ri = px[ok], py[ok], pz[ok], flat[ok], ci[ok], ri[ok]
    change = z - old[ok] - offset
    around = _nan_median3(_cell_median(change, flat, nx * ny).reshape(ny, nx)).ravel()[flat]
    drop = change - around
    fin = np.isfinite(drop)
    if fin.sum() < 50:
        return mask, []
    sigma = 1.4826 * float(np.median(np.abs(drop[fin] - np.median(drop[fin]))))
    limit = max(threshold, RILL_SIGMA * sigma)
    low = fin & (drop < -limit)

    f = RILL_CELL_M
    fnx, fny = int(np.ceil(nx * cell / f)), int(np.ceil(ny * cell / f))
    fc = np.clip((px / f).astype(int), 0, fnx - 1)
    fr = np.clip((py / f).astype(int), 0, fny - 1)
    fine = np.zeros((fny, fnx), dtype=bool)
    fine[fr[low], fc[low]] = True
    lab, n = ndimage.label(ndimage.binary_dilation(fine, structure=B8), structure=B8)
    point_label = np.where(low, lab[fr, fc], 0)
    found = []
    idx = np.flatnonzero(point_label)
    order = idx[np.argsort(point_label[idx], kind="stable")]
    groups = np.split(order, np.flatnonzero(np.diff(point_label[order])) + 1) if len(order) else []
    for g in groups:
        if len(g) < RILL_MIN_POINTS:
            continue
        length, width, centre, axis = _shape(px[g], py[g], 0.0)
        width = max(width, f)
        if length < RILL_MIN_LENGTH_M or length / width < RILL_MIN_ELONGATION:
            continue
        depths = -drop[g]
        if np.median(depths) > RILL_MAX_DEPTH_M:
            continue  # dug on purpose
        # the banks: the ground either side of the channel, over the same stretch
        rel = np.column_stack([px - centre[0], py - centre[1]])
        along, across = rel @ axis, rel @ np.array([-axis[1], axis[0]])
        a0, a1 = (rel[g] @ axis).min(), (rel[g] @ axis).max()
        stretch = (along >= a0) & (along <= a1) & fin
        left = stretch & (across <= -RILL_SIDE_M[0]) & (across >= -RILL_SIDE_M[1])
        right = stretch & (across >= RILL_SIDE_M[0]) & (across <= RILL_SIDE_M[1])
        if left.sum() < 4 or right.sum() < 4:
            continue
        bottom = float(np.median(change[g]))
        if min(np.median(change[left]), np.median(change[right])) - bottom <= threshold:
            continue  # low on one side only: the edge of a cut, a kerb, a slab — not a channel
        # ...and a channel in today's ground too, not just in the change: the toe of a growing
        # pile or a batter reads as a "drop" next to the old surface's bend, but has no bank on
        # its flat side. Elevations are compared after removing the fall along the channel.
        near = stretch & (np.abs(across) <= RILL_SIDE_M[1])
        fall = np.polyfit(along[near], z[near], 1) if near.sum() >= 3 else np.array([0.0, float(np.median(z[near]))])
        level = z - np.polyval(fall, along)
        if min(np.median(level[left]), np.median(level[right])) - float(np.median(level[g])) <= threshold:
            continue
        strip = stretch & (np.abs(across) <= width / 2 + 0.5)
        strip_area = (a1 - a0 + f) * (width + 1.0)
        volume = max(0.0, float(-np.mean(drop[strip])) * strip_area) if strip.any() else 0.0
        mask[ri[g], ci[g]] = True
        ends = [centre + axis * a0, centre + axis * a1]
        found.append({
            "x": float(centre[0]), "y": float(centre[1]),
            "line": [[float(p[0]), float(p[1])] for p in ends],
            "length_m": round(length, 1), "width_m": round(width, 1),
            "depth_m": round(float(np.percentile(depths, 90)), 3),
            "mean_depth_m": round(float(np.mean(depths)), 3),
            "volume_m3": round(volume, 2),
            "worked": bool(abs(float(np.nanmedian(around[g]))) > threshold),  # on ground being filled / cut this period
        })
    return mask, sorted(found, key=lambda r: r["x"])


# ------------------------------------------------------------------ one site


def _grid(flat: list, ny: int, nx: int) -> np.ndarray:
    return sites._grid_array(flat, ny, nx)


def _flight_points(project_id: str, x0: float, y0: float, nx: int, ny: int, cell: float) -> dict:
    """A flight's ground points (grid-local x, y, z) and per-cell mean raw ground intensity."""
    full, _ = service._load_full(project_id)
    cls = full.channels.get("classification")
    ground = (np.asarray(cls) == sites.GROUND_CLASS) if cls is not None and (np.asarray(cls) == sites.GROUND_CLASS).any() else np.ones(full.size, bool)
    x, y, z = full.points[ground, 0] - x0, full.points[ground, 1] - y0, full.points[ground, 2]
    inside = (x >= 0) & (y >= 0) & (x < nx * cell) & (y < ny * cell)
    x, y, z = x[inside], y[inside], z[inside]
    flat = (y / cell).astype(int) * nx + (x / cell).astype(int)
    n = np.bincount(flat, minlength=nx * ny)
    if full.has("intensity"):
        vals = np.asarray(full.channels["intensity"], dtype=float)[ground][inside]
        intensity = np.bincount(flat, weights=vals, minlength=nx * ny) / np.maximum(n, 1)
    else:
        intensity = None
    has_color = all(full.has(c) for c in ("red", "green", "blue"))
    return {"x": x, "y": y, "z": z, "n": n.reshape(ny, nx),
            "intensity": None if intensity is None else intensity.reshape(ny, nx), "has_color": has_color}


def _arrays(site_id: str, project_id: str) -> dict:
    header, arrays = sites.rasters(site_id, project_id)
    return {"classified": header["classified"], **{name: a for name, a in arrays}}


_cache: Dict[tuple, tuple] = {}
_lock = threading.Lock()


def analyse(site_id: str) -> tuple:
    """Every flight's conditions: ``(header, arrays)`` for ``binary.pack``.

    The header holds the grid and one entry per flight (see ``_flight``); the
    arrays are one ``marks<k>`` (u1, ny x nx) per flight: bits MOVED, CLEARED,
    CANOPY, BRUSH, THIN, WATER, SEDIMENT, RILL. Cached.
    """
    site = sites.load(site_id)
    g = sites.grids(site_id)
    members = [s.project_id for s in site.scans] + ([site.design_id] if site.design_id else [])
    key = (site_id, *(sites._member_stamp(pid) for pid in dict.fromkeys(members)), site.change_threshold_m,
           site.tolerance_m, g["nx"], g["ny"], g["cell_size"])
    with _lock:
        if key in _cache:
            return _cache[key]

    nx, ny, cell = g["nx"], g["ny"], g["cell_size"]
    thr, tol = site.change_threshold_m, site.tolerance_m
    design = _grid(g["design"], ny, nx) if g["design"] else None
    surfaces = [_grid(s["z"], ny, nx) for s in g["scans"]]
    flights, arrays = [], []
    prev: Optional[dict] = None
    first_veg = None
    for k, s in enumerate(g["scans"]):
        r = _arrays(site_id, s["project_id"])
        pts = _flight_points(s["project_id"], g["x0"], g["y0"], nx, ny, cell)
        z = surfaces[k]
        veg = vegetation(r["veg_height"], cell)
        green = veg["canopy"] | veg["brush"]
        bare = ~np.isfinite(r["veg_height"])  # no vegetation return at all: cleared (a low brush top isn't)
        if first_veg is None:
            first_veg = green
        marks = np.zeros((ny, nx), dtype=np.uint8)
        marks[veg["canopy"]] |= CANOPY
        marks[veg["brush"]] |= BRUSH

        # disturbed since the first flight: ground moved, or vegetation cleared
        dz0 = z - surfaces[0]
        off0 = flight_offset(dz0) if k else 0.0
        moved = despeckle(np.isfinite(dz0) & (np.abs(dz0 - off0) > thr)) if k else np.zeros_like(green)
        cleared = ndimage.binary_opening(first_veg & bare, structure=B8)  # a few stray cells aren't clearing
        marks[moved] |= MOVED
        marks[cleared] |= CLEARED

        thin = thin_ground(r["ground_density"], r["coverage"], cell)
        marks[thin] |= THIN
        found_machines = machines(r["object_height"], cell)
        objects = np.isfinite(r["object_height"]) & (r["object_height"] >= MACHINE_GROW_M)

        storm = {"rills": [], "water": [], "offset_m": 0.0, "dark_m2": 0.0}
        if prev is not None:
            dz = z - surfaces[k - 1]
            off = flight_offset(dz)
            near_objects = ndimage.binary_dilation(objects | prev["objects"], structure=B8, iterations=2)
            rill_mask, found_rills = rills(pts["x"], pts["y"], pts["z"], surfaces[k - 1], cell, thr, off, near_objects)
            marks[rill_mask] |= RILL
            water_mask, water = no_return_patches(r["density"], prev["density"], cell)
            marks[water_mask] |= WATER
            # sediment candidates: rose where no fill is designed, or newly dark and wet
            rose = np.isfinite(dz) & (dz - off > thr) & ~objects & ~near_objects
            if design is not None:
                rose &= design <= surfaces[k - 1] + tol
            rose = _patches(despeckle(rose), DARK_MIN_M2 / (cell * cell))
            if pts["intensity"] is not None and prev["intensity"] is not None:
                dark = dark_ground(pts["intensity"], pts["n"]) & ~dark_ground(prev["intensity"], prev["n"]) & (prev["n"] > 0)
                dark = _patches(dark, DARK_MIN_M2 / (cell * cell))
                storm["dark_m2"] = float(dark.sum() * cell * cell)
            else:
                dark = np.zeros_like(rose)
            marks[rose | dark] |= SEDIMENT
            storm.update(rills=found_rills, water=water, offset_m=round(off, 4))

        flights.append({
            "project_id": s["project_id"], "date": s["date"],
            "classified": bool(r["classified"]), "has_color": bool(pts["has_color"]) and "photo" in r,
            "has_intensity": pts["intensity"] is not None,
            "offset_vs_first_m": round(off0, 4),
            "vegetation": {k2: v for k2, v in veg.items() if k2 not in ("canopy", "brush")},
            "cleared_since_previous_m2": float((ndimage.binary_opening(prev["green"] & bare, structure=B8).sum() if prev else 0) * cell * cell),
            "machines": [{**m, "e": g["x0"] + m["col"] * cell, "n": g["y0"] + m["row"] * cell} for m in found_machines],
            "disturbed": {"moved_m2": float(moved.sum() * cell * cell), "cleared_m2": float(cleared.sum() * cell * cell),
                          "total_m2": float((moved | cleared).sum() * cell * cell)},
            "coverage": {"covered_m2": float((r["coverage"] > 0).sum() * cell * cell), "thin_m2": float(thin.sum() * cell * cell),
                         "ground_per_m2": float(np.median(r["ground_density"][r["coverage"] > 0]) / (cell * cell)) if (r["coverage"] > 0).any() else 0.0},
            "storm": {**storm,
                      "rills": [{**rl, "e": g["x0"] + rl["x"], "n": g["y0"] + rl["y"],
                                 "line": [[g["x0"] + p[0], g["y0"] + p[1]] for p in rl["line"]]} for rl in storm["rills"]],
                      "water": [{**w, "e": g["x0"] + w["col"] * cell, "n": g["y0"] + w["row"] * cell} for w in storm["water"]]},
        })
        arrays.append((f"marks{k}", marks))
        prev = {"density": r["density"], "intensity": pts["intensity"], "n": pts["n"], "green": green, "objects": objects}

    header = {"site_id": site_id, "nx": nx, "ny": ny, "cell_size": cell, "x0": g["x0"], "y0": g["y0"],
              "threshold_m": thr, "flights": flights}
    result = (header, arrays)
    with _lock:
        for old in [k for k in _cache if k[0] == site_id]:
            del _cache[old]
        _cache[key] = result
    return result


# ------------------------------------------------------------------ the site's own outlines
# The interface does this part (conditions.ts: siteFindings) so edits answer
# instantly; the same few lines here let the tests check the demo's truth.


def polygon_cells(poly: List[List[float]], nx: int, ny: int, cell: float, x0: float, y0: float) -> np.ndarray:
    """Cells whose centre lies inside ``poly`` (even-odd rule, like progress.ts zoneCells)."""
    xs = x0 + (np.arange(nx) + 0.5) * cell
    ys = y0 + (np.arange(ny) + 0.5) * cell
    gx, gy = np.meshgrid(xs, ys)
    inside = np.zeros((ny, nx), dtype=bool)
    m = len(poly)
    for i in range(m):
        (xa, ya), (xb, yb) = poly[i], poly[i - 1]
        crosses = (ya > gy) != (yb > gy)
        with np.errstate(divide="ignore", invalid="ignore"):
            xc = xa + (gy - ya) * (xb - xa) / (yb - ya)
        inside ^= crosses & (gx < xc)
    return inside


def site_summary(site: sites.Site, header: dict, arrays: List[Tuple[str, np.ndarray]],
                 surfaces: Optional[List[np.ndarray]] = None) -> List[dict]:
    """Per flight: disturbed area outside the limits of disturbance, and pond sediment.

    Sediment in a pond: SEDIMENT cells inside the pond's zone; its volume is
    the rise of the cells that measurably rose (needs ``surfaces``).
    """
    nx, ny, cell, x0, y0 = header["nx"], header["ny"], header["cell_size"], header["x0"], header["y0"]
    lod = polygon_cells(site.lod, nx, ny, cell, x0, y0) if site.lod else None
    zones = {z.id: z for z in site.zones}
    ponds = [polygon_cells(zones[p.zone_id].polygon, nx, ny, cell, x0, y0) for p in site.ponds if p.zone_id in zones]
    pond = np.any(ponds, axis=0) if ponds else np.zeros((ny, nx), dtype=bool)
    out = []
    for k, (_, marks) in enumerate(arrays):
        disturbed = (marks & (MOVED | CLEARED)) > 0
        moved = (marks & MOVED) > 0
        sed = ((marks & SEDIMENT) > 0) & pond
        volume = 0.0
        if surfaces is not None and k > 0:
            off = header["flights"][k]["storm"]["offset_m"]
            dz = surfaces[k] - surfaces[k - 1] - off
            rose = sed & np.isfinite(dz) & (dz > header["threshold_m"])
            volume = float(dz[rose].sum() * cell * cell)
        out.append({
            "outside_lod_m2": float((disturbed & ~lod).sum() * cell * cell) if lod is not None else None,
            "moved_outside_lod_m2": float((moved & ~lod).sum() * cell * cell) if lod is not None else None,
            "sediment_m2": float(sed.sum() * cell * cell),
            "sediment_measured_m3": volume,
        })
    return out


@router.get("/api/sites/{site_id}/conditions")
def site_conditions(site_id: str) -> Response:
    """Everything each flight shows besides earthworks: vegetation, machines, disturbed
    ground, coverage and a storm check against the flight before (see conditions.py)."""
    try:
        header, arrays = analyse(site_id)
    except service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail=f"unknown site or scan '{exc.args[0]}'")
    return Response(content=binary.pack(header, arrays), media_type="application/octet-stream")
