/**
 * Google Indexing API 클라이언트 — 외부 라이브러리 없이 Node crypto 만 사용.
 *
 * 흐름: 서비스계정 JSON → RS256 JWT 서명 → oauth2 토큰 교환 → urlNotifications:publish.
 * 서비스계정 키가 없으면 isConfigured()=false 로 안전하게 비활성(크래시 X).
 *
 * 주의: Indexing API 는 공식적으로 JobPosting/BroadcastEvent 페이지용이며,
 * 일반 페이지 제출은 구글 약관상 권장 용도가 아니다(회색지대). 서비스계정 이메일을
 * 각 사이트 Search Console 속성에 "소유자"로 추가해야 실제 제출이 동작한다.
 */

import { createSign } from "crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PUBLISH_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

export type NotifyType = "URL_UPDATED" | "URL_DELETED";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 서비스계정 JSON 문자열을 파싱·검증. 실패 시 명확한 에러. */
export function parseServiceAccount(jsonText: string | null | undefined): ServiceAccount {
  if (!jsonText || !jsonText.trim()) {
    throw new Error("서비스계정 키가 설정되지 않았습니다(미설정).");
  }
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    throw new Error("서비스계정 JSON 형식이 올바르지 않습니다.");
  }
  const email = typeof obj.client_email === "string" ? obj.client_email : "";
  const key = typeof obj.private_key === "string" ? obj.private_key : "";
  if (!email || !key) {
    throw new Error("서비스계정 JSON 에 client_email / private_key 가 없습니다.");
  }
  return { client_email: email, private_key: key, token_uri: typeof obj.token_uri === "string" ? obj.token_uri : TOKEN_URL };
}

/** 키가 유효하게 설정돼 있으면 true(네트워크 호출 없음). */
export function isConfigured(jsonText: string | null | undefined): boolean {
  try {
    parseServiceAccount(jsonText);
    return true;
  } catch {
    return false;
  }
}

/** 서비스계정으로 서명한 JWT(assertion). nowSec 주입 가능(테스트용). */
export function buildAssertion(sa: ServiceAccount, nowSec: number = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: sa.token_uri || TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(sa.private_key);
  return `${signingInput}.${base64url(signature)}`;
}

/** JWT → access_token 교환. */
export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const assertion = buildAssertion(sa);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const res = await fetch(sa.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const desc = (json.error_description || json.error || `HTTP ${res.status}`) as string;
    throw new Error(`토큰 발급 실패: ${desc}`);
  }
  return json.access_token;
}

export interface SubmitResult {
  url: string;
  ok: boolean;
  error?: string;
}

/** 단일 URL 색인 알림 제출. */
export async function submitUrl(accessToken: string, url: string, type: NotifyType = "URL_UPDATED"): Promise<SubmitResult> {
  try {
    const res = await fetch(PUBLISH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ url, type }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const err = json.error as { message?: string } | undefined;
      return { url, ok: false, error: err?.message || `HTTP ${res.status}` };
    }
    return { url, ok: true };
  } catch (e) {
    return { url, ok: false, error: (e as Error).message };
  }
}

/** 템플릿({domain}/{slug})으로 발행 URL 생성. */
export function buildPostUrl(template: string, domain: string, slug: string): string {
  const t = template?.trim() || "https://{domain}/{slug}";
  return t.replace(/\{domain\}/g, domain).replace(/\{slug\}/g, slug);
}
