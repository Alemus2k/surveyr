import { useEffect, useState } from "react";
import { fetchControlSets, type ControlSetRef, type ProjectRef } from "../api";
import { Icon } from "../layout/icons";
import { PanelSection } from "../panels/SidePanel";
import { dateInName, formatDate, todayIso } from "./dates";
import { describeGrade } from "./specs";
import { ZONE_PALETTE, type Site, type ZoneKind } from "./types";
import type { SiteState } from "./useSite";
import { STATUS } from "./ZoneTable";

interface SitePanelProps {
  state: SiteState;
  projects: ProjectRef[];
  selectedZone: string | null;
  onSelectZone: (id: string | null) => void;
}

const isScan = (p: ProjectRef) => p.type === "single" || p.type === "fused" || p.type === undefined;
const SPECS_NOTE = "Specs change through “Job specs change order” on the dashboard, so every revision is logged.";

/** Edit a site: its zones and schedule, which scans belong to it, the design and tolerances. */
export function SitePanel({ state, projects, selectedZone, onSelectZone }: SitePanelProps) {
  const { site, progress, update, updateZone } = state;
  const [adding, setAdding] = useState<{ id: string; date: string } | null>(null);
  const [controlSets, setControlSets] = useState<ControlSetRef[]>([]);
  useEffect(() => {
    fetchControlSets().then(setControlSets, () => setControlSets([]));
  }, []);
  if (!site) return <div className="empty-state">Loading…</div>;

  const zone = site.zones.find((z) => z.id === selectedZone) ?? null;
  const scanName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const available = projects.filter((p) => isScan(p) && !site.scans.some((s) => s.project_id === p.id) && p.id !== site.design_id);
  const set = (patch: Partial<Site>) => update((s) => ({ ...s, ...patch }));
  const cmField = (label: string, value: number, onChange: (m: number) => void, hint: string) => (
    <label className="js-field">
      <span className="field-label">{label}</span>
      <span className="js-input">
        <input
          type="number"
          className="fig"
          min={0}
          max={200}
          step={1}
          value={Math.round(value * 1000) / 10}
          onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(Math.min(2, Math.max(0.001, e.target.valueAsNumber / 100)))}
        />
        <span className="unit">cm</span>
      </span>
      <span className="field-hint">{hint}</span>
    </label>
  );

  return (
    <>
      {zone && (
        <PanelSection label="Selected zone">
          <label className="js-field">
            <span className="field-label">Name</span>
            <input value={zone.name} maxLength={60} onChange={(e) => updateZone(zone.id, { name: e.target.value || "Zone" })} />
          </label>
          <div className="segmented" role="group" aria-label="Zone type">
            {(["grading", "stockpile"] as ZoneKind[]).map((k) => (
              <button key={k} aria-pressed={zone.kind === k} onClick={() => updateZone(zone.id, { kind: k })}>
                {k === "grading" ? "Grading to design" : "Stockpile"}
              </button>
            ))}
          </div>
          {zone.kind === "grading" && (
            <dl className="spec-list">
              <dt>Finished grade</dt>
              <dd>{describeGrade({ target_elevation_m: zone.target_elevation_m ?? null, design_offset_m: zone.design_offset_m ?? 0 })}</dd>
              <dt>Planned</dt>
              <dd className="fig">
                {zone.start ? formatDate(zone.start) : "no start"} → {zone.finish ? formatDate(zone.finish) : "no finish"}
              </dd>
            </dl>
          )}
          <div className="zone-swatches" role="group" aria-label="Zone colour">
            {ZONE_PALETTE.map((c) => (
              <button
                key={c}
                style={{ background: c }}
                aria-pressed={zone.color === c}
                aria-label={`Colour ${c}`}
                onClick={() => updateZone(zone.id, { color: c })}
              />
            ))}
          </div>
          <button
            className="danger-btn"
            onClick={() => {
              update((s) => ({
                ...s,
                zones: s.zones.filter((z) => z.id !== zone.id),
                pay_apps: s.pay_apps.map((p) => (p.zone_id === zone.id ? { ...p, zone_id: null } : p)),
              }));
              onSelectZone(null);
            }}
          >
            <Icon name="trash" size={14} /> Delete zone
          </button>
          <p className="panel-note">
            {zone.kind === "grading"
              ? `Progress is measured toward the finished grade inside this outline; the plan line runs straight from start to finish. ${SPECS_NOTE}`
              : "A stockpile reports the volume piled on top of the ground in the first scan."}
          </p>
        </PanelSection>
      )}

      <PanelSection label="Zones">
        {site.zones.length === 0 ? (
          <p className="panel-note">Use “Draw zone” on the map to outline work areas.</p>
        ) : (
          <ul className="project-list">
            {progress.map((p) => (
              <li key={p.zone.id} className="project-row" data-active={p.zone.id === selectedZone}>
                <button className="project-open" onClick={() => onSelectZone(p.zone.id === selectedZone ? null : p.zone.id)}>
                  <span className="project-name zone-name">
                    <i style={{ background: p.zone.color }} />
                    {p.zone.name}
                  </span>
                  <span className="project-id">{p.zone.kind === "stockpile" ? "stockpile" : STATUS[p.status].label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection label="Scans">
        <ul className="site-scan-list">
          {site.scans.map((s) => (
            <li key={s.project_id}>
              <span className="site-scan-name" title={s.project_id}>
                {scanName(s.project_id)}
              </span>
              <input
                type="date"
                value={s.date}
                aria-label={`Date of ${scanName(s.project_id)}`}
                onChange={(e) =>
                  e.target.value &&
                  update((x) => ({ ...x, scans: x.scans.map((y) => (y.project_id === s.project_id ? { ...y, date: e.target.value } : y)) }))
                }
              />
              <button
                className="tool-btn"
                aria-label={`Remove ${scanName(s.project_id)} from the site`}
                title="Remove from site (the scan itself is kept)"
                disabled={site.scans.length === 1}
                onClick={() => update((x) => ({ ...x, scans: x.scans.filter((y) => y.project_id !== s.project_id) }))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
        {adding ? (
          <div className="site-add-scan">
            <select
              value={adding.id}
              onChange={(e) => setAdding({ id: e.target.value, date: dateInName(e.target.value) ?? adding.date })}
              aria-label="Scan to add"
            >
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input type="date" value={adding.date} onChange={(e) => setAdding({ ...adding, date: e.target.value })} aria-label="Scan date" />
            <button
              className="primary-btn compact"
              disabled={!adding.id || !adding.date}
              onClick={() => {
                update((x) => ({ ...x, scans: [...x.scans, { project_id: adding.id, date: adding.date }] }));
                setAdding(null);
              }}
            >
              Add
            </button>
            <button className="tool-btn" onClick={() => setAdding(null)} aria-label="Cancel">
              <Icon name="close" size={14} />
            </button>
          </div>
        ) : (
          <button
            className="secondary-btn full"
            disabled={available.length === 0}
            onClick={() => setAdding({ id: available[0].id, date: dateInName(available[0].id) ?? todayIso() })}
          >
            <Icon name="plus" size={14} /> Add a scan…
          </button>
        )}
        <p className="panel-note">
          Scans must share a coordinate system (e.g. RTK drone flights on the same site control). Import new flights
          from Projects first. Dates set the timeline: latest is {formatDate(site.scans[site.scans.length - 1]?.date ?? todayIso())}.
        </p>
      </PanelSection>

      <PanelSection label="Check points">
        <select value={site.control_id ?? ""} onChange={(e) => set({ control_id: e.target.value || null })} aria-label="Check points">
          <option value="">None</option>
          {controlSets.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.count} pts)
            </option>
          ))}
        </select>
        <p className="panel-note">
          Every flight is graded against these surveyed points (badges on the timeline). Import them in Control &amp;
          accuracy.
        </p>
      </PanelSection>

      <PanelSection label="Job specs">
        <dl className="spec-list">
          <dt>Design surface</dt>
          <dd>{site.design_id ? scanName(site.design_id) : "None"}</dd>
          <dt>On grade within</dt>
          <dd className="fig">±{+(site.tolerance_m * 100).toFixed(1)} cm</dd>
          <dt>Change orders</dt>
          <dd className="fig">{site.change_orders?.length ?? 0}</dd>
        </dl>
        <p className="panel-note">
          The design surface is the finished grade, as a point cloud or surface file; closer than the tolerance counts as
          done. {SPECS_NOTE}
        </p>
      </PanelSection>

      <PanelSection label="Tolerances">
        {cmField("Ignore changes under", site.change_threshold_m, (m) => set({ change_threshold_m: m }), "Scan-to-scan differences smaller than this are treated as noise.")}
        <label className="js-field">
          <span className="field-label">Flag claims above measured by</span>
          <span className="js-input">
            <input
              type="number"
              className="fig"
              min={0}
              max={100}
              step={1}
              value={site.overbill_pct}
              onChange={(e) => Number.isFinite(e.target.valueAsNumber) && set({ overbill_pct: Math.min(100, Math.max(0, e.target.valueAsNumber)) })}
            />
            <span className="unit">%</span>
          </span>
        </label>
      </PanelSection>
    </>
  );
}
