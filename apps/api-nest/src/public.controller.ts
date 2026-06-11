import { Body, Controller, Get, Header, HttpException, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { DbService } from "./db.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";

type Row = Record<string, any>;

@Controller("api/v1/:domain")
export class PublicController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get("posts")
  posts(@Param("domain") domain: string, @Query() query: Row) {
    this.requireTenant(domain);
    const limit = clampInt(query.limit, 50, 1, 100);
    const offset = Math.max(0, Number(query.offset || 0));
    const rows = this.db.all(`SELECT id, tenant, slot_id, slug, title, meta_description, images, design_template_id, generated_at, length(body_markdown) AS body_chars FROM posts WHERE tenant=? AND status='published' ORDER BY generated_at DESC LIMIT ? OFFSET ?`, [domain, limit, offset]);
    return { count: rows.length, items: rows.map(publicPostSummary) };
  }

  @Get("posts/:slug")
  post(@Param("domain") domain: string, @Param("slug") slug: string, @Query("include_rendered") rendered = "") {
    this.requireTenant(domain);
    const post = this.db.getPostBySlug(domain, slug, "published");
    if (!post) throw new HttpException("post not found", 404);
    const normalized = normalizePostForPublicRender(this.db, domain, post);
    const payload: Row = { post: publicPostDetail(normalized.post) };
    if (rendered === "true" || rendered === "1") payload.body_html = renderMarkdown(normalized.bodyMarkdown, normalized.images);
    return payload;
  }

  @Get("sitemap.xml")
  @Header("content-type", "application/xml; charset=utf-8")
  sitemap(@Param("domain") domain: string, @Query("base_url") baseUrl = "") {
    this.requireTenant(domain);
    const base = (baseUrl || `https://${domain}`).replace(/\/$/, "");
    const posts = this.db.listPosts(domain, { status: "published", limit: 5000 });
    const urls = posts.map((p) => `  <url><loc>${escapeXml(`${base}/community/${p.slug}`)}</loc><lastmod>${String(p.generated_at || "").slice(0, 10)}</lastmod></url>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  }

  @Get("academies")
  academies(@Param("domain") domain: string, @Query() query: Row) {
    this.requireTenant(domain);
    const items = this.db.listAcademies(domain, { region: query.region || undefined, limit: clampInt(query.limit, 50, 1, 1000) });
    return { count: items.length, items };
  }

  @Post("academies")
  upsertAcademies(@Param("domain") domain: string, @Req() req: Request, @Query("token") token = "", @Body() body: any) {
    this.requireTenant(domain);
    const expected = process.env.PUBLIC_WRITE_TOKEN || "";
    const headerToken = req.headers["x-public-write-token"] || "";
    if (expected && token !== expected && headerToken !== expected) throw new HttpException("Unauthorized", 401);
    let rows = body?.items !== undefined ? body.items : body;
    if (rows && !Array.isArray(rows)) rows = [rows];
    if (!Array.isArray(rows)) throw new HttpException("expected a JSON academy object, array, or {items:[...]}", 400);
    return { ok: true, upserted: this.db.upsertAcademies(domain, rows) };
  }

  private requireTenant(domain: string) { const t = this.db.getTenant(domain); if (!t) throw new HttpException("tenant not found", 404); return t; }
}

function publicPostSummary(row: Row): Row {
  return { ...row, images: safeJson(row.images, {}) };
}
function publicPostDetail(row: Row): Row {
  return { ...row, images: safeJson(row.images, {}) };
}
function normalizePostForPublicRender(db: DbService, domain: string, post: Row): { post: Row; bodyMarkdown: string; images: Record<string, string> } {
  const dbImages = safeJson(post.images, {});
  const images = { ...fallbackImagesForPost(db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
  const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), images);
  return { post: { ...post, body_markdown: bodyMarkdown, images: Object.keys(images).length ? JSON.stringify(images) : post.images }, bodyMarkdown, images };
}
function safeJson(value: any, fallback: any) { if (!value || typeof value !== "string") return value || fallback; try { return JSON.parse(value); } catch { return fallback; } }
function clampInt(value: any, fallback: number, min: number, max: number) { const n = Number(value); return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback)); }
function escapeXml(s: string) { return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c] || c)); }
