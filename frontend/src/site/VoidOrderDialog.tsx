import { useEffect, useMemo, useRef, useState } from "react";
import { todayIso } from "./dates";
import { planVoid, SPEC_LABEL } from "./specs";
import type { ChangeOrder, Site, VoidRecord } from "./types";

interface VoidOrderDialogProps {
  site: Site;
  order: ChangeOrder | null; // the order to void; null = closed
  nameOf: (id: string) => string;
  onVoid: (number: number, meta: Pick<VoidRecord, "date" | "reason" | "voided_by">) => void;
  onCancel: () => void;
}

/** Void a change order: preview which specs go back and which a later order keeps, then confirm with a reason. */
export function VoidOrderDialog({ site, order, nameOf, onVoid, onCancel }: VoidOrderDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [meta, setMeta] = useState({ date: todayIso(), reason: "", voided_by: "" });
  const open = order !== null;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setMeta({ date: todayIso(), reason: "", voided_by: "" });
      dlg.showModal();
      requestAnimationFrame(() => reasonInput.current?.focus());
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  const plan = useMemo(() => (order ? planVoid(site, order.number, nameOf) : null), [site, order]);
  const valid = meta.reason.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(meta.date);

  return (
    <dialog
      ref={ref}
      className="confirm-dialog site-dialog co-dialog co-void-dialog"
      aria-labelledby="void-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (order && valid) onVoid(order.number, { date: meta.date, reason: meta.reason.trim(), voided_by: meta.voided_by.trim() });
        }}
      >
        <h2 id="void-title">
          Void CO #{order?.number}: {order?.title}
        </h2>
        <div className="confirm-body">
          <p>
            The specs it changed go back to what they'd be if it had never been issued. It stays in the log marked void.
            A void can't be undone; issue a new change order instead.
          </p>

          <div className="co-meta co-void-meta">
            <label className="dialog-field">
              <span className="field-label">Effective date</span>
              <input type="date" value={meta.date} onChange={(e) => setMeta({ ...meta, date: e.target.value })} />
            </label>
            <label className="dialog-field">
              <span className="field-label">Voided by</span>
              <input value={meta.voided_by} maxLength={80} placeholder="Owner, engineer…" onChange={(e) => setMeta({ ...meta, voided_by: e.target.value })} />
            </label>
          </div>
          <label className="dialog-field">
            <span className="field-label">Reason (required)</span>
            <textarea ref={reasonInput} rows={2} value={meta.reason} maxLength={1000} onChange={(e) => setMeta({ ...meta, reason: e.target.value })} />
          </label>

          {plan && (
            <>
              <h3 className="co-section">
                Restored <span className="site-card-note">{plan.restored.length || "nothing to change back"}</span>
              </h3>
              {plan.restored.length > 0 && (
                <ul className="co-change-list">
                  {plan.restored.map((c) => (
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
              {plan.kept.length > 0 && (
                <>
                  <h3 className="co-section">
                    Left as is <span className="site-card-note">{plan.kept.length}</span>
                  </h3>
                  <ul className="co-kept-list">
                    {plan.kept.map((k) => (
                      <li key={k.field + k.zone_id}>
                        <span className="co-change-what">
                          {k.zone_name ? `${k.zone_name} · ` : ""}
                          {SPEC_LABEL[k.field]}
                        </span>
                        <span>{k.by_number ? `changed again by CO #${k.by_number}, which stays in effect` : "the zone has been deleted"}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="danger-btn" disabled={!valid} title={valid ? undefined : "Give a reason for the void"}>
            Void CO #{order?.number}
          </button>
        </div>
      </form>
    </dialog>
  );
}
