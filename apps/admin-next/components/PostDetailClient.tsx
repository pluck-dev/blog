"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { DesignTemplateId, PostDetail, Tenant } from "@/lib/types";

const DESIGN_SPECS: Record<DesignTemplateId, { accent: string; soft: string; pageBg: string; topCta: string; bottomCta: string; label: string }> = {
  editorial: { accent: "#5132d7", soft: "#f2efff", pageBg: "#fbfaf8", topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기", label: "브랜드 매거진" },
  comparison: { accent: "#2563eb", soft: "#dbeafe", pageBg: "#f8fafc", topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기", label: "BEST 비교 블로그" },
  "local-guide": { accent: "#059669", soft: "#dcfce7", pageBg: "#f0fdf4", topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기", label: "지역 추천 블로그" },
  checklist: { accent: "#ca8a04", soft: "#fef3c7", pageBg: "#fefce8", topCta: "체크리스트 저장", bottomCta: "준비 시작하기", label: "체크리스트 블로그" },
  conversion: { accent: "#111827", soft: "#ede9fe", pageBg: "#f5f3ff", topCta: "비용 상담 신청", bottomCta: "지금 예약하기", label: "예약 전환 블로그" },
  custom: { accent: "#5132d7", soft: "#f2efff", pageBg: "#fbfaf8", topCta: "자세히 보기", bottomCta: "문의하기", label: "커스텀" },
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
  const brand = tenant?.display_name ?? domain;
  const articleStyle = { ["--accent" as string]: design.accent, ["--accent-soft" as string]: design.soft, background: design.pageBg };
  return <div>
    <div className="page-head"><div><Link href={`/t/${encodeURIComponent(domain)}`} className="eyebrow">← {domain}</Link><h1>{post.title}</h1><p className="muted mono">{post.slug}</p></div><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(post.body_markdown)}>Markdown 복사</button><button className="btn" onClick={() => download(`${post.slug}.md`, post.body_markdown, "text/markdown")}>Markdown 다운로드</button><button className="btn primary" onClick={() => download(`${post.slug}.html`, renderStandaloneHtml({ post, tenant, domain, designId, bodyHtml: renderedHtml }), "text/html;charset=utf-8")}>HTML 다운로드</button></div></div>
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <article className={`post-preview design-${designId}`} style={articleStyle}>
        <header className="post-top-cta">
          <span><b>{brand}</b> · {design.topCta}</span>
          <span className="post-template-badge">{design.label}</span>
        </header>
        <div className="post-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        <footer className="post-bottom-cta">
          <p>{brand}에서 {design.bottomCta}</p>
          <a className="btn primary" href="#">{design.bottomCta}</a>
        </footer>
      </article>
      <aside className="grid"><div className="card card-pad"><h2>메타</h2><p><b>상태:</b> {post.status}</p><p><b>디자인:</b> {design.label} <span className="badge">{designId}</span></p><p><b>provider:</b> {post.provider ?? "-"} {post.model ?? ""}</p><p><b>비용:</b> {post.cost_usd ? `$${post.cost_usd.toFixed(3)}` : "-"}</p><p><b>생성:</b> {post.generated_at}</p><p className="muted">{post.meta_description}</p></div><div><h2>Markdown 원문</h2><pre className="codebox small">{post.body_markdown}</pre></div></aside>
    </div>
  </div>;
}
function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function fallbackMarkdown(md: string, images: Record<string, string>) {
  return md.split(/\n{2,}/).map((p) => {
    const raw = p.trim();
    const imageMatch = raw.match(/^\[IMAGE:([A-Za-z0-9_-]+)\]$/);
    if (imageMatch) {
      const key = imageMatch[1]!;
      const src = images[key];
      if (src) return `<figure class="post-image"><img src="${escapeAttr(src)}" alt="${escapeAttr(key)}" loading="lazy" /></figure>`;
    }
    if (raw.startsWith("# ")) return `<h1>${renderInline(raw.slice(2))}</h1>`;
    if (raw.startsWith("## ")) return `<h2>${renderInline(raw.slice(3))}</h2>`;
    if (raw.startsWith("### ")) return `<h3>${renderInline(raw.slice(4))}</h3>`;
    return `<p>${renderInline(raw).replace(/\n/g, "<br />")}</p>`;
  }).join("");
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
function renderStandaloneHtml({ post, tenant, domain, designId, bodyHtml }: { post: PostDetail; tenant: Tenant | null; domain: string; designId: DesignTemplateId; bodyHtml: string }) {
  const design = DESIGN_SPECS[designId];
  const brand = tenant?.display_name ?? domain;
  const title = post.title || brand;
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
    <article class="post-preview design-${designId}" style="--accent:${design.accent};--accent-soft:${design.soft};background:${design.pageBg}">
      <header class="post-top-cta">
        <span><b>${escapeHtml(brand)}</b> · ${escapeHtml(design.topCta)}</span>
        <span class="post-template-badge">${escapeHtml(design.label)}</span>
      </header>
      <div class="post-body">
${bodyHtml}
      </div>
      <footer class="post-bottom-cta">
        <p>${escapeHtml(brand)}에서 ${escapeHtml(design.bottomCta)}</p>
        <a class="btn primary" href="#">${escapeHtml(design.bottomCta)}</a>
      </footer>
    </article>
  </main>
</body>
</html>`;
}
function standaloneCss() {
  return `
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f6f7fb;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.post-page{padding:32px 16px}.post-preview{width:min(920px,100%);margin:0 auto;border:1px solid #e5e7eb;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.12)}.post-top-cta{background:var(--accent);color:#fff;padding:20px 28px;display:flex;align-items:center;justify-content:space-between;gap:14px;font-weight:800}.post-template-badge{display:inline-flex;align-items:center;border-radius:999px;background:#ffe94d;color:#111827;padding:8px 14px;font-size:14px;font-weight:900;white-space:nowrap}.post-body{padding:42px 56px 48px;line-height:1.82;font-size:18px;letter-spacing:-.015em}.post-body h1{font-size:42px;line-height:1.32;letter-spacing:-.055em;margin:0 0 30px;font-weight:950;color:#111827}.post-body h2{font-size:27px;line-height:1.4;margin:48px 0 18px;padding-bottom:12px;border-bottom:3px solid var(--accent);font-weight:900}.post-body h3{font-size:22px;margin:34px 0 12px}.post-body p{margin:0 0 24px}.post-body strong{font-weight:900;color:#020617}.post-body a{color:var(--accent);font-weight:800}.post-body code{border-radius:6px;background:#f1f5f9;padding:2px 6px}.cite{color:#64748b;font-size:.72em}.post-image{margin:34px 0}.post-image img{display:block;width:100%;max-height:540px;object-fit:cover;border-radius:18px;border:1px solid #e5e7eb;box-shadow:0 16px 36px rgba(15,23,42,.12)}.post-bottom-cta{padding:34px 56px 42px;text-align:center;background:var(--accent-soft);border-top:1px solid rgba(15,23,42,.06)}.post-bottom-cta p{margin:0 0 16px;font-size:20px;font-weight:900}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:14px;padding:12px 18px;text-decoration:none;font-weight:900}.btn.primary{background:var(--accent);color:#fff}.design-comparison .post-body h2{border-bottom-color:#2563eb}.design-comparison .post-body h2::before{content:"BEST ";color:#2563eb}.design-local-guide .post-top-cta{background:linear-gradient(135deg,#059669,#047857)}.design-local-guide .post-body h2{border-bottom-style:dashed}.design-local-guide .post-body h2::before{content:"지역 ";color:#059669}.design-checklist .post-body h2{display:flex;gap:10px;align-items:center}.design-checklist .post-body h2::before{content:"✓";display:inline-grid;place-items:center;width:30px;height:30px;border-radius:999px;background:#fef3c7;color:#92400e}.design-conversion .post-top-cta{background:#111827}.design-conversion .post-bottom-cta{background:#111827;color:#fff}.design-conversion .post-bottom-cta .btn.primary{background:#ffe94d;color:#111827}.design-custom .post-preview,.design-custom{border-style:dashed}@media(max-width:720px){.post-page{padding:0}.post-preview{border-radius:0}.post-top-cta{padding:16px 18px;align-items:flex-start;flex-direction:column}.post-body{padding:30px 22px;font-size:16px}.post-body h1{font-size:31px}.post-body h2{font-size:23px}.post-bottom-cta{padding:28px 22px}}`;
}
