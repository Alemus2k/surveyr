"""The Quantities tab's maths against the Riverside demo's exact answers.

The tab computes in the interface (frontend/src/site/quantities.ts) from the site
grids and flight rasters the engine already serves. This file mirrors those
functions line for line in numpy, runs them on the engine's own ``sites.grids`` /
``sites.rasters`` for the demo, and compares with ``riverside_truth.json``. Keep
the two in step; quantities.test.ts checks the TS side on hand-made grids.

Documented tolerances (docs/features/layers.md, stockpiles.md, pond-storage.md):
the demo is gridded at 1 m, so a cell straddling an outline is half in, half out,
and every flight carries ±2 cm point noise (the 21 Sep flight is also 3.5 cm high).
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from app import service, sites

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
DEMO_SITE = "riverside_commons"

pytestmark = pytest.mark.skipif(not os.path.exists(os.path.join(DATA, f"{DEMO_SITE}.site.json")),
                                reason="run scripts/make_jobsite_demo.py first")


# ---------------------------------------------------------------- mirror of quantities.ts

def placed_threshold(target: float, tol: float) -> float:
    return max(tol / 2, target / 4, 0.03)


def measure_layer(base: np.ndarray, at: np.ndarray, inside: np.ndarray, target: float, tol: float, density: float) -> dict:
    """measureLayer: placed cells count for area / volume; only inside (non-edge) cells are judged."""
    ny, nx = base.shape
    t = at - base
    measured = inside & np.isfinite(t)
    placed = measured & (t > placed_threshold(target, tol))
    edge = np.zeros_like(placed)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        # a neighbour off the grid doesn't make an edge
        nb = np.pad(placed, 1, constant_values=True)[1 + dy:1 + dy + ny, 1 + dx:1 + dx + nx]
        edge |= placed & ~nb
    inner = placed & ~edge
    tz = np.where(inner, t, 0.0)
    s = np.zeros_like(tz)
    n = np.zeros_like(tz)
    pad_t, pad_n = np.pad(tz, 1), np.pad(inner.astype(float), 1)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            s += pad_t[1 + dy:1 + dy + ny, 1 + dx:1 + dx + nx]
            n += pad_n[1 + dy:1 + dy + ny, 1 + dx:1 + dx + nx]
    smooth = inner & (n >= 5)
    extremes = (s / np.maximum(n, 1))[smooth] if smooth.any() else t[inner]
    volume = float(t[placed].sum())
    return {
        "placed_area_m2": float(placed.sum()), "volume_m3": volume, "tonnes": volume * density,
        "mean_thickness_m": float(t[inner].mean()), "min_thickness_m": float(extremes.min()),
        "thin_area_m2": float((inner & (t < target - tol)).sum()),
    }


PILE_LOOKS = {  # brightness, warmth = (red − blue) / brightness, stretched intensity
    "topsoil": (55, 0.55, 20), "aggregate": (150, 0.02, 230), "spoil": (110, 0.7, 90),
}


def classify(rgb: np.ndarray, intensity: np.ndarray) -> np.ndarray:
    """classifySample, vectorised: nearest look within 3 spreads, else ''."""
    v = rgb.mean(axis=1)
    warm = (rgb[:, 0] - rgb[:, 2]) / np.maximum(v, 1)
    names = list(PILE_LOOKS)
    d = np.stack([((v - lv) / 30) ** 2 + ((warm - lw) / 0.25) ** 2 + ((intensity - li) / 90) ** 2
                  for lv, lw, li in PILE_LOOKS.values()], axis=1)
    best = d.argmin(axis=1)
    return np.where(np.sqrt(d.min(axis=1)) <= 3, np.array(names)[best], "")


def guess_material(rasters: dict, ground: np.ndarray, original: np.ndarray, inside: np.ndarray):
    """pileSamples + guessMaterial: (material or None, confidence)."""
    h = np.where(inside, ground - original, np.nan)
    top = np.nanmax(h) if np.isfinite(h).any() else 0.0
    if top < 0.3:
        return None, 0.0
    pick = (h > max(0.3, 0.4 * top)) & np.isnan(rasters["veg_height"]) & np.isnan(rasters["object_height"])
    votes = classify(rasters["photo"][pick].astype(float), rasters["intensity"][pick].astype(float))
    if len(votes) < 4:
        return None, 0.0
    names, counts = np.unique(votes[votes != ""], return_counts=True)
    if not len(names):
        return None, 0.0
    return str(names[counts.argmax()]), float(counts.max() / len(votes))


def storage_below(z: np.ndarray, inside: np.ndarray, elevation: float) -> float:
    d = elevation - z[inside]
    return float(d[np.isfinite(d) & (d > 0)].sum())


# ---------------------------------------------------------------- the demo

@pytest.fixture(scope="module")
def demo():
    mp = pytest.MonkeyPatch()
    mp.setattr(service, "DATA_DIR", DATA)
    g = sites.grids(DEMO_SITE)
    site = sites.load(DEMO_SITE)
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    nx, ny, c = g["nx"], g["ny"], g["cell_size"]
    assert c == 1.0  # the tolerances below assume the demo's 1 m cells (areas = cell counts)
    gx, gy = np.meshgrid(g["x0"] + (np.arange(nx) + 0.5) * c, g["y0"] + (np.arange(ny) + 0.5) * c)
    grid = lambda flat: np.array([np.nan if v is None else v for v in flat], dtype=float).reshape(ny, nx)  # noqa: E731

    def inside(poly) -> np.ndarray:
        poly = np.array(poly)
        m = np.zeros(gx.shape, dtype=bool)
        for (x1, y1), (x2, y2) in zip(poly, np.roll(poly, -1, axis=0)):
            with np.errstate(divide="ignore", invalid="ignore"):
                m ^= ((y1 > gy) != (y2 > gy)) & (gx < x1 + (gy - y1) * (x2 - x1) / (y2 - y1))
        return m

    yield {"g": g, "site": site, "truth": truth, "scans": [grid(s["z"]) for s in g["scans"]],
           "design": grid(g["design"]), "inside": inside}
    mp.undo()


def test_road_base_layer_matches_truth(demo):
    site, truth, scans = demo["site"], demo["truth"]["layers"]["road_base"], demo["scans"]
    layer = next(x for x in site.layers if x.id == "road_base")
    pids = [s.project_id for s in site.scans]
    base = pids.index(layer.base_scan)
    m = measure_layer(scans[base], scans[-1], demo["inside"](layer.polygon),
                      layer.target_thickness_m, layer.tolerance_m, layer.density_t_m3)
    assert m["placed_area_m2"] == pytest.approx(truth["placed_area_m2"], rel=0.05)  # 563 vs 572
    assert m["volume_m3"] == pytest.approx(truth["volume_m3"], rel=0.06)  # 103 vs 108
    assert m["tonnes"] == pytest.approx(truth["tonnes"], rel=0.06)
    assert m["mean_thickness_m"] == pytest.approx(truth["mean_thickness_m"], abs=0.01)
    assert m["min_thickness_m"] == pytest.approx(truth["min_thickness_m"], abs=0.025)
    assert m["thin_area_m2"] == pytest.approx(truth["thin_area_m2"], abs=12)  # 79 vs 77


def test_stockpile_volumes_match_truth(demo):
    """Volume above the first flight's ground, as progress.ts measures a stockpile zone."""
    site, truth, scans = demo["site"], demo["truth"]["stockpiles"], demo["scans"]
    for zone in (z for z in site.zones if z.kind == "stockpile"):
        m = demo["inside"](zone.polygon)
        for k, want in enumerate(truth[zone.id]):
            d = (scans[k] - scans[0])[m]
            got = float(d[np.isfinite(d) & (d > site.change_threshold_m)].sum()) if k else 0.0
            # the 21 Sep flight is 3.5 cm high over the whole zone: up to ~19 m³ on the spoil pile
            assert got == pytest.approx(want, abs=8 if k != 4 else 20, rel=0.04), (zone.id, k)


def test_stockpile_materials_are_recognised(demo):
    site, scans = demo["site"], demo["scans"]
    volumes = demo["truth"]["stockpiles"]
    for zone in (z for z in site.zones if z.kind == "stockpile"):
        biggest = int(np.argmax(volumes[zone.id]))
        for k in sorted({biggest, len(scans) - 1}):
            header, arrays = sites.rasters(DEMO_SITE, site.scans[k].project_id)
            material, confidence = guess_material(dict(arrays), scans[k], scans[0], demo["inside"](zone.polygon))
            if k == biggest:
                assert material == zone.id and confidence >= 0.9, (zone.id, k, material, confidence)
            else:
                assert material in (None, zone.id), (zone.id, k, material)  # a pile nearly gone may be too low to judge


def test_pond_storage_matches_truth(demo):
    site, truth, scans = demo["site"], demo["truth"]["pond"], demo["scans"]
    pond = site.ponds[0]
    zone = next(z for z in site.zones if z.id == pond.zone_id)
    m = demo["inside"](zone.polygon)
    outlet = pond.spill_elevation_m
    assert storage_below(demo["design"], m, outlet) == pytest.approx(truth["design_storage_m3"], rel=0.02)
    for k, want in enumerate(truth["storage_m3"]):
        z = scans[k]
        seen = storage_below(z, m, outlet)
        unseen = int((m & np.isnan(z)).sum())
        if unseen == 0:
            # the 21 Sep flight is 3.5 cm high: ~5 m³ less room in the pond
            assert seen == pytest.approx(want, abs=8, rel=0.08), k
        else:
            # standing water (19 Oct) / machines: the measured figure is a floor, and the
            # "as low as the lowest ground seen" figure brackets the truth
            floor = float(np.nanmin(z[m]))
            up_to = seen + unseen * max(0.0, outlet - floor)
            assert seen <= want + 5, k
            assert up_to >= want - 5, k
            if site.scans[k].date == demo["truth"]["storm"]["flight"]:  # under standing water: the floor is the low point
                assert up_to == pytest.approx(want, rel=0.05), k


def test_zone_material_is_optional_and_round_trips():
    z = sites.Zone(id="p", name="Pile", kind="stockpile", polygon=[[0, 0], [1, 0], [1, 1]])
    assert z.material is None
    assert sites.Zone(**{**z.model_dump(), "material": "topsoil"}).material == "topsoil"
