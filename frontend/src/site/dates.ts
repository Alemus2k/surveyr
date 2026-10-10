const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-07" → "7 Sep 2026" (or "7 Sep" with ``short``). */
export function formatDate(iso: string, short = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return short ? `${d} ${MONTHS[m - 1]}` : `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** A YYYY-MM-DD date written into a scan's name (e.g. Scaniverse or drone exports), if any. */
export function dateInName(name: string): string | null {
  const m = name.match(/(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
