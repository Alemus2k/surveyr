import { useState } from "react";
import type { ProjectRef } from "../api";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { Icon } from "../layout/icons";
import { ImportScanButton } from "../layout/ImportScanButton";
import { PanelSection } from "./SidePanel";

interface ProjectsPanelProps {
  variant?: "projects" | "sites"; // scans & comparisons, or job sites
  projects: ProjectRef[];
  openIds: string[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onImport: (file: File) => void;
  onDelete: (project: ProjectRef) => Promise<boolean>;
  onNewComparison: () => void;
  onNewSite: () => void;
  busy: boolean;
}

const isScan = (p: ProjectRef) => p.type !== "compare" && p.type !== "site";

/** Projects on disk — scans and comparisons, or job sites: open one in a tab, create, import or delete. */
export function ProjectsPanel(props: ProjectsPanelProps) {
  const { variant = "projects", projects, openIds, activeId, onOpen, onImport, onDelete, onNewComparison, onNewSite, busy } = props;
  const [pending, setPending] = useState<ProjectRef | null>(null);
  const sitesView = variant === "sites";
  const listed = projects.filter((p) => (p.type === "site") === sitesView);
  const siteName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;

  const confirmDelete = async () => {
    if (!pending) return;
    await onDelete(pending);
    setPending(null);
  };

  return (
    <PanelSection>
      {sitesView ? (
        <button className="primary-btn" onClick={onNewSite} disabled={busy || !projects.some(isScan)}>
          <Icon name="plus" size={16} /> New job site…
        </button>
      ) : (
        <>
          <ImportScanButton onFile={onImport} busy={busy} className="primary-btn" label="Import scan">
            {busy ? "Working…" : "Import scan…"}
          </ImportScanButton>
          <button className="secondary-btn full" onClick={onNewComparison} disabled={busy || !projects.some(isScan)}>
            <Icon name="layers" size={16} /> New comparison…
          </button>
        </>
      )}

      {listed.length === 0 ? (
        <p className="panel-note">
          {sitesView
            ? "No job sites yet. Import each flight of a site under Projects, then create a job site from them."
            : "No projects yet. Import a scan to get started."}
        </p>
      ) : (
        <ul className="project-list">
          {listed.map((p) => {
            const isOpen = openIds.includes(p.id);
            return (
              <li key={p.id} className="project-row" data-active={p.id === activeId}>
                <button className="project-open" onClick={() => onOpen(p.id)} title={isOpen ? "Show tab" : "Open in a tab"}>
                  <span className="project-name">{p.name}</span>
                  <span className="project-id mono">
                    {p.type === "compare" ? "comparison" : p.type === "site" ? "job site" : p.site ? `in ${siteName(p.site)}` : p.id}
                    {isOpen && <span className="project-open-tag">open</span>}
                  </span>
                </button>
                <button
                  className="tool-btn project-delete"
                  onClick={() => setPending(p)}
                  aria-label={`Delete ${p.name}`}
                  title="Delete project"
                  disabled={busy}
                >
                  <Icon name="trash" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {sitesView ? (
        <p className="panel-note">
          A job site tracks construction progress from repeat scans of one site against its design surface. Its
          scans stay listed under Projects.
        </p>
      ) : (
        <p className="panel-note">
          Imports <span className="mono">.ply</span>, <span className="mono">.las</span>,{" "}
          <span className="mono">.laz</span> and <span className="mono">.xyz</span> point clouds — e.g. a Scaniverse
          PLY AirDropped from your phone. Closing a tab keeps the project; reopen it here.
        </p>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={`Delete “${pending?.name ?? ""}”?`}
        confirmLabel="Move to Trash"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      >
        <p>
          {pending?.type === "site" || pending?.type === "compare"
            ? `Its ${pending.type === "site" ? "site" : "comparison"} file will be moved to the Trash. The scans in it are kept.`
            : pending?.id === "multiscan"
            ? "Both of its scan files will be moved to the macOS Trash and the project removed from Surveyr. You can restore them from the Trash."
            : "Its scan file will be moved to the macOS Trash and the project removed from Surveyr. You can restore it from the Trash and import it again."}
        </p>
      </ConfirmDialog>
    </PanelSection>
  );
}
