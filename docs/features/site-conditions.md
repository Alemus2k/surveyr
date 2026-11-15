---
id: site-conditions
title: Site conditions
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, rgb, intensity, returns, classification, design]
---

# Site conditions

**One-line summary:** everything a flight shows besides earthworks — the site
from above, trees and brush, machines, ground disturbed against the limits of
disturbance, storm damage, and whether the drone saw enough ground.

## Why it exists

The flight is already paid for. A superintendent or PM also wants to know:
what does the site look like, what is standing on it, what changed, and is
anything outside where it should be (stormwater inspectors ask exactly this)?

## Where to find it

*Job sites → (a site) → Site conditions tab.* Pick a flight in the timeline.

## How to use it

1. Read the four tiles: disturbed ground (with the 1-acre NPDES line), area
   disturbed outside the limits, machines on site, storm-check findings.
2. Switch map layers: **Photo · Intensity · Vegetation · Machines · Disturbed ·
   Storm check · Coverage**. Hover for cell details.
3. **Draw limits** traces the limits of disturbance (LOD) from the erosion
   control plan (click points; click the first point / double-click / Enter
   to finish). **Redraw limits** replaces it; the bin deletes it (confirmed).
4. Click a bar in any per-flight chart to jump to that flight.

Demo: *Riverside Commons* — 19 Oct shows three rills on the parking fill
slope, standing water and fresh silt in the pond; from 5 Oct spoil sits
outside the LOD west of the pond.

## How it works

All analysis is in the engine (`backend/app/conditions.py`, one cached
endpoint `GET /api/sites/{id}/conditions`), on the site's shared 1 m grid and
the flights' points. It returns per-flight findings (JSON) and one bit-mask
raster per flight. The interface applies the site's own outlines (LOD, pond
zones, zone names) in `frontend/src/site/conditions.ts`, so redrawing the LOD
answers instantly. *Why the engine:* the rill check needs the ground points
(a 0.8 m rill averages to ~5 cm on a 1 m cell, under the noise), so a pure-TS
version would be impossible for that part; keeping all of it in one numpy
module avoids two mirrored implementations, and the truth test checks the
code that actually runs.

- **Vegetation** (per-cell tallest vegetation point above ground): canopy
  > 1.5 m, brush 0.3–1.5 m. Canopy area counts cells on the canopy's edge as
  ¾ of a cell (whole cells overstate crowns ~17 % on 1 m cells, half cells
  understate ~10 %). Trees = canopy tops: cells > 2 m and ≥ every neighbour;
  touching equal tops count once. Cleared = vegetation at the first (or
  previous) flight with no vegetation return at all now, 3×3 opened.
- **Machines** (per-cell tallest non-ground, non-vegetation point): cells
  ≥ 1 m form blobs; pieces ≤ 2 m apart join if together they stay ≤ 13 × 6 m;
  a machine needs ≥ 6 m² standing 1.5–5 m tall; blobs ≥ 6× longer than wide
  and ≤ 1.5 m wide (pipe, fence) are dropped.
- **Disturbed**: |flight − first flight| > the site's change threshold, after
  removing a whole-flight vertical offset (median change of the cells that
  look unmoved; only if ≤ 10 cm and ≥ 30 % of the site unmoved), then kept
  only where ≥ 4 of the 3×3 block are marked (noise speckle out). Plus
  vegetation cleared since the first flight. Outside LOD = disturbed cells
  whose centre is outside the polygon. ≥ 1 acre (4,047 m²) → NPDES note.
- **Coverage**: cells the flight covered with < 1 ground point per m².
- **Storm check** (flight vs the one before):
  - *Rills*: each ground point's change vs the old surface (bilinear),
    minus the offset; minus the 3×3-cell median of per-cell median change
    (fill being placed, a cut going down). Points more than max(threshold,
    3.5σ) below are clustered on a 0.5 m grid. A rill is ≥ 8 points, ≥ 3 m
    long, ≥ 3× longer than wide, median drop < 1 m (deeper = dug on purpose),
    and lower than the ground on **both** sides (1–2.5 m off its centre line)
    by more than the threshold — both in the change and in today's ground
    (after removing the fall along it). The two-bank tests remove the edges
    of cuts, kerbs and the toes of growing piles. Depth = 90th percentile of
    the drop ("up to"); volume = mean drop over a strip around the channel ×
    its area. Repair if ≥ 15 cm deep or ≥ 10 m long, else watch.
    The brief asked to look only outside active work; the demo's rills are on
    a fill slope being built, so worked ground is searched too and the
    finding says "on ground being worked" instead.
  - *Possibly standing water*: a patch of cells with no return at all ≥ 6 m²,
    surrounded (≥ 90 %) by covered ground, not touching the flight's edge,
    seen by the previous flight. Area adds the empty share of partly covered
    edge cells (vs the flight's typical density).
  - *Pond silt*: in pond zones (site `ponds`), cells that rose more than the
    threshold where the design isn't above the old ground, or that turned
    dark (mean ground intensity < half the flight's median) since the last
    flight; patches ≥ 4 m²; a finding from 10 m². Volume only where the rise
    is measurable.

## What it needs from the flight

Ground classification for vegetation / machines (else: a notice asking for a
classified export). Colour for the Photo layer — without it: *"This flight
has no colour — turn on colour (RGB) in the drone's processing export"*, and
the map starts on intensity (or vegetation over relief). Intensity for the
Intensity layer and silt detection.

## Limits and honesty notes

- Grid cells are ~1 m: areas are ± one cell along every edge.
- Trees in a tight clump with one shared top count once; brush patches that
  touch merge.
- Machines are a snapshot at flight time, not an equipment log; two parked
  nose to tail within 2 m that together look machine-sized read as one.
- Rills narrower than ~0.3 m or shallower than the change threshold are
  missed; rill depth reads ~25 % shallow.
- Pond silt laid while the pond is being dug can't be measured as a rise;
  only its area (dark, wet ground) is reported.
- First run reads every flight (~13 s for the 8-flight demo), then cached.

## Measured on the Riverside demo (tests: `backend/tests/test_conditions_truth.py`)

| | Truth | Measured | Tolerance tested |
|---|---|---|---|
| Trees per flight | 150 … 51 | 152 … 53 | ±2 |
| Canopy m² | 4165 … 1506 | 4322 … 1573 | ±6 % |
| Machines per flight | 0,3,4,4,4,4,4,4 | same, each < 3 m off | exact count |
| Ground moved m² | 2097 … 12397 | 2114 … 12443 | ±1.5 % + 20 m² |
| Moved outside LOD m² | 55.75 (from 5 Oct) | 56 / 54 / 58 | ±6 m² |
| Rills 19 Oct | x = 30, 47, 61 | 30.0, 47.0, 61.1 | within 1 m |
| Rill depth | 0.28 m | 0.19–0.21 m | 60–110 % |
| Eroded volume | 1.91 m³ | 1.35 m³ | 50–120 % |
| Standing water | 63.6 m² | 68 m² | ±15 % |
| Pond silt (visible) | 184 − 64 = 120 m² | 90 m² | 60–110 % |
| False rills on dry flights | 0 | 1 (7 Sep, 3.7 m at the topsoil pile's toe) | ≤ 1 total |
| Extra find on 19 Oct | 0 | 1 (5 m, 13 cm, "watch") | ≤ 1 |

## Files

- `backend/app/conditions.py` — analysis + endpoint (one line in `main.py`)
- `frontend/src/site/conditions.ts` — outlines, findings, map layers
- `frontend/src/site/conditionsApi.ts` — fetch + cache
- `frontend/src/site/tabs/ConditionsTab.tsx`, `conditions.css` — the tab
- Tests: `backend/tests/test_conditions.py`, `backend/tests/test_conditions_truth.py`,
  `frontend/src/site/conditions.test.ts`

## Review checklist

- [ ] Open Riverside Commons → Site conditions; tiles load after a short wait.
- [ ] 10 Aug, Machines layer: 3 numbered machines; 27 Jul: none.
- [ ] 5 Oct, Disturbed layer: a red patch west of the pond outside the white
      LOD line; the "Outside the limits" tile is red (~1,000 sq ft incl. clearing).
- [ ] Redraw the limits to include that patch → the red and the warning go away instantly.
- [ ] Delete the limits (confirm) → tile says "draw the limits…".
- [ ] 19 Oct, Storm check: 3 rills on the parking slope (Repair), possibly
      standing water and fresh silt in the pond; 2 Nov: nothing found.
- [ ] Coverage layer: thin cells under trees and machines only (~2 %).
- [ ] Light and dark themes both readable.
