import { useEffect, useRef, useState } from "react";
import { useUnitSystem } from "../lib/units";
import { formatDate } from "../site/dates";
import {
  exportScan,
  exportSite,
  exportUnitFor,
  fetchExportFolder,
  FORMAT_INFO,
  intervalChoices,
  revealExport,
  type ExportOptions,
  type ExportResult,
  type ExportUnit,
  type SiteExportFormat,
} from "./api";

/** What is being exported: one scan, or a job site (with its flights and zones). */
export type ExportTarget =
  | { kind: "scan"; id: string; name: string }
  | {
      kind: "site";
      id: string;
      name: string;
      flights: { id: string; date: string }[]; // oldest first
      zones: { id: string; name: string }[];
      hasDesign: boolean;
      scan: string | null; // flight picked on the timeline (null = latest)
    };

interface ExportDialogProps {
  open: boolean;
  target: ExportTarget | null;
  onClose: () => void;
}

const UNITS: ReadonlyArray<[ExportUnit, string]> = [
  ["us_ft", "US survey feet"],
  ["ft", "International feet"],
  ["m", "Metres"],
];
// spacing for CSV points / DXF spot elevations: metres, labelled per unit system
const SPACINGS: Record<"us" | "metric", ReadonlyArray<[number, string]>> = {
  us: [[3.048, "10 ft"], [7.62, "25 ft"], [15.24, "50 ft"], [30.48, "100 ft"]],
  metric: [[2, "2 m"], [5, "5 m"], [10, "10 m"], [25, "25 m"]],
};
const SCAN_FORMATS: SiteExportFormat[] = ["dxf", "landxml", "csv", "asc", "las"];
const SITE_FORMATS: SiteExportFormat[] = ["dxf", "landxml", "csv", "asc", "las", "geojson", "progress"];
const USES_SURFACE: SiteExportFormat[] = ["dxf", "landxml", "csv", "asc"]; // can export the design instead of a flight
const USES_UNITS: SiteExportFormat[] = ["dxf", "landxml", "csv", "asc", "las"];

const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Export a scan or a job site to a file for CAD, survey, GIS or project-management software. */
export function ExportDialog({ open, target, onClose }: ExportDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const system = useUnitSystem();
  const [format, setFormat] = useState<SiteExportFormat>("dxf");
  const [unit, setUnit] = useState<ExportUnit>(exportUnitFor(system));
  const [surface, setSurface] = useState<string>(""); // "" = picked flight, "design", or a flight id
  const [interval, setInterval] = useState<number | null>(null);
  const [spacing, setSpacing] = useState<number | null>(null);
  const [spots, setSpots] = useState(true);
  const [zone, setZone] = useState("");
  const [compressed, setCompressed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(null);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setResult(null);
      setError(null);
      setUnit(exportUnitFor(system));
      setSurface(target?.kind === "site" ? target.scan ?? "" : "");
      dlg.showModal();
      fetchExportFolder().then(setFolder, () => setFolder(null));
    } else if (!open && dlg.open) dlg.close();
  }, [open]);

  if (!target) return <dialog ref={ref} className="confirm-dialog" />;
  const formats = target.kind === "site" ? SITE_FORMATS : SCAN_FORMATS;
  const site = target.kind === "site" ? target : null;
  const latest = site ? site.flights[site.flights.length - 1] : null;

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const options: ExportOptions = {};
    if (USES_UNITS.includes(format)) options.unit = unit;
    if (site && format !== "geojson" && format !== "progress") {
      const s = surface || site.scan || null;
      options.scan = format === "las" && s === "design" ? null : s; // LAS is points: always a flight
    }
    if (format === "dxf") {
      options.interval_m = interval;
      options.spots = spots;
      options.spacing_m = spacing;
    }
    if (format === "csv") {
      options.spacing_m = spacing;
      if (zone) options.zone_id = zone;
    }
    if (format === "las") options.compressed = compressed;
    try {
      setResult(site ? await exportSite(site.id, format, options) : await exportScan(target.id, format as never, options));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const summary = (r: ExportResult): string => {
    if (format === "dxf") return `${Object.values(r.entities ?? {}).reduce((a, b) => a + b, 0).toLocaleString()} drawing entities`;
    if (format === "landxml") return `${(r.triangles ?? 0).toLocaleString()} triangles`;
    if (format === "csv" || format === "las") return `${(r.points ?? 0).toLocaleString()} points`;
    if (format === "geojson") return `${r.features ?? 0} shapes${r.wgs84 ? ", plus a latitude/longitude copy" : ""}`;
    if (format === "progress") return `${r.zones ?? 0} zones × ${r.flights ?? 0} flights`;
    return r.note ?? "";
  };

  return (
    <dialog
      ref={ref}
      className="confirm-dialog export-dialog"
      aria-labelledby="export-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <h2 id="export-title">Export {target.name}</h2>
        <div className="confirm-body">
          <fieldset className="export-formats">
            <legend className="field-label">What do you need?</legend>
            {formats.map((f) => (
              <label key={f} className="export-format" data-active={f === format || undefined}>
                <input type="radio" name="format" checked={f === format} onChange={() => setFormat(f)} />
                <span>
                  <strong>{FORMAT_INFO[f].label}</strong>
                  <span className="export-format-who">{FORMAT_INFO[f].forWhom}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="export-options">
            {site && format !== "geojson" && format !== "progress" && (
              <label className="js-field">
                <span className="field-label">{format === "las" ? "Flight" : "Surface"}</span>
                <select value={surface} onChange={(e) => setSurface(e.target.value)}>
                  <option value="">{site.scan ? `Flight picked on the timeline` : `Latest flight (${formatDate(latest!.date, true)})`}</option>
                  {site.hasDesign && USES_SURFACE.includes(format) && <option value="design">Design (finished grade)</option>}
                  {[...site.flights].reverse().map((f) => (
                    <option key={f.id} value={f.id}>
                      Flight of {formatDate(f.date)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {USES_UNITS.includes(format) && (
              <label className="js-field">
                <span className="field-label">Coordinates and elevations in</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value as ExportUnit)}>
                  {UNITS.map(([u, label]) => (
                    <option key={u} value={u}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === "dxf" && (
              <>
                <label className="js-field">
                  <span className="field-label">Contour interval</span>
                  <select value={interval ?? ""} onChange={(e) => setInterval(e.target.value ? Number(e.target.value) : null)}>
                    <option value="">Automatic</option>
                    {intervalChoices(system, unit === "us_ft").map((c) => (
                      <option key={c.label} value={c.metres}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check-row">
                  <input type="checkbox" checked={spots} onChange={(e) => setSpots(e.target.checked)} />
                  Spot elevations on a grid
                </label>
              </>
            )}
            {(format === "csv" || (format === "dxf" && spots)) && (
              <label className="js-field">
                <span className="field-label">{format === "csv" ? "Point spacing" : "Spot spacing"}</span>
                <select value={spacing ?? ""} onChange={(e) => setSpacing(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Automatic (about 40 across)</option>
                  {SPACINGS[system].map(([m, label]) => (
                    <option key={label} value={m}>
                      Every {label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === "csv" && site && site.zones.length > 0 && (
              <label className="js-field">
                <span className="field-label">Area</span>
                <select value={zone} onChange={(e) => setZone(e.target.value)}>
                  <option value="">Whole site</option>
                  {site.zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      Only inside {z.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {format === "las" && (
              <label className="check-row">
                <input type="checkbox" checked={compressed} onChange={(e) => setCompressed(e.target.checked)} />
                Compressed (.laz — about a tenth of the size)
              </label>
            )}
          </div>
          {format === "progress" && (
            <p className="panel-note">
              A structured snapshot of every zone's quantities and % complete per flight, for project-management
              software or a spreadsheet. The format is documented in docs/features/exports.md.
            </p>
          )}

          {result && (
            <div className="notice-card ok export-result" role="status">
              <p>
                <strong>{result.filename}</strong> · {bytes(result.bytes)} · {summary(result)}
                {result.files.length > 1 && ` (+ ${result.files.slice(1).map((f) => f.filename).join(", ")})`}
              </p>
              <button type="button" className="secondary-btn" onClick={() => void revealExport(result.path).catch((e) => setError(message(e)))}>
                Show in folder
              </button>
            </div>
          )}
          {error && <p className="panel-note error-text">{error}</p>}
          {folder && <p className="panel-note">Files are saved to {folder}. Nothing is ever overwritten.</p>}
        </div>
        <div className="confirm-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          <button type="submit" className="primary-btn compact" disabled={busy}>
            {busy ? "Exporting…" : result ? "Export another" : "Export"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
