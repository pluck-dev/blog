"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime, formatShortDate } from "@/lib/date";
import type { DesignTemplateId, PostDetail, Tenant } from "@/lib/types";

const DESIGN_SPECS: Record<DesignTemplateId, { accent: string; soft: string; pageBg: string; topCta: string; bottomCta: string; label: string }> = {
  editorial: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기", label: "브랜드 매거진" },
  comparison: { accent: "#2563eb", soft: "#dbeafe", pageBg: "#ffffff", topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기", label: "BEST 비교 블로그" },
  "local-guide": { accent: "#059669", soft: "#dcfce7", pageBg: "#ffffff", topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기", label: "지역 추천 블로그" },
  checklist: { accent: "#ca8a04", soft: "#fef3c7", pageBg: "#ffffff", topCta: "체크리스트 저장", bottomCta: "준비 시작하기", label: "체크리스트 블로그" },
  conversion: { accent: "#111827", soft: "#ede9fe", pageBg: "#ffffff", topCta: "비용 상담 신청", bottomCta: "지금 예약하기", label: "예약 전환 블로그" },
  custom: { accent: "#5132d7", soft: "#f2efff", pageBg: "#ffffff", topCta: "자세히 보기", bottomCta: "문의하기", label: "커스텀" },
};

export default function PostDetailClient({ domain, postId }: { domain: string; postId: string }) {
  const [post, setPost] = useState<PostDetail | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [bodyHtml, setBodyHtml] = useState("");
  const [publishedHtml, setPublishedHtml] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { (async () => {
    try {
      const [detail, tenantDetail] = await Promise.all([
        api<{ post: PostDetail; body_html?: string; published_html?: string }>(`/tenants/${encodeURIComponent(domain)}/posts/${postId}?include_rendered=true`),
        api<{ tenant: Tenant }>(`/tenants/${encodeURIComponent(domain)}`),
      ]);
      setPost(detail.post); setBodyHtml(detail.body_html ?? ""); setPublishedHtml(detail.published_html ?? ""); setTenant(tenantDetail.tenant);
    } catch (e) { setError((e as Error).message); }
  })(); }, [domain, postId]);
  if (error) return <p className="toast-error">{error}</p>;
  if (!post) return <div className="card card-pad">로딩 중...</div>;
  const renderedHtml = publishedHtml || bodyHtml || fallbackMarkdown(post.body_markdown, parseImages(post.images));
  const designId = resolveDesign(post.design_template_id ?? tenant?.design_template_id);
  const design = DESIGN_SPECS[designId];
  const brand = publicBrandName(tenant?.display_name ?? domain);
  const articleStyle = { ["--accent" as string]: design.accent, ["--accent-soft" as string]: design.soft, ["--primary" as string]: design.accent, background: design.pageBg };
  const contentHtml = toPreviewBlocks(prepareBodyHtml(renderedHtml, post.title, null));
  const chips = designChips(designId);
  return <div>
    <div className="page-head"><div><Link href={`/t/${encodeURIComponent(domain)}`} className="eyebrow">← {domain}</Link><h1>{post.title}</h1><p className="muted mono">{post.slug}</p></div><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(post.body_markdown)}>Markdown 복사</button><button className="btn" onClick={() => download(`${post.slug}.md`, post.body_markdown, "text/markdown")}>Markdown 다운로드</button><button className="btn primary" onClick={() => download(`${post.slug}.html`, renderStandaloneHtml({ post, tenant, domain, designId, bodyHtml: renderedHtml }), "text/html;charset=utf-8")}>HTML 다운로드</button></div></div>
    <div className="grid post-detail-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px", alignItems: "start" }}>
      <article className={`preview-phone preview-phone-fluid design-${designId}`} style={articleStyle}>
        <div className="preview-top"><div><b>{brand}</b><p>{design.label}</p></div><span className="preview-cta">{design.topCta}</span></div>
        <div className="preview-hero post-hero title-hero">
          <div>
            <span>{design.label}</span>
            <h3>{post.title}</h3>
          </div>
        </div>
        <div className="preview-body">
          <div className="preview-meta"><span>{formatShortDate(post.generated_at)}</span><span>{designId}</span></div>
          <div className="preview-divider" />
          <div className="row post-chips">{chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
          <div className="generated-blocks" dangerouslySetInnerHTML={{ __html: contentHtml }} />
          <section className="preview-bottom-cta"><b>{brand}에서 {design.bottomCta}</b><a className="btn primary" href="#">{design.bottomCta}</a></section>
        </div>
      </article>
      <aside className="grid"><div className="card card-pad"><h2>메타</h2><p><b>상태:</b> {post.status}</p><p><b>디자인:</b> {design.label} <span className="badge">{designId}</span></p><p><b>provider:</b> {post.provider ?? "-"} {post.model ?? ""}</p><p><b>비용:</b> {post.cost_usd ? `$${post.cost_usd.toFixed(3)}` : "-"}</p><p><b>생성:</b> {formatDateTime(post.generated_at)}</p><p className="muted">{post.meta_description}</p><p className="muted small">원문은 상단의 복사/다운로드 버튼으로 확인합니다. 상세 화면에는 발행 디자인만 표시합니다.</p></div></aside>
    </div>
  </div>;
}
function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function fallbackMarkdown(md: string, images: Record<string, string>) {
  return markdownBlocks(md).map((raw) => renderMarkdownBlock(raw, images)).join("");
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
function renderMarkdownBlock(raw: string, images: Record<string, string>) {
  if (/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(raw)) return "";
  const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
  if (imageMatch) {
    const key = imageMatch[1]!;
    const src = images[key];
    return src ? `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(key)}" loading="lazy" /></figure>` : "";
  }
  if (isMarkdownTable(raw)) return renderMarkdownTable(raw);
  if (isMarkdownList(raw)) return renderMarkdownList(raw);
  if (raw.startsWith(">")) return `<blockquote>${renderInline(raw.replace(/^>\s?/gm, "")).replace(/\n/g, "<br />")}</blockquote>`;
  if (raw.startsWith("# ")) return `<h1>${renderInline(raw.slice(2))}</h1>`;
  if (raw.startsWith("## ")) return `<h2>${renderInline(raw.slice(3))}</h2>`;
  if (raw.startsWith("### ")) return `<h3>${renderInline(raw.slice(4))}</h3>`;
  return `<p>${renderInline(raw).replace(/\n/g, "<br />")}</p>`;
}
function renderInline(raw: string): string {
  let s = escapeHtml(raw);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="nofollow noopener">${label}</a>`);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
  return s;
}
function parseImages(value: PostDetail["images"]): Record<string, string> {
  if (!value) return {};
  if (typeof value === "object") return value as Record<string, string>;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
function escapeAttr(s: string) { return escapeHtml(s).replace(/'/g, "&#39;"); }
function resolveDesign(value: string | null | undefined): DesignTemplateId {
  return value && value in DESIGN_SPECS ? value as DesignTemplateId : "editorial";
}
function publicBrandName(value: string): string {
  return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || value;
}
function prepareBodyHtml(html: string, title: string, heroImage: string | null): string {
  let out = html.trim();
  const escapedTitle = escapeRegExp(escapeHtml(title.trim()));
  out = out.replace(new RegExp(`^<h1>\\s*${escapedTitle}\\s*</h1>\\s*`, "i"), "");
  out = out.replace(/^<h1>[\s\S]*?<\/h1>\s*/i, "");
  if (heroImage) {
    const escapedSrc = escapeRegExp(escapeAttr(heroImage));
    out = out.replace(new RegExp(`<figure class="post-image"><img src="${escapedSrc}"[\\s\\S]*?<\/figure>\\s*`, "i"), "");
  }
  return out;
}
function toPreviewBlocks(html: string): string {
  const blocks = html.match(/<figure class="post-image">[\s\S]*?<\/figure>|<div class="post-table-wrap">[\s\S]*?<\/div>|<blockquote>[\s\S]*?<\/blockquote>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h2>[\s\S]*?<\/h2>|<h3>[\s\S]*?<\/h3>|<p>[\s\S]*?<\/p>/gi);
  if (!blocks?.length) return html ? `<div class="preview-block"><p>${html}</p></div>` : "";
  const groups: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (!current.length) return;
    groups.push(`<section class="preview-block">${current.join("\n")}</section>`);
    current = [];
  };
  for (const block of blocks) {
    if (block.startsWith("<figure")) { flush(); groups.push(block); continue; }
    if (block.startsWith("<h2") && current.length) flush();
    current.push(block);
  }
  flush();
  return groups.join("\n");
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
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
}
function isMarkdownTable(raw: string): boolean {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length >= 3 && lines[0]!.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[1]!);
}
function renderMarkdownTable(raw: string): string {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = splitTableRow(lines[0]!);
  const rows = lines.slice(2).map(splitTableRow).filter((row) => row.length);
  return `<div class="post-table-wrap"><table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, i) => `<td>${renderInline(row[i] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function splitTableRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function designChips(designId: DesignTemplateId): string[] {
  const chips: Record<DesignTemplateId, string[]> = {
    editorial: ["가이드", "FAQ", "정보성"],
    comparison: ["비교 기준", "요약 표", "추천 케이스"],
    "local-guide": ["지역 고민", "주변 선택 기준", "동선/접근성"],
    checklist: ["요약", "준비 체크", "절차"],
    conversion: ["문제 공감", "해결 기준", "상담"],
    custom: ["상단 구성", "본문 규칙", "CTA 위치"],
  };
  return chips[designId];
}
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function renderStandaloneHtml({ post, tenant, domain, designId, bodyHtml }: { post: PostDetail; tenant: Tenant | null; domain: string; designId: DesignTemplateId; bodyHtml: string }) {
  const design = DESIGN_SPECS[designId];
  const brand = publicBrandName(tenant?.display_name ?? domain);
  const title = post.title || brand;
  const contentHtml = toPreviewBlocks(prepareBodyHtml(bodyHtml, post.title, null));
  const chips = designChips(designId);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  ${post.meta_description ? `<meta name="description" content="${escapeAttr(post.meta_description)}" />` : ""}
  <style>${standaloneCss()}</style>
</head>
<body>
  <main class="post-page">
    <article class="preview-phone preview-phone-fluid design-${designId}" style="--accent:${design.accent};--accent-soft:${design.soft};--primary:${design.accent};background:${design.pageBg}">
      <div class="preview-top"><div><b>${escapeHtml(brand)}</b><p>${escapeHtml(design.label)}</p></div><span class="preview-cta">${escapeHtml(design.topCta)}</span></div>
      <div class="preview-hero post-hero title-hero">
        <div>
          <span>${escapeHtml(design.label)}</span>
          <h3>${escapeHtml(post.title)}</h3>
        </div>
      </div>
      <div class="preview-body">
        <div class="preview-meta"><span>${escapeHtml(formatShortDate(post.generated_at))}</span><span>${escapeHtml(designId)}</span></div>
        <div class="preview-divider"></div>
        <div class="row post-chips">${chips.map((chip) => `<span class="badge">${escapeHtml(chip)}</span>`).join("")}</div>
        <div class="generated-blocks">
${contentHtml}
        </div>
        <section class="preview-bottom-cta"><b>${escapeHtml(brand)}에서 ${escapeHtml(design.bottomCta)}</b><a class="btn primary" href="#">${escapeHtml(design.bottomCta)}</a></section>
      </div>
    </article>
  </main>
</body>
</html>`;
}
function standaloneCss() {
  return `
*{box-sizing:border-box}body{margin:0;background:transparent;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.post-page{width:100%;padding:0}.preview-phone{width:100%;max-width:none;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;background:white;box-shadow:0 20px 50px rgba(15,23,42,.14)}.preview-top{background:var(--primary);color:white;padding:16px;display:flex;justify-content:space-between;gap:10px;align-items:center}.preview-top p{margin:2px 0 0;opacity:.85;font-size:12px}.preview-cta{border-radius:12px;background:#ffe94d;color:#111827;padding:9px 12px;font-size:12px;font-weight:900;white-space:nowrap}.preview-hero{margin:18px;min-height:280px;border-radius:14px;background:radial-gradient(circle at 18% 20%,rgba(255,255,255,.55),transparent 30%),linear-gradient(135deg,var(--accent-soft),#f6f0ff 45%,#fff4a7);position:relative;overflow:hidden;display:flex;align-items:flex-end;padding:22px}.preview-hero.title-hero h3{margin:10px 0 0;font-size:clamp(24px,4.6vw,48px);line-height:1.18;letter-spacing:-.055em;color:#111827}.preview-hero.title-hero p{max-width:760px;margin:12px 0 0;color:#475569;font-weight:700;line-height:1.65}.preview-hero span{display:inline-flex;border-radius:999px;background:rgba(255,255,255,.88);padding:6px 10px;font-size:11px;color:var(--primary);font-weight:900}.preview-body{padding:0 22px 22px}.preview-meta{display:flex;justify-content:center;gap:16px;color:#94a3b8;font-size:11px}.preview-body h4{text-align:center;font-size:clamp(20px,3vw,34px);line-height:1.3;margin:14px 0;font-weight:950;letter-spacing:-.04em}.preview-divider{height:9px;border-radius:999px;background:#ffe94d;margin:14px 0}.row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.post-chips{margin-bottom:14px}.badge{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:800;background:#f1f5f9;color:#334155}.muted{color:#64748b}.small{font-size:12px}.generated-blocks{display:grid;gap:12px}.preview-block{border-radius:12px;background:#f8fafc;padding:12px;margin:0;font-size:14px;line-height:1.75}.preview-block p{margin:6px 0 0;color:#64748b}.generated-blocks ul{display:grid;gap:8px;margin:10px 0 0;padding-left:0;list-style:none;color:#475569}.generated-blocks ul li{position:relative;margin:0;padding-left:24px}.generated-blocks ul li::before{content:"✓";position:absolute;left:0;top:0;color:var(--primary);font-weight:900;line-height:inherit}.generated-blocks ol{margin:10px 0 0;padding-left:22px;color:#475569}.generated-blocks ol li{margin:6px 0;padding-left:2px}.generated-blocks blockquote{margin:0;border-left:4px solid #ffe94d;background:#fafaf7;padding:12px;border-radius:0 12px 12px 0;color:#475569}.preview-block strong{font-weight:900;color:#020617}.preview-block a{color:var(--primary);font-weight:800}.post-table-wrap{overflow:auto;border:1px solid #e5e7eb;border-radius:12px;background:white}.post-table-wrap table{min-width:680px;margin:0;font-size:13px}.post-table-wrap th{background:#fffacc;color:#111827;font-weight:900}.post-table-wrap td{background:white}.preview-block code{border-radius:6px;background:#e2e8f0;padding:2px 6px}.preview-block h2,.preview-block h3{margin:0 0 6px;font-size:16px}.post-image{margin:0;border-radius:14px;overflow:hidden}.post-image img{display:block;width:100%;max-height:520px;object-fit:cover;border-radius:14px}.cite{color:#64748b;font-size:.72em}.preview-bottom-cta{margin-top:18px;border:2px solid #ffe94d;border-radius:16px;background:#fafaf7;padding:16px;text-align:center;display:grid;gap:12px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;padding:10px 14px;text-decoration:none;font-weight:900}.btn.primary{background:var(--primary);color:white}.design-comparison .preview-divider{background:repeating-linear-gradient(90deg,var(--primary) 0,var(--primary) 22px,#ffe94d 22px,#ffe94d 36px)}.design-local-guide .preview-divider{border-top:2px dashed rgba(81,50,215,.45);background:transparent;height:16px}.design-checklist .preview-divider{height:auto;padding:8px;border:1px solid #ffe94d;background:#fffacc;color:var(--primary);text-align:center;font-size:10px;font-weight:900;letter-spacing:.16em}.design-checklist .preview-divider::before{content:"CHECK BEFORE RESERVATION"}.design-conversion .preview-top{background:#111827}.design-conversion .preview-divider{background:linear-gradient(90deg,var(--primary),#ffe94d,var(--primary))}.design-conversion .preview-bottom-cta{background:#111827;color:white}.design-conversion .preview-bottom-cta .btn.primary{background:#ffe94d;color:#111827}@media(max-width:720px){.preview-phone{border-radius:0}.preview-top{align-items:flex-start;flex-direction:column}}`;
}
