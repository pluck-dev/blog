/**
 * 레이트리밋 적응 백오프.
 *
 * llm.ts 가 Claude 의 rate_limit_event(rate_limit_info)를 result.rate_limit 로 수집하지만
 * 워커는 지금까지 이를 무시했다. 이 모듈은 그 정보를 방어적으로 해석해(스키마가 버전마다
 * 달라질 수 있으므로) 다음 슬롯 생성 전 추가 대기 시간을 산출한다.
 */

export interface RateSignal {
  /** 0..1 — 여러 윈도우 중 최대 사용률. 알 수 없으면 null. */
  pressure: number | null;
  /** 'allowed' | 'allowed_warning' | 'rejected' 등. 알 수 없으면 null. */
  status: string | null;
  /** 한도 리셋까지 남은 초. 알 수 없으면 null. */
  resetsInSec: number | null;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** 0..1 로 정규화 (백분율 0..100 이면 /100). */
function normPressure(v: number): number {
  const p = v > 1 ? v / 100 : v;
  return Math.min(Math.max(p, 0), 1);
}

/**
 * rate_limit_info 를 방어적으로 파싱. 스키마를 가정하지 않고 흔한 키를 재귀 탐색한다.
 * - 사용률: util/usage/used/percent/pct 류 숫자 → 최댓값
 * - 상태: status 문자열
 * - 리셋: resets_in_seconds / resets_at / reset_at(에폭초 또는 ISO)
 */
export function parseRateSignal(
  rl: Record<string, unknown> | null | undefined,
  nowSec: number = Math.floor(Date.now() / 1000),
): RateSignal {
  const out: RateSignal = { pressure: null, status: null, resetsInSec: null };
  if (!rl || typeof rl !== "object") return out;

  let maxPressure = -1;
  const visit = (obj: Record<string, unknown>, depth: number) => {
    if (depth > 3) return;
    for (const [rawKey, val] of Object.entries(obj)) {
      const key = rawKey.toLowerCase();
      if (out.status === null && key === "status" && typeof val === "string") {
        out.status = val;
      }
      if (/util|usage|used|percent|pct/.test(key)) {
        const n = toNum(val);
        if (n !== null) maxPressure = Math.max(maxPressure, normPressure(n));
      }
      if (out.resetsInSec === null) {
        if (/resets?_in(_seconds)?$/.test(key)) {
          const n = toNum(val);
          if (n !== null) out.resetsInSec = Math.max(0, Math.round(n));
        } else if (/resets?_at$|reset_at$|resets$/.test(key)) {
          const n = toNum(val);
          if (n !== null) {
            // 에폭초로 가정(밀리초면 보정)
            const epoch = n > 1e12 ? n / 1000 : n;
            out.resetsInSec = Math.max(0, Math.round(epoch - nowSec));
          } else if (typeof val === "string") {
            const t = Date.parse(val);
            if (!Number.isNaN(t)) out.resetsInSec = Math.max(0, Math.round(t / 1000 - nowSec));
          }
        }
      }
      if (val && typeof val === "object" && !Array.isArray(val)) {
        visit(val as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(rl, 0);

  if (maxPressure >= 0) out.pressure = maxPressure;
  return out;
}

export interface BackoffOptions {
  /** 백오프 기본 단위 초. 기본 30 */
  baseSec?: number;
  /** 최대 백오프 초. 기본 600(10분) */
  maxSec?: number;
  /** 이 사용률 이상이면 완만한 백오프 시작. 기본 0.75 */
  warnAt?: number;
  /** 이 사용률 이상이면 지수 백오프. 기본 0.9 */
  hardAt?: number;
}

/**
 * 직전 추가대기(prevSec)와 현재 신호로 다음 추가대기(초)를 계산.
 * - rejected: 리셋 시각을 알면 그만큼(상한 내), 모르면 지수 증가
 * - 고압력(>=hardAt): 지수 증가
 * - 경고압력(>=warnAt): 기본 단위만큼
 * - 그 외(회복): 0
 */
export function nextBackoffSec(signal: RateSignal, prevSec: number, opts: BackoffOptions = {}): number {
  const base = opts.baseSec ?? 30;
  const max = opts.maxSec ?? 600;
  const warnAt = opts.warnAt ?? 0.75;
  const hardAt = opts.hardAt ?? 0.9;
  const clamp = (n: number) => Math.min(Math.max(Math.round(n), 0), max);

  const status = signal.status?.toLowerCase() ?? null;
  const rejected = status !== null && /reject|exceed|throttl|denied|429/.test(status);

  if (rejected) {
    if (signal.resetsInSec !== null && signal.resetsInSec > 0) return clamp(signal.resetsInSec);
    return clamp(Math.max(prevSec * 2, base));
  }
  if (signal.pressure !== null && signal.pressure >= hardAt) {
    return clamp(Math.max(prevSec * 2, base));
  }
  if (signal.pressure !== null && signal.pressure >= warnAt) {
    return clamp(Math.max(prevSec, base));
  }
  // 경고성 status 도 완만히 반영
  if (status !== null && /warn/.test(status)) {
    return clamp(Math.max(prevSec, base));
  }
  return 0; // 회복
}
