"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PostDetail, Tenant } from "@/lib/types";

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
  const html = publishedHtml || bodyHtml;
  return <div>
    <div className="page-head"><div><Link href={`/t/${encodeURIComponent(domain)}`} className="eyebrow">← {domain}</Link><h1>{post.title}</h1><p className="muted mono">{post.slug}</p></div><div className="row"><button className="btn" onClick={() => navigator.clipboard.writeText(post.body_markdown)}>Markdown 복사</button><button className="btn" onClick={() => download(`${post.slug}.md`, post.body_markdown, "text/markdown")}>Markdown 다운로드</button>{html && <button className="btn primary" onClick={() => download(`${post.slug}.html`, html, "text/html")}>HTML 다운로드</button>}</div></div>
    <div className="grid grid-2" style={{ alignItems: "start" }}>
      <article className="post-preview"><div className="preview-top"><b>{tenant?.display_name ?? domain}</b><span className="badge" style={{ background: "#ffe94d", color: "#111" }}>{post.design_template_id ?? tenant?.design_template_id ?? "editorial"}</span></div><div className="post-body" dangerouslySetInnerHTML={{ __html: html || fallbackMarkdown(post.body_markdown) }} /></article>
      <aside className="grid"><div className="card card-pad"><h2>메타</h2><p><b>상태:</b> {post.status}</p><p><b>provider:</b> {post.provider ?? "-"} {post.model ?? ""}</p><p><b>비용:</b> {post.cost_usd ? `$${post.cost_usd.toFixed(3)}` : "-"}</p><p><b>생성:</b> {post.generated_at}</p><p className="muted">{post.meta_description}</p></div><div><h2>Markdown 원문</h2><pre className="codebox small">{post.body_markdown}</pre></div></aside>
    </div>
  </div>;
}
function download(name: string, text: string, type: string) { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function fallbackMarkdown(md: string) { return md.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`).join(""); }
function escapeHtml(s: string) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }
