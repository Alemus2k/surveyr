import { useEffect, useRef, useState } from "react";
import {
  deleteControl,
  fetchControlCheck,
  fetchControlSets,
  importControl,
  type ColumnOrder,
  type ControlCheck,
  type ControlSetRef,
  type Unit,
} from "../api";
import type { ScanSettingsState } from "../adjust/useScanSettings";
import { UNITS } from "../adjust/units";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { Icon } from "../layout/icons";
import { loadPref, savePref } from "../lib/persist";
import { PanelSection } from "../panels/SidePanel";
import { cm, GRADE_LABEL, gradeAccuracy } from "./qa";

interface ControlPanelProps {
  projectId: string; // the scan being checked
  settings: ScanSettingsState; // where an elevation correction is saved
  siteControlId: string | null; // the site's control set, when the scan belongs to one
  tolerance: number; // m: the site's on-grade tolerance, or a default
  reloadKey: number; // bumps when the scan's settings change
}

const ORDERS: ReadonlyArray<[ColumnOrder, string]> = [
  ["PNEZD", "Point, Northing, Easting, Elevation, Description"],
  ["PENZD", "Point, Easting, Northing, Elevation, Description"],
  ["NEZ", "Northing, Easting, Elevation"],
  ["ENZ", "Easting, Northing, Elevation"],
];
const CONTROL_UNITS: Unit[] = ["us_ft", "ft", "m"];
const isString = (v: unknown): v is string => typeof v === "string";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Check a scan's elevations against surveyed check points, and correct a vertical offset. */
export function ControlPanel({ projectId, settings, siteControlId, tolerance, reloadKey }: ControlPanelProps) {
  const [sets, setSets] = useState<ControlSetRef[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => loadPref(`surveyr.control.${projectId}`, isString));
  const [check, setCheck] = useState<ControlCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<{ file: File | null; name: string; unit: Unit; order: ColumnOrder }>({
    file: null,
    name: "",
    unit: "us_ft",
    order: "PNEZD",
  });
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchControlSets().then(setSets, (e) => setError(message(e)));
  }, []);

  // the site's control set wins; otherwise this scan's last choice, else the first set
  const controlId =
    sets === null ? null : [siteControlId, chosen, sets[0]?.id].find((id) => id && sets.some((s) => s.id === id)) ?? null;

  useEffect(() => {
    setCheck(null);
    if (!controlId) return;
    let live = true;
    setError(null);
    fetchControlCheck(projectId, controlId).then(
      (c) => live && setCheck(c),
      (e) => live && setError(message(e))
    );
    return () => {
      live = false;
    };
  }, [projectId, controlId, reloadKey]);

  const choose = (id: string) => {
    setChosen(id);
    savePref(`surveyr.control.${projectId}`, id);
  };

  const doImport = async () => {
    if (!form.file) return;
    setBusy(true);
    setError(null);
    try {
      const created = await importControl(form.file, form.name.trim(), form.unit, form.order);
      setSets(await fetchControlSets());
      choose(created.id);
      setImporting(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!controlId) return;
    setBusy(true);
    try {
      await deleteControl(controlId);
      setSets(await fetchControlSets());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  };

  const current = settings.current?.settings;
  const offset = current?.z_offset_m ?? 0;
  const setOffset = (z: number) => current && settings.save({ ...current, z_offset_m: Math.round(z * 10000) / 10000 });
  const verdict = check ? gradeAccuracy(check.stats, tolerance) : null;
  const covered = check?.points.filter((p) => p.dz !== null).length ?? 0;
  const setName = sets?.find((s) => s.id === controlId)?.name;

  return (
    <>
      <PanelSection label="Check points">
        {sets && sets.length > 0 && !importing && (
          <div className="control-pick">
            <select
              value={controlId ?? ""}
              disabled={!!siteControlId}
              onChange={(e) => choose(e.target.value)}
              aria-label="Control set"
              title={siteControlId ? "Set by the job site (Site setup)" : undefined}
            >
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.count} pts)
                </option>
              ))}
            </select>
            <button className="tool-btn" onClick={() => setDeleting(true)} disabled={busy || !controlId} aria-label="Delete control set" title="Delete control set">
              <Icon name="trash" size={14} />
            </button>
          </div>
        )}
        {siteControlId && <p className="panel-note">Using the job site's check points (change them in Site setup).</p>}

        {importing ? (
          <div className="control-import">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,.xyz,.pnezd"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setForm((f) => ({ ...f, file, name: f.name || (file?.name.replace(/\.[^.]+$/, "") ?? "") }));
              }}
            />
            <label className="js-field">
              <span className="field-label">Name</span>
              <input value={form.name} maxLength={80} placeholder="e.g. Site control, Sept" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="js-field">
              <span className="field-label">Coordinates are in</span>
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>
                {CONTROL_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {UNITS.find((x) => x.id === u)?.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="js-field">
              <span className="field-label">Columns (if there's no header row)</span>
              <select value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value as ColumnOrder })}>
                {ORDERS.map(([id, label]) => (
                  <option key={id} value={id}>
                    {id} — {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="control-actions">
              <button className="secondary-btn" onClick={() => setImporting(false)} disabled={busy}>
                Cancel
              </button>
              <button className="primary-btn compact" onClick={doImport} disabled={busy || !form.file}>
                {busy ? "Importing…" : "Import"}
              </button>
            </div>
            <p className="panel-note">
              A CSV or text export from the surveyor's rover or total station. Use the same coordinate system as the
              scans, with points on open, hard ground that won't change.
            </p>
          </div>
        ) : (
          <button className="secondary-btn full" onClick={() => setImporting(true)}>
            <Icon name="plus" size={14} /> Import check points…
          </button>
        )}
        {sets && sets.length === 0 && !importing && (
          <p className="panel-note">
            No check points yet. Import the surveyor's points to see how accurate this scan's elevations are.
          </p>
        )}
        {error && <p className="panel-note error-text">{error}</p>}
      </PanelSection>

      {check && verdict && (
        <PanelSection label="Vertical accuracy">
          <div className={`accuracy-card ${verdict.grade}`} role="status">
            <span className="accuracy-grade">{GRADE_LABEL[verdict.grade]}</span>
            {check.stats.rmse !== null ? (
              <dl className="metric-list">
                <div className="metric-row">
                  <dt>RMSE</dt>
                  <dd className="fig">{cm(check.stats.rmse, false)}</dd>
                </div>
                <div className="metric-row">
                  <dt>Mean offset (bias)</dt>
                  <dd className="fig">{cm(check.stats.mean ?? 0)}</dd>
                </div>
                <div className="metric-row">
                  <dt>95% of ground within</dt>
                  <dd className="fig">±{cm(check.stats.ci95 ?? 0, false)}</dd>
                </div>
                <div className="metric-row">
                  <dt>Worst point</dt>
                  <dd className="fig">{cm(check.stats.max_abs ?? 0, false)}</dd>
                </div>
              </dl>
            ) : (
              <p className="panel-note">None of the {check.points.length} check points fall on this scan.</p>
            )}
            <p className="panel-note">
              {covered} of {check.points.length} points of “{setName}” are on the scan. Graded against a ±
              {cm(tolerance, false)} tolerance: good within half of it.
            </p>
          </div>

          {verdict.bias !== null && (
            <div className="notice-card warn" role="status">
              <p>
                This scan sits <strong>{cm(Math.abs(verdict.bias), false)} {verdict.bias > 0 ? "high" : "low"}</strong>{" "}
                against the check points — a consistent offset, typically a base-station height or datum mix-up. Its
                volumes will be off until it's corrected.
              </p>
              <button className="primary-btn compact" disabled={settings.saving} onClick={() => setOffset(offset - verdict.bias!)}>
                {verdict.bias > 0 ? "Lower" : "Raise"} this scan by {cm(Math.abs(verdict.bias), false)}
              </button>
            </div>
          )}
          {offset !== 0 && (
            <div className="notice-card ok">
              <p>
                Elevation correction applied: <strong className="fig">{cm(offset)}</strong>. The scan file is unchanged.
              </p>
              <button className="text-btn" disabled={settings.saving} onClick={() => setOffset(0)}>
                Remove correction
              </button>
            </div>
          )}
        </PanelSection>
      )}

      {check && check.points.length > 0 && (
        <PanelSection label="Points">
          <table className="control-table">
            <thead>
              <tr>
                <th>Point</th>
                <th className="num">Scan − survey</th>
              </tr>
            </thead>
            <tbody>
              {check.points.map((p) => (
                <tr key={p.id} title={p.dz === null ? "No scan points within 2 m" : `${p.neighbours} scan points within ${p.radius_m} m`}>
                  <td>
                    <span className="fig">{p.id}</span> {p.desc && <span className="control-desc">{p.desc}</span>}
                  </td>
                  <td className={`num fig ${p.dz === null ? "faint" : Math.abs(p.dz) > tolerance ? "bad" : Math.abs(p.dz) > tolerance / 2 ? "warn" : ""}`}>
                    {p.dz === null ? "not on scan" : cm(p.dz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel-note">
            Positive means the scan is above the surveyed point. Each scan height is a plane fitted to the LiDAR points
            around the check point. A formal accuracy statement (e.g. ASPRS) needs 20 or more well-spread points.
          </p>
        </PanelSection>
      )}

      <ConfirmDialog
        open={deleting}
        title={`Delete “${setName ?? ""}”?`}
        confirmLabel="Move to Trash"
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => setDeleting(false)}
      >
        <p>The check points file is moved to the Trash. Scans and their corrections aren't affected.</p>
      </ConfirmDialog>
    </>
  );
}
