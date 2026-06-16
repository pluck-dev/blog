import { Body, Controller, Delete, Get, Headers, HttpException, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { DbService, jobOut, safeJson, tenantOut } from "./db.service.js";
import { DrivingplusApiService, type SeoRegionLevel } from "./drivingplus-api.service.js";
import { DESIGN_TEMPLATES, PRESETS, TEMPLATE_SPECS, type AxisName } from "./constants.js";
import { SlotService } from "./slot.service.js";
import { ensureImageSlotsForRender, fallbackImagesForPost, renderMarkdown, stripPseudoSlotsForRender } from "./post-rendering.js";

type Row = Record<string, any>;
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "").trim();

@Controller("api/admin")
export class AdminController {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(DrivingplusApiService) private readonly drivingplus: DrivingplusApiService,
  ) {}

  @Get("options")
  options(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    return {
      verticals: ["driving", "car-mapping", "gym", "academy", "general"],
      themes: ["clean", "modern", "pro"],
      templates: Object.keys(TEMPLATE_SPECS),
      template_specs: TEMPLATE_SPECS,
      design_templates: DESIGN_TEMPLATES,
      providers: ["codex", "claude"],
      preset_options: Object.keys(PRESETS),
      indexing: { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() }
    };
  }

  @Get("tenants")
  listTenants(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers);
    const items = this.db.listTenants().map(tenantOut);
    return { count: items.length, items };
  }

  @Post("tenants")
  createTenant(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const domain = String(body.domain || "").trim().toLowerCase();
    const display_name = String(body.display_name || "").trim();
    const vertical = String(body.vertical || "").trim();
    if (!domain || !display_name || !vertical) throw new HttpException("domain, display_name, vertical required", 400);
    if (this.db.getTenant(domain)) throw new HttpException("tenant already exists", 409);
    this.db.createTenant({ domain, display_name, vertical, theme: body.theme, brand_color: body.brand_color, daily_limit: body.daily_limit });
    if (body.apply_preset) this.slots.applyPreset(domain, vertical);
    return { ok: true, tenant: tenantOut(this.requireTenant(domain)) };
  }

  @Get("tenants/:domain")
  getTenant(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers);
    const tenant = tenantOut(this.requireTenant(domain));
    const include = new Set(String(query.include || "").split(",").map((s) => s.trim()).filter(Boolean));
    const limit = clampInt(query.limit, 100, 1, 500);
    const payload: Row = {
      tenant,
      axes: this.db.listAxes(domain),
      slot_counts: this.db.countSlots(domain),
      settings: { indexing_has_key: Boolean(this.db.getSetting("google_sa_json")), indexing_url_template: this.indexingUrlTemplate() }
    };
    if (include.has("slots")) payload.slots = this.db.listSlots(domain, { status: query.slot_status || undefined, template: query.slot_template || undefined, q: query.slot_q || undefined, limit });
    if (include.has("posts")) payload.posts = this.db.listPosts(domain, { limit });
    if (include.has("academies")) payload.academies = this.db.listAcademies(domain, { limit });
    if (include.has("jobs")) payload.jobs = this.db.listJobs({ tenant: domain, limit }).map(jobOut);
    return payload;
  }

  @Patch("tenants/:domain")
  updateTenant(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers);
    this.requireTenant(domain);
    const fields = { ...body };
    if (Array.isArray(fields.templates_enabled)) fields.templates_enabled = JSON.stringify(fields.templates_enabled);
    this.db.updateTenant(domain, fields);
    return { ok: true, tenant: tenantOut(this.requireTenant(domain)) };
  }

  @Delete("tenants/:domain")
  deleteTenant(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); this.requireTenant(domain); this.db.deleteTenant(domain); return { ok: true };
  }

  @Put("tenants/:domain/axes/:axis")
  replaceAxis(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("axis") axis: AxisName, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const valid = new Set(["region", "keyword", "intent", "persona", "modifier"]);
    if (!valid.has(axis)) throw new HttpException("invalid axis", 400);
    const rows = (Array.isArray(body.values) ? body.values : []).map((v: Row) => ({
      value: String(v.value || "").trim(), weight: v.weight ?? 3, monthly_search_volume: nullableNumber(v.monthly_search_volume), competition_kd: nullableNumber(v.competition_kd)
    })).filter((v: Row) => v.value);
    this.db.bulkReplaceAxis(domain, axis, rows);
    return { ok: true, axis, count: rows.length, axes: this.db.listAxes(domain) };
  }

  @Post("tenants/:domain/axes/preset")
  preset(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const preset_key = String(body.preset_key || "").trim();
    if (!preset_key) throw new HttpException("preset_key required", 400);
    this.slots.applyPreset(domain, preset_key);
    return { ok: true, preset_key, axes: this.db.listAxes(domain) };
  }

  @Post("tenants/:domain/axes/ai-fill")
  aiFill(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string) {
    checkAuth(req, headers); const tenant = this.requireTenant(domain);
    // Nest runtime no longer shells through Python ai_axes; keep endpoint explicit and safe.
    const summary = this.slots.applyPreset(domain, tenant.vertical || "general");
    return { ok: true, summary: { applied_preset: tenant.vertical, ...summary }, axes: this.db.listAxes(domain) };
  }

  @Get("tenants/:domain/slots")
  listSlots(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const filters = { status: query.status || undefined, template: query.template || undefined, q: query.q || undefined };
    const items = this.db.listSlots(domain, { ...filters, limit: clampInt(query.limit, 300, 1, 2000), offset: clampInt(query.offset, 0, 0, 1000000) });
    return { count: items.length, total: this.db.countSlotsFiltered(domain, filters), slot_counts: this.db.countSlots(domain), items };
  }

  @Post("tenants/:domain/slots/generate")
  generateSlots(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const summary = this.slots.generateSlotsForTenant(domain, { maxPerTemplate: Math.max(1, Number(body.max_per_template || 200)) });
    return { ok: true, summary, slot_counts: this.db.countSlots(domain) };
  }

  @Delete("tenants/:domain/slots/:slotId")
  deleteSlot(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("slotId") slotId: string) {
    checkAuth(req, headers); this.requireTenant(domain); return { ok: true, deleted: this.db.deleteSlot(domain, slotId) };
  }

  @Post("tenants/:domain/slots/:slotId/reset")
  resetSlot(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("slotId") slotId: string) {
    checkAuth(req, headers); this.requireTenant(domain);
    const slot = this.db.getSlot(slotId); if (!slot || slot.tenant !== domain) throw new HttpException("slot not found", 404);
    this.db.updateSlotStatus(slotId, "planned", null); return { ok: true, slot: this.db.getSlot(slotId) };
  }

  @Get("tenants/:domain/posts")
  listPosts(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const items = this.db.listPosts(domain, { status: query.status || undefined, limit: clampInt(query.limit, 100, 1, 500) });
    return { count: items.length, items };
  }

  @Get("tenants/:domain/posts/:postId")
  getPost(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("postId") postId: string, @Query("include_rendered") rendered = "") {
    checkAuth(req, headers); this.requireTenant(domain);
    const post = this.db.getPost(postId); if (!post || post.tenant !== domain) throw new HttpException("post not found", 404);
    const dbImages = safeJson(post.images, {});
    const mergedImages = { ...fallbackImagesForPost(this.db, domain, post), ...(dbImages && typeof dbImages === "object" ? dbImages : {}) };
    const bodyMarkdown = ensureImageSlotsForRender(stripPseudoSlotsForRender(post.body_markdown || ""), mergedImages);
    const responsePost = { ...post, body_markdown: bodyMarkdown, images: Object.keys(mergedImages).length ? JSON.stringify(mergedImages) : post.images };
    const payload: Row = { post: responsePost };
    if (rendered === "true" || rendered === "1") payload.body_html = renderMarkdown(bodyMarkdown, mergedImages);
    return payload;
  }

  @Delete("tenants/:domain/posts/:postId")
  deletePost(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("postId") postId: string) {
    checkAuth(req, headers); this.requireTenant(domain);
    const post = this.db.getPost(postId); if (!post || post.tenant !== domain) throw new HttpException("post not found", 404);
    this.db.deletePost(postId); return { ok: true };
  }

  @Get("tenants/:domain/academies")
  listAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Query() query: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const items = this.db.listAcademies(domain, { region: query.region || undefined, limit: clampInt(query.limit, 500, 1, 1000) });
    return { count: items.length, items };
  }

  @Post("tenants/:domain/academies")
  upsertAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: any) {
    checkAuth(req, headers); this.requireTenant(domain);
    let rows = body?.items !== undefined ? body.items : body;
    if (rows && !Array.isArray(rows)) rows = [rows];
    if (!Array.isArray(rows)) throw new HttpException("expected a JSON academy object, array, or {items:[...]}", 400);
    return { ok: true, upserted: this.db.upsertAcademies(domain, rows) };
  }

  @Post("tenants/:domain/sync/drivingplus/academies")
  async syncDrivingplusAcademies(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row = {}) {
    checkAuth(req, headers); this.requireTenant(domain);
    const rows = await this.drivingplus.fetchAcademies({ includeBlogReviews: body.include_blog_reviews !== false, blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10) });
    return { ok: true, ...this.db.upsertDrivingplusAcademies(domain, rows) };
  }

  @Post("tenants/:domain/sync/drivingplus/regions")
  async syncDrivingplusRegions(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const level = normalizeSeoRegionLevel(body.level);
    const replaceAxis = Boolean(body.replace_axis);
    const max = clampInt(body.max, level === "3" ? 500 : 10000, 1, 10000);
    const rows = (await this.drivingplus.fetchSeoRegions(level)).slice(0, max);
    const summary = this.db.upsertSeoRegions(domain, rows);
    let axis_replaced = false;
    if (replaceAxis) {
      const axisRows = rows.map((r) => ({ value: r.region, weight: r.level === 2 ? 5 : 3, monthly_search_volume: null, competition_kd: null }));
      this.db.bulkReplaceAxis(domain, "region", axisRows);
      axis_replaced = true;
    }
    return { ok: true, level, axis_replaced, ...summary };
  }

  @Post("tenants/:domain/sync/drivingplus")
  async syncDrivingplusAll(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    const level = normalizeSeoRegionLevel(body.level || "2");
    const regions = await this.drivingplus.fetchSeoRegions(level);
    const regionSummary = this.db.upsertSeoRegions(domain, regions);
    if (body.replace_axis) this.db.bulkReplaceAxis(domain, "region", regions.map((r) => ({ value: r.region, weight: r.level === 2 ? 5 : 3, monthly_search_volume: null, competition_kd: null })));
    const academies = await this.drivingplus.fetchAcademies({ includeBlogReviews: body.include_blog_reviews !== false, blogReviewLimit: clampInt(body.blog_review_limit, 3, 1, 10) });
    const academySummary = this.db.upsertDrivingplusAcademies(domain, academies);
    return { ok: true, regions: regionSummary, academies: academySummary, axis_replaced: Boolean(body.replace_axis), level };
  }

  @Delete("tenants/:domain/academies/:academyId")
  deleteAcademy(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Param("academyId") academyId: string) {
    checkAuth(req, headers); this.requireTenant(domain); return { ok: true, deleted: this.db.deleteAcademy(domain, academyId) };
  }

  @Post("tenants/:domain/jobs/generate")
  enqueueGenerate(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain);
    let slotIds = Array.isArray(body.slot_ids) ? body.slot_ids.map((id: any) => String(id)).filter(Boolean) : [];
    if (!slotIds.length) {
      const picked = this.db.selectSlotsForBatch(domain, { q: body.q || undefined, template: body.template || undefined, limit: clampInt(body.max, 10, 1, 500), balanced: Boolean(body.balanced) });
      slotIds = picked.map((s) => s.slot_id);
    }
    if (!slotIds.length) throw new HttpException("작성할 planned 슬롯이 없습니다. 검색어나 상태를 확인하세요.", 400);
    const job_id = this.db.enqueueJob(domain, "generate", { slot_ids: slotIds, provider: body.provider || "codex", model: String(body.model || "").trim(), design_template_id: body.design_template_id, use_web_research: body.use_web_research ?? true, cooldown_sec: body.cooldown_sec ?? 60, timeout_sec: body.timeout_sec ?? 600 });
    return { ok: true, job_id, slot_count: slotIds.length };
  }
  @Post("tenants/:domain/jobs/dedup")
  enqueueDedup(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "dedup", { threshold: body.threshold ?? 0.75, dry_run: body.dry_run ?? false }) };
  }
  @Post("tenants/:domain/jobs/prune")
  enqueuePrune(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "prune", { min_body_chars: body.min_body_chars ?? 700, stale_noindex_days: body.stale_noindex_days ?? 90, dry_run: body.dry_run ?? false }) };
  }
  @Post("tenants/:domain/jobs/indexing")
  enqueueIndexing(@Req() req: Request, @Headers() headers: Record<string, string>, @Param("domain") domain: string, @Body() body: Row) {
    checkAuth(req, headers); this.requireTenant(domain); return { ok: true, job_id: this.db.enqueueJob(domain, "indexing", { max: body.max ?? 200, type: "URL_UPDATED" }) };
  }

  @Get("jobs")
  listJobs(@Req() req: Request, @Headers() headers: Record<string, string>, @Query() query: Row) {
    checkAuth(req, headers);
    const items = this.db.listJobs({ tenant: query.tenant || undefined, status: query.status || undefined, limit: clampInt(query.limit, 200, 1, 1000) }).map(jobOut);
    return { count: items.length, items };
  }

  @Get("settings/indexing")
  getIndexing(@Req() req: Request, @Headers() headers: Record<string, string>) {
    checkAuth(req, headers); return { has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() };
  }
  @Put("settings/indexing")
  saveIndexing(@Req() req: Request, @Headers() headers: Record<string, string>, @Body() body: Row) {
    checkAuth(req, headers);
    const sa = String(body.sa_json || "").trim();
    if (sa && !isServiceAccount(sa)) throw new HttpException("서비스계정 JSON 형식 오류(client_email/private_key 필요)", 400);
    if (sa) this.db.setSetting("google_sa_json", sa);
    if (String(body.url_template || "").trim()) this.db.setSetting("indexing_url_template", String(body.url_template).trim());
    return { ok: true, has_key: Boolean(this.db.getSetting("google_sa_json")), url_template: this.indexingUrlTemplate() };
  }

  private requireTenant(domain: string): Row { const tenant = this.db.getTenant(domain); if (!tenant) throw new HttpException("tenant not found", 404); return tenant; }
  private indexingUrlTemplate() { return this.db.getSetting("indexing_url_template") || "https://{domain}/community/{slug}"; }
}

export function checkAuth(req: Request, headers: Record<string, string>): void {
  if (!ADMIN_PASSWORD) return;
  const cookieHeader = req.headers.cookie || "";
  const cookieToken = cookieHeader.split(";").map((p: string) => p.trim()).find((p: string) => p.startsWith("admin_token="))?.split("=").slice(1).join("=") || "";
  const headerToken = headers["x-admin-token"] || "";
  const auth = headers.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (![cookieToken, headerToken, bearer].includes(ADMIN_PASSWORD)) throw new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);
}

function clampInt(value: any, fallback: number, min: number, max: number): number { const n = Number(value); return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback)); }
function normalizeSeoRegionLevel(value: any): SeoRegionLevel {
  const v = String(value || "2").trim();
  if (v === "all" || v === "2" || v === "3") return v;
  throw new HttpException("level must be one of all, 2, 3", 400);
}
function nullableNumber(value: any): number | null { if (value === "" || value === null || value === undefined) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function isServiceAccount(text: string): boolean { try { const o = JSON.parse(text); return Boolean(o.client_email && o.private_key); } catch { return false; } }
