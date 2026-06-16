import { DbService, safeJson } from "./db.service.js";

type Row = Record<string, any>;

export function renderMarkdown(markdown: string, images: Record<string, string> = {}): string {
  return markdownBlocks(markdown).map((raw) => renderMarkdownBlock(raw, images)).filter(Boolean).join("\n");
}

export function stripPseudoSlotsForRender(markdown: string): string {
  return markdown.split(/\r?\n/)
    .filter((line) => !/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]$/i.test(line.trim()))
    .join("\n")
    .replace(/\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]/gi, "")
    .replace(/\[INTERNAL_LINK:[^\]]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ensureImageSlotsForRender(markdown: string, images: Record<string, string>): string {
  const keys = Object.keys(images).sort((a, b) => a.localeCompare(b));
  if (!keys.length || /\[IMAGE:[A-Za-z0-9_-]+\]/.test(markdown)) return markdown;
  const insertions = keys.slice(0, Math.min(4, keys.length)).map((key) => `[IMAGE:${key}]`);
  const blocks = markdown.split(/\n{2,}/);
  if (blocks.length <= 2) return `${markdown}\n\n${insertions.join("\n\n")}`.trim();
  blocks.splice(Math.min(3, blocks.length), 0, insertions[0]!);
  if (insertions[1]) blocks.splice(Math.max(5, Math.floor(blocks.length * 0.55)), 0, insertions[1]);
  if (insertions[2]) blocks.splice(Math.max(7, Math.floor(blocks.length * 0.75)), 0, insertions[2]);
  if (insertions[3]) blocks.splice(Math.max(9, Math.floor(blocks.length * 0.88)), 0, insertions[3]);
  return blocks.join("\n\n").trim();
}

export function fallbackImagesForPost(db: DbService, tenant: string, post: Row): Record<string, string> {
  const slot = post.slot_id ? db.getSlot(post.slot_id) : null;
  if (!slot?.region) return {};
  const images: Record<string, string> = {};
  const region = String(slot.region);
  let academies = db.listAcademies(tenant, { region, limit: 5 });
  if (!academies.length) {
    academies = db.listAcademies(tenant, { limit: 5000 }).filter((academy) => String(academy.region || "") === region || String(academy.address || "").includes(region)).slice(0, 5);
  }
  for (const [i, academy] of academies.entries()) {
    const url = firstAcademyImageUrl(academy);
    if (url) images[`academy_${i + 1}`] = url;
  }
  return images;
}

function markdownBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let currentKind: "paragraph" | "list" | "quote" | "table" | null = null;
  const flush = () => {
    if (!current.length) return;
    blocks.push(current.join("\n").trim());
    current = [];
    currentKind = null;
  };
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(trimmed)) { flush(); continue; }
    if (/^#{1,3}\s+/.test(trimmed) || /^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(trimmed)) { flush(); blocks.push(trimmed); continue; }
    const kind: "paragraph" | "list" | "quote" | "table" = trimmed.includes("|") ? "table" : isListLine(trimmed) ? "list" : trimmed.startsWith(">") ? "quote" : "paragraph";
    if (currentKind && currentKind !== kind) flush();
    currentKind = kind;
    current.push(trimmed);
  }
  flush();
  return blocks;
}

function renderMarkdownBlock(raw: string, images: Record<string, string>): string {
  if (/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(raw)) return "";
  const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
  if (imageMatch) {
    const key = imageMatch[1]!;
    const src = images[key];
    if (src) return `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(key)}" loading="lazy" /></figure>`;
    return "";
  }
  if (isMarkdownTable(raw)) return renderMarkdownTable(raw);
  if (isMarkdownList(raw)) return renderMarkdownList(raw);
  if (raw.startsWith(">")) return `<blockquote>${renderInlineMarkdown(raw.replace(/^>\s?/gm, "")).replace(/\n/g, "<br>")}</blockquote>`;
  if (raw.startsWith("# ")) return `<h1>${renderInlineMarkdown(raw.slice(2))}</h1>`;
  if (raw.startsWith("## ")) return `<h2>${renderInlineMarkdown(raw.slice(3))}</h2>`;
  if (raw.startsWith("### ")) return `<h3>${renderInlineMarkdown(raw.slice(4))}</h3>`;
  const s = renderInlineMarkdown(raw);
  return s ? `<p>${s.replace(/\n/g, "<br>")}</p>` : "";
}

function firstAcademyImageUrl(row: Row): string {
  const photos = safeJson(row.photos, []);
  if (Array.isArray(photos)) {
    const photo = photos.map((v) => String(v || "").trim()).find(Boolean);
    if (photo) return photo;
  }
  return String(row.thumb_url || "").trim();
}

function isListLine(line: string): boolean { return /^[-*]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || /^[✅✔✓]\s*/.test(line); }

function isMarkdownList(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 2 && lines.every(isListLine);
}

function renderMarkdownList(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ordered = lines.every((line) => /^\d+[.)]\s+/.test(line));
  const tag = ordered ? "ol" : "ul";
  const items = lines.map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").replace(/^[✅✔✓]\s*/, ""));
  return `<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`;
}

function isMarkdownTable(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 3 && lines[0]!.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1]!);
}

function renderMarkdownTable(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = splitTableRow(lines[0]!);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length);
  return `<div class="post-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${renderInlineMarkdown(row[i] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderInlineMarkdown(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="nofollow noopener">${label}</a>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  return s;
}

function escapeHtml(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c)); }
function escapeAttr(s: string): string { return escapeHtml(s).replace(/'/g, "&#39;"); }
