import { useState } from "react";
import { formatDate } from "./dates";
import { canVoid, SPEC_LABEL, voidChangeOrder } from "./specs";
import type { ChangeOrder, Site, SpecChange } from "./types";
import { VoidOrderDialog } from "./VoidOrderDialog";

interface ChangeOrderLogProps {
  site: Site;
  nameOf: (id: string) => string; // scan id → display name
  onUpdate: (change: (s: Site) => Site) => void;
  onNew: () => void;
}

const loggedAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

function ChangeTable({ changes, firstColumn = "Spec" }: { changes: SpecChange[]; firstColumn?: string }) {
  return (
    <div className="zone-table-wrap">
      <table className="zone-table co-changes">
        <thead>
          <tr>
            <th>{firstColumn}</th>
            <th>Applies to</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.field + c.zone_id}>
              <td>{SPEC_LABEL[c.field]}</td>
              <td>{c.zone_name ?? "Whole site"}</td>
              <td className="co-before">{c.before}</td>
              <td className="co-after">{c.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Every change order issued on a site, newest first, with each spec before and after; voided ones stay, marked. */
export function ChangeOrderLog({ site, nameOf, onUpdate, onNew }: ChangeOrderLogProps) {
  const [voiding, setVoiding] = useState<ChangeOrder | null>(null);
  const orders = site.change_orders ?? [];

  if (orders.length === 0)
    return (
      <div className="co-empty">
        <p>No change orders yet. Specs are revised with a change order so there's a record of what changed, when and why.</p>
        <button className="primary-btn compact" onClick={onNew}>
          Job specs change order
        </button>
      </div>
    );
  return (
    <>
      <ol className="co-log">
        {[...orders].sort((a, b) => b.number - a.number).map((co) => {
          const v = co.voided;
          return (
            <li key={co.id} className="site-card co-card" data-voided={v ? true : undefined}>
              <header className="co-card-head">
                <span className="co-number mono">CO #{co.number}</span>
                {v && <span className="co-void-badge">Void</span>}
                <h3 className="co-card-title">{co.title}</h3>
                <span className="co-card-meta">
                  Effective {formatDate(co.date)}
                  {co.requested_by && ` · requested by ${co.requested_by}`} · logged {loggedAt(co.created_at)}
                </span>
                {!v && (
                  <button
                    className="secondary-btn co-void-btn"
                    disabled={!canVoid(co)}
                    title={canVoid(co) ? "Undo this order's spec changes; it stays in the log as void" : "Logged before voids existed: its exact values weren't stored. Issue a new change order instead."}
                    onClick={() => setVoiding(co)}
                  >
                    Void…
                  </button>
                )}
              </header>
              {co.reason && <p className="co-reason">{co.reason}</p>}
              <ChangeTable changes={co.changes} />
              {v && (
                <div className="co-void-record">
                  <p>
                    <strong>Voided</strong> effective {formatDate(v.date)}
                    {v.voided_by && ` by ${v.voided_by}`} · logged {loggedAt(v.voided_at)}
                  </p>
                  <p className="co-reason">{v.reason}</p>
                  {v.restored.length > 0 ? (
                    <ChangeTable changes={v.restored} firstColumn="Restored" />
                  ) : (
                    <p className="panel-note">No specs needed changing back.</p>
                  )}
                  {v.kept.length > 0 && (
                    <ul className="co-kept-list">
                      {v.kept.map((k) => (
                        <li key={k.field + k.zone_id}>
                          <span className="co-change-what">
                            {k.zone_name ? `${k.zone_name} · ` : ""}
                            {SPEC_LABEL[k.field]}
                          </span>
                          <span>{k.by_number ? `left as is: changed again by CO #${k.by_number}` : "left as is: the zone had been deleted"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <VoidOrderDialog
        site={site}
        order={voiding}
        nameOf={nameOf}
        onCancel={() => setVoiding(null)}
        onVoid={(number, meta) => {
          onUpdate((s) => voidChangeOrder(s, number, meta, nameOf));
          setVoiding(null);
        }}
      />
    </>
  );
}
