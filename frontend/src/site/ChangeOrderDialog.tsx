import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectRef } from "../api";
import { todayIso } from "./dates";
import type { Surfaces } from "./progress";
import {
  diffSpecs,
  gradeMode,
  issueChangeOrder,
  meanOver,
  nextChangeOrderNumber,
  SPEC_LABEL,
  specsOf,
  type GradeMode,
  type SpecDraft,
  type ZoneSpec,
} from "./specs";
import type { Site, Zone } from "./types";

interface ChangeOrderDialogProps {
  open: boolean;
  site: Site;
  surfaces: Surfaces; // design = the current finished grade
  cellsOf: (zone: Zone) => Int32Array;
  projects: ProjectRef[];
  onIssue: (next: (s: Site) => Site) => void;
  onCancel: () => void;
}

const isScan = (p: ProjectRef) => p.type === "single" || p.type === "fused" || p.type === undefined;
const GRADE_MODES: ReadonlyArray<[GradeMode, string]> = [
  ["design", "Design surface"],
  ["offset", "Design raised / lowered"],
  ["flat", "Flat pad at elevation"],
];

/** Edit the job specs (design, tolerance, each zone's finished grade and dates) and log it as a change order. */
export function ChangeOrderDialog({ open, site, surfaces, cellsOf, projects, onIssue, onCancel }: ChangeOrderDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<SpecDraft>(() => specsOf(site));
  const [modes, setModes] = useState<Record<string, GradeMode>>({});
  const [meta, setMeta] = useState({ title: "", date: todayIso(), requested_by: "", reason: "" });

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      const specs = specsOf(site);
      setDraft(specs);
      setModes(Object.fromEntries(specs.zones.map((z) => [z.id, gradeMode(z)])));
      setMeta({ title: "", date: todayIso(), requested_by: "", reason: "" });
      dlg.showModal();
      requestAnimationFrame(() => titleInput.current?.focus());
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]); // the draft starts from the site as it is when the dialog opens

  const nameOf = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const changes = useMemo(() => diffSpecs(site, draft, nameOf), [site, draft, projects]);
  const number = nextChangeOrderNumber(site);
  const valid = changes.length > 0 && meta.title.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(meta.date);
  const designs = projects.filter((p) => isScan(p) && !site.scans.some((s) => s.project_id === p.id));
  const changed = (field: string, zoneId: string | null = null) =>
    changes.some((c) => c.field === field && c.zone_id === zoneId) || undefined;

  const setZone = (id: string, patch: Partial<ZoneSpec>) =>
    setDraft((d) => ({ ...d, zones: d.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) }));

  const setMode = (zone: Zone, mode: GradeMode) => {
    setModes((m) => ({ ...m, [zone.id]: mode }));
    if (mode === "design") setZone(zone.id, { target_elevation_m: null, design_offset_m: 0 });
    else if (mode === "offset") setZone(zone.id, { target_elevation_m: null });
    else {
      // start a flat pad at the zone's current finished grade, or its latest scanned ground
      const cells = cellsOf(zone);
      const level = meanOver(surfaces.design, cells) ?? meanOver(surfaces.scans[surfaces.scans.length - 1], cells) ?? 0;
      setZone(zone.id, { target_elevation_m: Math.round(level * 1000) / 1000, design_offset_m: 0 });
    }
  };

  const issue = () => {
    if (!valid) return;
    const order = { ...meta, title: meta.title.trim(), requested_by: meta.requested_by.trim(), reason: meta.reason.trim() };
    onIssue((s) => issueChangeOrder(s, draft, diffSpecs(s, draft, nameOf), order));
  };

  return (
    <dialog
      ref={ref}
      className="confirm-dialog site-dialog co-dialog"
      aria-labelledby="co-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        noValidate // values are clamped as typed; the native step check would reject e.g. 2.3 cm
        onSubmit={(e) => {
          e.preventDefault();
          issue();
        }}
      >
        <h2 id="co-title">Job specs change order #{number}</h2>
        <div className="confirm-body">
          <p>Edit the specs below. Every change is logged under Change orders with what it was before.</p>

          <div className="co-meta">
            <label className="dialog-field co-meta-title">
              <span className="field-label">Title</span>
              <input ref={titleInput} value={meta.title} maxLength={80} placeholder="e.g. Raise building pad 150 mm" onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
            </label>
            <label className="dialog-field">
              <span className="field-label">Effective date</span>
              <input type="date" value={meta.date} required onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
            </label>
            <label className="dialog-field">
              <span className="field-label">Requested by</span>
              <input value={meta.requested_by} maxLength={80} placeholder="Owner, engineer…" onChange={(e) => setMeta({ ...meta, requested_by: e.target.value })} />
            </label>
          </div>
          <label className="dialog-field">
            <span className="field-label">Reason</span>
            <textarea rows={2} value={meta.reason} maxLength={1000} onChange={(e) => setMeta({ ...meta, reason: e.target.value })} />
          </label>

          <h3 className="co-section">Site specs</h3>
          <div className="co-site">
            <label className="dialog-field" data-changed={changed("design_id")}>
              <span className="field-label">{SPEC_LABEL.design_id}</span>
              <select value={draft.design_id ?? ""} onChange={(e) => setDraft({ ...draft, design_id: e.target.value || null })}>
                <option value="">None</option>
                {designs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="dialog-field" data-changed={changed("tolerance_m")}>
              <span className="field-label">{SPEC_LABEL.tolerance_m}</span>
              <span className="js-input">
                <input
                  type="number"
                  className="fig"
                  min={0}
                  max={200}
                  step={0.5}
                  value={Math.round(draft.tolerance_m * 1000) / 10}
                  onChange={(e) =>
                    Number.isFinite(e.target.valueAsNumber) &&
                    setDraft({ ...draft, tolerance_m: Math.min(2, Math.max(0.001, e.target.valueAsNumber / 100)) })
                  }
                />
                <span className="unit">cm</span>
              </span>
            </label>
          </div>

          <h3 className="co-section">Zone specs</h3>
          {site.zones.length === 0 ? (
            <p className="panel-note">No zones yet. Draw one on the map to give it its own grade and dates.</p>
          ) : (
            <div className="zone-table-wrap">
              <table className="zone-table co-zones">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>{SPEC_LABEL.grade}</th>
                    <th>{SPEC_LABEL.start}</th>
                    <th>{SPEC_LABEL.finish}</th>
                  </tr>
                </thead>
                <tbody>
                  {site.zones.map((zone) => {
                    const spec = draft.zones.find((z) => z.id === zone.id)!;
                    const mode = modes[zone.id] ?? gradeMode(spec);
                    const name = (
                      <td>
                        <span className="zone-name">
                          <i style={{ background: zone.color }} />
                          {zone.name}
                        </span>
                      </td>
                    );
                    if (zone.kind === "stockpile")
                      return (
                        <tr key={zone.id}>
                          {name}
                          <td colSpan={3} className="co-na">
                            Stockpile: measured against the original ground, so it has no grade or schedule
                          </td>
                        </tr>
                      );
                    return (
                      <tr key={zone.id}>
                        {name}
                        <td data-changed={changed("grade", zone.id)}>
                          <span className="co-grade">
                            <select value={mode} aria-label={`Finished grade of ${zone.name}`} onChange={(e) => setMode(zone, e.target.value as GradeMode)}>
                              {GRADE_MODES.map(([m, label]) => (
                                <option key={m} value={m} disabled={m === "offset" && !draft.design_id}>
                                  {label}
                                </option>
                              ))}
                            </select>
                            {mode !== "design" && (
                              <span className="js-input">
                                <input
                                  type="number"
                                  className="fig"
                                  step={mode === "flat" ? 0.001 : 0.01}
                                  aria-label={mode === "flat" ? `Pad elevation of ${zone.name}` : `Offset from design for ${zone.name}`}
                                  value={mode === "flat" ? spec.target_elevation_m ?? "" : spec.design_offset_m}
                                  onChange={(e) => {
                                    const v = e.target.valueAsNumber;
                                    if (!Number.isFinite(v)) return;
                                    setZone(zone.id, mode === "flat" ? { target_elevation_m: v } : { design_offset_m: Math.min(50, Math.max(-50, v)) });
                                  }}
                                />
                                <span className="unit">m</span>
                              </span>
                            )}
                          </span>
                        </td>
                        <td data-changed={changed("start", zone.id)}>
                          <input type="date" value={spec.start ?? ""} aria-label={`Planned start of ${zone.name}`} onChange={(e) => setZone(zone.id, { start: e.target.value || null })} />
                        </td>
                        <td data-changed={changed("finish", zone.id)}>
                          <input type="date" value={spec.finish ?? ""} aria-label={`Planned finish of ${zone.name}`} onChange={(e) => setZone(zone.id, { finish: e.target.value || null })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="co-section">
            Changes <span className="site-card-note">{changes.length || "none yet"}</span>
          </h3>
          {changes.length > 0 && (
            <ul className="co-change-list">
              {changes.map((c) => (
                <li key={c.field + c.zone_id}>
                  <span className="co-change-what">
                    {c.zone_name ? `${c.zone_name} · ` : ""}
                    {SPEC_LABEL[c.field]}
                  </span>
                  <span className="co-before">{c.before}</span>
                  <span aria-hidden="true">→</span>
                  <span className="co-after">{c.after}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-btn compact" disabled={!valid} title={valid ? undefined : changes.length ? "Give the change order a title" : "Change at least one spec"}>
            Issue change order #{number}
          </button>
        </div>
      </form>
    </dialog>
  );
}
