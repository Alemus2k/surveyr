import { useState } from "react";
import type { ProjectRef } from "../api";
import { ConfirmDialog } from "../layout/ConfirmDialog";
import { Icon } from "../layout/icons";
import { ImportScanButton } from "../layout/ImportScanButton";
import { PanelSection } from "./SidePanel";

interface ProjectsPanelProps {
  projects: ProjectRef[];
  openIds: string[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onImport: (file: File) => void;
  onDelete: (project: ProjectRef) => Promise<boolean>;
  onNewComparison: () => void;
  busy: boolean;
}

/** Every project on disk: open it in a tab, import new scans, or delete. */
export function ProjectsPanel(props: ProjectsPanelProps) {
  const { projects, openIds, activeId, onOpen, onImport, onDelete, onNewComparison, busy } = props;
  const [pending, setPending] = useState<ProjectRef | null>(null);

  const confirmDelete = async () => {
    if (!pending) return;
    await onDelete(pending);
    setPending(null);
  };

  return (
    <PanelSection>
      <ImportScanButton onFile={onImport} busy={busy} className="primary-btn" label="Import scan">
        {busy ? "Working…" : "Import scan…"}
      </ImportScanButton>
      <button
        className="secondary-btn full"
        onClick={onNewComparison}
        disabled={busy || !projects.some((p) => p.type !== "compare")}
      >
        <Icon name="layers" size={16} /> New comparison…
      </button>

      {projects.length === 0 ? (
        <p className="panel-note">No projects yet. Import a scan to get started.</p>
      ) : (
        <ul className="project-list">
          {projects.map((p) => {
            const isOpen = openIds.includes(p.id);
            return (
              <li key={p.id} className="project-row" data-active={p.id === activeId}>
                <button className="project-open" onClick={() => onOpen(p.id)} title={isOpen ? "Show tab" : "Open in a tab"}>
                  <span className="project-name">{p.name}</span>
                  <span className="project-id mono">
                    {p.type === "compare" ? "comparison" : p.id}
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

      <p className="panel-note">
        Imports <span className="mono">.ply</span>, <span className="mono">.las</span>,{" "}
        <span className="mono">.laz</span> and <span className="mono">.xyz</span> point clouds — e.g. a Scaniverse
        PLY AirDropped from your phone. Closing a tab keeps the project; reopen it here.
      </p>

      <ConfirmDialog
        open={pending !== null}
        title={`Delete “${pending?.name ?? ""}”?`}
        confirmLabel="Move to Trash"
        busy={busy}
        onConfirm={confirmDelete}
        onCancel={() => setPending(null)}
      >
        <p>
          {pending?.id === "multiscan"
            ? "Both of its scan files will be moved to the macOS Trash and the project removed from Surveyr. You can restore them from the Trash."
            : "Its scan file will be moved to the macOS Trash and the project removed from Surveyr. You can restore it from the Trash and import it again."}
        </p>
      </ConfirmDialog>
    </PanelSection>
  );
}
