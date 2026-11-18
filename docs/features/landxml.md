---
id: landxml
title: LandXML design surfaces
status: experimental
since: "0.7.0"
area: import
origin: roadmap
data_used: [design]
---

# LandXML design surfaces

**One-line summary:** import the civil engineer's grading design (a LandXML TIN)
like any scan, and use it as a job site's finished grade.

## Why it exists

Progress, deviation and quantities are measured against the design, and
engineers deliver designs as LandXML TIN surfaces — not point clouds.

## Where to find it

*Import scan…* (or **+** on the tab bar) → pick the `.xml`. It's listed under
Projects as "LandXML surface". Choose the surface in *Manual adjustments →
Design surface*; use it as a site's design in *Site setup* or the new-site dialog.

## How to use it

1. Import the `.xml`. Units are taken from the file's `<Units>` (e.g. US survey
   feet).
2. If the file has several surfaces (existing ground and finished grade), the one
   named like finished grade (FG, finish, design, proposed…) is used; pick another
   in Manual adjustments.
3. Set it as the job site's design surface.

Demo: *Riverside Grading* has "EG - Existing ground" and "FG - Finished grade" in
US survey feet.

## How it works

- Streaming XML parse; points are `<P id>northing easting elevation</P>`, faces
  `<F>a b c</F>`; faces with `i="1"` are hidden (holes) and skipped. Unnamed
  surfaces are called "Surface 1", "Surface 2" … in file order.
- The TIN is sampled on a regular lattice about **800 points across** its long
  side, with linear interpolation inside each triangle (barycentric weights), so
  every downstream tool treats it like a dense, noise-free scan. Lattice points
  no triangle covers are dropped (outside the TIN or in a hole).
- Implemented in pure NumPy (the bundled engine excludes Matplotlib); matches
  Matplotlib's linear interpolation to 3 × 10⁻⁹ ft on the demo and samples
  ~500 000 lattice points in ~0.1 s.
- Default surface: first name containing a finished-grade hint word; otherwise
  the last surface not named like existing ground.

## What it needs

A LandXML 1.x file with at least one `<Surface>` TIN (points + faces) in the
same coordinate system as the site's flights.

## Limits and honesty notes

- TIN surfaces only: no alignments, breakline-only surfaces, corridors or grid
  surfaces yet.
- Sampling at ~800 across: features narrower than about 1/800 of the surface's
  width are smoothed (e.g. a 0.25 m curb on a 200 m site).
- Eastings / northings in US survey feet are converted exactly; no datum
  transformation is done — design and flights must share a coordinate system.

## Files

- `backend/app/landxml.py` — read, sample, write (writer used for the demo)
- `backend/app/io.py`, `scan_settings.py` (units, `surface` setting), `main.py` (surfaces in the settings response)
- `frontend/src/adjust/AdjustPanel.tsx` (surface picker)
- Tests: `backend/tests/test_landxml.py`

## Review checklist

- [ ] Riverside Grading opens in US survey feet, ~590 × 459 ft.
- [ ] Manual adjustments → Design surface lists EG and FG; switching changes the terrain.
- [ ] Importing a random `.xml` gives a clear "no TIN surface" message.
