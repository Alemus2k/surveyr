---
id: contours
title: Contour lines
status: experimental
since: "0.7.0"
area: export
origin: roadmap
data_used: [elevation, design]
---

# Contour lines

**One-line summary:** lines of equal elevation drawn from a scan, a flight of a
job site or the design surface — the way every engineer and superintendent
already reads a grading plan.

## Why it exists

Grading plans, cut sheets and as-built drawings are read as contours. A PM
comparing "what the drone saw" with "what the plan says", a superintendent
checking a pad's drainage, or an engineer pulling the scan into CAD all ask for
contours first. They also feed the DXF export (see [exports](exports.md)).

## Where to find it

Engine only for now: `GET /api/projects/{id}/contours` and
`GET /api/sites/{site_id}/contours`. Screens (plan overlay, interval picker)
are to be built on `frontend/src/export/api.ts`.

## How to use it

1. Ask for a scan's contours: `GET /api/projects/riverside_2026-11-02/contours`.
   Without `interval` the engine picks one from the relief (about 25 lines at most).
2. For a job site, pick the flight (`scan=<project id>`), the design
   (`scan=design`) or omit `scan` for the latest flight:
   `GET /api/sites/riverside_commons/contours?interval=0.5`.
3. US-customary users: pass `unit=us_ft` so the automatic interval is round in
   feet, or send a feet interval in metres (1 ft = 0.3048, 2 ft = 0.6096,
   5 ft = 1.524). `intervalChoices("us")` in the client lists them.

Query parameters: `interval` (m, > 0, ≤ 1000; omit = automatic), `major_every`
(1–50, default 5), `smooth` (0–3 grid cells, default 0), `unit`
(`m` | `us_ft` | `ft`, only steers the automatic interval).

Response (all metres, survey coordinates):

```json
{
  "interval": 0.5, "major_every": 5, "cell_size": 0.25,
  "bounds": [west, south, east, north],
  "levels": [
    {"elevation": 210.0, "major": true, "lines": [[[612455.125, 4270201.5], ...], ...]}
  ],
  "scan": "riverside_2026-11-02"      // site contours only: the flight, or "design"
}
```

Levels are ascending; levels with no line are left out; a closed line repeats
its first vertex at the end. Coordinates are rounded to the millimetre.

## How it works

- **Surface.** A scan's contours use the same grid the scan's analysis shows
  (`service.analyze`: cell mean, pinholes filled, light smoothing), with
  unscanned cells removed. A site's contours use the site's shared grid
  (`sites.grids`: cell means, pinholes closed, nothing interpolated).
- **Levels** are whole multiples of the interval, k × interval, between the
  lowest and highest measured cell. `major` is `k mod major_every = 0`, so with
  a 1 m interval the majors fall on 0, 5, 10 … m — and with a 2 ft interval on
  0, 10, 20 … ft.
- **Automatic interval.** The smallest step in the 1-2-5 series
  (0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10 … in metres, or in feet when `unit` is
  feet) that draws at most 25 lines over the relief. Asking for more than 400
  levels is refused with a 400 and an explanation.
- **Tracing (marching squares).** Nodes are cell centres. A square between four
  neighbouring nodes is traced only when *all four* were measured, so a line
  can never cross ground nobody scanned: it ends at the edge of the data. The
  crossing on each square edge is linear interpolation. A node exactly at a
  level counts as above it. Saddles (two opposite corners above, two below) are
  settled by the square's mean: if it is at or above the level, the high
  corners connect.
- **Joining.** Segments are joined through the grid edge they share (an exact
  integer id, not a coordinate comparison), so lines are watertight, rings
  close exactly, and the output is deterministic.
- **Simplification.** Douglas–Peucker with a tolerance of 2 % of the cell size
  (5 mm on a 0.25 m grid): it removes the collinear vertices of straight runs
  and changes no line by more than that.
- **Smoothing** (optional, default off) is applied to the *surface* before
  tracing — a Gaussian of `smooth` cells that only averages measured cells — so
  lines stay level sets of one function and can never cross each other.
- **Caching.** Results are cached until the scan, its settings or the site's
  grid change.

Speed: a 300 × 300 grid traces in well under 0.5 s (tested).

## What it needs from the flight

Elevation only. Uses whatever ground filter the scan's settings choose (ground
class when classified). A LandXML design is a project like any scan.

## Limits and honesty notes

- Contours follow the analysis grid (cell size 0.25–2 m on typical sites), not
  the raw points: features smaller than about two cells are not drawn.
- Linear interpolation between cell centres: a sharp break line (curb, wall
  top) is drawn as a slope one cell wide.
- At an unscanned area the line simply stops; it is not closed around the gap.
  A gap in the data is a gap in the drawing, by design.
- A level exactly equal to the lowest measured elevation draws nothing (there
  is no "below" to separate from).

## Files

- `backend/app/contours.py` — interval choice, smoothing, marching squares, joining, simplification
- `backend/app/exports.py` — the two contour endpoints and their cache
- `backend/app/analytics.py` — `contour_lines` now uses `contours.py` (it used Matplotlib, which the desktop engine does not ship)
- `frontend/src/export/api.ts` — `fetchProjectContours`, `fetchSiteContours`, `intervalChoices`, `relativeLines`
- Tests: `backend/tests/test_contours.py`, `frontend/src/export/api.test.ts`

## Review checklist

- [ ] `GET /api/sites/riverside_commons/contours?interval=0.5` returns levels 209–215.5 m, the pond as closed rings at 210–211 m
- [ ] `?scan=design` returns the design's contours; `?scan=nope` is a 400 naming the problem
- [ ] `GET /api/projects/riverside_grading/contours` (the LandXML design) works
- [ ] A 2 ft interval (`interval=0.6096`) gives levels that are whole even numbers of feet
- [ ] No line crosses an area the flight didn't cover (compare with the coverage map)
- [ ] Nothing under `backend/app/` imports Matplotlib (`grep -r matplotlib backend/app` is empty)
