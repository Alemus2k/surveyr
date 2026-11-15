"""Checks & records: fine-detail checks that work on a flight's points, not the
~1 m shared grid — a trench is 1.2 m wide and a sidewalk 2 m, so they need
every point.

- **Profiles and cross-sections** along a line (the primitive the others
  reuse): the ground under a polyline at fine spacing, from the points in a
  narrow band beside it, robust to noise (median per station).
- **Trench as-built**: length, width, depth below the adjacent ground, wall
  slope, the pipe (top, invert, slope) and the OSHA excavation prompts
  (29 CFR 1926 Subpart P) — protective system, spoil setback, ladder.
- **ADA slopes on flatwork**: running and cross slope of walks, ramps,
  landings and accessible parking, split into stretches by an optimal
  piecewise-plane fit so a failure must hold over enough points to be real.
- **Settlement monitors**: elevation change of an area against a baseline
  flight, averaged over small windows, with each flight levelled to the
  site's check points when it has them.

Everything here is metric and pure NumPy/SciPy. Results are cached per request
and per flight file + settings (``sites._member_stamp``).
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from typing import Callable, Dict, List, Literal, Optional, Tuple

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from scipy.interpolate import LinearNDInterpolator
from scipy.ndimage import median_filter
from scipy.spatial import cKDTree

from . import clean, service, sites
from .pcd import PointCloud

router = APIRouter()

# ------------------------------------------------------------------ constants

MIN_PTS = 3  # points a profile station needs before it reports an elevation
MAX_HALF_WINDOW = 1.0  # m: a station's window grows along the line up to ± this when points are sparse
OSHA_PROTECT_M = 5 * 0.3048  # 5 ft: deeper needs a protective system unless in stable rock
OSHA_LADDER_M = 4 * 0.3048  # 4 ft: a ladder, stair or ramp within 25 ft of travel
OSHA_SPOIL_M = 2 * 0.3048  # 2 ft: spoil and equipment kept back from the edge
OSHA_PE_M = 20 * 0.3048  # 20 ft: the protective system must be designed by a registered PE
TRENCH_MIN_DEPTH = 0.3  # m: shallower than this isn't an open trench
WALL_VERTICAL_RATIO = 0.25  # horizontal : vertical below this reads as a near-vertical wall
SPOIL_MIN_HEIGHT = 0.3  # m: a rise beside the trench this high is a spoil pile
ADA_LIMITS = {  # (running, cross) slope limits as fractions
    "walk": (0.05, 0.02),
    "ramp": (1 / 12, 0.02),
    "landing": (0.02, 0.02),
    "parking": (0.02, 0.02),
}
ADA_BIN = 0.5  # m along the walk: the finest stretch boundary
ADA_MIN_FAIL_M = 3.0  # m (~10 ft): a failure must hold over at least this length …
ADA_MIN_FAIL_PTS = 30  # … and this many points (shorter or thinner stretches can only be "worth a check")
ADA_MIN_SEG_PTS = 12  # points a stretch needs before its plane is trusted
ADA_PENALTY = 10.0  # cost of an extra stretch, in units of the point noise variance
ADA_Z = 2.0  # a stretch fails only when it's over the limit by this many standard errors
ADA_MARGIN = 0.002  # … and by at least 0.2 % — smaller excesses are a level's job
ADA_INSET = 0.05  # m: points this close to the outline are left out (curbs, pad edges)
MONITOR_WINDOW = 5  # cells: movement is averaged over this many cells square
MONITOR_MIN_ALERT_CELLS = 4
MONITOR_RISE_TOL = 0.015  # m: auto baselines treat a later rise beyond this as more fill, not movement  # an alert needs at least this many (averaged) cells over the limit
UNLEVELLED_UNCERTAINTY_M = 0.03  # a flight's own vertical error when there are no check points (±2–5 cm)


# ------------------------------------------------------------------ caching

_cache: "OrderedDict[str, object]" = OrderedDict()
_cache_lock = threading.Lock()
_CACHE_MAX = 64


def _cached(key: tuple, compute: Callable[[], object]) -> object:
    digest = hashlib.sha1(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()
    with _cache_lock:
        if digest in _cache:
            _cache.move_to_end(digest)
            return _cache[digest]
    value = compute()
    with _cache_lock:
        _cache[digest] = value
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return value


class FlightPoints:
    """A flight's points split for the checks: ground (what we measure), and
    objects (non-ground, non-vegetation — pipe, machines, structures)."""

    def __init__(self, ground: np.ndarray, objects: np.ndarray, classified: bool):
        self.ground = ground
        self.objects = objects
        self.classified = classified
        self.tree = cKDTree(ground[:, :2]) if len(ground) else None


def split_points(points: np.ndarray, classification: Optional[np.ndarray]) -> FlightPoints:
    """Ground and object points from a cloud (all points are ground when it has no classes)."""
    cls = classification.astype(int) if classification is not None else None
    classified = cls is not None and bool((cls == sites.GROUND_CLASS).any())
    noise = np.isin(cls, sites.NOISE_CLASSES) if cls is not None else np.zeros(len(points), dtype=bool)
    if classified:
        ground = cls == sites.GROUND_CLASS
        objects = ~ground & ~np.isin(cls, sites.VEGETATION_CLASSES) & ~noise
    else:
        ground = ~noise
        objects = np.zeros(len(points), dtype=bool)
    g = clean.remove_z_outliers(PointCloud(points[ground])).points
    return FlightPoints(g, points[objects], classified)


_flight_cache: "OrderedDict[tuple, FlightPoints]" = OrderedDict()


def flight_points(project_id: str) -> FlightPoints:
    """A flight's points (settings applied), split into ground and objects. Cached per file + settings."""
    key = sites._member_stamp(project_id)
    with _cache_lock:
        if key in _flight_cache:
            _flight_cache.move_to_end(key)
            return _flight_cache[key]
    full, _ = service._load_full(project_id)
    fp = split_points(full.points, full.channels.get("classification"))
    with _cache_lock:
        _flight_cache[key] = fp
        while len(_flight_cache) > 6:
            _flight_cache.popitem(last=False)
    return fp


def design_points(project_id: str) -> np.ndarray:
    """The design surface's points (a LandXML TIN arrives as a fine lattice)."""
    key = ("design",) + sites._member_stamp(project_id)
    with _cache_lock:
        if key in _flight_cache:
            return _flight_cache[key].ground
    cloud, _ = service._load_cloud(project_id)
    fp = FlightPoints(cloud.points, np.zeros((0, 3)), False)
    with _cache_lock:
        _flight_cache[key] = fp
    return fp.ground


# ------------------------------------------------------------------ line geometry

def polyline(points) -> Tuple[np.ndarray, np.ndarray, float]:
    """Vertices (n, 2), cumulative distance at each vertex, and total length."""
    p = np.asarray(points, dtype=float)[:, :2]
    seg = np.hypot(*np.diff(p, axis=0).T)
    keep = np.concatenate([[True], seg > 1e-9])  # drop repeated vertices
    p = p[keep]
    if len(p) < 2:
        raise ValueError("a line needs two distinct points")
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    return p, cum, float(cum[-1])


def point_at(p: np.ndarray, cum: np.ndarray, s) -> Tuple[np.ndarray, np.ndarray]:
    """Position (…, 2) and unit direction (…, 2) at distance ``s`` along the line (extended past the ends)."""
    s = np.asarray(s, dtype=float)
    k = np.clip(np.searchsorted(cum, s, side="right") - 1, 0, len(p) - 2)
    d = p[k + 1] - p[k]
    length = np.hypot(d[..., 0], d[..., 1])[..., None]
    u = d / length
    return p[k] + u * (s - cum[k])[..., None], u


def project(p: np.ndarray, cum: np.ndarray, xy: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """Distance along the line and signed offset (+ = right of the direction of travel) of each point.

    The first and last segments extend past the line's ends, so points just
    beyond an end get a negative / beyond-length station rather than a corner.
    """
    best = np.full(len(xy), np.inf)
    along = np.zeros(len(xy))
    off = np.zeros(len(xy))
    last = len(p) - 2
    for k in range(len(p) - 1):
        d = p[k + 1] - p[k]
        length = float(np.hypot(*d))
        rel = xy - p[k]
        t = rel @ d / (length * length)
        t = np.clip(t, -np.inf if k == 0 else 0.0, np.inf if k == last else 1.0)
        foot = p[k] + t[:, None] * d
        dist = np.hypot(*(xy - foot).T)
        better = dist < best
        best = np.where(better, dist, best)
        along = np.where(better, cum[k] + t * length, along)
        off = np.where(better, (rel[:, 0] * d[1] - rel[:, 1] * d[0]) / length, off)
    return along, off


def stations(length: float, step: float) -> np.ndarray:
    s = np.arange(0.0, length + 1e-9, step)
    if length - s[-1] > 1e-6:
        s = np.append(s, length)
    return s


def _near_line(pts: np.ndarray, p: np.ndarray, margin: float) -> np.ndarray:
    lo, hi = p.min(axis=0) - margin, p.max(axis=0) + margin
    return pts[(pts[:, 0] >= lo[0]) & (pts[:, 0] <= hi[0]) & (pts[:, 1] >= lo[1]) & (pts[:, 1] <= hi[1])]


# ------------------------------------------------------------------ profiles

def sample_profile(pts: np.ndarray, line, step: float, band: float, min_pts: int = MIN_PTS,
                   max_half: float = MAX_HALF_WINDOW, stat: Literal["median", "low"] = "median") -> dict:
    """The ground along a polyline: an elevation every ``step`` metres.

    Each station uses the points within ``band`` of the line (either side) and
    within a window along it that starts at ± ``step``/2 and doubles, up to
    ± ``max_half``, until it holds ``min_pts`` points; its elevation is their
    median ("low" = 25th percentile, to sit under grass or debris). Stations
    with too few points are NaN — a gap, never a guess.
    """
    p, cum, length = polyline(line)
    s = stations(length, step)
    sub = _near_line(pts, p, band + max_half)
    along, off = project(p, cum, sub[:, :2]) if len(sub) else (np.zeros(0), np.zeros(0))
    keep = (np.abs(off) <= band) & (along >= -max_half) & (along <= length + max_half)
    order = np.argsort(along[keep])
    a, z = along[keep][order], sub[keep][order, 2]

    halves = [max(step / 2, 0.05)]
    while halves[-1] < max_half:
        halves.append(min(halves[-1] * 2, max_half))
    chosen = np.full(len(s), halves[-1])
    lo = np.searchsorted(a, s - halves[-1])
    hi = np.searchsorted(a, s + halves[-1], side="right")
    for h in reversed(halves[:-1]):  # the smallest window that has enough points wins
        lo_h = np.searchsorted(a, s - h)
        hi_h = np.searchsorted(a, s + h, side="right")
        ok = hi_h - lo_h >= min_pts
        chosen = np.where(ok, h, chosen)
        lo = np.where(ok, lo_h, lo)
        hi = np.where(ok, hi_h, hi)
    zs = np.full(len(s), np.nan)
    n = hi - lo
    for i in np.flatnonzero(n >= min_pts):
        window = z[lo[i]:hi[i]]
        zs[i] = np.median(window) if stat == "median" else np.percentile(window, 25)
    xy, _ = point_at(p, cum, s)
    return {"station": s, "e": xy[:, 0], "n": xy[:, 1], "z": zs, "count": n, "window": np.where(n >= min_pts, 2 * chosen, np.nan)}


def surface_at(pts: np.ndarray, xy: np.ndarray, margin: float = 2.0) -> np.ndarray:
    """A surface (e.g. the design's TIN lattice) linearly interpolated at ``xy``; NaN outside it."""
    xy = np.asarray(xy, dtype=float)
    out = np.full(len(xy), np.nan)
    if len(xy) == 0 or len(pts) < 3:
        return out
    lo, hi = xy.min(axis=0) - margin, xy.max(axis=0) + margin
    m = (pts[:, 0] >= lo[0]) & (pts[:, 0] <= hi[0]) & (pts[:, 1] >= lo[1]) & (pts[:, 1] <= hi[1])
    near = pts[m]
    if len(near) < 3:
        return out
    centre = near[:, :2].mean(axis=0)  # survey coordinates are large: triangulate relative to the middle
    try:
        f = LinearNDInterpolator(near[:, :2] - centre, near[:, 2])
    except Exception:  # degenerate (collinear) points
        return out
    return np.asarray(f(xy - centre), dtype=float)


def cross_section_lines(line, interval: float, half_width: float) -> List[dict]:
    """Section lines across an alignment every ``interval`` metres: each from left to right."""
    p, cum, length = polyline(line)
    out = []
    for s in stations(length, interval):
        c, u = point_at(p, cum, s)
        right = np.array([u[1], -u[0]])
        out.append({"station": float(s), "e": float(c[0]), "n": float(c[1]),
                    "line": [(c - right * half_width).tolist(), (c + right * half_width).tolist()]})
    return out


def _r(a, digits: int = 3) -> list:
    return [None if v is None or not np.isfinite(v) else round(float(v), digits) for v in np.asarray(a, dtype=float)]


def sections(fp: FlightPoints, line, interval: float, half_width: float, design: Optional[np.ndarray] = None,
             previous: Optional[FlightPoints] = None, long_step: float = 0.25, long_band: float = 0.25) -> dict:
    """A long profile along an alignment and cross-sections across it, for one flight
    (and the design and the previous flight when given). Offsets: − left, + right."""
    p, cum, length = polyline(line)
    lp = sample_profile(fp.ground, line, long_step, long_band)
    xy = np.column_stack([lp["e"], lp["n"]])
    long = {"station": _r(lp["station"]), "e": _r(lp["e"]), "n": _r(lp["n"]), "flight": _r(lp["z"]),
            "previous": _r(sample_profile(previous.ground, line, long_step, long_band)["z"]) if previous else None,
            "design": _r(surface_at(design, xy)) if design is not None else None}
    step = float(np.clip(half_width / 60, 0.1, 0.5))
    band = float(min(1.0, max(interval / 4, 0.25)))  # along the alignment: sections are alike over a metre
    out = []
    for sec in cross_section_lines(line, interval, half_width):
        prof = sample_profile(fp.ground, sec["line"], step, band)
        offset = prof["station"] - half_width
        sxy = np.column_stack([prof["e"], prof["n"]])
        out.append({"station": round(sec["station"], 3), "e": round(sec["e"], 3), "n": round(sec["n"], 3),
                    "line": [[round(v, 3) for v in pt] for pt in sec["line"]],
                    "offset": _r(offset), "flight": _r(prof["z"]),
                    "previous": _r(sample_profile(previous.ground, sec["line"], step, band)["z"]) if previous else None,
                    "design": _r(surface_at(design, sxy)) if design is not None else None})
    return {"length_m": round(length, 3), "long_step_m": long_step, "long_band_m": long_band, "section_step_m": step,
            "section_band_m": band, "long": long, "sections": out}


# ------------------------------------------------------------------ trench as-built

def _order_stat_span(values: np.ndarray) -> Tuple[float, float]:
    """Centre and full width of the interval uniformly sampled values came from
    (min/max widened by the expected gap: (max − min)(n + 1)/(n − 1))."""
    lo, hi = float(values.min()), float(values.max())
    n = len(values)
    width = (hi - lo) * (n + 1) / max(n - 1, 1)
    return (lo + hi) / 2, width


def _crossing(x: np.ndarray, y: np.ndarray, level: float) -> float:
    """First x where a (made monotonic) rising curve reaches ``level``; NaN if it never does."""
    ok = np.isfinite(y)
    x, y = x[ok], np.maximum.accumulate(y[ok]) if ok.any() else y[ok]
    if len(y) == 0 or y[-1] < level:
        return float("nan")
    i = int(np.argmax(y >= level))
    if i == 0:
        return float(x[0])
    return float(np.interp(level, [y[i - 1], y[i]], [x[i - 1], x[i]])) if y[i] > y[i - 1] else float(x[i])


def _binned_median(x: np.ndarray, y: np.ndarray, edges: np.ndarray, min_n: int = 3) -> np.ndarray:
    idx = np.digitize(x, edges) - 1
    out = np.full(len(edges) - 1, np.nan)
    for b in range(len(edges) - 1):
        v = y[idx == b]
        if len(v) >= min_n:
            out[b] = np.median(v)
    return out


def analyse_trench(fp: FlightPoints, line, diameter: float, every: float = 5.0, seg_half: float = 2.5,
                   reach: float = 6.0) -> dict:
    """Measure an open trench from one flight's points along its drawn centreline.

    Every metre along the line, the points within ± ``seg_half`` m are put in
    trench coordinates (along, offset). The floor is the median ground in the
    middle of the trench; the adjacent ground is the lower of the two sides'
    medians just beyond the edges (a spoil pile only ever raises a side); the
    edges come from the deep points (below half depth), widened for sampling
    (order statistics). Walls, spoil and pipe pool every station's points:

    - wall slope: horizontal run between ¼ and ¾ depth over half the depth;
    - spoil: per side, the rise above that side's natural ground; its toe is
      extrapolated from where the rise reaches ¼ and ⅗ of the pile's height;
    - pipe: object (non-ground) points inside the trench below the edges; the
      top is a straight line fitted to the upper envelope; invert = top − diameter.
    """
    p, cum, length = polyline(line)
    ground = _near_line(fp.ground, p, reach + seg_half + 3)
    objects = _near_line(fp.objects, p, reach + seg_half + 3) if len(fp.objects) else np.zeros((0, 3))
    ga, go = project(p, cum, ground[:, :2]) if len(ground) else (np.zeros(0), np.zeros(0))
    gz = ground[:, 2] if len(ground) else np.zeros(0)

    rows = _trench_stations(ga, go, gz, stations(length, 1.0), seg_half, reach, (-np.inf, np.inf))
    opened = [r for r in rows if r["open"]]
    base = {"length_m": round(length, 3), "diameter_m": diameter, "classified": fp.classified}
    if not opened:
        return {**base, "open": False}
    s_from, s_to = _trench_extent(ga, go, gz, opened, length)
    # second pass: windows stop at the trench's ends, so end stations aren't half natural ground
    rows = _trench_stations(ga, go, gz, stations(length, 1.0), seg_half, reach, (s_from, s_to))
    opened = [r for r in rows if r["open"]] or opened

    # per-station values, interpolated to every point's station
    os_ = np.array([r["station"] for r in opened])
    interp = lambda key: np.interp(ga, os_, [r[key] for r in opened])  # noqa: E731
    c_at, hw_at, floor_at, top_at = interp("centre"), interp("half_width"), interp("floor"), interp("ground")
    depth_at = top_at - floor_at
    oc_all = go - c_at
    s_from, s_to = _trench_extent(ga, go, gz, opened, length)
    return _trench_report(p, cum, length, base, opened, os_, ga, gz, oc_all, hw_at, floor_at, top_at, depth_at,
                          objects, diameter, every, reach, s_from, s_to)


def _trench_extent(ga, go, gz, opened, length) -> Tuple[float, float]:
    """Where the trench is open along the line: the span of its deep ground points (order statistics)."""
    os_ = np.array([r["station"] for r in opened])
    interp = lambda key: np.interp(ga, os_, [r[key] for r in opened])  # noqa: E731
    c_at, hw_at, floor_at, top_at = interp("centre"), interp("half_width"), interp("floor"), interp("ground")
    depth_at = top_at - floor_at
    deep = (np.abs(go - c_at) < hw_at) & (gz < floor_at + 0.5 * depth_at) & (ga > -3) & (ga < length + 3)
    if deep.sum() >= 4:
        mid_s, span = _order_stat_span(ga[deep])
        return max(mid_s - span / 2, -3.0), min(mid_s + span / 2, length + 3)
    return float(os_[0]), float(os_[-1])


def _trench_stations(ga, go, gz, st, seg_half, reach, limits) -> List[dict]:
    """Per station: is the trench open, and its centre, half width, floor and adjacent ground."""
    rows = []
    lo, hi = limits
    for s in st:
        # near an end, slide the window inward so it stays full length inside the trench
        sc = float(np.clip(s, lo + seg_half, hi - seg_half)) if hi - lo > 2 * seg_half else s
        m = (np.abs(ga - sc) <= seg_half) & (np.abs(go) <= reach) & (ga >= lo) & (ga <= hi)
        a, o, z = ga[m], go[m], gz[m]
        row = {"station": float(s), "open": False}
        rows.append(row)
        mid = np.abs(o) < 0.4
        left, right = (o < -1.5) & (o > -reach), (o > 1.5) & (o < reach)
        if mid.sum() < MIN_PTS or left.sum() < MIN_PTS or right.sum() < MIN_PTS:
            continue
        floor0 = float(np.percentile(z[mid], 20))
        top0 = min(float(np.median(z[left])), float(np.median(z[right])))
        if top0 - floor0 < TRENCH_MIN_DEPTH:
            continue
        deep = (z < floor0 + 0.5 * (top0 - floor0)) & (np.abs(o) < 3.0)
        if deep.sum() < 4:
            continue
        c, width = _order_stat_span(o[deep])
        hw = width / 2
        oc = o - c
        inner = np.abs(oc) < max(0.5 * hw, 0.15)
        side_l = (oc < -hw - 0.1) & (oc > -hw - 1.0)
        side_r = (oc > hw + 0.1) & (oc < hw + 1.0)
        if inner.sum() < MIN_PTS or side_l.sum() < MIN_PTS or side_r.sum() < MIN_PTS:
            continue
        floor = float(np.median(z[inner]))
        top_l, top_r = float(np.median(z[side_l])), float(np.median(z[side_r]))
        top = min(top_l, top_r)
        if top - floor < TRENCH_MIN_DEPTH:
            continue
        row.update(open=True, centre=c, half_width=hw, floor=floor, ground=top, depth=top - floor,
                   ground_left=top_l, ground_right=top_r)
    return rows


def _trench_report(p, cum, length, base, opened, os_, ga, gz, oc_all, hw_at, floor_at, top_at, depth_at,
                   objects, diameter, every, reach, s_from, s_to) -> dict:
    # walls: normalised height against distance from the edge, pooled per side
    walls = {}
    for side, sign in (("left", -1), ("right", 1)):
        d = sign * oc_all - hw_at  # + outward from the edge
        reach_w = np.clip(1.5 * depth_at, 0.6, 4.0)
        m = (np.abs(d) <= reach_w) & (sign * oc_all > -0.05) & (ga >= os_[0] - 1) & (ga <= os_[-1] + 1) & (depth_at > TRENCH_MIN_DEPTH)
        h = (gz[m] - floor_at[m]) / depth_at[m]
        edges = np.arange(-4.0, 4.0001, 0.1)
        med = _binned_median(d[m], h, edges)
        centres = (edges[:-1] + edges[1:]) / 2
        d25, d75 = _crossing(centres, med, 0.25), _crossing(centres, med, 0.75)
        rise = 0.5 * float(np.mean([r["depth"] for r in opened]))
        ratio = (d75 - d25) / rise if np.isfinite(d25) and np.isfinite(d75) else float("nan")
        walls[side] = {"run_m": None if not np.isfinite(d75 - d25) else round(max(d75 - d25, 0.0), 3),
                       "ratio_h_to_v": None if not np.isfinite(ratio) else round(max(ratio, 0.0), 3),
                       "vertical": bool(np.isfinite(ratio) and ratio < WALL_VERTICAL_RATIO)}

    # spoil: rise above each side's natural ground, pooled along the trench
    spoil = {}
    for side, sign in (("left", -1), ("right", 1)):
        d = sign * oc_all - hw_at
        m = (d > 0.02) & (d < reach) & (ga >= os_[0] - 1) & (ga <= os_[-1] + 1)
        if m.sum() < 10:
            spoil[side] = {"present": False}
            continue
        natural = float(np.percentile(gz[m] - top_at[m], 10))
        dz = gz[m] - top_at[m] - natural
        edges = np.arange(0.0, reach + 1e-9, 0.1)
        med = _binned_median(d[m], dz, edges)
        centres = (edges[:-1] + edges[1:]) / 2
        crest = float(np.nanmax(med)) if np.isfinite(med).any() else 0.0
        if crest < SPOIL_MIN_HEIGHT:
            spoil[side] = {"present": False}
            continue
        top_i = int(np.nanargmax(med))
        crest_at = float(centres[top_i])
        rising = np.isfinite(med) & (np.arange(len(med)) <= top_i) & (med >= 0.15 * crest) & (med <= 0.75 * crest)
        d_a = _crossing(centres, med, 0.15 * crest)
        if rising.sum() >= 2:
            slope, icpt = np.polyfit(centres[rising], med[rising], 1)
            flat = d[m] < d_a - 0.1  # the strip between the edge and the pile
            level = float(np.median(dz[flat])) if flat.sum() >= 5 else 0.0
            toe = (level - icpt) / slope if slope > 0 else d_a
        else:
            toe = d_a
        spoil[side] = {"present": True, "height_m": round(crest, 3), "setback_m": round(max(toe, 0.0), 3),
                       "crest_m": round(crest_at, 3)}

    # pipe: object points inside the trench, below the edges
    pipe = {"seen": False}
    if len(objects):
        pa, po = project(p, cum, objects[:, :2])
        pc = np.interp(pa, os_, [r["centre"] for r in opened])
        phw = np.interp(pa, os_, [r["half_width"] for r in opened])
        pf = np.interp(pa, os_, [r["floor"] for r in opened])
        pt = np.interp(pa, os_, [r["ground"] for r in opened])
        pz = objects[:, 2]
        m = (np.abs(po - pc) <= phw + 0.1) & (pz > pf - 0.1) & (pz < pt - 0.1) & (pa >= s_from - 0.5) & (pa <= s_to + 0.5)
        if m.sum() >= 10:
            a, z = pa[m], pz[m]
            edges = np.arange(np.floor(a.min()), a.max() + 1.0, 1.0)
            idx = np.digitize(a, edges) - 1
            bs, bz = [], []
            for b in range(len(edges) - 1):
                v = z[idx == b]
                if len(v) >= 3:
                    bs.append(float(a[idx == b].mean()))
                    bz.append(float(np.percentile(v, 90)))
            if len(bs) >= 3:
                bs_a, bz_a = np.array(bs), np.array(bz)
                keep = np.ones(len(bs_a), dtype=bool)
                for _ in range(2):  # drop bins off the line (a fitting, a machine bucket)
                    coef = np.polyfit(bs_a[keep], bz_a[keep], 1)
                    res = bz_a - np.polyval(coef, bs_a)
                    mad = 1.4826 * np.median(np.abs(res[keep] - np.median(res[keep]))) or 0.01
                    keep = np.abs(res) <= max(3 * mad, 0.02)
                    if keep.sum() < 3:
                        keep[:] = True
                        break
                coef = np.polyfit(bs_a[keep], bz_a[keep], 1)
                res = bz_a[keep] - np.polyval(coef, bs_a[keep])
                pipe = {"seen": True, "slope_pct": round(float(coef[0]) * 100, 3),
                        "top_from_m": round(float(bs_a[keep].min()), 2), "top_to_m": round(float(bs_a[keep].max()), 2),
                        "fit_rms_m": round(float(np.sqrt(np.mean(res ** 2))), 4), "points": int(m.sum()),
                        "_coef": coef}

    # the record: every ``every`` metres, plus the ends
    table = []
    for s in stations(length, every):
        near = [r for r in opened if abs(r["station"] - s) <= 0.5 * every]
        if not near:
            continue
        r = min(near, key=lambda r: abs(r["station"] - s))
        xy, u = point_at(p, cum, s)
        right = np.array([u[1], -u[0]])
        xy = xy + right * r["centre"]
        top = float(np.polyval(pipe["_coef"], s)) if pipe["seen"] else None
        table.append({"station": round(float(s), 3), "e": round(float(xy[0]), 3), "n": round(float(xy[1]), 3),
                      "ground": round(r["ground"], 3), "floor": round(r["floor"], 3), "depth": round(r["depth"], 3),
                      "width": round(2 * r["half_width"], 3),
                      "pipe_top": None if top is None else round(top, 3),
                      "invert": None if top is None else round(top - diameter, 3)})

    depths = np.array([r["depth"] for r in opened])
    widths = np.array([2 * r["half_width"] for r in opened])
    deep_from = [r["station"] for r in opened if r["depth"] >= OSHA_PROTECT_M]
    vertical = any(w["vertical"] for w in walls.values())
    closest = min((v["setback_m"] for v in spoil.values() if v.get("present")), default=None)
    flags = []
    if depths.max() >= OSHA_PE_M:
        flags.append({"code": "pe_design", "level": "bad", "depth_m": round(float(depths.max()), 3)})
    if deep_from and vertical:
        flags.append({"code": "protective_system", "level": "bad", "depth_m": round(float(depths.max()), 3),
                      "from_m": deep_from[0], "to_m": deep_from[-1]})
    elif deep_from:
        flags.append({"code": "protective_system_sloped", "level": "warn", "depth_m": round(float(depths.max()), 3)})
    if closest is not None and closest < OSHA_SPOIL_M:
        side = min((k for k, v in spoil.items() if v.get("present")), key=lambda k: spoil[k]["setback_m"])
        flags.append({"code": "spoil_setback", "level": "bad", "setback_m": closest, "side": side})
    if depths.max() >= OSHA_LADDER_M:
        flags.append({"code": "ladder", "level": "info", "depth_m": round(float(depths.max()), 3)})
    if not pipe["seen"]:
        flags.append({"code": "pipe_not_seen", "level": "info"})

    ends = None
    if pipe["seen"]:
        coef = pipe.pop("_coef")
        ends = {"invert_start_m": round(float(np.polyval(coef, max(s_from, 0.0))) - diameter, 3),
                "invert_end_m": round(float(np.polyval(coef, min(s_to, length))) - diameter, 3),
                "top_start_m": round(float(np.polyval(coef, max(s_from, 0.0))), 3),
                "top_end_m": round(float(np.polyval(coef, min(s_to, length))), 3)}
        pipe.update(ends)
    p0, u0 = point_at(p, cum, 0.0)
    return {
        **base, "open": True,
        "from_m": round(s_from, 3), "to_m": round(s_to, 3), "trench_length_m": round(s_to - s_from, 3),
        "width_m": round(float(np.median(widths)), 3),
        "depth_mean_m": round(float(depths.mean()), 3), "depth_max_m": round(float(depths.max()), 3),
        "depth_min_m": round(float(depths.min()), 3),
        "walls": walls, "spoil": spoil, "pipe": pipe, "flags": flags, "table": table,
        "direction": [round(float(u0[0]), 4), round(float(u0[1]), 4)],
        "profile": {"station": [r["station"] for r in opened], "ground": _r([r["ground"] for r in opened]),
                    "floor": _r([r["floor"] for r in opened])},
    }


# ------------------------------------------------------------------ ADA slopes

def _inside(xy: np.ndarray, poly: np.ndarray) -> np.ndarray:
    x, y = xy[:, 0], xy[:, 1]
    inside = np.zeros(len(xy), dtype=bool)
    for (x1, y1), (x2, y2) in zip(poly, np.roll(poly, -1, axis=0)):
        with np.errstate(divide="ignore", invalid="ignore"):
            inside ^= ((y1 > y) != (y2 > y)) & (x < x1 + (y - y1) * (x2 - x1) / (y2 - y1))
    return inside


def _edge_distance(xy: np.ndarray, poly: np.ndarray) -> np.ndarray:
    best = np.full(len(xy), np.inf)
    for a, b in zip(poly, np.roll(poly, -1, axis=0)):
        d = b - a
        L2 = float(d @ d) or 1e-12
        t = np.clip((xy - a) @ d / L2, 0, 1)
        best = np.minimum(best, np.hypot(*(xy - a - t[:, None] * d).T))
    return best


def _moments(u: np.ndarray, v: np.ndarray, z: np.ndarray, bins: np.ndarray, nbins: int) -> np.ndarray:
    """Per-bin sums for plane fits: n, u, v, z, uu, uv, vv, uz, vz, zz."""
    cols = [np.ones_like(u), u, v, z, u * u, u * v, v * v, u * z, v * z, z * z]
    return np.column_stack([np.bincount(bins, weights=c, minlength=nbins) for c in cols])


def _fit(M: np.ndarray, ridge: float = 1e-9):
    """Plane z = a + b·u + c·v from summed moments (…, 10): coefficients, RSS, inverse normal matrix."""
    n, su, sv, sz, suu, suv, svv, suz, svz, szz = np.moveaxis(M, -1, 0)
    A = np.stack([np.stack([n, su, sv], -1), np.stack([su, suu, suv], -1), np.stack([sv, suv, svv], -1)], -2)
    A = A + ridge * np.eye(3)
    b = np.stack([sz, suz, svz], -1)
    coef = np.linalg.solve(A, b[..., None])[..., 0]
    rss = np.maximum(szz - np.sum(coef * b, axis=-1), 0.0)
    return coef, rss, np.linalg.inv(A)


def _segment(C: np.ndarray, beta: float, min_pts: int) -> List[Tuple[int, int]]:
    """Optimal split of bins into stretches, each fitted by its own plane:
    minimises Σ RSS + β per stretch (dynamic programming over prefix sums)."""
    B = len(C) - 1
    best = np.full(B + 1, np.inf)
    best[0] = 0.0
    prev = np.zeros(B + 1, dtype=int)
    for j in range(1, B + 1):
        M = C[j] - C[:j]
        n = M[:, 0]
        ok = n >= min_pts
        cost = np.full(j, np.inf)
        if ok.any():
            _, rss, _ = _fit(M[ok])
            cost[ok] = rss
        total = best[:j] + cost + beta
        i = int(np.argmin(total))
        best[j], prev[j] = total[i], i  # stays infinite until the bins so far hold enough points
    if not np.isfinite(best[B]):
        return [(0, B)]
    cuts, j = [], B
    while j > 0:
        i = int(prev[j])
        cuts.append((i, j))
        j = i
    return list(reversed(cuts))


def analyse_flatwork(ground: np.ndarray, polygon, kind: str) -> dict:
    """ADA running and cross slopes of a walk, ramp, landing or accessible stall.

    The outline's long axis (principal direction of the points inside) is the
    running direction. Points within ``ADA_INSET`` of the outline are dropped,
    and stray points (a curb, a cone) are removed against local planes. The
    points are binned every ``ADA_BIN`` along the axis and split into stretches
    by an optimal piecewise-plane fit (a new stretch has to pay for itself by
    explaining ``ADA_PENALTY`` noise variances), so a slope change is only
    found where enough points say so. Each stretch's plane gives its running and
    cross slope with standard errors; it **fails** when over the limit by both
    ``ADA_MARGIN`` and ``ADA_Z`` standard errors over at least ``ADA_MIN_FAIL_M``,
    and is **worth a check** when over by the margin and one standard error.
    """
    run_limit, cross_limit = ADA_LIMITS[kind]
    poly = np.asarray(polygon, dtype=float)
    lo, hi = poly.min(axis=0), poly.max(axis=0)
    box = (ground[:, 0] >= lo[0]) & (ground[:, 0] <= hi[0]) & (ground[:, 1] >= lo[1]) & (ground[:, 1] <= hi[1])
    pts = ground[box]
    inside = _inside(pts[:, :2], poly)
    pts = pts[inside]
    if len(pts):
        pts = pts[_edge_distance(pts[:, :2], poly) >= ADA_INSET]
    base = {"kind": kind, "running_limit_pct": round(run_limit * 100, 2), "cross_limit_pct": round(cross_limit * 100, 2),
            "points": int(len(pts))}
    if len(pts) < 2 * ADA_MIN_SEG_PTS:
        return {**base, "enough": False}

    centre = pts[:, :2].mean(axis=0)
    rel = pts[:, :2] - centre
    _, vecs = np.linalg.eigh(np.cov(rel.T))
    axis = vecs[:, -1]
    if axis[0] < -1e-9 or (abs(axis[0]) <= 1e-9 and axis[1] < 0):
        axis = -axis  # run west → east (or south → north)
    perp = np.array([-axis[1], axis[0]])  # left of the running direction
    u, v = rel @ axis, rel @ perp
    z0 = float(np.median(pts[:, 2]))
    z = pts[:, 2] - z0
    u0 = float(u.min())
    nb = max(1, int(np.ceil((float(u.max()) - u0) / ADA_BIN + 1e-9)))
    bins = np.minimum(((u - u0) / ADA_BIN).astype(int), nb - 1)

    # stray points: residual from the plane of the surrounding 2.5 m
    for _ in range(2):
        C = np.vstack([np.zeros(10), np.cumsum(_moments(u, v, z, bins, nb), axis=0)])
        a, b = np.clip(bins - 2, 0, nb), np.clip(bins + 3, 0, nb)
        coef, _, _ = _fit(C[b] - C[a])
        res = z - (coef[:, 0] + coef[:, 1] * u + coef[:, 2] * v)
        sigma = 1.4826 * float(np.median(np.abs(res - np.median(res)))) or 0.005
        keep = np.abs(res) <= 3.5 * sigma
        if keep.all():
            break
        u, v, z, bins, pts = u[keep], v[keep], z[keep], bins[keep], pts[keep]

    C = np.vstack([np.zeros(10), np.cumsum(_moments(u, v, z, bins, nb), axis=0)])
    a, b = np.clip(bins - 2, 0, nb), np.clip(bins + 3, 0, nb)
    coef, _, _ = _fit(C[b] - C[a])
    res = z - (coef[:, 0] + coef[:, 1] * u + coef[:, 2] * v)
    sigma = max(1.4826 * float(np.median(np.abs(res - np.median(res)))), 0.002)
    segs = _segment(C, ADA_PENALTY * sigma * sigma, ADA_MIN_SEG_PTS)

    def world(uu: float, vv: float) -> List[float]:
        xy = centre + axis * uu + perp * vv
        return [round(float(xy[0]), 3), round(float(xy[1]), 3)]

    vmin, vmax = float(v.min()), float(v.max())

    def describe(i: int, j: int) -> dict:
        M = C[j] - C[i]
        n = int(M[0])
        cf, rss, inv = _fit(M)
        s2 = float(rss) / max(n - 3, 1)
        s2 = max(s2, sigma * sigma)  # never claim better than the point noise allows
        se_run, se_cross = np.sqrt(s2 * inv[1, 1]), np.sqrt(s2 * inv[2, 2])
        f, t = u0 + i * ADA_BIN, min(u0 + j * ADA_BIN, float(u.max()))
        length = t - f
        out = {"from_m": round(f - u0, 3), "to_m": round(t - u0, 3), "length_m": round(length, 3), "points": n,
               "running_pct": round(float(cf[1]) * 100, 3), "cross_pct": round(float(cf[2]) * 100, 3),
               "running_se_pct": round(float(se_run) * 100, 3), "cross_se_pct": round(float(se_cross) * 100, 3),
               "outline": [world(f, vmin), world(t, vmin), world(t, vmax), world(f, vmax)],
               "start": world(f, 0.0), "end": world(t, 0.0), "middle": world((f + t) / 2, 0.0)}
        for comp, slope, se, limit in (("running", cf[1], se_run, run_limit), ("cross", cf[2], se_cross, cross_limit)):
            excess = abs(float(slope)) - limit
            if excess >= max(ADA_MARGIN, ADA_Z * se) and length >= ADA_MIN_FAIL_M - 1e-9 and n >= ADA_MIN_FAIL_PTS:
                status = "fail"
            elif excess >= max(ADA_MARGIN, se):
                status = "check"
            else:
                status = "ok"
            out[f"{comp}_status"] = status
        order = {"ok": 0, "check": 1, "fail": 2}
        out["status"] = max(out["running_status"], out["cross_status"], key=order.get)
        return out

    stretches = [describe(i, j) for i, j in segs]
    # local slopes for the chart: a 2 m window every bin (noisy at low density; the stretches are the verdict)
    local = []
    for k in range(nb):
        i, j = max(k - 1, 0), min(k + 3, nb)
        M = C[j] - C[i]
        if M[0] < 6:
            local.append(None)
            continue
        cf, _, _ = _fit(M)
        local.append({"at_m": round((k + 0.5) * ADA_BIN, 3), "running_pct": round(float(cf[1]) * 100, 2),
                      "cross_pct": round(float(cf[2]) * 100, 2)})
    length = float(u.max() - u0)
    return {**base, "enough": True, "length_m": round(length, 3), "width_m": round(vmax - vmin, 3),
            "noise_m": round(sigma, 4), "density_per_m2": round(len(u) / max(length * (vmax - vmin), 1e-6), 2),
            "axis": [round(float(axis[0]), 5), round(float(axis[1]), 5)], "start": world(u0, 0.0),
            "end": world(float(u.max()), 0.0), "stretches": stretches, "local": local}


# ------------------------------------------------------------------ settlement monitors

def _window_mean(z: np.ndarray, size: int, min_frac: float = 0.55) -> np.ndarray:
    """Mean over a size × size window, NaN where fewer than ``min_frac`` of it was measured."""
    k = size // 2
    ok = np.isfinite(z).astype(float)
    zz = np.where(np.isfinite(z), z, 0.0)
    pad = lambda a: np.pad(a, k)  # noqa: E731
    s, n = pad(zz), pad(ok)
    acc, cnt = np.zeros_like(z), np.zeros_like(z)
    for dr in range(size):
        for dc in range(size):
            acc += s[dr:dr + z.shape[0], dc:dc + z.shape[1]]
            cnt += n[dr:dr + z.shape[0], dc:dc + z.shape[1]]
    return np.where(cnt >= min_frac * size * size, acc / np.maximum(cnt, 1), np.nan)


def auto_baseline(z: np.ndarray, threshold: float, rise_tol: Optional[float] = None) -> np.ndarray:
    """Per cell, the first measured flight after which the earthwork had stopped —
    flights (K, …) in date order. Made for fills (what settlement monitors watch):

    - a cell that had been filled by then (risen by more than ``threshold``
      since its first flight) may afterwards settle by up to ``threshold``, but
      a rise beyond ``rise_tol`` means more fill was placed;
    - any other cell may afterwards move by up to ``rise_tol`` either way —
      bigger changes there are grading (a cut or a trim of a few centimetres
      looks just like settlement otherwise).

    So the baseline moves past every change that looks like work. A cell still
    changing at the last flight gets K − 1 (nothing to measure yet). To watch
    natural ground, a structure or heave, pick a fixed baseline flight instead.
    """
    rise_tol = MONITOR_RISE_TOL if rise_tol is None else rise_tol
    K = z.shape[0]
    base = np.full(z.shape[1:], K - 1, dtype=int)
    first = np.full(z.shape[1:], np.nan)
    for k in range(K):  # each cell's first measured elevation
        first = np.where(np.isnan(first), z[k], first)
    for k in range(K - 2, -1, -1):
        down = np.where(z[k] - first > threshold, threshold, rise_tol)
        d = z[k + 1:] - z[k][None]
        bad = np.isfinite(d) & ((d < -down[None]) | (d > rise_tol))
        stable = np.isfinite(z[k]) & ~np.any(bad, axis=0)
        base = np.where(stable, k, base)  # walking back in time: the earliest stable flight wins
    return base


def analyse_monitor(z: np.ndarray, inside: np.ndarray, cell: float, threshold: float, alert: float,
                    baseline: Optional[int] = None, offsets: Optional[np.ndarray] = None,
                    offset_se: Optional[np.ndarray] = None, window: int = MONITOR_WINDOW) -> dict:
    """Movement of an area since its baseline, flight by flight.

    ``z`` is (K, ny, nx) ground elevation per flight on the shared grid
    (NaN = not measured), ``inside`` the cells in the outline. Each flight is
    first shifted by ``offsets`` (its error at the check points) when known,
    then averaged over ``window`` × ``window`` cells. Movement per cell is
    flight − baseline (the given flight, or per cell the first flight after it
    stopped changing by more than ``threshold``). Negative = settled.
    """
    K = z.shape[0]
    zl = z - (offsets[:, None, None] if offsets is not None else 0.0)
    zs = np.stack([_window_mean(np.where(inside, zl[k], np.nan), window) for k in range(K)])
    zs = np.where(inside[None], zs, np.nan)
    if baseline is None:
        base = auto_baseline(zs, threshold)
    else:
        base = np.full(inside.shape, baseline, dtype=int)
    base_z = np.take_along_axis(zs, base[None], axis=0)[0]
    ks = np.arange(K)[:, None, None]
    move = np.where(ks > base[None], zs - base_z[None], np.nan)
    move = np.where(inside[None], move, np.nan)

    # cell noise: what's left after removing a 5 × 5 median (real movement is smooth)
    noise = None
    finite = np.isfinite(move)
    if finite.any():
        hp = []
        for k in range(K):
            if np.isfinite(move[k]).sum() >= 9:
                med = median_filter(np.where(np.isfinite(move[k]), move[k], np.nanmedian(move[k])), size=5)
                r = (move[k] - med)[np.isfinite(move[k])]
                hp.append(r)
        if hp:
            r = np.concatenate(hp)
            noise = float(1.4826 * np.median(np.abs(r - np.median(r))))
    area = cell * cell
    flights = []
    for k in range(K):
        m = move[k]
        ok = np.isfinite(m)
        if not ok.any():
            flights.append({"measured": False, "cells": 0})
            continue
        vals = m[ok]
        low = int(np.nanargmin(np.where(ok, m, np.inf)))
        high = int(np.nanargmax(np.where(ok, m, -np.inf)))
        over = ok & (np.abs(np.where(ok, m, 0)) >= alert)
        bases = base[ok]
        if offsets is not None and offset_se is not None:
            se = np.sqrt(offset_se[k] ** 2 + offset_se[bases] ** 2)
            mean_unc = float(np.mean(se)) * 2
        else:
            mean_unc = UNLEVELLED_UNCERTAINTY_M * np.sqrt(2)
        flights.append({
            "measured": True, "cells": int(ok.sum()), "area_m2": round(float(ok.sum() * area), 2),
            "mean_m": round(float(vals.mean()), 4),
            "settled_max_m": round(float(-m.flat[low]), 4) if m.flat[low] < 0 else 0.0,
            "settled_at": list(np.unravel_index(low, m.shape)),
            "heave_max_m": round(float(m.flat[high]), 4) if m.flat[high] > 0 else 0.0,
            "heave_at": list(np.unravel_index(high, m.shape)),
            "over_alert_m2": round(float(over.sum() * area), 2), "over_alert_cells": int(over.sum()),
            "alert": bool(over.sum() >= MONITOR_MIN_ALERT_CELLS),
            "mean_uncertainty_m": round(mean_unc, 4),
            "cell_uncertainty_m": None if noise is None else round(2 * np.sqrt(noise ** 2 + (mean_unc / 2) ** 2), 4),
        })
    measured_base = base[inside & np.isfinite(base_z)]
    return {"flights": flights, "movement": move, "baseline": base, "noise_m": noise,
            "baseline_flights": sorted({int(b) for b in np.unique(measured_base)}) if measured_base.size else []}


# ------------------------------------------------------------------ endpoints

Pair = List[float]


def _pairs(v: List[List[float]]) -> List[List[float]]:
    if any(len(p) != 2 or not all(np.isfinite(p)) for p in v):
        raise ValueError("vertices must be [easting, northing] pairs")
    return v


class SectionsRequest(BaseModel):
    scan: str
    points: List[Pair] = Field(min_length=2, max_length=500)
    interval_m: float = Field(10.0, gt=0, le=1000)
    half_width_m: float = Field(10.0, gt=0, le=500)
    _p = field_validator("points")(_pairs)


class TrenchRequest(BaseModel):
    scan: str
    line: List[Pair] = Field(min_length=2, max_length=500)
    diameter_m: float = Field(0.3, gt=0, le=5)
    every_m: float = Field(5.0, ge=1, le=100)
    _p = field_validator("line")(_pairs)


class FlatworkRequest(BaseModel):
    scan: str
    kind: Literal["walk", "ramp", "landing", "parking"] = "walk"
    polygon: List[Pair] = Field(min_length=3, max_length=500)
    _p = field_validator("polygon")(_pairs)


class MonitorRequest(BaseModel):
    polygon: List[Pair] = Field(min_length=3, max_length=500)
    baseline_scan: Optional[str] = None
    alert_m: float = Field(0.025, gt=0, le=2)
    _p = field_validator("polygon")(_pairs)


def _site_and_scan(site_id: str, scan: str):
    try:
        site = sites.load(site_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")
    ids = [s.project_id for s in site.scans]
    if scan not in ids:
        raise HTTPException(status_code=404, detail=f"'{scan}' isn't a flight of this site")
    return site, ids.index(scan)


def _points_or_404(pid: str) -> FlightPoints:
    try:
        return flight_points(pid)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown scan '{pid}'")


@router.post("/api/sites/{site_id}/checks/sections")
def sections_endpoint(site_id: str, body: SectionsRequest) -> dict:
    """Long profile and cross-sections along a line, for a flight, the flight before it and the design."""
    site, k = _site_and_scan(site_id, body.scan)
    prev = site.scans[k - 1].project_id if k > 0 else None
    stamps = [sites._member_stamp(pid) for pid in filter(None, [body.scan, prev, site.design_id])]
    key = ("sections", stamps, body.model_dump())

    def run():
        try:
            out = sections(_points_or_404(body.scan), body.points, body.interval_m, body.half_width_m,
                           design=design_points(site.design_id) if site.design_id else None,
                           previous=_points_or_404(prev) if prev else None)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {**out, "scan": body.scan, "previous_scan": prev, "has_design": site.design_id is not None}

    return _cached(key, run)


@router.post("/api/sites/{site_id}/checks/trench")
def trench_endpoint(site_id: str, body: TrenchRequest) -> dict:
    """An open trench measured from one flight: size, walls, spoil, pipe, OSHA prompts and the record table."""
    site, k = _site_and_scan(site_id, body.scan)
    key = ("trench", sites._member_stamp(body.scan), body.model_dump())

    def run():
        try:
            out = analyse_trench(_points_or_404(body.scan), body.line, body.diameter_m, every=body.every_m)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {**out, "scan": body.scan, "date": site.scans[k].date}

    return _cached(key, run)


@router.post("/api/sites/{site_id}/checks/flatwork")
def flatwork_endpoint(site_id: str, body: FlatworkRequest) -> dict:
    """Running and cross slopes of a paved walking surface against the ADA limits."""
    site, k = _site_and_scan(site_id, body.scan)
    key = ("flatwork", sites._member_stamp(body.scan), body.model_dump())

    def run():
        fp = _points_or_404(body.scan)
        return {**analyse_flatwork(fp.ground, body.polygon, body.kind), "scan": body.scan, "date": site.scans[k].date,
                "classified": fp.classified}

    return _cached(key, run)


@router.post("/api/sites/{site_id}/checks/monitor")
def monitor_endpoint(site_id: str, body: MonitorRequest) -> dict:
    """Settlement or heave of an area, every flight, against its baseline."""
    try:
        site = sites.load(site_id)
        g = sites.grids(site_id)
    except service.ProjectNotFound:
        raise HTTPException(status_code=404, detail=f"unknown site '{site_id}'")
    ids = [s.project_id for s in site.scans]
    if body.baseline_scan is not None and body.baseline_scan not in ids:
        raise HTTPException(status_code=404, detail=f"'{body.baseline_scan}' isn't a flight of this site")
    control_stamp = None
    if site.control_id:
        from . import control
        cp = control._path(site.control_id)
        control_stamp = (site.control_id, os.path.getmtime(cp) if os.path.exists(cp) else 0)
    key = ("monitor", site_id, [sites._member_stamp(pid) for pid in ids], control_stamp,
           site.change_threshold_m, g["cell_size"], g["x0"], g["y0"], body.model_dump())

    def run():
        nx, ny, cell = g["nx"], g["ny"], g["cell_size"]
        poly = np.asarray(body.polygon, dtype=float)
        lo, hi = poly.min(axis=0), poly.max(axis=0)
        pad = MONITOR_WINDOW
        c0 = int(np.clip(np.floor((lo[0] - g["x0"]) / cell) - pad, 0, nx))
        c1 = int(np.clip(np.ceil((hi[0] - g["x0"]) / cell) + pad, 0, nx))
        r0 = int(np.clip(np.floor((lo[1] - g["y0"]) / cell) - pad, 0, ny))
        r1 = int(np.clip(np.ceil((hi[1] - g["y0"]) / cell) + pad, 0, ny))
        dates = [s.date for s in site.scans]
        if c1 <= c0 or r1 <= r0 or not g["scans"]:
            return {"dates": dates, "flights": [], "inside_cells": 0, "levelled": False}
        cols, rows = np.arange(c0, c1), np.arange(r0, r1)
        cx, cy = np.meshgrid(g["x0"] + (cols + 0.5) * cell, g["y0"] + (rows + 0.5) * cell)
        inside = _inside(np.column_stack([cx.ravel(), cy.ravel()]), poly).reshape(cx.shape)
        z = np.stack([sites._grid_array(s["z"], ny, nx)[r0:r1, c0:c1] for s in g["scans"]])
        offsets = offset_se = None
        if site.control_id:
            qa = {q["project_id"]: q["stats"] for q in sites.qa(site_id)}
            st = [qa.get(pid) for pid in ids]
            if all(s and s["mean"] is not None and s["n"] >= 3 for s in st):
                offsets = np.array([s["mean"] for s in st])
                offset_se = np.array([(s["std"] or 0.0) / np.sqrt(s["n"]) for s in st])
        base = ids.index(body.baseline_scan) if body.baseline_scan else None
        res = analyse_monitor(z, inside, cell, site.change_threshold_m, body.alert_m, base, offsets, offset_se)
        for f in res["flights"]:
            for key_ in ("settled_at", "heave_at"):
                if key_ in f:
                    r, c = f.pop(key_)
                    f[key_.replace("_at", "_e")] = round(float(g["x0"] + (c0 + c + 0.5) * cell), 3)
                    f[key_.replace("_at", "_n")] = round(float(g["y0"] + (r0 + r + 0.5) * cell), 3)
        move = res["movement"]
        return {
            "dates": dates, "scans": ids, "flights": res["flights"], "inside_cells": int(inside.sum()),
            "levelled": offsets is not None,
            "offsets_m": None if offsets is None else [round(float(v), 4) for v in offsets],
            "noise_m": None if res["noise_m"] is None else round(res["noise_m"], 4),
            "baseline": "fixed" if base is not None else "auto",
            "baseline_flights": res["baseline_flights"],
            "window_cells": MONITOR_WINDOW, "cell_size": cell, "alert_m": body.alert_m,
            "grid": {"c0": c0, "r0": r0, "nx": int(c1 - c0), "ny": int(r1 - r0)},
            "movement": [_r(move[k].ravel(), 4) for k in range(move.shape[0])],
        }

    return _cached(key, run)
