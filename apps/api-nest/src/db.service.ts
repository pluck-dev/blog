import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AXES, DRIVING_ORIGINAL_TEMPLATE_IDS, type AxisName, type JobKind } from "./constants.js";

// node:sqlite is available in the project's Node 25 runtime and keeps the Nest port dependency-light.
const sqlite = await import("node:sqlite" as string) as any;
type DatabaseSync = any;

type Row = Record<string, any>;

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);
const DEFAULT_DB = resolve(PROJECT_DIR, "data/admin.db");

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  domain TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  theme TEXT NOT NULL DEFAULT 'clean' CHECK (theme IN ('clean','modern','pro')),
  brand_color TEXT DEFAULT '#0066ff',
  logo_url TEXT,
  templates_enabled TEXT NOT NULL DEFAULT '["T01","T03","T04","T05","T06","T07","T08","T09","T10","T11","T12","T13","T14","T15"]',
  design_template_id TEXT NOT NULL DEFAULT 'editorial',
  custom_design_templates TEXT,
  content_brief TEXT,
  daily_limit INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS axes (
  tenant TEXT NOT NULL,
  axis TEXT NOT NULL CHECK (axis IN ('region','keyword','intent','persona','modifier')),
  value TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 3,
  monthly_search_volume INTEGER,
  competition_kd INTEGER,
  PRIMARY KEY (tenant, axis, value),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS slots (
  slot_id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  template_id TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  region TEXT,
  persona TEXT,
  intent TEXT,
  modifier_1 TEXT,
  modifier_2 TEXT,
  entity_id TEXT,
  priority_score REAL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','published','failed','pruned')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slots_tenant_status ON slots(tenant, status, priority_score DESC);
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  slot_id TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_markdown TEXT NOT NULL,
  meta_description TEXT,
  images TEXT,
  design_template_id TEXT NOT NULL DEFAULT 'editorial',
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published','noindex','deleted')),
  provider TEXT,
  model TEXT,
  session_id TEXT,
  cost_usd REAL DEFAULT 0,
  duration_sec REAL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant, slug),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(slot_id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('generate','dedup','indexing','prune')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  scheduled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  finished_at TEXT,
  error TEXT,
  result TEXT,
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_sched ON jobs(status, scheduled_at);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS academies (
  id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  external_id TEXT,
  region TEXT,
  name TEXT NOT NULL,
  address TEXT,
  price TEXT,
  shuttle TEXT,
  hours TEXT,
  pass_rate TEXT,
  phone TEXT,
  vphone TEXT,
  review TEXT,
  review_json TEXT,
  blog_reviews TEXT,
  seo_title TEXT,
  seo_keywords TEXT,
  seo_description TEXT,
  latitude REAL,
  longitude REAL,
  thumb_url TEXT,
  photos TEXT,
  academy_type TEXT,
  extra TEXT,
  source_name TEXT,
  source_url TEXT,
  synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant, region, name),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_academies_tenant_region ON academies(tenant, region);
CREATE TABLE IF NOT EXISTS seo_regions (
  tenant TEXT NOT NULL,
  level INTEGER NOT NULL,
  region TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  source_name TEXT,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant, level, region),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seo_regions_tenant_region ON seo_regions(tenant, region);
	`;

@Injectable()
export class DbService implements OnModuleInit {
  private db!: DatabaseSync;
  readonly path = resolve(process.cwd(), process.env.SEO_DB_PATH || DEFAULT_DB);

  onModuleInit(): void {
    this.init();
  }

  init(): void {
    if (this.db) return;
    mkdirSync(dirname(this.path), { recursive: true });
    this.db = new sqlite.DatabaseSync(this.path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  private migrate(): void {
    const tenantCols = new Set(this.all("PRAGMA table_info(tenants)").map((r) => r.name));
    if (!tenantCols.has("design_template_id")) this.db.exec("ALTER TABLE tenants ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'editorial'");
    if (!tenantCols.has("custom_design_templates")) this.db.exec("ALTER TABLE tenants ADD COLUMN custom_design_templates TEXT");
    if (!tenantCols.has("content_brief")) this.db.exec("ALTER TABLE tenants ADD COLUMN content_brief TEXT");
    this.run(`UPDATE tenants SET templates_enabled=?
       WHERE vertical='driving' AND templates_enabled IN ('["T01","T03","T05","T07"]', '["T01","T03","T04","T05","T06","T07"]')`, [JSON.stringify(DRIVING_ORIGINAL_TEMPLATE_IDS)]);
    const postCols = new Set(this.all("PRAGMA table_info(posts)").map((r) => r.name));
    if (!postCols.has("images")) this.db.exec("ALTER TABLE posts ADD COLUMN images TEXT");
    if (!postCols.has("design_template_id")) {
      this.db.exec("ALTER TABLE posts ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'editorial'");
      this.db.exec("UPDATE posts SET design_template_id = COALESCE((SELECT t.design_template_id FROM tenants t WHERE t.domain = posts.tenant), 'editorial')");
    }
    const academyCols = new Set(this.all("PRAGMA table_info(academies)").map((r) => r.name));
    const academyMigrations: Array<[string, string]> = [
      ["external_id", "ALTER TABLE academies ADD COLUMN external_id TEXT"],
      ["vphone", "ALTER TABLE academies ADD COLUMN vphone TEXT"],
      ["seo_title", "ALTER TABLE academies ADD COLUMN seo_title TEXT"],
      ["seo_keywords", "ALTER TABLE academies ADD COLUMN seo_keywords TEXT"],
      ["seo_description", "ALTER TABLE academies ADD COLUMN seo_description TEXT"],
      ["latitude", "ALTER TABLE academies ADD COLUMN latitude REAL"],
      ["longitude", "ALTER TABLE academies ADD COLUMN longitude REAL"],
      ["thumb_url", "ALTER TABLE academies ADD COLUMN thumb_url TEXT"],
      ["photos", "ALTER TABLE academies ADD COLUMN photos TEXT"],
      ["academy_type", "ALTER TABLE academies ADD COLUMN academy_type TEXT"],
      ["review_json", "ALTER TABLE academies ADD COLUMN review_json TEXT"],
      ["blog_reviews", "ALTER TABLE academies ADD COLUMN blog_reviews TEXT"],
      ["synced_at", "ALTER TABLE academies ADD COLUMN synced_at TEXT"],
    ];
    for (const [col, sql] of academyMigrations) if (!academyCols.has(col)) this.db.exec(sql);
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_academies_tenant_external_id ON academies(tenant, external_id) WHERE external_id IS NOT NULL");
    this.db.exec(`CREATE TABLE IF NOT EXISTS seo_regions (
      tenant TEXT NOT NULL,
      level INTEGER NOT NULL,
      region TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      source_name TEXT,
      synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant, level, region),
      FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
    )`);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_seo_regions_tenant_region ON seo_regions(tenant, region)");
  }

  all(sql: string, params: any[] = []): Row[] { return this.db.prepare(sql).all(...params) as Row[]; }
  get(sql: string, params: any[] = []): Row | undefined { return this.db.prepare(sql).get(...params) as Row | undefined; }
  run(sql: string, params: any[] = []): any { return this.db.prepare(sql).run(...params); }
  exec(sql: string): void { this.db.exec(sql); }
  transaction<T>(fn: () => T): T {
    this.exec("BEGIN");
    try { const result = fn(); this.exec("COMMIT"); return result; }
    catch (error) { this.exec("ROLLBACK"); throw error; }
  }

  listTenants(): Row[] {
    return this.all(`SELECT t.*,
      (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain) AS slot_count,
      (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain AND s.status='planned') AS planned_count,
      (SELECT COUNT(*) FROM posts p WHERE p.tenant = t.domain AND p.status='published') AS published_count
      FROM tenants t ORDER BY t.created_at DESC`);
  }
  getTenant(domain: string): Row | undefined { return this.get("SELECT * FROM tenants WHERE domain=?", [domain]); }
  createTenant(input: { domain: string; display_name: string; vertical: string; theme?: string; brand_color?: string; daily_limit?: number }): void {
    this.run(`INSERT INTO tenants (domain, display_name, vertical, theme, brand_color, daily_limit) VALUES (?, ?, ?, ?, ?, ?)`,
      [input.domain, input.display_name, input.vertical, input.theme || "clean", input.brand_color || "#0066ff", input.daily_limit ?? 30]);
  }
  updateTenant(domain: string, fields: Row): void {
    const allowed = new Set(["display_name", "vertical", "theme", "brand_color", "daily_limit", "templates_enabled", "logo_url", "design_template_id", "custom_design_templates", "content_brief"]);
    const entries = Object.entries(fields).filter(([k, v]) => allowed.has(k) && v !== undefined);
    if (!entries.length) return;
    this.run(`UPDATE tenants SET ${entries.map(([k]) => `${k}=?`).join(", ")} WHERE domain=?`, [...entries.map(([, v]) => v), domain]);
  }
  deleteTenant(domain: string): void { this.run("DELETE FROM tenants WHERE domain=?", [domain]); }

  listAxes(tenant: string): Record<AxisName, Row[]> {
    const out = Object.fromEntries(AXES.map((a) => [a, []])) as unknown as Record<AxisName, Row[]>;
    for (const row of this.all("SELECT * FROM axes WHERE tenant=? ORDER BY axis, weight DESC, value", [tenant])) out[row.axis as AxisName]?.push(row);
    return out;
  }
  bulkReplaceAxis(tenant: string, axis: AxisName, values: Row[]): void {
    this.transaction(() => {
      this.run("DELETE FROM axes WHERE tenant=? AND axis=?", [tenant, axis]);
      for (const v of values) {
        this.run(`INSERT INTO axes (tenant, axis, value, weight, monthly_search_volume, competition_kd) VALUES (?, ?, ?, ?, ?, ?)`,
          [tenant, axis, v.value, Number(v.weight ?? 3), v.monthly_search_volume ?? null, v.competition_kd ?? null]);
      }
    });
  }

  listSlots(tenant: string, opts: { status?: string; template?: string; q?: string; limit?: number; offset?: number } = {}): Row[] {
    const { where, args } = this.slotFilterClause(tenant, opts);
    const limit = Math.max(1, Math.min(2000, Math.trunc(Number(opts.limit ?? 200))));
    const offset = Math.max(0, Math.trunc(Number(opts.offset ?? 0)));
    return this.all(`SELECT * FROM slots ${where} ORDER BY priority_score DESC, slot_id LIMIT ? OFFSET ?`, [...args, limit, offset]);
  }
  countSlotsFiltered(tenant: string, opts: { status?: string; template?: string; q?: string } = {}): number {
    const { where, args } = this.slotFilterClause(tenant, opts);
    return Number(this.get(`SELECT COUNT(*) AS n FROM slots ${where}`, args)?.n ?? 0);
  }
  private slotFilterClause(tenant: string, opts: { status?: string; template?: string; q?: string }): { where: string; args: any[] } {
    let where = "WHERE tenant=?"; const args: any[] = [tenant];
    if (opts.status) { where += " AND status=?"; args.push(opts.status); }
    if (opts.template) { where += " AND template_id=?"; args.push(opts.template); }
    const q = String(opts.q || "").trim().toLowerCase();
    if (q) {
      const like = `%${q}%`;
      where += ` AND (
        lower(primary_keyword) LIKE ? OR lower(slot_id) LIKE ? OR lower(COALESCE(region,'')) LIKE ?
        OR lower(COALESCE(persona,'')) LIKE ? OR lower(COALESCE(intent,'')) LIKE ?
        OR lower(COALESCE(modifier_1,'')) LIKE ? OR lower(COALESCE(modifier_2,'')) LIKE ?
        OR lower(COALESCE(entity_id,'')) LIKE ?
      )`;
      args.push(like, like, like, like, like, like, like, like);
    }
    return { where, args };
  }
  selectSlotsForBatch(tenant: string, opts: { q?: string; template?: string; limit?: number; balanced?: boolean } = {}): Row[] {
    const { where, args } = this.slotFilterClause(tenant, { status: "planned", template: opts.template, q: opts.q });
    const candidates = this.all(`SELECT slot_id, region, template_id, primary_keyword, priority_score FROM slots ${where} ORDER BY priority_score DESC, slot_id LIMIT ?`, [...args, 10000]);
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(opts.limit ?? 10))));
    const groups = new Map<string, Row[]>();
    for (const row of candidates) {
      const key = opts.balanced ? String(row.region || "전국") : String(row.template_id || "기타");
      const bucket = groups.get(key) || [];
      bucket.push(row);
      groups.set(key, bucket);
    }
    const keys = [...groups.keys()].sort((a, b) => (groups.get(b)?.[0]?.priority_score ?? 0) - (groups.get(a)?.[0]?.priority_score ?? 0));
    const picked: Row[] = [];
    const seenTopic = new Set<string>();
    while (picked.length < limit && keys.length) {
      let progressed = false;
      for (const key of [...keys]) {
        const bucket = groups.get(key) || [];
        let next: Row | undefined;
        while (bucket.length) {
          const candidate = bucket.shift()!;
          const topic = `${candidate.region || ""}::${candidate.primary_keyword || ""}`;
          if (!seenTopic.has(topic)) { next = candidate; seenTopic.add(topic); break; }
        }
        if (next) { picked.push(next); progressed = true; }
        if (!bucket.length) keys.splice(keys.indexOf(key), 1);
        if (picked.length >= limit) break;
      }
      if (!progressed) break;
    }
    return picked;
  }
  countSlots(tenant: string): Record<string, number> {
    const out: Record<string, number> = { planned: 0, in_progress: 0, published: 0, failed: 0, pruned: 0 };
    for (const r of this.all("SELECT status, COUNT(*) AS n FROM slots WHERE tenant=? GROUP BY status", [tenant])) out[r.status] = r.n;
    return out;
  }
  bulkUpsertSlots(rows: Row[]): number {
    let inserted = 0;
    for (const s of rows) {
      const res = this.run(`INSERT INTO slots (slot_id, tenant, template_id, primary_keyword, region, persona, intent, modifier_1, modifier_2, entity_id, priority_score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(slot_id) DO UPDATE SET primary_keyword=excluded.primary_keyword, priority_score=excluded.priority_score`,
        [s.slot_id, s.tenant, s.template_id, s.primary_keyword, s.region ?? null, s.persona ?? null, s.intent ?? null, s.modifier_1 ?? null, s.modifier_2 ?? null, s.entity_id ?? null, s.priority_score ?? null]);
      if (res.changes) inserted += 1;
    }
    return inserted;
  }
  getSlot(slotId: string): Row | undefined { return this.get("SELECT * FROM slots WHERE slot_id=?", [slotId]); }
  updateSlotStatus(slotId: string, status: string, error?: string | null): void {
    if (error !== undefined) this.run("UPDATE slots SET status=?, last_error=? WHERE slot_id=?", [status, error, slotId]);
    else this.run("UPDATE slots SET status=? WHERE slot_id=?", [status, slotId]);
  }
  deleteSlot(tenant: string, slotId: string): number { return this.run("DELETE FROM slots WHERE slot_id=? AND tenant=?", [slotId, tenant]).changes ?? 0; }

  listPosts(tenant: string, opts: { status?: string; limit?: number } = {}): Row[] {
    let sql = `SELECT id, tenant, slot_id, slug, title, meta_description, status, design_template_id, provider, model, cost_usd, duration_sec, generated_at, length(body_markdown) AS body_chars FROM posts WHERE tenant=?`;
    const args: any[] = [tenant];
    if (opts.status) { sql += " AND status=?"; args.push(opts.status); }
    sql += " ORDER BY generated_at DESC LIMIT ?"; args.push(opts.limit ?? 200);
    return this.all(sql, args);
  }
  getPost(postId: string): Row | undefined { return this.get("SELECT * FROM posts WHERE id=?", [postId]); }
  getPostBySlug(tenant: string, slug: string, status?: string): Row | undefined {
    return this.get(`SELECT * FROM posts WHERE tenant=? AND slug=?${status ? " AND status=?" : ""}`, status ? [tenant, slug, status] : [tenant, slug]);
  }
  uniqueSlug(tenant: string, base: string, slotId?: string | null): string {
    if (slotId) {
      const existingForSlot = this.get("SELECT slug FROM posts WHERE tenant=? AND slot_id=? AND status!='deleted' ORDER BY generated_at DESC LIMIT 1", [tenant, slotId]);
      if (existingForSlot?.slug) return existingForSlot.slug;
    }
    let cand = (base || "post").replace(/^-+|-+$/g, "") || "post"; let i = 2;
    while (true) {
      const row = this.get("SELECT slot_id FROM posts WHERE tenant=? AND slug=?", [tenant, cand]);
      if (!row || row.slot_id === slotId) return cand;
      cand = `${base}-${i++}`;
    }
  }
  insertPost(input: Row): string {
    const id = randomUUID();
    this.run(`INSERT INTO posts (id, tenant, slot_id, slug, title, body_markdown, meta_description, images, design_template_id, provider, model, session_id, cost_usd, duration_sec, input_tokens, output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant, slug) DO UPDATE SET title=excluded.title, slot_id=excluded.slot_id, body_markdown=excluded.body_markdown, meta_description=excluded.meta_description, images=excluded.images, design_template_id=excluded.design_template_id, status='published', provider=excluded.provider, model=excluded.model, session_id=excluded.session_id, cost_usd=excluded.cost_usd, duration_sec=excluded.duration_sec, input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens, generated_at=CURRENT_TIMESTAMP`,
      [id, input.tenant, input.slot_id ?? null, input.slug, input.title, input.body_markdown, input.meta_description ?? null, input.images ?? null, input.design_template_id || "editorial", input.provider ?? null, input.model ?? null, input.session_id ?? null, input.cost_usd ?? 0, input.duration_sec ?? null, input.input_tokens ?? 0, input.output_tokens ?? 0]);
    return id;
  }
  deletePost(postId: string): void { this.run("DELETE FROM posts WHERE id=?", [postId]); }
  updatePostStatus(postId: string, status: string): void { this.run("UPDATE posts SET status=? WHERE id=?", [status, postId]); }
  listPostsForDedup(tenant: string, includeNoindex = false): Row[] {
    const statuses = includeNoindex ? "('published','noindex')" : "('published')";
    return this.all(`SELECT p.id, p.slug, p.title, p.body_markdown, p.status, p.generated_at, s.priority_score AS priority_score FROM posts p LEFT JOIN slots s ON s.slot_id = p.slot_id WHERE p.tenant=? AND p.status IN ${statuses} ORDER BY p.generated_at ASC`, [tenant]);
  }

  getSetting(key: string): string | null { return this.get("SELECT value FROM app_settings WHERE key=?", [key])?.value ?? null; }
  setSetting(key: string, value: string | null): void {
    this.run(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`, [key, value]);
  }

  upsertAcademies(tenant: string, rows: Row[]): number {
    let n = 0;
    for (const r of rows) {
      const name = String(r.name || "").trim(); if (!name) continue;
      const extra = typeof r.extra === "object" && r.extra !== null ? JSON.stringify(r.extra) : (r.extra ?? null);
      this.run(`INSERT INTO academies (id, tenant, external_id, region, name, address, price, shuttle, hours, pass_rate, phone, vphone, review, review_json, blog_reviews, seo_title, seo_keywords, seo_description, latitude, longitude, thumb_url, photos, academy_type, extra, source_name, source_url, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tenant, region, name) DO UPDATE SET address=excluded.address, price=excluded.price, shuttle=excluded.shuttle, hours=excluded.hours, pass_rate=excluded.pass_rate, phone=excluded.phone, vphone=excluded.vphone, review=excluded.review, review_json=excluded.review_json, blog_reviews=excluded.blog_reviews, seo_title=excluded.seo_title, seo_keywords=excluded.seo_keywords, seo_description=excluded.seo_description, latitude=excluded.latitude, longitude=excluded.longitude, thumb_url=excluded.thumb_url, photos=excluded.photos, academy_type=excluded.academy_type, extra=excluded.extra, source_name=excluded.source_name, source_url=excluded.source_url, synced_at=excluded.synced_at`,
        [randomUUID(), tenant, r.external_id ?? null, String(r.region || "").trim(), name, r.address ?? null, r.price ?? null, r.shuttle ?? null, r.hours ?? null, r.pass_rate ?? null, r.phone ?? null, r.vphone ?? null, r.review ?? null, encodeJson(r.review_json ?? r.reviews), encodeJson(r.blog_reviews), r.seo_title ?? null, r.seo_keywords ?? null, r.seo_description ?? null, r.latitude ?? null, r.longitude ?? null, r.thumb_url ?? null, encodeJson(r.photos), r.academy_type ?? null, extra, r.source_name ?? null, r.source_url ?? null, r.synced_at ?? null]);
      n += 1;
    }
    return n;
  }
  upsertDrivingplusAcademies(tenant: string, rows: Row[]): { fetched: number; upserted: number; skipped: number; warnings: string[] } {
    let upserted = 0, skipped = 0;
    const warnings: string[] = [];
    const regions = this.listSeoRegions(tenant);
    const syncedAt = nowSql();
    this.transaction(() => {
      for (const row of rows) {
        const externalId = String(row.id ?? "").trim();
        const name = String(row.title || "").trim();
        if (!externalId || !name) { skipped++; continue; }
        const address = nullableText(row.roadAddress);
        const region = bestRegionForAddress(address, regions) || fallbackRegionFromAddress(address);
        if (!region) warnings.push(`${name}: 주소에서 지역을 추정하지 못했습니다.`);
        const photos = Array.isArray(row.photos) ? row.photos.map((v) => String(v || "").trim()).filter(Boolean) : [];
        const reviews = normalizeDrivingplusReviews(row.reviews);
        const blogReviews = normalizeDrivingplusBlogReviews(row.blogReviews);
        const reviewText = reviewSummaryText(reviews);
        const existing = this.get("SELECT id FROM academies WHERE tenant=? AND external_id=?", [tenant, externalId]);
        if (existing) {
          this.run(`UPDATE academies SET region=?, name=?, address=?, phone=?, vphone=?, review=?, review_json=?, blog_reviews=?, seo_title=?, seo_keywords=?, seo_description=?, latitude=?, longitude=?, thumb_url=?, photos=?, academy_type=?, extra=?, source_name=?, source_url=?, synced_at=? WHERE id=? AND tenant=?`,
            [region, name, address, nullableText(row.phone), nullableText(row.vphone), reviewText, JSON.stringify(reviews), JSON.stringify(blogReviews), nullableText(row.seoTitle), nullableText(row.seoKeywords), nullableText(row.seoDescription), nullableNumber(row.roadLatitude), nullableNumber(row.roadLongitude), nullableText(row.thumbSavePath), JSON.stringify(photos), nullableText(row.type), JSON.stringify({ drivingplus_id: externalId, review_count: reviews.length, blog_review_count: blogReviews.length }), "DrivingPlus", `https://api-dev.drivingplus.me:18104/v1/academy/get-all-academy`, syncedAt, existing.id, tenant]);
        } else {
          this.run(`INSERT INTO academies (id, tenant, external_id, region, name, address, phone, vphone, review, review_json, blog_reviews, seo_title, seo_keywords, seo_description, latitude, longitude, thumb_url, photos, academy_type, extra, source_name, source_url, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tenant, region, name) DO UPDATE SET external_id=excluded.external_id, address=excluded.address, phone=excluded.phone, vphone=excluded.vphone, review=excluded.review, review_json=excluded.review_json, blog_reviews=excluded.blog_reviews, seo_title=excluded.seo_title, seo_keywords=excluded.seo_keywords, seo_description=excluded.seo_description, latitude=excluded.latitude, longitude=excluded.longitude, thumb_url=excluded.thumb_url, photos=excluded.photos, academy_type=excluded.academy_type, extra=excluded.extra, source_name=excluded.source_name, source_url=excluded.source_url, synced_at=excluded.synced_at
            WHERE academies.external_id IS NULL OR academies.external_id=excluded.external_id`,
            [randomUUID(), tenant, externalId, region, name, address, nullableText(row.phone), nullableText(row.vphone), reviewText, JSON.stringify(reviews), JSON.stringify(blogReviews), nullableText(row.seoTitle), nullableText(row.seoKeywords), nullableText(row.seoDescription), nullableNumber(row.roadLatitude), nullableNumber(row.roadLongitude), nullableText(row.thumbSavePath), JSON.stringify(photos), nullableText(row.type), JSON.stringify({ drivingplus_id: externalId, review_count: reviews.length, blog_review_count: blogReviews.length }), "DrivingPlus", `https://api-dev.drivingplus.me:18104/v1/academy/get-all-academy`, syncedAt]);
        }
        upserted++;
      }
    });
    return { fetched: rows.length, upserted, skipped, warnings: warnings.slice(0, 50) };
  }
  listAcademies(tenant: string, opts: { region?: string; limit?: number } = {}): Row[] {
    let sql = "SELECT * FROM academies WHERE tenant=?"; const args: any[] = [tenant];
    if (opts.region) { sql += " AND region=?"; args.push(opts.region); }
    sql += " ORDER BY name LIMIT ?"; args.push(opts.limit ?? 20);
    return this.all(sql, args);
  }
  getSeoRegion(tenant: string, region: string): Row | undefined {
    return this.get("SELECT * FROM seo_regions WHERE tenant=? AND region=? ORDER BY level DESC LIMIT 1", [tenant, region]);
  }
  listSeoRegions(tenant: string, opts: { level?: number; limit?: number } = {}): Row[] {
    let sql = "SELECT * FROM seo_regions WHERE tenant=?"; const args: any[] = [tenant];
    if (opts.level) { sql += " AND level=?"; args.push(opts.level); }
    sql += " ORDER BY level, region LIMIT ?"; args.push(opts.limit ?? 10000);
    return this.all(sql, args);
  }
  upsertSeoRegions(tenant: string, rows: Row[], sourceName = "DrivingPlus"): { fetched: number; upserted: number; skipped: number } {
    let upserted = 0, skipped = 0;
    const syncedAt = nowSql();
    this.transaction(() => {
      for (const row of rows) {
        const level = Number(row.level);
        const region = String(row.region || "").trim();
        if (!Number.isFinite(level) || !region) { skipped++; continue; }
        this.run(`INSERT INTO seo_regions (tenant, level, region, latitude, longitude, source_name, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tenant, level, region) DO UPDATE SET latitude=excluded.latitude, longitude=excluded.longitude, source_name=excluded.source_name, synced_at=excluded.synced_at`,
          [tenant, level, region, nullableNumber(row.latitude), nullableNumber(row.longitude), sourceName, syncedAt]);
        upserted++;
      }
    });
    return { fetched: rows.length, upserted, skipped };
  }
  deleteAcademy(tenant: string, id: string): number { return this.run("DELETE FROM academies WHERE id=? AND tenant=?", [id, tenant]).changes ?? 0; }
  deleteAcademies(tenant: string, region?: string): number {
    return this.run(`DELETE FROM academies WHERE tenant=?${region ? " AND region=?" : ""}`, region ? [tenant, region] : [tenant]).changes ?? 0;
  }

  enqueueJob(tenant: string, kind: JobKind, payload: Row): string {
    const id = randomUUID();
    this.run("INSERT INTO jobs (id, tenant, kind, payload, status) VALUES (?, ?, ?, ?, 'queued')", [id, tenant, kind, JSON.stringify(payload)]);
    return id;
  }
  claimNextJob(): Row | undefined {
    return this.transaction(() => {
      const row = this.get("SELECT * FROM jobs WHERE status='queued' ORDER BY scheduled_at LIMIT 1");
      if (!row) return undefined;
      const now = nowSql();
      this.run("UPDATE jobs SET status='running', started_at=? WHERE id=?", [now, row.id]);
      return { ...row, status: "running", started_at: now, payload_obj: safeJson(row.payload, {}) };
    });
  }
  completeJob(jobId: string, ok: boolean, result?: Row, error?: string): void {
    this.run("UPDATE jobs SET status=?, finished_at=?, result=?, error=? WHERE id=?", [ok ? "done" : "failed", nowSql(), result ? JSON.stringify(result) : null, error ?? null, jobId]);
  }
  listJobs(opts: { tenant?: string; status?: string; limit?: number } = {}): Row[] {
    let sql = "SELECT * FROM jobs WHERE 1=1"; const args: any[] = [];
    if (opts.tenant) { sql += " AND tenant=?"; args.push(opts.tenant); }
    if (opts.status) { sql += " AND status=?"; args.push(opts.status); }
    sql += " ORDER BY scheduled_at DESC LIMIT ?"; args.push(opts.limit ?? 100);
    return this.all(sql, args);
  }
}

export function safeJson(value: any, fallback: any): any {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function tenantOut(row: Row): Row { return { ...row, templates_enabled: safeJson(row.templates_enabled, []) }; }
export function jobOut(row: Row): Row { return { ...row, payload_obj: safeJson(row.payload, {}), result_obj: safeJson(row.result, {}) }; }
export function nowSql(): string { return new Date().toISOString().replace("T", " ").slice(0, 19); }

function encodeJson(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return null; }
}

function nullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDrivingplusReviews(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Row : {};
    const content = cleanText(row.content);
    const point = nullableNumber(row.point);
    if (!isPositiveReviewText(content, point)) return null;
    return {
      id: nullableNumber(row.id),
      author: nullableText(row.author),
      point,
      content: content.slice(0, 500),
      date: nullableText(row.date),
    };
  }).filter(Boolean).slice(0, 10) as Row[];
}

function normalizeDrivingplusBlogReviews(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Row : {};
    const title = cleanText(row.title);
    const content = cleanText(row.content);
    const link = nullableText(row.link);
    if (!title || !link) return null;
    if (!isPositiveReviewText(`${title} ${content}`, null)) return null;
    return {
      title: title.slice(0, 160),
      content: content ? content.slice(0, 500) : null,
      link,
      postdate: nullableText(row.postdate),
      images: Array.isArray(row.images) ? row.images.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 3) : [],
    };
  }).filter(Boolean).slice(0, 10) as Row[];
}

function reviewSummaryText(reviews: Row[]): string | null {
  const lines = reviews
    .map((review) => {
      const point = review.point ? `${review.point}점 ` : "";
      return `${point}${String(review.content || "").trim()}`.trim();
    })
    .filter(Boolean)
    .slice(0, 3);
  return lines.length ? lines.join("\n") : null;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulKoreanReview(text: string): boolean {
  if (!text || text.length < 12) return false;
  const korean = (text.match(/[가-힣]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  if (korean < 6) return false;
  if (digits > korean + 8) return false;
  if (/^(\d|[ㅋㅎㅠㅜ\s.,!?])+$/u.test(text)) return false;
  return true;
}

const NEGATIVE_REVIEW_RE = /불친절|최악|비추|별로|환불|짜증|화남|불만|실망|안\s*좋|안좋|문제\s*있|대기\s*길|너무\s*늦|엉망|후회/u;
const POSITIVE_REVIEW_RE = /친절|합격|좋|추천|감사|만족|편하|꼼꼼|잘\s*가르|빠르|한\s*번에|한번에|쉬웠|도움|최고|강추|자세히|설명|안심|쾌적|체계/u;
const RISKY_REVIEW_CLAIM_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합격|무조건|보장|\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;

function isPositiveReviewText(text: string, point: number | null): boolean {
  if (!isUsefulKoreanReview(text)) return false;
  if (NEGATIVE_REVIEW_RE.test(text)) return false;
  if (RISKY_REVIEW_CLAIM_RE.test(text)) return false;
  if (point !== null && point !== undefined && point < 4) return false;
  if (point !== null && point !== undefined && point >= 4) return true;
  return POSITIVE_REVIEW_RE.test(text);
}

function bestRegionForAddress(address: string | null, regions: Row[]): string | null {
  if (!address) return null;
  let best = "";
  for (const region of regions) {
    const value = String(region.region || "").trim();
    if (value && address.includes(value) && value.length > best.length) best = value;
  }
  return best || null;
}

function fallbackRegionFromAddress(address: string | null): string | null {
  if (!address) return null;
  const parts = address.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return parts[0] || null;
}
