import { useMemo, useState } from "react";
import { formatArea, formatLength, formatVolume, type Quantity } from "../lib/format";
import { PanelSection } from "../panels/SidePanel";
import type { Analysis } from "../types";
import { CutFillMap } from "./CutFillMap";
import { DirtLedgerCard } from "./DirtLedgerCard";
import { balancedBase, designGrid, dirtLedger, haul, siteCells, volumes } from "./earthworks";
import { CUSTOM_MATERIAL, DIRECTIONS, MATERIALS, useJobsiteSettings } from "./settings";
import { jobsiteSummary } from "./summary";

interface JobsitePanelProps {
  projectId: string;
  projectName: string;
  analysis: Analysis;
}

interface NumberFieldProps {
  label: string;
  unit: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}

function NumberField({ label, unit, value, step, min, max, onChange }: NumberFieldProps) {
  return (
    <label className="js-field">
      <span className="field-label">{label}</span>
      <span className="js-input">
        <input
          type="number"
          className="fig"
          value={Number(value.toFixed(3))}
          step={step}
          min={min}
          max={max}
          onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)}
        />
        <span className="unit">{unit}</span>
      </span>
    </label>
  );
}

const q = (x: Quantity) => (
  <>
    {x.value} <span className="unit">{x.unit}</span>
  </>
);

/** Earthworks to level the scanned site: pad grade, cut/fill, haul and truckloads. */
export function JobsitePanel({ projectId, projectName, analysis }: JobsitePanelProps) {
  const [s, update] = useJobsiteSettings(projectId);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const site = useMemo(
    () =>
      siteCells(
        { x: analysis.grid.x, y: analysis.grid.y, z: analysis.maps.elevation.data, mask: analysis.maps.mask?.data },
        analysis.grid.cell_size
      ),
    [analysis]
  );
  const zStats = useMemo(() => {
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (const z of site.z) {
      lo = Math.min(lo, z);
      hi = Math.max(hi, z);
      sum += z;
    }
    return { lo, hi, mean: site.z.length ? sum / site.z.length : 0 };
  }, [site]);

  const grade = { slopePct: s.slopePct, fallsTowardDeg: s.fallsTowardDeg };
  const balanced = useMemo(
    () => balancedBase(site, grade, s.shrinkPct / 100),
    [site, s.slopePct, s.fallsTowardDeg, s.shrinkPct] // grade is rebuilt each render from these values
  );
  const base = s.mode === "balanced" ? balanced : (s.customBase ?? balanced);
  const target = useMemo(() => designGrid(site, { ...grade, base }), [site, base, s.slopePct, s.fallsTowardDeg]);
  const v = useMemo(() => volumes(site, target), [site, target]);
  const h = haul(v, s, s.truckM3);
  const ledger = dirtLedger(v.cut, h.fillBank);

  if (site.z.length === 0) return <div className="empty-state">No scanned ground to calculate.</div>;

  const material = MATERIALS.find((m) => m.id === s.materialId);
  const direction = DIRECTIONS.find(([, d]) => d === s.fallsTowardDeg)?.[0] ?? `${s.fallsTowardDeg}°`;
  const scannedArea = site.z.length * site.cellArea;

  const copySummary = async () => {
    const text = jobsiteSummary({
      project: projectName,
      padElevation: base,
      balanced: s.mode === "balanced",
      slopePct: s.slopePct,
      fallsToward: direction,
      scannedArea,
      cellSize: analysis.grid.cell_size,
      volumes: v,
      material: { label: material?.label ?? "Custom material", swellPct: s.swellPct, shrinkPct: s.shrinkPct },
      haul: h,
      truckM3: s.truckM3,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  };

  return (
    <>
      {/* ---------------- headline result */}
      <section className={`js-result ${h.direction}`} aria-live="polite">
        <span className="js-result-label">
          {h.direction === "balanced" ? "Balanced on site" : h.direction === "export" ? "Left over to remove" : "Short — bring in"}
        </span>
        {h.direction === "balanced" ? (
          <span className="js-result-sub">Cut covers the fill — no trucks needed.</span>
        ) : (
          <>
            <strong className="fig js-result-value">{q(formatVolume(h.loose))}</strong>
            <span className="js-result-sub">
              loose · <span className="fig">{h.loads.toLocaleString("en-GB")}</span> load{h.loads === 1 ? "" : "s"} of{" "}
              {s.truckM3} m³ · {formatVolume(h.bank).value} m³ in the ground
            </span>
          </>
        )}
      </section>

      {/* ---------------- target grade */}
      <PanelSection label="Target pad">
        <div className="segmented" role="group" aria-label="Pad height">
          <button aria-pressed={s.mode === "balanced"} onClick={() => update({ mode: "balanced" })}>
            Balanced
          </button>
          <button
            aria-pressed={s.mode === "custom"}
            onClick={() => update({ mode: "custom", customBase: s.customBase ?? Number(balanced.toFixed(3)) })}
          >
            Custom height
          </button>
        </div>
        {s.mode === "balanced" ? (
          <p className="panel-note">
            Pad set at <strong className="fig">{formatLength(base)}</strong> so dug-out soil exactly makes the fill
            {s.shrinkPct > 0 ? ` after ${s.shrinkPct}% compaction` : ""}.
          </p>
        ) : (
          <>
            <NumberField label="Pad elevation" unit="m" step={0.01} value={base} onChange={(x) => update({ customBase: x })} />
            <div className="js-quick">
              <button className="text-btn" onClick={() => update({ customBase: zStats.lo })}>Lowest</button>
              <button className="text-btn" onClick={() => update({ customBase: zStats.mean })}>Mean</button>
              <button className="text-btn" onClick={() => update({ customBase: zStats.hi })}>Highest</button>
              <button className="text-btn" onClick={() => update({ customBase: balanced })}>Balanced</button>
            </div>
          </>
        )}
        <div className="js-row">
          <NumberField
            label="Drainage fall"
            unit="%"
            step={0.5}
            min={0}
            max={20}
            value={s.slopePct}
            onChange={(x) => update({ slopePct: x })}
          />
          <label className="js-field">
            <span className="field-label">Falls toward</span>
            <select
              value={s.fallsTowardDeg}
              disabled={s.slopePct === 0}
              onChange={(e) => update({ fallsTowardDeg: Number(e.target.value) })}
            >
              {DIRECTIONS.map(([name, deg]) => (
                <option key={deg} value={deg}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="panel-note">
          Elevation is at the centre of the scan. Ground ranges {formatLength(zStats.lo)} to {formatLength(zStats.hi)}.
        </p>
      </PanelSection>

      {/* ---------------- volumes */}
      <PanelSection label="Where the dirt goes">
        <DirtLedgerCard volumes={v} haul={h} ledger={ledger} truckM3={s.truckM3} shrinkPct={s.shrinkPct} />
      </PanelSection>

      <PanelSection label="Earthworks detail">
        <dl className="metric-list">
          <div className="metric-row">
            <dt>Fill (compacted)</dt>
            <dd className="fig">{q(formatVolume(v.fill))}</dd>
          </div>
          <div className="metric-row">
            <dt>Cut / fill area</dt>
            <dd className="fig">
              {formatArea(v.cutArea).value} / {q(formatArea(v.fillArea))}
            </dd>
          </div>
          <div className="metric-row">
            <dt>Max dig / fill depth</dt>
            <dd className="fig">
              {v.maxCut.toFixed(2)} / {v.maxFill.toFixed(2)} <span className="unit">m</span>
            </dd>
          </div>
        </dl>
        <CutFillMap site={site} target={target} nx={analysis.grid.nx} ny={analysis.grid.ny} />
      </PanelSection>

      {/* ---------------- material + trucks */}
      <PanelSection label="Material & trucks">
        <label className="js-field">
          <span className="field-label">Soil type</span>
          <select
            value={material ? s.materialId : CUSTOM_MATERIAL}
            onChange={(e) => {
              const m = MATERIALS.find((x) => x.id === e.target.value);
              update(m ? { materialId: m.id, swellPct: m.swellPct, shrinkPct: m.shrinkPct } : { materialId: CUSTOM_MATERIAL });
            }}
          >
            {MATERIALS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value={CUSTOM_MATERIAL}>Custom</option>
          </select>
        </label>
        <div className="js-row">
          <NumberField
            label="Swell"
            unit="%"
            step={1}
            min={0}
            max={100}
            value={s.swellPct}
            onChange={(x) => update({ swellPct: x, materialId: CUSTOM_MATERIAL })}
          />
          <NumberField
            label="Shrinkage"
            unit="%"
            step={1}
            min={0}
            max={50}
            value={s.shrinkPct}
            onChange={(x) => update({ shrinkPct: x, materialId: CUSTOM_MATERIAL })}
          />
        </div>
        <NumberField label="Truck capacity" unit="m³" step={1} min={1} max={100} value={s.truckM3} onChange={(x) => update({ truckM3: x })} />
        <p className="panel-note">
          Swell: dug soil takes up more room loose in a truck. Shrinkage: fill compacts, so it needs more soil than the
          space it fills. Presets are typical figures — use your geotech's numbers if you have them.
        </p>
        <button className="secondary-btn full" onClick={copySummary}>
          {copied === "done" ? "Copied to clipboard" : copied === "failed" ? "Couldn't copy" : "Copy summary"}
        </button>
        <p className="panel-note">
          Estimates from the scan over {formatArea(scannedArea).value} {formatArea(scannedArea).unit} of scanned ground
          (grid {analysis.grid.cell_size} m). Verify on site before quoting.
        </p>
      </PanelSection>
    </>
  );
}
