import type { SlotForPrompt } from "./prompts";

export interface WebSource {
  title: string;
  url: string;
  excerpt: string;
  trusted: boolean;
}

export interface WebResearchResult {
  query: string;
  sources: WebSource[];
  factsText: string;
  trustedFactsText: string;
}

const SEARCH_TIMEOUT_MS = 12000;
const PAGE_TIMEOUT_MS = 8000;
const USER_AGENT = "Mozilla/5.0 (compatible; SEODesktopBot/1.0; +https://example.local)";

export async function collectWebFacts(slot: SlotForPrompt, limit = 5): Promise<WebResearchResult> {
  const query = buildQuery(slot);
  const results = await searchDuckDuckGo(query, limit);
  const sources: WebSource[] = [];

  for (const result of results) {
    const page = await fetchPageExcerpt(result.url).catch(() => "");
    const excerpt = [result.excerpt, page].filter(Boolean).join("\n").slice(0, 1600);
    sources.push({ ...result, excerpt, trusted: isTrustedSource(result.url) });
  }

  const factsText = sources.length
    ? sources.map((source, index) => (
      `[${index + 1}] ${source.title}\n신뢰도: ${source.trusted ? "검증용" : "참고용"}\nURL: ${source.url}\n발췌: ${source.excerpt}`
    )).join("\n\n")
    : "(웹에서 사용할 수 있는 자료를 찾지 못했습니다.)";
  const trustedFactsText = sources
    .filter((source) => source.trusted)
    .map((source, index) => (
      `[검증 ${index + 1}] ${source.title}\nURL: ${source.url}\n발췌: ${source.excerpt}`
    ))
    .join("\n\n");

  return { query, sources, factsText, trustedFactsText };
}

export function findUnsupportedAcademyNames(markdown: string, sourceText: string): string[] {
  const source = normalize(sourceText);
  const found = new Set<string>();
  const patterns = [
    /[가-힣A-Za-z0-9·&()\- \t]{2,36}(?:운전전문학원|자동차운전전문학원|운전면허학원|운전학원|자동차학원|드라이빙스쿨|드라이빙|스쿨)/g,
  ];

  for (const pattern of patterns) {
    for (const match of markdown.matchAll(pattern)) {
      const name = cleanEntityName(match[0]);
      if (!name || isGenericAcademyPhrase(name)) continue;
      if (!source.includes(normalize(name))) found.add(name);
    }
  }

  return Array.from(found).slice(0, 8);
}

function buildQuery(slot: SlotForPrompt): string {
  const parts = [
    slot.region,
    slot.primary_keyword,
    slot.entity_id,
    "주소 가격 셔틀 후기",
  ].filter(Boolean);
  return parts.join(" ");
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSource[]> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url, SEARCH_TIMEOUT_MS);
  const out: WebSource[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  for (const match of html.matchAll(re)) {
    const rawUrl = decodeDuckUrl(decodeHtml(match[1]));
    if (!rawUrl || isBlockedSource(rawUrl)) continue;
    out.push({
      title: stripTags(decodeHtml(match[2])).trim(),
      url: rawUrl,
      excerpt: stripTags(decodeHtml(match[3])).trim(),
      trusted: isTrustedSource(rawUrl),
    });
    if (out.length >= limit) break;
  }
  return dedupeSources(out).slice(0, limit);
}

async function fetchPageExcerpt(url: string): Promise<string> {
  const html = await fetchText(url, PAGE_TIMEOUT_MS);
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const body = stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " "),
  );
  return [title, decodeHtml(description), body]
    .map((v) => decodeHtml(v).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2400);
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function decodeDuckUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return parsed.href;
  } catch {
    return url;
  }
}

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function decodeHtml(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function dedupeSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.replace(/#.*$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isBlockedSource(url: string): boolean {
  return /duckduckgo\.com|google\.com\/search|bing\.com\/search/i.test(url);
}

function isTrustedSource(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const lowTrust = [
      "blog.naver.com", "m.blog.naver.com", "cafe.naver.com", "post.naver.com",
      "tistory.com", "brunch.co.kr", "medium.com", "velog.io",
      "academy.drivingplus.me",
    ];
    if (lowTrust.some((domain) => host === domain || host.endsWith(`.${domain}`))) return false;
    return true;
  } catch {
    return false;
  }
}

function cleanEntityName(value: string): string {
  return value
    .replace(/^[\s\d.)-]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericAcademyPhrase(value: string): boolean {
  const normalized = normalize(value);
  const generic = [
    "운전면허학원", "자동차학원", "운전학원", "학원", "주변학원", "가까운학원",
    "지역운전면허학원", "대구운전면허학원", "강남운전면허학원", "부산운전면허학원",
    "추천학원", "선택한학원", "학원별", "운전선생",
  ];
  if (generic.includes(normalized)) return true;
  const genericTokens = [
    "가이드", "총정리", "비교", "비용", "가격", "기준", "선택", "지역별",
    "집근처", "직장인", "주말", "주변", "체크", "먼저", "고를때",
    "검증된", "자료", "지역", "방문", "환불", "규정", "운영", "방식",
    "반복", "이번", "세부", "확인", "포인트", "조건", "목록",
    "구체", "단정", "근처", "위표", "후처리", "단계",
    "특정", "추천보다", "대중교통", "접근", "좋은", "같은", "그래서",
  ];
  if (genericTokens.some((token) => normalized.includes(token))) return true;
  if (/^(대구|서울|부산|광주|대전|인천|수원|강남|송파|분당)에서/.test(normalized)) return true;
  if (/^(대구|서울|부산|광주|대전|인천|수원|강남|송파|분당)\s+(1종|2종|보통|대중교통|주말|야간|직장인|초보)/.test(value)) return true;
  if (/\s/.test(value) && /(운전면허학원|운전학원)$/.test(value)) return true;
  if (/[가-힣](에서|으로|부터|까지|보다|처럼|라면|하고|하게|합니다|입니다|에는|은|는|이|가)\s*학원/.test(value)) return true;
  if (/^(대구|서울|부산|광주|대전|인천|수원|강남|송파|분당)\s+\1?운전면허학원$/.test(value)) return true;
  return normalized.length < 5 || /^(대구|서울|부산|광주|대전|인천|수원|강남|송파|분당)?운전면허학원$/.test(normalized);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}
