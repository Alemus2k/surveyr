import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { AdjustPanel } from "./adjust/AdjustPanel";
import { useScanSettings } from "./adjust/useScanSettings";
import type { ProjectRef } from "./api";
import { AppearancePopover } from "./appearance/AppearancePopover";
import { useAppearance } from "./appearance/useAppearance";
import { CompareViewer } from "./compare/CompareViewer";
import type { GizmoMode } from "./compare/compareScene";
import { LayersPanel } from "./compare/LayersPanel";
import { NewComparisonDialog } from "./compare/NewComparisonDialog";
import { useComposition } from "./compare/useComposition";
import { useOpenTabs } from "./hooks/useOpenTabs";
import { usePanelWidth } from "./hooks/usePanelWidth";
import { useProjectAnalysis } from "./hooks/useProjectAnalysis";
import { useProjects } from "./hooks/useProjects";
import { IconRail, type PanelId } from "./layout/IconRail";
import { Icon } from "./layout/icons";
import { TopBar } from "./layout/TopBar";
import { ColorPanel } from "./panels/ColorPanel";
import { ChartsPanel } from "./charts/ChartsPanel";
import { JobsitePanel } from "./jobsite/JobsitePanel";
import { MapsPanel } from "./panels/DataPanels";
import { ProjectsPanel } from "./panels/ProjectsPanel";
import { SidePanel } from "./panels/SidePanel";
import { TerrainPanel } from "./panels/TerrainPanel";
import { colorize, type ColorRange, type PreparedCloud } from "./viewer/prepare";
import { Workspace } from "./viewer/Workspace";

const PANEL_TITLES: Record<PanelId, string> = {
  projects: "Projects",
  terrain: "Terrain",
  color: "Cloud colour",
  maps: "2D maps",
  charts: "Charts",
  jobsite: "Job site calculations",
  adjust: "Manual adjustments",
  layers: "Layers",
};
// A comparison has no single terrain, so the analysis panels don't apply to it.
const SCAN_PANELS: readonly PanelId[] = ["projects", "terrain", "color", "maps", "charts", "jobsite", "adjust"];
const COMPARE_PANELS: readonly PanelId[] = ["projects", "layers"];
const DEFAULT_THRESHOLD_DEG = 3;

export default function App() {
  const projects = useProjects();
  const ready = projects.engine === "ready";
  const tabs = useOpenTabs(ready ? projects.projects.map((p) => p.id) : null);
  const byId = new Map(projects.projects.map((p) => [p.id, p]));
  const isCompare = byId.get(tabs.active ?? "")?.type === "compare";

  // bumped whenever a scan's manual adjustments change, so everything reloads converted
  const [settingsVersion, setSettingsVersion] = useState(0);
  const bumpSettings = useCallback(() => setSettingsVersion((v) => v + 1), []);
  const { analysis, cloud, error } = useProjectAnalysis(ready, isCompare ? null : tabs.active, settingsVersion);
  const composition = useComposition(isCompare ? tabs.active : null, settingsVersion);
  const scanSettings = useScanSettings(ready && !isCompare ? tabs.active : null, bumpSettings);
  const [panelWidth, setPanelWidth, resetPanelWidth] = usePanelWidth();
  const appearance = useAppearance();

  const [panelChoice, setPanel] = useState<PanelId | null>("terrain");
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD_DEG);
  const [rangeState, setRangeState] = useState<{ cloud: PreparedCloud; range: ColorRange } | null>(null);
  const [selection, setSelection] = useState<{ comp: string; layer: string } | null>(null);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [newCompareOpen, setNewCompareOpen] = useState(false);

  // the rail shows only panels that fit the open tab; map a remembered choice across
  const railItems = isCompare ? COMPARE_PANELS : SCAN_PANELS;
  const panel =
    panelChoice === null ? null : railItems.includes(panelChoice) ? panelChoice : isCompare ? "layers" : "terrain";
  const selectedLayer = selection && selection.comp === tabs.active ? selection.layer : null;

  // colour range resets when a different cloud is shown
  const range = cloud && (rangeState?.cloud === cloud ? rangeState.range : cloud.defaultRange);
  const colors = useMemo(() => (cloud && range ? colorize(cloud.z, range) : null), [cloud, range?.min, range?.max]);

  const openTabs = tabs.open.flatMap((id) => byId.get(id) ?? []);
  const readout = isCompare
    ? composition.comp && `${composition.comp.layers.length} layers`
    : analysis && `${(analysis.points.kept / 1000).toFixed(0)}k pts · ${analysis.grid.cell_size} m cell`;

  const importScan = async (file: File) => {
    const id = await projects.importScan(file);
    if (id) tabs.select(id);
  };
  const deleteProject = async (project: ProjectRef) => {
    const ok = await projects.removeProject(project);
    if (ok) tabs.close(project.id);
    return ok;
  };
  const createComparison = async (name: string, ids: string[]) => {
    const id = await projects.createComparison(name, ids);
    setNewCompareOpen(false);
    if (id) {
      tabs.select(id);
      setPanel("layers");
    }
  };

  const panelBody = (id: PanelId) => {
    if (id === "projects")
      return (
        <ProjectsPanel
          projects={projects.projects}
          openIds={tabs.open}
          activeId={tabs.active}
          onOpen={tabs.select}
          onImport={importScan}
          onDelete={deleteProject}
          onNewComparison={() => setNewCompareOpen(true)}
          busy={projects.busy}
        />
      );
    if (!tabs.active) return <div className="empty-state">Open a project to see its {PANEL_TITLES[id].toLowerCase()}.</div>;
    if (id === "layers")
      return (
        <LayersPanel
          state={composition}
          projects={projects.projects}
          selected={selectedLayer}
          onSelect={(layer) => setSelection(layer && tabs.active ? { comp: tabs.active, layer } : null)}
        />
      );
    if (id === "adjust") return <AdjustPanel state={scanSettings} analysis={analysis} />;
    if (!analysis || !cloud || !range) return <div className="empty-state">Loading…</div>;
    if (id === "terrain") return <TerrainPanel analysis={analysis} threshold={threshold} onThreshold={setThreshold} />;
    if (id === "color") return <ColorPanel cloud={cloud} range={range} onRange={(r) => setRangeState({ cloud, range: r })} />;
    if (id === "jobsite" && tabs.active)
      return <JobsitePanel projectId={tabs.active} projectName={byId.get(tabs.active)?.name ?? tabs.active} analysis={analysis} />;
    if (id === "maps") return <MapsPanel analysis={analysis} threshold={threshold} accent={appearance.uiAccent} />;
    return <ChartsPanel analysis={analysis} accent={appearance.uiAccent} threshold={threshold} />;
  };

  const loadError = isCompare ? composition.error : error;
  const workspace = () => {
    if (projects.engine === "starting")
      return (
        <div className="empty-state">
          <span className="spinner" aria-hidden="true" />
          Starting the analysis engine…
        </div>
      );
    if (projects.engine === "failed") return <div className="error-state">{projects.engineError}</div>;
    if (!tabs.active)
      return (
        <div className="empty-state">
          <p>No project open.</p>
          <button className="secondary-btn" onClick={() => setPanel("projects")}>
            Show projects
          </button>
        </div>
      );
    if (loadError)
      return (
        <div className="error-state">
          <p>Couldn't load this project.</p>
          <p className="mono">{loadError}</p>
        </div>
      );
    if (isCompare) {
      if (composition.comp && composition.comp.layers.length === 0)
        return <div className="empty-state">No layers yet — add scans from the Layers panel.</div>;
      if (!composition.frame) return <div className="empty-state">Loading layers…</div>;
      return (
        <CompareViewer
          state={composition}
          projects={projects.projects}
          selected={selectedLayer}
          gizmoMode={gizmoMode}
          onGizmoMode={setGizmoMode}
          accent={appearance.viewportAccent}
        />
      );
    }
    if (analysis && cloud && colors && range)
      return <Workspace cloud={cloud} colors={colors} range={range} accent={appearance.viewportAccent} analysis={analysis} />;
    return <div className="empty-state">Loading point cloud…</div>;
  };

  return (
    <div className="shell" data-panel={panel ? "open" : "closed"} style={{ "--panel-w": `${panelWidth}px` } as CSSProperties}>
      <TopBar
        tabs={openTabs}
        activeId={tabs.active}
        onSelect={tabs.select}
        onClose={tabs.close}
        readout={readout || null}
        appearance={<AppearancePopover api={appearance} />}
        onImport={importScan}
        importing={projects.busy}
      />
      <IconRail items={railItems} active={panel} onSelect={(id) => setPanel(panel === id ? null : id)} />

      {panel && (
        <SidePanel
          title={PANEL_TITLES[panel]}
          width={panelWidth}
          onResize={setPanelWidth}
          onResetWidth={resetPanelWidth}
          onCollapse={() => setPanel(null)}
          actions={
            panel === "color" && cloud ? (
              <button className="tool-btn" title="Reset colour range" aria-label="Reset colour range" onClick={() => setRangeState(null)}>
                <Icon name="reset" size={16} />
              </button>
            ) : null
          }
        >
          {panelBody(panel)}
        </SidePanel>
      )}

      <main className="workspace">{workspace()}</main>

      <NewComparisonDialog
        open={newCompareOpen}
        projects={projects.projects.filter((p) => p.type !== "compare")}
        initial={isCompare ? null : tabs.active}
        busy={projects.busy}
        onCreate={createComparison}
        onCancel={() => setNewCompareOpen(false)}
      />

      {projects.notice && (
        <div className={`toast toast-${projects.notice.tone}`} role="status">
          <span>{projects.notice.text}</span>
          {!projects.busy && (
            <button className="tool-btn" onClick={projects.dismissNotice} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
