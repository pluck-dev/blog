import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const includeAll = args.includes('--all');
const dbPath = args.find((arg) => arg !== '--all') || 'data/admin.db';
const db = new DatabaseSync(dbPath);
const where = includeAll ? "status != 'deleted'" : "status = 'published'";
const rows = db.prepare(`select p.id, p.slot_id, p.slug, p.title, p.status, p.body_markdown, p.images, p.design_template_id,
  (select count(*) from academies a join slots s2 on s2.slot_id=p.slot_id where a.tenant=p.tenant and s2.region is not null and a.region=s2.region) as exact_academy_count
  from posts p where p.${where} order by p.generated_at desc`).all();

function issuesFor(row) {
  const body = String(row.body_markdown || '');
  const images = parseImages(row.images);
  const issues = [];
  const h1 = getH1(body);
  if (!h1) issues.push('missing_h1');
  else if (normalizeTitle(h1) !== normalizeTitle(row.title)) issues.push('h1_title_mismatch');
  if (body.length < 3200) issues.push(`too_short:${body.length}`);
  if (body.length > 5600) issues.push(`too_long:${body.length}`);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  const h3 = (body.match(/^###\s+/gm) || []).length;
  const tableRows = countMarkdownTableRows(body);
  const listItems = countListItems(body);
  const paragraphs = getParagraphs(body);
  const faqQuestions = countFaqQuestions(body);
  if (h2 < 4) issues.push(`few_h2:${h2}`);
  if (h2 > 12) issues.push(`too_many_h2:${h2}`);
  const readability = readabilityIssues(body);
  issues.push(...readability);
  if (!row.design_template_id) issues.push('missing_design_template_id');
  if (!['editorial', 'comparison', 'local-guide', 'checklist', 'conversion', 'custom'].includes(String(row.design_template_id || ''))) issues.push(`unknown_design_template:${row.design_template_id}`);
  if (h2 >= 4 && !hasFinalUtilitySection(body)) issues.push('template_structure_missing_final_utility_section');
  if (hasFlatParagraphRun(paragraphs)) issues.push('too_flat_paragraphs');
  if (/운전선생|Driving\s*Plus|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|localhost:\d+|127\.0\.0\.1|샘플|데모|sample|demo|dummy|placeholder|TODO|FIXME|내부\s*(?:API|데이터|자료)|검증된\s*(?:API|자료|데이터)|API\s*(?:URL|자료|데이터)|참고\s*API|긍정\s*(?:수강생|블로그)\s*리뷰(?:글)?\s*보충자료|짧은\s*실제\s*문구/i.test(body + row.title)) issues.push('internal_or_wrong_brand_leak');
  if (/\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합\s*격|무조건\s*합\s*격|합\s*격\s*보장|보장\s*합\s*격/u.test(body + row.title)) issues.push('risky_duration_or_pass_guarantee_claim');
  const inflated = inflatedCandidateCountClaim(`${row.title}
${body}`, Math.min(Number(row.exact_academy_count || 0), 5));
  if (inflated) issues.push(`inflated_candidate_count:${inflated.claimed}>${inflated.actual}`);
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(String(row.title || '') + '\n' + body)) issues.push('keyword_spacing_issue');
  if (/상담전확인|동선확인|비용절약|셔틀편리|비교추천/.test(body + row.title)) issues.push('compact_korean_spacing');
  if (/참고자료/.test(body) && !/도로교통공단|경찰청|정부24|법제처/.test(body)) issues.push('weak_source_section');
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(body)) issues.push('pseudo_slot');
  if (/\[\d+\]/.test(body)) issues.push('visible_citation_marker');
  if (faqQuestions > 0 && faqQuestions < 2) issues.push(`thin_faq:${faqQuestions}`);
  if (!listItems) issues.push('missing_list');
  if (!hasRichStructure({ tableRows, listItems, faqQuestions })) issues.push('missing_rich_structure');
  if (tableRows < 3) issues.push(`missing_summary_or_comparison_table:${tableRows}`);
  const imageKeys = Object.keys(images);
  const usedImageKeys = [...body.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
  if (imageKeys.length && !usedImageKeys.length) issues.push('missing_available_image_slot');
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image:${[...new Set(unknown)].join(',')}`);
  const rendered = renderMarkdown(body, images);
  issues.push(...renderedSurfaceIssues(rendered, { h2, tableRows, usedImageKeys }));
  return { issues, chars: body.length, h2, h3, tableRows, listItems, paragraphs: paragraphs.length, faqQuestions, imageCount: imageKeys.length, imageTokens: usedImageKeys.length };
}

function readabilityIssues(body) {
  const issues = [];
  const paragraphs = getParagraphs(body);
  const long = paragraphs.filter((paragraph) => paragraph.length > 420);
  if (long.length) issues.push(`overlong_paragraph:${Math.max(...long.map((p) => p.length))}`);
  if (adjacentHeadingCount(body) > 2) issues.push('adjacent_headings_without_body');
  if (orphanHeadingCount(body) > 3) issues.push('too_many_thin_or_empty_heading_sections');
  return issues;
}

function adjacentHeadingCount(body) {
  const lines = String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^#{2,3}\s+/.test(lines[i] || '') && /^#{2,3}\s+/.test(lines[i + 1] || '')) count++;
  }
  return count;
}

function orphanHeadingCount(body) {
  const sections = String(body || '').split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    lines.shift();
    const text = lines.join('\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, '')
      .replace(/^\|.+\|$/gm, '')
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, '')
      .replace(/^#{3,6}\s+.+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && text.length < 80) count++;
  }
  return count;
}

function inflatedCandidateCountClaim(markdown, actual) {
  if (!actual || actual < 1) return null;
  const headings = [...String(markdown || '').matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1] || '');
  const titleLine = String(markdown || '').split(/\r?\n/, 1)[0] || '';
  const targets = [...new Set([titleLine.replace(/^#\s+/, ''), ...headings])];
  let maxClaim = 0;
  for (const target of targets) for (const count of candidateCountClaims(target)) maxClaim = Math.max(maxClaim, count);
  return maxClaim > actual ? { claimed: maxClaim, actual } : null;
}

function candidateCountClaims(value) {
  const text = String(value || '');
  const claims = [];
  const patterns = [
    /(?:BEST|TOP)\s*(\d{1,2})/giu,
    /(?:추천|비교|후보|학원)\s*(\d{1,2})\s*(?:곳|개)/gu,
    /(\d{1,2})\s*(?:곳|개)\s*(?:추천|비교|후보|학원)/gu,
    /운전면허학원\s*(\d{1,2})\s*(?:곳|개)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) claims.push(n);
    }
  }
  return claims;
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

function parseImages(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    if (Array.isArray(parsed)) return Object.fromEntries(parsed.map((url, i) => [`image_${i + 1}`, url]));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function renderedSurfaceIssues(html, expected) {
  const issues = [];
  const text = stripTags(html);
  const h1Count = (html.match(/<h1>/g) || []).length;
  const h2Count = (html.match(/<h2>/g) || []).length;
  const tableRowCount = (html.match(/<tr>/g) || []).length;
  const renderedImageCount = (html.match(/<figure class="post-image">/g) || []).length;
  if (!html.trim()) issues.push('rendered_empty');
  if (/\[IMAGE:[A-Za-z0-9_-]+\]/.test(html)) issues.push('rendered_raw_image_token');
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(html)) issues.push('rendered_pseudo_slot');
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(text)) issues.push('rendered_keyword_spacing_issue');
  if (h1Count !== 1) issues.push(`rendered_h1_count:${h1Count}`);
  if (h2Count < expected.h2) issues.push(`rendered_missing_h2:${h2Count}/${expected.h2}`);
  if (tableRowCount < expected.tableRows) issues.push(`rendered_missing_table_rows:${tableRowCount}/${expected.tableRows}`);
  if (expected.usedImageKeys.length && renderedImageCount !== expected.usedImageKeys.length) issues.push(`rendered_image_mismatch:${renderedImageCount}/${expected.usedImageKeys.length}`);
  if (/<h1>[\s\S]*\n[\s\S]*<\/h1>/.test(html)) issues.push('rendered_h1_wraps_body');
  return issues;
}

function renderMarkdown(markdown, images = {}) {
  return markdownBlocks(markdown).map((raw) => renderMarkdownBlock(raw, images)).filter(Boolean).join('\n');
}

function markdownBlocks(markdown) {
  const blocks = [];
  let current = [];
  let currentKind = null;
  const flush = () => {
    if (!current.length) return;
    blocks.push(current.join('\n').trim());
    current = [];
    currentKind = null;
  };
  for (const line of String(markdown || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(trimmed)) { flush(); continue; }
    if (/^#{1,3}\s+/.test(trimmed) || /^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(trimmed)) { flush(); blocks.push(trimmed); continue; }
    const kind = trimmed.includes('|') ? 'table' : isListLine(trimmed) ? 'list' : trimmed.startsWith('>') ? 'quote' : 'paragraph';
    if (currentKind && currentKind !== kind) flush();
    currentKind = kind;
    current.push(trimmed);
  }
  flush();
  return blocks;
}

function renderMarkdownBlock(raw, images) {
  if (/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(raw)) return '';
  const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
  if (imageMatch) {
    const src = images[imageMatch[1]];
    return src ? `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(imageMatch[1])}" loading="lazy" /></figure>` : '';
  }
  if (isMarkdownTable(raw)) return renderMarkdownTable(raw);
  if (isMarkdownListBlock(raw)) return renderMarkdownList(raw);
  if (raw.startsWith('>')) return `<blockquote>${renderInline(raw.replace(/^>\s?/gm, '')).replace(/\n/g, '<br>')}</blockquote>`;
  if (raw.startsWith('# ')) return `<h1>${renderInline(raw.slice(2))}</h1>`;
  if (raw.startsWith('## ')) return `<h2>${renderInline(raw.slice(3))}</h2>`;
  if (raw.startsWith('### ')) return `<h3>${renderInline(raw.slice(4))}</h3>`;
  return `<p>${renderInline(raw).replace(/\n/g, '<br>')}</p>`;
}

function isListLine(line) {
  return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^[✅✔✓]\s*/.test(line);
}

function isMarkdownListBlock(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every(isListLine);
}

function renderMarkdownList(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line));
  const tag = ordered ? 'ol' : 'ul';
  const items = lines.map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').replace(/^[✅✔✓]\s*/, ''));
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</${tag}>`;
}

function isMarkdownTable(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 3 && lines[0].includes('|') && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1]);
}

function renderMarkdownTable(raw) {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length);
  return `<div class="post-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${renderInline(row[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function splitTableRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderInline(raw) {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="nofollow noopener">${label}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  return s;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ');
}

const reports = rows.map((row) => ({ row, ...issuesFor(row) }));
const bad = reports.filter((r) => r.issues.length);
const outputHtmlArtifacts = findOutputHtmlArtifacts(process.cwd());
const detailTemplateIssues = detailTemplateQualityIssues();
console.log(JSON.stringify({ checked: rows.length, failed: bad.length, outputHtmlArtifacts, detailTemplateIssues, failures: bad.map((r) => ({ id: r.row.id, slot_id: r.row.slot_id, status: r.row.status, chars: r.chars, h2: r.h2, h3: r.h3, tableRows: r.tableRows, listItems: r.listItems, paragraphs: r.paragraphs, faqQuestions: r.faqQuestions, images: r.imageCount, imageTokens: r.imageTokens, design_template_id: r.row.design_template_id, title: r.row.title, issues: r.issues })) }, null, 2));
if (bad.length || outputHtmlArtifacts.length || detailTemplateIssues.length) process.exit(1);

function detailTemplateQualityIssues() {
  const issues = [];
  let source = '';
  try {
    source = readFileSync('apps/admin-next/components/PostDetailClient.tsx', 'utf8');
  } catch (error) {
    return [`detail_template_unreadable:${error.message}`];
  }
  if (/<h4>\{post\.title\}<\/h4>/.test(source)) issues.push('detail_duplicate_title_after_hero');
  if (/className="[^"]*post-lead[^"]*"/.test(source) || /class="[^"]*post-lead[^"]*"/.test(source)) issues.push('detail_duplicate_meta_description_after_hero');
  if (/preview-hero[\s\S]{0,800}post\.meta_description/.test(source)) issues.push('detail_duplicate_meta_description_in_hero');
  if (/pageBg:\s*"#(?!fff(?:fff)?")/i.test(source)) issues.push('detail_article_background_not_white');
  return issues;
}

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
