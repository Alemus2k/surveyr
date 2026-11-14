# Surveyr documentation

Start here. Everything is plain Markdown, written to be read by people and by AI
assistants alike: each feature doc has the same sections in the same order (see
the [template](features/_TEMPLATE.md)) and a front-matter block with its id,
status and origin.

| Document | What it's for |
|---|---|
| [README (repo root)](../README.md) | Install, use, build — the user-facing manual |
| [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) | Every change in the coming release, with how to test it and a keep / axe column |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each version, newest first |
| [features/](features/) | One file per feature: why, where, how to use, how it works, limits, files, review steps |
| [METRICS_GLOSSARY.md](METRICS_GLOSSARY.md) | What every number in the app means and how it's computed |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Conventions for anyone (or any agent) changing the code |
| [FUTURE_UPGRADES.md](FUTURE_UPGRADES.md) | Bigger ideas not started yet: automated drone flights, sending progress to company software, parked ideas |

## Feature docs by area

Feature docs use `status: experimental` until you've reviewed them, then
`stable`; `origin: roadmap` means it was planned, `origin: idea` means it was
added along the way and is up for keep / axe review. The table is kept in sync
with the `features/` folder at each release.

| Area | Features |
|---|---|
| Whole app | [units](features/units.md) |
| Importing | [LandXML design surfaces](features/landxml.md), [ground classification](features/ground-classification.md) |
| A single scan | [contours](features/contours.md), [exports](features/exports.md) |
| Job site | [site dashboard](features/site-dashboard.md), [site conditions](features/site-conditions.md), [layers](features/layers.md), [stockpiles](features/stockpiles.md), [pond storage](features/pond-storage.md), [cross-sections](features/cross-sections.md), [trench as-built](features/trench-asbuilt.md), [ADA slopes](features/ada-slopes.md), [settlement](features/settlement.md) |
| Engine | [whole-flight data](features/flight-data.md), [demo site](features/demo-site.md) |
