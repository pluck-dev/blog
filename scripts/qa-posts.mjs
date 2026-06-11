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
  if (!body.trim().startsWith('# ')) issues.push('missing_h1');
  if (body.length < 2600) issues.push(`too_short:${body.length}`);
  if (body.length > 5000) issues.push(`too_long:${body.length}`);
  const h2 = (body.match(/^##\s+/gm) || []).length;
  if (h2 < 6) issues.push(`few_h2:${h2}`);
  if (/운전선생|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|DrivingPlus/i.test(body + row.title)) issues.push('internal_or_wrong_brand_leak');
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(String(row.title || ''))) issues.push('keyword_spacing_issue');
  if (/참고자료/.test(body) && !/도로교통공단|경찰청|정부24|법제처/.test(body)) issues.push('weak_source_section');
  if (/\*\*[^*]+\*\*/.test(body)) issues.push('raw_bold_markdown');
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(body)) issues.push('pseudo_slot');
  if (/\[\d+\]/.test(body)) issues.push('visible_citation_marker');
  if (!/(FAQ|자주 묻는 질문|질문과 답변)/i.test(body)) issues.push('missing_faq');
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/m.test(body)) issues.push('missing_list');
  const imageKeys = Object.keys(images);
  const usedImageKeys = [...body.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)].map((m) => m[1]);
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image:${[...new Set(unknown)].join(',')}`);
  return { issues, chars: body.length, h2, imageCount: imageKeys.length, imageTokens: usedImageKeys.length };
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
console.log(JSON.stringify({ checked: rows.length, failed: bad.length, failures: bad.map((r) => ({ id: r.row.id, slot_id: r.row.slot_id, status: r.row.status, chars: r.chars, h2: r.h2, images: r.imageCount, imageTokens: r.imageTokens, title: r.row.title, issues: r.issues })) }, null, 2));
if (bad.length) process.exit(1);
