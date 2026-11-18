---
id: measure
title: Measuring in the 3D view
status: experimental
since: "0.7.0"
area: viewer
origin: roadmap
data_used: [elevation]
---

# Measuring in the 3D view

**One-line summary:** click the scan to read a spot elevation, the distance and
grade between two spots, the length of a route, or the size of an area. Every
number is true ground in survey coordinates, never the stretched 3D picture.

## Why it exists

A superintendent looking at a flight wants to know "how far is it from the
curb to the inlet, and does it fall the right way?", "what's the grade up this
haul road?" or "how big is that area we need to seed?" without exporting to
survey software. This was the biggest gap against professional point-cloud
tools.

## Where to find it

Open a scan → 3D view → toolbar group **Measure** (four buttons: spot
elevation, distance and grade, path length, area). The job-site dashboard's 3D
view uses the same viewer and can switch it on later with one prop
(`measure={useMeasure(cloud)}` plus a `MeasureGroup` in its toolbar); it is not
wired there yet.

## How to use it

1. Pick a tool. A ring follows the cursor over the scan and shows the spot you
   will pick; the panel shows the elevation under it.
2. **Spot elevation:** click once → elevation, easting, northing.
3. **Distance and grade:** click the first spot, then the second → horizontal
   distance, height change (second − first), slope distance, grade as % and
   run:rise (e.g. "2.0 % falling (50:1)"), direction as a quadrant bearing
   (e.g. "N 45°12′ E") and both spot elevations.
4. **Path length:** click along the route; double-click or press **Enter** to
   finish → horizontal length, length along the ground, height change, total
   climb / drop and a per-leg table (length, grade).
5. **Area:** click around the outline; double-click, **Enter** or click the
   first spot to close → plan area, perimeter, surface area over the ground,
   average / lowest / highest ground elevation inside.
6. **Backspace** removes the last spot, **Esc** cancels the one being drawn
   (Esc again turns the tool off). Dragging still orbits the camera; only a
   click (press and release without moving) picks.
7. Finished measurements stay drawn (white lines, dots, a label such as
   "D1 144.36 ft · 2.0 %") until deleted. The panel lists them; click one to see
   all its figures (it turns gold in the view), the copy icon copies it as plain
   text, the × deletes it. **Copy** in the panel header copies everything;
   **Clear** removes all (asks first).
8. Switching ft ↔ m re-reads every figure at once. Measurements belong to the
   scan: opening another scan starts with an empty list.

Demo: open *riverside_2026-11-02*, Distance from the road's east end to the
west end of its base course reads about 2 % falling, direction S 90°00′ W; two
spots on the building pad read level.

## How it works

- **Picking.** The cursor ray is tested against the points through a plan-view
  bucket grid built once per scan (cell ≈ 2 point spacings): the ray is walked
  across the grid in half-cell steps, clipped to the cloud's box, and every
  point within a cone of 7 px around the ray (never less than half a point
  spacing) is a candidate; the one nearest the camera wins. On 200,000 points:
  index build ≈ 10 ms, pick + ground snap ≈ 0.04 ms on average (≤ 1.1 ms worst)
  — measured by `groundIndex.test.ts`.
- **Ground snap.** The elevation of a picked spot is the **median** of the 9
  points nearest to it in plan (within 4 point spacings; fewer than 3 = "not
  scanned"). One stray return can't move it; 2 cm scan noise shrinks to ≈ 1 cm.
- **True coordinates.** The viewer stretches flat sites vertically (up to ×3).
  Picks are converted back with the exact inverse of the scene mapping
  (E = ox + x, N = oy − z, elevation from the points' raw elevations), so
  heights and grades are never exaggerated.
- **Distance:** horizontal = √(ΔE² + ΔN²); slope = √(ΔE² + ΔN² + Δz²);
  grade = Δz / horizontal × 100; ratio = 100 / |grade| : 1 (rounded to whole
  numbers from 10:1, one decimal below; "1:n" when steeper than 1:1);
  bearing from the azimuth atan2(ΔE, ΔN), written N/S θ E/W with θ rounded to
  the minute.
- **Path:** sums of the legs (each leg as above).
- **Area:** plan area by the shoelace formula, perimeter in plan. Surface
  area: the ground is sampled on a square grid (cell = 2 point spacings, coarser
  for very large outlines so there are at most ≈ 5,000 cells, finer for tiny
  ones); each cell whose centre is inside and whose four corners have ground is
  split into two triangles; surface area = exact plan area × (Σ 3D triangle
  area ÷ Σ plan triangle area). A plane at any tilt is therefore exact
  (a 45° roof = √2 × plan). Average elevation = mean of those cells.
  Cells without ground are left out and the share is reported.
- Units: everything is computed in metres and shown through `lib/units.ts`
  (ft to hundredths, sq ft / acres; or m, m² / ha).

## What it needs from the flight

Only point elevations (the cleaned ground points the 3D view loads). No colour,
classes or design are needed.

## Limits and honesty notes

- **Accuracy.** Drone LiDAR is good to about ±2–5 cm vertically; the panel says
  so. Over a short run that noise dominates a grade: under 10 ft (3 m) the
  distance shows an amber note with the possible error (≈ 4 cm ÷ run, e.g.
  ±1.3 % over 10 ft) and path legs that short are marked.
- **The ground snap smooths over ≈ 1 m.** Nine points at ~0.5 m spacing reach
  about 0.8 m from the click. Next to a curb, wall, trench edge or stockpile toe
  the median mixes both sides. On the demo a cross slope measured across the
  2 m pad sidewalk was off by up to 3 % for this reason — check narrow features
  with the slice tool instead.
- Coordinates are in the scan's own grid; in US units they're international
  feet (2 ppm off a US-survey-foot plan, see units.md).
- Labels and lines are drawn on top of everything, so a measurement behind a
  hill stays visible.
- The area is measured on the plan; a self-crossing outline gives a meaningless
  area (not prevented).
- Measurements are not saved: they live until cleared or the scan is closed.

## Files

- `frontend/src/measure/geometry.ts` — distances, grade, bearings / DMS, path,
  shoelace area, perimeter, surface area, median ground snap, scene → survey
- `frontend/src/measure/groundIndex.ts` — plan bucket grid: ray pick, k-nearest, ground elevation
- `frontend/src/measure/state.ts` — reducer: modes, clicks, undo / cancel / finish, list
- `frontend/src/measure/report.ts` — panel rows, 3D labels, copy text, short-run warning
- `frontend/src/measure/layer.ts` — three.js overlay (fat lines, dots, fills, hover ring, HTML labels)
- `frontend/src/measure/MeasureOverlay.tsx`, `MeasureGroup.tsx`, `useMeasure.ts`, `measure.css` — UI
- `frontend/src/viewer/scene.ts` (`ViewerScene.measure()`), `PointCloudViewer.tsx` (`measure` prop),
  `ViewerToolbar.tsx` (`measure` slot), `Workspace.tsx` (wired)
- Tests: `geometry.test.ts`, `groundIndex.test.ts` (brute-force agreement, speed),
  `state.test.ts`, `report.test.ts`, `riverside.test.ts` (demo against exact
  answers; points in `fixtures/riverside_spots.json` are the 3D view's points of
  the 2 Nov flight within 2.5 m of six spots, with `make_jobsite_demo.ground()`
  at each spot as truth)

## Review checklist

- [ ] Open riverside_2026-11-02 in 3D, Measure → Distance: click the east end of
      the access road, then a spot ~40 m west on the gravel → about 2 % falling,
      direction S 89°–90° W (truth: the road falls 2 % westward).
- [ ] Distance between two spots on the building pad → height change within
      ±0.05 ft, grade ≈ 0.0 % (truth: flat at 214.55 m = 703.90 ft).
- [ ] Spot elevation on the pad → ≈ 703.90 ft.
- [ ] Distance over less than 10 ft → amber "Short distance" note.
- [ ] Area around the pad → ≈ 3,264 m² (≈ 0.81 acres) plan; surface area
      within a fraction of a percent of plan.
- [ ] Path with 4 spots, double-click to finish → per-leg table; Backspace and
      Esc behave as described.
- [ ] Switch units in Settings → all figures switch; measurements stay.
- [ ] Copy → paste in a text editor: plain text with all figures and spots.
- [ ] Light and dark app themes: labels and panel readable over the viewport.
