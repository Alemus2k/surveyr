"""Automatic ground classification (app.ground) and the ``auto_ground`` scan setting.

Synthetic cases have hand-checkable answers; the demo cases use the classes the
generator wrote into the files as the oracle (the algorithm never sees them).
"""
from __future__ import annotations

import json
import os

import numpy as np
import pytest

from app import ground, io, scan_settings, service, sites

DATA = os.path.join(os.path.dirname(__file__), "..", "data")
DEMO = sorted(f for f in os.listdir(DATA) if f.startswith("riverside_") and f.endswith(".laz"))
needs_demo = pytest.mark.skipif(len(DEMO) < 8, reason="run scripts/make_jobsite_demo.py first")
E0, N0 = 612_400.0, 4_270_150.0  # the demo's survey-grid origin (make_jobsite_demo.py)


# ------------------------------------------------------------------ synthetic scenes

def _field(rng, w=60.0, d=60.0, density=4.0, surface=lambda x, y: 0.0 * x, noise=0.02):
    n = int(w * d * density)
    x, y = rng.uniform(0, w, n), rng.uniform(0, d, n)
    return np.column_stack([x, y, surface(x, y) + rng.normal(0, noise, n)])


def _box(rng, cx, cy, length, width, height, base=0.0, density=12.0):
    """A machine / container as an airborne scanner sees it: a roof, nothing beneath."""
    n = int(length * width * density)
    return np.column_stack([rng.uniform(cx - length / 2, cx + length / 2, n),
                            rng.uniform(cy - width / 2, cy + width / 2, n),
                            base + height + rng.normal(0, 0.02, n)])


def _under(pts, cx, cy, length, width):
    return (np.abs(pts[:, 0] - cx) <= length / 2) & (np.abs(pts[:, 1] - cy) <= width / 2)


def _tree(rng, cx, cy, radius, height, base=0.0, density=5.0):
    """A rounded crown with returns from inside it."""
    n = int(np.pi * radius * radius * density)
    r, a = radius * np.sqrt(rng.random(n)), rng.uniform(0, 2 * np.pi, n)
    z = base + height - 0.5 * height * (r / radius) ** 2 - rng.uniform(0, 0.3 * height, n) * (rng.random(n) < 0.4)
    return np.column_stack([cx + r * np.cos(a), cy + r * np.sin(a), z])


def _scene(rng, surface=lambda x, y: 0.0 * x):
    """Field + a 9 x 3.2 x 3 m excavator roof + a 6 m tree (30 % of pulses reach the ground under it)."""
    g = _field(rng, surface=surface)
    g = g[~_under(g, 20, 20, 9, 3.2)]  # the machine hides the ground
    under_tree = np.hypot(g[:, 0] - 42, g[:, 1] - 40) < 3.5
    g = g[~under_tree | (rng.random(len(g)) < 0.3)]
    box = _box(rng, 20, 20, 9, 3.2, 3.0, base=float(surface(np.array(20.0), np.array(20.0))))
    tree = _tree(rng, 42, 40, 3.5, 6.0)
    tree[:, 2] += surface(tree[:, 0], tree[:, 1])
    pts = np.vstack([g, box, tree])
    truth = np.r_[np.full(len(g), 2), np.full(len(box), 1), np.full(len(tree), 5)]
    return pts, truth


@pytest.mark.parametrize("slope", [0.0, 0.25])
def test_field_with_machine_and_tree(slope):
    rng = np.random.default_rng(1)
    pts, truth = _scene(rng, surface=lambda x, y: slope * x)

    g = ground.classify_ground(pts)

    assert g[truth == 2].mean() >= 0.995  # the field stays
    assert not g[truth == 1].any()  # the machine goes
    assert g[truth == 5].mean() <= 0.01  # and the tree


def test_no_channels_matches_empty_channels():
    pts, _ = _scene(np.random.default_rng(2))
    a = ground.classify_ground(pts)
    assert np.array_equal(a, ground.classify_ground(pts, {}))
    assert np.array_equal(a, ground.classify_ground(pts, {"intensity": np.full(len(pts), np.nan)}))


def test_tiny_or_unknown_input():
    assert ground.classify_ground(np.zeros((3, 3))).tolist() == [True] * 3
    with pytest.raises(TypeError):
        ground.classify_ground(np.zeros((3, 3)), window=5)


def test_stockpile_stays_ground():
    """A rounded 3.6 m mound, 11 m radius (the demo's spoil pile at its biggest), and a
    steep 2.6 m one with 6 m radius (edge slope 0.87, steeper than loose fill stands)."""
    rng = np.random.default_rng(3)

    def piles(x, y):
        a = 3.6 * np.clip(1 - (np.hypot(x - 18, y - 30) / 11) ** 2, 0, None)
        b = 2.6 * np.clip(1 - (np.hypot(x - 45, y - 30) / 6) ** 2, 0, None)
        return a + b

    pts = _field(rng, surface=piles)

    g = ground.classify_ground(pts)

    assert g.mean() >= 0.999
    on_crest = piles(pts[:, 0], pts[:, 1]) > 2.0
    assert g[on_crest].all()  # not one crest point shaved


def test_trench_and_windrow_stay_ground():
    """1.2 m wide x 1.9 m deep, vertical walls, few pulses reach the bottom, and a 1 m
    windrow of spoil 0.4 m back from the edge."""
    rng = np.random.default_rng(4)

    def site(x, y):
        z = np.where(np.abs(y - 30) <= 0.6, -1.9, 0.0)
        mid = 30 + 0.6 + 0.4 + 1.25
        return z + 1.0 * np.clip(1 - np.abs(y - mid) / 1.25, 0, None) * (np.abs(y - 30) > 0.6)

    pts = _field(rng, surface=site)
    in_trench = np.abs(pts[:, 1] - 30) <= 0.6
    pts = pts[~in_trench | (rng.random(len(pts)) < 0.45)]

    g = ground.classify_ground(pts)

    assert g.mean() >= 0.999
    assert g[np.abs(pts[:, 1] - 30) <= 0.6].all()  # the whole trench bottom


def test_low_outlier_is_noise_and_ground_around_it_survives():
    rng = np.random.default_rng(5)
    pts = _field(rng)
    pts = np.vstack([pts, [[30.0, 30.0, -8.0]]])

    cls = ground.classify(pts)

    assert cls[-1] == ground.LOW_NOISE
    assert (cls[:-1] == ground.GROUND).mean() >= 0.999


def test_classify_splits_vegetation_from_objects_with_returns():
    rng = np.random.default_rng(6)
    pts, truth = _scene(rng)
    nret = np.where(truth == 5, 2.0, 1.0)  # canopy pulses echo twice; roofs and bare ground once
    ret = np.ones(len(pts))
    channels = {"return_number": ret, "number_of_returns": nret}

    cls = ground.classify(pts, channels)

    assert (cls[truth == 1] == ground.OTHER).all()
    assert np.isin(cls[truth == 5], (ground.LOW_VEG, ground.HIGH_VEG)).all()
    assert (cls[truth == 5] == ground.HIGH_VEG).mean() > 0.8  # most of a 6 m crown is above 2 m


def test_classify_uses_colour_without_returns():
    rng = np.random.default_rng(7)
    pts, truth = _scene(rng)
    rgb = np.where(truth[:, None] == 5, [0.2, 0.36, 0.17], np.where(truth[:, None] == 1, [0.9, 0.7, 0.13], [0.4, 0.35, 0.25]))
    channels = dict(zip(("red", "green", "blue"), rgb.T))

    cls = ground.classify(pts, channels)

    assert (cls[truth == 1] == ground.OTHER).all()
    assert np.isin(cls[truth == 5], (3, 5)).all()


def test_classify_from_xyz_alone_uses_porosity():
    pts, truth = _scene(np.random.default_rng(8))

    cls = ground.classify(pts)

    assert (cls[truth == 1] == ground.OTHER).all()  # nothing reached the ground under the roof
    assert np.isin(cls[truth == 5], (3, 5)).all()  # 30 % of pulses did under the crown


def test_suggestion_only_for_scans_with_things_on_them():
    rng = np.random.default_rng(9)
    bare = _field(rng, surface=lambda x, y: 0.3 * x + 2 * np.sin(y / 5))
    assert not ground.suggest(bare)
    spikes = np.vstack([bare, np.column_stack([rng.uniform(0, 60, 40), rng.uniform(0, 60, 40), rng.uniform(-30, 60, 40)])])
    assert not ground.suggest(spikes)  # lone outliers aren't things
    busy = np.vstack([bare] + [_box(rng, x, 30, 9, 3.2, 3.0 + 0.3 * x) for x in (10, 25, 40, 52)])
    assert ground.suggest(busy)


# ------------------------------------------------------------------ the demo flights

def _demo(fname):
    c = io.load_point_cloud(os.path.join(DATA, fname))
    truth = c.channels["classification"].astype(int)
    channels = {k: v for k, v in c.channels.items() if k != "classification"}
    return c.points - [E0, N0, 0.0], truth, channels


@needs_demo
@pytest.mark.parametrize("use_channels", [True, False], ids=["whole-flight", "xyz-only"])
def test_demo_accuracy_against_the_files_classes(use_channels):
    kept = {c: [0, 0] for c in (1, 2, 3, 5)}
    for fname in DEMO:
        pts, truth, channels = _demo(fname)
        g = ground.classify_ground(pts, channels if use_channels else None)
        pipe = (truth == 1) & (np.abs(pts[:, 1] - 24.0) <= 0.6) & (pts[:, 0] >= 78) & (pts[:, 0] <= 140)
        for c in kept:
            m = (truth == c) & ~pipe  # the pipe in the open trench is counted separately below
            kept[c][0] += int(g[m].sum())
            kept[c][1] += int(m.sum())
    rate = {c: k / n for c, (k, n) in kept.items()}
    assert rate[2] >= 0.9995  # real ground kept
    assert rate[5] <= 0.001  # trees removed
    assert rate[1] <= 0.03  # machines removed (their lowest side returns may stay)
    assert rate[3] <= (0.01 if use_channels else 0.20)  # brush: the low part stays without returns


@needs_demo
@pytest.mark.parametrize("use_channels, trees_ok, machines_ok", [(True, 0.99, 0.99), (False, 0.97, 0.80)],
                         ids=["whole-flight", "xyz-only"])
def test_demo_vegetation_vs_objects(use_channels, trees_ok, machines_ok):
    """Of the points removed, how many trees are called vegetation and machines objects."""
    veg = [0, 0]
    obj = [0, 0]
    for fname in DEMO:
        pts, truth, channels = _demo(fname)
        cls = ground.classify(pts, channels if use_channels else None)
        pipe = (np.abs(pts[:, 1] - 24.0) <= 0.6) & (pts[:, 0] >= 78) & (pts[:, 0] <= 140)
        t, m = (truth == 5) & (cls != 2), (truth == 1) & ~pipe & (cls != 2)
        veg[0] += int(np.isin(cls[t], (3, 5)).sum())
        veg[1] += int(t.sum())
        obj[0] += int((cls[m] == 1).sum())
        obj[1] += int(m.sum())
    assert veg[0] / veg[1] >= trees_ok
    assert obj[0] / obj[1] >= machines_ok


@needs_demo
def test_demo_stockpiles_are_not_shaved():
    """Pile volume measured on auto ground vs the file's ground, within 1 % of the true volume."""
    with open(os.path.join(DATA, "riverside_truth.json")) as f:
        truth = json.load(f)
    piles = {"spoil": (160.0, 15.0, 11.0), "topsoil": (118.0, 63.0, 7.0), "aggregate": (150.0, 63.0, 6.0)}
    for k, fname in enumerate(DEMO):
        pts, cls, _ = _demo(fname)
        auto = ground.classify_ground(pts)  # the harder case: xyz only
        for key, (cx, cy, r) in piles.items():
            volume = truth["stockpiles"][key][k]
            if volume <= 0:
                continue

            def grid(mask):
                sel = mask & (np.hypot(pts[:, 0] - cx, pts[:, 1] - cy) < r)
                i = np.floor(pts[sel, :2] - [cx - r, cy - r]).astype(int)
                flat = i[:, 1] * 64 + i[:, 0]
                n = np.bincount(flat, minlength=64 * 64)
                return np.bincount(flat, pts[sel, 2], minlength=64 * 64) / np.maximum(n, 1), n > 0

            za, ha = grid(auto)
            zt, ht = grid(cls == 2)
            both = ha & ht
            assert abs(np.sum(za[both] - zt[both])) <= 0.01 * volume, (fname, key)


@needs_demo
def test_demo_trench_survives():
    pts, truth, channels = _demo(DEMO[6])  # 2026-10-19: the open trench
    near = (truth == 2) & (pts[:, 0] >= 78) & (pts[:, 0] <= 140) & (np.abs(pts[:, 1] - 24.0) <= 6)
    bottom = near & (np.abs(pts[:, 1] - 24.0) <= 0.6)
    for ch in (channels, None):
        g = ground.classify_ground(pts, ch)
        assert g[bottom].all()
        assert g[near].mean() >= 0.99


# ------------------------------------------------------------------ the scan setting

@pytest.fixture
def data(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(service, "TRASH_DIR", str(tmp_path / "Trash"))
    (tmp_path / "Trash").mkdir()
    monkeypatch.setattr(service, "_cache", {})
    monkeypatch.setattr(service, "_points_cache", {})
    monkeypatch.setattr(service, "_ground_cache", {})
    return tmp_path


def test_auto_ground_setting_drives_the_analysis(data, monkeypatch):
    pts, truth = _scene(np.random.default_rng(10))
    np.savetxt(data / "yard.xyz", pts)

    before = service.analyze("yard")["points"]
    assert before["ground_source"] == "none"
    assert before["suggest_auto_ground"] is True
    assert before["ground_only"] is False and before["captured"] == len(pts)

    scan_settings.save("yard", scan_settings.ScanSettings(auto_ground=True))
    calls = []
    real = ground.classify
    monkeypatch.setattr(ground, "classify", lambda *a, **k: calls.append(1) or real(*a, **k))

    after = service.analyze("yard")["points"]  # the save invalidated the cached analysis
    assert after["ground_source"] == "auto"
    assert after["suggest_auto_ground"] is False
    assert after["ground_only"] is True
    assert after["captured"] == pytest.approx((truth == 2).sum(), abs=20)
    assert after["classes"]["1"] == pytest.approx((truth == 1).sum(), abs=20)

    service.sample_points_with_origin("yard", limit=1000, everything=True)
    service.sample_points_with_origin("yard", limit=1000)
    assert len(calls) == 1  # classified once, then cached

    scan_settings.save("yard", scan_settings.ScanSettings(auto_ground=True, ground_only=False))
    off = service.analyze("yard")["points"]
    assert len(calls) == 2  # new settings, new classification
    assert off["ground_source"] == "auto" and off["ground_only"] is False  # classes known, not used to filter
    assert off["captured"] == len(pts)


def test_auto_ground_ignores_the_files_own_classes(data):
    import laspy

    pts, truth = _scene(np.random.default_rng(11))
    header = laspy.LasHeader(point_format=3, version="1.4")
    header.scales, header.offsets = [0.001] * 3, [0.0] * 3
    las = laspy.LasData(header)
    las.x, las.y, las.z = pts.T
    las.classification = np.full(len(pts), 2, dtype=np.uint8)  # "everything is ground": wrong
    las.write(str(data / "bad.las"))

    assert service.analyze("bad")["points"]["ground_source"] == "file"
    assert service.analyze("bad")["points"]["captured"] == len(pts)

    scan_settings.save("bad", scan_settings.ScanSettings(auto_ground=True))
    p = service.analyze("bad")["points"]
    assert p["ground_source"] == "auto"
    assert p["captured"] < (truth == 2).sum() + 20


def test_bare_scans_and_designs_get_no_suggestion(data):
    np.savetxt(data / "bare.xyz", _field(np.random.default_rng(12), surface=lambda x, y: 0.2 * y))
    p = service.analyze("bare")["points"]
    assert p["ground_source"] == "none" and p["suggest_auto_ground"] is False


def test_demo_synthetic_and_design_are_not_flagged(monkeypatch):
    monkeypatch.setattr(service, "DATA_DIR", DATA)
    monkeypatch.setattr(service, "_cache", {})
    if os.path.exists(os.path.join(DATA, "synthetic_topo.xyz")):
        assert service.analyze("synthetic")["points"]["suggest_auto_ground"] is False
    if os.path.exists(os.path.join(DATA, "riverside_grading.xml")):
        p = service.analyze("riverside_grading")["points"]
        assert p["suggest_auto_ground"] is False and p["ground_source"] == "none"


@needs_demo
def test_site_rasters_follow_auto_classes(tmp_path, monkeypatch):
    """With auto ground on, a flight's object / vegetation heights come from the classifier."""
    import shutil

    for f in os.listdir(DATA):
        if f.startswith("riverside"):
            shutil.copy(os.path.join(DATA, f), tmp_path / f)
    monkeypatch.setattr(service, "DATA_DIR", str(tmp_path))
    for name in ("_cache", "_points_cache", "_ground_cache"):
        monkeypatch.setattr(service, name, {})
    monkeypatch.setattr(sites, "_grid_cache", {})
    monkeypatch.setattr(sites, "_raster_cache", {})
    site_id = "riverside_commons"
    pid = os.path.splitext(DEMO[1])[0]

    before = dict(sites.rasters(site_id, pid)[1])
    scan_settings.save(pid, scan_settings.ScanSettings(unit="m", auto_ground=True))
    after = dict(sites.rasters(site_id, pid)[1])  # settings changed: recomputed

    for layer in ("object_height", "veg_height"):
        a, b = np.isfinite(before[layer]), np.isfinite(after[layer])
        assert (a & b).sum() >= 0.95 * a.sum()  # the same machines / trees show up
        assert (b & ~a).sum() <= 0.02 * a.sum()  # and nothing else
