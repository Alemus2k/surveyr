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
- Files that state their units (LandXML, LAS with a coordinate system) are read
  in them by default.

### Job sites
- **Dashboard tabs**: each question about a site gets a tab; the flight timeline
  and bad-flight warnings are shared by all. → [site-dashboard](features/site-dashboard.md)
- **Riverside Commons demo** grows to 8 flights with colour, trees, machines,
  three stockpiles, road base, a trench, storm damage, settlement, a sidewalk and
  a limits-of-disturbance breach — each with exact answers for testing.
  → [demo-site](features/demo-site.md)

### Fixes
- Elevation histogram no longer crashes on dead-flat ground.
- LandXML surfaces no longer crash the installed app (Matplotlib isn't bundled).

## 0.6.0 — 2026-10-27
Launch intro animation; measurement labels on the 3D axes; job specs change
orders with voids; visual refresh.

## 0.5.x — October 2026
Job-site progress tracking, Job sites tab, 3D site view, ground control check
points and per-flight accuracy QA.
