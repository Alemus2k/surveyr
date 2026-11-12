"""Generate the "Riverside Commons" job-site demo: the engineer's grading file,
eight dated drone flights of the site being built, surveyed check points and a
site file — plus the exact answers for everything, so the app can be tested
against truth.

The site is ~180 x 140 m of rolling meadow with scattered trees being turned
into a building pad, a parking lot falling 1.5 % to the south, a detention
pond, an access road and three stockpiles. Flights are two weeks apart
(27 Jul → 2 Nov 2026). The story the data tells:

  earthworks   pad finishes early · parking and road on track · pond well behind
               (a work front sweeps across each area)
  flight QA    the 21 Sep flight came back 3.5 cm high (bad base-station height)
  clearing     trees and brush are cleared ahead of each area's earthworks
  equipment    two to four machines on site each flight (they hide the ground)
  stockpiles   spoil (grows, then hauled off), topsoil (stockpiled for reuse),
               aggregate (delivered, then used for the road base)
  road base    the road is cut to subgrade (0.20 m under finished grade); on
               2 Nov aggregate base is down on 52 m of it, with one thin patch
  trench       19 Oct: a storm-drain trench is open — 62 m long, ~1.9 m deep,
               vertical walls, pipe visible, spoil piled at the edge; 2 Nov: backfilled
  storm        19 Oct, after rain: three erosion rills on the parking fill
               slope, sediment and standing water in the pond
  settlement   the parking fill settles up to 3 cm after it's placed
  limits       from 5 Oct, spoil is pushed into the buffer outside the limits
               of disturbance, west of the pond
  sidewalk     2 Nov: the pad's sidewalk is poured; one 10 m stretch has a
               3.4 % cross slope (ADA allows 2 %)

Every point carries what a survey drone records: elevation, colour, intensity,
return number, classification (ground / low vegetation / high vegetation /
unclassified objects) and GPS time.

Writes into data/:
  riverside_grading.xml           LandXML, US survey feet: "FG - Finished grade"
                                  (the design) and "EG - Existing ground"
  riverside_<date>.laz (x8)       the flights, UTM zone 17N metres, LAS 1.4 with colour
  riverside_commons.site.json     zones, schedule, pay apps, layers, limits, …
  riverside_control.control.json  12 surveyed check points on undisturbed ground
  riverside_checkpoints.csv       the same points as a PNEZD export in US survey
                                  feet (for trying the import; not bundled)
  riverside_truth.json            exact answers from the analytic model
                                  (test oracle, not bundled with the app)

Usage from backend/:  .venv/bin/python scripts/make_jobsite_demo.py
"""
from __future__ import annotations

import json
import os
import sys
from typing import Callable, Dict, List, Tuple

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
sys.path.insert(0, BASE)  # for app.landxml
DATA = os.path.join(BASE, "data")
PREFIX = "riverside"
SITE_FILE = "riverside_commons.site.json"
TRUTH_FILE = "riverside_truth.json"
CONTROL_ID = "riverside_control"
CONTROL_CSV = "riverside_checkpoints.csv"
N_CONTROL = 12
CONTROL_NOISE = 0.004  # m, surveyed with RTK GNSS / total station
# One flight comes back high — a bad base-station height, say — so the
# accuracy check has something to catch. Correcting it in the app restores it.
SCAN_BIAS_M = {"2026-09-21": 0.035}
US_FT = 1200 / 3937

# Survey-grid placement: UTM zone 17N, so coordinates look like real LiDAR.
E0, N0 = 612_400.0, 4_270_150.0
EPSG = 32617
W, H = 180.0, 140.0  # site extent in metres (east, north)
POINTS_PER_M2 = 4.0
NOISE = 0.02  # m, per-point vertical noise
BATTER = 6.0  # m, width over which a graded area blends back into existing ground
TRUTH_CELL = 0.25
DISTURBED_M = 0.05  # ground moved by more than this counts as disturbed

DATES = ["2026-07-27", "2026-08-10", "2026-08-24", "2026-09-07", "2026-09-21", "2026-10-05",
         "2026-10-19", "2026-11-02"]
K = len(DATES)
# Fraction of each work area finished at each flight.
PROGRESS = {
    "pad": [0.0, 0.30, 0.65, 0.90, 1.0, 1.0, 1.0, 1.0],
    "parking": [0.0, 0.0, 0.15, 0.35, 0.55, 0.72, 0.90, 1.0],
    "pond": [0.0, 0.05, 0.12, 0.20, 0.27, 0.33, 0.45, 0.58],
    "road": [0.0, 0.0, 0.0, 0.25, 0.55, 0.80, 1.0, 1.0],
}

# ---- geometry of the works (local metres: x east, y north, origin at the SW corner)
PAD_BOX = (100.0, 168.0, 80.0, 128.0)
PARK_BOX = (15.0, 85.0, 72.0, 126.0)
ROAD_BOX = (100.0, 180.0, 38.0, 50.0)
POND_C, POND_A, POND_B = (45.0, 30.0), 22.0, 14.0
ROAD_SUBGRADE = -0.20  # the road's earthworks stop this far under finished grade: room for the base course

# stockpiles: centre, radius, height (m) at each flight
PILES = {
    "spoil": {"at": (160.0, 15.0), "r": 11.0, "h": [0.0, 1.5, 3.0, 3.6, 2.4, 1.0, 0.6, 0.3]},
    "topsoil": {"at": (118.0, 63.0), "r": 7.0, "h": [0.0, 1.2, 2.0, 2.2, 2.2, 2.2, 2.2, 2.2]},
    "aggregate": {"at": (150.0, 63.0), "r": 6.0, "h": [0.0, 0.0, 0.0, 0.0, 0.0, 2.6, 2.6, 1.1]},
}

# road base course, placed from the entrance westward by the last flight
BASE_FROM_K = 7
BASE_X = (128.0, 180.0)
BASE_Y = (38.5, 49.5)
BASE_THICKNESS = 0.20
BASE_TOLERANCE = 0.03
BASE_THIN = (146.5, 153.5, 0.11)  # x from, x to, thickness: a patch placed too thin
BASE_DENSITY = 2.24  # t/m³, compacted crushed-stone base (≈140 lb/ft³)

# storm-drain trench, open on one flight
TRENCH_K = 6
TRENCH_Y = 24.0
TRENCH_X = (78.0, 140.0)
TRENCH_HALF_W = 0.6
TRENCH_DEPTH_WEST = 1.75  # m below existing ground at the west (low) end
PIPE_SLOPE = 0.008  # rises eastward: it drains west, to the pond
PIPE_DIAMETER = 0.45
PIPE_BEDDING = 0.10
WINDROW_SETBACK = 0.4  # m from the trench edge to the toe of the spoil (OSHA wants ≥ 0.61 m)
WINDROW_W, WINDROW_H = 2.5, 1.0

# storm damage, seen on the flight after the rain
STORM_K = 6
RILLS_X = (30.0, 47.0, 61.0)
RILL_Y = (63.5, 73.0)
RILL_DEPTH, RILL_HALF_W = 0.28, 0.4
POND_SEDIMENT = 0.08  # m of silt left on the pond floor
WATER_R = 4.5  # m, standing water at the pond's low point: LiDAR gets no return from it

# fill settlement in the parking lot
SETTLE_PER_FLIGHT, SETTLE_MAX, SETTLE_FULL_DEPTH = 0.012, 0.03, 1.2

# limits of disturbance: the site, less a buffer strip along the SW (wetland side)
LOD = [(14.0, 2.0), (180.0, 2.0), (180.0, 138.0), (2.0, 138.0), (2.0, 62.0), (14.0, 62.0)]
BREACH_FROM_K = 5
BREACH_BOX = (8.0, 14.0, 22.0, 36.0)  # spoil pushed into the buffer, west of the pond
BREACH_H = 0.25

# pad sidewalk: in the design from day one, poured by the last flight
WALK_FROM_K = 7
WALK_BOX = (104.0, 164.0, 81.0, 83.0)
WALK_RISE = 0.12
WALK_DESIGN_SLOPE = 0.015  # cross slope, falling south (away from the building)
WALK_BUILT_SLOPE = 0.016
WALK_BAD = (140.0, 150.0, 0.034)  # x from, x to, cross slope as built: over ADA's 2 %


# ------------------------------------------------------------------ surfaces
def existing(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Rolling pre-construction ground: rises east, a knoll NE, a swale SW."""
    z = 212.0 + 0.012 * x - 0.006 * y
    z += 3.0 * np.exp(-((x - 135) ** 2 + (y - 105) ** 2) / (2 * 25.0**2))
    z -= 1.6 * np.exp(-((x - 45) ** 2 + (y - 32) ** 2) / (2 * 22.0**2))
    z += 0.25 * np.sin(x / 17.0) * np.cos(y / 23.0)
    return z


def _rect_distance(x, y, x0, x1, y0, y1):
    dx = np.maximum(np.maximum(x0 - x, 0), x - x1)
    dy = np.maximum(np.maximum(y0 - y, 0), y - y1)
    return np.hypot(dx, dy)


def _in_box(x, y, box) -> np.ndarray:
    return (x >= box[0]) & (x <= box[1]) & (y >= box[2]) & (y <= box[3])


def _median_existing(x0, x1, y0, y1) -> float:
    gx, gy = np.meshgrid(np.linspace(x0, x1, 40), np.linspace(y0, y1, 40))
    return float(np.median(existing(gx, gy)))


PAD_Z = round(_median_existing(*PAD_BOX) - 0.4, 2)  # slightly low: the knoll is cut
PARK_Z0 = round(_median_existing(*PARK_BOX) + 0.35, 2)  # at the south edge; raised = fill
ROAD_Z_EAST = float(existing(np.array(180.0), np.array(44.0))) - 0.3
POND_FLOOR = float(existing(np.array(45.0), np.array(30.0))) - 2.2
POND_SPILL = round(POND_FLOOR + 1.8, 2)  # outlet elevation: storage is measured below it


class Feature:
    """A graded area: a finished-grade surface inside, blending to existing over the
    batter. ``dig_offset`` is where its earthworks stop relative to finished grade."""

    def __init__(self, key: str, weight: Callable, target: Callable, sweep: Callable, dig_offset: float = 0.0):
        self.key, self.weight, self.target, self.sweep, self.dig_offset = key, weight, target, sweep, dig_offset


def _box_weight(box):
    return lambda x, y: np.clip(1.0 - _rect_distance(x, y, *box) / BATTER, 0.0, 1.0)


def _pond_shape(x, y):
    return np.hypot((x - POND_C[0]) / POND_A, (y - POND_C[1]) / POND_B)


def _pond_target(x, y):
    # flat floor out to 55 % of the radius, then 3:1 side slopes up to daylight
    r = _pond_shape(x, y)
    return np.minimum(existing(x, y), POND_FLOOR + np.maximum(r - 0.55, 0) * POND_A / 3.0)


def _pond_weight(x, y):
    return (_pond_target(x, y) < existing(x, y) - 1e-6).astype(float)


FEATURES = [
    Feature("pad", _box_weight(PAD_BOX), lambda x, y: np.full_like(x, PAD_Z),
            lambda x, y: (x - PAD_BOX[0]) / (PAD_BOX[1] - PAD_BOX[0])),  # works west → east
    Feature("parking", _box_weight(PARK_BOX), lambda x, y: PARK_Z0 + 0.015 * (y - PARK_BOX[2]),
            lambda x, y: (PARK_BOX[3] - y) / (PARK_BOX[3] - PARK_BOX[2])),  # north → south
    Feature("road", _box_weight(ROAD_BOX), lambda x, y: ROAD_Z_EAST - 0.02 * (180.0 - x),
            lambda x, y: (180.0 - x) / 80.0, dig_offset=ROAD_SUBGRADE),  # from the site entrance westward
    Feature("pond", _pond_weight, _pond_target,
            lambda x, y: np.clip(_pond_shape(x, y), 0, 1)),  # dug from the centre outward
]


def walk_surface(x: np.ndarray, y: np.ndarray, built: bool) -> np.ndarray:
    """Top of the pad sidewalk: a 12 cm rise with a cross slope falling south."""
    slope = np.full_like(x, WALK_BUILT_SLOPE if built else WALK_DESIGN_SLOPE)
    if built:
        slope = np.where((x >= WALK_BAD[0]) & (x < WALK_BAD[1]), WALK_BAD[2], slope)
    return PAD_Z + WALK_RISE + slope * (y - (WALK_BOX[2] + WALK_BOX[3]) / 2)


def design(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Finished grade: what the engineer's FG surface says."""
    z = existing(x, y)
    for f in FEATURES:
        w = f.weight(x, y)
        z = z + w * (f.target(x, y) - z)
    return np.where(_in_box(x, y, WALK_BOX), walk_surface(x, y, built=False), z)


def _front(p: float, s: np.ndarray, band: float = 0.25) -> np.ndarray:
    """Share of the work done at sweep position ``s`` (0..1) when ``p`` of it is finished."""
    if p >= 1.0:
        return np.ones_like(s)
    if p <= 0.0:
        return np.zeros_like(s)
    return np.clip((p * (1 + band) - np.clip(s, 0, 1)) / band, 0.0, 1.0)


def done_fraction(f: Feature, x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    return _front(PROGRESS[f.key][k], f.sweep(x, y))


def pile_height(key: str, x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    p = PILES[key]
    r = np.hypot(x - p["at"][0], y - p["at"][1])
    return p["h"][k] * np.clip(1.0 - (r / p["r"]) ** 2, 0.0, 1.0)  # rounded mound


def base_thickness(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """Aggregate base on the road (0 where none is placed yet)."""
    if k < BASE_FROM_K:
        return np.zeros_like(x)
    t = BASE_THICKNESS + 0.012 * np.sin(x / 3.1) * np.cos(y / 2.3)
    t = np.where((x >= BASE_THIN[0]) & (x <= BASE_THIN[1]), BASE_THIN[2], t)
    placed = (x >= BASE_X[0]) & (x <= BASE_X[1]) & (y >= BASE_Y[0]) & (y <= BASE_Y[1])
    return np.where(placed, t, 0.0)


def trench_bottom(x: np.ndarray) -> np.ndarray:
    west = float(existing(np.array(TRENCH_X[0]), np.array(TRENCH_Y))) - TRENCH_DEPTH_WEST
    return west + PIPE_SLOPE * (x - TRENCH_X[0])


def pipe_invert(x: np.ndarray) -> np.ndarray:
    return trench_bottom(x) + PIPE_BEDDING


def _along_trench(x):
    return (x >= TRENCH_X[0]) & (x <= TRENCH_X[1])


def settlement(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """How far the parking fill has sunk since it was placed (positive = down)."""
    f = FEATURES[1]
    w = f.weight(x, y)
    depth = np.clip(f.target(x, y) - existing(x, y), 0.0, None) * w
    flights_since = sum((done_fraction(f, x, y, j) >= 0.999).astype(float) for j in range(k))
    return np.minimum(SETTLE_MAX, SETTLE_PER_FLIGHT * flights_since) * np.clip(depth / SETTLE_FULL_DEPTH, 0.0, 1.0)


def rill_depth(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """Erosion channels cut into the parking fill slope by the storm."""
    if k != STORM_K:
        return np.zeros_like(x)
    along = np.clip((y - RILL_Y[0]) / (RILL_Y[1] - RILL_Y[0]), 0.0, 1.0)
    profile = np.sin(np.pi * along) * ((y >= RILL_Y[0]) & (y <= RILL_Y[1]))
    d = np.zeros_like(x)
    for xr in RILLS_X:
        d = np.maximum(d, RILL_DEPTH * profile * np.clip(1.0 - np.abs(x - xr) / RILL_HALF_W, 0.0, 1.0))
    return d


def pond_sediment(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    if k < STORM_K:
        return np.zeros_like(x)
    dug = done_fraction(FEATURES[3], x, y, STORM_K) * FEATURES[3].weight(x, y)
    return POND_SEDIMENT * (dug >= 0.5) * (_pond_shape(x, y) < 0.5)


def breach_height(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """Spoil pushed outside the limits of disturbance."""
    if k < BREACH_FROM_K:
        return np.zeros_like(x)
    x0, x1, y0, y1 = BREACH_BOX
    u = np.clip((x - x0) / (x1 - x0), 0, 1)
    v = np.clip((y - y0) / (y1 - y0), 0, 1)
    return BREACH_H * np.sin(np.pi * u) * np.sin(np.pi * v) * _in_box(x, y, BREACH_BOX)


def ground(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """The ground surface at flight ``k``."""
    z = existing(x, y)
    for f in FEATURES:
        w = f.weight(x, y)
        z = z + w * done_fraction(f, x, y, k) * (f.target(x, y) + f.dig_offset - z)
    z = z - settlement(x, y, k)
    z = z + base_thickness(x, y, k)
    if k >= WALK_FROM_K:
        z = np.where(_in_box(x, y, WALK_BOX), walk_surface(x, y, built=True), z)
    for key in PILES:
        z = z + pile_height(key, x, y, k)
    if k == TRENCH_K:  # open trench with the spoil windrowed along its north edge
        in_trench = _along_trench(x) & (np.abs(y - TRENCH_Y) <= TRENCH_HALF_W)
        z = np.where(in_trench, trench_bottom(x), z)
        mid = TRENCH_Y + TRENCH_HALF_W + WINDROW_SETBACK + WINDROW_W / 2
        z = z + WINDROW_H * np.clip(1.0 - np.abs(y - mid) / (WINDROW_W / 2), 0.0, 1.0) * _along_trench(x)
    elif k > TRENCH_K:  # backfilled, left slightly crowned
        z = z + 0.06 * np.clip(1.0 - np.abs(y - TRENCH_Y) / 1.5, 0.0, 1.0) * _along_trench(x)
    z = z - rill_depth(x, y, k)
    z = z + pond_sediment(x, y, k)
    z = z + breach_height(x, y, k)
    return z


def zone_target(zone: dict, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """What a zone is graded to: the design, raised or lowered by its offset."""
    return design(x, y) + zone.get("design_offset_m", 0.0)


# ------------------------------------------------------------------ zones
def _box(x0, x1, y0, y1, grow=BATTER) -> List[List[float]]:
    x0, x1, y0, y1 = x0 - grow, x1 + grow, y0 - grow, y1 + grow
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _ellipse(cx, cy, a, b, n=28) -> List[List[float]]:
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [[float(cx + a * np.cos(v)), float(cy + b * np.sin(v))] for v in t]


def _pile_zone(key: str, name: str, color: str) -> dict:
    p = PILES[key]
    return {"id": key, "name": name, "kind": "stockpile", "color": color,
            "polygon": _ellipse(*p["at"], p["r"] + 2, p["r"] + 2), "start": None, "finish": None}


ZONES = [
    {"id": "pad", "name": "Building pad", "kind": "grading", "color": "#ef8a3d",
     "polygon": _box(*PAD_BOX), "start": "2026-08-03", "finish": "2026-09-18"},
    {"id": "parking", "name": "Parking lot", "kind": "grading", "color": "#4db5cf",
     "polygon": _box(*PARK_BOX), "start": "2026-08-17", "finish": "2026-10-30"},
    {"id": "pond", "name": "Detention pond", "kind": "grading", "color": "#6d95ee",
     "polygon": _ellipse(*POND_C, POND_A + 2, POND_B + 2), "start": "2026-08-10", "finish": "2026-10-16"},
    {"id": "road", "name": "Access road", "kind": "grading", "color": "#8ebd4c",
     "polygon": _box(*ROAD_BOX, grow=4), "start": "2026-09-01", "finish": "2026-10-23",
     "design_offset_m": ROAD_SUBGRADE},
    _pile_zone("spoil", "Spoil stockpile", "#c27ad6"),
    _pile_zone("topsoil", "Topsoil stockpile", "#e2bd48"),
    _pile_zone("aggregate", "Aggregate stockpile", "#d6dae0"),
]
# (date, zone, cut/fill, how far the claim is from the true quantity)
PAY_APPS = [
    ("2026-08-24", "pad", "cut", 1.03),
    ("2026-09-07", "pad", "cut", 1.31),  # over-billed
    ("2026-09-07", "parking", "fill", 1.02),
    ("2026-09-21", "parking", "fill", 0.98),
    ("2026-09-21", "road", "cut", 1.03),
    ("2026-10-05", "pond", "cut", 1.42),  # over-billed
    ("2026-10-05", "road", "cut", 1.04),
    ("2026-10-19", "parking", "fill", 1.01),
    ("2026-10-19", "road", "cut", 0.99),
    ("2026-11-02", "parking", "fill", 1.03),
]
# clearing limits: (polygon, first flight by which it's cleared)
TRENCH_CORRIDOR = [[TRENCH_X[0] - 2, TRENCH_Y - 4], [TRENCH_X[1] + 2, TRENCH_Y - 4],
                   [TRENCH_X[1] + 2, TRENCH_Y + 5], [TRENCH_X[0] - 2, TRENCH_Y + 5]]
BREACH_POLY = [[BREACH_BOX[0], BREACH_BOX[2]], [BREACH_BOX[1], BREACH_BOX[2]],
               [BREACH_BOX[1], BREACH_BOX[3]], [BREACH_BOX[0], BREACH_BOX[3]]]
CLEARING = [("pad", 1), ("parking", 1), ("pond", 1), ("road", 2), ("spoil", 1), ("topsoil", 1), ("aggregate", 4)]


def clearing_limits() -> List[Tuple[List[List[float]], int]]:
    by_id = {z["id"]: z["polygon"] for z in ZONES}
    return [(by_id[zid], k) for zid, k in CLEARING] + [(TRENCH_CORRIDOR, 5), (BREACH_POLY, BREACH_FROM_K)]


def _in_polygon(x: np.ndarray, y: np.ndarray, poly) -> np.ndarray:
    inside = np.zeros(np.shape(x), dtype=bool)
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        crosses = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xc = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (x < xc)
    return inside


def cleared(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """Ground cleared and grubbed by flight ``k``."""
    out = np.zeros(np.shape(x), dtype=bool)
    for poly, from_k in clearing_limits():
        if k >= from_k:
            out |= _in_polygon(x, y, poly)
    return out


# ------------------------------------------------------------------ what covers the ground
GRASS, STRIPPED, SOIL, SUBGRADE, AGGREGATE, TOPSOIL, CONCRETE, SPOIL, WET = range(9)
MATERIAL_NAMES = ["grass", "stripped ground", "bare soil", "finished subgrade", "aggregate", "topsoil",
                  "concrete", "spoil", "wet sediment"]
#                  R    G    B   intensity (0..1)
MATERIAL_LOOK = {
    GRASS: (98, 122, 62, 0.42), STRIPPED: (122, 98, 72, 0.36), SOIL: (146, 114, 80, 0.40),
    SUBGRADE: (178, 154, 112, 0.50), AGGREGATE: (152, 152, 150, 0.74), TOPSOIL: (70, 55, 40, 0.24),
    CONCRETE: (202, 200, 192, 0.90), SPOIL: (150, 106, 72, 0.38), WET: (88, 80, 72, 0.16),
}


def surface_material(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    m = np.full(np.shape(x), GRASS)
    m[cleared(x, y, k)] = STRIPPED
    for f in FEATURES:
        w, d = f.weight(x, y), done_fraction(f, x, y, k)
        m[(w > 0) & (d > 0.02)] = SOIL
        m[(w > 0.5) & (d >= 0.999)] = SUBGRADE
    if k >= TRENCH_K:
        m[_along_trench(x) & (np.abs(y - TRENCH_Y) <= 4.0)] = SOIL
    m[breach_height(x, y, k) > 0.03] = SPOIL
    m[pile_height("spoil", x, y, k) > 0.05] = SPOIL
    m[pile_height("topsoil", x, y, k) > 0.05] = TOPSOIL
    m[pile_height("aggregate", x, y, k) > 0.05] = AGGREGATE
    m[base_thickness(x, y, k) > 0] = AGGREGATE
    if k >= WALK_FROM_K:
        m[_in_box(x, y, WALK_BOX)] = CONCRETE
    m[pond_sediment(x, y, k) > 0] = WET
    return m


# ------------------------------------------------------------------ trees, brush, machines
def control_keep_out(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Ground that changes at some point: no good for check points."""
    out = np.zeros(np.shape(x), dtype=bool)
    for zone in ZONES:  # stay well outside every zone, batters included
        poly = np.array(zone["polygon"])
        lo, hi = poly.min(axis=0) - 6, poly.max(axis=0) + 6
        out |= (x > lo[0]) & (x < hi[0]) & (y > lo[1]) & (y < hi[1])
    out |= _in_polygon(x, y, [[TRENCH_X[0] - 4, TRENCH_Y - 6], [TRENCH_X[1] + 4, TRENCH_Y - 6],
                              [TRENCH_X[1] + 4, TRENCH_Y + 8], [TRENCH_X[0] - 4, TRENCH_Y + 8]])
    out |= _in_box(x, y, (BREACH_BOX[0] - 4, BREACH_BOX[1] + 4, BREACH_BOX[2] - 4, BREACH_BOX[3] + 4))
    return out


def control_points(rng: np.random.Generator) -> List[Dict]:
    """Check points spread over ground the works never touch."""
    gx, gy = np.meshgrid(np.arange(6.0, W - 6, 4.0), np.arange(6.0, H - 6, 4.0))
    x, y = gx.ravel(), gy.ravel()
    clear = ~control_keep_out(x, y)
    x, y = x[clear], y[clear]
    picked = [int(np.argmin(x + y))]  # farthest-point sampling: an even spread
    for _ in range(N_CONTROL - 1):
        d = np.min([np.hypot(x - x[i], y - y[i]) for i in picked], axis=0)
        picked.append(int(np.argmax(d)))
    z = existing(x[picked], y[picked]) + rng.normal(0, CONTROL_NOISE, N_CONTROL)
    return [{"id": f"CP{k + 1}", "e": round(float(x[i] + E0), 3), "n": round(float(y[i] + N0), 3),
             "z": round(float(zk), 3), "desc": "CHK"} for k, (i, zk) in enumerate(zip(picked, z))]


def plant(rng: np.random.Generator, control: List[Dict]) -> Tuple[np.ndarray, np.ndarray]:
    """Trees (x, y, crown radius, height) and brush patches (x, y, radius, height)."""
    cx = np.array([p["e"] - E0 for p in control])
    cy = np.array([p["n"] - N0 for p in control])
    trees: List[Tuple[float, float, float, float]] = []
    while len(trees) < 150:
        x, y = rng.uniform(3, W - 3), rng.uniform(3, H - 3)
        if any(np.hypot(x - t[0], y - t[1]) < 4.0 for t in trees) or np.min(np.hypot(x - cx, y - cy)) < 6.0:
            continue  # room between trunks, and open sky over the check points
        trees.append((x, y, rng.uniform(1.6, 4.2), rng.uniform(4.0, 11.0)))
    brush = []
    while len(brush) < 45:
        x, y = rng.uniform(3, W - 3), rng.uniform(3, H - 3)
        if np.min(np.hypot(x - cx, y - cy)) < 7.0:
            continue
        brush.append((x, y, rng.uniform(2.0, 5.0), rng.uniform(0.4, 1.4)))
    return np.array(trees), np.array(brush)


def standing(items: np.ndarray, k: int) -> np.ndarray:
    """Which trees / brush patches are still there at flight ``k``."""
    return ~cleared(items[:, 0], items[:, 1], k)


# machines: (kind, x, y, heading in degrees) at each flight
MACHINES = {"excavator": (9.0, 3.2, 3.1), "dozer": (5.5, 3.0, 3.0), "truck": (8.5, 2.6, 3.3), "roller": (5.0, 2.2, 2.8)}
EQUIPMENT = [
    [],
    [("excavator", 120, 104, 20), ("dozer", 112, 96, 90), ("truck", 140, 44, 0)],
    [("excavator", 140, 105, 35), ("dozer", 40, 118, 0), ("truck", 168, 44, 0), ("excavator", 45, 30, 70)],
    [("excavator", 158, 100, 10), ("dozer", 50, 105, 0), ("roller", 115, 110, 90), ("excavator", 172, 44, 0)],
    [("dozer", 45, 95, 0), ("excavator", 150, 44, 0), ("roller", 130, 100, 45), ("excavator", 50, 28, 110)],
    [("dozer", 40, 85, 0), ("excavator", 120, 44, 0), ("excavator", 40, 32, 60), ("truck", 160, 44, 0)],
    [("excavator", 108, 30.5, 0), ("dozer", 50, 78, 0), ("excavator", 58, 30, 90), ("roller", 140, 44, 0)],
    [("roller", 150, 44, 0), ("truck", 165, 44, 0), ("excavator", 36, 30, 80), ("dozer", 62, 60, 30)],
]


def _machine_frame(x, y, m):
    """Coordinates of points in a machine's own frame (along, across)."""
    kind, mx, my, heading = m
    a = np.deg2rad(heading)
    dx, dy = x - mx, y - my
    return dx * np.cos(a) + dy * np.sin(a), -dx * np.sin(a) + dy * np.cos(a)


def under_machine(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    out = np.zeros(np.shape(x), dtype=bool)
    for m in EQUIPMENT[k]:
        length, width, _ = MACHINES[m[0]]
        u, v = _machine_frame(x, y, m)
        out |= (np.abs(u) <= length / 2) & (np.abs(v) <= width / 2)
    return out


# ------------------------------------------------------------------ one flight's points
GROUND, LOW_VEG, HIGH_VEG, UNCLASSIFIED = 2, 3, 5, 1


def _colour(rng, rgb, n, spread=14):
    return np.clip(np.array(rgb)[None, :] + rng.normal(0, spread, (n, 3)), 0, 255)


def flight_points(k: int, rng: np.random.Generator, trees: np.ndarray, brush: np.ndarray) -> Dict[str, np.ndarray]:
    """Everything the drone records on flight ``k``: positions and per-point channels."""
    n = int(W * H * POINTS_PER_M2)
    x, y = rng.uniform(0, W, n), rng.uniform(0, H, n)
    keep = ~under_machine(x, y, k)  # machines hide the ground under them
    if k == STORM_K:
        keep &= np.hypot(x - POND_C[0], y - POND_C[1]) > WATER_R  # no return from standing water
    if k == TRENCH_K:  # a narrow, deep trench: few pulses reach the bottom
        keep &= ~(_along_trench(x) & (np.abs(y - TRENCH_Y) <= TRENCH_HALF_W)) | (rng.random(n) < 0.45)
    live_trees = trees[standing(trees, k)]
    under_canopy = np.zeros(n, dtype=bool)
    for tx, ty, tr, _ in live_trees:
        under_canopy |= np.hypot(x - tx, y - ty) < tr
    keep &= ~under_canopy | (rng.random(n) < 0.35)  # the canopy catches most pulses
    x, y, under_canopy = x[keep], y[keep], under_canopy[keep]

    material = surface_material(x, y, k)
    look = np.array([MATERIAL_LOOK[m] for m in range(len(MATERIAL_NAMES))])
    parts = [{
        "x": x, "y": y, "z": ground(x, y, k) + rng.normal(0, NOISE, len(x)),
        "cls": np.full(len(x), GROUND), "rgb": np.clip(look[material, :3] + rng.normal(0, 12, (len(x), 3)), 0, 255),
        "intensity": np.clip(look[material, 3] + rng.normal(0, 0.05, len(x)), 0.02, 1.0),
        "ret": np.where(under_canopy, 2, 1), "nret": np.where(under_canopy, 2, 1),
    }]

    for tx, ty, tr, th in live_trees:  # tree crowns: a rounded cap, some returns from inside it
        m = int(np.pi * tr * tr * 5)
        r, a = tr * np.sqrt(rng.random(m)), rng.uniform(0, 2 * np.pi, m)
        px, py = tx + r * np.cos(a), ty + r * np.sin(a)
        inside_crown = rng.random(m) < 0.4
        top = th - 0.55 * th * (r / tr) ** 2
        pz = existing(px, py) + top - np.where(inside_crown, rng.uniform(0, 0.35 * th, m), 0.0)
        parts.append({"x": px, "y": py, "z": pz, "cls": np.full(m, HIGH_VEG),
                      "rgb": _colour(rng, (52, 92, 44), m, 16), "intensity": np.clip(rng.normal(0.22, 0.06, m), 0.02, 1),
                      "ret": np.where(inside_crown, 2, 1), "nret": np.where(inside_crown, 3, 2)})
    for bx, by, br, bh in brush[standing(brush, k)]:
        m = int(np.pi * br * br * 3)
        r, a = br * np.sqrt(rng.random(m)), rng.uniform(0, 2 * np.pi, m)
        px, py = bx + r * np.cos(a), by + r * np.sin(a)
        parts.append({"x": px, "y": py, "z": existing(px, py) + bh * rng.uniform(0.2, 1.0, m),
                      "cls": np.full(m, LOW_VEG), "rgb": _colour(rng, (86, 108, 58), m, 16),
                      "intensity": np.clip(rng.normal(0.30, 0.06, m), 0.02, 1), "ret": np.ones(m), "nret": np.full(m, 2)})

    for mach in EQUIPMENT[k]:  # machines: a box seen from above (top dense, sides sparse)
        length, width, height = MACHINES[mach[0]]
        a = np.deg2rad(mach[3])
        m = int(length * width * 12)
        u, v = rng.uniform(-length / 2, length / 2, m), rng.uniform(-width / 2, width / 2, m)
        h = np.where(rng.random(m) < 0.8, height * rng.uniform(0.55, 1.0, m), height * rng.uniform(0.1, 0.55, m))
        px, py = mach[1] + u * np.cos(a) - v * np.sin(a), mach[2] + u * np.sin(a) + v * np.cos(a)
        base = float(ground(np.array(float(mach[1])), np.array(float(mach[2])), k))
        parts.append({"x": px, "y": py, "z": base + h, "cls": np.full(m, UNCLASSIFIED),
                      "rgb": _colour(rng, (228, 178, 34), m, 18), "intensity": np.clip(rng.normal(0.8, 0.08, m), 0.02, 1),
                      "ret": np.ones(m), "nret": np.ones(m)})

    if k == TRENCH_K:  # the pipe, seen from above: the upper part of a cylinder
        m = int((TRENCH_X[1] - TRENCH_X[0]) * 9)
        px = rng.uniform(TRENCH_X[0] + 1, TRENCH_X[1] - 1, m)
        ang = rng.uniform(-1.2, 1.2, m)
        radius = PIPE_DIAMETER / 2
        parts.append({"x": px, "y": TRENCH_Y + radius * np.sin(ang), "z": pipe_invert(px) + radius + radius * np.cos(ang) + rng.normal(0, 0.008, m),
                      "cls": np.full(m, UNCLASSIFIED), "rgb": _colour(rng, (44, 138, 96), m, 10),
                      "intensity": np.clip(rng.normal(0.85, 0.05, m), 0.02, 1), "ret": np.ones(m), "nret": np.ones(m)})

    out = {key: np.concatenate([p[key] for p in parts]) for key in parts[0]}
    out["z"] = out["z"] + SCAN_BIAS_M.get(DATES[k], 0.0)
    order = rng.permutation(len(out["x"]))  # flight order, not object order
    return {key: v[order] for key, v in out.items()}


# ------------------------------------------------------------------ output
def grid_tin(fn: Callable, step: float):
    """A regular-grid TIN of ``fn`` over the site: points (E, N, Z in metres) and triangles."""
    xs, ys = np.arange(0.0, W + step / 2, step), np.arange(0.0, H + step / 2, step)
    gx, gy = np.meshgrid(xs, ys)
    pts = np.column_stack([gx.ravel() + E0, gy.ravel() + N0, fn(gx, gy).ravel()])
    nx = len(xs)
    tri = []
    for r in range(len(ys) - 1):
        for c in range(nx - 1):
            a, b, d, e = r * nx + c, r * nx + c + 1, (r + 1) * nx + c, (r + 1) * nx + c + 1
            tri += [(a, b, e), (a, e, d)]
    return pts, np.array(tri)


def write_grading_xml(path: str) -> None:
    """The design as an engineer would hand it over: LandXML TINs in US survey feet."""
    from app import landxml

    surfaces = []
    for name, fn, step in (("EG - Existing ground", existing, 2.0), ("FG - Finished grade", design, 1.0)):
        pts, tri = grid_tin(fn, step)
        surfaces.append((name, pts / US_FT, tri))
    landxml.write(path, surfaces, unit="USSurveyFoot", crs_name="UTM zone 17N (US survey feet)")


def write_laz(path: str, p: Dict[str, np.ndarray], date: str) -> None:
    """LAS 1.4, point format 7: colour, intensity, returns, classification, GPS time."""
    import datetime

    import laspy
    from pyproj import CRS

    header = laspy.LasHeader(point_format=7, version="1.4")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.array([E0, N0, 200.0])
    header.add_crs(CRS.from_epsg(EPSG))
    header.creation_date = datetime.date.fromisoformat(date)
    las = laspy.LasData(header)
    las.x, las.y, las.z = p["x"] + E0, p["y"] + N0, p["z"]
    las.classification = p["cls"].astype(np.uint8)
    las.return_number = p["ret"].astype(np.uint8)
    las.number_of_returns = p["nret"].astype(np.uint8)
    las.intensity = (p["intensity"] * 65535).astype(np.uint16)
    rgb = (p["rgb"] * 257).astype(np.uint16)  # 8-bit colour stretched to LAS's 16 bits
    las.red, las.green, las.blue = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    day = (datetime.date.fromisoformat(date) - datetime.date(2026, 1, 1)).days
    las.gps_time = day * 86400.0 + 36000.0 + np.arange(len(p["x"])) * 0.003  # a mid-morning flight
    las.write(path)


def _truth_grid():
    xs = np.arange(TRUTH_CELL / 2, W, TRUTH_CELL)
    ys = np.arange(TRUTH_CELL / 2, H, TRUTH_CELL)
    return np.meshgrid(xs, ys)


def truth(trees: np.ndarray, brush: np.ndarray) -> Dict:
    """Exact answers on a fine grid (no noise, no tolerance) for everything the demo shows."""
    gx, gy = _truth_grid()
    area = TRUTH_CELL**2
    exist = existing(gx, gy)
    surfaces = [ground(gx, gy, k) for k in range(K)]
    out: Dict = {"cell": TRUTH_CELL, "dates": DATES, "zones": {}}

    for zone in ZONES:  # earthworks left against each zone's target, and moved per period
        m = _in_polygon(gx, gy, zone["polygon"])
        target = zone_target(zone, gx, gy)
        rows = []
        for k, g in enumerate(surfaces):
            diff = (g - target)[m]
            row = {"date": DATES[k],
                   "remaining_cut": float(np.clip(diff, 0, None).sum() * area),
                   "remaining_fill": float(np.clip(-diff, 0, None).sum() * area)}
            if k:
                ch = (g - surfaces[k - 1])[m]
                row["cut"] = float(np.clip(-ch, 0, None).sum() * area)
                row["fill"] = float(np.clip(ch, 0, None).sum() * area)
            rows.append(row)
        out["zones"][zone["id"]] = rows

    out["stockpiles"] = {key: [float(pile_height(key, gx, gy, k).sum() * area) for k in range(K)] for key in PILES}

    t = base_thickness(gx, gy, K - 1)  # the road base course
    placed = t > 0
    thin = placed & (t < BASE_THICKNESS - BASE_TOLERANCE)
    out["layers"] = {"road_base": {
        "placed_area_m2": float(placed.sum() * area), "volume_m3": float(t.sum() * area),
        "mean_thickness_m": float(t[placed].mean()), "min_thickness_m": float(t[placed].min()),
        "thin_area_m2": float(thin.sum() * area), "tonnes": float(t.sum() * area * BASE_DENSITY),
        "target_thickness_m": BASE_THICKNESS, "tolerance_m": BASE_TOLERANCE,
    }}

    xs = np.linspace(TRENCH_X[0], TRENCH_X[1], 400)
    depth = existing(xs, np.full_like(xs, TRENCH_Y)) - trench_bottom(xs)
    out["trench"] = {
        "flight": DATES[TRENCH_K], "length_m": TRENCH_X[1] - TRENCH_X[0], "width_m": 2 * TRENCH_HALF_W,
        "depth_mean_m": float(depth.mean()), "depth_max_m": float(depth.max()),
        "pipe_diameter_m": PIPE_DIAMETER, "pipe_slope_pct": PIPE_SLOPE * 100,
        "invert_west_m": float(pipe_invert(np.array(TRENCH_X[0]))), "invert_east_m": float(pipe_invert(np.array(TRENCH_X[1]))),
        "spoil_setback_m": WINDROW_SETBACK, "wall_slope": "vertical",
    }

    rills = rill_depth(gx, gy, STORM_K)
    out["storm"] = {
        "flight": DATES[STORM_K], "rills": len(RILLS_X), "rill_x": list(RILLS_X), "rill_max_depth_m": RILL_DEPTH,
        "eroded_volume_m3": float(rills.sum() * area),
        "pond_sediment_m3": float(pond_sediment(gx, gy, STORM_K).sum() * area),
        "standing_water_m2": float(np.pi * WATER_R**2),
    }

    in_lod = _in_polygon(gx, gy, LOD)
    disturbed = [np.abs(g - exist) > DISTURBED_M for g in surfaces]
    out["disturbance"] = {
        "threshold_m": DISTURBED_M, "lod_area_m2": float(in_lod.sum() * area),
        "disturbed_m2": [float(d.sum() * area) for d in disturbed],
        "outside_lod_m2": [float((d & ~in_lod).sum() * area) for d in disturbed],
    }

    canopy = []
    for k in range(K):
        cover = np.zeros(gx.shape, dtype=bool)
        for tx, ty, tr, _ in trees[standing(trees, k)]:
            cover |= np.hypot(gx - tx, gy - ty) < tr
        canopy.append(float(cover.sum() * area))
    out["vegetation"] = {"trees": [int(standing(trees, k).sum()) for k in range(K)], "canopy_m2": canopy,
                         "brush_patches": [int(standing(brush, k).sum()) for k in range(K)]}
    out["equipment"] = [[{"kind": m[0], "e": m[1] + E0, "n": m[2] + N0} for m in EQUIPMENT[k]] for k in range(K)]

    s = settlement(gx, gy, K - 1)
    at = np.unravel_index(np.argmax(s), s.shape)
    out["settlement"] = {"max_m": float(s.max()), "e": float(gx[at] + E0), "n": float(gy[at] + N0),
                         "settled_area_m2": float((s > 0.01).sum() * area)}
    out["sidewalk"] = {"built": DATES[WALK_FROM_K], "width_m": WALK_BOX[3] - WALK_BOX[2],
                       "cross_slope_pct": WALK_BUILT_SLOPE * 100, "ada_max_pct": 2.0,
                       "bad_from_e": WALK_BAD[0] + E0, "bad_to_e": WALK_BAD[1] + E0, "bad_cross_slope_pct": WALK_BAD[2] * 100}

    pond = _in_polygon(gx, gy, ZONES[2]["polygon"])
    storage = lambda z: float(np.clip(POND_SPILL - z, 0, None)[pond].sum() * area)  # noqa: E731
    out["pond"] = {"spill_elevation_m": POND_SPILL, "floor_m": POND_FLOOR, "design_storage_m3": storage(design(gx, gy)),
                   "storage_m3": [storage(g) for g in surfaces]}
    return out


def site_file(exact: Dict) -> Dict:
    """The job-site file: schedule, claims and what to measure, in survey coordinates."""
    world = lambda pts: [[round(px + E0, 3), round(py + N0, 3)] for px, py in pts]  # noqa: E731
    zones = [{**z, "polygon": world(z["polygon"])} for z in ZONES]
    pay_apps = []
    for i, (date, zone_id, kind, factor) in enumerate(PAY_APPS, 1):
        true_qty = next(r for r in exact["zones"][zone_id] if r["date"] == date)[kind]
        pay_apps.append({"id": f"pa{i}", "date": date, "zone_id": zone_id, "kind": kind,
                         "claimed_m3": float(round(true_qty * factor, -1)),
                         "contractor": "Ridgeline Earthworks", "note": ""})
    road, walk = ROAD_BOX, WALK_BOX
    return {
        "version": 1,
        "name": "Riverside Commons",
        "scans": [{"project_id": f"{PREFIX}_{d}", "date": d} for d in DATES],
        "design_id": f"{PREFIX}_grading",
        "tolerance_m": 0.05,
        "change_threshold_m": 0.05,
        "overbill_pct": 10.0,
        "control_id": CONTROL_ID,
        "zones": zones,
        "pay_apps": pay_apps,
        "lod": world(LOD),
        "layers": [{
            "id": "road_base", "name": "Road base course", "material": "Aggregate base",
            "polygon": world([[road[0], BASE_Y[0]], [road[1], BASE_Y[0]], [road[1], BASE_Y[1]], [road[0], BASE_Y[1]]]),
            "base_scan": f"{PREFIX}_{DATES[BASE_FROM_K - 1]}", "target_thickness_m": BASE_THICKNESS,
            "tolerance_m": BASE_TOLERANCE, "density_t_m3": BASE_DENSITY,
        }],
        "flatwork": [{"id": "pad_walk", "name": "Pad sidewalk", "kind": "walk",
                      "polygon": world([[walk[0], walk[2]], [walk[1], walk[2]], [walk[1], walk[3]], [walk[0], walk[3]]])}],
        "alignments": [{"id": "road_cl", "name": "Access road centreline",
                        "points": world([[180.0, 44.0], [100.0, 44.0]]), "interval_m": 10.0, "half_width_m": 10.0}],
        "monitors": [{"id": "parking_fill", "name": "Parking lot fill", "polygon": world(_box(*PARK_BOX, grow=-4)),
                      "baseline_scan": None, "alert_m": 0.02}],
        "asbuilts": [{"id": "storm_drain", "name": "Storm drain trench", "kind": "trench",
                      "scan": f"{PREFIX}_{DATES[TRENCH_K]}", "line": world([[TRENCH_X[1], TRENCH_Y], [TRENCH_X[0], TRENCH_Y]]),
                      "note": "450 mm storm drain to the detention pond"}],
        "ponds": [{"zone_id": "pond", "spill_elevation_m": POND_SPILL, "required_storage_m3": None}],
    }


def main() -> None:
    os.makedirs(DATA, exist_ok=True)
    control = control_points(np.random.default_rng(11))
    trees, brush = plant(np.random.default_rng(23), control)

    write_grading_xml(os.path.join(DATA, f"{PREFIX}_grading.xml"))
    rng = np.random.default_rng(7)
    counts = []
    for k, date in enumerate(DATES):
        pts = flight_points(k, rng, trees, brush)
        write_laz(os.path.join(DATA, f"{PREFIX}_{date}.laz"), pts, date)
        counts.append(len(pts["x"]))

    exact = truth(trees, brush)
    with open(os.path.join(DATA, SITE_FILE), "w") as f:
        json.dump(site_file(exact), f, indent=2)
    with open(os.path.join(DATA, TRUTH_FILE), "w") as f:
        json.dump(exact, f, indent=2)
    with open(os.path.join(DATA, f"{CONTROL_ID}.control.json"), "w") as f:
        json.dump({"version": 1, "name": "Riverside check points", "source_unit": "m", "points": control}, f, indent=2)
    with open(os.path.join(DATA, CONTROL_CSV), "w") as f:
        f.write("Point,Northing,Easting,Elevation,Description\n")
        for p in control:
            f.write(f"{p['id']},{p['n'] / US_FT:.3f},{p['e'] / US_FT:.3f},{p['z'] / US_FT:.3f},{p['desc']}\n")

    print(f"wrote design + {K} flights ({min(counts):,} to {max(counts):,} points each), {SITE_FILE}")
    for zone_id, rows in exact["zones"].items():
        first, last = rows[0], rows[-1]
        print(f"  {zone_id:9s} left to dig/fill {first['remaining_cut']:8.0f}/{first['remaining_fill']:6.0f}"
              f" -> {last['remaining_cut']:7.0f}/{last['remaining_fill']:6.0f} m3")
    layer = exact["layers"]["road_base"]
    print(f"  road base {layer['volume_m3']:.0f} m3 ({layer['tonnes']:.0f} t), thin over {layer['thin_area_m2']:.0f} m2;"
          f" trees {exact['vegetation']['trees'][0]} -> {exact['vegetation']['trees'][-1]};"
          f" outside limits {exact['disturbance']['outside_lod_m2'][-1]:.0f} m2")


if __name__ == "__main__":
    main()
