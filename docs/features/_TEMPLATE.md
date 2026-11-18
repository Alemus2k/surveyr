---
id: feature-id            # kebab-case, same as the file name
title: Human title
status: experimental      # experimental | stable | removed
since: "0.7.0"
area: site                # site | scan | viewer | import | export | shell
origin: roadmap           # roadmap (asked for) | idea (added along the way)
data_used: [elevation]    # elevation, rgb, intensity, returns, classification, time, design, control
---

# Human title

**One-line summary:** what it tells the user, in plain words.

## Why it exists

The job-site question it answers and who asks it (PM, superintendent, project
engineer, estimator).

## Where to find it

Exact click path, e.g. *Job sites → Riverside Commons → Quantities tab → Layers*.

## How to use it

Numbered steps for the common case. Mention the demo data that shows it off.

## How it works

The calculation, precisely enough to reproduce by hand: inputs, formulas,
thresholds and their defaults, what is ignored. Plain maths, no code.

## What it needs from the flight

Which channels / inputs are required, which are optional, and what happens
(message shown) when they're missing.

## Limits and honesty notes

Accuracy limits, cases it gets wrong, what it must not be used for.

## Files

- `backend/app/…` — what
- `frontend/src/…` — what
- Tests: `…`

## Review checklist

- [ ] step a reviewer can do to see it work
- [ ] expected result on the demo site
