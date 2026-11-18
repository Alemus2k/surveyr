---
id: demo-site
title: Riverside Commons demo site
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, rgb, intensity, returns, classification, time, design, control]
---

# Riverside Commons demo site

**One-line summary:** a realistic, fully synthetic job site — eight drone
flights over 14 weeks — with the exact answer known for everything the app
measures, so every feature can be shown off and tested against truth.

## Why it exists

New users need something to click on before their first real flight, and
developers need ground truth: real scans never come with the right answer.

## Where to find it

*Job sites → Riverside Commons* (installed automatically). Its scans are under
Projects, labelled "in Riverside Commons"; the design is *Riverside Grading*
(LandXML).

## What's in it

About 180 × 140 m of rolling meadow with scattered trees, in UTM zone 17N.
Flights every two weeks, 27 Jul → 2 Nov 2026, ~110 000 points each with colour,
intensity, returns, classes and GPS time.

| Story | Where / when | What the app should find |
|---|---|---|
| Earthworks | pad, parking lot, pond, road | pad done early (7 Sep); parking and road catch up; pond well behind |
| Bad flight | 21 Sep | 3.5 cm (0.11 ft) high against the 12 check points |
| Clearing | ahead of each work area | 150 trees → 51; brush cleared |
| Equipment | every flight but the first | 3–4 machines (excavator, dozer, truck, roller) |
| Stockpiles | spoil, topsoil, aggregate | spoil grows then is hauled off; topsoil kept; aggregate delivered then used |
| Road base | 2 Nov | 0.20 m aggregate base on 52 m of road, one 7 m patch only 0.11 m thick |
| Trench | 19 Oct | 62 m storm drain trench, ~1.9 m deep, vertical walls, pipe visible at 0.8 % slope, spoil 0.4 m from the edge |
| Storm | 19 Oct | 3 erosion rills on the parking fill slope, sediment and ~64 m² of standing water in the pond |
| Settlement | parking fill | up to 3 cm after it's placed |
| Limits of disturbance | from 5 Oct | spoil pushed ~56 m² outside the limits, west of the pond |
| Sidewalk | 2 Nov | pad sidewalk; one 10 m stretch has a 3.4 % cross slope (ADA allows 2 %) |
| Pay apps | 10 claims | 2 genuinely over-billed (pad 7 Sep +31 %, pond 5 Oct +42 %) |

## How it works

`backend/scripts/make_jobsite_demo.py` builds everything from analytic surfaces
(existing ground, finished grade, and each flight's ground as functions of x, y)
plus objects (trees, brush, machines, pipe), samples points with 2 cm noise, and
writes `riverside_truth.json` with the exact answers computed on a 0.25 m grid
(earthworks left already apply the 5 cm on-grade tolerance, like the app). Tests
compare the app's numbers against that file.

## Limits and honesty notes

Synthetic data is cleaner than reality: no occlusion shadows, no multipath, no
strip misalignment between flight lines, perfect classification in the files.
Treat the demo's agreement with truth as "the maths is right", not "the field
will be this good".

## Files

- `backend/scripts/make_jobsite_demo.py` — generator (the story is in its docstring)
- `backend/app/storage.py` — which files are bundled and seeded
- Tests that use truth: `test_sites.py`, `test_control.py`, `test_channels.py` and each feature's tests

## Review checklist

- [ ] Fresh install shows Riverside Commons under Job sites with 8 flights.
- [ ] The 21 Sep flight is flagged as 0.11 ft high.
