# Surveyr metrics glossary

What each number and chart in Surveyr means, how it's computed, and what it
does *not* tell you. All figures are in metres, after the scan's
[manual adjustments](../README.md#using-surveyr) (units, up axis, ground-only)
are applied.

## How a scan becomes numbers

1. **Points** are loaded and converted to metres, Z-up. With *ground points
   only* on and a ground-classified LiDAR file, only ASPRS class 2 points are
   kept.
2. **Outlier removal** drops points more than 8 robust standard deviations
   (median ± 8 × 1.4826 × MAD) from the median elevation — stray spikes such as
   birds or multipath returns. It also removes tall objects (tree canopy,
   roofs) far above the ground.
3. **Rasterising**: points are binned into square **cells** and each cell gets
   the mean elevation of its points. The **cell size** is chosen automatically
   (~100 cells across the scan, 1 cm–2 m; larger sites coarsen so the grid
   stays ≤ 400 cells across) and is shown in the top bar.
4. **Scanned mask**: cells containing points, with single-cell pinholes closed.
   Only these cells count towards the site metrics below — the empty corners
   of an irregular scan are interpolated for display but never measured.
5. **Smoothing**: a light Gaussian blur (σ = 0.5 cells) before derivatives.

## Site metrics (Terrain panel)

| Metric | Meaning |
|---|---|
| **Level at ≤ threshold** | % of scanned cells whose slope is at or below the threshold you choose (presets: Flat 1°, Gentle 3°, Hilly 8°, Steep 15°). |
| **Size (W × D × H)** | Bounding size of the cleaned points: east–west × north–south × vertical. Check it against a tape measure on site. |
| **Relief** | Highest minus lowest scanned cell. |
| **Area** | Number of scanned cells × cell area (plan view, not surface area). |
| **Cut / Fill** | Earth to dig out / bring in to make the scanned area a flat pad at the **mean elevation**, cell by cell (prismatic cells). |
| **Net fill − cut** | Fill minus cut; ~0 at the mean elevation by construction. |
| **Lowest / Highest** | Extremes of the scanned cells' elevations. |

## Surfaces

| Term | Meaning |
|---|---|
| **Slope** | Steepness in degrees: arctan of the elevation gradient's magnitude (0° flat … 90° vertical). |
| **Aspect** | Direction the slope faces (steepest descent), degrees clockwise from north. For phone scans "north" is wherever the phone faced — see the README. |
| **Curvature** | Total curvature (Frobenius norm of the elevation Hessian): how sharply the surface bends; high on ridges and in hollows. |
| **Roughness** | Standard deviation of elevation in a 3 × 3 cell window. |
| **Coverage** | (Two-pass demo) how many scan passes covered each cell; "revisited" = 2+ passes. |

## Charts

- **Earthworks balance** — cut and fill volume for a flat pad at every height
  between the lowest and highest cell. Where the lines cross is the **balance
  point** (cut = fill), which for a flat pad is exactly the mean elevation.
- **Slope classes** — share of scanned area in 0–2°, 2–5°, 5–10°, 10–15° and
  15°+ bands, plus the % level at your threshold.
- **Aspect rose** — 16 compass sectors; wedge *area* is proportional to the
  share of sloped ground facing that way. Cells flatter than 1° are left out
  (they don't really face anywhere).
- **Elevation / slope distributions** — histograms (or area / cumulative %)
  of the scanned cells.

## Job site calculations

| Term | Meaning |
|---|---|
| **Pad** | The finished ground you're grading to: flat, or falling at the *drainage fall* (%) toward a compass direction. Its elevation is quoted at the centre of the scan. |
| **Balanced pad** | The pad height where the cut, once compacted into the fill, exactly makes it: cut = fill ÷ (1 − shrinkage). Found numerically; with 0 % shrinkage on a flat pad it is the mean elevation. |
| **Cut (in the ground)** | Bank volume above the pad — soil as it sits before digging. |
| **Fill (compacted)** | Space below the pad to be filled, as finished compacted volume. |
| **Fill needs (in the ground)** | Bank volume required to make that fill: fill ÷ (1 − shrinkage). |
| **Swell** | Loose soil takes up more room than in the ground: loose = bank × (1 + swell). Governs truck space. |
| **Shrinkage** | Compacted fill is denser than in-ground soil, so it needs more bank volume than the space it fills. |
| **Export / import** | Cut minus fill-needed (bank). Positive is hauled away, negative brought in; within 0.5 % of the soil moved counts as *balanced*. Shown as loose volume and truckloads (rounded up). |
| **Dig / fill map** | Plan view, north up: red where ground is above the pad (dig), blue below it (fill), grey within 1 cm of grade. |

Swell and shrinkage presets are typical textbook figures (e.g. common earth
25 % / 10 %); real values depend on the soil, moisture and compaction
specification — use a geotechnical report's numbers where available.

## Comparisons

- **Cross-section slice** — every visible layer's points inside a thin band,
  drawn side-on at their current placement; the vertical gap between layers is
  the scan-to-scan difference at that cut.
- **Vertical ×N** — display-only exaggeration for very flat sites (up to 3× in
  3D, 5× in the slice profile). Numbers are never exaggerated.

## Caveats

- Results depend on cell size: finer cells resolve small features but are
  noisier; coarser cells smooth them away.
- Volumes use simple prismatic cells; professional grading uses TIN-based or
  more rigorous methods and a designed (not flat) target surface.
- Phone LiDAR is typically ±1–3 cm and drifts over larger areas; that error is
  in the scan, not the software, and disappears with a survey-grade scanner.
- Treat every figure as decision support; final judgements remain the
  surveyor's.
