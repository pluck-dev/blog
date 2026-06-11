import { readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const includeAll = args.includes('--all');
const dbPath = args.find((arg) => arg !== '--all') || 'data/admin.db';
const db = new DatabaseSync(dbPath);
const where = includeAll ? "status != 'deleted'" : "status = 'published'";
const rows = db.prepare(`select id, slot_id, slug, title, status, body_markdown, images, design_template_id from posts where ${where} order by generated_at desc`).all();

function issuesFor(row) {
  const body = String(row.body_markdown || '');
  const images = parseImages(row.images);
  const issues = [];
  const h1 = getH1(body);
  if (!h1) issues.push('missing_h1');
  else if (normalizeTitle(h1) !== normalizeTitle(row.title)) issues.push('h1_title_mismatch');
  if (body.length < 2600) issues.push(`too_short:${body.length}`);
  if (body.length > 5000) issues.push(`too_long:${body.length}`);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const h3 = (body.match(/^###\s+/gm) || []).length;
  const tableRows = countMarkdownTableRows(body);
  const listItems = countListItems(body);
  const paragraphs = getParagraphs(body);
  const faqQuestions = countFaqQuestions(body);
  if (h2 < 6) issues.push(`few_h2:${h2}`);
  if (!row.design_template_id) issues.push('missing_design_template_id');
  if (!['editorial', 'comparison', 'local-guide', 'checklist', 'conversion', 'custom'].includes(String(row.design_template_id || ''))) issues.push(`unknown_design_template:${row.design_template_id}`);
  if (h2 >= 6 && !hasFinalUtilitySection(body)) issues.push('template_structure_missing_final_utility_section');
  if (hasFlatParagraphRun(paragraphs)) issues.push('too_flat_paragraphs');
  if (/운전선생|Driving\s*Plus|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|localhost:\d+|127\.0\.0\.1|샘플|데모|sample|demo|dummy|placeholder|TODO|FIXME|내부\s*(?:API|데이터|자료)|검증된\s*(?:API|자료|데이터)|API\s*(?:URL|자료|데이터)|참고\s*API/i.test(body + row.title)) issues.push('internal_or_wrong_brand_leak');
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(String(row.title || '') + '\n' + h1)) issues.push('keyword_spacing_issue');
  if (/상담전확인|동선확인|비용절약|셔틀편리|비교추천/.test(body + row.title)) issues.push('compact_korean_spacing');
  if (/참고자료/.test(body) && !/도로교통공단|경찰청|정부24|법제처/.test(body)) issues.push('weak_source_section');
  if (/\*\*[^*]+\*\*/.test(body)) issues.push('raw_bold_markdown');
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(body)) issues.push('pseudo_slot');
  if (/\[\d+\]/.test(body)) issues.push('visible_citation_marker');
  if (!/(FAQ|자주 묻는 질문|질문과 답변)/i.test(body)) issues.push('missing_faq');
  else if (faqQuestions > 0 && faqQuestions < 2) issues.push(`thin_faq:${faqQuestions}`);
  if (!listItems) issues.push('missing_list');
  if (!hasRichStructure({ tableRows, listItems, faqQuestions })) issues.push('missing_rich_structure');
  if (requiresComparisonTable(row, body) && tableRows < 3) issues.push(`missing_comparison_table:${tableRows}`);
  const imageKeys = Object.keys(images);
  const usedImageKeys = [...body.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image:${[...new Set(unknown)].join(',')}`);
  return { issues, chars: body.length, h2, h3, tableRows, listItems, paragraphs: paragraphs.length, faqQuestions, imageCount: imageKeys.length, imageTokens: usedImageKeys.length };
}

function getH1(body) {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getParagraphs(body) {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:#{1,6}\s+|\|.+\||[-*]\s+|\d+[.)]\s+|>|\[IMAGE:)/m.test(part));
}

function hasFlatParagraphRun(paragraphs) {
  let run = 0;
  for (const paragraph of paragraphs) {
    if (paragraph.length > 360 || paragraph.split(/[.!?。]|[다요죠음임함됨봄룸움]\./).filter(Boolean).length > 6) {
      run += 1;
      if (run >= 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function countMarkdownTableRows(body) {
  const rows = body.match(/^\|.+\|$/gm) || [];
  return rows.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row)).length;
}

function countListItems(body) {
  return (body.match(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/g) || []).length;
}

function countFaqQuestions(body) {
  const faqStart = body.search(/^(?:##|###)\s+.*(?:FAQ|자주 묻는 질문|질문과 답변)/im);
  if (faqStart < 0) return 0;
  const faq = body.slice(faqStart);
  const matches = faq.match(/(^|\n)\s*(?:#{2,4}\s*)?(?:[-*]\s*)?(?:Q[.:)]|Q\d+[.)]|질문\s*\d*|[가-힣\s]+(?:인가요|되나요|하나요|좋나요|있나요)\?)/g);
  return matches ? matches.length : 0;
}

function hasFinalUtilitySection(body) {
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]);
  return headings.some((heading) => /FAQ|자주 묻는 질문|질문과 답변|체크리스트|상담|확인|마무리|요약/i.test(heading));
}

function hasRichStructure({ tableRows, listItems, faqQuestions }) {
  const blocks = [tableRows >= 3, listItems >= 3, faqQuestions >= 2].filter(Boolean).length;
  return blocks >= 2;
}

function requiresComparisonTable(row, body) {
  const title = String(row.title || '');
  const headings = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]).join('\n');
  return /(?:\d+\s*곳|BEST\s*\d+)/i.test(`${title}\n${headings}`);
}

function parseImages(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((url, i) => [`image_${i + 1}`, url]));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

const reports = rows.map((row) => ({ row, ...issuesFor(row) }));
const bad = reports.filter((r) => r.issues.length);
const outputHtmlArtifacts = findOutputHtmlArtifacts(process.cwd());
console.log(JSON.stringify({ checked: rows.length, failed: bad.length, outputHtmlArtifacts, failures: bad.map((r) => ({ id: r.row.id, slot_id: r.row.slot_id, status: r.row.status, chars: r.chars, h2: r.h2, h3: r.h3, tableRows: r.tableRows, listItems: r.listItems, paragraphs: r.paragraphs, faqQuestions: r.faqQuestions, images: r.imageCount, imageTokens: r.imageTokens, design_template_id: r.row.design_template_id, title: r.row.title, issues: r.issues })) }, null, 2));
if (bad.length || outputHtmlArtifacts.length) process.exit(1);

function findOutputHtmlArtifacts(root) {
  const found = [];
  walk(root, found);
  return found.sort();
}

function walk(dir, found) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  const isOutputDir = basename(dir) === 'output';
  for (const entry of entries) {
    if (['.git', '.next', 'dist', 'node_modules', '.omx'].includes(entry)) continue;
    const path = join(dir, entry);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) {
      walk(path, found);
    } else if (isOutputDir && entry.endsWith('.html')) {
      found.push(relative(process.cwd(), path));
    }
  }
}
