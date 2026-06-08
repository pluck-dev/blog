import { createHash } from "crypto";
import type { Axis } from "@shared/types";
import { getTenant, listAxes, bulkUpsertSlots } from "./db";

export interface TemplateSpec {
  name: string;
  description: string;
  primary: Axis[];
  use_persona: boolean;
  modifier_count: number;
  weight: number;
  min_sv: number;
  with_intent?: boolean;
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  T01: { name: "지역 BEST5", description: "지역별 추천/비교 글을 대량 생성합니다.", primary: ["region"], use_persona: true, modifier_count: 2, weight: 1.0, min_sv: 500 },
  T03: { name: "가이드 총정리", description: "키워드별 절차, 비용, FAQ를 정리합니다.", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 800 },
  T04: { name: "옵션 비교", description: "가격, 기간, 난이도처럼 선택지를 비교합니다.", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.7, min_sv: 400 },
  T05: { name: "비용 절약 전략", description: "비용 민감 키워드에 맞춘 절약 팁 글입니다.", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 600 },
  T06: { name: "시험/리스크 BEST5", description: "시험, 실패, 주의사항 중심의 리스트 글입니다.", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 0.85, min_sv: 1000, with_intent: true },
  T07: { name: "허브", description: "지역/주제 클러스터의 중심 페이지를 만듭니다.", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.2, min_sv: 1500, with_intent: true },
};

function slotId(templateId: string, parts: string[]): string {
  const h = createHash("sha1").update([templateId, ...parts].join("|")).digest("hex").slice(0, 8);
  return `${templateId}_${h}`;
}

function priority(sv: number | null, kd: number | null, tplWeight: number): number {
  const svv = sv ?? 0;
  const kdv = kd ?? 50;
  const sv_norm = Math.log10(svv + 1) / 4.5;
  const kd_norm = (100 - kdv) / 100;
  const raw = (sv_norm * 0.6 + kd_norm * 0.4) * tplWeight * 100;
  return Math.round(Math.min(Math.max(raw, 0), 100) * 100) / 100;
}

function combinationsPair<T>(arr: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]);
  }
  return out;
}

export interface GenerateSlotsResult extends Record<string, number> {
  _inserted_total: number;
}

export function generateSlotsForTenant(tenant: string, opts?: {
  templates?: string[]; max_per_template?: number;
}): GenerateSlotsResult {
  const t = getTenant(tenant);
  if (!t) throw new Error(`unknown tenant: ${tenant}`);
  const max_per_template = opts?.max_per_template ?? 200;
  const axesMap = listAxes(tenant);

  let enabled = opts?.templates;
  if (!enabled) {
    try { enabled = JSON.parse(t.templates_enabled || "[]"); } catch { enabled = []; }
  }
  if (!enabled || enabled.length === 0) enabled = Object.keys(TEMPLATES);

  const summary: Record<string, number> = {};
  const allRows: Parameters<typeof bulkUpsertSlots>[0] = [];

  for (const tid of enabled) {
    const spec = TEMPLATES[tid];
    if (!spec) continue;

    const primaryAxis = spec.primary[0];
    const primaryValues = axesMap[primaryAxis] ?? [];
    if (primaryValues.length === 0) { summary[tid] = 0; continue; }

    const personaValues = spec.use_persona
      ? (axesMap.persona.length ? axesMap.persona : [{ value: null }] as unknown as typeof axesMap.persona)
      : [{ value: null }] as unknown as typeof axesMap.persona;
    const intentValues = spec.with_intent
      ? (axesMap.intent.length ? axesMap.intent : [{ value: null }] as unknown as typeof axesMap.intent)
      : [{ value: null }] as unknown as typeof axesMap.intent;
    const modifierValues = axesMap.modifier;

    let modifierCombos: [string | null, string | null][];
    if (spec.modifier_count === 0) {
      modifierCombos = [[null, null]];
    } else if (spec.modifier_count === 1) {
      modifierCombos = modifierValues.length
        ? modifierValues.map((m) => [m.value, null] as [string | null, string | null])
        : [[null, null]];
    } else {
      if (modifierValues.length < 2) {
        modifierCombos = [[modifierValues[0]?.value ?? null, null]];
      } else {
        modifierCombos = combinationsPair(modifierValues.map((m) => m.value));
      }
    }

    let countForTpl = 0;
    outer:
    for (const pv of primaryValues) {
      let primary_keyword: string;
      if (tid === "T01" || tid === "T07") {
        const keywordPool = axesMap.keyword;
        if (keywordPool.length === 0) continue;
        const kwRow = keywordPool[0];
        primary_keyword = `${pv.value}${kwRow.value}`;
      } else {
        primary_keyword = pv.value;
      }

      for (const personaRow of personaValues) {
        for (const intentRow of intentValues) {
          for (const [m1, m2] of modifierCombos) {
            const parts = [
              pv.value ?? "",
              personaRow.value ?? "",
              intentRow.value ?? "",
              m1 ?? "", m2 ?? "",
            ];
            const sid = slotId(tid, parts);

            const sv = pv.monthly_search_volume ?? null;
            const kd = pv.competition_kd ?? null;
            if (sv != null && sv < spec.min_sv) continue;
            const score = priority(sv, kd, spec.weight);

            allRows.push({
              slot_id: sid,
              tenant,
              template_id: tid,
              primary_keyword,
              region: primaryAxis === "region" ? pv.value : null,
              persona: personaRow.value,
              intent: intentRow.value,
              modifier_1: m1,
              modifier_2: m2,
              entity_id: null,
              priority_score: score,
            });
            countForTpl += 1;
            if (countForTpl >= max_per_template) break outer;
          }
        }
      }
    }
    summary[tid] = countForTpl;
  }

  allRows.sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));
  const inserted = bulkUpsertSlots(allRows);
  return { ...summary, _inserted_total: inserted } as GenerateSlotsResult;
}
