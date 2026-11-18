---
id: flight-data
title: Whole-flight data (colour, intensity, classes, returns)
status: experimental
since: "0.7.0"
area: import
origin: roadmap
data_used: [rgb, intensity, returns, classification, time]
---

# Whole-flight data

**One-line summary:** Surveyr now reads everything a survey drone records for
each point — colour, laser intensity, return numbers, classification and GPS
time — instead of only the position, and makes it available to every tool.

## Why it exists

The flight and the pilot are already paid for. Elevation alone gives
earthworks; the other channels tell you what is standing on the ground
(trees, machines), what the surface is made of (aggregate vs soil vs concrete),
and how much of the ground the laser actually reached. Later features (site
conditions, stockpile materials, ground classification) all build on this.

## Where to find it

Nothing new to click by itself: it powers the **Site conditions** tab, material
detection in **Quantities**, and the scan summary (Terrain panel: which channels
a scan has, points per class).

## How it works

- **Reading files** (`backend/app/io.py`):
  - LAS/LAZ: `intensity`, `return_number`, `number_of_returns`, `gps_time`,
    `classification`, `scan_angle` and — for colour point formats — `red`,
    `green`, `blue`.
  - PLY: `red/green/blue` (also `r/g/b`, `diffuse_*`), `intensity`,
    `classification`, `return_number` when present (phone apps colour their PLYs).
  - XYZ: a 6-column `x y z r g b` file keeps its colour.
  - Colour is stored as 0..1 whatever the file's bit depth: values ≤ 1 are taken
    as-is, ≤ 255 divided by 255, otherwise by 65 535. All-zero colour fields
    mean "no colour".
- **Terrain vs everything:** analysis and volumes still use only ground points
  when the scan is classified and *Ground points only* is on. The new
  `service._load_full()` keeps every point and every channel for tools that want
  them.
- **API:**
  - `GET /api/points/{id}?everything=true` — all classes, no outlier filter
    (default stays the cleaned terrain).
  - `GET /api/points/{id}/attributes` — colour (u8 RGB), intensity (u8,
    contrast-stretched between the 2nd and 98th percentile; the raw range is in
    the header), classification, return number, number of returns, for the same
    points in the same order as `/api/points` with the same query.
  - `GET /api/sites/{site}/rasters/{scan}` — one flight on the site's shared grid:
    coverage, top-down photo (mean colour of what's on top: canopy / machines if
    any, else ground), ground intensity, vegetation height and object height
    (highest point of that class above the cell's ground), points per cell (all /
    ground). Classes 7 and 18 (noise) are ignored; a scan without ground classes
    is treated as all ground, so the height layers come back empty.
  - Responses with several arrays use one packed binary layout
    (`backend/app/binary.py`, read by `frontend/src/lib/binary.ts`): 4-byte header
    length, JSON header, then 8-byte-aligned arrays.
- **Analysis summary:** `points.channels` (what the scan has), `points.classes`
  (points per ASPRS class), `points.total` (all points before the ground filter).

## What it needs from the flight

Nothing is required; every channel is optional. Phone scans usually have colour
only; survey drones have everything if their processing software exports it
(turn on RGB colourisation and keep the classification in the LAS export).

## Limits and honesty notes

- Intensity isn't calibrated across sensors, flights or ranges: compare it
  within a flight, not between flights or drones.
- "Object height" includes anything that isn't ground or vegetation in the
  file's classes — machines, structures, pipe, but also misclassified noise.
- Rasters are on the site's ~1 m grid: features narrower than a cell (a 1 m
  trench) blur. Point-based tools (checks & records) work on the points instead.

## Files

- `backend/app/io.py`, `pcd.py` — reading channels
- `backend/app/service.py` — `_load_full`, `_terrain_of`, attribute sampling, channel summary
- `backend/app/sites.py` — `rasters()`
- `backend/app/binary.py`, `frontend/src/lib/binary.ts` — packed arrays
- `frontend/src/site/rasters.ts` — `useFlightRasters`
- Tests: `backend/tests/test_channels.py`, `frontend/src/lib/binary.test.ts`

## Review checklist

- [ ] Open a single Riverside flight; the Terrain panel lists colour, intensity
      and classification, with points per class.
- [ ] Riverside → Site conditions → Photo shows trees, machines and stockpiles in
      colour (see that feature's checklist).
