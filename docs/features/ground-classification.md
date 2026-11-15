---
id: ground-classification
title: Automatic ground classification
status: experimental
since: "0.7.0"
area: scan
origin: roadmap
data_used: [elevation, returns, rgb]
---

# Automatic ground classification

**One-line summary:** Surveyr works out which points are bare earth by itself,
so trees, machines, trucks and structures stop counting as dirt, even when the
scan file has no ground class or has a bad one.

## Why it exists

Volumes are only as good as the ground surface under them. A drone flight over
a working site catches excavators, dump trucks, brush and trees, and an
excavator parked on a stockpile adds its own volume to the pile. Survey
providers usually deliver a classified file (ASPRS class 2 = ground), but
phone and handheld scans never are, and some delivered files are classified
badly (everything "ground", or nothing). A project engineer or PM needs
earthwork quantities they can trust without buying classification software.

## Where to find it

*Open a scan → Adjust (side panel) → Classification → "Work out ground points
automatically"*. When a scan has no ground classes but clearly has things
standing on it, the same section shows an amber notice with a one-click
**Classify automatically** button.

## How to use it

1. Open a scan. If it isn't classified and has trees or machines on it, the
   Classification section says so; press **Classify automatically**.
2. Or tick **Work out ground points automatically** yourself — for example
   when the file's classes look wrong (machines left in the terrain).
3. Keep **Use ground points only** ticked: the automatic classes are only
   used to filter the terrain when it is on (with it off every point is used,
   as before, but the classes still drive the 3D view's class colouring and a
   site's vegetation / object height layers).
4. The analysis reloads; the note under the checkboxes says how many ground
   points were found. Site volumes, control checks and flight layers all use
   the new ground automatically.

Demo: the Riverside flights are classified, so they show "file". To try it,
tick the setting on any Riverside flight — the results match the file's
classes closely (tables below).

## How it works

All on a grid whose cell size `c` is chosen from point density so a cell holds
about 4 points (rounded up to 0.02 / 0.05 / 0.1 / 0.2 / 0.25 / 0.5 / 1 / 2 /
5 m; the Riverside flights get 1 m). Grids are capped at 4 million cells by
doubling `c`.

1. **Lowest point per cell**, `zmin`. If the scan records returns, *earlier
   echoes of a multi-echo pulse* (return number < number of returns) are left
   out: the pulse carried on below them, so they can't be the ground. Empty
   cells take their nearest neighbour's value.
2. **Low outliers.** A cell more than `pit_m` below every cell within two
   cells takes that lowest neighbour's value (a lone reflection below the
   ground would otherwise drag the surface down).
3. **Opening.** `O = dilate(erode(zmin))` with a flat square window of
   `window_m` (in cells, rounded up to odd). It is the surface a plate
   `window_m` wide pressed up from below would touch; anything narrower than
   the plate sticks out: `D = zmin − O`.
4. **Objects vs terrain.** Let `steep = max_slope · c · √2 + 0.15 m` (the most
   that real ground can rise across one cell, plus noise). Cells with
   `D > bump_m` are *bumps*. A bump cell is an object **core** when
   - its points span more than `steep` vertically (`zmax − zmin` over all
     points in the cell: a canopy or a machine has points at many heights), or
   - `D > max_slope · window_m / 2` (taller than terrain of that slope could
     be under the plate).

   Objects grow from their cores into neighbouring bump cells, at most two
   cells, and only into cells no more than 0.1 m higher than the object cell
   next to them (a machine's or tree's fringe is lower than its middle; a
   stockpile beside a tree, or a windrow beside a pipe in a trench, is higher
   and stays). A connected bump with no core is an object only if, over its
   edge cells, the 25th percentile of "how far this cell rises above the
   *highest* ground cell beside it" exceeds `steep` — a box rises clear of all
   its neighbours, a windrow against a trench doesn't rise above the field
   behind it.
5. **Bare-earth surface** `S`: `zmin` (after step 2) on every non-object cell;
   object cells are filled from the surrounding ground — nearest value, then
   `2 · window_m / c` rounds of replacing each filled cell by the mean of its
   3 × 3 neighbourhood (a stretched membrane).
6. **Points.** For a point in cell `s = S(cell)`, with `lo` and `hi` the lowest
   and highest `S` in the 3 × 3 cells around it:
   - ground if `lo − low_m ≤ z ≤ max(hi, 2s − lo) + height_m` — on a slope or a
     trench rim the point may sit well above its own cell's lowest point but
     not above the neighbouring ground; on a crest (all neighbours lower) the
     fall to the lowest neighbour is allowed as rise above this one;
   - an earlier echo of a multi-echo pulse must also satisfy `z − s ≤
     return_height_m`;
   - `z < lo − low_m` is **low noise** (class 7).

### Vegetation vs objects (`classify`)

Non-ground points get ASPRS-style classes: **3** low vegetation, **5** high
vegetation (more than `tall_veg_m` above `S`), **1** other (machines,
structures, pipe), **7** low noise. Vegetation vs object is decided from the
best evidence the scan has:

1. **Returns** (if any pulse has more than one echo): a point is vegetation if
   more than half of the non-ground points in the 3 × 3 cells around it come
   from multi-echo pulses.
2. else **colour**: the same local majority, of points whose colour is green
   (hue 65°–145°, saturation > 0.15; yellow machines are ~45°, a teal pipe
   ~150°).
3. else **porosity** (xyz only): touching non-ground cells form a cluster; it
   is vegetation if more than half of its interior cells (cells whose 8
   neighbours are in the cluster too; all its cells if there are none) also
   have ground points — a canopy lets some pulses through, a machine or a
   roof hides the ground.

### Parameters and defaults

| parameter | default | meaning |
|---|---|---|
| `cell` | auto (≈ 4 points / cell) | grid cell size, m |
| `window_m` | 7.0 m | widest object removed; must be wider than the narrowest side of a machine (excavator ≈ 3.2 m). Larger shaves sharper crests (see limits) |
| `bump_m` | 0.20 m | bumps lower than this are never treated as objects |
| `max_slope` | 0.7 (≈ 35°) | steepest real ground, rise / run: loose fill's angle of repose |
| `height_m` | 0.15 m | how far above the neighbouring bare earth a point may be and still be ground (noise is ±2 cm on the demo) |
| `return_height_m` | 0.08 m | the same for earlier echoes of multi-echo pulses |
| `low_m` | 0.50 m | below the bare earth by more than this = low noise |
| `pit_m` | 0.50 m | a cell this far below every cell within two is an outlier |
| `tall_veg_m` | 2.0 m | vegetation higher than this is class 5, lower class 3 |

These are not exposed in the interface; the defaults are tuned for
construction sites flown at survey density.

### Suggestion flag

`points.suggest_auto_ground` is computed only when a point-cloud scan has no
usable ground class (`ground_source = "none"`; never for LandXML). On a random
sample of ≤ 100 000 points, binned at twice the density cell size: a cell is
"tall" if at least three of its points are more than max(1 m, 1.4 cells, 6 ×
the median cell's height range) above the cell's lowest point (a lone low
outlier is replaced by the 3 × 3 median first). True when ≥ 0.5 % of occupied
cells are tall. ≈ 0.02 s on any size of scan. It is False for
`synthetic_topo.xyz` (steep hills and gross outliers), the two-pass demo, the
LandXML design, and bare ground; True for any Riverside flight with its
classes stripped.

### In the engine

`ScanSettings.auto_ground` (default **false**). When on, `service._load_full`
replaces the scan's `classification` channel with `ground.classify(...)` (the
file's own classes are ignored), so the terrain filter, the analysis, the 3D
"everything" view, site grids, flight rasters and control checks all see it.
The classes are cached per scan (file path, size, modification time) and
settings; saving settings invalidates them along with every other cache. The
analysis reports `points.ground_source`: `"auto"`, `"file"` (the file has a
class-2 point) or `"none"`.

## What it needs from the flight

Only x, y, z. Returns (return number / number of returns) improve it a lot —
canopy and brush echoes are excluded from the bare-earth search and split from
objects reliably. Colour helps the vegetation / object split when there are
no returns. Intensity, GPS time and the file's own classes are not used.

## Measured accuracy (Riverside demo, all 8 flights, 870 714 points)

Oracle: the classes the generator wrote into the files (the algorithm never
sees them). Default parameters. "Pipe" is the 0.45 m pipe in the open trench
(flight 2026-10-19), true class 1, shown separately.

**Whole flight (xyz + returns + colour)** — true class ↓ / predicted →

| true \ predicted | ground 2 | low veg 3 | high veg 5 | other 1 | noise 7 | kept as ground |
|---|---|---|---|---|---|---|
| ground (2), 762 471 | 762 462 | 5 | 0 | 4 | 0 | **99.999 %** |
| brush (3), 20 039 | 90 | 19 948 | 1 | 0 | 0 | 0.45 % |
| trees (5), 80 529 | 0 | 3 396 | 77 015 | 118 | 0 | 0.00 % |
| machines (1), 7 114 | 177 | 0 | 9 | 6 928 | 0 | 2.5 % |
| pipe (1), 558 | 558 | 0 | 0 | 0 | 0 | 100 % |

**Colour only (no returns)**

| true \ predicted | ground 2 | low veg 3 | high veg 5 | other 1 | noise 7 | kept as ground |
|---|---|---|---|---|---|---|
| ground (2) | 762 448 | 9 | 0 | 14 | 0 | 99.997 % |
| brush (3) | 3 704 | 16 155 | 1 | 179 | 0 | 18.5 % |
| trees (5) | 19 | 3 380 | 76 987 | 143 | 0 | 0.02 % |
| machines (1) | 177 | 0 | 2 | 6 935 | 0 | 2.5 % |
| pipe (1) | 558 | 0 | 0 | 0 | 0 | 100 % |

**xyz only (a phone-style scan)**

| true \ predicted | ground 2 | low veg 3 | high veg 5 | other 1 | noise 7 | kept as ground |
|---|---|---|---|---|---|---|
| ground (2) | 762 448 | 23 | 0 | 0 | 0 | 99.997 % |
| brush (3) | 3 704 | 16 334 | 1 | 0 | 0 | 18.5 % |
| trees (5) | 19 | 3 332 | 75 875 | 1 303 | 0 | 0.02 % |
| machines (1) | 177 | 498 | 585 | 5 854 | 0 | 2.5 % |
| pipe (1) | 558 | 0 | 0 | 0 | 0 | 100 % |

Vegetation vs object, of the removed points: with returns, trees 99.85 % called
vegetation and machines 99.9 % called objects; xyz only (porosity), trees
98.4 % and machines 84.4 % — a machine next to a tree is sometimes called
vegetation. Trees' lower crown points (under 2 m) are class 3, not 5.

**Terrain features:**

- Stockpiles (17 pile × flight cases, measured as disk area × mean height of
  ground points over the pile-free surface): auto ground vs the file's ground
  differs by at most **0.05 %** with returns and **0.44 %** xyz-only (spoil,
  2026-09-07: 690.5 vs 693.5 m³). No crest point is lost on either.
- Trench (2026-10-19): all 148 trench-bottom points kept; 2 555 of 2 564
  (99.6 %) ground points within 6 m of the trench kept with returns, 2 541
  (99.1 %) xyz-only (the lost ones are on the windrow crest).
- Pond slopes, fill batters, rills, sidewalk: no ground points lost (the only
  ground misses, 9–23 points per 762 471, are on the windrow and pile crests).

**Effect on the site grids** (1 m, all flights switched to auto, vs the
file's classes): net difference ≤ 0.3 m³ on five flights; 2026-08-24 −6.5 m³
and 2026-09-21 +9.1 m³, both under an excavator working on the pond's 3:1
side slope (up to ±1.2 m in ~20 cells: its lowest returns pass as ground next
to higher ground); 2026-10-05 +3.8 m³ and 2026-11-02 +3.0 m³ from the low edges
of machines; 2026-10-19 **−65.7 m³**, of which −64.6 m³ is inside the trench
(the pipe counts as ground, and the trench cells the file leaves empty and the
grid interpolates from the rims instead get the pipe's height).

**Speed:** 0.2 s per flight-sized scan (≈ 0.21 s per million points on the
demo); 0.33 s for 1 M and 1.2 s for 3 M points of synthetic terrain on a
laptop. The suggestion flag takes ≈ 0.02 s.

## Limits and honesty notes

- **Things in a trench count as ground.** A pipe, a trench box or water in a
  narrow trench sits between walls whose rims are higher, so it is within the
  allowance. On the demo that is 0.45 m of pipe over 62 m of trench (−65 m³ of
  trench volume vs the file's classes). Trench volumes from auto ground are
  low by roughly the pipe's volume.
- **Low things stay.** Without returns, brush points within 0.15 m of the
  ground are ground (18 % of brush points on the demo), as are the lowest
  returns off a machine's sides (2.5 %). Volumes move by a few m³.
- **Objects wider than `window_m` in both directions** with no ground under
  them (a building, a big stack of materials) are not removed unless they
  rise steeply above all their neighbours.
- **Very sharp, narrow, high terrain** (a 2 m windrow steeper than 35°) can be
  taken for an object. Real stockpiles at angle of repose and the demo's
  0.87-slope aggregate pile are kept.
- **Machine on a steep slope:** its lowest returns may pass as ground next to
  the higher ground beside it (±1 m in the cells under the demo's excavator
  in the pond).
- **Vegetation vs object without returns or colour** relies on porosity and
  is weaker (84 % of machine points correct on the demo); treat class 1 / 3 /
  5 from an xyz-only scan as a hint.
- The demo is synthetic (perfect boxes, uniform density, ±2 cm noise); real
  flights have strip overlap, scan-angle shadows and denser points on
  machines' sides. Accuracy on real data is unmeasured.
- It never changes the scan file. Turning it off restores the file's classes.

## Files

- `backend/app/ground.py` — `classify_ground`, `classify`, `suggest` (numpy / scipy only)
- `backend/app/scan_settings.py` — `auto_ground` setting
- `backend/app/service.py` — `_auto_classes` (cached), `ground_source`, `points.ground_source` / `points.suggest_auto_ground`
- `frontend/src/adjust/AdjustPanel.tsx` — checkbox, note, suggestion card
- `frontend/src/api.ts`, `frontend/src/types.ts` — the new fields
- Tests: `backend/tests/test_ground.py`

## Review checklist

- [ ] Riverside flight → Adjust → tick "Work out ground points automatically":
      the note reads "automatically found ground points"; the captured count
      is within a few hundred of the file-classified count (e.g. 2026-08-10).
- [ ] Same flight, "Everything" 3D view coloured by class: machines are class
      1, trees 5, brush 3; the stockpiles stay ground.
- [ ] Riverside Commons site → quantities unchanged within a few m³ except the
      2026-10-19 trench (pipe counts as ground) after switching all flights.
- [ ] Import an unclassified scan of a site with trees/machines: the amber
      card appears; "Classify automatically" turns the setting on and the card
      goes away.
- [ ] `synthetic` and the LandXML design show no card.
- [ ] Untick the setting: the file's classes are back (ground source "file").
