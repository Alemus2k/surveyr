---
id: layers
title: Layers — base course and paving thickness and tonnage
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation]
---

# Layers — base course and paving thickness and tonnage

**One-line summary:** how much base, asphalt or topsoil went down inside an
outline, how many tons that is, and where it's too thin — measured as the rise
between the flight before it was placed and the flight you pick.

## Why it exists

Base course and paving are paid by the ton (or square yard at a thickness), and
a thin patch of base is a failed road a year later. The superintendent and PM
ask: *how much did they place, is it thick enough, and does the tonnage on the
pay app look right?* The drone flight is already paid for; the rise between two
flights is the layer.

## Where to find it

*Job sites → (a site) → Quantities tab → Layers* (the default section; the
"Placed in layers" and "Too thin" tiles also open it).

## How to use it

1. Click **Add layer** and click around the area the layer covers; finish by
   clicking the first point, double-clicking or pressing Enter.
2. In the form that opens, give it a name, pick the **material** (crushed stone
   base, asphalt, topsoil, sand, concrete — each fills in a typical weight per
   volume; type the supplier's ticket number instead when you have it), the
   **target thickness** and **tolerance** (in inches / cm), and which flight it
   **sits on** (Automatic = the flight before it first shows up).
3. Pick a flight after that one in the timeline. The map colours the layer:
   green within target ± tolerance, red too thin, amber thicker than needed, grey
   the edge of the placed area. Thin patches are boxed with a dashed red line and
   listed under the map.
4. **Edit layer**, **Redraw outline** and **Delete** (asks first) are under the
   numbers.

Demo: *Riverside Commons* has "Road base course" (8 in crushed stone, ±1.2 in,
140 lb/ft³) measured from the 19 Oct flight; pick 2 Nov.

## How it works

On the site's shared grid (1 m cells on the demo), for every cell whose centre
is inside the outline and that was scanned on both flights:

- **thickness** = ground at the picked flight − ground at the base flight;
- **placed** when thicker than the *placed threshold* = max(tolerance ÷ 2,
  target ÷ 4, 3 cm) — the 3 cm floor keeps two flights' noise (±1.4 cm per
  cell) from reading as material;
- **placed area** = placed cells × cell area; **volume** = Σ thickness over
  placed cells × cell area; **weight** = volume × density (short tons of
  2,000 lb in US units, metric tonnes in metric).
- A placed cell with a placed-less neighbour (4-neighbours, the grid's own edge
  excepted) is an **edge cell**: it straddles the layer's edge, so it reads
  part-thickness whatever was placed. Edge cells count in area and volume but
  are **not judged**. The other ("inside") cells are compared with the target:
  thinner than target − tolerance = **thin**, thicker than target + tolerance =
  **thick**.
- **Average thickness** is over inside cells. **Thinnest / thickest spot** is the
  lowest / highest 3 × 3-cell average of inside cells (needing at least 5 inside
  cells in the window), so one noisy cell doesn't decide it.
- **Thin patches** are 4-connected groups of thin cells. Single thin cells are
  counted in the thin area but not boxed or listed — they're as likely noise as
  a low spot.
- **Automatic base flight**: the flight before the first one where at least
  10 % of the outline's measured cells rose by more than the placed threshold
  since the flight before. Set it by hand if the ground under the outline was
  being filled before the layer went down.

## What it needs from the flight

Only elevation on two flights that cover the outline. No colour or classes.

## Limits and honesty notes

- Each flight is ±2–5 cm vertically, so a single spot's thickness from two
  flights is ±3–7 cm. Averages over the area are far better than spots. The tab
  says so under the numbers, and in red when the target is under 3 in (a 2 in
  asphalt lift is the same size as the error — use cores or paving tickets).
- A flight that came back high or low (a bad base-station height) shifts every
  thickness by that error — check *Control & accuracy*. On the demo the 21 Sep
  flight is 3.5 cm high; the road base is measured 19 Oct → 2 Nov and isn't
  affected.
- It measures the rise, not what caused it: anything placed inside the outline
  between the two flights (spoil, a machine left on it — machines are removed
  with the ground classes) counts.
- Placed area on a coarse grid is good to about half a cell along the edge.
- Densities are typical in-place values; tonnage is only as good as the density.

## Measured on the demo (19 Oct → 2 Nov, Road base course)

| | Measured | Truth (`truth.layers.road_base`) | Tolerance (test) |
|---|---|---|---|
| Placed area | 563 m² | 572 m² | ±5 % |
| Volume | 103.2 m³ | 107.6 m³ | ±6 % |
| Weight | 231 t (255 tons) | 240.9 t | ±6 % |
| Average thickness | 0.190 m | 0.188 m | ±1 cm |
| Thinnest spot | 0.091 m | 0.110 m | ±2.5 cm |
| Thin area | 79 m² | 77 m² | ±12 m² |

Volume reads ~4 % low: cells straddling the patch and layer edges average
partly-placed points, and the machines on the road on both flights hide a few
cells that are filled from their neighbours. The thinnest spot is lower than the
true 11 cm by about one cell's noise (two flights of ±2 cm points).

## Files

- `frontend/src/site/quantities.ts` — `measureLayer`, `placedThreshold`,
  `resolveBaseScan`, `layerReliability`, `LAYER_MATERIALS`
- `frontend/src/site/tabs/quantities/LayersSection.tsx` — map, verdict, form
- `frontend/src/site/tabs/quantities/model.ts` — `useLayers`
- `frontend/src/lib/units.ts` — `formatThickness`, `formatTonnage`,
  `formatDensity`, input kinds `thickness` and `density`
- Tests: `frontend/src/site/quantities.test.ts` (hand-made grids),
  `frontend/src/lib/units.test.ts`, `backend/tests/test_quantities_truth.py`
  (the same maths mirrored in numpy on the demo, against the truth)

## Review checklist

- [ ] Riverside Commons → Quantities → Layers, pick 2 Nov: a red warning reads
      about "850 sq ft of road base course is under 6.7 in — 3.6 in at the
      thinnest"; one dashed red box sits across the road at about E 612,547–612,554.
- [ ] Numbers: placed ≈ 6,060 sq ft, volume ≈ 135 yd³, weight ≈ 255 tons,
      average ≈ 7.5 in.
- [ ] Pick 19 Oct or earlier: "Pick a later flight" note, no numbers.
- [ ] Switch to metric: thickness in cm, weight in t, density in t/m³.
- [ ] Add layer → draw → form opens; change material to Asphalt → density
      becomes 145 lb/ft³; set target to 2 in → the accuracy note turns red.
- [ ] Delete asks first; the layer is gone after confirming.
