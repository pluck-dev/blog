"""SQLite 스키마 + 헬퍼.

테이블 구조는 Supabase Postgres 로 마이그레이션할 때도 호환되도록 설계.
컬럼 타입은 SQLite에 맞춰 단순화 (TEXT/INTEGER/REAL).
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

ADMIN_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ADMIN_DIR.parent
DB_PATH = PROJECT_DIR / "data" / "admin.db"

SCHEMA = """
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

CREATE TABLE IF NOT EXISTS app_settings (
  key             TEXT PRIMARY KEY,
  value           TEXT,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS academies (
  id              TEXT PRIMARY KEY,
  tenant          TEXT NOT NULL,
  region          TEXT,
  name            TEXT NOT NULL,
  address         TEXT,
  price           TEXT,
  shuttle         TEXT,
  hours           TEXT,
  pass_rate       TEXT,
  phone           TEXT,
  review          TEXT,
  extra           TEXT,
  source_name     TEXT,
  source_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant, region, name),
  FOREIGN KEY (tenant) REFERENCES tenants(domain) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_academies_tenant_region
  ON academies(tenant, region);
"""


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.executescript(SCHEMA)


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, isolation_level=None, timeout=30.0)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
    finally:
        con.close()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def rows_to_list(rows) -> list[dict]:
    return [dict((k, r[k]) for k in r.keys()) for r in rows]


# ---------- Tenants ----------

def list_tenants() -> list[dict]:
    with connect() as con:
        rows = con.execute(
            """SELECT t.*,
                  (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain) AS slot_count,
                  (SELECT COUNT(*) FROM slots s WHERE s.tenant = t.domain AND s.status='planned') AS planned_count,
                  (SELECT COUNT(*) FROM posts p WHERE p.tenant = t.domain AND p.status='published') AS published_count
               FROM tenants t ORDER BY t.created_at DESC"""
        ).fetchall()
    return rows_to_list(rows)


def get_tenant(domain: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT * FROM tenants WHERE domain=?", (domain,)).fetchone()
    return row_to_dict(row)


def create_tenant(*, domain: str, display_name: str, vertical: str,
                  theme: str = "clean", brand_color: str = "#0066ff",
                  daily_limit: int = 30) -> None:
    with connect() as con:
        con.execute(
            """INSERT INTO tenants (domain, display_name, vertical, theme, brand_color, daily_limit)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (domain, display_name, vertical, theme, brand_color, daily_limit),
        )


def update_tenant(domain: str, **fields) -> None:
    if not fields:
        return
    allowed = {"display_name", "vertical", "theme", "brand_color",
               "daily_limit", "templates_enabled", "logo_url"}
    use = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not use:
        return
    sets = ", ".join(f"{k}=?" for k in use)
    with connect() as con:
        con.execute(f"UPDATE tenants SET {sets} WHERE domain=?",
                    (*use.values(), domain))


def delete_tenant(domain: str) -> None:
    with connect() as con:
        con.execute("DELETE FROM tenants WHERE domain=?", (domain,))


# ---------- Axes ----------

def list_axes(tenant: str) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {a: [] for a in
                                  ("region", "keyword", "intent", "persona", "modifier")}
    with connect() as con:
        rows = con.execute(
            "SELECT * FROM axes WHERE tenant=? ORDER BY axis, weight DESC, value",
            (tenant,),
        ).fetchall()
    for r in rows:
        out.setdefault(r["axis"], []).append(dict(r))
    return out


def upsert_axis_value(*, tenant: str, axis: str, value: str,
                     weight: int = 3,
                     monthly_search_volume: int | None = None,
                     competition_kd: int | None = None) -> None:
    with connect() as con:
        con.execute(
            """INSERT INTO axes (tenant, axis, value, weight,
                                 monthly_search_volume, competition_kd)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT (tenant, axis, value) DO UPDATE SET
                 weight=excluded.weight,
                 monthly_search_volume=excluded.monthly_search_volume,
                 competition_kd=excluded.competition_kd""",
            (tenant, axis, value, weight, monthly_search_volume, competition_kd),
        )


def delete_axis_value(*, tenant: str, axis: str, value: str) -> None:
    with connect() as con:
        con.execute(
            "DELETE FROM axes WHERE tenant=? AND axis=? AND value=?",
            (tenant, axis, value),
        )


def bulk_replace_axis(*, tenant: str, axis: str, values: list[dict]) -> None:
    """한 축 전체를 통째로 교체. values 는 [{value, weight, monthly_search_volume, competition_kd}]."""
    with connect() as con:
        con.execute("BEGIN")
        try:
            con.execute("DELETE FROM axes WHERE tenant=? AND axis=?", (tenant, axis))
            for v in values:
                con.execute(
                    """INSERT INTO axes (tenant, axis, value, weight,
                                         monthly_search_volume, competition_kd)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (tenant, axis, v["value"], int(v.get("weight") or 3),
                     v.get("monthly_search_volume"),
                     v.get("competition_kd")),
                )
            con.execute("COMMIT")
        except Exception:
            con.execute("ROLLBACK")
            raise


# ---------- Slots ----------

def list_slots(tenant: str, *, status: str | None = None,
               template: str | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM slots WHERE tenant=?"
    args: list = [tenant]
    if status:
        sql += " AND status=?"
        args.append(status)
    if template:
        sql += " AND template_id=?"
        args.append(template)
    sql += " ORDER BY priority_score DESC, slot_id LIMIT ?"
    args.append(limit)
    with connect() as con:
        rows = con.execute(sql, args).fetchall()
    return rows_to_list(rows)


def count_slots(tenant: str) -> dict[str, int]:
    out = {"planned": 0, "in_progress": 0, "published": 0, "failed": 0, "pruned": 0}
    with connect() as con:
        rows = con.execute(
            "SELECT status, COUNT(*) AS n FROM slots WHERE tenant=? GROUP BY status",
            (tenant,),
        ).fetchall()
    for r in rows:
        out[r["status"]] = r["n"]
    return out


def bulk_upsert_slots(rows: list[dict]) -> int:
    """slot_id 기준 upsert. 기존 slot 의 status 는 보존."""
    inserted = 0
    with connect() as con:
        for s in rows:
            res = con.execute(
                """INSERT INTO slots (slot_id, tenant, template_id, primary_keyword,
                                       region, persona, intent, modifier_1, modifier_2,
                                       entity_id, priority_score)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(slot_id) DO UPDATE SET
                     primary_keyword=excluded.primary_keyword,
                     priority_score=excluded.priority_score""",
                (s["slot_id"], s["tenant"], s["template_id"], s["primary_keyword"],
                 s.get("region"), s.get("persona"), s.get("intent"),
                 s.get("modifier_1"), s.get("modifier_2"),
                 s.get("entity_id"), s.get("priority_score")),
            )
            if res.rowcount:
                inserted += 1
    return inserted


def get_slot(slot_id: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT * FROM slots WHERE slot_id=?", (slot_id,)).fetchone()
    return row_to_dict(row)


def update_slot_status(slot_id: str, status: str, *, error: str | None = None) -> None:
    with connect() as con:
        if error is not None:
            con.execute(
                "UPDATE slots SET status=?, last_error=? WHERE slot_id=?",
                (status, error, slot_id),
            )
        else:
            con.execute("UPDATE slots SET status=? WHERE slot_id=?", (status, slot_id))


# ---------- Posts ----------

def list_posts(tenant: str, *, status: str | None = None, limit: int = 200) -> list[dict]:
    sql = """SELECT id, tenant, slot_id, slug, title, meta_description, status,
                    provider, model, cost_usd, duration_sec, generated_at,
                    length(body_markdown) AS body_chars
             FROM posts WHERE tenant=?"""
    args: list = [tenant]
    if status:
        sql += " AND status=?"
        args.append(status)
    sql += " ORDER BY generated_at DESC LIMIT ?"
    args.append(limit)
    with connect() as con:
        rows = con.execute(sql, args).fetchall()
    return rows_to_list(rows)


def get_post(post_id: str) -> dict | None:
    with connect() as con:
        row = con.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    return row_to_dict(row)


def get_post_by_slug(tenant: str, slug: str, *, status: str | None = None) -> dict | None:
    sql = "SELECT * FROM posts WHERE tenant=? AND slug=?"
    args: list = [tenant, slug]
    if status:
        sql += " AND status=?"
        args.append(status)
    with connect() as con:
        row = con.execute(sql, args).fetchone()
    return row_to_dict(row)


def insert_post(*, tenant: str, slot_id: str | None, slug: str, title: str,
                body_markdown: str, meta_description: str | None = None,
                provider: str | None = None, model: str | None = None,
                session_id: str | None = None, cost_usd: float = 0.0,
                duration_sec: float | None = None,
                input_tokens: int = 0, output_tokens: int = 0) -> str:
    post_id = str(uuid.uuid4())
    with connect() as con:
        con.execute(
            """INSERT INTO posts (id, tenant, slot_id, slug, title, body_markdown,
                                   meta_description, provider, model, session_id,
                                   cost_usd, duration_sec, input_tokens, output_tokens)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(tenant, slug) DO UPDATE SET
                 body_markdown=excluded.body_markdown,
                 provider=excluded.provider,
                 model=excluded.model,
                 cost_usd=excluded.cost_usd,
                 duration_sec=excluded.duration_sec,
                 input_tokens=excluded.input_tokens,
                 output_tokens=excluded.output_tokens,
                 generated_at=CURRENT_TIMESTAMP""",
            (post_id, tenant, slot_id, slug, title, body_markdown, meta_description,
             provider, model, session_id, cost_usd, duration_sec,
             input_tokens, output_tokens),
        )
    return post_id


def delete_post(post_id: str) -> None:
    with connect() as con:
        con.execute("DELETE FROM posts WHERE id=?", (post_id,))


def update_post_status(post_id: str, status: str) -> None:
    with connect() as con:
        con.execute("UPDATE posts SET status=? WHERE id=?", (status, post_id))


def list_posts_for_dedup(tenant: str, *, include_noindex: bool = False) -> list[dict]:
    """중복/가지치기용 — 본문 포함 + 슬롯 priority 조인."""
    statuses = "('published','noindex')" if include_noindex else "('published')"
    sql = f"""SELECT p.id, p.slug, p.title, p.body_markdown, p.status, p.generated_at,
                     s.priority_score AS priority_score
              FROM posts p
              LEFT JOIN slots s ON s.slot_id = p.slot_id
              WHERE p.tenant=? AND p.status IN {statuses}
              ORDER BY p.generated_at ASC"""
    with connect() as con:
        rows = con.execute(sql, (tenant,)).fetchall()
    return rows_to_list(rows)


# ---------- App settings (KV) ----------

def get_setting(key: str) -> str | None:
    with connect() as con:
        row = con.execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else None


def set_setting(key: str, value: str | None) -> None:
    with connect() as con:
        con.execute(
            """INSERT INTO app_settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP""",
            (key, value),
        )


# ---------- Academies (검증된 학원 자료) ----------

_ACAD_FIELDS = ("region", "name", "address", "price", "shuttle", "hours",
                "pass_rate", "phone", "review", "extra", "source_name", "source_url")


def upsert_academies(tenant: str, rows: list[dict]) -> int:
    n = 0
    with connect() as con:
        for r in rows:
            name = (r.get("name") or "").strip()
            if not name:
                continue
            extra = r.get("extra")
            if isinstance(extra, (dict, list)):
                extra = json.dumps(extra, ensure_ascii=False)
            con.execute(
                """INSERT INTO academies
                   (id, tenant, region, name, address, price, shuttle, hours,
                    pass_rate, phone, review, extra, source_name, source_url)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(tenant, region, name) DO UPDATE SET
                     address=excluded.address, price=excluded.price,
                     shuttle=excluded.shuttle, hours=excluded.hours,
                     pass_rate=excluded.pass_rate, phone=excluded.phone,
                     review=excluded.review, extra=excluded.extra,
                     source_name=excluded.source_name, source_url=excluded.source_url""",
                (str(uuid.uuid4()), tenant, (r.get("region") or "").strip(), name,
                 r.get("address"), r.get("price"), r.get("shuttle"), r.get("hours"),
                 r.get("pass_rate"), r.get("phone"), r.get("review"), extra,
                 r.get("source_name"), r.get("source_url")),
            )
            n += 1
    return n


def list_academies(tenant: str, *, region: str | None = None, limit: int = 20) -> list[dict]:
    sql = "SELECT * FROM academies WHERE tenant=?"
    args: list = [tenant]
    if region:
        sql += " AND region=?"
        args.append(region)
    sql += " ORDER BY name LIMIT ?"
    args.append(limit)
    with connect() as con:
        rows = con.execute(sql, args).fetchall()
    return rows_to_list(rows)


def delete_academies(tenant: str, *, region: str | None = None) -> int:
    sql = "DELETE FROM academies WHERE tenant=?"
    args: list = [tenant]
    if region:
        sql += " AND region=?"
        args.append(region)
    with connect() as con:
        cur = con.execute(sql, args)
        return cur.rowcount


# ---------- Jobs ----------

def enqueue_job(*, tenant: str, kind: str, payload: dict) -> str:
    job_id = str(uuid.uuid4())
    with connect() as con:
        con.execute(
            """INSERT INTO jobs (id, tenant, kind, payload, status)
               VALUES (?, ?, ?, ?, 'queued')""",
            (job_id, tenant, kind, json.dumps(payload, ensure_ascii=False)),
        )
    return job_id


def claim_next_job() -> dict | None:
    """가장 오래된 queued job 1개를 running 으로 전환하고 반환."""
    with connect() as con:
        con.execute("BEGIN IMMEDIATE")
        try:
            row = con.execute(
                """SELECT * FROM jobs WHERE status='queued'
                   ORDER BY scheduled_at LIMIT 1"""
            ).fetchone()
            if row is None:
                con.execute("ROLLBACK")
                return None
            now = time.strftime("%Y-%m-%d %H:%M:%S")
            con.execute(
                "UPDATE jobs SET status='running', started_at=? WHERE id=?",
                (now, row["id"]),
            )
            con.execute("COMMIT")
            return {**dict(row), "status": "running", "started_at": now,
                    "payload_obj": json.loads(row["payload"])}
        except Exception:
            con.execute("ROLLBACK")
            raise


def complete_job(job_id: str, *, ok: bool, result: dict | None = None,
                 error: str | None = None) -> None:
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    with connect() as con:
        con.execute(
            """UPDATE jobs SET status=?, finished_at=?, result=?, error=?
               WHERE id=?""",
            ("done" if ok else "failed", now,
             json.dumps(result, ensure_ascii=False) if result else None,
             error, job_id),
        )


def list_jobs(*, tenant: str | None = None, status: str | None = None,
              limit: int = 100) -> list[dict]:
    sql = "SELECT * FROM jobs WHERE 1=1"
    args: list = []
    if tenant:
        sql += " AND tenant=?"
        args.append(tenant)
    if status:
        sql += " AND status=?"
        args.append(status)
    sql += " ORDER BY scheduled_at DESC LIMIT ?"
    args.append(limit)
    with connect() as con:
        rows = con.execute(sql, args).fetchall()
    return rows_to_list(rows)
