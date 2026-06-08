import { EventEmitter } from "events";
import type { Provider, JobProgressEvent, GeneratePayload, DedupPayload, DedupResult, PrunePayload, PruneResult, IndexingPayload, IndexingResult, JobLogEntry } from "@shared/types";
import * as db from "./db";
import { renderPrompt, type SlotForPrompt } from "./prompts";
import { runLlm } from "./llm";
import { qualitySummary, retryPrompt, validatePost, type QualityReport } from "./quality";
import { collectWebFacts, findUnsupportedAcademyNames } from "./web_research";
import { findDuplicateClusters, normalize } from "./dedup";
import { parseRateSignal, nextBackoffSec } from "./rate_limit";
import { isConfigured, parseServiceAccount, getAccessToken, submitUrl, buildPostUrl } from "./indexing";

const POLL_INTERVAL_MS = 3000;

type GenerateResult = {
  ok: number;
  fail: number;
  cancelled?: boolean;
  per_slot: Array<{ slot_id: string; ok: boolean; error?: string; duration_sec?: number; chars?: number; model?: string }>;
  logs: JobLogEntry[];
};

export class Worker extends EventEmitter {
  private stopped = false;
  private loop: Promise<void> | null = null;

  start(): void {
    if (this.loop) return;
    this.stopped = false;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loop;
    this.loop = null;
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let job;
      try { job = db.claimNextJob(); } catch (err) {
        console.error("[worker] claim failed", err);
        await sleep(5000);
        continue;
      }
      if (!job) { await sleep(POLL_INTERVAL_MS); continue; }

      try {
        if (job.kind === "generate") {
          const result = await this.processGenerate(job.id, job.tenant, job.payload_obj as unknown as GeneratePayload);
          if (result.cancelled) {
            db.completeJob(job.id, { ok: false, result, error: "cancelled by user" });
            this.emitProgress({
              job_id: job.id, tenant: job.tenant, phase: "failed",
              message: "cancelled by user",
              done: result.ok + result.fail, total: result.ok + result.fail,
              ok: result.ok, fail: result.fail, error: "cancelled by user",
            });
          } else if (result.ok === 0 && result.fail > 0) {
            db.completeJob(job.id, { ok: false, result, error: "all slots failed" });
            this.emitProgress({
              job_id: job.id, tenant: job.tenant, phase: "failed",
              message: "all slots failed",
              done: result.fail, total: result.fail,
              ok: result.ok, fail: result.fail, error: "all slots failed",
            });
          } else {
            db.completeJob(job.id, { ok: true, result });
            this.emitProgress({
              job_id: job.id, tenant: job.tenant, phase: "complete",
              done: result.ok + result.fail, total: result.ok + result.fail,
              ok: result.ok, fail: result.fail,
            });
          }
        } else if (job.kind === "dedup") {
          const result = await this.processDedup(job.id, job.tenant, job.payload_obj as unknown as DedupPayload);
          db.completeJob(job.id, { ok: true, result: result as unknown as Record<string, unknown> });
          this.emitProgress({
            job_id: job.id, tenant: job.tenant, phase: "complete",
            done: result.clusters, total: result.clusters,
            ok: result.marked_noindex, fail: 0,
            message: result.dry_run
              ? `중복 ${result.duplicates_found}건 발견(미리보기, 표시 안 함)`
              : `중복 ${result.duplicates_found}건 → noindex ${result.marked_noindex}건 처리`,
          });
        } else if (job.kind === "prune") {
          const result = await this.processPrune(job.id, job.tenant, job.payload_obj as unknown as PrunePayload);
          db.completeJob(job.id, { ok: true, result: result as unknown as Record<string, unknown> });
          this.emitProgress({
            job_id: job.id, tenant: job.tenant, phase: "complete",
            done: result.thin_noindexed + result.stale_deleted,
            total: result.thin_noindexed + result.stale_deleted,
            ok: result.thin_noindexed + result.stale_deleted, fail: 0,
            message: result.dry_run
              ? `미리보기: 약한글 ${result.thin_noindexed} / 수명종료 ${result.stale_deleted}`
              : `약한글 noindex ${result.thin_noindexed} / 오래된 글 삭제 ${result.stale_deleted}`,
          });
        } else if (job.kind === "indexing") {
          const result = await this.processIndexing(job.id, job.tenant, job.payload_obj as unknown as IndexingPayload);
          db.completeJob(job.id, { ok: true, result: result as unknown as Record<string, unknown> });
          this.emitProgress({
            job_id: job.id, tenant: job.tenant, phase: "complete",
            done: result.submitted + result.failed, total: result.total,
            ok: result.submitted, fail: result.failed,
            message: result.configured
              ? `색인 요청: 성공 ${result.submitted} / 실패 ${result.failed}${result.skipped_quota ? ` / 쿼터초과 ${result.skipped_quota}` : ""}`
              : (result.message ?? "서비스계정 키 미설정"),
          });
        } else {
          db.completeJob(job.id, { ok: false, error: `unsupported kind: ${job.kind}` });
        }
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        db.completeJob(job.id, { ok: false, error: msg });
        this.emitProgress({
          job_id: job.id, tenant: job.tenant, phase: "failed",
          done: 0, total: 0, ok: 0, fail: 0, error: msg,
        });
      }
    }
  }

  private async processGenerate(jobId: string, tenant: string, payload: GeneratePayload): Promise<GenerateResult> {
    const provider: Provider = payload.provider ?? "claude";
    const model = (payload.model ?? "").trim();
    const timeout_sec = payload.timeout_sec ?? 600;
    const cooldown_sec = payload.cooldown_sec ?? 60;
    const slot_ids = payload.slot_ids ?? [];
    const tenantMeta = db.getTenant(tenant);
    const designTemplateId = payload.design_template_id ?? tenantMeta?.design_template_id ?? "editorial";
    const brandName = tenantMeta?.display_name?.trim() || "운전면허플러스";
    const useWebResearch = payload.use_web_research !== false;

    let ok = 0;
    let fail = 0;
    let rlBackoffSec = 0; // 레이트리밋 압력에 따른 추가 대기(슬롯 간 적응 백오프)
    const logs: JobLogEntry[] = [];
    const per_slot: Array<{ slot_id: string; ok: boolean; error?: string; duration_sec?: number; chars?: number; model?: string }> = [];
    const addLog = (level: JobLogEntry["level"], message: string, slot_id?: string) => {
      logs.push({ at: new Date().toISOString(), level, message, slot_id });
    };
    const cancelledResult = (message: string): GenerateResult => {
      addLog("warning", message);
      return { ok, fail, cancelled: true, per_slot, logs };
    };

    addLog("info", `작업 시작: 후보 ${slot_ids.length}개, provider=${provider}${model ? `, model=${model}` : ""}, design=${designTemplateId}, web=${useWebResearch ? "on" : "off"}`);
    this.emitProgress({
      job_id: jobId, tenant, phase: "start", done: 0, total: slot_ids.length, ok: 0, fail: 0,
      message: `start ${slot_ids.length} slots`,
    });

    for (let i = 0; i < slot_ids.length; i++) {
      if (this.stopped) return cancelledResult("워커가 중지되어 작업을 멈췄습니다.");
      if (db.isJobCancelRequested(jobId)) return cancelledResult("사용자가 작업 중지를 요청했습니다.");
      const sid = slot_ids[i];
      const slot = db.getSlot(sid);
      if (!slot) {
        fail += 1;
        addLog("error", "글 후보를 찾을 수 없습니다.", sid);
        per_slot.push({ slot_id: sid, ok: false, error: "not found" });
        this.emitProgress({
          job_id: jobId, tenant, phase: "slot_fail", slot_id: sid,
          done: i + 1, total: slot_ids.length, ok, fail, error: "not found",
        });
        continue;
      }
      if (slot.tenant !== tenant) {
        fail += 1;
        addLog("error", "후보의 도메인이 현재 작업 도메인과 다릅니다.", sid);
        per_slot.push({ slot_id: sid, ok: false, error: "tenant mismatch" });
        continue;
      }

      let webFacts = "";
      let trustedWebFacts = "";
      if (useWebResearch) {
        try {
          addLog("info", "웹 자료 수집 중", sid);
          const research = await collectWebFacts(slot as SlotForPrompt);
          webFacts = research.factsText;
          trustedWebFacts = research.trustedFactsText;
          const trustedCount = research.sources.filter((source) => source.trusted).length;
          addLog("success", `웹 자료 ${research.sources.length}개 수집, 검증용 ${trustedCount}개: ${research.query}`, sid);
        } catch (err) {
          addLog("warning", `웹 자료 수집 실패: ${(err as Error).message}`, sid);
        }
      }

      const mergedBrief = [
        tenantMeta?.content_brief?.trim(),
        webFacts ? `웹검색 수집 자료 (각 항목의 [번호]를 본문 인용과 참고자료 섹션에 사용):\n${webFacts}` : "",
      ].filter(Boolean).join("\n\n");

      const prompt = renderPrompt({
        ...(slot as SlotForPrompt),
        design_template_id: designTemplateId,
        custom_design_templates: tenantMeta?.custom_design_templates ?? null,
        content_brief: mergedBrief,
        brand_name: brandName,
      });
      addLog("info", `글 작성 시작: ${slot.primary_keyword}`, sid);
      this.emitProgress({
        job_id: jobId, tenant, phase: "slot_start", slot_id: sid,
        done: i, total: slot_ids.length, ok, fail,
        message: `slot ${i + 1}/${slot_ids.length}`,
      });
      db.updateSlotStatus(sid, "in_progress");

      let result = await runLlm(prompt, { provider, model, timeout_sec });
      let report: QualityReport | null = null;
      const maxAttempts = Number(process.env.SEO_QUALITY_MAX_ATTEMPTS ?? "2");
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!result.ok || !result.summary.trim()) {
          if (attempt < maxAttempts) {
            result = await runLlm(prompt, { provider, model, timeout_sec });
            continue;
          }
          break;
        }

        report = validatePost(result.summary, brandName, { requireSources: Boolean(webFacts) });
        const factualSourceText = [tenantMeta?.content_brief ?? "", trustedWebFacts].filter(Boolean).join("\n\n");
        if (webFacts || tenantMeta?.content_brief) {
          const unsupported = findUnsupportedAcademyNames(result.summary, factualSourceText);
          if (unsupported.length > 0) {
            report = {
              ...report,
              ok: false,
              issues: [
                ...report.issues,
                `unsupported academy names not found in web sources: ${unsupported.join(", ")}`,
              ],
            };
          }
        }
        if (report.ok) {
          console.info(`[worker] quality OK slot=${sid} attempt=${attempt}/${maxAttempts}: ${qualitySummary(report)}`);
          break;
        }

        console.warn(`[worker] quality FAIL slot=${sid} attempt=${attempt}/${maxAttempts}: ${qualitySummary(report)}`);
        if (attempt < maxAttempts) {
          result = await runLlm(retryPrompt(prompt, report, brandName, { requireSources: Boolean(webFacts) }), { provider, model, timeout_sec });
        }
      }

      if (!result.ok || !result.summary.trim()) {
        const err = result.error || "empty summary";
        db.updateSlotStatus(sid, "failed", err);
        fail += 1;
        addLog("error", `글 작성 실패: ${err}`, sid);
        per_slot.push({ slot_id: sid, ok: false, error: err, duration_sec: result.duration_sec });
        this.emitProgress({
          job_id: jobId, tenant, phase: "slot_fail", slot_id: sid,
          done: i + 1, total: slot_ids.length, ok, fail, error: err,
          duration_sec: result.duration_sec,
        });
      } else if (report && !report.ok) {
        const err = `quality gate failed: ${qualitySummary(report)}`;
        db.updateSlotStatus(sid, "failed", err);
        fail += 1;
        addLog("error", `품질 검사 실패: ${qualitySummary(report)}`, sid);
        per_slot.push({ slot_id: sid, ok: false, error: err, duration_sec: result.duration_sec, chars: result.summary.length });
        this.emitProgress({
          job_id: jobId, tenant, phase: "slot_fail", slot_id: sid,
          done: i + 1, total: slot_ids.length, ok, fail, error: err,
          duration_sec: result.duration_sec,
        });
      } else {
        const title = extractTitle(result.summary, slot.primary_keyword);
        db.insertPost({
          tenant, slot_id: sid, slug: sid, title,
          body_markdown: result.summary,
          design_template_id: designTemplateId,
          provider: result.provider, model: result.model,
          session_id: result.session_id, cost_usd: result.cost_usd,
          duration_sec: result.duration_sec,
          input_tokens: result.input_tokens,
          output_tokens: result.output_tokens,
        });
        db.updateSlotStatus(sid, "published");
        ok += 1;
        per_slot.push({
          slot_id: sid, ok: true, duration_sec: result.duration_sec,
          chars: result.summary.length, model: result.model,
        });
        this.emitProgress({
          job_id: jobId, tenant, phase: "slot_done", slot_id: sid,
          done: i + 1, total: slot_ids.length, ok, fail,
          duration_sec: result.duration_sec,
          message: `${result.summary.length} chars`,
        });
        addLog("success", `완성: ${result.summary.length.toLocaleString()}자, ${result.duration_sec.toFixed(1)}초`, sid);
      }

      // 레이트리밋 신호로 적응 백오프 갱신
      const rlSignal = parseRateSignal(result.rate_limit);
      rlBackoffSec = nextBackoffSec(rlSignal, rlBackoffSec);
      if (rlBackoffSec > 0) {
        const pct = rlSignal.pressure !== null ? `${Math.round(rlSignal.pressure * 100)}%` : "?";
        addLog("warning", `레이트리밋 압력 감지(사용률 ${pct}${rlSignal.status ? `, ${rlSignal.status}` : ""}) → 추가 대기 ${rlBackoffSec}초`, sid);
      }

      const effectiveCooldown = cooldown_sec + rlBackoffSec;
      if (i < slot_ids.length - 1 && effectiveCooldown > 0 && !this.stopped) {
        const label = rlBackoffSec > 0 ? `${cooldown_sec}+${rlBackoffSec}초(레이트리밋)` : `${cooldown_sec}초`;
        addLog("info", `다음 글까지 ${label} 대기`, sid);
        this.emitProgress({
          job_id: jobId, tenant, phase: "cooldown", slot_id: sid,
          done: i + 1, total: slot_ids.length, ok, fail,
          message: `cooldown ${effectiveCooldown}s${rlBackoffSec > 0 ? " (rate-limit backoff)" : ""}`,
        });
        const completed = await sleepInterruptible(effectiveCooldown * 1000, () =>
          this.stopped || db.isJobCancelRequested(jobId),
        );
        if (!completed) return cancelledResult("대기 중 사용자 중지 요청을 받아 작업을 멈췄습니다.");
      }
    }

    addLog("success", `작업 완료: 성공 ${ok}개, 실패 ${fail}개`);
    return { ok, fail, per_slot, logs };
  }

  private async processDedup(jobId: string, tenant: string, payload: DedupPayload): Promise<DedupResult> {
    const threshold = payload.threshold ?? 0.75;
    const dryRun = payload.dry_run === true;

    const posts = db.listPostsForDedup(tenant);
    this.emitProgress({
      job_id: jobId, tenant, phase: "dedup_scan",
      done: 0, total: posts.length, ok: 0, fail: 0,
      message: `발행 글 ${posts.length}건 중복 검사 시작 (임계 ${threshold})`,
    });

    const clusters = findDuplicateClusters(
      posts.map((p) => ({
        id: p.id,
        body_markdown: p.body_markdown,
        priority_score: p.priority_score,
        generated_at: p.generated_at,
      })),
      { threshold },
    );

    const duplicateIds = clusters.flatMap((c) => c.duplicate_ids);
    let marked = 0;
    if (!dryRun) {
      for (const id of duplicateIds) {
        db.updatePostStatus(id, "noindex");
        marked += 1;
        if (marked % 10 === 0 || marked === duplicateIds.length) {
          this.emitProgress({
            job_id: jobId, tenant, phase: "dedup_mark",
            done: marked, total: duplicateIds.length, ok: marked, fail: 0,
            message: `중복 글 noindex 처리 ${marked}/${duplicateIds.length}`,
          });
        }
      }
    }

    return {
      total_posts: posts.length,
      clusters: clusters.length,
      duplicates_found: duplicateIds.length,
      marked_noindex: marked,
      dry_run: dryRun,
      details: clusters,
    };
  }

  private async processPrune(jobId: string, tenant: string, payload: PrunePayload): Promise<PruneResult> {
    const minChars = payload.min_body_chars ?? 700;
    const staleDays = payload.stale_noindex_days ?? 90;
    const dryRun = payload.dry_run === true;

    // published + noindex 글(본문·상태·생성일 포함)
    const posts = db.listPostsForDedup(tenant, true);
    this.emitProgress({
      job_id: jobId, tenant, phase: "prune_scan",
      done: 0, total: posts.length, ok: 0, fail: 0,
      message: `글 ${posts.length}건 가지치기 검사 (약한글<${minChars}자, 수명 ${staleDays}일)`,
    });

    const nowMs = Date.now();
    const ageDays = (ts: string): number => {
      // SQLite CURRENT_TIMESTAMP('YYYY-MM-DD HH:MM:SS', UTC) → 안전 파싱
      const ms = Date.parse(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
      if (Number.isNaN(ms)) return 0;
      return (nowMs - ms) / 86_400_000;
    };

    let thin = 0;
    let stale = 0;
    let processed = 0;
    for (const p of posts) {
      if (p.status === "published") {
        // 약한 글: 정규화 본문 길이가 기준 미만 → noindex
        if (normalize(p.body_markdown).length < minChars) {
          if (!dryRun) db.updatePostStatus(p.id, "noindex");
          thin += 1;
        }
      } else if (p.status === "noindex") {
        // 수명 종료: 오래된 noindex → deleted(410)
        if (ageDays(p.generated_at) >= staleDays) {
          if (!dryRun) db.updatePostStatus(p.id, "deleted");
          stale += 1;
        }
      }
      processed += 1;
      if (processed % 25 === 0 || processed === posts.length) {
        this.emitProgress({
          job_id: jobId, tenant, phase: "prune_mark",
          done: processed, total: posts.length, ok: thin + stale, fail: 0,
          message: `검사 ${processed}/${posts.length} — 약한글 ${thin}, 수명종료 ${stale}`,
        });
      }
    }

    return {
      total_posts: posts.length,
      thin_noindexed: thin,
      stale_deleted: stale,
      dry_run: dryRun,
    };
  }

  private async processIndexing(jobId: string, tenant: string, payload: IndexingPayload): Promise<IndexingResult> {
    const saJson = db.getSetting("google_sa_json");
    // 키 미설정 → 안전하게 비활성(작업은 정상 완료, 메시지로 안내)
    if (!isConfigured(saJson)) {
      const message = "Google 서비스계정 키가 미설정입니다. 설정 탭에서 키를 등록하세요.";
      this.emitProgress({
        job_id: jobId, tenant, phase: "index_submit",
        done: 0, total: 0, ok: 0, fail: 0, message,
      });
      return { configured: false, total: 0, submitted: 0, failed: 0, skipped_quota: 0, message };
    }

    const template = db.getSetting("indexing_url_template") || "https://{domain}/{slug}";
    const type = payload.type ?? "URL_UPDATED";
    const maxQuota = payload.max ?? 200;

    // 대상: 지정 글 또는 발행글 전체
    let posts = db.listPosts({ tenant, status: "published", limit: 100000 });
    if (payload.post_ids?.length) {
      const set = new Set(payload.post_ids);
      posts = posts.filter((p) => set.has(p.id));
    }
    const total = posts.length;
    const targets = posts.slice(0, maxQuota);
    const skipped_quota = total - targets.length;

    this.emitProgress({
      job_id: jobId, tenant, phase: "index_submit",
      done: 0, total: targets.length, ok: 0, fail: 0,
      message: `색인 요청 시작 — 대상 ${targets.length}건${skipped_quota ? ` (쿼터 ${maxQuota} 초과 ${skipped_quota}건 보류)` : ""}`,
    });

    let token: string;
    try {
      token = await getAccessToken(parseServiceAccount(saJson));
    } catch (err) {
      const message = `토큰 발급 실패: ${(err as Error).message}`;
      return { configured: true, total, submitted: 0, failed: targets.length, skipped_quota, message };
    }

    let submitted = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (this.stopped || db.isJobCancelRequested(jobId)) break;
      const url = buildPostUrl(template, tenant, targets[i].slug);
      const r = await submitUrl(token, url, type);
      if (r.ok) submitted += 1;
      else failed += 1;
      if ((i + 1) % 5 === 0 || i === targets.length - 1) {
        this.emitProgress({
          job_id: jobId, tenant, phase: "index_submit",
          done: i + 1, total: targets.length, ok: submitted, fail: failed,
          message: `제출 ${i + 1}/${targets.length}`,
        });
      }
      await sleep(120); // 과도한 호출 방지
    }

    return { configured: true, total, submitted, failed, skipped_quota };
  }

  private emitProgress(ev: JobProgressEvent): void {
    this.emit("progress", ev);
  }
}

function extractTitle(markdown: string, fallback: string): string {
  for (const line of markdown.split("\n")) {
    const s = line.trim();
    if (s.startsWith("# ")) return s.slice(2).trim() || fallback;
  }
  return fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function sleepInterruptible(ms: number, shouldStop: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (shouldStop()) return false;
    await sleep(Math.min(1000, end - Date.now()));
  }
  return !shouldStop();
}

let _worker: Worker | null = null;
export function getWorker(): Worker {
  if (!_worker) _worker = new Worker();
  return _worker;
}
