import type { SlopeClass } from "./terrainStats";

// Sequential "easy → hard to build on" colours.
const CLASS_COLORS = ["#3ecf7a", "#a6d94a", "#f5c542", "#f5913a", "#ef4b4b"];

interface Props {
  classes: SlopeClass[];
  threshold: number; // current "level" threshold (degrees)
  levelPct: number; // % of site at or under it
}

const label = (c: SlopeClass) => (Number.isFinite(c.to) ? `${c.from}–${c.to}°` : `${c.from}°+`);

/** Share of the site in each slope class, as one stacked bar plus a breakdown. */
export function SlopeClassesChart({ classes, threshold, levelPct }: Props) {
  return (
    <>
      <div className="stack-bar" role="img" aria-label="Slope classes">
        {classes.map((c, i) =>
          c.pct > 0 ? (
            <span key={label(c)} style={{ width: `${c.pct}%`, background: CLASS_COLORS[i % CLASS_COLORS.length] }} title={`${label(c)}: ${c.pct.toFixed(1)}%`} />
          ) : null
        )}
      </div>
      <dl className="class-list">
        {classes.map((c, i) => (
          <div key={label(c)} className="class-row">
            <dt>
              <i style={{ background: CLASS_COLORS[i % CLASS_COLORS.length] }} />
              {label(c)}
            </dt>
            <dd className="mono">{c.pct.toFixed(1)}%</dd>
          </div>
        ))}
      </dl>
      <p className="chart-readout">
        <strong className="mono">{levelPct.toFixed(1)}%</strong> is level at your ≤ {threshold.toFixed(1)}° threshold.
      </p>
    </>
  );
}
