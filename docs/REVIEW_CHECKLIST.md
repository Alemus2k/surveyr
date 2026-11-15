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
| 15 | Quantities extras (16 small ideas) | idea | See the "ideas" list in [layers](features/layers.md) / [stockpiles](features/stockpiles.md) / [pond-storage](features/pond-storage.md) | e.g. automatic base flight, suggested pond outlet, edge cells not judged thin | |
| 16 | [3D measurement tools](features/measure.md) | roadmap | Open the 2 Nov flight → Measure → Distance; click two spots along the road | ≈ 2.0 % falling westward; spot elevations within ~0.06 ft. **Not yet tried by hand** — clicks, double-click, keys and both themes need a look | |
| 17 | Measure extras (11 small ideas) | idea | See "ideas" in [measure](features/measure.md) | e.g. climb/drop on paths, coverage note on areas, live hover readout, P1/D2 tags | |
