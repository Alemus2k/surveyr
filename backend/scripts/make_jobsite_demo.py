"""Generate the "Riverside Commons" job-site demo: a design surface, six dated
drone-style scans of the site being graded, and a site-progress file.

The site is ~180 x 140 m of rolling ground being turned into a building pad,
a parking lot falling 1.5 % to the south, a detention pond, an access road and
a temporary spoil stockpile. Each scan moves every work area part of the way
from existing ground to design (a work front sweeping across it), so the
progress view has something realistic to measure:

  pad      finished early      parking  on track
  pond     well behind         road     on track
  stockpile grows then shrinks

Writes into data/:
  riverside_design.laz            finished-grade design surface
  riverside_<date>.laz (x6)       the scans, in UTM zone 17N metres
  riverside_commons.site.json     zones, planned dates and pay-app claims
  riverside_truth.json            exact volumes from the analytic surfaces
                                  (test oracle, not bundled with the app)

Usage from backend/:  .venv/bin/python scripts/make_jobsite_demo.py
"""
from __future__ import annotations

import json
import os
from typing import Callable, Dict, List

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # backend/
DATA = os.path.join(BASE, "data")
PREFIX = "riverside"
SITE_FILE = "riverside_commons.site.json"
TRUTH_FILE = "riverside_truth.json"

# Survey-grid placement: UTM zone 17N, so coordinates look like real LiDAR.
E0, N0 = 612_400.0, 4_270_150.0
EPSG = 32617
W, H = 180.0, 140.0  # site extent in metres (east, north)
POINTS_PER_M2 = 4.0
NOISE = 0.02  # m, per-point vertical noise
BATTER = 6.0  # m, width over which a graded area blends back into existing ground
TRUTH_CELL = 0.25

DATES = ["2026-07-27", "2026-08-10", "2026-08-24", "2026-09-07", "2026-09-21", "2026-10-05"]
# Fraction of each work area finished at each scan date.
PROGRESS = {
    "pad": [0.0, 0.30, 0.65, 0.90, 1.0, 1.0],
    "parking": [0.0, 0.0, 0.15, 0.35, 0.55, 0.72],
    "pond": [0.0, 0.05, 0.12, 0.20, 0.27, 0.33],
    "road": [0.0, 0.0, 0.0, 0.25, 0.55, 0.80],
}
STOCKPILE_HEIGHT = [0.0, 1.5, 3.0, 3.6, 2.4, 1.0]  # m, spoil pile height per scan
STOCKPILE_AT, STOCKPILE_R = (160.0, 15.0), 11.0


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


class Feature:
    """A graded area: a target surface inside, blending to existing over the batter."""

    def __init__(self, key: str, weight: Callable, target: Callable, sweep: Callable):
        self.key, self.weight, self.target, self.sweep = key, weight, target, sweep


def _median_existing(x0, x1, y0, y1) -> float:
    gx, gy = np.meshgrid(np.linspace(x0, x1, 40), np.linspace(y0, y1, 40))
    return float(np.median(existing(gx, gy)))


def features() -> List[Feature]:
    pad_box = (100.0, 168.0, 80.0, 128.0)
    pad_z = round(_median_existing(*pad_box) - 0.4, 2)  # slightly low: the knoll is cut
    park_box = (15.0, 85.0, 72.0, 126.0)
    park_z0 = round(_median_existing(*park_box) + 0.35, 2)  # at the south edge; raised = fill
    road_box = (100.0, 180.0, 38.0, 50.0)
    road_z_east = float(existing(np.array(180.0), np.array(44.0))) - 0.3
    pond_c, pond_a, pond_b = (45.0, 30.0), 22.0, 14.0
    pond_floor = float(existing(np.array(45.0), np.array(30.0))) - 2.2

    def box_weight(box):
        return lambda x, y: np.clip(1.0 - _rect_distance(x, y, *box) / BATTER, 0.0, 1.0)

    def pond_shape(x, y):
        return np.hypot((x - pond_c[0]) / pond_a, (y - pond_c[1]) / pond_b)

    def pond_target(x, y):
        # flat floor out to 55 % of the radius, then 3:1 side slopes up to daylight
        r = pond_shape(x, y)
        return np.minimum(existing(x, y), pond_floor + np.maximum(r - 0.55, 0) * pond_a / 3.0)

    def pond_weight(x, y):
        return (pond_target(x, y) < existing(x, y) - 1e-6).astype(float)

    return [
        Feature("pad", box_weight(pad_box), lambda x, y: np.full_like(x, pad_z),
                lambda x, y: (x - pad_box[0]) / (pad_box[1] - pad_box[0])),  # works west → east
        Feature("parking", box_weight(park_box), lambda x, y: park_z0 + 0.015 * (y - park_box[2]),
                lambda x, y: (park_box[3] - y) / (park_box[3] - park_box[2])),  # north → south
        Feature("road", box_weight(road_box),
                lambda x, y: road_z_east - 0.02 * (180.0 - x),
                lambda x, y: (180.0 - x) / 80.0),  # from the site entrance westward
        Feature("pond", pond_weight, pond_target,
                lambda x, y: np.clip(pond_shape(x, y), 0, 1)),  # dug from the centre outward
    ]


def design(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    z = existing(x, y)
    for f in features():
        w = f.weight(x, y)
        z = z + w * (f.target(x, y) - z)
    return z


def _front(p: float, s: np.ndarray, band: float = 0.25) -> np.ndarray:
    """Share of the work done at sweep position ``s`` (0..1) when ``p`` of it is finished."""
    if p >= 1.0:
        return np.ones_like(s)
    if p <= 0.0:
        return np.zeros_like(s)
    return np.clip((p * (1 + band) - np.clip(s, 0, 1)) / band, 0.0, 1.0)


def ground(x: np.ndarray, y: np.ndarray, k: int) -> np.ndarray:
    """Ground surface at scan ``k``."""
    z = existing(x, y)
    for f in features():
        w = f.weight(x, y)
        done = _front(PROGRESS[f.key][k], f.sweep(x, y))
        z = z + w * done * (f.target(x, y) - z)
    h = STOCKPILE_HEIGHT[k]
    if h > 0:
        r = np.hypot(x - STOCKPILE_AT[0], y - STOCKPILE_AT[1])
        z = z + h * np.clip(1.0 - (r / STOCKPILE_R) ** 2, 0.0, 1.0)  # rounded spoil mound
    return z


# ------------------------------------------------------------------ zones
def _box(x0, x1, y0, y1, grow=BATTER) -> List[List[float]]:
    x0, x1, y0, y1 = x0 - grow, x1 + grow, y0 - grow, y1 + grow
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _ellipse(cx, cy, a, b, n=28) -> List[List[float]]:
    t = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return [[float(cx + a * np.cos(v)), float(cy + b * np.sin(v))] for v in t]


ZONES = [
    {"id": "pad", "name": "Building pad", "kind": "grading", "color": "#ff7a1a",
     "polygon": _box(100, 168, 80, 128), "start": "2026-08-03", "finish": "2026-09-18"},
    {"id": "parking", "name": "Parking lot", "kind": "grading", "color": "#22d3ee",
     "polygon": _box(15, 85, 72, 126), "start": "2026-08-17", "finish": "2026-10-30"},
    {"id": "pond", "name": "Detention pond", "kind": "grading", "color": "#5b8cff",
     "polygon": _ellipse(45, 30, 24, 16), "start": "2026-08-10", "finish": "2026-10-16"},
    {"id": "road", "name": "Access road", "kind": "grading", "color": "#9be32d",
     "polygon": _box(100, 180, 38, 50, grow=4) , "start": "2026-09-01", "finish": "2026-10-23"},
    {"id": "spoil", "name": "Spoil stockpile", "kind": "stockpile", "color": "#e45bff",
     "polygon": _ellipse(*STOCKPILE_AT, STOCKPILE_R + 3, STOCKPILE_R + 3), "start": None, "finish": None},
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
]


def _in_polygon(x: np.ndarray, y: np.ndarray, poly: List[List[float]]) -> np.ndarray:
    inside = np.zeros(x.shape, dtype=bool)
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        crosses = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xc = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
        inside ^= crosses & (x < xc)
    return inside


# ------------------------------------------------------------------ output
def write_laz(path: str, x: np.ndarray, y: np.ndarray, z: np.ndarray, date: str) -> None:
    import datetime

    import laspy
    from pyproj import CRS

    header = laspy.LasHeader(point_format=3, version="1.4")
    header.scales = np.array([0.001, 0.001, 0.001])
    header.offsets = np.array([E0, N0, 200.0])
    header.add_crs(CRS.from_epsg(EPSG))
    header.creation_date = datetime.date.fromisoformat(date)
    las = laspy.LasData(header)
    las.x, las.y, las.z = x + E0, y + N0, z
    las.classification = np.full(len(x), 2, dtype=np.uint8)  # all ground: a graded site
    las.write(path)


def sample_points(rng: np.random.Generator, n: int):
    return rng.uniform(0, W, n), rng.uniform(0, H, n)


def truth() -> Dict:
    """Exact per-zone volumes on a fine grid (no noise, no tolerance)."""
    xs = np.arange(TRUTH_CELL / 2, W, TRUTH_CELL)
    ys = np.arange(TRUTH_CELL / 2, H, TRUTH_CELL)
    gx, gy = np.meshgrid(xs, ys)
    area = TRUTH_CELL**2
    d = design(gx, gy)
    surfaces = [ground(gx, gy, k) for k in range(len(DATES))]
    out: Dict = {"cell": TRUTH_CELL, "zones": {}}
    for zone in ZONES:
        m = _in_polygon(gx, gy, zone["polygon"])
        rows = []
        for k, g in enumerate(surfaces):
            diff = (g - d)[m]
            row = {"date": DATES[k],
                   "remaining_cut": float(np.clip(diff, 0, None).sum() * area),
                   "remaining_fill": float(np.clip(-diff, 0, None).sum() * area)}
            if k:
                ch = (g - surfaces[k - 1])[m]
                row["cut"] = float(np.clip(-ch, 0, None).sum() * area)
                row["fill"] = float(np.clip(ch, 0, None).sum() * area)
            rows.append(row)
        out["zones"][zone["id"]] = rows
    return out


def main() -> None:
    os.makedirs(DATA, exist_ok=True)
    rng = np.random.default_rng(7)
    n = int(W * H * POINTS_PER_M2)

    x, y = sample_points(rng, int(W * H * 2))
    write_laz(os.path.join(DATA, f"{PREFIX}_design.laz"), x, y, design(x, y), DATES[0])
    scans = []
    for k, date in enumerate(DATES):
        x, y = sample_points(rng, n)
        z = ground(x, y, k) + rng.normal(0, NOISE, n)
        pid = f"{PREFIX}_{date}"
        write_laz(os.path.join(DATA, f"{pid}.laz"), x, y, z, date)
        scans.append({"project_id": pid, "date": date})

    exact = truth()
    zones = [{**z, "polygon": [[round(px + E0, 3), round(py + N0, 3)] for px, py in z["polygon"]]} for z in ZONES]
    pay_apps = []
    for i, (date, zone_id, kind, factor) in enumerate(PAY_APPS, 1):
        true_qty = next(r for r in exact["zones"][zone_id] if r["date"] == date)[kind]
        pay_apps.append({"id": f"pa{i}", "date": date, "zone_id": zone_id, "kind": kind,
                         "claimed_m3": float(round(true_qty * factor, -1)),
                         "contractor": "Ridgeline Earthworks", "note": ""})
    site = {
        "version": 1,
        "name": "Riverside Commons",
        "scans": scans,
        "design_id": f"{PREFIX}_design",
        "tolerance_m": 0.05,
        "change_threshold_m": 0.05,
        "overbill_pct": 10.0,
        "zones": zones,
        "pay_apps": pay_apps,
    }
    with open(os.path.join(DATA, SITE_FILE), "w") as f:
        json.dump(site, f, indent=2)
    with open(os.path.join(DATA, TRUTH_FILE), "w") as f:
        json.dump(exact, f, indent=2)

    print(f"wrote design + {len(DATES)} scans ({n:,} points each), {SITE_FILE}")
    for zone_id, rows in exact["zones"].items():
        first, last = rows[0], rows[-1]
        print(f"  {zone_id:8s} remaining cut/fill {first['remaining_cut']:8.0f}/{first['remaining_fill']:6.0f}"
              f" -> {last['remaining_cut']:7.0f}/{last['remaining_fill']:6.0f} m3")


if __name__ == "__main__":
    main()
