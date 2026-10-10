// Grading a scan's vertical accuracy against surveyed check points.

export interface AccuracyStats {
  n: number;
  mean: number | null; // scan minus control (m): + means the scan is high
  std: number | null;
  rmse: number | null;
  max_abs: number | null;
  ci95: number | null; // 1.96 × RMSE
}

export type Grade = "good" | "fair" | "poor" | "none";

export interface Verdict {
  grade: Grade;
  /** A consistent vertical offset worth correcting (m, scan minus control), or null. */
  bias: number | null;
}

export const MIN_BIAS_M = 0.01; // offsets under 1 cm aren't worth correcting

/**
 * Good: RMSE within half the job's tolerance. Fair: within the tolerance.
 * Poor: worse. A bias is reported when the mean offset is at least 1 cm and
 * clearly larger than the scatter (more than two standard errors).
 */
export function gradeAccuracy(stats: AccuracyStats, tolerance: number): Verdict {
  if (!stats.n || stats.rmse === null || stats.mean === null) return { grade: "none", bias: null };
  const grade: Grade = stats.rmse <= tolerance / 2 ? "good" : stats.rmse <= tolerance ? "fair" : "poor";
  const stdErr = stats.n > 1 && stats.std !== null ? stats.std / Math.sqrt(stats.n) : Infinity;
  const significant = stats.n >= 3 && Math.abs(stats.mean) >= MIN_BIAS_M && Math.abs(stats.mean) > 2 * stdErr;
  return { grade, bias: significant ? stats.mean : null };
}

export const GRADE_LABEL: Record<Grade, string> = {
  good: "Good",
  fair: "Check",
  poor: "Poor",
  none: "No check",
};

/** ±centimetres, e.g. "+3.4 cm". */
export function cm(m: number, signed = true): string {
  const v = (m * 100).toFixed(1);
  if (Number(v) === 0) return "0.0 cm"; // no "+0.0" or "−0.0"
  return signed && m > 0 ? `+${v} cm` : `${v.replace("-", "−")} cm`;
}
