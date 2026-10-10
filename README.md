# Surveyr

LiDAR terrain survey workstation. Import a scan — from a phone today, a survey
drone or terrestrial LiDAR scanner tomorrow — and Surveyr turns it into an
interactive 3D model with construction analytics: level ground, slope, cut and
fill, cross-sections, and side-by-side comparison of repeat scans.

It runs as a normal desktop app on **Windows** and **macOS**: a Python analysis
engine (FastAPI + NumPy/SciPy, frozen with PyInstaller) bundled inside a Tauri
shell, with a React + Three.js interface. Everything runs locally — no
accounts, cloud services or internet connection needed.

- [Install](#install) · [Using Surveyr](#using-surveyr) ·
  [Development](#development) · [Building installers](#building-installers) ·
  [Troubleshooting](#troubleshooting) · [Project layout](#project-layout) ·
  [Licensing](#licensing--cost) · [Known limitations](#known-limitations)
- What every number means: [docs/METRICS_GLOSSARY.md](docs/METRICS_GLOSSARY.md)

---

## Install

### Windows 10 / 11

1. Sign in to GitHub (this repository is private), open **Releases** and
   download `Surveyr_<version>_x64-setup.exe` from the latest release.
2. Run it. It installs for your user only — no administrator rights needed —
   and fetches Microsoft's WebView2 runtime if Windows doesn't have it.
3. The app isn't code-signed, so the first launch may show *"Windows protected
   your PC"*: choose **More info → Run anyway**. The very first start is slower
   while Windows checks the bundled engine.

- Projects are stored in `%APPDATA%\SurveyR\Projects` (seeded with three demo
  projects on first launch). Deleted projects go to the Recycle Bin.
- **Update:** run a newer setup file over the old install; projects are kept.
- **Uninstall:** *Settings → Apps → Surveyr → Uninstall*. Your projects stay in
  `%APPDATA%\SurveyR` until you delete that folder.

### macOS (Apple silicon)

1. Sign in to GitHub, open **Releases** and download
   `Surveyr_<version>_aarch64.dmg` from the latest release.
2. Open it and drag **Surveyr** into Applications.
3. It's ad-hoc signed, not notarised (that needs a paid Apple developer
   account), so the first launch is right-click → **Open** → **Open**. If macOS
   says the app is damaged, run `xattr -cr /Applications/Surveyr.app` once.

To build it yourself instead, run `npm run app:build` (see
[Building installers](#building-installers)).

- Projects are stored in `~/Library/Application Support/SurveyR/Projects`;
  deleted projects go to the Trash.

---

## Using Surveyr

- **Import scans** with **Import scan…** (Projects panel) or the **+** at the end
  of the tabs: `.ply`, `.xyz`, `.las` or `.laz`. A Scaniverse PLY sent from a
  phone works as-is.
- **Tabs**: each open project is a tab; close with × or middle-click and reopen
  from **Projects**. Deleting a project there moves its files to the
  Trash / Recycle Bin.
- **3D view toolbar**: perspective / top / side views, **Points or Surface**
  (the surface covers only scanned ground, is slightly translucent and carries
  a plan-view grid whose cells stretch on slopes), point size or surface
  opacity, grid backdrop, and the **cross-section slice**.
- **Side panels** (icon rail): Terrain metrics and "level" threshold, Cloud
  colour (elevation range), 2D maps, Charts (earthworks balance, slope classes,
  aspect rose, distributions) and **Manual adjustments**. Drag the panel's
  right edge to resize it (double-click resets); « hides it.
- **Job site calculations** (excavator icon): earthworks to level the site.
  Choose a *balanced* pad (cut exactly makes the fill, allowing for
  compaction) or a *custom* pad height, with an optional drainage fall; pick
  the soil type (swell / shrinkage) and truck size. Shows cut, fill, the
  import or export volume as loose truck volume and **truckloads**, a dig/fill
  map, and **Copy summary** for quotes and emails.
- **Manual adjustments** — saved per scan as `<scan>.settings.json`; the scan
  file itself is never modified:
  - *Units*: m / cm / mm / ft / US survey ft / in, converted to metres on load.
    LAS/LAZ files that record a coordinate system set this automatically;
    unit-less PLY/XYZ files that look implausibly large get a suggestion,
    never a silent change. Check the *Size (W × D × H)* against site.
  - *Up axis*: Z-up (survey LiDAR, most apps) or Y-up exports.
  - *Ground points only*: for ground-classified LiDAR (ASPRS class 2) — trees
    and buildings are left out of the terrain. No effect on phone scans.
- **Comparisons** (Projects → **New comparison…**): overlay scans as layers,
  each with its own colour or height colours, opacity, show/hide, lock and
  points/surface mode. Select a layer to move or rotate it with the 3D handles
  or exact East / North / Up / Yaw values; the slice shows the gap between
  passes. Saved as `<name>.compare.json`; scans are never modified.
- **Appearance** (palette icon, top right): System / Light / Dark theme and a
  highlight colour (colour wheel, presets or hex), auto-adjusted for contrast.

Site metrics and charts count **only ground that was actually scanned**, never
the interpolated corners outside an irregular scan's outline. Definitions:
[docs/METRICS_GLOSSARY.md](docs/METRICS_GLOSSARY.md).

---

## Development

### Prerequisites

| | Windows 10/11 | macOS |
|---|---|---|
| Git | [Git for Windows](https://git-scm.com/download/win) | Xcode Command Line Tools |
| Python 3.13 | [python.org](https://www.python.org/downloads/) — tick *Add python.exe to PATH* | `brew install python@3.13` |
| Node.js 22 LTS | [nodejs.org](https://nodejs.org/) | `brew install node` |
| Rust (stable) | [rustup-init.exe](https://rustup.rs/) — default MSVC toolchain | `brew install rustup && rustup default stable`, then add `/opt/homebrew/opt/rustup/bin` to `PATH` |
| C/C++ toolchain | [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → *Desktop development with C++* | Xcode Command Line Tools |
| WebView | WebView2 (built into Windows 10/11) | built in |

Rust and the C++ tools are only needed for the desktop app (Tauri); the browser
dev setup needs just Python and Node.

### Get the code

The repository is private, so Git needs your GitHub login: either sign in when
Git for Windows' credential manager prompts during the clone, or run
`gh auth login` first if you use the GitHub CLI.

```bash
git clone https://github.com/Alemus2k/surveyr.git
cd surveyr
```

### Backend (once)

Scan data never lives in git: the demo projects are regenerated by two scripts.

Windows (PowerShell):
```powershell
cd backend
py -3.13 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python scripts\make_synthetic_terrain.py
.venv\Scripts\python scripts\make_multi_scan.py
.venv\Scripts\python -m pytest tests -q
```

macOS:
```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/make_synthetic_terrain.py
.venv/bin/python scripts/make_multi_scan.py
.venv/bin/python -m pytest tests -q
```

Always use the virtualenv's Python (`.venv\Scripts\python` / `.venv/bin/python`)
— the system `python` won't have the dependencies.

### Frontend (once)

```bash
cd frontend
npm install
npm test            # vitest unit tests
```

### Run it

**Desktop app with live reload** (needs Rust):
```bash
cd frontend
npm run app:dev
```
This starts the Vite dev server and the desktop window, which launches the
backend from `backend/.venv` using `backend/data` as its projects folder.

**Browser only** (no Rust needed) — two terminals:
```bash
# terminal 1 — from backend/
.venv\Scripts\python -m uvicorn app.main:app --port 8000     # Windows
.venv/bin/python -m uvicorn app.main:app --port 8000         # macOS

# terminal 2 — from frontend/
npm run dev        # then open http://localhost:5173
```
Vite proxies `/api` to the backend on port 8000.

---

## Building installers

```bash
cd frontend
npm run app:build
```
This bundles the engine with PyInstaller (`npm run build:engine`, using
`backend/.venv` if present) and then builds the app with Tauri. Output, under
`frontend/src-tauri/target/release/bundle/`:

- **Windows:** `nsis\Surveyr_<version>_x64-setup.exe` and `msi\…msi` (Tauri
  downloads the WiX tools for the MSI on first build).
- **macOS:** `macos/Surveyr.app` and `dmg/Surveyr_<version>_aarch64.dmg`.

### Cloud builds (GitHub Actions)

`.github/workflows/release.yml` builds the Windows installer and the macOS
(Apple silicon) disk image on GitHub-hosted machines, after running the full
backend and frontend test suites on each. It doesn't matter which computer the
tag is pushed from — both installers are always built from the same commit.
Private repositories get free monthly Actions minutes (Windows minutes count
2× and macOS 10× against that allowance).

- **Publish a release:** bump `version` in `frontend/src-tauri/tauri.conf.json`,
  `frontend/src-tauri/Cargo.toml` (and its entry in `Cargo.lock`),
  `frontend/package.json` and `frontend/package-lock.json`, commit, push, then
  push a tag:
  ```bash
  git tag v0.4.3
  git push origin v0.4.3
  ```
  Both installers are attached to that tag's page under **Releases** — only
  once both builds pass, so Windows and macOS never drift apart.
- **One-off build:** *Actions → Release build → Run workflow*; download the
  installers from the run's **Artifacts**.

---

## Troubleshooting

| Problem | What to do |
|---|---|
| App stays on *"Starting the analysis engine…"* | The first launch can take ~30 s while the OS checks the engine. If it never starts, read the engine log (below). |
| Engine log | Windows: `%LOCALAPPDATA%\app.surveyr.desktop\logs\engine.log` · macOS: `~/Library/Logs/app.surveyr.desktop/engine.log` |
| *"Windows protected your PC"* | Unsigned app: **More info → Run anyway** (once). |
| A scan looks sideways, or tiny/huge | **Manual adjustments**: switch *Up axis*, or set the file's *Units*. |
| Trees/roofs missing from a LiDAR scan | Expected for terrain analysis: the outlier filter and *Ground points only* remove them (see Known limitations). |
| `ModuleNotFoundError` (fastapi, laspy, …) in development | The virtualenv is missing packages: rerun the `pip install -r requirements.txt` step with the venv's Python. |
| Dev backend: port 8000 already in use | Stop the other process, or run uvicorn with `--port 8001` and change the proxy in `frontend/vite.config.ts`. |
| Projects folder inside OneDrive/iCloud | Keep projects in the default app-data folder: synced folders may offload files and make loading very slow. |

---

## Project layout

```
backend/
  app/
    main.py            FastAPI routes (projects, analysis, points, scans,
                       settings, compositions)
    service.py         pipeline runner, project discovery, caching, delete
    io.py              read .las/.laz (laspy + lazrs), .ply, .xyz
    scan_settings.py   per-scan units / up axis / ground-only; unit detection
    storage.py         safe scan import, first-run demo data, trash/recycle bin
    compare.py         comparison (multi-layer overlay) files
    pcd.py clean.py dem.py terrain.py analytics.py fusion.py
                       point model, outlier removal, gridding + scanned mask,
                       slope/aspect/…, site metrics, two-pass registration
  scripts/             regenerate the demo projects
  tests/               pytest suites
  surveyr_server.py    engine entry point used by the desktop app
  surveyr-backend.spec PyInstaller recipe for the bundled engine
frontend/
  src/
    viewer/            3D stage, points/surface rendering, toolbar, compass
    compare/           comparison workspace (layers, placement, scene)
    charts/            Charts panel and terrain statistics
    jobsite/           Job site calculations (earthworks, haul, cut/fill map)
    adjust/            Manual adjustments panel
    slice/             cross-section dock and profile drawing
    panels/ layout/    side panels, top bar, icon rail, dialogs
    appearance/        theme + highlight colour
    hooks/ lib/ styles/
  src-tauri/           desktop shell (Rust): starts/stops the engine; icons
  scripts/             build-engine.mjs (cross-platform PyInstaller build)
docs/                  METRICS_GLOSSARY.md
.github/workflows/     Windows + macOS installer builds (release.yml)
```

---

## Licensing & cost

Surveyr is intended to stay **zero-cost and built only on free, permissively
licensed open-source software** — no paid APIs, proprietary SDKs or accounts.

| Component | Purpose | License |
|---|---|---|
| Python 3 | engine language | PSF |
| NumPy / SciPy / Matplotlib | terrain maths, previews | BSD-3-Clause / BSD-like |
| FastAPI / Uvicorn / python-multipart | local engine API | MIT / BSD-3-Clause / Apache-2.0 |
| laspy + lazrs | LAS / LAZ reading | BSD-2-Clause / MIT-Apache-2.0 |
| pyproj (PROJ) | coordinate systems and units of LAS files | MIT |
| Send2Trash | Windows/Linux recycle bin | BSD-3-Clause |
| PyInstaller | bundles the engine | GPL-2.0 with bootloader exception (output may be distributed under any licence) |
| React, Vite, TypeScript | interface | MIT / Apache-2.0 |
| Three.js | 3D rendering | MIT |
| Tauri 2 | desktop shell | MIT / Apache-2.0 |
| Rajdhani, Share Tech Mono (@fontsource) | typefaces, bundled for offline use | OFL-1.1 |
| pytest, httpx, vitest | tests | MIT / BSD-3-Clause / MIT |

Possible future additions stay in the same spirit: **Potree** for very large
point clouds, **OpenStreetMap** for any basemap.

---

## Known limitations

- **Phone LiDAR** (the prototype scanner) has ~5 m range, ±1–3 cm accuracy,
  drift over larger areas, and no real-world position or true north. That
  error is in the scanner, not the software, and goes away with survey-grade
  LiDAR, which records GNSS coordinates.
- **Outlier filter**: points more than 8 robust standard deviations from the
  median height are removed as noise. This also removes tall objects (tree
  canopy, roofs) even with *Ground points only* off — right for terrain
  analysis, wrong if you want to measure a structure.
- **Very large surveys**: the whole file is loaded into memory and imports are
  limited to 1 GiB. Typical drone surveys are fine; national-scale tiles would
  need a streaming loader.
- **Volumes** use simple prismatic cells against a flat pad at the mean
  elevation; professional grading uses TIN-based methods and designed target
  surfaces. Results also depend on cell size.
- **Alignment** of comparison layers is manual for now (move / rotate / exact
  values); point-pair snapping and automatic refinement are planned.
- Treat every figure as decision support; final judgements remain the
  surveyor's.
