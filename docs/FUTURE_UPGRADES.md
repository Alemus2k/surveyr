# Future upgrades

Ideas that are bigger than a feature: worth doing, not yet started. Each has a
problem statement, a sketch of how it would work, what it would cost, open
questions, and a first step small enough to try. Add new ideas at the end using
the same shape.

| # | Upgrade | Value | Effort | Status |
|---|---|---|---|---|
| 1 | [Automated drone flights](#1-automated-drone-flights) | High: removes the pilot's per-flight planning and makes flights repeatable | Medium (planning) → high (full automation) | Sketch |
| 2 | [Progress data into company software](#2-progress-data-into-company-software) | High: PMs see measured progress where they already work | Low (file drop) → medium (live API) | Sketch; the export seam exists |
| 3 | [Smaller ideas parked during 0.7](#3-smaller-ideas-parked-during-07) | Mixed | Small each | Backlog |

---

## 1. Automated drone flights

### Problem
Every flight today means a pilot planning a mission by hand, flying it, then
someone exporting the LAS and importing it into Surveyr. Flights drift: different
altitude, overlap, speed or time of day make flights less comparable, and the
pilot's time is the biggest recurring cost.

### What "automated" can mean, in increasing order of ambition
1. **Surveyr writes the mission** — the flight plan is generated from the job
   site (its boundary / limits of disturbance, the zones that are active this
   week, the design's highest point for safe altitude) and exported as a file the
   pilot loads into the controller. The pilot still flies (legally the remote
   pilot in command), but never plans.
2. **Same mission every time** — the plan is stored with the site, so every
   flight repeats the same lines, altitude and speed. Comparability goes up and
   Surveyr can warn when an imported flight doesn't match the plan (coverage,
   point density, date).
3. **Hands-off ingest** — the drone's processing output lands in a watched
   folder (or cloud drive) and Surveyr imports it, dates it from the file,
   attaches it to the right site, runs flight QA against the check points, and
   notifies the PM ("Flight of 4 Nov is in; earthworks 94 %; 1 claim to query").
4. **Dock-based automation** — a drone-in-a-box (e.g. DJI Dock class products)
   flies the stored mission on a schedule with no one on site. Surveyr becomes
   the scheduler and the consumer. Requires the vendor's cloud API and FAA
   approval for operations beyond the visual line of sight (BVLOS) or a remote
   observer — a regulatory project as much as a software one.

### Sketch
```
Site (Surveyr)                      Drone side                       Back in Surveyr
──────────────                      ──────────                       ───────────────
boundary / LOD polygon ─┐
active zones this week ─┼─▶ mission planner ─▶ mission file (KMZ/WPML,  ─▶ pilot / dock flies
design max elevation ───┤    (lawnmower lines,   Litchi CSV, …)
camera/LiDAR profile ───┘     overlap, altitude,
                              speed, gimbal)
                                                 vendor processing ─▶ LAS/LAZ in a
                                                 (e.g. DJI Terra)     watched folder ─▶ auto-import → QA → notify
```
- **Planner:** pure geometry — a polygon, a heading, line spacing from the
  sensor's swath at the chosen altitude and the side overlap, turn-arounds
  outside the polygon, altitude above the highest design point + margin. Output
  formats differ by vendor; DJI's mission formats (KMZ with WPML) are documented
  for their pilot apps and docks. Keep the planner vendor-neutral and add
  writers per format.
- **Watched folder:** the engine already imports files; add a folder watcher in
  the desktop shell (Tauri) and a rule "files whose date is X go to site Y",
  using the LAS header date (the demo files already carry it).
- **Notifications:** desktop notification first; e-mail / Teams / Slack via the
  integration layer in §2.

### Costs and constraints
- No paid services needed for 1–3. Dock automation (4) needs vendor hardware and
  usually a vendor cloud subscription — that would break the "zero cost" rule and
  must be a deliberate decision.
- FAA Part 107 still applies; automation doesn't remove the remote pilot. BVLOS
  needs a waiver (rules are evolving — check current FAA guidance before
  planning).
- Mission formats are vendor-specific and change between firmware versions.

### Open questions
- Which drone and LiDAR sensor will the company buy? (Decides the mission format
  and the processing software.)
- Who processes raw flights — a person in the office, or the vendor's cloud?
- Is a scheduled "every Monday 8 am" flight useful, or are flights tied to
  milestones?

### First step
Mission planning (level 1) for one drone model: draw or reuse the site's limits,
choose altitude / overlap, preview the lines on the plan map, export the file.
Then the auto-import watched folder (level 3) — it pays off even with a human
pilot.

---

## 2. Progress data into company software

### Problem
PMs live in a project-management system (Procore, Autodesk Construction Cloud,
Oracle Primavera / Aconex, Microsoft Project, a SharePoint list, a spreadsheet…).
Measured progress sitting inside Surveyr only helps the person who opens it.
Goal: after every flight, the numbers appear where the PM already works, without
anyone copying them.

### Principle: one stable data contract, many thin connectors
Surveyr already writes a versioned **progress snapshot**
(`surveyr-progress.json`, see [exports](features/exports.md)): site, flights,
zones with planned dates, per-zone per-flight quantities and % complete, pay-app
checks. That file is the contract. Connectors translate it into each target's
shape and never compute anything themselves, so every system shows the same
numbers.

```
           ┌──────────────── Surveyr engine ────────────────┐
flight ──▶ │ import → QA → quantities → progress snapshot    │
           │                     (schema-versioned JSON)     │
           └───────────────┬────────────────────────────────┘
                           │  on every new flight / on a schedule / on demand
          ┌────────────────┼─────────────────────────┬───────────────────────┐
          ▼                ▼                         ▼                       ▼
   Folder drop        CSV / Excel              Webhook (POST)          Connector plug-ins
   (any system that   (per-zone rows for       to a URL the company    (Procore, ACC, MS Project,
    can watch a        spreadsheets, Power BI)  controls (Power        SharePoint list, …): map
    folder)                                     Automate, Zapier,       zones → schedule activities,
                                                n8n, an internal API)   quantities → custom fields
```

### Delivery options, simplest first
1. **Scheduled file drop** (no network, no accounts): after each flight, write
   `surveyr-progress.json` + a flat CSV into a folder the company syncs
   (OneDrive / SharePoint / a network share). Many PM tools and Power BI / Excel
   can read from there. Zero cost, works offline, easy to audit.
2. **Webhook**: Surveyr POSTs the snapshot to a URL the company configures. A
   low-code flow (Power Automate, n8n — self-hostable and free) maps fields into
   the target system. Surveyr stays generic; IT owns the mapping.
3. **Direct connectors**: per-system plug-ins using that system's public API
   (OAuth app registration, rate limits, field mapping UI). Most work and most
   maintenance; do it only for the one system the company actually uses.

### Mapping that has to be designed per company
| Surveyr | Typical PM-system home |
|---|---|
| Zone (Building pad, Parking lot…) | Schedule activity / WBS item / cost code |
| Zone % complete, forecast finish | Activity % complete / forecast date (or a custom field, if the PM owns the official %) |
| Quantities moved this period (yd³), layer tonnage | Daily-log quantities / commitments / unit-price line items |
| Pay-app check (claimed vs measured) | Subcontractor invoice review notes |
| Flight QA, site-conditions findings, as-built records | Observations / issues / documents |
| Progress summary text, plan-view images | Daily report attachment |

A small **mapping file** per site (zone id → activity id / cost code) keeps this
explicit; Surveyr would ask for it once.

### Safety rules for any integration
- Surveyr *reports measurements*; it doesn't overwrite official % complete
  unless the PM opts in per field.
- Every push is logged (what, when, which flight) and can be replayed.
- Credentials stay in the OS keychain, never in site files; nothing is sent
  anywhere until a person turns it on.
- The snapshot carries `schema_version`; connectors refuse versions they don't
  know instead of guessing.

### First step
Add "Publish progress" to a site: choose a folder, and Surveyr writes the
snapshot + CSV there after every new flight (option 1). Then ask the PM team
which system and fields they want, and prototype a webhook into it with a
low-code flow before writing any dedicated connector.

---

## 3. Smaller ideas parked during 0.7

Ideas that came up while building 0.7 but were out of scope. Each is small enough
to become a normal feature. Grouped by where they'd live; the source doc is linked.

**Units and display** ([units](features/units.md))
- Show eastings / northings in **US survey feet** when the scan's coordinate
  system is in US survey feet (today: international foot, about 4 ft off on a
  2,000,000 ft state-plane coordinate).
- Re-word old change-order entries in the current units from their stored metric
  values, with the original wording in a tooltip.
- Tons next to cubic yards for hauls in the job-site calculations panel (densities
  now exist for stockpiles, so this is mostly wiring).

**Exports** ([exports](features/exports.md), [contours](features/contours.md))
- **Handover pack**: one zip with every export for a site.
- Design-minus-flight cut/fill as a coloured grid or GeoJSON heat-map cells.
- Cross-sections along alignments exported to CSV or DXF.
- Direct KML for Google Earth (the WGS84 GeoJSON already does the hard part).
- A coordinate-system note written into DXF drawings.
- The original TIN points for LandXML designs.
- Flat DXF contours with one elevation each, as an option for CAD tools that
  prefer them; labels on minor contours when the interval is large.

**Ground classification** ([ground-classification](features/ground-classification.md))
- **A finer second pass around trenches** so a pipe or trench box isn't kept as
  ground (today the demo trench reads 64.6 m³ low on 19 Oct).
- A "largest machine on site" setting (the 7 m window).
- Use intensity to find machines (paint is bright).
- A QA layer showing where automatic ground disagrees with the file's classes.

**Measure in 3D** ([measure](features/measure.md))
- Save measurements with the scan or site (today they vanish on close).
- Measure on the design surface; cut / fill under a drawn area.
- Drag a spot to edit it; ignore machine points when snapping.

**Quantities** ([layers](features/layers.md), [stockpiles](features/stockpiles.md), [pond storage](features/pond-storage.md))
- Paving areas in square yards; per-pile density override.
- Multi-stage pond outlets; export the stage–storage table.

**Site conditions** ([site-conditions](features/site-conditions.md))
- Guess machine type from size; per-tree markers; a 3D view of findings.

**Checks & records** ([trench-asbuilt](features/trench-asbuilt.md), [ada-slopes](features/ada-slopes.md))
- L-shaped walks as one outline; benched-wall detection; where along the trench
  the spoil pile is.
- A proper pipe-diameter field on as-builts (today it lives in the note).
- A file save that works in the macOS app for "Save CSV" (copy works everywhere).

**Report** ([site-report](features/site-report.md))
- Maps and charts in the printout; one report covering a date range instead of
  one flight.
