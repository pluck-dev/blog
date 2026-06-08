const MIN_TEXT_CHARS = Number(process.env.SEO_QUALITY_MIN_TEXT_CHARS ?? "2700");
const MAX_TEXT_CHARS = 6500;
const MIN_H2 = 5;
const MAX_H2 = 9;
const MIN_IMAGES = 3;

const AI_CLICHES = [
  "이 글에서는",
  "오늘은 알아보겠습니다",
  "본격적으로 알아보",
  "도움이 되셨",
  "유용한 정보",
];

// 절대 본문에 노출되면 안 되는 경쟁사명.
const COMPETITORS = ["운전선생"];

export interface QualityReport {
  ok: boolean;
  issues: string[];
  text_chars: number;
  h2_count: number;
  image_slot_count: number;
  table_slot_count: number;
}

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/\[(TABLE|IMAGE)_SLOT:[^\]]+\]/g, "")
    .replace(/\[INTERNAL_LINK:[^\]]+\]/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>|-]/g, "")
    .replace(/\s+/g, "");
}

export function qualitySummary(report: QualityReport): string {
  if (report.ok) {
    return `quality ok: text=${report.text_chars}, h2=${report.h2_count}, images=${report.image_slot_count}, tables=${report.table_slot_count}`;
  }
  return report.issues.join("; ");
}

export interface ValidateOptions {
  requireSources?: boolean;
}

export function validatePost(markdown: string, brandName?: string | null, opts?: ValidateOptions): QualityReport {
  const text_chars = stripMarkdown(markdown).length;
  const h1Count = countMatches(markdown, /^# [^#]/gm);
  const h2_count = countMatches(markdown, /^## [^#]/gm);
  const imageSlots = countMatches(markdown, /\[IMAGE_SLOT:[^\]]+\]/g);
  const markdownImages = countMatches(markdown, /!\[[^\]]*\]\([^)]+\)/g);
  const image_slot_count = imageSlots + markdownImages;
  const tableSlots = countMatches(markdown, /\[TABLE_SLOT:[^\]]+\]/g);
  const markdownTableLines = countMatches(markdown, /^\|.+\|\s*$/gm);
  const table_slot_count = tableSlots + markdownTableLines;
  const blockquotes = countMatches(markdown, /^>\s+/gm);
  const bullets = countMatches(markdown, /^\s*(?:[-*]|\d+[.)])\s+/gm);
  const internalLinks = countMatches(markdown, /\[INTERNAL_LINK:[^\]]+\]/g);

  const issues: string[] = [];
  if (h1Count !== 1) issues.push(`H1 must be exactly 1, got ${h1Count}`);
  if (text_chars < MIN_TEXT_CHARS) issues.push(`text too short: ${text_chars} chars, minimum ${MIN_TEXT_CHARS}`);
  if (text_chars > MAX_TEXT_CHARS) issues.push(`text too long: ${text_chars} chars, maximum ${MAX_TEXT_CHARS}`);
  if (h2_count < MIN_H2 || h2_count > MAX_H2) issues.push(`H2 count must be ${MIN_H2}-${MAX_H2}, got ${h2_count}`);
  if (image_slot_count < MIN_IMAGES) issues.push(`image slots/images must be at least ${MIN_IMAGES}, got ${image_slot_count}`);
  if (table_slot_count < 1) issues.push("missing table slot or markdown table");
  if (blockquotes < 1) issues.push("missing blockquote review/example");
  if (bullets < 1) issues.push("missing checklist or bullet list");
  if (internalLinks < 1) issues.push("missing INTERNAL_LINK placeholder");
  const brand = brandName?.trim();
  if (brand && !markdown.includes(brand)) issues.push(`missing ${brand} CTA mention`);
  // 경쟁사명은 브랜드 설정 여부와 무관하게 절대 본문에 노출 금지.
  for (const competitor of COMPETITORS) {
    if (competitor !== brand && markdown.includes(competitor)) {
      issues.push(`경쟁사명 노출 금지: '${competitor}' 이(가) 본문에 포함됨`);
    }
  }

  const cliches = AI_CLICHES.filter((phrase) => markdown.includes(phrase));
  if (cliches.length) issues.push(`AI cliché phrases found: ${cliches.join(", ")}`);

  if (opts?.requireSources) {
    const hasReferenceSection = /^##\s*참고\s*자료/m.test(markdown);
    const citationCount = countMatches(markdown, /\[\d+\]/g);
    if (!hasReferenceSection) issues.push("웹자료를 사용했으나 '## 참고자료' 섹션이 없음");
    if (citationCount < 1) issues.push("본문에 출처 번호([1] 등) 인용이 1개도 없음");
  }
  // 가짜 출처 꼬리표(근거 없는 '출처: 브랜드명') 사용 금지
  if (/출처\s*[:：]\s*운전선생/.test(markdown)) {
    issues.push("근거 없는 가짜 출처 꼬리표('출처: 운전선생') 사용");
  }

  return { ok: issues.length === 0, issues, text_chars, h2_count, image_slot_count, table_slot_count };
}

export function retryPrompt(originalPrompt: string, report: QualityReport, brandName?: string | null, opts?: ValidateOptions): string {
  const brand = brandName?.trim() || "브랜드";
  const sourceRule = opts?.requireSources
    ? "제공된 웹자료에서 가져온 수치·가격·후기는 문장 끝에 [1] 형식 출처 번호를 달고, 글 끝에 '## 참고자료' 섹션으로 인용한 출처(제목 — URL)를 나열하세요. 근거 없는 수치는 '상담 시 확인'으로 바꾸고 가짜 출처 꼬리표는 쓰지 마세요.\n"
    : "";
  return (
    `${originalPrompt}\n\n` +
    "위 조건으로 다시 작성하세요. 이전 출력은 발행 품질 기준을 통과하지 못했습니다.\n" +
    `미달 항목: ${qualitySummary(report)}\n` +
    "반드시 본문 공백 제외 3,200자 이상, H2 5개 이상, 이미지 슬롯 3개 이상, " +
    `표 슬롯 1개 이상, 후기 인용 1개, 체크리스트 1개, ${brand} CTA와 INTERNAL_LINK를 포함하세요.\n` +
    sourceRule +
    `브랜드명은 반드시 ${brand}만 사용하고 다른 서비스명은 쓰지 마세요.\n` +
    "마크다운 본문만 출력하세요."
  );
}
