import { useCallback, useEffect, useState } from "react";
import { fetchScanSettings, saveScanSettings, type ScanSettings, type ScanSettingsResponse } from "../api";

export interface ScanSettingsState {
  current: ScanSettingsResponse | null;
  saving: boolean;
  error: string | null;
  save: (settings: ScanSettings) => Promise<void>;
}

/**
 * A scan's manual adjustments. ``onSaved`` runs after each successful save so
 * the caller can reload everything that depends on the converted points.
 */
export function useScanSettings(projectId: string | null, onSaved: () => void): ScanSettingsState {
  const [current, setCurrent] = useState<ScanSettingsResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(null);
    setError(null);
    if (!projectId) return;
    let live = true;
    fetchScanSettings(projectId)
      .then((r) => live && setCurrent(r))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [projectId]);

  const save = useCallback(
    async (settings: ScanSettings) => {
      if (!projectId) return;
      setSaving(true);
      setError(null);
      try {
        setCurrent(await saveScanSettings(projectId, settings));
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [projectId, onSaved]
  );

  return { current, saving, error, save };
}
