---
id: pond-storage
title: Pond storage (stage–storage)
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, design]
---

# Pond storage (stage–storage)

**One-line summary:** how much water the detention pond holds below its outlet
today, against what the design holds and what the drainage report requires —
"Holds 65% of the design volume — 360 yd³ still to dig below the outlet".

## Why it exists

A detention pond is accepted on storage, not on looks: the engineer's
stage–storage table says how many cubic yards sit below the outlet. The super
asks *is it dug out enough?*; the PM asks *will it pass the inspection?*

## Where to find it

*Job sites → (a site) → Quantities tab → Pond storage* (or the "Pond storage"
tile).

## How to use it

1. If no pond is set up, pick the **zone** that outlines it (a zone whose name
   says pond / basin / detention is picked first), check the **outlet (spill)
   elevation** — it starts at the lowest point on the zone's edge in the design;
   use the plans — and, optionally, the **required storage** from the drainage
   report. Click **Check this pond**.
2. The verdict line, the map (water depth below the outlet; amber where no
   ground was seen) and the numbers follow the flight picked in the timeline.
3. The stage–storage chart shows the water held at each level, as built
   (solid) and designed (dashed); hover for figures.
4. **Edit pond** changes the outlet or required volume; **Delete** (asks first)
   stops checking it; **Add pond** sets up another.

Demo: *Riverside Commons* → Detention pond, outlet 210.40 m (690.29 ft).

## How it works

Over the grid cells inside the pond zone, on one surface (the flight, or the
finished grade = design with any zone grade specs):

- **Storage below elevation E** = Σ max(0, E − ground) × cell area, over cells
  with ground measured. Storage = that at the outlet elevation.
- The **curve** is evaluated at 31 levels from the lowest ground (flight or
  design) to the outlet; both surfaces use the same levels.
- **% of design** = flight storage ÷ design storage; **still to dig** = design −
  flight (storage the design has below the outlet that the ground doesn't yet).
- **Required** (when set): met / short by; and a warning if the design itself
  holds less than required.
- **Floor not seen**: cells inside the zone with no ground on the flight —
  usually standing water (LiDAR gets no return from it), sometimes a machine.
  They're **not** guessed into the storage. The verdict says how much wasn't
  seen and gives an upper figure: as if the unseen floor were as low as the
  lowest ground seen (unseen area × (outlet − lowest ground)).

## What it needs from the flight

Elevation. A design surface for "% of design" and the design curve; without
one the tab shows the storage alone and says to add a design.

## Limits and honesty notes

- Storage counts only ground that was seen; with standing water the true
  figure is between the two numbers shown.
- The zone must contain the whole pond below the outlet; storage outside it is
  not counted, and a zone drawn far beyond the rim counts any low ground in it.
- The outlet is a single elevation (a weir or orifice crest); multi-stage
  outlets need one check per stage.
- A flight biased high reads less storage (the demo's 21 Sep flight, 3.5 cm
  high, reads 63 m³ vs 68 m³).

## Measured on the demo (outlet 210.40 m)

| Flight | Measured (m³) | Not seen | Up to (m³) | Truth `truth.pond.storage_m3` |
|---|---|---|---|---|
| 27 Jul | 0.0 | 0 | — | 0.0 |
| 10 Aug | 0.0 | 0 | — | 0.0 |
| 24 Aug | 0.9 | 0 | — | 3.2 |
| 7 Sep | 23.8 | 0 | — | 24.1 |
| 21 Sep (3.5 cm high) | 62.6 | 0 | — | 68.0 |
| 5 Oct | 114.2 | 18 m² (machine) | 147.2 | 126.3 |
| 19 Oct (standing water) | 187.9 | 55 m² | 284.3 | 284.7 |
| 2 Nov | 519.4 | 9 m² | 535.7 | 537.7 |
| **Design** | **793.6** | — | — | **798.3** |

Tolerances (test): design ±2 %; fully-seen flights ±8 % or 8 m³; with unseen
floor, measured ≤ truth + 5 m³ ≤ "up to" + 10 m³, and under standing water the
"up to" figure is within 5 % of the truth.

## Files

- `frontend/src/site/quantities.ts` — `storageBelow`, `stageStorage`,
  `stageLevels`, `lowestRim`
- `frontend/src/site/tabs/quantities/PondSection.tsx` — setup, verdict, map,
  chart
- `frontend/src/site/tabs/quantities/model.ts` — `usePonds`, `suggestOutlet`
- Tests: `frontend/src/site/quantities.test.ts`,
  `backend/tests/test_quantities_truth.py`

## Review checklist

- [ ] Riverside → Quantities → Pond storage, 2 Nov: "Holds 65% of the design
      volume — about 359 yd³ still to dig below the outlet" (amber).
- [ ] 19 Oct: the verdict adds "about 590 sq ft of the pond wasn't seen …
      holds at least 246 yd³ … up to 372 yd³"; the map shows an amber disc in
      the middle.
- [ ] Chart: dashed design curve to the right of the solid as-built curve,
      both ending at the outlet line.
- [ ] Edit pond → set a required volume of 1,200 yd³ → "Short of the required
      … The design itself only holds …".
- [ ] Delete the pond → setup form, with Detention pond preselected and the
      outlet suggested.
