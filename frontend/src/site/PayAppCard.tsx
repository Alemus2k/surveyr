import { useState } from "react";
import { Icon } from "../layout/icons";
import { formatVolume } from "../lib/format";
import { formatDate } from "./dates";
import type { PayAppCheck } from "./progress";
import type { PayApp, Zone } from "./types";

interface PayAppCardProps {
  checks: PayAppCheck[];
  zones: Zone[];
  periodEnds: string[]; // scan dates that close a measurable period (all but the first)
  overbillPct: number;
  onAdd: (pa: PayApp) => void;
  onRemove: (id: string) => void;
}

const v = (m3: number) => formatVolume(m3).value;

/** Contractor quantity claims next to what the scans measured for the same period and zone. */
export function PayAppCard({ checks, zones, periodEnds, overbillPct, onAdd, onRemove }: PayAppCardProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ date: "", zone: "", kind: "cut" as "cut" | "fill", claimed: "", contractor: "" });
  const zoneName = (id: string | null) => (id ? zones.find((z) => z.id === id)?.name ?? "deleted zone" : "Whole site");
  const flagged = checks.filter((c) => c.flagged);
  const overClaim = flagged.reduce((sum, c) => sum + Math.max(c.diff ?? 0, 0), 0);
  const lastContractor = checks[checks.length - 1]?.payApp.contractor ?? "";

  const startAdding = () => {
    setDraft({ date: periodEnds[periodEnds.length - 1] ?? "", zone: zones[0]?.id ?? "", kind: "cut", claimed: "", contractor: lastContractor });
    setAdding(true);
  };
  const claimed = Number(draft.claimed);
  const valid = draft.date !== "" && draft.claimed !== "" && Number.isFinite(claimed) && claimed >= 0;
  const add = () => {
    if (!valid) return;
    onAdd({
      id: `pa${Date.now().toString(36)}`,
      date: draft.date,
      zone_id: draft.zone || null,
      kind: draft.kind,
      claimed_m3: claimed,
      contractor: draft.contractor.trim(),
      note: "",
    });
    setAdding(false);
  };

  return (
    <>
      {checks.length > 0 && (
        <p className={`payapp-summary ${flagged.length ? "bad" : "good"}`}>
          {flagged.length
            ? `${flagged.length} claim${flagged.length === 1 ? "" : "s"} more than ${overbillPct}% above measured — ${v(overClaim)} m³ over in total.`
            : `All ${checks.length} claims are within ${overbillPct}% of what the scans measured.`}
        </p>
      )}
      {checks.length > 0 && (
        <div className="zone-table-wrap">
          <table className="zone-table payapp-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Zone · work</th>
                <th className="num">Claimed</th>
                <th className="num">Measured</th>
                <th className="num">Difference</th>
                <th aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.payApp.id} data-flagged={c.flagged || undefined}>
                  <td className="fig">
                    {c.fromDate ? `${formatDate(c.fromDate, true)} → ` : ""}
                    {formatDate(c.payApp.date, true)}
                  </td>
                  <td>
                    {zoneName(c.payApp.zone_id)} · {c.payApp.kind === "cut" ? "dug" : "filled"}
                    {c.payApp.contractor && <span className="payapp-who">{c.payApp.contractor}</span>}
                  </td>
                  <td className="num fig">{v(c.payApp.claimed_m3)} m³</td>
                  <td className="num fig">{c.measured === null ? "—" : `${v(c.measured)} m³`}</td>
                  <td className={`num fig ${c.flagged ? "late" : ""}`}>
                    {c.diff === null
                      ? "no scans"
                      : `${c.diff >= 0 ? "+" : "−"}${v(Math.abs(c.diff))} m³${c.diffPct === null ? "" : ` (${c.diffPct >= 0 ? "+" : "−"}${Math.abs(c.diffPct).toFixed(0)}%)`}`}
                    {c.flagged && <span className="status-chip bad">Check</span>}
                  </td>
                  <td>
                    <button className="tool-btn" onClick={() => onRemove(c.payApp.id)} aria-label="Remove claim" title="Remove claim">
                      <Icon name="trash" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? (
        <div className="payapp-form">
          <label className="js-field">
            <span className="field-label">Period ending</span>
            <select value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })}>
              {periodEnds.map((d) => (
                <option key={d} value={d}>
                  scan of {formatDate(d)}
                </option>
              ))}
            </select>
          </label>
          <label className="js-field">
            <span className="field-label">Zone</span>
            <select value={draft.zone} onChange={(e) => setDraft({ ...draft, zone: e.target.value })}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
              <option value="">Whole site</option>
            </select>
          </label>
          <label className="js-field">
            <span className="field-label">Work</span>
            <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "cut" | "fill" })}>
              <option value="cut">Excavation (cut)</option>
              <option value="fill">Fill placed</option>
            </select>
          </label>
          <label className="js-field">
            <span className="field-label">Claimed</span>
            <span className="js-input">
              <input type="number" className="fig" min={0} step={1} value={draft.claimed} onChange={(e) => setDraft({ ...draft, claimed: e.target.value })} />
              <span className="unit">m³</span>
            </span>
          </label>
          <label className="js-field payapp-wide">
            <span className="field-label">Contractor</span>
            <input value={draft.contractor} maxLength={80} onChange={(e) => setDraft({ ...draft, contractor: e.target.value })} />
          </label>
          <div className="payapp-actions">
            <button className="secondary-btn" onClick={() => setAdding(false)}>
              Cancel
            </button>
            <button className="primary-btn compact" onClick={add} disabled={!valid}>
              Add claim
            </button>
          </div>
        </div>
      ) : (
        <button className="secondary-btn" onClick={startAdding} disabled={periodEnds.length === 0}>
          <Icon name="plus" size={14} /> Add claim
        </button>
      )}
      <p className="panel-note">
        Measured volumes are the change between the claim's scan and the one before it, within the zone, ignoring
        changes smaller than the change threshold. Cut is bank volume; fill is compacted.
      </p>
    </>
  );
}
