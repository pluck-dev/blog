import { Inject, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DbService, safeJson } from "./db.service.js";

type Row = Record<string, any>;

type LlmResult = { ok: boolean; summary: string; provider: string; model: string; duration_sec: number; cost_usd?: number; input_tokens?: number; output_tokens?: number; session_id?: string; error?: string };
type GenerationFacts = { text: string; images: Record<string, string> };

@Injectable()
export class WorkerService {
  private running = false;
  constructor(@Inject(DbService) private readonly db: DbService) {}

  startLoop(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  private async loop(): Promise<void> {
    const interval = Number(process.env.WORKER_POLL_INTERVAL || 3) * 1000;
    console.log("Nest worker loop started");
    while (this.running) {
      const job = this.db.claimNextJob();
      if (!job) { await sleep(interval); continue; }
      try {
        const result = await this.process(job);
        this.db.completeJob(job.id, true, result);
      } catch (error: any) {
        this.db.completeJob(job.id, false, undefined, error?.message || String(error));
      }
    }
  }

  async process(job: Row): Promise<Row> {
    const payload = job.payload_obj || safeJson(job.payload, {});
    if (job.kind === "generate") return this.processGenerate(job.tenant, payload);
    if (job.kind === "dedup") return this.processDedup(job.tenant, payload);
    if (job.kind === "prune") return this.processPrune(job.tenant, payload);
    if (job.kind === "indexing") return this.processIndexing(job.tenant, payload);
    throw new Error(`unknown job kind: ${job.kind}`);
  }

  private async processGenerate(tenant: string, payload: Row): Promise<Row> {
    const tenantMeta = this.db.getTenant(tenant) || {};
    const designTemplateId = payload.design_template_id || tenantMeta.design_template_id || "editorial";
    const slotIds = Array.isArray(payload.slot_ids) ? payload.slot_ids : [];
    let ok = 0, fail = 0;
    const per_slot: Row[] = [];
    for (const [index, sid] of slotIds.entries()) {
      const slot = this.db.getSlot(sid);
      if (!slot || slot.tenant !== tenant) { fail++; per_slot.push({ slot_id: sid, ok: false, error: "not found" }); continue; }
      this.db.updateSlotStatus(sid, "in_progress");
      try {
        const facts = this.buildFacts(tenant, slot);
        const prompt = buildPrompt(tenantMeta, slot, facts.text, designTemplateId);
        const result = await runLlm(prompt, { provider: payload.provider || "claude", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) });
        if (!result.ok || !result.summary.trim()) throw new Error(result.error || "empty summary");
        const markdown = stripPreamble(result.summary);
        const title = extractTitle(markdown, slot.primary_keyword);
        const slug = this.db.uniqueSlug(tenant, slugify(title), sid);
        this.db.insertPost({
          tenant, slot_id: sid, slug, title, body_markdown: markdown,
          meta_description: metaDescription(markdown), images: Object.keys(facts.images).length ? JSON.stringify(facts.images) : null, design_template_id: designTemplateId,
          provider: result.provider, model: result.model, session_id: result.session_id, cost_usd: result.cost_usd || 0,
          duration_sec: result.duration_sec, input_tokens: result.input_tokens || 0, output_tokens: result.output_tokens || 0
        });
        this.db.updateSlotStatus(sid, "published");
        publishHtml(slug, markdown);
        ok++; per_slot.push({ slot_id: sid, ok: true, duration_sec: result.duration_sec, chars: markdown.length, model: result.model });
      } catch (error: any) {
        const message = error?.message || String(error);
        this.db.updateSlotStatus(sid, "failed", message);
        fail++; per_slot.push({ slot_id: sid, ok: false, error: message });
      }
      if (index < slotIds.length - 1) await sleep(Number(payload.cooldown_sec || 60) * 1000);
    }
    return { ok, fail, per_slot };
  }

  private buildFacts(tenant: string, slot: Row): GenerationFacts {
    if (!slot.region) return { text: "", images: {} };
    const academies = this.pickAcademiesForRegion(tenant, String(slot.region), 5);
    const images: Record<string, string> = {};
    const text = academies.map((a, i) => {
      const imageKey = firstImageKey(a, i + 1);
      if (imageKey.url) images[imageKey.key] = imageKey.url;
      const parts = [`[${i + 1}] ${a.name}`];
      for (const [label, key] of [["주소", "address"], ["수강료", "price"], ["셔틀", "shuttle"], ["영업시간", "hours"], ["합격률", "pass_rate"], ["전화", "phone"], ["대표전화", "vphone"], ["후기", "review"], ["SEO 설명", "seo_description"], ["SEO 키워드", "seo_keywords"], ["유형", "academy_type"]] as const) if (a[key]) parts.push(`${label}: ${a[key]}`);
      if (a.latitude && a.longitude) parts.push(`좌표: ${a.latitude}, ${a.longitude}`);
      if (imageKey.url) parts.push(`이미지: [IMAGE:${imageKey.key}] ${imageKey.url}`);
      if (a.external_id) parts.push(`DrivingPlus academy_id=${a.external_id}`);
      const src = [a.source_name, a.source_url].filter(Boolean).join(" "); if (src) parts.push(`(출처: ${src})`);
      return parts.join(" / ");
    }).join("\n");
    return { text, images };
  }

  private pickAcademiesForRegion(tenant: string, region: string, limit: number): Row[] {
    const exact = this.db.listAcademies(tenant, { region, limit });
    if (exact.length >= limit) return exact;
    const regionMeta = this.db.getSeoRegion(tenant, region);
    const lat = Number(regionMeta?.latitude);
    const lng = Number(regionMeta?.longitude);
    const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);
    const all = this.db.listAcademies(tenant, { limit: 5000 });
    const scored = all.map((a) => {
      const addr = String(a.address || "");
      const rowRegion = String(a.region || "");
      let score = Number.POSITIVE_INFINITY;
      if (rowRegion === region) score = 0;
      else if (addr.includes(region)) score = 1;
      else if (rowRegion && (region.includes(rowRegion) || rowRegion.includes(region))) score = 2;
      else if (sharesRegionToken(region, addr) || sharesRegionToken(region, rowRegion)) score = 5;
      if (hasPoint && Number.isFinite(Number(a.latitude)) && Number.isFinite(Number(a.longitude))) {
        const km = haversineKm(lat, lng, Number(a.latitude), Number(a.longitude));
        score = Math.min(score, 10 + km);
      }
      return { academy: a, score };
    }).filter((r) => Number.isFinite(r.score));
    const seen = new Set<string>();
    const merged = [...exact.map((academy) => ({ academy, score: 0 })), ...scored]
      .sort((a, b) => a.score - b.score || String(a.academy.name).localeCompare(String(b.academy.name), "ko"))
      .filter((r) => {
        const key = String(r.academy.external_id || r.academy.id || r.academy.name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return merged.slice(0, limit).map((r) => r.academy);
  }

  private processDedup(tenant: string, payload: Row): Row {
    const threshold = Number(payload.threshold ?? 0.75);
    const dryRun = Boolean(payload.dry_run);
    const posts = this.db.listPostsForDedup(tenant, false);
    const pairs: Row[] = [];
    for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) {
      const left = posts[i]!;
      const right = posts[j]!;
      const sim = jaccard(left.body_markdown || "", right.body_markdown || "");
      if (sim >= threshold) {
        const loser = Number(left.priority_score || 0) <= Number(right.priority_score || 0) ? left : right;
        pairs.push({ a: left.id, b: right.id, similarity: Math.round(sim * 1000) / 1000, noindex: loser.id });
        if (!dryRun) this.db.updatePostStatus(loser.id, "noindex");
      }
    }
    return { threshold, dry_run: dryRun, pairs, changed: dryRun ? 0 : new Set(pairs.map((p) => p.noindex)).size };
  }

  private processPrune(tenant: string, payload: Row): Row {
    const minChars = Number(payload.min_body_chars ?? 700);
    const dryRun = Boolean(payload.dry_run);
    const rows = this.db.all("SELECT id, title, length(body_markdown) AS chars FROM posts WHERE tenant=? AND status='published'", [tenant]);
    const targets = rows.filter((r) => Number(r.chars || 0) < minChars);
    if (!dryRun) for (const r of targets) this.db.updatePostStatus(r.id, "noindex");
    return { min_body_chars: minChars, dry_run: dryRun, candidates: targets, changed: dryRun ? 0 : targets.length };
  }

  private processIndexing(tenant: string, payload: Row): Row {
    const max = Number(payload.max ?? 200);
    const tpl = this.db.getSetting("indexing_url_template") || "https://{domain}/community/{slug}";
    const posts = this.db.listPosts(tenant, { status: "published", limit: max });
    const urls = posts.map((p) => tpl.replace("{domain}", tenant).replace("{slug}", p.slug));
    return { configured: Boolean(this.db.getSetting("google_sa_json")), submitted: 0, urls, note: "Nest worker collected URLs. Google Indexing submission is intentionally skipped unless a service account integration is added." };
  }
}

export async function runWorkerOnceForCli(): Promise<void> {
  const db = new DbService(); db.init();
  const worker = new WorkerService(db);
  const job = db.claimNextJob();
  if (!job) { console.log("no queued job"); return; }
  try { db.completeJob(job.id, true, await worker.process(job)); }
  catch (error: any) { db.completeJob(job.id, false, undefined, error?.message || String(error)); process.exitCode = 1; }
}

async function runLlm(prompt: string, opts: { provider: string; model?: string; timeoutSec: number }): Promise<LlmResult> {
  const started = Date.now();
  if (opts.provider === "codex") {
    const args = ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", "-c", 'approval_policy="never"'];
    if (opts.model) args.push("--model", opts.model);
    args.push("-");
    const out = await spawnText("codex", args, prompt, opts.timeoutSec);
    const parsed = parseCodex(out.stdout);
    return { ok: out.code === 0 && Boolean(parsed.summary.trim()), summary: parsed.summary, provider: "codex", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000, error: out.code === 0 ? undefined : out.stderr };
  }
  const args = ["--print", "-", "--output-format", "stream-json", "--verbose"];
  if (opts.model) args.push("--model", opts.model);
  const out = await spawnText("claude", args, prompt, opts.timeoutSec, { ANTHROPIC_API_KEY: undefined, ANTHROPIC_AUTH_TOKEN: undefined });
  const parsed = parseClaude(out.stdout);
  return { ok: out.code === 0 && Boolean(parsed.summary.trim()), summary: parsed.summary, provider: "claude", model: parsed.model || opts.model || "", duration_sec: (Date.now() - started) / 1000, cost_usd: parsed.cost_usd, session_id: parsed.session_id, error: out.code === 0 ? undefined : out.stderr };
}

function spawnText(cmd: string, args: string[], input: string, timeoutSec: number, envPatch: Record<string, string | undefined> = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [k, v] of Object.entries(envPatch)) { if (v === undefined) delete env[k]; else env[k] = v; }
    const child = spawn(cmd, args, { env, cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutSec * 1000);
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (e) => { clearTimeout(timer); resolvePromise({ code: 127, stdout, stderr: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

function parseClaude(stdout: string) {
  let summary = "", model = "", session_id = "", cost_usd = 0; const chunks: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === "assistant") {
        model ||= obj.message?.model || ""; session_id ||= obj.session_id || obj.message?.session_id || "";
        for (const blk of obj.message?.content || []) if (blk?.type === "text" && blk.text) chunks.push(blk.text);
      } else if (obj.type === "result") { summary = obj.result || summary; cost_usd = Number(obj.total_cost_usd || 0); session_id ||= obj.session_id || ""; }
    } catch { /* ignore */ }
  }
  return { summary: summary || chunks.join("\n").trim(), model, session_id, cost_usd };
}
function parseCodex(stdout: string) {
  let summary = "", model = "";
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const obj = JSON.parse(line);
      model ||= obj.model || obj.turn?.model || "";
      if (typeof obj.item?.text === "string") summary = obj.item.text;
      if (typeof obj.output === "string") summary = obj.output;
      if (typeof obj.message?.content === "string") summary = obj.message.content;
    } catch { /* ignore */ }
  }
  return { summary, model };
}

function firstImageKey(row: Row, index: number): { key: string; url: string } {
  const photos = safeJson(row.photos, []);
  const url = Array.isArray(photos) ? String(photos[0] || "").trim() : "";
  return { key: `academy_${index}`, url: url || String(row.thumb_url || "").trim() };
}

function sharesRegionToken(region: string, text: string): boolean {
  if (!region || !text) return false;
  const tokens = region.split(/\s+/).filter((t) => t.length >= 2);
  return tokens.some((token) => text.includes(token));
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function deg2rad(value: number): number { return value * Math.PI / 180; }

function buildPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string): string {
  return `너는 한국어 SEO 콘텐츠 에디터다. 아래 슬롯에 맞춰 바로 발행 가능한 Markdown 글을 작성하라.\n\n테넌트: ${tenant.display_name || tenant.domain}\n업종: ${tenant.vertical || "general"}\n디자인 템플릿: ${designTemplateId}\n템플릿: ${slot.template_id}\n주 키워드: ${slot.primary_keyword}\n지역: ${slot.region || ""}\n페르소나: ${slot.persona || ""}\n의도: ${slot.intent || ""}\n수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}\n\n검증된 자료:\n${facts || "없음"}\n\n요구사항:\n- 첫 줄은 '# ' H1 제목\n- 실제 독자가 바로 도움받는 구체적인 문장\n- 근거 자료가 있으면 번호 출처 [1] 형태로 본문에 표시\n- 제공된 학원명/주소/전화/SEO 설명/사진만 사실 자료로 사용하고 없는 사실은 추측하지 말 것\n- 전화번호는 대표전화(vphone)가 있으면 vphone을 우선 사용하고, 없을 때만 일반 전화(phone)를 사용할 것\n- 이미지가 제공된 학원은 본문 흐름에 맞춰 [IMAGE:academy_1] 같은 이미지 슬롯을 1~3개 자연스럽게 배치할 것\n- SEO 키워드는 참고용으로만 사용하고 본문에 키워드를 부자연스럽게 나열하지 말 것\n- 과장/허위 금지\n- 1,200자 이상\n- 마지막에 상담/문의 전환 CTA 포함`;
}
function extractTitle(md: string, fallback: string) { return md.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("# "))?.slice(2).trim() || fallback; }
function slugify(text: string) { return (text || "post").trim().replace(/[^\w가-힣\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post"; }
function stripPreamble(md: string) { const lines = md.split(/\r?\n/); const i = lines.findIndex((l) => l.trim().startsWith("# ")); return (i >= 0 ? lines.slice(i).join("\n") : md).trim(); }
function metaDescription(md: string) { for (const raw of md.split(/\r?\n/)) { const s = raw.trim(); if (s && !s.startsWith("#") && !s.startsWith(">") && !s.startsWith("|")) return s.replace(/[\*_`#]/g, "").slice(0, 155); } return ""; }
function publishHtml(slug: string, md: string) { const dir = resolve(process.cwd(), "output"); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, `${slug}.html`), `<article><pre>${escapeHtml(md)}</pre></article>`, "utf8"); }
function jaccard(a: string, b: string) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }
function tokens(s: string) { return s.toLowerCase().replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length > 1); }
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c)); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
