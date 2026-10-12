// Job specs: the finished grade (design surface, per-zone overrides), the
// on-grade tolerance and each zone's planned dates. Specs change only through
// change orders, which log every edit as it read before and after. Voiding an
// order puts its specs back to what they'd be had it never been issued.

import { formatDate } from "./dates";
import type { Surfaces } from "./progress";
import type { ChangeOrder, GradeValue, KeptSpec, Site, SpecChange, SpecField, SpecValue, VoidRecord, Zone } from "./types";

export type GradeMode = "design" | "offset" | "flat";

export interface ZoneSpec extends GradeValue {
  id: string;
  start: string | null;
  finish: string | null;
}

/** Every editable spec of a site, as edited in the change-order dialog. */
export interface SpecDraft {
  design_id: string | null;
  tolerance_m: number;
  zones: ZoneSpec[];
}

export const SPEC_LABEL: Record<SpecField, string> = {
  design_id: "Design surface",
  tolerance_m: "On-grade tolerance",
  grade: "Finished grade",
  start: "Planned start",
  finish: "Planned finish",
};

const ZONE_FIELDS: SpecField[] = ["grade", "start", "finish"];

export const gradeMode = (g: GradeValue): GradeMode =>
  g.target_elevation_m != null ? "flat" : g.design_offset_m ? "offset" : "design";

const hasGradeSpec = (z: Zone) => z.target_elevation_m != null || !!z.design_offset_m;

export function describeGrade(g: GradeValue): string {
  const mode = gradeMode(g);
  if (mode === "flat") return `Flat pad at ${g.target_elevation_m!.toFixed(3)} m`;
  if (mode === "offset") return `Design surface ${g.design_offset_m > 0 ? "+" : "−"}${Math.abs(g.design_offset_m).toFixed(3)} m`;
  return "Design surface";
}

export function specsOf(site: Site): SpecDraft {
  return {
    design_id: site.design_id,
    tolerance_m: site.tolerance_m,
    zones: site.zones.map((z) => ({
      id: z.id,
      start: z.start,
      finish: z.finish,
      target_elevation_m: z.target_elevation_m ?? null,
      design_offset_m: z.design_offset_m ?? 0,
    })),
  };
}

// ------------------------------------------------------------------ single specs

/** A spec's value in a draft, or undefined when its zone doesn't exist. */
export function specValue(d: SpecDraft, field: SpecField, zoneId: string | null): SpecValue | undefined {
  if (field === "design_id") return d.design_id;
  if (field === "tolerance_m") return d.tolerance_m;
  const z = d.zones.find((x) => x.id === zoneId);
  if (!z) return undefined;
  if (field === "grade") return { target_elevation_m: z.target_elevation_m, design_offset_m: z.design_offset_m };
  return z[field];
}

function withSpec(d: SpecDraft, field: SpecField, zoneId: string | null, v: SpecValue): SpecDraft {
  if (field === "design_id") return { ...d, design_id: v as string | null };
  if (field === "tolerance_m") return { ...d, tolerance_m: v as number };
  return {
    ...d,
    zones: d.zones.map((z) => {
      if (z.id !== zoneId) return z;
      if (field === "grade") {
        const g = v as GradeValue;
        return { ...z, target_elevation_m: g.target_elevation_m, design_offset_m: g.target_elevation_m != null ? 0 : g.design_offset_m };
      }
      return { ...z, [field]: v as string | null };
    }),
  };
}

export function describeSpec(field: SpecField, v: SpecValue, nameOf: (id: string) => string): string {
  if (field === "design_id") return v ? nameOf(v as string) : "None";
  if (field === "tolerance_m") return `±${+((v as number) * 100).toFixed(1)} cm`;
  if (field === "grade") return describeGrade(v as GradeValue);
  return v ? formatDate(v as string) : "Not set";
}

const same = (a: SpecValue | undefined, b: SpecValue | undefined) => JSON.stringify(a) === JSON.stringify(b);

function keys(d: SpecDraft): [SpecField, string | null][] {
  return [["design_id", null], ["tolerance_m", null], ...d.zones.flatMap((z) => ZONE_FIELDS.map((f): [SpecField, string] => [f, z.id]))];
}

// ------------------------------------------------------------------ change orders

/** What a draft changes, worded for the log. ``nameOf`` turns a scan id into its display name. */
export function diffSpecs(site: Site, draft: SpecDraft, nameOf: (id: string) => string): SpecChange[] {
  const was = specsOf(site);
  const out: SpecChange[] = [];
  for (const [field, zoneId] of keys(draft)) {
    const before = specValue(was, field, zoneId);
    const after = specValue(draft, field, zoneId);
    if (before === undefined || after === undefined || same(before, after)) continue;
    out.push({
      field,
      zone_id: zoneId,
      zone_name: site.zones.find((z) => z.id === zoneId)?.name ?? null,
      before: describeSpec(field, before, nameOf),
      after: describeSpec(field, after, nameOf),
      values: { before, after },
    });
  }
  return out;
}

/** The site with a draft's specs applied (zones keep everything that isn't a spec). */
export function applySpecs(site: Site, draft: SpecDraft): Site {
  const byId = new Map(draft.zones.map((z) => [z.id, z]));
  return {
    ...site,
    design_id: draft.design_id,
    tolerance_m: draft.tolerance_m,
    zones: site.zones.map((z) => {
      const s = byId.get(z.id);
      if (!s) return z;
      const flat = s.target_elevation_m != null;
      return {
        ...z,
        start: s.start,
        finish: s.finish,
        target_elevation_m: flat ? s.target_elevation_m : null,
        design_offset_m: flat ? 0 : s.design_offset_m,
      };
    }),
  };
}

export function nextChangeOrderNumber(site: Site): number {
  return (site.change_orders ?? []).reduce((n, co) => Math.max(n, co.number), 0) + 1;
}

/** Log ``changes`` as a new change order and apply ``draft``. */
export function issueChangeOrder(
  site: Site,
  draft: SpecDraft,
  changes: SpecChange[],
  meta: Pick<ChangeOrder, "date" | "title" | "reason" | "requested_by">,
  now = new Date()
): Site {
  const order: ChangeOrder = {
    id: `co${now.getTime().toString(36)}`,
    number: nextChangeOrderNumber(site),
    created_at: now.toISOString(),
    changes,
    ...meta,
  };
  return { ...applySpecs(site, draft), change_orders: [...(site.change_orders ?? []), order] };
}

// ------------------------------------------------------------------ voids

/** Every spec change records its exact values (orders from before voids existed don't). */
export const canVoid = (co: ChangeOrder) => !co.voided && co.changes.every((c) => !!c.values);

/**
 * A spec's value as if only the orders still in effect had been issued: the
 * value before the first order that touched it, then each in-effect order's
 * value in number order. ``setBy`` is the order that value came from (null =
 * the original value). Null when no order touched the spec.
 */
function replay(orders: ChangeOrder[], field: SpecField, zoneId: string | null): { value: SpecValue; setBy: number | null } | null {
  let result: { value: SpecValue; setBy: number | null } | null = null;
  for (const co of [...orders].sort((a, b) => a.number - b.number)) {
    const c = co.changes.find((x) => x.field === field && x.zone_id === zoneId);
    if (!c?.values) continue;
    if (!result) result = { value: c.values.before, setBy: null };
    if (!co.voided) result = { value: c.values.after, setBy: co.number };
  }
  return result;
}

export interface VoidPlan {
  restored: SpecChange[]; // specs the void puts back
  kept: KeptSpec[]; // specs it leaves: changed again by a later order, or the zone is gone
  draft: SpecDraft; // the specs after the void
}

/** What voiding order ``number`` would change, without changing anything. */
export function planVoid(site: Site, number: number, nameOf: (id: string) => string): VoidPlan {
  const orders = site.change_orders ?? [];
  const target = orders.find((co) => co.number === number);
  const after = orders.map((co) => (co.number === number ? { ...co, voided: {} as VoidRecord } : co));
  let draft = specsOf(site);
  const restored: SpecChange[] = [];
  const kept: KeptSpec[] = [];
  for (const c of target?.changes ?? []) {
    const current = specValue(draft, c.field, c.zone_id);
    const zone_name = site.zones.find((z) => z.id === c.zone_id)?.name ?? c.zone_name;
    if (current === undefined) {
      kept.push({ field: c.field, zone_id: c.zone_id, zone_name, by_number: null });
      continue;
    }
    const r = replay(after, c.field, c.zone_id)!;
    if (r.setBy !== null && r.setBy > number) {
      kept.push({ field: c.field, zone_id: c.zone_id, zone_name, by_number: r.setBy });
      continue;
    }
    if (same(current, r.value)) continue;
    restored.push({
      field: c.field,
      zone_id: c.zone_id,
      zone_name,
      before: describeSpec(c.field, current, nameOf),
      after: describeSpec(c.field, r.value, nameOf),
      values: { before: current, after: r.value },
    });
    draft = withSpec(draft, c.field, c.zone_id, r.value);
  }
  return { restored, kept, draft };
}

/** Void order ``number``: mark it voided (it stays in the log) and restore its specs. */
export function voidChangeOrder(
  site: Site,
  number: number,
  meta: Pick<VoidRecord, "date" | "reason" | "voided_by">,
  nameOf: (id: string) => string,
  now = new Date()
): Site {
  const target = site.change_orders?.find((co) => co.number === number);
  if (!target || !canVoid(target)) return site;
  const plan = planVoid(site, number, nameOf);
  const voided: VoidRecord = { ...meta, voided_at: now.toISOString(), restored: plan.restored, kept: plan.kept };
  return {
    ...applySpecs(site, plan.draft),
    change_orders: site.change_orders!.map((co) => (co.number === number ? { ...co, voided } : co)),
  };
}

// ------------------------------------------------------------------ finished grade

/**
 * The finished grade every measurement is made against: the design surface,
 * with each zone's grade spec applied inside its outline (later zones win
 * where outlines overlap). Null when there's no design and no zone spec.
 */
export function finishedGrade(s: Surfaces, zones: Zone[], cellsOf: (z: Zone) => Int32Array): Float64Array | null {
  const specified = zones.filter(hasGradeSpec);
  if (specified.length === 0) return s.design;
  const out = s.design ? Float64Array.from(s.design) : new Float64Array(s.nx * s.ny).fill(NaN);
  for (const z of specified) {
    const cells = cellsOf(z);
    if (z.target_elevation_m != null) for (const i of cells) out[i] = z.target_elevation_m;
    else if (s.design) for (const i of cells) out[i] = s.design[i] + z.design_offset_m!;
  }
  return out;
}

/** Mean of ``z`` over ``cells`` (NaN cells skipped), or null if none were measured. */
export function meanOver(z: Float64Array | null, cells: Int32Array): number | null {
  if (!z) return null;
  let sum = 0, n = 0;
  for (const i of cells) {
    if (Number.isFinite(z[i])) {
      sum += z[i];
      n++;
    }
  }
  return n ? sum / n : null;
}
