import { useEffect, useRef, useState } from "react";
import type { ProjectRef } from "../api";
import { dateInName } from "./dates";
import type { SiteScan } from "./types";

interface NewSiteDialogProps {
  open: boolean;
  projects: ProjectRef[]; // scans that can join a site
  busy: boolean;
  onCreate: (name: string, scans: SiteScan[], designId: string | null) => void;
  onCancel: () => void;
}

/** Name a site, pick its dated scans and (optionally) its design surface. */
export function NewSiteDialog({ open, projects, busy, onCreate, onCancel }: NewSiteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("New site");
  const [dates, setDates] = useState<Record<string, string>>({}); // picked scan id -> date
  const [design, setDesign] = useState("");

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setName("New site");
      setDates({});
      setDesign("");
      dlg.showModal();
      requestAnimationFrame(() => nameInput.current?.select());
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const toggle = (id: string) =>
    setDates((d) => {
      const next = { ...d };
      if (id in next) delete next[id];
      else next[id] = dateInName(id) ?? "";
      return next;
    });
  const picked = Object.keys(dates);
  const valid = name.trim().length > 0 && picked.length > 0 && picked.every((id) => /^\d{4}-\d{2}-\d{2}$/.test(dates[id]));

  return (
    <dialog
      ref={ref}
      className="confirm-dialog site-dialog"
      aria-labelledby="new-site-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate(name.trim(), picked.map((id) => ({ project_id: id, date: dates[id] })), design || null);
        }}
      >
        <h2 id="new-site-title">New job site</h2>
        <div className="confirm-body">
          <p>
            Track construction progress from repeat scans of one site. Pick each flight and the date it was captured;
            scans must share a coordinate system.
          </p>
          <label className="dialog-field">
            <span className="field-label">Site name</span>
            <input ref={nameInput} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="dialog-checks site-dialog-scans">
            <legend className="field-label">Scans and capture dates</legend>
            {projects
              .filter((p) => p.id !== design)
              .map((p) => (
                <div key={p.id} className="site-dialog-row">
                  <label>
                    <input type="checkbox" checked={p.id in dates} onChange={() => toggle(p.id)} />
                    {p.name}
                  </label>
                  {p.id in dates && (
                    <input
                      type="date"
                      value={dates[p.id]}
                      required
                      aria-label={`Capture date of ${p.name}`}
                      onChange={(e) => setDates((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                  )}
                </div>
              ))}
          </fieldset>
          <label className="dialog-field">
            <span className="field-label">Design surface (finished grade)</span>
            <select value={design} onChange={(e) => setDesign(e.target.value)}>
              <option value="">None yet</option>
              {projects
                .filter((p) => !(p.id in dates))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary-btn compact" disabled={!valid || busy}>
            {busy ? "Creating…" : `Create with ${picked.length} scan${picked.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
