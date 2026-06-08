import type { Provider, Axis } from "@shared/types";
import { bulkReplaceAxis } from "./db";
import { runLlm } from "./llm";

const SYSTEM_PROMPT = `당신은 한국어 SEO 전략가입니다.
주어진 업종에 대해 프로그래매틱 SEO 슬롯 생성에 쓸 5개 축의 값을 추천합니다.

축 정의:
- region: 지역(시/군/구). 업종이 지역 비즈니스가 아니면 빈 배열.
- keyword: 핵심 검색 키워드 (메인 + 롱테일). 5~12개.
- intent: 검색 의도 (비교추천/가이드총정리/비용절약/후기리뷰/시험팁/안전성/가격정보 등 업종에 맞게). 4~6개.
- persona: 타깃 고객 페르소나. 4~7개.
- modifier: 마케팅 수식어 (가성비/최단기/친절/24시 등). 5~10개.

각 값에 메타 정보:
- weight: 1~10 (우선순위, 핵심 키워드일수록 높게)
- monthly_search_volume: 추정 월간 검색량 (없으면 null)
- competition_kd: 추정 경쟁 강도 0~100 (없으면 null)

응답은 반드시 JSON 객체 하나만, 다른 설명 없이:
{
  "region": [{"value":"강남","weight":5,"monthly_search_volume":3200,"competition_kd":68}],
  "keyword": [{"value":"강남 임플란트","weight":9,"monthly_search_volume":2400,"competition_kd":55}],
  "intent": [{"value":"비교추천","weight":5}],
  "persona": [{"value":"20대 직장인","weight":5}],
  "modifier": [{"value":"당일진료","weight":4}]
}`;

export function buildAxesPrompt(vertical: string, context = ""): string {
  let body = `업종: ${vertical}\n`;
  if (context.trim()) body += `추가 컨텍스트: ${context.trim()}\n`;
  body += "\n위 업종에 가장 맞는 5축 값을 JSON 으로만 답하세요.";
  return SYSTEM_PROMPT + "\n\n" + body;
}

function extractJson(text: string): Record<string, unknown> | null {
  const fence = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch { /* ignore */ }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

interface NormalizedValue {
  value: string;
  weight: number;
  monthly_search_volume: number | null;
  competition_kd: number | null;
}

function normalizeValue(v: unknown): NormalizedValue | null {
  if (typeof v === "string") {
    const value = v.trim();
    if (!value) return null;
    return { value, weight: 3, monthly_search_volume: null, competition_kd: null };
  }
  if (!v || typeof v !== "object") return null;
  const obj = v as Record<string, unknown>;
  const value = typeof obj.value === "string" ? obj.value.trim() : "";
  if (!value) return null;

  let weight = 3;
  if (typeof obj.weight === "number") weight = Math.floor(obj.weight);
  else if (typeof obj.weight === "string") {
    const n = parseInt(obj.weight, 10);
    if (!isNaN(n)) weight = n;
  }
  weight = Math.max(1, Math.min(10, weight));

  let sv: number | null = null;
  if (typeof obj.monthly_search_volume === "number") sv = Math.floor(obj.monthly_search_volume);
  else if (typeof obj.monthly_search_volume === "string") {
    const n = parseInt(obj.monthly_search_volume, 10);
    if (!isNaN(n)) sv = n;
  }
  let kd: number | null = null;
  if (typeof obj.competition_kd === "number") kd = Math.floor(obj.competition_kd);
  else if (typeof obj.competition_kd === "string") {
    const n = parseInt(obj.competition_kd, 10);
    if (!isNaN(n)) kd = n;
  }

  return { value, weight, monthly_search_volume: sv, competition_kd: kd };
}

export async function generateAxesViaAi(args: {
  tenant: string;
  vertical: string;
  context?: string;
  provider?: Provider;
  model?: string;
  timeout_sec?: number;
}): Promise<Record<string, number | string | null>> {
  const prompt = buildAxesPrompt(args.vertical, args.context ?? "");
  const result = await runLlm(prompt, {
    provider: args.provider ?? "claude",
    model: args.model ?? "",
    timeout_sec: args.timeout_sec ?? 300,
  });
  if (!result.ok || !result.summary.trim()) {
    throw new Error(`LLM call failed: ${result.error ?? "empty response"}`);
  }
  const parsed = extractJson(result.summary);
  if (!parsed) {
    throw new Error(`Could not parse JSON from LLM response: ${result.summary.slice(0, 300)}`);
  }

  const summary: Record<string, number | string | null> = {};
  const axes: Axis[] = ["region", "keyword", "intent", "persona", "modifier"];
  for (const axis of axes) {
    const raw = parsed[axis];
    if (!Array.isArray(raw)) { summary[axis] = 0; continue; }
    const normalized = raw.map(normalizeValue).filter((v): v is NormalizedValue => v !== null);
    if (normalized.length === 0) { summary[axis] = 0; continue; }
    bulkReplaceAxis({ tenant: args.tenant, axis, values: normalized });
    summary[axis] = normalized.length;
  }
  summary._provider = result.provider;
  summary._model = result.model;
  summary._duration_sec = Math.round(result.duration_sec * 10) / 10;
  return summary;
}
