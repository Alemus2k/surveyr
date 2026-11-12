# Surveyr development conventions

Read this before changing code. It applies to people and to AI agents alike.
Feature-level documentation lives in [`docs/features/`](features/); the index
of everything is [`docs/README.md`](README.md).

## What Surveyr is for

A local desktop app (Tauri shell + Python engine + React UI) that turns drone /
rover LiDAR scans of construction sites into quantities, progress, QA and
records for a general contractor. Three standing priorities:

1. **New-user friendly.** Every user is new: plain construction language, no
   surveying jargon without an explanation, sensible defaults, helpful empty
   states, nothing that needs the manual to discover.
2. **Use the whole flight.** The flight is already paid for. Use every channel
   a scan carries (elevation, colour, intensity, returns, classification, time)
   even when the result only matters in edge cases — but never show a number we
   can't stand behind; say what it is and how sure we are.
3. **Documented.** Every feature has a `docs/features/<id>.md` (template:
   [`_TEMPLATE.md`](features/_TEMPLATE.md)), an entry in
   [`CHANGELOG.md`](CHANGELOG.md) and a row in
   [`REVIEW_CHECKLIST.md`](REVIEW_CHECKLIST.md).

## Hard rules

- **Zero cost, permissive licences only.** No paid APIs, accounts or network
  calls. New Python or npm dependencies need a strong reason; say so in the
  feature doc.
- **The bundled engine is not your dev environment.** PyInstaller excludes
  `matplotlib`, `PIL`, `tkinter`, `pytest`, `IPython` (see
  `backend/surveyr-backend.spec`). Runtime code under `backend/app/` may use
  only `numpy`, `scipy`, `laspy`/`lazrs`, `pyproj`, `fastapi`, `pydantic`,
  `send2trash` and the standard library. (A LandXML feature once passed every
  test and crashed in the desktop app because it imported Matplotlib.)
- **Scans are never modified.** Everything derived is a sidecar file
  (`<scan>.settings.json`, `<name>.site.json`, `<name>.control.json`, …) or
  computed on load.
- **The engine is metric.** All stored values and API payloads are metres /
  m² / m³ / tonnes-per-m³. Only the UI converts, through
  `frontend/src/lib/units.ts`. Never format a quantity by hand in a component.
- **Only measured ground counts.** Volumes and areas use cells that were
  actually scanned in every surface involved; nothing is interpolated outside a
  scan's outline. Differences inside the tolerance / change threshold are zero.
- **Don't break the demo's truth tests.** `backend/scripts/make_jobsite_demo.py`
  writes exact answers (`riverside_truth.json`); tests compare the app against
  them. If you need new demo data, extend the generator *and* its truth.
- **Git:** work on a branch, one commit per feature or fix, never push, never
  tag, never touch the version numbers. Commit messages end with
  `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Layout

```
backend/app/        engine (FastAPI). main.py = routes; service.py = project
                    discovery, loading, caching; sites.py = job sites; io.py,
                    landxml.py = readers; dem.py/terrain.py/analytics.py = maths
backend/scripts/    demo generators (make_jobsite_demo.py is the big one)
backend/tests/      pytest
frontend/src/       React UI. site/ = job-site dashboard; viewer/ = 3D;
                    panels/, layout/ = shell; lib/ = shared helpers
docs/               this folder
```

## How features plug in (so parallel work doesn't collide)

- **Engine routes:** put a feature's endpoints in its own module
  (`backend/app/<feature>.py` exposing `router = APIRouter()`), and add one
  `app.include_router(...)` line at the bottom of `main.py`.
- **Site data:** new per-site settings are optional fields on `Site` in
  `backend/app/sites.py` (mirrored in `frontend/src/site/types.ts`), always with
  a default so old site files still load.
- **Site dashboard:** a feature that belongs to a job site is a tab. Add a
  component under `frontend/src/site/tabs/` and one entry in
  `frontend/src/site/tabs/registry.tsx`.
- **Scan tools:** a feature about a single scan is a side panel: one entry in
  `frontend/src/layout/panelRegistry.tsx`.
- **API client:** keep a feature's fetch functions in its own file
  (`frontend/src/<feature>/api.ts`), using `apiBase()` from `src/api.ts`.
- **Maths lives in pure functions** (`*.ts` with a `*.test.ts`, or a Python
  module with a pytest file) so it can be tested without a browser or server.

## UI conventions

- Reuse the existing classes (`primary-btn`, `secondary-btn`, `text-btn`,
  `tool-btn`, `segmented`, `panel-note`, `notice-card`, `status-chip`,
  `site-card`, `zone-table`, `metric-list`, `js-field`, `fig` for figures) and
  theme tokens in `styles/tokens.css`. Both light and dark themes must work.
- Colour meaning is fixed app-wide: **red = dirt leaving / problem**, **blue =
  dirt arriving**, **green = done / good**, **amber = needs a look**.
- Every number carries its unit and says what it measures. Every list has an
  empty state that tells the user what to do next. Destructive actions confirm.
- Write for a superintendent, not a surveyor: "still to dig", not "residual
  cut". Put the surveying term in the glossary instead.

## Testing

```bash
# engine (from backend/)
.venv/Scripts/python scripts/make_synthetic_terrain.py   # demo data, once
.venv/Scripts/python scripts/make_multi_scan.py
.venv/Scripts/python scripts/make_jobsite_demo.py
.venv/Scripts/python -m pytest tests -q

# interface (from frontend/)
npx tsc --noEmit
npx vitest run
npx vite build
```

A change is done when: both suites and the typecheck pass, new maths has tests
with hand-checkable numbers, the feature doc is written, and nothing in
`backend/app/` imports a module the bundled engine excludes.
