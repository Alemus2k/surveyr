---
id: site-dashboard
title: Job-site dashboard frame and tabs
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, design, control]
---

# Job-site dashboard

**One-line summary:** a job site opens as a dashboard: its name and flights at
the top, warnings about bad flights, a row of tabs (each answering one question
about the site), and a timeline to pick which flight you're looking at.

## Why it exists

0.7 adds several new kinds of analysis per flight (site conditions, quantities,
checks & records). One long page would bury them; tabs keep each question on its
own screen while the flight timeline and warnings stay shared.

## Where to find it

*Job sites → a site*. Tabs, left to right: **Progress**, **Change orders**, then
the 0.7 tabs (Quantities, Site conditions, Checks & records).

## How to use it

- Hover a tab for what it's for; the line under the tabs says the same.
- Pick a flight on the timeline; every tab (and the side tools on the left)
  shows that flight. The badge on each flight is its accuracy against the
  site's check points.
- A small number on a tab counts its items; red means some need a look.

## How it works

- `SiteDashboard.tsx` is the frame. Tabs are registered in
  `site/tabs/registry.tsx` (`SiteTabDef`: id, label, hint, component, optional
  count / alert, and whether the flight timeline applies).
- Every tab receives the same `SiteTabProps`: the site file, every flight and
  the finished grade on the shared grid, progress and pay-app results, the picked
  flight, its points for 3D, and callbacks.
- `PlanView.tsx` is a reusable plan map for tabs (shaded relief + colour layer
  + outlines + markers + hover readout + draw tool). `rasters.ts` loads each
  flight's photo / intensity / vegetation / object / density rasters once and
  shares them between tabs.

## Limits and honesty notes

- The Progress tab keeps its original map component (`SiteMap`); new tabs use
  `PlanView`. They look and behave the same.

## Files

- `frontend/src/site/SiteDashboard.tsx`, `FlightTimeline.tsx`, `PlanView.tsx`, `rasters.ts`
- `frontend/src/site/tabs/` (`types.ts`, `registry.tsx`, `ProgressTab.tsx`, …)
- `frontend/src/lib/binary.ts`

## Review checklist

- [ ] Riverside Commons opens on Progress with KPIs, map, zones, chart and pay apps as before.
- [ ] Change orders tab hides the flight timeline; switching back restores it.
- [ ] Picking a flight on the timeline changes every tab and the side tools.
