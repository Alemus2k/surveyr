---
id: trench-asbuilt
title: Trench as-built record and OSHA check
status: experimental
since: "0.7.0"
area: site
origin: roadmap
data_used: [elevation, classification]
---

# Trench as-built record and OSHA check

**One-line summary:** from the flight that saw a trench open — how long, wide and deep it was, its walls, the pipe's top, inverts and slope, and plain-language OSHA prompts — kept as a permanent record you can copy or export as CSV.

## Why it exists

Once a trench is backfilled, where the pipe runs and how deep is gone unless someone surveyed it. The drone already flew over it open. And trench collapses are the classic fatal excavation accident: a superintendent wants to know, before an OSHA inspector does, if a deep trench had vertical walls or spoil piled at the edge.

## Where to find it

*Job sites → (site) → Checks & records → Trench records*.

## How to use it

1. Pick the flight that saw the trench open in the timeline.
2. **Draw trench**: click along its middle, end to end, finish with a double-click. Name it, check *Flight that saw it open*, pick the *Pipe size* (saved into the note, e.g. "450 mm"; a size already written in the note is read from it; default 12 in / 300 mm).
3. Read the prompts, the size/depth/pipe tiles and the station table; **Copy as text**, **Copy CSV** or **Save CSV**.

Demo: *Storm drain trench* (flight 19 Oct).

## How it works

Points are put in trench coordinates (station along the drawn line, offset across it; the end segments extend past the line's ends).

1. **Each metre along**, using ground points within ±2.5 m along and ±6 m across: floor guess = 20th percentile of points within 0.4 m of the line; top guess = the lower of the two sides' medians beyond 1.5 m. Shallower than 0.3 m → not open there. Points below half depth are "deep"; the trench's centre and width come from their offsets, widened for sampling: width = (max − min)(n + 1)/(n − 1). Then floor = median ground in the middle half; **adjacent ground** = the lower of the medians 0.1–1.0 m beyond each edge (a spoil pile only ever raises a side); depth = ground − floor.
2. **Extent:** the span of deep points along the line (same order-statistic widening). A second pass slides each station's window inside the extent so end stations aren't half natural ground.
3. **Walls (per side, pooled along the trench):** height normalised as (z − floor)/depth against distance from the edge; median per 0.1 m; horizontal run between ¼ and ¾ depth divided by half the depth = H:V. Below 0.25 : 1 reads **near-vertical**.
4. **Spoil (per side):** rise above that side's natural ground (its 10th percentile), median per 0.1 m out to 6 m; a crest ≥ 0.3 m is a pile. A line fitted to the rising flank (15–75 % of the crest) is extended down to the level of the strip between edge and pile: that is the **toe**; setback = toe − edge.
5. **Pipe:** non-ground, non-vegetation points inside the trench, above floor − 0.1 m and below the edges − 0.1 m. Per 1 m bin, the 90th percentile (the crown); a straight line fitted to those, with two rounds of 3·MAD rejection, gives **pipe top** along the line and the **slope**. **Invert = pipe top − pipe size.** With no pipe points, inverts are left blank and the record says the table is the floor.
6. **OSHA prompts (29 CFR 1926 Subpart P):** depth ≥ 5 ft with a near-vertical wall → *protective system* (sloping, shoring or trench box) — bad; ≥ 5 ft with sloped walls → confirm the slope suits the soil (warn); spoil toe < 2 ft (0.61 m) from the edge → bad; ≥ 4 ft → *ladder within 25 ft* reminder; ≥ 20 ft → *PE-designed system*. All worded as prompts to check, not rulings.
7. **Record:** a row every 5 m (station, E, N of the trench centre, ground, floor, depth, width, pipe top, invert) plus the drawn centreline vertices, flight date, note, pipe size, slope and fall direction. CSV headers carry units (ft or m).

## What it needs from the flight

Elevation and **classification** (ground vs. other) to see the pipe; without classes the trench is still measured but the pipe isn't. Few pulses reach a narrow trench floor (the demo keeps 45 %); a handful per metre is enough.

## Limits and honesty notes

- Inverts are pipe top − the size you give: enter the outside diameter for the pipe's bottom; the inside (flow-line) invert is higher by the wall thickness.
- A trench box pulled out for the flight, or shoring the scan can't see, makes walls look unprotected: prompts only.
- The depth is from the lower side's ground beside the edge; on a steep cross-slope the high side is deeper.
- Draw one straight-ish run per record; bends are fine, branches aren't.
- Not a substitute for a competent person's inspection or a surveyed as-built where one is required.

## Files

- `backend/app/checks.py` — `analyse_trench`, `_trench_stations`, `_trench_extent`, `_trench_report`; `POST /api/sites/{id}/checks/trench`
- `frontend/src/site/tabs/ChecksTab.tsx` (`TrenchDetail`, editor), `site/checks.ts` (`trenchFinding`, `recordCsv`, `recordText`, `pipeFallText`, pipe sizes)
- Tests: `backend/tests/test_checks.py` (hand-made trench, shallow trench, no trench, no pipe, demo truth), `frontend/src/site/checks.test.ts`

## Review checklist

- [ ] Riverside → Checks & records → Trench records → *Storm drain trench*: length ≈ 204 ft (62 m), width ≈ 4.0 ft (1.2 m), depth ≈ 7.9 ft average / 9.0 ft deepest, pipe slope 0.80 % falling to the west, inverts ≈ 692.8 ft (211.03 m) at the start (east) and 691.2 ft (210.53 m) at the end.
- [ ] Prompts: protective system (near-vertical walls, > 5 ft), spoil pile ≈ 1.3 ft (0.4 m) from the edge, ladder reminder.
- [ ] Copy as text / Copy CSV / Save CSV produce the record with units.
- [ ] Change the pipe size: the note updates and the inverts move by the difference.
- [ ] Set the flight to 2 Nov: "No open trench along this line" (it was backfilled).
