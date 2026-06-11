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
        const images = { ...this.imagesForSlot(tenant, slot), ...facts.images };
        const prompt = buildPrompt(tenantMeta, slot, facts.text, designTemplateId);
        const result = await runLlm(prompt, { provider: payload.provider || "claude", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) });
        if (!result.ok || !result.summary.trim()) throw new Error(result.error || "empty summary");
        const markdown = ensureImageSlots(stripPseudoSlots(stripPreamble(result.summary)), images);
        const title = extractTitle(markdown, slot.primary_keyword);
        const slug = this.db.uniqueSlug(tenant, slugify(title), sid);
        this.db.insertPost({
          tenant, slot_id: sid, slug, title, body_markdown: markdown,
          meta_description: metaDescription(markdown), images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId,
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

  private imagesForSlot(tenant: string, slot: Row): Record<string, string> {
    if (!slot.region) return {};
    const images: Record<string, string> = {};
    for (const [i, academy] of this.pickAcademiesForRegion(tenant, String(slot.region), 5).entries()) {
      const imageKey = firstImageKey(academy, i + 1);
      if (imageKey.url) images[imageKey.key] = imageKey.url;
    }
    return images;
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
  return `너는 한국어 SEO 콘텐츠 에디터다. 아래 슬롯에 맞춰 바로 발행 가능한 Markdown 글을 작성하라.

테넌트: ${tenant.display_name || tenant.domain}
업종: ${tenant.vertical || "general"}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
템플릿: ${slot.template_id}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}

검증된 자료:
${facts || "없음"}

필수 출력 구조:
- 첫 줄은 '# ' H1 제목
- 본문에는 '## ' H2 섹션을 최소 6개 이상 사용
- 도입 → 지역/상황 고민 → 선택 기준 → 학원 후보별 설명 → 비교표 → 체크리스트 → FAQ → 마무리 CTA 순서로 구성
- 각 H2 섹션은 제목만 던지지 말고, 2~3개의 자연스러운 문단 또는 목록/표/인용을 함께 배치
- 문단을 한 줄씩 끊지 말고 같은 주제의 설명은 이어지는 단락으로 구성
- 레퍼런스형 블로그처럼 섹션 안에서 설명이 자연스럽게 이어져야 하며, 문단마다 독립 카드처럼 짧게 끊지 말 것
- 제공된 학원이 3곳 이상이면 최소 3곳을 각각 별도 문단으로 자세히 설명
- 각 학원 문단에는 가능한 경우 학원명, 주소, 대표전화(vphone 우선), 운영 과정/유형, 어떤 사람에게 맞는지를 포함
- 이미지가 제공된 학원은 해당 학원 설명 직후 [IMAGE:academy_1] 같은 이미지 슬롯을 1~3개 자연스럽게 배치
- 허용된 이미지 슬롯은 [IMAGE:academy_1]처럼 검증된 자료에 실제로 있는 키만 사용
- [IMAGE_SLOT: ...], [TABLE_SLOT: ...], [CTA_SLOT: ...] 같은 임의 플레이스홀더는 절대 쓰지 말 것
- 글 중간에 Markdown 표 1개를 반드시 포함. 표는 학원 후보 비교 또는 선택 기준 비교로 작성
- 표 형식은 반드시 | 항목 | 후보 A | 후보 B | 후보 C | 형태의 정상 Markdown 표로 작성
- 표는 4~5개 행으로 후보별 위치/과정/추천 대상/확인할 점을 비교
- 체크리스트 섹션은 불릿 목록으로 작성하고, FAQ 섹션은 질문/답변 3~5개로 작성
- 실제 후기나 상담 상황을 설명하는 짧은 인용문을 1개 포함. 단, 제공 자료에 없는 후기를 실제 후기처럼 단정하지 말 것

품질 요구사항:
- 2,400자 이상, 5,000자 이내로 작성
- 실제 독자가 바로 도움받는 구체적인 문장
- 근거 자료가 있으면 번호 출처 [1] 형태로 본문에 표시
- 제공된 학원명/주소/전화/SEO 설명/사진만 사실 자료로 사용하고 없는 사실은 추측하지 말 것
- 전화번호는 대표전화(vphone)가 있으면 vphone을 우선 사용하고, 없을 때만 일반 전화(phone)를 사용할 것
- SEO 키워드는 참고용으로만 사용하고 본문에 키워드를 부자연스럽게 나열하지 말 것
- 과장/허위 금지
- 마지막 H2 섹션은 상담/문의 전환 CTA로 마무리
- 5,000자를 넘기지 말고, 표/목록/FAQ를 포함해도 전체 분량 제한을 지킬 것`;
}
function designWritingGuide(designTemplateId: string): string {
  const guides: Record<string, string> = {
    editorial: "브랜드 매거진형. 큰 대표 이미지 아래에서 차분한 설명, 비교표 1개, FAQ, 자연스러운 CTA가 이어지도록 작성한다.",
    comparison: "BEST 비교형. 비교표를 앞쪽에 배치하고 후보별 장단점, 추천 대상, 선택 기준을 명확히 작성한다.",
    "local-guide": "지역 추천형. 지역명, 생활권, 셔틀/동선, 가까운 후보 비교표를 중심으로 로컬 큐레이터처럼 작성한다.",
    checklist: "체크리스트형. 준비 순서, 상담 전 확인 항목, 실수 방지 체크와 요약표를 짧은 블록으로 나눠 작성한다.",
    conversion: "예약 전환형. 문제 공감, 해결 기준, 비용/상담 질문 비교표, 예약 CTA가 분명하게 이어지도록 작성한다.",
    custom: "사용자 지정형. 저장된 기획 메모와 템플릿 구조를 우선 따르되, 섹션을 명확히 나눠 작성한다.",
  };
  return guides[designTemplateId] || guides.editorial!;
}
function extractTitle(md: string, fallback: string) { return md.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("# "))?.slice(2).trim() || fallback; }
function slugify(text: string) { return (text || "post").trim().replace(/[^\w가-힣\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post"; }
function stripPreamble(md: string) { const lines = md.split(/\r?\n/); const i = lines.findIndex((l) => l.trim().startsWith("# ")); return (i >= 0 ? lines.slice(i).join("\n") : md).trim(); }
function stripPseudoSlots(md: string) { return md.split(/\r?\n/).filter((line) => !/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(line.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim(); }
function ensureImageSlots(md: string, images: Record<string, string>) {
  const keys = Object.keys(images).sort((a, b) => a.localeCompare(b));
  if (!keys.length || /\[IMAGE:[A-Za-z0-9_-]+\]/.test(md)) return md;
  const insertions = (keys.length > 2 ? keys.slice(2, 4) : []).map((key) => `[IMAGE:${key}]`);
  if (!insertions.length) return md;
  const blocks = md.split(/\n{2,}/);
  if (blocks.length <= 2) return `${md}\n\n${insertions.join("\n\n")}`.trim();
  blocks.splice(Math.min(2, blocks.length), 0, insertions[0]!);
  if (insertions[1]) blocks.splice(Math.max(4, Math.floor(blocks.length * 0.6)), 0, insertions[1]);
  return blocks.join("\n\n").trim();
}
function metaDescription(md: string) { for (const raw of md.split(/\r?\n/)) { const s = raw.trim(); if (s && !s.startsWith("#") && !s.startsWith(">") && !s.startsWith("|")) return s.replace(/[\*_`#]/g, "").slice(0, 155); } return ""; }
function publishHtml(slug: string, md: string) { const dir = resolve(process.cwd(), "output"); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, `${slug}.html`), `<article><pre>${escapeHtml(md)}</pre></article>`, "utf8"); }
function jaccard(a: string, b: string) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }
function tokens(s: string) { return s.toLowerCase().replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length > 1); }
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || c)); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
