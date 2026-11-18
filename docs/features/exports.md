---
id: exports
title: Exports
status: experimental
since: "0.7.0"
area: export
origin: roadmap
data_used: [elevation, rgb, intensity, returns, classification, time, design]
---

# Exports

**One-line summary:** write a scan or a job site out as files the GC's partners
already use — a CAD drawing, a civil surface, survey points, a GIS grid, the
cleaned ground points, the site plan, and a progress data file for
project-management software.

## Why it exists

Surveyr's numbers are only useful if they reach the people who act on them: the
engineer (CAD, civil design), the surveyor (points), the GIS person, the
machine-control tech, the owner's PM (progress). Each of them asks for a
different file. Exports make those files without anyone re-measuring.

## Where to find it

Engine endpoints under `/api/exports/…`, client in `frontend/src/export/api.ts`.
Files land in **Downloads → Surveyr** (`~/Downloads/Surveyr`, created when
needed). Screens are to be built on the client.

## How to use it

1. `POST /api/exports/scan/{project_id}` or `POST /api/exports/site/{site_id}`
   with `{"format": "...", "options": {...}}`.
2. The answer says where the file is:
   `{"path", "filename", "bytes", "files": [{path, filename, bytes}, ...], ...extras}`.
   `files` includes companions (`.prj`, `_wgs84.geojson`); the top-level fields
   describe the main file.
3. `POST /api/exports/reveal {"path": ...}` opens Explorer / Finder at the file.
4. Demo: `POST /api/exports/site/riverside_commons {"format": "progress"}`.

Nothing is ever overwritten: a taken name becomes `name (2).ext`, `name (3).ext` …
(companion files share the number). Scans are never modified.

### Endpoints

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/exports/folder` | — | `{folder}` |
| POST | `/api/exports/scan/{project_id}` | `{format: dxf\|landxml\|csv\|asc\|las, options}` | export result |
| POST | `/api/exports/site/{site_id}` | `{format: dxf\|landxml\|csv\|asc\|las\|geojson\|progress, options}` | export result |
| POST | `/api/exports/reveal` | `{path}` | `{path}`; 400 outside the export folder |
| GET | `/api/projects/{id}/contours`, `/api/sites/{id}/contours` | see [contours](contours.md) | contour JSON |

Errors: 400 with a plain sentence in `detail` (unknown format or option, bad
value, unknown zone or flight, nothing measured, too many points); 404 for an
unknown scan or site.

### Options (all optional)

| Option | Default | Used by | Meaning |
|---|---|---|---|
| `unit` | `"m"` | all but geojson/progress | `m`, `us_ft` (1200/3937 m) or `ft` (0.3048 m). Scales coordinates **and** elevations. |
| `scan` | latest flight | site dxf/landxml/csv/asc/las | a flight's project id, or `"design"` (not for las) |
| `interval_m` | automatic | dxf | contour interval in metres |
| `major_every` | 5 | dxf | every n-th level is major |
| `smooth` | 0 | dxf | contour smoothing, grid cells (0–3) |
| `contours`, `labels`, `spots` | true | dxf | which parts to draw |
| `spacing_m` | ≈ 40 points across the site | dxf spots, csv | point spacing; rounded to a whole number of grid cells (the answer gives the actual `spacing_m`) |
| `zone_id` | — | site csv | only points inside this zone |
| `header` | true | csv | header row |
| `description` | `"GROUND"` | csv | description column |
| `compressed` | false | las | write `.laz` |
| `wgs84` | true | geojson | also write a longitude/latitude copy |

Unknown options are refused (400), so a typo never silently does nothing.

## How it works — format by format

### DXF (`.dxf`) — CAD

ASCII DXF, AutoCAD R12 (`$ACADVER AC1009`): HEADER, TABLES (LTYPE, LAYER) and
ENTITIES only — the subset every CAD program reads. `$INSUNITS` is 6 (metres),
2 (feet) or 21 (US survey feet); `$MEASUREMENT` 1 metric / 0 imperial.
Coordinates have 4 decimals.

| Layer | Colour | Entities |
|---|---|---|
| `CONTOUR_MAJOR` | 7 | 3D POLYLINE (flag 8; +1 when closed), every vertex at the contour elevation |
| `CONTOUR_MINOR` | 8 | same |
| `CONTOUR_LABELS` | 7 | TEXT: the elevation, halfway along each major line, rotated along it (lines shorter than 8 text heights are not labelled) |
| `SPOT` | 3 | POINT at (E, N, Z) + TEXT of the elevation (2 decimals) |
| `ZONES` | 2 | site: closed 2D POLYLINE per zone + TEXT of its name at the vertex average |
| `LOD` | 1 | site: closed 2D POLYLINE, the limits of disturbance |
| `ALIGNMENTS` | 4 | site: open 2D POLYLINE + TEXT of its name at the start |

Closed polylines do not repeat their first vertex (the closed flag does that).
Text height ≈ site size / 150 (at least one cell). Names with non-ASCII
characters are written as `\U+XXXX`. Contours: see [contours](contours.md).

### LandXML surface (`.xml`) — civil design, machine control

One `<Surface>` TIN built from the grid: a point at every measured cell centre
that belongs to a fully measured square, and two triangles per square whose four
corners were all measured (SW-SE-NE and SW-NE-NW, counter-clockwise). Unscanned
squares are holes. `<Units>`: `meter` (squareMeter / cubicMeter) or
`USSurveyFoot` / `foot` (squareFoot / cubicYard); `<CoordinateSystem name>`
when the scan has one. Points are `northing easting elevation`, 4 decimals.
Reads back with `landxml.read_tin` (tested).

### CSV points (`.csv`) — survey, data collectors

`Point,Northing,Easting,Elevation,Description` (PNEZD), CRLF line ends,
numbered from 1, 4 decimals, south-to-north rows, west to east. Each point is a
grid cell centre and its measured elevation (every k-th cell, k = spacing ÷
cell); nothing is interpolated and unscanned cells are skipped. With `zone_id`,
only cells whose centre is inside the zone. Commas in the description are
replaced by spaces.

### ESRI ASCII grid (`.asc` + `.prj`) — GIS

`ncols, nrows, xllcorner, yllcorner, cellsize, NODATA_value -9999`
(corner-registered), then one line per row from the **north** edge down.
Unscanned cells are −9999. A `.prj` (ESRI WKT) is written when the scan's LAS
file carries a coordinate system *in the same unit as the export*; otherwise the
answer's `note` says why there is none.

### LAS / LAZ (`.las`, `.laz`) — point-cloud software

What the app actually measures: the scan's settings applied (units, up axis,
elevation correction), ground class only when the scan is classified and the
"ground only" setting is on, elevation outliers removed (the same filter as every
analysis). LAS 1.4, point format 6 (7 with colour), 1 mm scale. Carries over
intensity, classification, return number / count, GPS time, scan angle and
colour (as 16-bit). The answer lists the channels and `ground_only`. The CRS is
written only when its unit matches the export unit (`crs: true/false`).

### GeoJSON (`.geojson`, `_wgs84.geojson`) — GIS, web maps, Google Earth

A FeatureCollection of the site's zones (Polygon; properties `layer: "zone"`,
`id, name, kind, color, start, finish, target_elevation_m, design_offset_m`),
limits of disturbance (Polygon, `layer: "lod"`) and alignments (LineString,
`layer: "alignment"`, `interval_m, half_width_m`). Rings are closed and
counter-clockwise. Coordinates are in the scan's coordinate system and its own
unit, with a `crs` name member (`urn:ogc:def:crs:EPSG::<code>`) and a
`surveyr` member (`site, units, crs_name, epsg`). When the scan has an EPSG code
pyproj can transform, a second file `…_wgs84.geojson` holds longitude/latitude
(RFC 7946, no `crs` member). Without a coordinate system: one file, no `crs`,
no WGS84 copy.

### Site progress (`surveyr-progress.json`) — project-management software

A versioned, documented snapshot for other software to ingest. **This file is
the seam for integrations: change it only by adding fields; anything else
bumps `schema_version`.** All quantities metric (m, m², m³); dates
`YYYY-MM-DD`; `null` means "does not apply / could not be measured".

```jsonc
{
  "schema": "surveyr-progress",
  "schema_version": 1,
  "generated_at": "2026-11-14T18:03:12+00:00",   // UTC, ISO 8601
  "generator": "Surveyr",
  "units": "metric",
  "site": {
    "id": "riverside_commons", "name": "Riverside Commons",
    "design_id": "riverside_grading",             // null without a design
    "tolerance_m": 0.05,                          // on grade within this of finished grade
    "change_threshold_m": 0.05,                   // smaller flight-to-flight changes are noise
    "overbill_pct": 10.0,
    "crs": {"name": "WGS 84 / UTM zone 17N", "epsg": 32617, "unit": "m"}   // or null
  },
  "grid": {"cell_size_m": 0.25, "x0": 612400.0, "y0": 4270150.0, "nx": 720, "ny": 560},
  "flights": [{"id": "riverside_2026-07-27", "date": "2026-07-27"}, ...],   // oldest first
  "zones": [{
    "id": "pad", "name": "Building pad", "kind": "grading",               // or "stockpile"
    "polygon": [[easting, northing], ...],                               // site coordinates, metres
    "planned_start": "2026-08-03", "planned_finish": "2026-09-18",        // or null
    "grade": {"target_elevation_m": null, "design_offset_m": 0.0}         // finished-grade spec
  }],
  "pay_apps": [{
    "id": "pa1", "date": "2026-08-24", "zone_id": "pad",                  // zone_id null = whole site
    "kind": "cut", "claimed_m3": 1160.0, "contractor": "…", "note": "",
    "check": {
      "id": "pa1", "from_date": "2026-08-10", "to_date": "2026-08-24",    // null when < 2 flights
      "measured_m3": 1134.2, "difference_m3": 25.8, "difference_pct": 2.28, "flagged": false
    }
  }],
  "layers": [ /* site material layers exactly as stored in the site file */ ],
  "quantities": [{
    "zone_id": "pad",
    "cells": 76800,                       // grid cells whose centre is inside the zone
    "graded_against_design": true,        // grading zone with a finished grade to compare with
    "baseline_m3": 2377.9,                // remaining cut + fill at the first flight (null if not graded)
    "flights": [{
      "project_id": "riverside_2026-08-10", "date": "2026-08-10",
      "measured_area_m2": 4800.0,
      "remaining_cut_m3": 1603.4,         // still above finished grade (null: not a graded zone)
      "remaining_fill_m3": 100.0,         // still below finished grade
      "on_grade_pct": 41.2,               // share of measured cells within tolerance (0–100)
      "pct_complete": 28.37,              // 0–100; null if baseline < 1 m³ or not graded
      "stockpile_m3": null,               // stockpile zones: volume above the first flight
      "cut_since_previous_m3": 61.9,      // null on the first flight
      "fill_since_previous_m3": 617.9
    }]
  }]
}
```

Definitions — a NumPy mirror of `frontend/src/site/progress.ts` and
`finishedGrade` in `frontend/src/site/specs.ts`, so the file always agrees with
the dashboard:

- **Zone cells**: shared-grid cells whose centre is inside the polygon (even–odd rule).
- **Finished grade**: the design, with each zone's grade spec applied inside its
  outline — flat `target_elevation_m` if set, else design + `design_offset_m`
  (later zones win where they overlap). Without a design, only flat-pad zones
  can be graded.
- **Remaining cut / fill** = Σ over zone cells measured in both the flight and
  finished grade of max(±(flight − grade), 0) × cell², where differences with
  |d| ≤ `tolerance_m` count as 0.
- **Cut / fill since previous** = the same between the previous flight and this
  one (went down = cut, went up = fill) with `change_threshold_m` as the dead band.
- **% complete** = 100 × (1 − remaining / baseline), clamped to 0–100, where
  remaining = cut + fill and baseline = remaining at the first flight;
  null when the baseline is under 1 m³.
- **Stockpile volume** = fill between the *first* flight and this one (change threshold applies).
- **Pay-app check**: the change in the pay app's zone (whole site if none)
  between the flight on or before its date and the flight before that;
  `measured_m3` is the cut or fill matching its kind; `flagged` when the claim
  exceeds measured by more than `overbill_pct` (or anything is claimed when
  nothing was measured).

## What it needs from the flight

Elevation for everything. LAS also carries whatever channels the scan has.
A coordinate system (LAS/LAZ with a CRS record) is needed for `.prj`, the
GeoJSON `crs` member and the WGS84 copy; without one those parts are skipped and
the answer says so.

## Limits and honesty notes

- **DXF has no coordinate system.** The drawing is in the scan's grid coordinates
  in the chosen unit; the CAD user must know the CRS (it is in the GeoJSON, `.prj`
  and progress file).
- **The LandXML TIN, ASCII grid, CSV points and DXF spots come from the grid**
  (cell means on the analysis or site grid), not the original points: detail
  smaller than a cell is averaged away. Use the LAS export for full detail.
- Changing `unit` converts numbers only; it never re-projects. A `.prj` or LAS
  CRS is written only when its unit matches, so a file never claims the wrong unit.
- US survey feet vs international feet differ by 2 ppm (≈ 2 cm over 10 km of
  state-plane coordinates). Pick the one the receiving project uses.
- Progress quantities are prismatic volumes on the shared grid; equipment parked
  on a zone during a flight is measured as ground (the demo shows this on a few
  mid-project flights).
- Reveal opens only files inside the export folder.

## Files

- `backend/app/exports.py` — endpoints, export folder, naming, reveal, orchestration
- `backend/app/export_formats.py` — DXF / CSV / ASC / GeoJSON writers, grid TIN, spot lattice, polygon mask
- `backend/app/site_progress.py` — progress quantities (mirror of `progress.ts`)
- `backend/app/landxml.py` — `write` gained metric area/volume units, escaped names, 4 decimals
- `backend/app/main.py` — one `include_router` line
- `frontend/src/export/api.ts` — typed client and helpers
- Tests: `backend/tests/test_exports.py`, `frontend/src/export/api.test.ts`

## Review checklist

- [ ] Export the demo site as DXF (metres and US feet) and open both in a CAD viewer: contours on two layers with labels, zones with names, LOD, the road centreline, spot elevations; the feet drawing measures 3.28× larger
- [ ] Export the latest flight as LandXML and import it into civil software: a surface with the site's outline and holes where nothing was scanned
- [ ] CSV with `zone_id: "pad"`: only points inside the building pad
- [ ] ASCII grid in metres comes with a `.prj` (UTM 17N); in feet, no `.prj` and a note
- [ ] LAS of the latest flight opens in a point-cloud viewer with colour, ground only, UTM 17N
- [ ] GeoJSON + `_wgs84` copy: the WGS84 file shows the zones in the right place on a web map
- [ ] `surveyr-progress.json`: pad `pct_complete` ≈ 99 on the last flight; pay app `pa2` flagged
- [ ] Exporting the same thing twice gives `… (2).ext`; nothing is overwritten
- [ ] Reveal opens the file manager at the file; a path outside the export folder is refused
