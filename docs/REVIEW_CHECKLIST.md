# Review checklist — 0.7.0

How to review: run the app locally (see [DEVELOPMENT.md](DEVELOPMENT.md) →
Testing, or the browser dev setup in the README), open **Riverside Commons**, and
go down this list. Each row links to the feature doc, which has the full steps.
Mark **Keep**, **Change** (say what) or **Axe**. Rows marked *idea* were added
along the way and are the main keep/axe candidates; *roadmap* rows were planned.

| # | Feature | Origin | Quick test on the demo | Expected | Keep / Change / Axe |
|---|---|---|---|---|---|
| 1 | [US units](features/units.md) | roadmap | Appearance → Units → switch | Every number switches between ft / yd³ / acres and m / m³ / ha; nothing left in the other system | |
| 2 | [Getting started](features/getting-started.md) | idea | Close all tabs, or press **?** | Welcome page with three cards and the how-it-fits list | |
| 3 | [First-run units choice](features/getting-started.md) | idea | Fresh preferences | Units bar on the welcome page until a choice is made | |
| 4 | [Restore the demo site](features/getting-started.md) | idea | Job sites panel → *Restore the demo site* | Demo comes back as shipped; old copies in the Recycle Bin | |
| 5 | [LandXML design import](features/landxml.md) | roadmap | Projects → Riverside Grading → Manual adjustments | Read in US survey feet; *FG - Finished grade* picked; can switch to EG | |
| 6 | [Whole-flight data](features/flight-data.md) | roadmap | Open a Riverside flight → Terrain panel | Lists colour, intensity, classes; points per class | |
| 7 | [Dashboard tabs](features/site-dashboard.md) | roadmap | Riverside → tabs | Progress unchanged; each tab has a hint line; timeline shared | |
| 8 | [8-flight demo](features/demo-site.md) | roadmap | Riverside → timeline | 8 flights, 27 Jul → 2 Nov; 21 Sep flagged 0.11 ft high | |
| 9 | [Rail that names itself](features/getting-started.md) | idea | Rest the pointer on the left icon rail | Slides out with every panel's name, grouped places / tools; nothing shifts | |
| 10 | [Export dialog](features/exports.md) | roadmap | Riverside → **Export…** → Progress data, then CAD drawing | Files appear in Downloads\Surveyr; *Show in folder* opens Explorer on them; DXF opens in CAD with contours on CONTOUR_MAJOR / MINOR | |
| 11 | [Contours](features/contours.md) | roadmap | Export the 2 Nov flight as DXF with a 1 ft interval | Closed rings around the stockpiles; lines stop at unscanned ground | |
| 12 | [Layers & tonnage](features/layers.md) | roadmap | Riverside → Quantities → Layers, 2 Nov | Road base ≈ 255 tons; thin patch ≈ 850 sq ft at ~3.6–4.3 in flagged red | |
| 13 | [Stockpiles by material](features/stockpiles.md) | roadmap | Quantities → Stockpiles | Spoil / topsoil / aggregate recognised; volumes over time | |
| 14 | [Pond storage](features/pond-storage.md) | roadmap | Quantities → Pond storage | Holds ~65 % of design on 2 Nov; 19 Oct reports unseen wet floor | |
| 15 | Quantities extras (16 small ideas) | idea | See [Small ideas → Q](#small-ideas-up-for-keep--axe); docs: [layers](features/layers.md) / [stockpiles](features/stockpiles.md) / [pond-storage](features/pond-storage.md) | e.g. automatic base flight, suggested pond outlet, edge cells not judged thin | |
| 16 | [3D measurement tools](features/measure.md) | roadmap | Open the 2 Nov flight → Measure → Distance; click two spots along the road | ≈ 2.0 % falling westward; spot elevations within ~0.06 ft. **Not yet tried by hand** — clicks, double-click, keys and both themes need a look | |
| 17 | Measure extras (11 small ideas) | idea | See [Small ideas → M](#small-ideas-up-for-keep--axe) | e.g. climb/drop on paths, coverage note on areas, live hover readout, P1/D2 tags | |
| 18 | [Automatic ground classification](features/ground-classification.md) | roadmap | Open a Riverside flight → Manual adjustments → *Work out ground points automatically* | Volumes barely change vs the file's classes (they're correct on the demo); trees and machines still removed. Known gap: a pipe in an open trench is kept as ground | |
| 19 | [Site conditions tab](features/site-conditions.md) | roadmap | Riverside → Site conditions, flights 19 Oct and 2 Nov | Photo shows trees/machines/piles; 4 machines; 3.24 acres disturbed; ~1,000 sq ft outside the limits in red; on 19 Oct three rills on the parking slope, standing water and silt in the pond | |
| 20 | Site conditions extras (8 small ideas) | idea | See [Small ideas → S](#small-ideas-up-for-keep--axe) | e.g. whole-flight offset removed before comparing, clickable per-flight bars, Repair/Watch grades for rills | |
| 21 | [Cross-sections](features/cross-sections.md) | roadmap | Riverside → Checks & records → Cross-sections → Access road centreline | Profile vs design; road sits ~0.66 ft (0.20 m) under design at subgrade on 19 Oct | |
| 22 | [Trench as-built & OSHA](features/trench-asbuilt.md) | roadmap | Checks & records → Trench records → Storm drain trench | 204 ft long, ~7.9 ft deep, pipe 0.80 % west; protective-system and spoil-setback prompts; Copy / Save CSV work | |
| 23 | [ADA slopes](features/ada-slopes.md) | roadmap | Checks & records → Walks & ramps → Pad sidewalk (2 Nov) | One stretch too steep (cross slope ~4 %); the rest passes | |
| 24 | [Settlement](features/settlement.md) | roadmap | Checks & records → Settlement → Parking lot fill | Settles up to ~0.1 ft; alert from 5 Oct | |
| 25 | Checks extras (9 small ideas) | idea | See [Small ideas → C](#small-ideas-up-for-keep--axe) | e.g. flights levelled to check points before settlement, three-way ADA verdict, pipe fall in words | |
| 26 | [Printable site report](features/site-report.md) | roadmap | Riverside → **Print report** → Print / save as PDF | Clean white PDF with Progress, Quantities, Site conditions, Checks & records | |

## Small ideas up for keep / axe

Added by the build agents beyond their brief. Each is small and can be removed on its own; mark the last column.

### Q — Quantities tab

| # | Idea | Keep / Axe |
|---|---|---|
| Q1 | Edge cells left out of the thin / thick check | |
| Q2 | Thinnest and thickest as 3×3-cell averages | |
| Q3 | Single thin cells hidden from the boxes and table, with a count note | |
| Q4 | "Placed" threshold of max(tolerance/2, target/4, 0.1 ft) | |
| Q5 | Three-level accuracy note for thin lifts | |
| Q6 | Automatic base-flight detection for layers | |
| Q7 | Pond "up to" figure assuming the unseen floor is at the lowest ground seen | |
| Q8 | Suggested pond outlet = lowest point on the zone edge in the design | |
| Q9 | "The design itself holds less than required" warning | |
| Q10 | Pond zone preselected by name (pond / basin / detention) | |
| Q11 | Add and delete stockpile zones from the Quantities tab | |
| Q12 | Pile material guess falls back to the pile's biggest flight | |
| Q13 | KPI tiles act as section switches | |
| Q14 | Thin-patch table: where each patch is and how far short | |
| Q15 | Thickness in inches and density in lb/ft³ as unit kinds | |
| Q16 | Typical loose densities for piles (topsoil, stone, soil) | |

### M — Measure in 3D

| # | Idea | Keep / Axe |
|---|---|---|
| M1 | Total climb and total drop on paths | |
| M2 | Lowest and highest elevation for areas | |
| M3 | Coverage note when part of an area has no points | |
| M4 | Likely-error ±% in the short-distance warning | |
| M5 | Path legs under 10 ft highlighted amber | |
| M6 | Copy button on each measurement (plus Copy all) | |
| M7 | Close an area by clicking its first spot | |
| M8 | Live readout while hovering (leg length and grade) | |
| M9 | Tags P1 / D2 / L1 / A1 on labels and in the list | |
| M10 | Light fill inside area outlines | |
| M11 | Each spot's elevation shown in distance results | |

### S — Site conditions

| # | Idea | Keep / Axe |
|---|---|---|
| S1 | Whole-flight offset removed before comparing (the 21 Sep flight), with a note | |
| S2 | Extra map layers "Disturbed" and "Storm check", plus a Flight coverage card | |
| S3 | Brush patch and canopy patch counts | |
| S4 | Rill eroded volume and Repair / Watch grade | |
| S5 | Clickable per-flight bar charts that jump to that flight | |
| S6 | Tab badge: rills to repair, +1 if anything is outside the limits | |
| S7 | Standing-water area counts the wet share of part-covered edge cells | |
| S8 | Notice when a flight has no ground / vegetation classes | |

### C — Checks & records

| # | Idea | Keep / Axe |
|---|---|---|
| C1 | Flights levelled to the check points before measuring settlement | |
| C2 | Work-aware automatic settlement baseline (any rise = more fill) | |
| C3 | PE-design prompt for trenches over 20 ft; "sloped walls, confirm soil type" warning | |
| C4 | Three-way ADA verdict: too steep / check with a level / OK | |
| C5 | Pipe size read from and written to the as-built note, nominal-size dropdown | |
| C6 | Pipe fall direction in words ("falls 0.80 % to the west") | |
| C7 | Plain-text record format for daily reports, alongside CSV | |
| C8 | Trench length and width corrected for point spacing (order statistics) | |
| C9 | Copy CSV to the clipboard as well as saving the file | |

### U — Units (small display fixes made along the way)

| # | Idea | Keep / Axe |
|---|---|---|
| U1 | Site-map hover E / N show their unit | |
| U2 | "Cut / fill area" shows both units when one side is sq ft and the other acres | |
| U3 | Histogram axis ends in Cumulative mode no longer print as percentages (old bug) | |
