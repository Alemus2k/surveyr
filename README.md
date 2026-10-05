# Surveyr

Land-surveying drone software concept: capture a site with a LiDAR scanner
(prototype: phone LiDAR; production: survey drone), process it into a terrain
model, and present colorized elevation maps plus construction analytics in an
interactive dashboard.

**Status — Phase 0 (core analytics):** done.
**Status — Phase 1 (API + dashboard):** done.
**Status — Phase 2 (real point-cloud IO + multi-pass fusion/coverage):** done.
**Status — Phase 3 (desktop app: Tauri shell + bundled engine, scan import):** done (macOS).

Phase 2 adds open-source point-cloud IO (LAS/LAZ via **laspy**, PLY via a
built-in reader) and sub-map fusion: a second pass over the same ground is
**registered to the existing map with bounded ICP and recognised as a revisit**
(it fuses — never remapped as "new"). Coverage shows per-cell how many passes
covered each area, and the "revisited areas" view colours cells scanned by
2+ passes. Demo project `multiscan` = scan_a.las + scan_b.las.

## Layout

```
backend/
  app/            Python analytics engine + FastAPI
    pcd.py        multi-channel point cloud data model
    io.py         read .las/.laz (laspy), .ply, .xyz; write PLY
    clean.py      outlier removal, ground/non-ground stub
    dem.py        rasterize -> DEM, hole fill, smoothing, coverage
    terrain.py    slope / aspect / curvature / roughness / normals
    analytics.py  % flat, relief, cut/fill, histograms, contours, buildable
    fusion.py     sub-map model + bounded ICP + coverage/revisit decision
    service.py    pipeline runner, fusion runner, per-project cache
    main.py       FastAPI (routes: /api/health, /api/projects, /api/analysis/{id})
  scripts/
    make_synthetic_terrain.py   test oracle (single-pass terrain)
    make_multi_scan.py          two-pass revisit capture fixture (.las + .ply)
  tests/          pytest suites: pipeline + fusion/io (19 tests)
  data/           generated fixtures + captured scan pair
frontend/         React + Vite + Three.js dashboard
docs/             capture workflow + metrics glossary + professor questions
```

## Quickstart (Phase 0 — analytics only)

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/make_synthetic_terrain.py --preview   # oracle + PNG preview
.venv/bin/python -m pytest tests -q                            # validate pipeline
```

## Desktop app (macOS; Windows below)

Surveyr ships as a normal Mac app: double-click it and it starts its own
analysis engine (the Python backend, frozen with PyInstaller) on a free local
port, opens the dashboard in its window, and stops the engine when you quit.
No terminal, Python install or browser needed.

- Projects live in `~/Library/Application Support/SurveyR/Projects`
  (seeded with the demo projects on first launch).
- Add scans with **Import scan…** (Projects panel) or the **+** tab: pick a
  `.ply` / `.las` / `.laz` / `.xyz`, e.g. a Scaniverse PLY AirDropped from a phone.
- Close tabs with × (or middle-click); reopen from **Projects**. Deleting a
  project there moves its scan file(s) to the macOS Trash.
- The side panel resizes by dragging its right edge (double-click resets) and
  collapses with «. **Appearance** (palette icon, top right) sets the theme
  (System / Light / Dark) and highlight colour; highlights are auto-adjusted
  for contrast so they stay readable.
- **Points / Surface** (toolbar): the smooth surface is drawn only over
  scanned ground, is slightly translucent, and carries a plan-view grid whose
  cells stretch on slopes.
- **Charts**: earthworks balance (cut/fill vs pad height, balance point),
  slope classes, aspect rose, and elevation/slope distributions. Site metrics
  and charts count only scanned ground (the analysis `mask`), never the
  interpolated corners outside an irregular scan's outline.
- **Manual adjustments** (rail, under Charts), saved per scan as
  `<scan>.settings.json` (the scan file is never modified):
  - *Units* — m / cm / mm / ft / US survey ft / in; converted to metres on load.
    LAS/LAZ coordinate systems set this automatically on import; unit-less
    PLY/XYZ files that look implausibly large (e.g. mm read as m) get a
    suggestion, never a silent change.
  - *Up axis* — Z-up (survey/most apps) or Y-up exports.
  - *Ground points only* — for classified LiDAR (ASPRS class 2); trees and
    buildings are left out of the terrain. No effect on unclassified scans.
- **Real LiDAR**: LAS and LAZ (via `lazrs`), coordinate system read with
  `pyproj`. Points are sent to the viewer relative to a float64 origin, so
  survey-grid coordinates (millions of metres) keep millimetre precision.
  Large sites get coarser analysis cells (grid ≤ 400 cells across).
- **Comparisons** (Projects → New comparison…): overlay several scans as
  layers, each with its own colour (or height colours), opacity, show/hide,
  lock and points/surface mode. Select a layer to move/rotate it with the 3D
  handles or exact East/North/Up/Yaw values. Saved as `<name>.compare.json`
  beside the scans; the scans themselves are never modified.
  Translucency: point layers use stable random thinning ("density"
  transparency, order-independent); surfaces use a depth prepass so only the
  nearest sheet is blended, and translucent layers are drawn far-to-near.
- Engine log: `~/Library/Logs/app.surveyr.desktop/engine.log`.
- The app is ad-hoc signed, not notarised (that needs a paid Apple developer
  account). First launch: right-click Surveyr → **Open** → **Open**. The very
  first start also takes ~20–30 s while macOS checks the bundled engine.

Build it (needs Rust: `brew install rustup && rustup default stable`, with
`/opt/homebrew/opt/rustup/bin` on your PATH):
```bash
cd landsurvey/frontend
npm install
npm run app:build        # PyInstaller engine + Tauri bundle
```
Output: `frontend/src-tauri/target/release/bundle/macos/Surveyr.app` and
`.../bundle/dmg/Surveyr_<version>_aarch64.dmg`. `npm run app:dev` runs the
desktop shell against the live Vite dev server and the backend virtualenv.

## Windows

The Windows installer is built in the cloud by GitHub Actions
(`.github/workflows/windows-build.yml`) on a real Windows machine, after the
full backend and frontend test suites pass there.

- **Get the installer:** on GitHub open *Releases* and download
  `Surveyr_<version>_x64-setup.exe` (published for every `v*` tag), or open
  *Actions → Windows build → latest run → Artifacts*.
- **Install:** run the setup file. It installs for your user only (no admin
  needed) and fetches Microsoft's WebView2 runtime if Windows lacks it.
- **First launch:** the app isn't code-signed, so SmartScreen may say
  "Windows protected your PC" — choose *More info → Run anyway*.
- Projects live in `%APPDATA%\SurveyR\Projects`; deleted projects go to the
  Recycle Bin.
- **New build:** push a tag, e.g. `git tag v0.3.1 && git push origin v0.3.1`
  (bump `version` in `frontend/src-tauri/tauri.conf.json` first), or use
  *Run workflow* on the Actions tab.

## Run the full dashboard (browser, for development)

Note: there is no bare `python` on macOS — always use the venv interpreter
(`./.venv/bin/python` / `./.venv/bin/uvicorn`) from inside `backend/`.

First, set up the backend environment once:
```bash
cd landsurvey/backend
python3 -m venv .venv                     # only once
./.venv/bin/pip install -r requirements.txt   # only once
./.venv/bin/python scripts/make_synthetic_terrain.py --preview  # demo fixtures (once)
./.venv/bin/python scripts/make_multi_scan.py                    # two-pass fixtures (once)
./.venv/bin/python -m pytest tests -q     # 19 tests, sanity check
```

Terminal 1 — API:
```bash
cd landsurvey/backend
./.venv/bin/uvicorn app.main:app --port 8000
```
Terminal 2 — dashboard:
```bash
cd landsurvey/frontend
npm install              # only once
npm run dev              # opens http://localhost:5173
```
Vite proxies `/api` → the backend; open `http://localhost:5173`.

If you see `ModuleNotFoundError: No module named 'fastapi'` (or `'laspy'`),
the `.venv` needs re-creating or the requirements need installing — rerun the
two `./.venv/bin/pip` / venv lines above.

## Licensing & cost (0-cost / open-source commitment)

This project is intended to stay **zero-cost and fully open source** (no paid
APIs, no proprietary SDKs). Everything it currently uses is free permissive
open-source software:

| Component | Purpose | License |
|---|---|---|
| Python 3 | language | PSF |
| numpy / scipy / matplotlib | terrain + DEM math, previews | BSD-3-Clause / BSD-like |
| FastAPI | backend API | MIT |
| uvicorn | ASGI server | BSD-3-Clause |
| pytest | tests | MIT |
| React + Vite + TypeScript | dashboard | MIT / Apache-2.0 |
| Three.js | 3D terrain rendering | MIT |
| Tauri 2 | desktop app shell | MIT / Apache-2.0 |
| PyInstaller | bundles the Python engine | GPL-2.0 w/ bootloader exception (output may be distributed under any licence) |
| python-multipart | scan upload parsing | Apache-2.0 |
| lazrs | LAZ (compressed LAS) decoding | MIT / Apache-2.0 |
| pyproj (PROJ) | coordinate systems / units of LAS files | MIT |
| Rajdhani / Share Tech Mono (@fontsource) | UI typefaces, bundled for offline use | OFL-1.1 |
| vitest / httpx | tests | MIT / BSD-3-Clause |

**Planned free/OSS choices for future phases** (no change of cost):
- Point-cloud IO: **laspy** (installed) reads LAS/LAZ. Registration/fusion uses a
  self-contained numpy+scipy ICP (no proprietary SDK; Open3D has no wheel for
  the current Python yet, and our bounded ICP covers the demo). LAZ compression
  needs the optional `lazrs` backend.
- Rendering very large point clouds: **Potree** (open source) rather than a
  commercial tile service.
- Any basemap tiles would use **OpenStreetMap** (free, usage-policy respected)
  or no basemap at all for local project sites.
Everything runs locally — no cloud accounts or API keys required.

## Known limitations (prototype stage)

- Phone LiDAR: ~5 m range, no intensity channel, no GPS pose per scan → the
  demo pipeline is for concept validation only, not survey-grade output.
- Percent-flat / cut-fill results depend on raster cell size and definitions
  (see `docs/METRICS_GLOSSARY.md`); treat them as decision support.
- Final "is this site level" judgments remain the surveyor's call.
