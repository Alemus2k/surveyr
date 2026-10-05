import { useEffect, useRef, useState } from "react";
import type { ProjectRef } from "../api";

interface NewComparisonDialogProps {
  open: boolean;
  projects: ProjectRef[]; // scans that can become layers
  initial: string | null; // pre-ticked scan (the one currently open), if any
  busy: boolean;
  onCreate: (name: string, projectIds: string[]) => void;
  onCancel: () => void;
}

/** Pick a name and the scans to overlay. */
export function NewComparisonDialog({ open, projects, initial, busy, onCreate, onCancel }: NewComparisonDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("Comparison");
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setName("Comparison");
      setPicked(initial && projects.some((p) => p.id === initial) ? [initial] : []);
      dlg.showModal();
      requestAnimationFrame(() => nameInput.current?.select());
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open, projects, initial]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const valid = name.trim().length > 0 && picked.length > 0;

  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="new-compare-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onCreate(name.trim(), projects.filter((p) => picked.includes(p.id)).map((p) => p.id));
        }}
      >
        <h2 id="new-compare-title">New comparison</h2>
        <div className="confirm-body">
          <p>Overlay scans to compare repeat passes or place one on another. The scans themselves aren't changed.</p>
          <label className="dialog-field">
            <span className="field-label">Name</span>
            <input ref={nameInput} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <fieldset className="dialog-checks">
            <legend className="field-label">Layers</legend>
            {projects.map((p) => (
              <label key={p.id}>
                <input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary-btn compact" disabled={!valid || busy}>
            {busy ? "Creating…" : `Create with ${picked.length} layer${picked.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </dialog>
  );
}
