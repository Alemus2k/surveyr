---
id: ada-slopes
title: ADA slope check on flatwork
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, classification]
---

# ADA slope check on flatwork

**One-line summary:** finds stretches of a poured walk, ramp, landing or accessible stall that are too steep for a wheelchair (running or cross slope over the ADA limit), with how sure the scan is — so they're fixed before the inspector's smart level finds them.

## Why it exists

A sidewalk with a 3 % cross slope fails the accessibility inspection and gets torn out. Checking every metre with a level is slow; the drone flew over it anyway. But drone accuracy (±2–5 cm) over a 1 m window is ±2–5 % of slope, so the check must average enough points before calling anything a failure.

## Where to find it

*Job sites → (site) → Checks & records → Walks & ramps*.

## How to use it

1. Pick a flight after the concrete was poured.
2. **Draw walk** around it (corners, then click the first point); set *What it is*: walk, ramp, landing or accessible parking.
3. The strip chart shows each stretch's slope against the limit; the map colours stretches red (too steep), amber (check with a level), green; the list words each failure ("Cross slope 3.4 % over 33 ft at E…, allowed 2 %").

Demo: *Pad sidewalk*, flight 2 Nov.

## How it works

- **Limits** (running / cross): walk 5 % / 2 %; ramp 8.33 % (1:12) / 2 %; landing 2 % / 2 %; accessible parking 2 % / 2 %.
- **Points:** ground points inside the outline, at least 5 cm from it (curbs, pad edges). Stray points (a cone, a boot) are dropped: residual from the plane of the surrounding 2.5 m over 3.5 robust sigmas, twice.
- **Directions:** running = the long axis of the points (principal direction); cross = square to it.
- **Stretches:** points binned every 0.5 m along; an optimal split into stretches, each fitted by its own plane z = a + b·along + c·across, minimising the total squared residual plus a penalty of 10·σ² per stretch (σ = robust point noise), found exactly by dynamic programming over prefix sums. A slope change is only found where enough points support it.
- **Verdict per stretch and direction:** with the plane's standard errors (never below what the noise allows), *too steep* when |slope| − limit ≥ max(0.2 %, 2 standard errors) over ≥ 3 m (~10 ft) and ≥ 30 points; *check with a level* when over by ≥ max(0.2 %, 1 standard error); otherwise within limits.
- The 2 m-window dots on the chart are for context only (noisy at low density).

## What it needs from the flight

Elevation; classification helps (people, cones, machines are ignored). A flight after the pour — before it, it measures whatever is there.

## Limits and honesty notes

- Stretch ends are only as sharp as the density allows: at the demo's 4 points/m² ±2 cm, a 10 m bad stretch is found within ~4 m of its true ends; at real drone densities (100+ points/m²) within the 0.5 m bin.
- Flaws shorter than 3 m can't be called failures (they can be "check with a level").
- Draw each straight run separately: an L-shaped outline has no single long axis.
- Cross slope here is the plane's slope across the whole width; a crowned or warped walk is averaged.
- Always confirm with a smart level before tearing out.

## Files

- `backend/app/checks.py` — `analyse_flatwork`, `_moments`, `_fit`, `_segment`; `POST /api/sites/{id}/checks/flatwork`
- `frontend/src/site/tabs/ChecksTab.tsx` (`WalkDetail`), `tabs/ChecksCharts.tsx` (`SlopeStrip`), `site/checks.ts` (`stretchFinding`)
- Tests: `backend/tests/test_checks.py` (dense synthetic walk: exact stretch; running limit by kind; five noise-only sparse walks → no failures; demo truth)

## Review checklist

- [ ] Riverside → Checks & records → Walks & ramps → *Pad sidewalk*, flight 2 Nov: exactly one red stretch, cross slope ≈ 4 % (truth 3.4 %; ±0.4 % spread), over ≈ 33 ft between E ≈ 612536–612546 m (truth 612540–612550; the demo's density limits the ends); the rest within limits (≈ 1.5–2.0 %).
- [ ] Change the kind to *Ramp*: running limit 8.33 %; still only the cross-slope failure.
- [ ] Verdict headline counts it: "1 thing to look at before the inspector does".
