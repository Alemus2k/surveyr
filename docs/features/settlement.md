---
id: settlement
title: Settlement monitors
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, control]
---

# Settlement monitors

**One-line summary:** watches an area (a fill, a pad, behind a wall) flight after flight and says how much it has settled since the work there stopped, where, and whether it passed the alert — with each flight levelled to the check points so a bad flight doesn't read as movement.

## Why it exists

Fill that keeps settling cracks paving and slabs. Settlement plates are few and get run over; the drone measures the whole area every flight. The project engineer wants "is the parking fill still moving, and where?".

## Where to find it

*Job sites → (site) → Checks & records → Settlement*.

## How to use it

1. **Draw area** around the fill. Set *Alert when it moves* (default 0.08 ft / 2.5 cm) and *Measure from*: **Auto — once the fill is in**, or a fixed flight.
2. Pick a flight in the timeline: the map shows movement since the baseline (red = settled, blue = rose), the tiles the worst spot, the average and the area over the alert; the chart shows every flight.

Demo: *Parking lot fill*.

## How it works

- **Surfaces:** each flight's ground on the site's shared grid (~1 m cells, mean of points), cells inside the outline.
- **Levelling:** when the site has check points, each flight is shifted by its mean error at the check points (Control & accuracy). The demo's 21 Sep flight came back +3.4 cm; this removes it.
- **Averaging:** each cell is the mean of a 5 × 5-cell window (needs ≥ 55 % measured), i.e. ~5 m square — areas, not single cells.
- **Baseline (auto, per cell):** the first flight after which, compared with that flight, the cell
  - if it had been filled by then (risen > the site's change threshold since its first flight): never rose more than 1.5 cm and never dropped more than the change threshold;
  - otherwise: never moved more than 1.5 cm either way.
  Bigger later changes are taken as more work (fill placed a lift at a time, a grader trim) and push the baseline past them. A fixed baseline flight uses that flight for every cell.
- **Movement** = flight − baseline for later flights (negative = settled).
- **Per flight:** worst settlement and heave (and where), mean, area over the alert. **Alert** when at least 4 averaged cells moved more than the alert.
- **Uncertainty:** cell noise = robust spread of movement minus its 5 × 5 median; a spot is good to ±2·√(noise² + level²); the average to ±2 × the check points' standard error (levelled) or ±4 cm (not levelled: ±3 cm per flight, two flights).

## What it needs from the flight

Elevation. **Check points** (Control & accuracy) strongly recommended: without them, a whole flight a few cm off reads as movement, and the tab says so.

## Limits and honesty notes

- Auto baselines are made for fills: any later rise is treated as more fill, so auto mode can't show heave, and settlement of untouched ground over 1.5 cm moves its baseline. To watch natural ground, a structure or heave, pick a fixed baseline flight.
- Changes below the site's change threshold can't be told apart from fine grading; the averaging, levelling and minimum alert area keep single-cell noise from raising alerts, not grading done after the baseline.
- Machines and spoil sitting on the area at a flight hide or raise it there.
- Drone LiDAR is ±2–5 cm per point; over a 5 m window and levelled to check points the demo reaches ±0.7 cm per spot.

## Files

- `backend/app/checks.py` — `auto_baseline`, `analyse_monitor`, `_window_mean`; `POST /api/sites/{id}/checks/monitor`
- `frontend/src/site/tabs/ChecksTab.tsx` (`MonitorDetail`, movement map layer), `tabs/ChecksCharts.tsx` (`MovementChart`), `site/checks.ts` (`monitorFinding`)
- Tests: `backend/tests/test_checks.py` (baseline rules by hand, a levelled synthetic settling area, demo truth, untouched demo ground)

## Review checklist

- [ ] Riverside → Checks & records → Settlement → *Parking lot fill*, flight 2 Nov: alert raised, worst settlement ≈ 0.12 ft (3.7 cm ± 0.7 cm; truth max 3.0 cm), in the north-west of the lot; nothing rises past the alert.
- [ ] Step the timeline back to 24 Aug: no alert (fill not in yet).
- [ ] The note says flights are levelled to the check points.
- [ ] Set *Measure from* to 27 Jul: the whole fill shows as risen — that's why auto mode exists.
