import { formatVolume } from "../lib/format";
import type { DirtLedger, Haul, Volumes } from "./earthworks";

interface DirtLedgerCardProps {
  volumes: Volumes;
  haul: Haul;
  ledger: DirtLedger;
  truckM3: number;
  shrinkPct: number;
}

const v = (m3: number) => {
  const q = formatVolume(m3);
  return (
    <>
      {q.value} <span className="unit">{q.unit}</span>
    </>
  );
};

/**
 * The dug-out soil's journey: fill the depressions first, then what's left
 * over goes off site (or what's missing comes in). Volumes are in the ground
 * (bank) unless marked loose.
 */
export function DirtLedgerCard({ volumes, haul, ledger, truckM3, shrinkPct }: DirtLedgerCardProps) {
  const surplus = ledger.leftOver > 0 && haul.direction !== "balanced";
  const short = ledger.shortfall > 0 && haul.direction !== "balanced";

  return (
    <div className="ledger">
      <div className="ledger-bar" role="img" aria-label={`${ledger.usedPct.toFixed(0)}% of dug soil fills the depressions`}>
        <span className="ledger-used" style={{ width: `${ledger.usedPct}%` }} />
        <span className="ledger-left" style={{ width: `${100 - ledger.usedPct}%` }} />
      </div>
      <div className="ledger-key">
        <span>
          <i className="ledger-used" /> Fills depressions
        </span>
        <span>
          <i className="ledger-left" /> Left over
        </span>
      </div>

      <dl className="ledger-rows">
        <div>
          <dt>Dug out (cut)</dt>
          <dd className="mono">{v(volumes.cut)}</dd>
        </div>
        <div>
          <dt>− Used to fill depressions</dt>
          <dd className="mono">{v(ledger.usedForFill)}</dd>
        </div>
        <div className="ledger-sub">
          <dt>compacts to</dt>
          <dd className="mono">{v(ledger.usedForFill * (1 - shrinkPct / 100))}</dd>
        </div>
        <div className="ledger-total">
          <dt>{short ? "= Short — bring in" : "= Left over to remove"}</dt>
          <dd className="mono">{v(short ? ledger.shortfall : surplus ? ledger.leftOver : 0)}</dd>
        </div>
        {(surplus || short) && (
          <>
            <div className="ledger-sub">
              <dt>loose in trucks</dt>
              <dd className="mono">{v(haul.loose)}</dd>
            </div>
            <div className="ledger-sub">
              <dt>truckloads ({truckM3} m³)</dt>
              <dd className="mono">{haul.loads.toLocaleString("en-GB")}</dd>
            </div>
          </>
        )}
      </dl>
      {!surplus && !short && <p className="panel-note">Everything dug out goes back into the depressions — nothing to truck.</p>}
    </div>
  );
}
