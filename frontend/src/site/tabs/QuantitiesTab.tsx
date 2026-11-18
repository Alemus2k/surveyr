import { useState } from "react";
import { formatArea, formatThickness, formatTonnage, formatVolume, quantityText } from "../../lib/units";
import { formatDate } from "../dates";
import { LayersSection } from "./quantities/LayersSection";
import { useLayers, usePiles, usePonds } from "./quantities/model";
import { PondSection } from "./quantities/PondSection";
import { StockpilesSection } from "./quantities/StockpilesSection";
import "./quantities/quantities.css";
import type { SiteTabProps } from "./types";

type Section = "layers" | "stockpiles" | "pond";

/** Pay quantities beyond bulk earthworks: layers placed, stockpiles by material, pond storage. */
export function QuantitiesTab(props: SiteTabProps) {
  const { surfaces, scan } = props;
  const [section, setSection] = useState<Section>("layers");
  const layers = useLayers(props);
  const piles = usePiles(props);
  const ponds = usePonds(props);

  // ---- the short answer first
  const measured = layers.filter((l) => l.measure);
  const layerTonnes = measured.reduce((s, l) => s + (l.measure!.tonnes ?? 0), 0);
  const layerVolume = measured.reduce((s, l) => s + l.measure!.volume, 0);
  const allWeighed = measured.length > 0 && measured.every((l) => l.measure!.tonnes !== null);
  const thin = measured.filter((l) => l.measure!.thinArea > 0);
  const thinArea = thin.reduce((s, l) => s + l.measure!.thinArea, 0);
  const pileTonnes = piles.piles.reduce((s, p) => s + (p.tonnes ?? 0), 0);
  const pileVolume = piles.piles.reduce((s, p) => s + p.volume, 0);
  const unweighed = piles.piles.filter((p) => p.volume > 0 && p.tonnes === null).length;
  const pond = ponds.find((p) => p.built) ?? null;
  const when = formatDate(surfaces.dates[scan], true);

  const tile = (id: Section, className: string, label: string, value: string, sub: string) => (
    <button className={`kpi q-kpi ${className}`} aria-pressed={section === id} onClick={() => setSection(id)}>
      <span className="kpi-label">{label}</span>
      <strong className="fig">{value}</strong>
      <span className="kpi-sub">{sub}</span>
    </button>
  );

  return (
    <>
      <div className="site-kpis">
        {tile(
          "layers",
          "",
          "Placed in layers",
          !measured.length ? "—" : allWeighed ? quantityText(formatTonnage(layerTonnes)) : quantityText(formatVolume(layerVolume)),
          !layers.length ? "draw a base course or paving area" : !measured.length ? `nothing measured at ${when}` : `${measured.map((l) => l.layer.name).join(", ")} · at ${when}`
        )}
        {tile(
          "layers",
          thin.length ? "bad" : "",
          "Too thin",
          measured.length ? quantityText(formatArea(thinArea)) : "—",
          thin.length
            ? thin.map((l) => `${l.layer.name}: under ${formatThickness(l.layer.target_thickness_m - l.layer.tolerance_m)}`).join(" · ")
            : measured.length
              ? "every layer is thick enough"
              : "checked once a layer is measured"
        )}
        {tile(
          "stockpiles",
          "",
          "Stockpiled on site",
          !piles.piles.length ? "—" : unweighed || pileTonnes === 0 ? quantityText(formatVolume(pileVolume)) : quantityText(formatTonnage(pileTonnes)),
          !piles.piles.length
            ? "add a stockpile zone"
            : `${piles.piles.length} pile${piles.piles.length === 1 ? "" : "s"}${unweighed ? ` · ${unweighed} without a material` : ` · ${quantityText(formatVolume(pileVolume))}`}`
        )}
        {tile(
          "pond",
          pond?.pctOfDesign != null && pond.pctOfDesign < 98 ? "warn" : "",
          "Pond storage",
          pond?.pctOfDesign != null ? `${pond.pctOfDesign.toFixed(0)}%` : pond?.built ? quantityText(formatVolume(pond.built.storage)) : "—",
          !pond ? "set up a detention pond" : pond.pctOfDesign != null ? "of the design volume, below the outlet" : "held below the outlet"
        )}
      </div>

      <div className="segmented q-sections" role="tablist" aria-label="Quantity">
        {(
          [
            ["layers", "Layers"],
            ["stockpiles", "Stockpiles"],
            ["pond", "Pond storage"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={section === id} aria-pressed={section === id} onClick={() => setSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {section === "layers" && <LayersSection {...props} results={layers} />}
      {section === "stockpiles" && <StockpilesSection {...props} {...piles} />}
      {section === "pond" && <PondSection {...props} results={ponds} />}
    </>
  );
}
