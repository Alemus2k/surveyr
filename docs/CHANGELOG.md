# Changelog

Newest first. Each entry links to its feature doc, which has the details and a
review checklist. "Idea" marks things added along the way rather than planned —
see [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) to keep or axe them.

## 0.7.0 — unreleased

### Whole app
- **US units by default** (feet to hundredths, cubic yards, square feet / acres),
  metric optional under Appearance; every number, input, chart axis, scale bar
  and copied summary follows the choice. → [units](features/units.md)
- **Getting started page** *(idea)*: first launch lands on a welcome page with
  three ways in, a one-time units choice and how the app fits together; **?** in
  the top bar brings it back. → [getting-started](features/getting-started.md)
- **Rail that names itself** *(idea)*: rest the pointer on the left rail to see
  every panel's name; panels are grouped into places and scan tools.
  → [getting-started](features/getting-started.md)
- **Restore the demo site** *(idea)*: one click reinstalls Riverside Commons as
  shipped (old copies go to the Trash). → [getting-started](features/getting-started.md)

### Importing
- **LandXML design surfaces**: import the engineer's TIN (`.xml`) like a scan;
  units from the file; pick the surface when there are several.
  → [landxml](features/landxml.md)
- **The whole flight is read**: colour, intensity, return numbers,
  classification and GPS time from LAS/LAZ, PLY and XYZ.
  → [flight-data](features/flight-data.md)
- **Automatic ground classification**: for scans without (or with bad) ground
  classes, Surveyr works out the ground itself and separates vegetation from
  machines and structures (Manual adjustments → *Work out ground points
  automatically*; suggested when a scan clearly has things standing on it).
  → [ground-classification](features/ground-classification.md)
- Files that state their units (LandXML, LAS with a coordinate system) are read
  in them by default.

### Job sites
- **Dashboard tabs**: each question about a site gets a tab; the flight timeline
  and bad-flight warnings are shared by all. → [site-dashboard](features/site-dashboard.md)
- **Riverside Commons demo** grows to 8 flights with colour, trees, machines,
  three stockpiles, road base, a trench, storm damage, settlement, a sidewalk and
  a limits-of-disturbance breach — each with exact answers for testing.
  → [demo-site](features/demo-site.md)

### Site conditions (new job-site tab)
- **What the flight saw besides earthworks**: the site from above (colour
  photo), intensity, vegetation and machine layers, flight coverage; trees
  counted and clearing tracked; machines on site per flight; disturbed acreage
  with the 1-acre stormwater-permit note; **work outside the limits of
  disturbance** in red (draw the limits in the tab); **storm check** finding
  erosion rills, possible standing water and pond silt.
  → [site-conditions](features/site-conditions.md)

### Checks & records (new job-site tab)
- **Cross-sections** along any line you draw (stations like road plans),
  flight vs previous flight vs design. → [cross-sections](features/cross-sections.md)
- **Trench as-built record**: length, width, depth, wall slope, pipe top and
  invert elevations and slope, from the flight that saw it open — copy or save as
  CSV — with OSHA prompts (protective system over 5 ft, spoil within 2 ft, ladder,
  PE over 20 ft). → [trench-asbuilt](features/trench-asbuilt.md)
- **ADA slopes** on walks, ramps, landings and accessible parking: running and
  cross slope stretch by stretch, "too steep" only when it's beyond measuring
  noise. → [ada-slopes](features/ada-slopes.md)
- **Settlement monitors**: movement of an area flight by flight with an alert.
  → [settlement](features/settlement.md)

### Getting results out
- **Print report** (job site): a one-flight report with every tab's answer, to
  print or save as PDF. → [site-report](features/site-report.md)
- **Export…** (top bar): save the open scan or site as a CAD drawing (DXF:
  contours, spot elevations, zones, limits), a LandXML surface, PNEZD points
  (CSV), an elevation grid (ASCII grid + .prj), cleaned ground points (LAS/LAZ),
  a site plan (GeoJSON, plus a latitude/longitude copy) or progress data (JSON)
  for project-management software. Files go to Downloads\Surveyr and are never
  overwritten. → [exports](features/exports.md)
- **Contours** traced from any scan, design or site flight (engine, no
  Matplotlib); used by the DXF export. → [contours](features/contours.md)

### Measuring
- **Measure in 3D** (single-scan 3D toolbar): spot elevation; distance with
  height change, slope distance, grade % / ratio and bearing; path length with
  climb and drop; area with perimeter, surface area and elevations. True survey
  values (the vertical stretch is undone), ground-snapped, copyable.
  → [measure](features/measure.md)

### Quantities (new job-site tab)
- **Layers**: base course / paving placed between flights — area, volume,
  tonnage, thickness map against target, thin patches flagged.
  → [layers](features/layers.md)
- **Stockpiles by material**: each pile's volume over time with its material
  guessed from colour and intensity (overridable) and tonnage.
  → [stockpiles](features/stockpiles.md)
- **Pond storage**: stage–storage curve as-built vs design below the outlet,
  with unseen (wet) floor reported honestly. → [pond-storage](features/pond-storage.md)

### Fixes
- Elevation histogram no longer crashes on dead-flat ground.
- LandXML surfaces no longer crash the installed app (Matplotlib isn't bundled).

## 0.6.0 — 2026-10-27
Launch intro animation; measurement labels on the 3D axes; job specs change
orders with voids; visual refresh.

## 0.5.x — October 2026
Job-site progress tracking, Job sites tab, 3D site view, ground control check
points and per-flight accuracy QA.
