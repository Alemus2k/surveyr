---
id: getting-started
title: Getting started page, first-run units choice and demo restore
status: experimental
since: "0.7.0"
area: shell
origin: idea
data_used: []
---

# Getting started

**One-line summary:** a brand-new user lands on a page that says what Surveyr
does, offers three ways in (demo site, import a scan, track a job site), asks
US or metric once, and explains how scans, job sites, tabs and the side tools fit
together. It's always one click away from the **?** in the top bar.

## Why it exists

Everyone using Surveyr is new to it, and many are new to LiDAR. Before this, a
fresh install opened straight into the demo with no explanation, and closing every
tab left only "No project open".

## Where to find it

- Automatically on first launch, and whenever no project is open.
- Any time: **?** in the top bar (it shows over the open project; × goes back).
- Job sites panel: *Restore the demo site* link (with a confirmation).

## How to use it

1. First launch: pick **US** or **Metric** in the bar at the top (asked once;
   changeable later under Appearance).
2. **Open Riverside Commons** to explore the demo, or **Choose a file…** to
   import a scan, or **New job site…** once you have scans.
3. If the demo site was deleted or changed, *Install the demo site* (on this
   page) or *Restore the demo site* (Job sites panel) reinstalls it as shipped.

## How it works

- First run no longer opens any tab, so the page shows. Tabs are still restored
  from the last session after that.
- The units bar shows until a choice is made (stored as
  `surveyr.unitsChosen` in local preferences).
- Restore: `POST /api/demo/restore` moves the demo's current files (and their
  settings) to the Trash / Recycle Bin, then copies the bundled originals in.
  Only demo file names are touched. In development (projects folder = demo
  folder) it does nothing.

## Limits and honesty notes

- The page describes tabs that exist in 0.7; if a tab is axed after review,
  update the "How it fits together" list.

## Files

- `frontend/src/layout/GettingStarted.tsx`, `layout/TopBar.tsx` (?), `layout/shell.css`
- `frontend/src/App.tsx` (first run, help toggle), `hooks/useProjects.ts`, `panels/ProjectsPanel.tsx`
- `backend/app/storage.py` (`restore_demo`), `backend/app/main.py` (`/api/demo/restore`)
- Tests: `backend/tests/test_storage.py` (restore)

## Review checklist

- [ ] Clear the app's preferences (or a fresh install): the app opens on
      "Welcome to Surveyr" with the units bar.
- [ ] Pick a unit system: the bar disappears and numbers use it everywhere.
- [ ] Open Riverside Commons from the page; press **?**; × returns to the site.
- [ ] Delete the demo site, then *Restore the demo site*: it comes back; the
      deleted file is in the Recycle Bin.
