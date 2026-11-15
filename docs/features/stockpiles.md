---
id: stockpiles
title: Stockpiles by material
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, rgb, intensity, classification]
---

# Stockpiles by material

**One-line summary:** how much is in each stockpile, what it is (topsoil,
stone, soil), what it weighs, and how it changed since the last flight.

## Why it exists

Material on site is money: topsoil saved for reuse, aggregate delivered for the
road, spoil waiting to be hauled. The PM asks *how much is on site, of what*,
and the super asks *did that pile go down by what the trucks say?* The volume
comes from the shape; the colour and laser brightness the drone recorded tell
the materials apart so the volume can be weighed.

## Where to find it

*Job sites → (a site) → Quantities tab → Stockpiles* (or the "Stockpiled on
site" tile).

## How to use it

1. Stockpiles are zones of kind *Stockpile*. Click **Add stockpile** and draw
   around a pile, leaving a little ground all round it (or set an existing zone's
   kind to Stockpile on the Progress tab).
2. The table shows each pile's volume, its **material** (a guess, with its
   confidence — hover for how many cells agreed), weight and change since the
   previous flight. If the guess is wrong, choose the material in the dropdown:
   it's saved on the zone (`Zone.material`) and used from then on. Choose the
   first entry to go back to the guess.
3. The chart shows every pile's volume at each flight; hover for the figures.
4. Delete (bin icon, asks first) removes the zone.

Demo: *Riverside Commons* has spoil, topsoil and aggregate stockpiles.

## How it works

- **Volume** is the same as the Progress tab's stockpile figure: Σ (ground at
  the flight − ground at the first flight) over cells inside the zone that rose
  more than the site's change threshold (5 cm), × cell area; only cells scanned
  on both flights.
- **Material guess**: from the flight's rasters (`sites.rasters`), take the
  cells of the upper pile — higher than 30 cm and 40 % of the pile's top above
  the first flight, so the ground round the toe doesn't mix in — that have
  nothing standing on them (no vegetation or object points). For each cell,
  brightness *V* = mean(R, G, B), warmth *w* = (R − B) ÷ V, and the ground
  intensity *I* (the flight's 2–98 % stretch, 0–255). Distance to each class:
  ((V − V₀)/30)² + ((w − w₀)/0.25)² + ((I − I₀)/90)², with
  topsoil (55, 0.55, 20), aggregate/stone (150, 0.02, 230), soil/spoil
  (110, 0.70, 90). The nearest class within 3 spreads gets the cell's vote
  (farther = "looks like none"); intensity alone uses a spread of 60.
  The pile's guess is the majority; **confidence** = the winner's share of the
  sampled cells (≥ 70 % high, ≥ 45 % medium, else low). At least 4 cells are
  needed.
- The guess is read from the picked flight; if the pile isn't there (or too
  low to judge) it's read from the flight where the pile was biggest.
- **Weight** = volume × a typical loose (stockpiled) density: topsoil
  1.3 t/m³ (81 lb/ft³), stone and soil 1.6 t/m³ (100 lb/ft³).

## What it needs from the flight

Elevation for volume. Colour and/or intensity for the material guess (colour
is the stronger clue; intensity alone works for stone vs topsoil). Ground
classes make the guess skip machines and plants on the pile. Without colour or
intensity the dropdown says "no colour in this flight" — choose the material.

## Limits and honesty notes

- Volume is measured above the **first flight's** ground: a pile that was
  already there on day one, or ground that was cut under the pile, is wrong.
- The classes are three broad looks, tuned on typical material colours; real
  light (overcast, low sun, wet material) shifts colour. Check the guess once
  and set it.
- Weights use typical loose densities, which vary ±15 % with moisture and
  grading; a weighbridge ticket beats them.
- A flight that came back high or low adds that error × the zone's area to the
  volume (the demo's 21 Sep flight adds ~15 m³ to the spoil pile).

## Measured on the demo

| Pile | Measured volume by flight (m³) | Truth `truth.stockpiles` (m³) | Guess (confidence) |
|---|---|---|---|
| Spoil | 0, 286, 572, 685, 471, 189, 114, 56 | 0, 285, 570, 684, 456, 190, 114, 57 | soil/spoil on every flight with a pile (95–100 %) |
| Topsoil | 0, 93, 155, 170, 176, 168, 170, 169 | 0, 92, 154, 169, 169, 169, 169, 169 | topsoil on every flight (99–100 %) |
| Aggregate | 0, 0, 0, 0, 3, 149, 147, 62 | 0, 0, 0, 0, 0, 147, 147, 62 | aggregate from 5 Oct (100 %); no pile before |

Test tolerance: ±4 % or 8 m³ (20 m³ on the 3.5 cm-high 21 Sep flight); the
guess must be right with ≥ 90 % confidence at each pile's biggest flight.

## Files

- `frontend/src/site/quantities.ts` — `classifySample`, `guessMaterial`,
  `pileSamples`, `PILE_MATERIALS`
- `frontend/src/site/tabs/quantities/StockpilesSection.tsx` — map, table, chart
- `frontend/src/site/tabs/quantities/model.ts` — `usePiles`
- `backend/app/sites.py`, `frontend/src/site/types.ts` — optional
  `Zone.material` (default None, old files load)
- Tests: `frontend/src/site/quantities.test.ts`,
  `backend/tests/test_quantities_truth.py`

## Review checklist

- [ ] Riverside → Quantities → Stockpiles, 7 Sep: spoil ≈ 896 yd³ "Looks like
      soil / spoil (high confidence)", topsoil ≈ 223 yd³ "Looks like topsoil",
      aggregate 0.
- [ ] 5 Oct: aggregate ≈ 195 yd³, "Looks like aggregate / stone", ≈ 263 tons.
- [ ] Set the spoil pile to Topsoil → weight changes, reload the site → still
      Topsoil; set back to the guess.
- [ ] Chart: three lines; spoil peaks 7 Sep, aggregate appears 5 Oct.
- [ ] Add stockpile → draw → a new row; delete it (asks first).
