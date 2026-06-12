import { Inject, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
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
        const llmOpts = { provider: payload.provider || "claude", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) };
        const result = await runLlm(prompt, llmOpts);
        if (!result.ok || !result.summary.trim()) throw new Error(result.error || "empty summary");
        let markdown = normalizeGeneratedMarkdown(result.summary, images);
        let qualityIssues = articleQualityIssues(markdown, facts.text, images);
        let durationSec = result.duration_sec;
        let costUsd = result.cost_usd || 0;
        let inputTokens = result.input_tokens || 0;
        let outputTokens = result.output_tokens || 0;
        let sessionId = result.session_id;
        let model = result.model;
        const maxRepairAttempts = clampInt(payload.max_repair_attempts, 2, 0, 3);
        for (let repairAttempt = 0; qualityIssues.length && repairAttempt < maxRepairAttempts; repairAttempt++) {
          const repair = await runLlm(buildRepairPrompt(tenantMeta, slot, facts.text, designTemplateId, markdown, qualityIssues), llmOpts);
          durationSec += repair.duration_sec;
          costUsd += repair.cost_usd || 0;
          inputTokens += repair.input_tokens || 0;
          outputTokens += repair.output_tokens || 0;
          sessionId = repair.session_id || sessionId;
          model = repair.model || model;
          if (repair.ok && repair.summary.trim()) {
            markdown = normalizeGeneratedMarkdown(repair.summary, images);
            qualityIssues = articleQualityIssues(markdown, facts.text, images);
          }
        }
        if (qualityIssues.length) throw new Error(`generated article quality gate failed: ${qualityIssues.join(", ")}`);
        const title = extractTitle(markdown, slot.primary_keyword);
        markdown = rewriteH1Title(markdown, title);
        const finalIssues = postSurfaceQualityIssues({ title, body_markdown: markdown, images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId }, 2600, candidateCountFromFacts(facts.text));
        if (finalIssues.length) throw new Error(`generated article final surface gate failed: ${finalIssues.join(", ")}`);
        const slug = this.db.uniqueSlug(tenant, slugify(title), sid);
        this.db.insertPost({
          tenant, slot_id: sid, slug, title, body_markdown: markdown,
          meta_description: metaDescription(markdown), images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId,
          provider: result.provider, model, session_id: sessionId, cost_usd: costUsd,
          duration_sec: durationSec, input_tokens: inputTokens, output_tokens: outputTokens
        });
        this.db.updateSlotStatus(sid, "published");
        publishMarkdownArtifact(slug, markdown);
        ok++; per_slot.push({ slot_id: sid, ok: true, duration_sec: durationSec, chars: markdown.length, model, design_template_id: designTemplateId });
      } catch (error: any) {
        const message = error?.message || String(error);
        this.db.updateSlotStatus(sid, "failed", message);
        fail++; per_slot.push({ slot_id: sid, ok: false, error: message });
      }
      if (index < slotIds.length - 1) await sleep(Number(payload.cooldown_sec || 60) * 1000);
    }
    return { ok, fail, generation_gate_version: "surface-v2", per_slot };
  }

  private buildFacts(tenant: string, slot: Row): GenerationFacts {
    if (!slot.region) return { text: "", images: {} };
    const region = String(slot.region);
    const academies = this.pickAcademiesForRegion(tenant, region, 5);
    const images: Record<string, string> = {};
    const body = academies.map((a, i) => {
      const imageKey = firstImageKey(a, i + 1);
      if (imageKey.url) images[imageKey.key] = imageKey.url;
      const parts = [`[${i + 1}] ${a.name}`];
      for (const [label, key] of [["주소", "address"], ["수강료", "price"], ["셔틀", "shuttle"], ["영업시간", "hours"], ["합격률", "pass_rate"], ["전화", "phone"], ["대표전화", "vphone"], ["후기", "review"], ["SEO 설명", "seo_description"], ["SEO 키워드", "seo_keywords"], ["유형", "academy_type"], ["지역 중심 기준 거리", "distance_km"]] as const) if (a[key]) parts.push(`${label}: ${key === "distance_km" ? `약 ${a[key]}km` : a[key]}`);
      if (a.latitude && a.longitude) parts.push(`좌표: ${a.latitude}, ${a.longitude}`);
      if (imageKey.url) parts.push(`사진 슬롯: [IMAGE:${imageKey.key}]`);
      return parts.join(" / ");
    }).join("\n");
    const header = [
      `작성 주제 지역: ${region}`,
      `본문에 사용할 수 있는 후보: ${academies.length}곳`,
      `본문에 사용할 수 있는 사진 슬롯: ${Object.keys(images).length ? Object.keys(images).map((key) => `[IMAGE:${key}]`).join(", ") : "없음"}`,
      `후기 문구가 있는 후보: ${academies.filter((a) => a.review).length}곳`,
      `작성자 주의: 아래 필드 밖의 학원명·가격·합격률·셔틀·후기는 생성 금지`,
      `작성자 주의: 이 데이터는 내부 입력값이므로 본문 출처·참고자료로 노출 금지`,
    ].join("\n");
    return { text: [header, body].filter(Boolean).join("\n\n"), images };
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
    if (exact.length) return exact.slice(0, limit);
    const all = this.db.listAcademies(tenant, { limit: 5000 });
    const targetRegion = this.db.getSeoRegion(tenant, region);
    const targetLat = finiteNumber(targetRegion?.latitude);
    const targetLng = finiteNumber(targetRegion?.longitude);
    const directMatches = all.map((a) => {
      const addr = String(a.address || "");
      const rowRegion = String(a.region || "");
      let score = Number.POSITIVE_INFINITY;
      if (rowRegion === region) score = 0;
      else if (addr.includes(region)) score = 1;
      else if (sameAdministrativePrefix(rowRegion, region) || sameAdministrativePrefix(addr, region)) score = 3;
      return { academy: a, score, distanceKm: academyDistanceKm(a, targetLat, targetLng) };
    }).filter((r) => Number.isFinite(r.score));
    const distanceMatches = targetLat !== null && targetLng !== null
      ? all
        .map((academy) => ({ academy, score: 2, distanceKm: academyDistanceKm(academy, targetLat, targetLng) }))
        .filter((r) => r.distanceKm !== null)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
        .slice(0, Math.max(limit * 3, 10))
      : [];
    const seen = new Set<string>();
    return [...directMatches, ...distanceMatches]
      .sort((a, b) => a.score - b.score || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY) || String(a.academy.name).localeCompare(String(b.academy.name), "ko"))
      .filter((r) => {
        const key = String(r.academy.external_id || r.academy.id || r.academy.name);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map((r) => r.distanceKm === null ? r.academy : { ...r.academy, distance_km: Math.round((r.distanceKm ?? 0) * 10) / 10 });
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
    const minChars = Number(payload.min_body_chars ?? 2600);
    const dryRun = Boolean(payload.dry_run);
    const rows = this.db.all("SELECT id, slot_id, title, body_markdown, images, length(body_markdown) AS chars FROM posts WHERE tenant=? AND status='published'", [tenant]);
    const targets: Row[] = [];
    for (const r of rows) {
      const slot = r.slot_id ? this.db.getSlot(String(r.slot_id)) : null;
      const candidateCount = slot?.region ? this.pickAcademiesForRegion(tenant, String(slot.region), 5).length : 0;
      const issues = postSurfaceQualityIssues(r, minChars, candidateCount);
      if (issues.length) targets.push({ id: r.id, title: r.title, chars: r.chars, issues });
    }
    if (!dryRun) for (const r of targets) this.db.updatePostStatus(r.id, "noindex");
    return { min_body_chars: minChars, quality_gate: true, dry_run: dryRun, candidates: targets, changed: dryRun ? 0 : targets.length };
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

function academyDistanceKm(row: Row, targetLat: number | null, targetLng: number | null): number | null {
  const lat = finiteNumber(row.latitude);
  const lng = finiteNumber(row.longitude);
  if (targetLat === null || targetLng === null || lat === null || lng === null) return null;
  return haversineKm(targetLat, targetLng, lat, lng);
}

function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radiusKm = 6371;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(degreesToRadians(lat1)) * Math.cos(degreesToRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return radiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

function sameAdministrativePrefix(left: string, right: string): boolean {
  const l = administrativeTokens(left);
  const r = administrativeTokens(right);
  if (!l.length || !r.length || l[0] !== r[0]) return false;
  return Boolean((l[1] && r[1] && l[1] === r[1]) || (l[2] && r[2] && l[2] === r[2]));
}

function administrativeTokens(value: string): string[] {
  return String(value || "").split(/\s+/).filter((token) => /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/u.test(token));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? Math.trunc(n) : fallback));
}

function normalizeGeneratedMarkdown(summary: string, images: Record<string, string>): string {
  return ensureImageSlots(
    stripMarkdownEmphasis(
      stripPseudoSlots(
        stripPreamble(summary)
          .replace(/^```(?:markdown|md)?\s*/i, "")
          .replace(/```\s*$/i, "")
          .replace(/\[(\d+)\]/g, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
      )
    ),
    images
  );
}

function stripMarkdownEmphasis(md: string): string {
  return normalizeKoreanSpacing(md)
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/__([^_\n]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\n]+)\*($|[\s).,!?])/g, "$1$2$3")
    .replace(/(^|[\s(])_([^_\n]+)_($|[\s).,!?])/g, "$1$2$3");
}

function normalizeKoreanSpacing(text: string): string {
  return text
    .replace(/([가-힣]+(?:시|군|구|읍|면|동))(운전면허학원)/g, "$1 $2")
    .replace(/상담전확인/g, "상담 전 확인")
    .replace(/동선확인/g, "동선 확인")
    .replace(/비용절약/g, "비용 절약")
    .replace(/셔틀편리/g, "셔틀 편리")
    .replace(/비교추천/g, "비교 추천");
}

function articleQualityIssues(markdown: string, facts: string, images: Record<string, string>): string[] {
  const issues: string[] = [];
  const chars = markdown.trim().length;
  const candidateCount = candidateCountFromFacts(facts);
  const h2Count = (markdown.match(/^##\s+/gm) || []).length;
  const imageKeys = Object.keys(images);
  const usedImageKeys = Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!);
  if (!markdown.trim().startsWith("# ")) issues.push("missing_h1_title");
  if (chars < 2600) issues.push(`too_short_${chars}`);
  if (chars > 5000) issues.push(`too_long_${chars}`);
  if (h2Count < 6) issues.push(`not_enough_h2_${h2Count}`);
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (!/(FAQ|자주 묻는 질문|질문과 답변)/i.test(markdown)) issues.push("missing_faq_section");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\*\*[^*]+\*\*/.test(markdown)) issues.push("contains_raw_bold_markers");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (/(검증된 자료|API 자료|제공된 자료|후기 필드|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|참고자료|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(markdown)) issues.push("exposes_internal_fact_language");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

function postSurfaceQualityIssues(post: Row, minChars = 2600, candidateCount = 0): string[] {
  const markdown = String(post.body_markdown || "");
  const title = String(post.title || "");
  const issues: string[] = [];
  const chars = markdown.trim().length;
  const h2Count = (markdown.match(/^##\s+/gm) || []).length;
  const images = safeJson(post.images, {});
  const imageKeys = images && typeof images === "object" && !Array.isArray(images) ? Object.keys(images) : [];
  const usedImageKeys = Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!);
  if (!markdown.trim().startsWith("# ")) issues.push("missing_h1_title");
  if (chars < minChars) issues.push(`too_short_${chars}`);
  if (chars > 5000) issues.push(`too_long_${chars}`);
  if (h2Count < 6) issues.push(`not_enough_h2_${h2Count}`);
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (!/(FAQ|자주 묻는 질문|질문과 답변)/i.test(markdown)) issues.push("missing_faq_section");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE)_SLOT:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\*\*[^*]+\*\*/.test(markdown)) issues.push("contains_raw_bold_markers");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (/(운전선생|검증된 자료|API 자료|제공된 자료|후기 필드|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|참고자료|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(`${title}\n${markdown}`)) issues.push("exposes_internal_fact_language");
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(title)) issues.push("keyword_spacing_issue");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

function candidateCountFromFacts(facts: string): number {
  const direct = facts.match(/(?:직접 매칭 후보 수|본문에 사용할 수 있는 후보):\s*(\d+)/);
  if (direct) return Number(direct[1]);
  return (facts.match(/^\[\d+\]/gm) || []).length;
}

function thinSectionCount(markdown: string): number {
  const sections = markdown.split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    const heading = String(lines.shift() || "");
    if (/FAQ|자주 묻는 질문|체크리스트|요약|상담|예약/i.test(heading)) continue;
    const text = lines.join("\n")
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, "")
      .replace(/\|[^\n]+\|/g, "")
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0 && text.length < 140) count++;
  }
  return count;
}

function isAnyMarkdownTable(markdown: string): boolean {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  return lines.some((line, index) => line.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(lines[index + 1] || "") && (lines[index + 2] || "").includes("|"));
}

function buildRepairPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string, markdown: string, issues: string[]): string {
  const brand = publicBrandName(tenant);
  return `아래 Markdown 글은 품질 게이트를 통과하지 못했다. 검증된 자료만 사용해서 같은 주제의 완성형 글로 다시 작성하라.

테넌트: ${brand}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
템플릿 필수 구조:
${designStructureGuide(designTemplateId)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}

실패 사유:
${issues.map((issue) => `- ${issue}`).join("\n")}

검증된 자료:
${facts || "없음"}

재작성 규칙:
- 제목/지역/후보 학원/이미지는 검증된 자료와 반드시 일치시킨다.
- 후보 수보다 큰 숫자, 다른 지역 후보, 없는 가격·합격률·셔틀·후기·3일 합격 주장을 만들지 않는다.
- 주소가 주제 지역과 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근 후보"로만 구분해 설명한다.
- 첫 줄은 '# ' 제목, H2 6개 이상, 3,000~5,000자 이내.
- 후보 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 비교표 대신 주소/연락처/과정/상담 확인점을 담은 요약표로 작성한다.
- 체크리스트와 FAQ 3~5개를 포함한다.
- 사용 가능한 이미지 슬롯이 있으면 실제 키만 [IMAGE:academy_1] 형식으로 본문 흐름에 배치한다.
- [1], [2] 같은 출처번호와 내부 표현(검증된 자료, API 자료, 후보 수, 참고자료, 내부 API URL 등)은 노출하지 않는다.
- 출처/참고자료는 도로교통공단처럼 실제 외부 공신력 자료를 별도로 인용했을 때만 작성한다. 이번 입력의 학원 API는 출처가 아니라 내부 데이터다.
- 원문보다 더 자연스럽고 풍성한 ${brand} 블로그 톤으로 작성한다.
- 출력은 수정된 Markdown 본문만 제공한다.

기존 Markdown:
${markdown}`;
}

function buildPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string): string {
  const brand = publicBrandName(tenant);
  return `너는 ${brand} 블로그를 쓰는 한국어 SEO 에디터다. 아래 슬롯과 검증된 자료만 사용해, 실제 서비스 상세 페이지와 HTML 다운로드에서 바로 읽히는 완성형 Markdown 글을 작성하라.

테넌트: ${brand}
업종: ${tenant.vertical || "general"}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
템플릿 필수 구조:
${designStructureGuide(designTemplateId)}
템플릿: ${slot.template_id}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
브랜드/작성 메모: ${tenant.content_brief || "없음"}

검증된 자료:
${facts || "없음"}

절대 원칙:
- API 자료는 글 재료일 뿐이다. 주 키워드/지역/제목과 직접 맞는 학원만 본문 후보·표·사진·CTA에 사용한다.
- 주소가 주제 지역과 일치하는 후보를 먼저 소개한다. 주소가 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근/주변 후보"로 분리해 설명한다.
- 다른 시·군·구 후보를 주제 지역 내부 학원처럼 쓰지 말 것. 후보가 부족하면 부족한 그대로 설명한다.
- 검증된 자료에 없는 학원명·사진·주소·전화번호·가격·셔틀·합격률·3일 합격·지역화폐·후기는 절대 생성하지 말 것.
- 제공된 후보 수보다 큰 숫자를 제목/본문에 쓰지 말 것. 예: 후보가 2곳이면 '3곳', 'BEST5' 금지.
- 출처번호 [1], [2]를 본문에 노출하지 말 것. 근거는 문장 안에 자연스럽게 녹인다.
- 내부 API URL이나 get-all-academy 주소는 내부 데이터 경로이므로 참고자료/출처 섹션에 절대 쓰지 말 것.
- 출처/참고자료 섹션은 도로교통공단 등 외부 공신력 자료를 실제로 인용했을 때만 만든다. 그렇지 않으면 출처 섹션 자체를 만들지 않는다.
- Markdown 굵게 표시(**학원명**, **Q1** 등)는 원문 품질을 떨어뜨리므로 쓰지 않는다. 강조가 필요하면 일반 문장으로 자연스럽게 작성한다.

레퍼런스 품질 기준:
- 딱딱한 데이터 나열이 아니라 ${brand} 블로그처럼 자연스럽게 시작한다. 예: "바쁜 일정 때문에 면허 준비를 미루고 있다면..."처럼 독자 상황을 먼저 짚는다.
- 각 H2 섹션은 제목만 던지지 말고 2~4문장 이상의 이어지는 단락으로 구성한다. FAQ/체크리스트를 제외한 섹션은 최소 140자 이상의 설명을 넣어 한 문장짜리 카드가 여러 개 끊기는 느낌을 피한다.
- 후보 설명은 단순 주소 나열이 아니라 "어떤 생활권/상황의 사람에게 맞는지", "상담 때 무엇을 확인해야 하는지"까지 연결한다.
- 표, 체크리스트, FAQ, 이미지가 글 흐름 안에 자연스럽게 들어가야 한다. 표 앞뒤에는 표를 왜 봐야 하는지 해석 문장을 붙인다.
- 자료에 리뷰가 있으면 짧은 인용문 1개를 쓸 수 있다. 리뷰가 없으면 실제 후기처럼 꾸며 쓰지 말고 상담 확인 팁으로 대체한다.

필수 출력 구조:
- 첫 줄은 '# ' H1 제목. 제목은 주 키워드/지역/직접 매칭 후보 수와 모순되면 안 된다.
- H2 섹션을 6개 이상 사용한다.
- 권장 흐름은 템플릿 필수 구조를 우선 따른다. 공통적으로 도입 → 기준 → 후보 → 비교/요약 → 체크리스트 → FAQ → 상담/예약 CTA가 자연스럽게 이어져야 한다.
- 제공된 학원 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 주소/연락처/과정/추천 대상/상담 확인점을 담은 요약표로 작성한다.
- 표는 정상 Markdown 표로 작성한다. 예: | 비교 항목 | 후보 A | 후보 B | 형태.
- 후보별 설명에는 가능한 경우 학원명, 주소, 대표전화(vphone 우선), 운영 과정/유형, 추천 대상, 상담 시 확인할 점을 포함한다.
- 이미지가 제공된 학원이 하나라도 있으면 해당 학원 설명 직후 [IMAGE:academy_1] 같은 실제 이미지 슬롯을 최소 1개, 최대 3개 배치한다. 이미지가 없으면 임의 이미지/플레이스홀더를 만들지 않는다.
- 허용된 이미지 슬롯은 검증된 자료의 "사용 가능한 이미지 슬롯"에 있는 키만 사용한다.
- [IMAGE_SLOT: ...], [TABLE_SLOT: ...], [CTA_SLOT: ...], [QUOTE_SLOT: ...] 같은 임의 플레이스홀더는 절대 쓰지 말 것.
- 체크리스트 섹션은 ✅ 불릿 목록으로 작성한다.
- FAQ는 질문/답변 3~5개로 작성한다.
- 마지막 H2 섹션은 ${brand}에서 비교·상담·예약으로 이어지는 자연스러운 CTA로 마무리한다.

문체/분량:
- 3,000자 이상, 5,000자 이내. 5,000자를 절대 넘기지 말 것.
- 독자가 바로 도움받을 수 있게 구체적으로 쓰되, 확인되지 않은 장점은 "상담 때 확인"으로 표현한다.
- SEO 키워드는 참고용으로만 사용하고 부자연스럽게 반복하지 말 것.
- 주 키워드와 맞지 않는 내용으로 글 방향을 틀지 말 것.
- 출력은 Markdown 본문만 제공하고 설명/주석은 쓰지 말 것.
- 마지막에 참고자료/출처 목록을 붙이지 말 것. 단, 도로교통공단 등 외부 공신력 자료를 실제로 인용한 경우에만 간단히 남긴다.`;
}
function designWritingGuide(designTemplateId: string): string {
  const guides: Record<string, string> = {
    editorial: "브랜드 매거진형. 메인 배너는 제목 중심으로 두고, 본문에는 실제 이미지, 요약/비교표 1개, FAQ, 자연스러운 CTA가 이어지도록 작성한다.",
    comparison: "BEST 비교형. 비교표를 앞쪽에 배치하고 후보별 장단점, 추천 대상, 선택 기준을 명확히 작성한다.",
    "local-guide": "지역 추천형. 지역명, 생활권, 셔틀/동선, 가까운 후보 요약/비교표를 중심으로 로컬 큐레이터처럼 작성한다.",
    checklist: "체크리스트형. 준비 순서, 상담 전 확인 항목, 실수 방지 체크와 요약표를 짧은 블록으로 나눠 작성한다.",
    conversion: "예약 전환형. 문제 공감, 해결 기준, 비용/상담 질문 비교표, 예약 CTA가 분명하게 이어지도록 작성한다.",
    custom: "사용자 지정형. 저장된 기획 메모와 템플릿 구조를 우선 따르되, 섹션을 명확히 나눠 작성한다.",
  };
  return guides[designTemplateId] || guides.editorial!;
}
function designStructureGuide(designTemplateId: string): string {
  const guides: Record<string, string[]> = {
    editorial: [
      "1) 상황 공감형 도입: 독자가 왜 지금 이 정보를 찾는지 2~3문장으로 시작",
      "2) 핵심 기준 카드: 비용·동선·과정·상담 질문을 묶어 설명",
      "3) 후보 소개: 각 후보를 생활권/추천 대상/상담 확인점으로 풀어쓰기",
      "4) 요약/비교표: 후보 수와 관계없이 핵심 차이 또는 핵심 정보를 표로 정리",
      "5) FAQ와 자연스러운 상담 CTA로 마무리",
    ],
    comparison: [
      "1) 첫 H2 또는 두 번째 H2 안에 '한눈에 비교표'를 배치",
      "2) 후보별 장단점과 추천 대상을 분리",
      "3) 선택 기준은 가격 단정이 아니라 상담 확인 질문으로 표현",
      "4) 마지막에 '이런 사람에게 이 후보' 식의 결론을 제공",
    ],
    "local-guide": [
      "1) 지역 생활권/출발지/동선 고민을 먼저 설명",
      "2) 같은 구·동 생활권의 직접 매칭 후보만 소개",
      "3) 셔틀·대중교통·자주 가는 생활권 기준의 선택 팁 포함",
      "4) 상담 전 체크리스트는 '내 출발지 기준' 질문으로 구성",
    ],
    checklist: [
      "1) 초반에 상담 전 체크리스트를 배치",
      "2) 절차/준비물/비용 확인/시험 방식 순서로 짧고 명확하게 정리",
      "3) 각 체크 항목 뒤에 왜 필요한지 1문장 설명",
      "4) FAQ는 실수 방지 질문 중심으로 구성",
    ],
    conversion: [
      "1) 문제 공감 → 해결 기준 → 후보/상담 → CTA 순서 유지",
      "2) 상담 버튼으로 이어질 만한 문장과 질문을 명확히 작성",
      "3) 비용·일정·면허 종류를 상담에서 확인하도록 유도",
      "4) 마지막 CTA는 과장 없이 지금 할 행동을 제시",
    ],
    custom: [
      "1) 브랜드/작성 메모가 있으면 해당 의도를 최우선 반영",
      "2) 상단 구성, 표/이미지 위치, CTA 위치를 메모와 맞춘다",
      "3) 메모가 없으면 editorial 구조를 따른다",
    ],
  };
  return (guides[designTemplateId] || guides.editorial!).map((line) => `- ${line}`).join("\n");
}
function publicBrandName(tenant: Row): string {
  return String(tenant.display_name || tenant.domain || "서비스").replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || "서비스";
}
function extractTitle(md: string, fallback: string) {
  return cleanGeneratedTitle(md.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("# "))?.slice(2).trim() || fallback);
}
function rewriteH1Title(md: string, title: string): string {
  const h1 = `# ${cleanGeneratedTitle(title)}`;
  return /^#\s+.+$/m.test(md) ? md.replace(/^#\s+.+$/m, h1) : `${h1}\n\n${md.trim()}`;
}
function cleanGeneratedTitle(title: string): string {
  return normalizeKoreanSpacing(stripMarkdownEmphasis(title))
    .replace(/\s{2,}/g, " ")
    .trim();
}
function slugify(text: string) { return (text || "post").trim().replace(/[^\w가-힣\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "post"; }
function stripPreamble(md: string) { const lines = md.split(/\r?\n/); const i = lines.findIndex((l) => l.trim().startsWith("# ")); return (i >= 0 ? lines.slice(i).join("\n") : md).trim(); }
function stripPseudoSlots(md: string) {
  return md
    .split(/\r?\n/)
    .filter((line) => !/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]$/i.test(line.trim()))
    .join("\n")
    .replace(/\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE)_SLOT:[^\]]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function ensureImageSlots(md: string, images: Record<string, string>) {
  const keys = Object.keys(images).sort((a, b) => a.localeCompare(b));
  if (!keys.length || /\[IMAGE:[A-Za-z0-9_-]+\]/.test(md)) return md;
  const insertions = keys.slice(0, Math.min(3, keys.length)).map((key) => `[IMAGE:${key}]`);
  const blocks = md.split(/\n{2,}/);
  if (blocks.length <= 2) return `${md}\n\n${insertions.join("\n\n")}`.trim();
  blocks.splice(Math.min(3, blocks.length), 0, insertions[0]!);
  if (insertions[1]) blocks.splice(Math.max(5, Math.floor(blocks.length * 0.55)), 0, insertions[1]);
  if (insertions[2]) blocks.splice(Math.max(7, Math.floor(blocks.length * 0.75)), 0, insertions[2]);
  return blocks.join("\n\n").trim();
}
function metaDescription(md: string) { for (const raw of md.split(/\r?\n/)) { const s = raw.trim(); if (s && !s.startsWith("#") && !s.startsWith(">") && !s.startsWith("|") && !/^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(s)) return s.replace(/[\*_`#]/g, "").slice(0, 155); } return ""; }
function publishMarkdownArtifact(slug: string, md: string) { const dir = resolve(process.cwd(), "output"); mkdirSync(dir, { recursive: true }); const staleHtml = resolve(dir, `${slug}.html`); if (existsSync(staleHtml)) unlinkSync(staleHtml); writeFileSync(resolve(dir, `${slug}.md`), md, "utf8"); }
function jaccard(a: string, b: string) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }
function tokens(s: string) { return s.toLowerCase().replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length > 1); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
