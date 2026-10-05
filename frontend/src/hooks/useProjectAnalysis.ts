import { useEffect, useMemo, useState } from "react";
import { fetchAnalysis, fetchPoints, type PointsPayload } from "../api";
import type { Analysis } from "../types";
import { prepareCloud, type PreparedCloud } from "../viewer/prepare";

export interface ProjectAnalysis {
  analysis: Analysis | null;
  cloud: PreparedCloud | null;
  error: string | null;
}

/**
 * Analytics + point cloud for the active project (nothing while no project is open).
 * Bump ``reloadKey`` to refetch after the scan's settings change.
 */
export function useProjectAnalysis(ready: boolean, projectId: string | null, reloadKey = 0): ProjectAnalysis {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [points, setPoints] = useState<PointsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAnalysis(null);
    setPoints(null);
    setError(null);
    if (!ready || !projectId) return;
    let live = true;
    Promise.all([fetchAnalysis(projectId), fetchPoints(projectId)])
      .then(([a, p]) => {
        if (!live) return;
        setAnalysis(a);
        setPoints(p);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ready, projectId, reloadKey]);

  const cloud = useMemo(() => (points ? prepareCloud(points.xyz, points.origin) : null), [points]);
  return { analysis, cloud, error };
}
