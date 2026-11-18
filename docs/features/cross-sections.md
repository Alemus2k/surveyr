---
id: cross-sections
title: Cross-sections along a line
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, classification, design]
---

# Cross-sections along a line

**One-line summary:** the ground along a road, swale or pipe run — a long profile and sections across it every so often — for the picked flight, the flight before it and the design, with stations the way road plans write them.

## Why it exists

Superintendents and project engineers read roads and channels as profiles and sections, not as plan maps: "is the subgrade 8 in under finished grade all along the centreline?", "what did the swale look like at 2+50 last week?". The ~1 m shared grid is too coarse for a 1.2 m trench or a curb line, so this works on the flight's points. It's also the primitive the trench record reuses.

## Where to find it

*Job sites → (site) → Checks & records → Cross-sections*.

## How to use it

1. Pick a flight in the timeline.
2. Click **Draw alignment**, click along the centreline, double-click (or Enter) to finish. Name it, set *Section every* and *Reach either side*.
3. The long profile shows this flight, the previous flight and the design; the slider steps through the cross-sections; the plan map shows the current section line.

Demo: *Access road centreline* on Riverside Commons, flight 19 Oct.

## How it works

- **Stations:** distance along the polyline from its first point. Shown as `1+20` (= 120 ft, hundreds of feet + feet) in US units, `0+120` (= 120 m, km + metres) in metric.
- **Long profile:** a station every 0.25 m. Each station takes the ground points within 0.25 m of the line (perpendicular) and within a window along it that starts at ± half the spacing and doubles up to ± 1 m until it holds 3 points; its elevation is their **median**. Fewer than 3 points → a gap (never interpolated).
- **Cross-sections:** every *interval* along the alignment, a line square to it from *reach* left to *reach* right. Sampled every reach/60 (0.1–0.5 m) with the same rule, using points within min(1 m, interval/4) along the alignment (sections are alike over a metre of road), so sparse flights still give a section.
- **Design:** the design surface (LandXML TIN lattice) is linearly interpolated (Delaunay) at each station — no medians.
- **Ground points:** class 2 when the flight is classified (trees, machines, the pipe don't count), else every non-noise point; gross outliers removed (8 robust sigmas).
- Offsets: looking along increasing stations, L = left (−), R = right (+).

Results are cached per alignment + flight file + settings (`sites._member_stamp`).

## What it needs from the flight

Elevation only. Classification makes it ignore machines and vegetation (without it, they show as bumps). A design is optional (no design line without one); the previous flight is shown when there is one.

## Limits and honesty notes

- Drone LiDAR is ±2–5 cm; medians remove scatter, not a whole-flight bias (see Control & accuracy).
- Under machines and dense canopy there are no ground points: the profile has gaps there.
- At low density (the demo has 4 points/m²) a station can average up to 2 m along the line, smoothing sharp breaks like a trench wall.

## Files

- `backend/app/checks.py` — `polyline`, `project`, `sample_profile`, `surface_at`, `cross_section_lines`, `sections`; endpoint `POST /api/sites/{id}/checks/sections`
- `frontend/src/site/tabs/ChecksTab.tsx` (`SectionsDetail`), `tabs/ChecksCharts.tsx` (`ProfileChart`), `site/checks.ts` (`formatStation`), `site/checksApi.ts`
- Tests: `backend/tests/test_checks.py` (plane profile, gaps, outliers, section geometry, demo road), `frontend/src/site/checks.test.ts` (stations)

## Review checklist

- [ ] Riverside Commons → Checks & records → Cross-sections → *Access road centreline*, flight 19 Oct: the flight line sits a constant ~0.66 ft (0.20 m) under the dashed design between 0+20 and 2+40 m (road cut to subgrade); the section summary reads "Centreline 0.66 ft below design".
- [ ] Flight 2 Nov: the east part (stations 0–52 m) matches the design (base course placed); a gap near 1+00 m is the roller hiding the ground.
- [ ] Draw a new alignment, edit spacing, delete it (confirm dialog).
- [ ] Switch to metric: stations read `0+120`.
