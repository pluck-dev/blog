import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { DbService, safeJson } from "./db.service.js";
import { PRESETS, TEMPLATE_SPECS, VERTICAL_TO_PRESET, type AxisName } from "./constants.js";

type Row = Record<string, any>;

@Injectable()
export class SlotService {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  applyPreset(domain: string, key: string): Record<string, number> {
    const presetKey = VERTICAL_TO_PRESET[key] || key;
    const preset = PRESETS[presetKey];
    if (!preset) return {};
    const summary: Record<string, number> = {};
    for (const [axis, values] of Object.entries(preset) as [AxisName, Row[]][]) {
      if (!values.length) continue;
      this.db.bulkReplaceAxis(domain, axis, values);
      summary[axis] = values.length;
    }
    return summary;
  }

  generateSlotsForTenant(domain: string, opts: { templates?: string[]; maxPerTemplate?: number; seed?: number } = {}): Record<string, number> {
    const tenant = this.db.getTenant(domain);
    if (!tenant) throw new Error(`unknown tenant: ${domain}`);
    const axes = this.db.listAxes(domain);
    const enabled = opts.templates?.length ? opts.templates : safeJson(tenant.templates_enabled, []);
    const templateIds = enabled.length ? enabled : Object.keys(TEMPLATE_SPECS);
    const maxPerTemplate = opts.maxPerTemplate ?? 200;
    const summary: Record<string, number> = {};
    const rows: Row[] = [];

    for (const tid of templateIds) {
      const spec = (TEMPLATE_SPECS as Record<string, any>)[tid];
      if (!spec) continue;
      const primaryAxis = spec.primary[0] as AxisName;
      const primaryValues = axes[primaryAxis] || [];
      if (!primaryValues.length) { summary[tid] = 0; continue; }
      const personaValues = spec.use_persona ? (axes.persona.length ? axes.persona : [{ value: null }]) : [{ value: null }];
      const intentValues = spec.with_intent ? (axes.intent.length ? axes.intent : [{ value: null }]) : [{ value: null }];
      const modifierCombos = modifierPairs(axes.modifier, spec.modifier_count);
      let count = 0;

      for (const pv of primaryValues) {
        let primaryKeyword = pv.value;
        if (tid === "T01" || tid === "T07") {
          const kw = axes.keyword[0];
          if (!kw) continue;
          primaryKeyword = `${pv.value}${kw.value}`;
        }
        for (const persona of personaValues) for (const intent of intentValues) for (const [m1, m2] of modifierCombos) {
          const sv = numberOrNull(pv.monthly_search_volume);
          if (sv !== null && sv < spec.min_sv) continue;
          const parts = [pv.value || "", persona.value || "", intent.value || "", m1 || "", m2 || ""];
          rows.push({
            slot_id: slotId(tid, parts), tenant: domain, template_id: tid, primary_keyword: primaryKeyword,
            region: primaryAxis === "region" ? pv.value : null, persona: persona.value ?? null, intent: intent.value ?? null,
            modifier_1: m1, modifier_2: m2, entity_id: null, priority_score: priority(sv, numberOrNull(pv.competition_kd), spec.weight)
          });
          count += 1;
          if (count >= maxPerTemplate) break;
        }
        if (count >= maxPerTemplate) break;
      }
      summary[tid] = count;
    }
    rows.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
    summary._inserted_total = this.db.bulkUpsertSlots(rows);
    return summary;
  }
}

function slotId(templateId: string, parts: string[]): string {
  const h = createHash("sha1").update([templateId, ...parts].join("|")).digest("hex").slice(0, 8);
  return `${templateId}_${h}`;
}
function numberOrNull(v: any): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function priority(sv: number | null, kd: number | null, weight: number): number {
  const svNorm = Math.log10((sv ?? 0) + 1) / 4.5;
  const kdNorm = (100 - (kd ?? 50)) / 100;
  return Math.round(Math.min(Math.max((svNorm * 0.6 + kdNorm * 0.4) * weight * 100, 0), 100) * 100) / 100;
}
function modifierPairs(values: Row[], count: number): Array<[string | null, string | null]> {
  if (count === 0) return [[null, null]];
  if (count === 1) return values.length ? values.map((m) => [m.value, null]) : [[null, null]];
  if (values.length < 2) return [[values[0]?.value ?? null, null]];
  const out: Array<[string, string]> = [];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) out.push([values[i]!.value, values[j]!.value]);
  return out;
}
