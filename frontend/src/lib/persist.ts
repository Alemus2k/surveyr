// Per-device UI preferences (panel width, open tabs). Storage can be missing or
// throw (private mode, cleared data), so every access is guarded and optional.

export function loadPref<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // preference is a convenience; the app works without it
  }
}
