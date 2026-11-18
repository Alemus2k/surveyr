---
id: units
title: Display units (US customary / metric)
status: experimental
since: "0.7.0"
area: shell
origin: roadmap
data_used: [elevation]
---

# Display units (US customary / metric)

**One-line summary:** every figure in the app reads in feet, cubic yards, square
feet and acres by default, or in metres and cubic metres if you switch — the
scans and everything saved stay exactly as they were.

## Why it exists

US general contractors grade in feet to the hundredth and buy, sell and truck
dirt by the cubic yard. A superintendent should not have to convert "0.05 m" or
"1,250 m³" in their head before trusting a number, and a PM should be able to
paste a summary into an email as it is. Crews working to metric plans can
switch the whole app over in one click.

## Where to find it

*Top bar → Appearance (palette button) → Units → `US (ft, yd³)` / `Metric (m, m³)`*.

## How to use it

1. Open the Riverside demo site (or any scan). Everything is in US units out of
   the box: elevations and distances in `ft`, volumes in `yd³`, areas in `sq ft`
   or `acres`.
2. Open *Appearance* and pick *Metric (m, m³)*. Every panel, chart, map
   readout, 3D label and input changes at once; nothing reloads.
3. Type into any input in the units shown next to it (e.g. on-grade tolerance
   `0.16 ft`, a pay-app claim in `yd³`). The value is saved in metric, so it
   reads the same after switching back and forth.
4. The choice is remembered on this computer.

## How it works

The engine is metric: every API payload and stored value is m, m², m³. Only the
interface converts, in `frontend/src/lib/units.ts`.

**Conversion factors (exact, international foot):**

| Quantity | Metric | US | Factor |
| --- | --- | --- | --- |
| Length, elevation, small differences | m | ft | 1 ft = 0.3048 m |
| Area | m² | sq ft | 1 sq ft = 0.09290304 m² |
| Area (large) | ha = 10,000 m² | acre = 43,560 sq ft | 1 acre = 4,046.8564224 m² |
| Volume, truck capacity | m³ | yd³ | 1 yd³ = (3 × 0.3048)³ = 0.764554857984 m³ |

**Rounding (display only; stored values are never rounded):**

| What | US | Metric (unchanged from before) |
| --- | --- | --- |
| Lengths, elevations, depths, thickness | ft, 2 decimals (`339.57 ft`) | m, 2 decimals |
| Signed differences (map / slice readouts) | `+0.11 ft` | `+0.03 m` |
| Tolerances, check-point offsets, elevation correction | ft, 2 decimals (`0.16 ft`, `+0.11 ft`) | cm, 1 decimal (`+3.4 cm`) |
| Finished-grade specs in the change-order log | ft, 2 decimals (`Flat pad at 332.19 ft`) | m, 3 decimals |
| Area | sq ft (2 decimals under 100, else whole) below 1 acre; then acres, 2 decimals | m² below 1 ha; then ha, 2 decimals |
| Volume | yd³: 2 decimals under 10, 1 under 1,000, else whole, with thousands separators | m³, same rule |
| Truck capacity, grid cell size | up to 2 decimals, trailing zeros dropped (`10 yd³`, `0.82 ft`) | as stored (`10 m³`, `0.25 m`) |
| Eastings / northings (site map hover) | ft, 1 decimal | m, 1 decimal |

Feet are always decimal feet, never feet-and-inches. Degrees, percentages,
dates and point counts have no unit system and don't change.

**Round steps.** Grid spacing in the 3D views, the surface grid, the site map's
scale bar, the slice thickness step and the cross-section's elevation lines are
chosen as 1, 2 or 5 × 10ⁿ *in the active unit* (a 50 ft scale bar, grid lines
every 20 ft), then converted to metres for drawing.

**Inputs that convert** (shown in the active unit, stored metric):

- Job site panel: pad elevation, truck capacity
- Site panel: "Ignore changes under"
- Change-order dialog: on-grade tolerance, flat-pad elevation, design offset
- Pay-app check: claimed quantity
- Manual adjustments: elevation correction ("Add to every elevation")
- Cloud colour: lowest / highest colour elevation
- Comparison layers: East / North / Up shift

Inputs keep what is typed until the field is left, then show the stored value
converted and rounded to 3 decimals (cm: 1 decimal). The stored value is
`typed × factor` at full floating-point precision, so re-opening shows the same
figure and saving again does not move it. Limits (e.g. tolerance 0.001–2 m,
truck 1–100 m³, design offset ±50 m) are applied in metric.

**Not converted, on purpose:** API payloads and saved files; the "This file's
coordinates are in" selector (it describes the file); the check-point import
units; change-order log entries already saved (they are a record of what was
written then — new entries are worded in the units active when they are issued,
and their stored `values` stay metric).

**Default truck size.** A scan whose job-site settings have never been saved
starts with a truck of 10 of the active volume unit (10 yd³ in US, 10 m³ in
metric). Once saved, a truck size is never reinterpreted.

## What it needs from the flight

Nothing. It changes how numbers are shown, not what is measured.

## Limits and honesty notes

- **International foot, not US survey foot.** Display uses 1 ft = 0.3048 m
  exactly. Scans delivered in US survey feet are converted to metres by the
  engine with the survey-foot factor, so showing them back in international
  feet differs by 2 parts per million: 0.002 ft on a 1,000 ft elevation, but
  about 4 ft on a 2,000,000 ft state-plane easting. Elevations, differences,
  areas and volumes are unaffected at the precision shown; **eastings and
  northings in the site map hover can read a few feet off the plan coordinates
  on a US-survey-foot grid.** Don't stake out from them.
- Rounding is for reading. A tolerance stored as 5 cm shows as `0.16 ft`
  (0.164 ft in the input); the comparison uses the stored value.
- In US units, two specs that differ by less than 0.01 ft are worded
  identically in the change-order log (the stored values still differ).
- Old change-order entries keep the wording they were saved with, so a log can
  show both metric and US entries.
- The units switch sits in the Appearance popover but its "Reset" button
  doesn't change units.
- Switching units rebuilds the 3D view (its grid and axis chips are part of the
  scene), which resets the camera.
- There are no weights (tons) anywhere yet: the app has no densities.

## Files

- `frontend/src/lib/units.ts` — the unit system, conversion factors, every formatter, input helpers, round steps
- `frontend/src/lib/format.ts` — re-exports the formatters under their old names
- `frontend/src/components/QuantityInput.tsx` — number input that shows the user's unit and returns metric
- `frontend/src/appearance/AppearancePopover.tsx` — the Units switch
- `frontend/src/App.tsx` — subscribes the whole tree to the unit system
- Callers: `panels/`, `charts/`, `jobsite/`, `site/`, `control/`, `adjust/`, `slice/`, `viewer/`, `compare/`
- Tests: `frontend/src/lib/units.test.ts`; unit-pinned assertions in `lib/format.test.ts`,
  `control/qa.test.ts`, `jobsite/summary.test.ts`, `jobsite/settings.test.ts`,
  `site/specs.test.ts`, `viewer/backdrop.test.ts`

## Review checklist

- [ ] Fresh profile: open a scan — top bar reads `… pts · 0.82 ft cell` (0.25 m grid), Terrain panel shows `ft`, `sq ft`/`acres`, `yd³`; no `m`, `cm`, `m²`, `ha` or `m³` anywhere
- [ ] Appearance → Units → Metric: every figure flips immediately and matches the previous release; restart the app — the choice is kept
- [ ] 3D view: axis chips in ft, "Surface grid" chip is a round number of feet, slice thickness steps by a round number of feet, cross-section lines sit on round feet
- [ ] Riverside Commons site: KPIs, zone table, pay-app table and "Copy progress summary" all read `yd³`; map scale bar is a round number of feet; hover readout shows `ft`
- [ ] Site panel → "Ignore changes under": type `0.16`, click away, reopen the site — still `0.16 ft`; switch to Metric — reads `4.9 cm`
- [ ] Pay-app check: add a claim of `100` yd³; switch to Metric — it reads `76.5 m³`; switch back — `100.0 yd³`
- [ ] Change order in US units: log entry reads e.g. `±0.16 ft → ±0.10 ft`; older metric entries are unchanged
- [ ] Job site panel on a scan never opened before: truck capacity `10 yd³`; "Copy summary" contains no metric units
- [ ] Control & accuracy: RMSE, bias and per-point offsets in `ft` (US) / `cm` (metric)
- [ ] Light and dark themes: units control and longer labels (`sq ft`, `acres`, `yd³`) don't wrap or clip
