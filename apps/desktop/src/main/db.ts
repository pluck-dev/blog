import Database from "better-sqlite3";
import { app } from "electron";
import { mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type {
  Tenant, AxisValue, Slot, Post, PostSummary, Job, JobWithPayload,
  Axis, SlotCounts, SlotStatus, PostStatus, JobKind, JobStatus,
} from "@shared/types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  domain          TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  vertical        TEXT NOT NULL,
  theme           TEXT NOT NULL DEFAULT 'clean'
                  CHECK (theme IN ('clean','modern','pro')),
  brand_color     TEXT DEFAULT '#0066ff',
  logo_url        TEXT,
  templates_enabled TEXT NOT NULL DEFAULT '["T01","T03","T05","T07"]',
  design_template_id TEXT NOT NULL DEFAULT 'editorial',
  custom_design_templates TEXT,
  content_brief   TEXT,
  daily_limit     INTEGER NOT NULL DEFAULT 30,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS axes (
  tenant          TEXT NOT NULL,
  axis            TEXT NOT NULL CHECK (axis IN
                   ('region','keyword','intent','persona','modifier')),
  value           TEXT NOT NULL,
  weight          INTEGER NOT NULL DEFAULT 3,
  monthly_search_volume INTEGER,
  competition_kd  INTEGER,
  PRIMARY KEY (tenant, axis, value),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS slots (
  slot_id         TEXT PRIMARY KEY,
  tenant          TEXT NOT NULL,
  template_id     TEXT NOT NULL,
  primary_keyword TEXT NOT NULL,
  region          TEXT,
  persona         TEXT,
  intent          TEXT,
  modifier_1      TEXT,
  modifier_2      TEXT,
  entity_id       TEXT,
  priority_score  REAL,
  status          TEXT NOT NULL DEFAULT 'planned'
                  CHECK (status IN
                   ('planned','in_progress','published','failed','pruned')),
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_slots_tenant_status
  ON slots(tenant, status, priority_score DESC);

CREATE TABLE IF NOT EXISTS posts (
  id              TEXT PRIMARY KEY,
  tenant          TEXT NOT NULL,
  slot_id         TEXT,
  slug            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body_markdown   TEXT NOT NULL,
  meta_description TEXT,
  design_template_id TEXT NOT NULL DEFAULT 'editorial',
  status          TEXT NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published','noindex','deleted')),
  provider        TEXT,
  model           TEXT,
  session_id      TEXT,
  cost_usd        REAL DEFAULT 0,
  duration_sec    REAL,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  generated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant, slug),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(slot_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  tenant          TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN
                   ('generate','dedup','indexing','prune')),
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed')),
  scheduled_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at      TEXT,
  finished_at     TEXT,
  error           TEXT,
  result          TEXT,
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_jobs_status_sched
  ON jobs(status, scheduled_at);
`;

let _db: Database.Database | null = null;

export function dbPath(): string {
  const dir = join(app.getPath("userData"), "data");
  mkdirSync(dir, { recursive: true });
  return join(dir, "admin.db");
}

export function db(): Database.Database {
  if (_db) return _db;
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  _db.exec(SCHEMA);
  migrateDb(_db);
  return _db;
}

export function initDb(): void {
  db();
}

function nowIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- Tenants ----------

export function listTenants(): Tenant[] {
  return db()
    .prepare(
      `SELECT t.*,
        (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain) AS slot_count,
        (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain AND s.status='planned') AS planned_count,
        (SELECT COUNT(*) FROM posts p WHERE p.tenant = t.domain AND p.status='published') AS published_count
       FROM tenants t ORDER BY t.created_at DESC`,
    )
    .all() as Tenant[];
}

export function getTenant(domain: string): Tenant | null {
  return (db().prepare(`SELECT * FROM tenants WHERE domain=?`).get(domain) as Tenant | undefined) ?? null;
}

export function createTenant(args: {
  domain: string;
  display_name: string;
  vertical: string;
  theme?: string;
  brand_color?: string;
  daily_limit?: number;
}): void {
  db()
    .prepare(
      `INSERT INTO tenants (domain, display_name, vertical, theme, brand_color, daily_limit)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      args.domain,
      args.display_name,
      args.vertical,
      args.theme ?? "clean",
      args.brand_color ?? "#0066ff",
      args.daily_limit ?? 30,
    );
}

const TENANT_UPDATABLE = new Set([
  "display_name", "vertical", "theme", "brand_color",
  "daily_limit", "templates_enabled", "logo_url",
  "design_template_id", "custom_design_templates", "content_brief",
]);

function migrateDb(conn: Database.Database): void {
  const tenantCols = new Set(
    (conn.prepare(`PRAGMA table_info(tenants)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!tenantCols.has("design_template_id")) {
    conn.exec(`ALTER TABLE tenants ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'editorial'`);
  }
  if (!tenantCols.has("custom_design_templates")) {
    conn.exec(`ALTER TABLE tenants ADD COLUMN custom_design_templates TEXT`);
  }
  if (!tenantCols.has("content_brief")) {
    conn.exec(`ALTER TABLE tenants ADD COLUMN content_brief TEXT`);
  }

  const postCols = new Set(
    (conn.prepare(`PRAGMA table_info(posts)`).all() as { name: string }[]).map((c) => c.name),
  );
  if (!postCols.has("design_template_id")) {
    conn.exec(`ALTER TABLE posts ADD COLUMN design_template_id TEXT NOT NULL DEFAULT 'editorial'`);
    conn.exec(`
      UPDATE posts
      SET design_template_id = COALESCE(
        (SELECT t.design_template_id FROM tenants t WHERE t.domain = posts.tenant),
        'editorial'
      )
    `);
  }
}

export function updateTenant(domain: string, fields: Record<string, unknown>): void {
  const use: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (TENANT_UPDATABLE.has(k) && v !== undefined && v !== null) use[k] = v;
  }
  if (Object.keys(use).length === 0) return;
  const sets = Object.keys(use).map((k) => `${k}=?`).join(", ");
  db().prepare(`UPDATE tenants SET ${sets} WHERE domain=?`).run(...Object.values(use), domain);
}

export function deleteTenant(domain: string): void {
  db().prepare(`DELETE FROM tenants WHERE domain=?`).run(domain);
}

// ---------- Axes ----------

export function listAxes(tenant: string): Record<Axis, AxisValue[]> {
  const out: Record<Axis, AxisValue[]> = {
    region: [], keyword: [], intent: [], persona: [], modifier: [],
  };
  const rows = db()
    .prepare(`SELECT * FROM axes WHERE tenant=? ORDER BY axis, weight DESC, value`)
    .all(tenant) as AxisValue[];
  for (const r of rows) out[r.axis].push(r);
  return out;
}

export function bulkReplaceAxis(args: {
  tenant: string;
  axis: Axis;
  values: { value: string; weight?: number; monthly_search_volume?: number | null; competition_kd?: number | null }[];
}): void {
  const tx = db().transaction(() => {
    db().prepare(`DELETE FROM axes WHERE tenant=? AND axis=?`).run(args.tenant, args.axis);
    const insert = db().prepare(
      `INSERT INTO axes (tenant, axis, value, weight, monthly_search_volume, competition_kd)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const v of args.values) {
      insert.run(
        args.tenant, args.axis, v.value, v.weight ?? 3,
        v.monthly_search_volume ?? null, v.competition_kd ?? null,
      );
    }
  });
  tx();
}

// ---------- Slots ----------

export function listSlots(args: {
  tenant: string; status?: SlotStatus | null; template?: string | null; limit?: number;
}): Slot[] {
  let sql = `SELECT * FROM slots WHERE tenant=?`;
  const params: unknown[] = [args.tenant];
  if (args.status) { sql += ` AND status=?`; params.push(args.status); }
  if (args.template) { sql += ` AND template_id=?`; params.push(args.template); }
  sql += ` ORDER BY priority_score DESC, slot_id LIMIT ?`;
  params.push(args.limit ?? 300);
  return db().prepare(sql).all(...params) as Slot[];
}

export function countSlots(tenant: string): SlotCounts {
  const out: SlotCounts = { planned: 0, in_progress: 0, published: 0, failed: 0, pruned: 0 };
  const rows = db()
    .prepare(`SELECT status, COUNT(*) AS n FROM slots WHERE tenant=? GROUP BY status`)
    .all(tenant) as { status: SlotStatus; n: number }[];
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export function bulkUpsertSlots(rows: Array<{
  slot_id: string; tenant: string; template_id: string; primary_keyword: string;
  region?: string | null; persona?: string | null; intent?: string | null;
  modifier_1?: string | null; modifier_2?: string | null;
  entity_id?: string | null; priority_score?: number | null;
}>): number {
  let inserted = 0;
  const stmt = db().prepare(
    `INSERT INTO slots (slot_id, tenant, template_id, primary_keyword,
                        region, persona, intent, modifier_1, modifier_2,
                        entity_id, priority_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(slot_id) DO UPDATE SET
       primary_keyword=excluded.primary_keyword,
       priority_score=excluded.priority_score`,
  );
  const tx = db().transaction(() => {
    for (const s of rows) {
      const res = stmt.run(
        s.slot_id, s.tenant, s.template_id, s.primary_keyword,
        s.region ?? null, s.persona ?? null, s.intent ?? null,
        s.modifier_1 ?? null, s.modifier_2 ?? null,
        s.entity_id ?? null, s.priority_score ?? null,
      );
      if (res.changes) inserted += 1;
    }
  });
  tx();
  return inserted;
}

export function getSlot(slotId: string): Slot | null {
  return (db().prepare(`SELECT * FROM slots WHERE slot_id=?`).get(slotId) as Slot | undefined) ?? null;
}

export function updateSlotStatus(slotId: string, status: SlotStatus, error?: string | null): void {
  if (error !== undefined) {
    db().prepare(`UPDATE slots SET status=?, last_error=? WHERE slot_id=?`).run(status, error, slotId);
  } else {
    db().prepare(`UPDATE slots SET status=? WHERE slot_id=?`).run(status, slotId);
  }
}

export function deleteSlot(slotId: string, tenant: string): void {
  db().prepare(`DELETE FROM slots WHERE slot_id=? AND tenant=?`).run(slotId, tenant);
}

// ---------- Posts ----------

export function listPosts(args: { tenant: string; status?: PostStatus | null; limit?: number }): PostSummary[] {
  let sql = `SELECT id, tenant, slot_id, slug, title, meta_description, status,
                    design_template_id, provider, model, cost_usd, duration_sec, generated_at,
                    length(body_markdown) AS body_chars
             FROM posts WHERE tenant=?`;
  const params: unknown[] = [args.tenant];
  if (args.status) { sql += ` AND status=?`; params.push(args.status); }
  sql += ` ORDER BY generated_at DESC LIMIT ?`;
  params.push(args.limit ?? 200);
  return db().prepare(sql).all(...params) as PostSummary[];
}

export function getPost(postId: string): Post | null {
  return (db().prepare(`SELECT * FROM posts WHERE id=?`).get(postId) as Post | undefined) ?? null;
}

export function insertPost(args: {
  tenant: string; slot_id?: string | null; slug: string; title: string;
  body_markdown: string; meta_description?: string | null;
  design_template_id?: string | null;
  provider?: string | null; model?: string | null;
  session_id?: string | null; cost_usd?: number;
  duration_sec?: number | null;
  input_tokens?: number; output_tokens?: number;
}): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO posts (id, tenant, slot_id, slug, title, body_markdown,
                         meta_description, design_template_id, provider, model, session_id,
                         cost_usd, duration_sec, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant, slug) DO UPDATE SET
       body_markdown=excluded.body_markdown,
       design_template_id=excluded.design_template_id,
       provider=excluded.provider,
       model=excluded.model,
       cost_usd=excluded.cost_usd,
       duration_sec=excluded.duration_sec,
       input_tokens=excluded.input_tokens,
       output_tokens=excluded.output_tokens,
       generated_at=CURRENT_TIMESTAMP`,
  ).run(
    id, args.tenant, args.slot_id ?? null, args.slug, args.title, args.body_markdown,
    args.meta_description ?? null, args.design_template_id ?? "editorial",
    args.provider ?? null, args.model ?? null,
    args.session_id ?? null, args.cost_usd ?? 0, args.duration_sec ?? null,
    args.input_tokens ?? 0, args.output_tokens ?? 0,
  );
  return id;
}

export function deletePost(postId: string): void {
  const conn = db();
  const tx = conn.transaction(() => {
    const post = conn.prepare(`SELECT slot_id FROM posts WHERE id=?`).get(postId) as { slot_id: string | null } | undefined;
    conn.prepare(`DELETE FROM posts WHERE id=?`).run(postId);
    if (post?.slot_id) {
      conn.prepare(`UPDATE slots SET status='planned', last_error=NULL WHERE slot_id=?`).run(post.slot_id);
    }
  });
  tx();
}

export interface PostForDedup {
  id: string;
  slug: string;
  title: string;
  body_markdown: string;
  status: PostStatus;
  generated_at: string;
  priority_score: number | null;
}

/** 중복 검사용 — 본문 포함 + 슬롯 우선순위 조인. 기본은 발행(published) 글만. */
export function listPostsForDedup(tenant: string, includeNoindex = false): PostForDedup[] {
  const statusFilter = includeNoindex ? `('published','noindex')` : `('published')`;
  return db().prepare(
    `SELECT p.id, p.slug, p.title, p.body_markdown, p.status, p.generated_at,
            s.priority_score AS priority_score
     FROM posts p
     LEFT JOIN slots s ON s.slot_id = p.slot_id
     WHERE p.tenant=? AND p.status IN ${statusFilter}
     ORDER BY p.generated_at ASC`,
  ).all(tenant) as PostForDedup[];
}

/** 포스트 상태 갱신(예: 중복 → noindex). */
export function updatePostStatus(postId: string, status: PostStatus): void {
  db().prepare(`UPDATE posts SET status=? WHERE id=?`).run(status, postId);
}

// ---------- Jobs ----------

export function enqueueJob(args: { tenant: string; kind: JobKind; payload: object }): string {
  const id = randomUUID();
  db().prepare(
    `INSERT INTO jobs (id, tenant, kind, payload, status) VALUES (?, ?, ?, ?, 'queued')`,
  ).run(id, args.tenant, args.kind, JSON.stringify(args.payload));
  return id;
}

export function claimNextJob(): JobWithPayload | null {
  const conn = db();
  const tx = conn.transaction(() => {
    const row = conn.prepare(
      `SELECT * FROM jobs WHERE status='queued' ORDER BY scheduled_at LIMIT 1`,
    ).get() as Job | undefined;
    if (!row) return null;
    const started = nowIso();
    conn.prepare(`UPDATE jobs SET status='running', started_at=? WHERE id=?`).run(started, row.id);
    let payload_obj: Record<string, unknown> = {};
    try { payload_obj = JSON.parse(row.payload); } catch { /* ignore */ }
    return { ...row, status: "running" as JobStatus, started_at: started, payload_obj };
  });
  return tx();
}

export function completeJob(jobId: string, args: { ok: boolean; result?: object | null; error?: string | null }): void {
  const finished = nowIso();
  db().prepare(
    `UPDATE jobs SET status=?, finished_at=?, result=?, error=? WHERE id=?`,
  ).run(
    args.ok ? "done" : "failed",
    finished,
    args.result ? JSON.stringify(args.result) : null,
    args.error ?? null,
    jobId,
  );
}

export function listJobs(args: { tenant?: string | null; status?: JobStatus | null; limit?: number }): JobWithPayload[] {
  let sql = `SELECT * FROM jobs WHERE 1=1`;
  const params: unknown[] = [];
  if (args.tenant) { sql += ` AND tenant=?`; params.push(args.tenant); }
  if (args.status) { sql += ` AND status=?`; params.push(args.status); }
  sql += ` ORDER BY scheduled_at DESC LIMIT ?`;
  params.push(args.limit ?? 200);
  const rows = db().prepare(sql).all(...params) as Job[];
  return rows.map((j) => {
    let payload_obj: Record<string, unknown> = {};
    let result_obj: Record<string, unknown> | undefined;
    try { payload_obj = JSON.parse(j.payload); } catch { /* ignore */ }
    if (j.result) { try { result_obj = JSON.parse(j.result); } catch { /* ignore */ } }
    return { ...j, payload_obj, result_obj };
  });
}

export function cancelJob(jobId: string): boolean {
  const finished = nowIso();
  const queued = db()
    .prepare(`UPDATE jobs SET status='failed', finished_at=?, error='cancelled before start' WHERE id=? AND status='queued'`)
    .run(finished, jobId);
  if (queued.changes > 0) return true;

  const running = db()
    .prepare(`UPDATE jobs SET error='cancel_requested' WHERE id=? AND status='running'`)
    .run(jobId);
  return running.changes > 0;
}

export function isJobCancelRequested(jobId: string): boolean {
  const row = db().prepare(`SELECT error FROM jobs WHERE id=?`).get(jobId) as { error: string | null } | undefined;
  return row?.error === "cancel_requested";
}
