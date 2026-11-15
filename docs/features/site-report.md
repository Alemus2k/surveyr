---
id: site-report
title: Printable site report
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, design, control, rgb, intensity, classification]
---

# Printable site report

**One-line summary:** one click turns a job site's dashboard into a black-on-white
report for the picked flight — progress, pay-app queries, quantities, site
conditions, checks and trench records — to print or save as PDF.

## Why it exists

A weekly report for the owner, the PM's files or a pay-app review, without
copying numbers out of the app.

## Where to find it

*Job sites → a site → **Print report*** (top right). Pick the flight on the
timeline first. **Print / save as PDF** opens the system print dialog; choose
"Microsoft Print to PDF" (Windows) or "Save as PDF" (macOS) to get a file.

## How it works

- Every dashboard tab can contribute a section (`SiteTabDef.report` in
  `site/tabs/registry.tsx`); sections are sentences and small tables, no maps,
  so they print cleanly.
- The header carries the flight, the previous flight, the design and the
  flight's accuracy against the check points; a flight with an offset gets a
  red warning before any numbers.
- Sections reuse exactly what the tabs compute (same functions, same caches),
  so the report and the screen never disagree.
- Print styles hide the app frame and print only the page.

## Limits and honesty notes

- Site conditions and checks need the engine to have worked them out; the
  section says so if you print before they're ready (open the tab once, or wait
  a moment).
- No maps or charts in the printout yet.

## Files

- `frontend/src/site/SiteReport.tsx`, `site/tabs/reports.tsx`, `site/tabs/reportData.ts`, print styles in `site/site.css`

## Review checklist

- [ ] Riverside → Print report (2 Nov): four sections; road base ≈ 255 tons;
      3 pay-app claims to query; 3.24 acres disturbed; sidewalk cross slope 4 %;
      storm drain trench 204 ft, pipe falling 0.80 % west.
- [ ] Print / save as PDF gives a clean, white, multi-page PDF without the app frame.
- [ ] Pick 21 Sep and print: a red warning says the flight is 0.11 ft high.
