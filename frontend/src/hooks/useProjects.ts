import { useCallback, useEffect, useState } from "react";
import { createComposition, deleteProject, fetchProjects, uploadScan, waitForBackend, type ProjectRef, type UnitDetection } from "../api";
import { unitLabel } from "../adjust/units";

export type EngineStatus = "starting" | "ready" | "failed";

/** Transient status line for project actions (shown as a toast). */
export interface Notice {
  text: string;
  tone: "info" | "warn" | "error"; // info fades; warn and error stay until dismissed
}

export interface Projects {
  engine: EngineStatus;
  engineError: string | null;
  projects: ProjectRef[];
  busy: boolean;
  notice: Notice | null;
  dismissNotice: () => void;
  importScan: (file: File) => Promise<string | null>; // new project id, or null on failure
  removeProject: (project: ProjectRef) => Promise<boolean>;
  createComparison: (name: string, projectIds: string[]) => Promise<string | null>; // new id
}

const INFO_NOTICE_MS = 4000; // warnings and errors stay until dismissed

/** What to tell the user about a new scan's units, if anything. */
function importNotice(name: string, detected: UnitDetection | undefined): Notice | null {
  if (!detected?.unit) return null;
  if (detected.source === "crs" && detected.unit !== "m") {
    return { text: `“${name}” is in ${unitLabel(detected.unit)} (${detected.crs_name}) — converted to metres.`, tone: "info" };
  }
  if (detected.source === "size") {
    return { text: `${detected.reason} Check Manual adjustments.`, tone: "warn" };
  }
  return null;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Waits for the analysis engine, then owns the project list and import/delete. */
export function useProjects(): Projects {
  const [engine, setEngine] = useState<EngineStatus>("starting");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let live = true;
    waitForBackend()
      .then(fetchProjects)
      .then((list) => {
        if (!live) return;
        setProjects(list);
        setEngine("ready");
      })
      .catch((e) => {
        if (!live) return;
        setEngine("failed");
        setEngineError(message(e));
      });
    return () => {
      live = false;
    };
  }, []);

  const importScan = useCallback(async (file: File) => {
    setBusy(true);
    setNotice({ text: `Importing ${file.name}…`, tone: "info" });
    try {
      const created = await uploadScan(file);
      setProjects(await fetchProjects());
      setNotice(importNotice(created.name, created.detected));
      return created.id;
    } catch (e) {
      setNotice({ text: message(e), tone: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const removeProject = useCallback(async (project: ProjectRef) => {
    setBusy(true);
    try {
      await deleteProject(project.id);
      setProjects(await fetchProjects());
      setNotice({ text: `Moved “${project.name}” to the Trash.`, tone: "info" });
      return true;
    } catch (e) {
      setNotice({ text: message(e), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const createComparison = useCallback(async (name: string, projectIds: string[]) => {
    setBusy(true);
    try {
      const created = await createComposition(name, projectIds);
      setProjects(await fetchProjects());
      return created.id;
    } catch (e) {
      setNotice({ text: message(e), tone: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!notice || notice.tone !== "info" || busy) return;
    const t = setTimeout(() => setNotice(null), INFO_NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice, busy]);

  return { engine, engineError, projects, busy, notice, dismissNotice, importScan, removeProject, createComparison };
}
