import { Inject, Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DbService, safeJson } from "./db.service.js";

type Row = Record<string, any>;

type LlmResult = { ok: boolean; summary: string; provider: string; model: string; duration_sec: number; cost_usd?: number; input_tokens?: number; output_tokens?: number; session_id?: string; error?: string };
type GenerationFacts = { text: string; images: Record<string, string> };
type ArticlePattern = { pattern_type?: string; pattern?: string; count?: number; example_title?: string; article_type?: string };
type ArticlePatternSummary = { average_structure_metrics?: Row; top_title_patterns?: ArticlePattern[]; top_heading_patterns?: ArticlePattern[] };

const PROJECT_DIR = resolve(new URL("../../..", import.meta.url).pathname);

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
    if (job.kind === "social_generate") return this.processSocialGenerate(job.tenant, payload);
    if (job.kind === "video_render") return this.processVideoRender(job.tenant, payload);
    if (job.kind === "site_deploy") return this.processSiteDeploy(job.tenant, payload);
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
        const drivingMode = isDrivingTenant(tenantMeta);
        const prompt = drivingMode ? buildPrompt(tenantMeta, slot, facts.text, designTemplateId) : buildGenericPrompt(tenantMeta, slot, facts.text, designTemplateId);
        const llmOpts = { provider: payload.provider || "codex", model: payload.model || "", timeoutSec: Number(payload.timeout_sec || 600) };
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
          const repairPrompt = drivingMode
            ? buildRepairPrompt(tenantMeta, slot, facts.text, designTemplateId, markdown, qualityIssues)
            : buildGenericRepairPrompt(tenantMeta, slot, facts.text, designTemplateId, markdown, qualityIssues);
          const repair = await runLlm(repairPrompt, llmOpts);
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
        const finalIssues = postSurfaceQualityIssues({ title, body_markdown: markdown, images: Object.keys(images).length ? JSON.stringify(images) : null, design_template_id: designTemplateId }, drivingMode ? 3500 : 2800, candidateCountFromFacts(facts.text));
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
    return { ok, fail, generation_gate_version: "platform-surface-v1", per_slot };
  }

  private buildFacts(tenant: string, slot: Row): GenerationFacts {
    const tenantMeta = this.db.getTenant(tenant) || {};
    if (!isDrivingTenant(tenantMeta)) return genericFactsForSlot(tenantMeta, slot);
    if (!slot.region) return { text: "", images: {} };
    const region = String(slot.region);
    const academies = this.pickAcademiesForRegion(tenant, region, 5);
    const images: Record<string, string> = {};
    const body = academies.map((a, i) => {
      const imageKeys = firstImageKeys(a, i + 1, 2);
      for (const imageKey of imageKeys) images[imageKey.key] = imageKey.url;
      const parts = [`[${i + 1}] ${a.name}`];
      for (const [label, key] of [["주소", "address"], ["수강료", "price"], ["셔틀", "shuttle"], ["영업시간", "hours"], ["합격률", "pass_rate"], ["전화", "phone"], ["대표전화", "vphone"], ["SEO 설명", "seo_description"], ["SEO 키워드", "seo_keywords"], ["지역 중심 기준 거리", "distance_km"]] as const) if (a[key]) parts.push(`${label}: ${key === "distance_km" ? `약 ${a[key]}km` : a[key]}`);
      parts.push(...reviewFactsForAcademy(a));
      const academyType = humanAcademyType(a.academy_type);
      if (academyType) parts.push(`운영 형태: ${academyType}`);
      if (a.latitude && a.longitude) parts.push(`좌표: ${a.latitude}, ${a.longitude}`);
      if (imageKeys.length) parts.push(`사진 슬롯: ${imageKeys.map((imageKey) => `[IMAGE:${imageKey.key}]`).join(", ")}`);
      return parts.join(" / ");
    }).join("\n");
    const related = this.relatedPostsForSlot(tenant, slot);
    const relatedText = related.length
      ? ["관련 글 후보(실제 내부 링크, 필요 시 2~4개만 자연스럽게 연결):", ...related.map((post) => `- ${post.title}: https://${tenant}/community/${post.slug}`)].join("\n")
      : "";
    const header = [
      `작성 주제 지역: ${region}`,
      `소개 가능한 후보 수: ${academies.length}곳`,
      `사용 가능한 사진: ${Object.keys(images).length ? Object.keys(images).map((key) => `[IMAGE:${key}]`).join(", ") : "없음"}`,
      `후기 문구 보유 후보: ${academies.filter((a) => a.review).length}곳`,
      `작성 범위: 아래 항목에 없는 학원명·가격·합격률·셔틀·후기는 만들지 않는다`,
      `노출 방식: 이 입력 묶음 자체를 출처나 참고자료로 쓰지 않는다`,
    ].join("\n");
    return { text: [header, body, relatedText].filter(Boolean).join("\n\n"), images };
  }

  private imagesForSlot(tenant: string, slot: Row): Record<string, string> {
    if (!isDrivingTenant(this.db.getTenant(tenant) || {})) return {};
    if (!slot.region) return {};
    const images: Record<string, string> = {};
    for (const [i, academy] of this.pickAcademiesForRegion(tenant, String(slot.region), 5).entries()) {
      for (const imageKey of firstImageKeys(academy, i + 1, 2)) images[imageKey.key] = imageKey.url;
    }
    return images;
  }

  private relatedPostsForSlot(tenant: string, slot: Row): Row[] {
    const region = String(slot.region || "").trim();
    const keyword = String(slot.primary_keyword || "").replace(region, "").trim();
    const terms = [region, keyword].filter((term) => term.length >= 2).slice(0, 2);
    if (!terms.length) return this.db.all("SELECT title, slug FROM posts WHERE tenant=? AND status='published' ORDER BY generated_at DESC LIMIT 5", [tenant]);
    const rows = this.db.all("SELECT title, slug FROM posts WHERE tenant=? AND status='published' ORDER BY generated_at DESC LIMIT 80", [tenant]);
    return rows
      .map((post) => ({ ...post, score: terms.reduce((sum, term) => sum + (String(post.title || "").includes(term) ? 2 : 0) + (String(post.slug || "").includes(term.replace(/\s+/g, "-")) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score)
      .filter((post) => post.score > 0)
      .slice(0, 5);
  }

  private pickAcademiesForRegion(tenant: string, region: string, limit: number): Row[] {
    const exact = this.db.listAcademies(tenant, { region, limit: Math.max(limit * 3, 20) }).filter(isUsableAcademy);
    if (exact.length) return exact.slice(0, limit);
    const all = this.db.listAcademies(tenant, { limit: 5000 }).filter(isUsableAcademy);
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

  private processSocialGenerate(tenant: string, payload: Row): Row {
    const tenantMeta = this.db.getTenant(tenant) || {};
    const postIds = Array.isArray(payload.post_ids) ? payload.post_ids.map((id) => String(id)).filter(Boolean) : [];
    const platform = String(payload.platform || "youtube_shorts");
    const styleId = String(payload.style_id || tenantMeta.video_style_id || "card-news-clean");
    const cardCount = clampInt(payload.card_count, 8, 5, 12);
    let ok = 0, fail = 0;
    const per_post: Row[] = [];
    for (const postId of postIds) {
      const post = this.db.getPost(postId);
      if (!post || post.tenant !== tenant || post.status === "deleted") {
        fail++;
        per_post.push({ post_id: postId, ok: false, error: "post not found" });
        continue;
      }
      try {
        const social = buildSocialPackage(tenantMeta, post, { platform, styleId, cardCount });
        const packageId = this.db.upsertSocialPackage({
          tenant,
          post_id: post.id,
          platform,
          style_id: styleId,
          status: "ready",
          ...social,
        });
        ok++;
        per_post.push({ post_id: post.id, package_id: packageId, ok: true, cards: social.cards.length, title: social.title });
      } catch (error: any) {
        fail++;
        per_post.push({ post_id: postId, ok: false, error: error?.message || String(error) });
      }
    }
    return { ok, fail, platform, style_id: styleId, per_post };
  }

  private processVideoRender(tenant: string, payload: Row): Row {
    const packageIds = Array.isArray(payload.package_ids) ? payload.package_ids.map((id) => String(id)).filter(Boolean) : [];
    let ok = 0, fail = 0;
    const per_package: Row[] = [];
    for (const packageId of packageIds) {
      const item = this.db.getSocialPackage(packageId);
      if (!item || item.tenant !== tenant) {
        fail++;
        per_package.push({ package_id: packageId, ok: false, error: "social package not found" });
        continue;
      }
      try {
        this.db.updateSocialPackage(packageId, { status: "rendering", error: null });
        const manifest = buildRenderManifest(item, payload);
        const outputDir = resolve(PROJECT_DIR, "exports/social", safePathSegment(tenant));
        mkdirSync(outputDir, { recursive: true });
        const manifestPath = resolve(outputDir, `${safePathSegment(packageId)}.render.json`);
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        this.db.updateSocialPackage(packageId, { status: "ready", render_spec: { ...manifest, manifest_path: manifestPath }, error: null });
        ok++;
        per_package.push({
          package_id: packageId,
          ok: true,
          manifest_path: manifestPath,
          render_command: `npm --prefix apps/video-renderer run render -- --input ${manifestPath}`,
        });
      } catch (error: any) {
        const message = error?.message || String(error);
        this.db.updateSocialPackage(packageId, { status: "failed", error: message });
        fail++;
        per_package.push({ package_id: packageId, ok: false, error: message });
      }
    }
    return { ok, fail, renderer: payload.renderer || "remotion", per_package, note: "Created Remotion-ready manifests. Run the render command after installing apps/video-renderer dependencies to produce MP4 files." };
  }

  private processSiteDeploy(tenant: string, payload: Row): Row {
    const deploymentId = String(payload.deployment_id || "");
    if (!deploymentId) throw new Error("deployment_id required");
    const rows = this.db.listSiteDeployments(tenant, 200);
    const deployment = rows.find((row) => row.id === deploymentId);
    if (!deployment) throw new Error("deployment not found");
    this.db.updateSiteDeployment(deploymentId, {
      status: "ready",
      site_url: deployment.site_url || `https://${tenant}`,
      last_deployed_at: new Date().toISOString(),
      notes: [deployment.notes, "Manual deployment checkpoint prepared by worker."].filter(Boolean).join("\n"),
    });
    return {
      deployment_id: deploymentId,
      provider: deployment.provider || "manual",
      site_url: deployment.site_url || `https://${tenant}`,
      note: "Deployment automation checkpoint recorded. Provider API deployment can be attached after hosting credentials are configured.",
    };
  }
}

function buildSocialPackage(tenant: Row, post: Row, opts: { platform: string; styleId: string; cardCount: number }): Row {
  const brand = String(tenant.display_name || tenant.domain || "브랜드").trim();
  const siteUrl = String(tenant.site_url || `https://${tenant.domain || post.tenant}`).replace(/\/+$/, "");
  const title = cleanSocialText(post.title || extractTitle(post.body_markdown || "", "오늘의 체크"));
  const plain = markdownToPlainText(post.body_markdown || "");
  const headings = extractMarkdownHeadings(post.body_markdown || "").filter((heading) => heading !== title);
  const bullets = extractSocialBullets(post.body_markdown || "", plain);
  const sentences = splitSentences(plain);
  const hook = makeHook(title, bullets, sentences);
  const cards = buildCards({ brand, title, hook, headings, bullets, sentences, count: opts.cardCount, siteUrl, slug: post.slug });
  const narration = cards.map((card: Row, index: number) => `${index + 1}. ${card.title}. ${card.body}`).join("\n");
  const hashtags = makeHashtags(tenant, post, opts.platform);
  const caption = [
    `${title}`,
    "",
    cards.slice(1, Math.min(cards.length, 5)).map((card: Row) => `- ${card.title}`).join("\n"),
    "",
    `${siteUrl}/community/${post.slug}`,
    hashtags.map((tag: string) => `#${tag}`).join(" "),
  ].filter(Boolean).join("\n");
  return {
    title: truncateText(title, 70),
    hook,
    script: narration,
    cards,
    caption,
    hashtags,
    render_spec: {
      composition: "CardNewsShort",
      width: 1080,
      height: 1920,
      fps: 30,
      duration_sec: Math.max(24, Math.min(60, cards.length * 5)),
      brand,
      brand_color: tenant.brand_color || "#5132d7",
      site_url: siteUrl,
      post_url: `${siteUrl}/community/${post.slug}`,
      style_id: opts.styleId,
      platform: opts.platform,
    },
  };
}

function buildCards(input: { brand: string; title: string; hook: string; headings: string[]; bullets: string[]; sentences: string[]; count: number; siteUrl: string; slug: string }): Row[] {
  const cards: Row[] = [
    {
      role: "hook",
      title: truncateText(input.title, 34),
      body: truncateText(input.hook, 76),
      accent: "start",
    },
  ];
  const pool = [...input.bullets, ...input.headings, ...input.sentences].map((text) => cleanSocialText(text)).filter((text) => text.length >= 8);
  const seen = new Set<string>();
  for (const text of pool) {
    const key = text.replace(/\s+/g, " ").slice(0, 36);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = inferCardTitle(text, cards.length);
    cards.push({
      role: "point",
      title: truncateText(title, 28),
      body: truncateText(text, 92),
      accent: cards.length % 2 === 0 ? "soft" : "solid",
    });
    if (cards.length >= input.count - 1) break;
  }
  while (cards.length < input.count - 1) {
    cards.push({
      role: "point",
      title: `체크 ${cards.length}`,
      body: "자세한 기준은 본문에서 순서대로 확인하세요.",
      accent: "soft",
    });
  }
  cards.push({
    role: "cta",
    title: `${input.brand}에서 이어보기`,
    body: `${input.siteUrl}/community/${input.slug}`,
    accent: "cta",
  });
  return cards.map((card, index) => ({ ...card, index: index + 1 }));
}

function makeHook(title: string, bullets: string[], sentences: string[]): string {
  const first = cleanSocialText(bullets[0] || sentences[0] || title);
  if (first && first.length > 12) return truncateText(first, 82);
  return truncateText(`${title} 보기 전에 이것부터 확인하세요.`, 82);
}

function inferCardTitle(text: string, index: number): string {
  const match = text.match(/^(.{4,24}?)(?:은|는|이|가|부터|까지|에서|에는|,|\s-|\s:)/u);
  if (match?.[1]) return match[1].trim();
  const compact = text.split(/\s+/).slice(0, 5).join(" ");
  return compact || `포인트 ${index}`;
}

function buildRenderManifest(item: Row, payload: Row): Row {
  const cards = safeJson(item.cards, []);
  const baseSpec = safeJson(item.render_spec, {});
  return {
    ...baseSpec,
    package_id: item.id,
    tenant: item.tenant,
    post_id: item.post_id,
    post_slug: item.post_slug,
    platform: item.platform,
    style_id: item.style_id,
    title: item.title,
    hook: item.hook,
    script: item.script,
    caption: item.caption,
    hashtags: safeJson(item.hashtags, []),
    cards,
    fps: clampInt(payload.fps, Number(baseSpec.fps || 30), 24, 60),
    output: {
      filename: `${safePathSegment(item.tenant)}-${safePathSegment(item.post_slug || item.id)}-${safePathSegment(item.platform)}.mp4`,
      directory: "exports/social/videos",
    },
  };
}

function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, (m) => m.replace(/\(([^)]+)\)/, ""))
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\|/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_`>#\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMarkdownHeadings(markdown: string): string[] {
  return markdown.split(/\r?\n/)
    .map((line) => line.match(/^\s{0,3}#{1,3}\s+(.+)$/)?.[1] || "")
    .map(cleanSocialText)
    .filter(Boolean)
    .slice(0, 12);
}

function extractSocialBullets(markdown: string, plain: string): string[] {
  const bullets = markdown.split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/)?.[1] || "")
    .map(cleanSocialText)
    .filter((line) => line.length >= 8);
  if (bullets.length >= 4) return bullets.slice(0, 16);
  return splitSentences(plain).slice(0, 16);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.|니다\.)\s+/u)
    .map(cleanSocialText)
    .filter((line) => line.length >= 10)
    .slice(0, 20);
}

function makeHashtags(tenant: Row, post: Row, platform: string): string[] {
  const base = [tenant.display_name, tenant.vertical, post.title, platform.includes("instagram") ? "릴스" : "쇼츠", "체크리스트", "생활정보"];
  const words = base.flatMap((value) => String(value || "").split(/[\s,/|·:]+/))
    .map((word) => word.replace(/[^0-9A-Za-z가-힣_]/g, ""))
    .filter((word) => word.length >= 2 && word.length <= 18);
  return Array.from(new Set(words)).slice(0, 10);
}

function cleanSocialText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[[A-Z_]+:[^\]]+\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(text: string, max: number): string {
  const clean = cleanSocialText(text);
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function safePathSegment(value: unknown): string {
  return String(value || "item").replace(/[^0-9A-Za-z._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
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
    const child = spawn(cmd, args, { env, cwd: PROJECT_DIR, stdio: ["pipe", "pipe", "pipe"] });
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
  return firstImageKeys(row, index, 1)[0] || { key: `academy_${index}`, url: "" };
}

function firstImageKeys(row: Row, index: number, max = 2): Array<{ key: string; url: string }> {
  const photos = safeJson(row.photos, []);
  const urls = Array.isArray(photos) ? photos.map((v) => String(v || "").trim()).filter(Boolean) : [];
  const thumb = String(row.thumb_url || "").trim();
  if (thumb) urls.unshift(thumb);
  return Array.from(new Set(urls)).slice(0, max).map((url, photoIndex) => ({ key: photoIndex === 0 ? `academy_${index}` : `academy_${index}_${photoIndex + 1}`, url }));
}

function isUsableAcademy(row: Row): boolean {
  const name = String(row.name || "").trim();
  if (!name || /^(?:test|테스트|sample|dummy|asdf|qwer|123|없음|null|undefined)/i.test(name)) return false;
  if (/(?:테스트|샘플|더미|dummy|sample|placeholder)/i.test(name)) return false;
  const usableFields = ["address", "price", "shuttle", "hours", "pass_rate", "phone", "vphone", "review", "seo_description", "seo_keywords", "thumb_url", "photos"];
  return usableFields.some((key) => String(row[key] || "").trim().length >= 8);
}

function reviewFactsForAcademy(row: Row): string[] {
  const facts: string[] = [];
  const reviews = safeJson(row.review_json, []);
  const legacyReview = String(row.review || "").trim();
  if (Array.isArray(reviews) && reviews.length) {
    const summary = reviewEvidenceSummary(reviews.map((review) => review?.content), reviews.map((review) => review?.point));
    if (summary) facts.push(`긍정 수강생 리뷰 보충자료: ${summary}`);
  } else if (legacyReview) {
    const summary = reviewEvidenceSummary(legacyReview.split(/\n+/), []);
    if (summary) facts.push(`긍정 수강생 리뷰 보충자료: ${summary}`);
  }
  const blogReviews = safeJson(row.blog_reviews, []);
  if (Array.isArray(blogReviews) && blogReviews.length) {
    const themes = reviewThemesFromTexts(blogReviews.flatMap((review) => [review?.title, review?.content]));
    const links = blogReviews
      .map((review) => {
        const title = cleanFactText(review?.title).slice(0, 120);
        const link = String(review?.link || "").trim();
        if (!title || !link) return "";
        return `"${title}" ${link}`;
      })
      .filter(Boolean)
      .slice(0, 2);
    if (themes.length || links.length) facts.push(`긍정 블로그 리뷰글 보충자료: ${themes.length ? `후기 흐름 ${themes.join(", ")}` : "후기 흐름 확인"}${links.length ? ` / 참고 글 ${links.join(" | ")}` : ""}`);
  }
  return facts;
}

function reviewEvidenceSummary(values: unknown[], points: unknown[]): string {
  const texts = values.map(cleanFactText).filter(Boolean);
  const themes = reviewThemesFromTexts(texts);
  const pointCount = points.filter((value) => Number(value) >= 4).length;
  const parts: string[] = [];
  if (themes.length) parts.push(`후기 요약 ${themes.join(", ")}`);
  if (pointCount) parts.push(`4점 이상 리뷰 ${pointCount}개`);
  return parts.join(" / ");
}

function reviewThemesFromTexts(values: unknown[]): string[] {
  const text = values.map(cleanFactText).join(" ");
  const themes: Array<[string, RegExp]> = [
    ["친절한 상담·응대", /친절|상담|카운터|직원/u],
    ["강사의 꼼꼼한 설명", /강사|선생|쌤|설명|잘\s*알려|꼼꼼|세심/u],
    ["초보자도 긴장 덜한 분위기", /초보|겁|긴장|안심|분위기|편하/u],
    ["셔틀·방문 동선 만족", /셔틀|동선|가까|위치|방문|편했/u],
    ["시설·차량 관리 만족", /시설|차량|깨끗|청결|쾌적/u],
    ["주변 추천 의향", /추천|강추|지인/u],
  ];
  return themes.filter(([, pattern]) => pattern.test(text)).map(([label]) => label).slice(0, 4);
}

function cleanFactText(value: unknown): string {
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

function humanAcademyType(value: unknown): string {
  const raw = String(value || "").trim();
  const map: Record<string, string> = {
    academy: "운전학원",
    exam_academy: "자동차운전전문학원",
    test_center: "운전면허시험장",
  };
  return map[raw] || raw.replace(/_/g, " ").trim();
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
    ensureHeadingBodies(
      removeInternalLeakage(
        normalizeKoreanSpacing(
          stripPseudoSlots(
            stripPreamble(summary)
              .replace(/^```(?:markdown|md)?\s*/i, "")
              .replace(/```\s*$/i, "")
              .replace(/\[(\d+)\]/g, "")
              .replace(/\n{3,}/g, "\n\n")
              .trim()
          )
        )
      )
    ),
    images
  );
}

function ensureHeadingBodies(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] || "";
    out.push(line);
    if (!/^#{2,3}\s+/.test(line.trim())) continue;
    const next = lines.slice(i + 1).find((candidate) => candidate.trim());
    if (next && /^#{2,3}\s+/.test(next.trim())) {
      out.push("아래에서는 확인된 후보 정보와 상담 전 체크포인트를 기준으로, 실제로 비교할 때 도움이 되는 내용만 간단히 정리합니다.");
      out.push("");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function removeInternalLeakage(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let droppingReferenceSection = false;
  for (const line of lines) {
    if (/^#{2,4}\s+.*(?:참고자료|출처|레퍼런스|References)/i.test(line)) {
      droppingReferenceSection = true;
      continue;
    }
    if (droppingReferenceSection && /^#{1,4}\s+/.test(line)) droppingReferenceSection = false;
    if (droppingReferenceSection) continue;
    if (/(api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|내부\s*(?:API|데이터|자료)|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|내부자료ID|DrivingPlus|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
  const candidateNames = candidateNamesFromFacts(facts);
  const h2Count = (markdown.match(/^##\s+/gm) || []).length;
  const imageKeys = Object.keys(images);
  const usedImageKeys = Array.from(markdown.matchAll(/\[IMAGE:([A-Za-z0-9_-]+)\]/g)).map((m) => m[1]!);
  if (!markdown.trim().startsWith("# ")) issues.push("missing_h1_title");
  if (chars < 3500) issues.push(`too_short_${chars}`);
  if (chars > 5600) issues.push(`too_long_${chars}`);
  if (h2Count < 4) issues.push(`not_enough_h2_${h2Count}`);
  if (h2Count > 10) issues.push(`too_many_h2_${h2Count}`);
  issues.push(...readabilityIssues(markdown));
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (/(검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(markdown)) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(markdown)) issues.push("risky_duration_or_pass_guarantee_claim");
  if (!hasVerifiedPriceFacts(facts) && hasSpecificMoneyClaim(markdown)) issues.push("unverified_specific_price_claim");
  if (!hasReviewFacts(facts) && hasSpecificReviewClaim(markdown)) issues.push("unverified_review_claim");
  const inflated = inflatedCandidateCountClaim(markdown, candidateCount);
  if (inflated) issues.push(`inflated_candidate_count_${inflated.claimed}_gt_${inflated.actual}`);
  if (candidateNames.length && !candidateNames.some((name) => markdown.includes(name))) issues.push("missing_real_candidate_name");
  if (candidateNames.length >= 2 && !candidateNames.slice(0, 4).some((name) => markdownTableText(markdown).includes(name))) issues.push("table_missing_real_candidate_name");
  if (/긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/.test(facts) && !/(후기|리뷰|수강생|블로그)/.test(markdown)) issues.push("review_facts_unused");
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
  if (chars > 5600) issues.push(`too_long_${chars}`);
  if (h2Count < 4) issues.push(`not_enough_h2_${h2Count}`);
  if (h2Count > 10) issues.push(`too_many_h2_${h2Count}`);
  issues.push(...readabilityIssues(markdown));
  if (!isAnyMarkdownTable(markdown)) issues.push(candidateCount >= 2 ? "missing_comparison_table" : "missing_summary_table");
  if (thinSectionCount(markdown) > 1) issues.push("thin_sections");
  if (!/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓)/m.test(markdown)) issues.push("missing_checklist_or_list");
  if (/\[(?:TABLE|CTA|FAQ|QUOTE|IMAGE|INTERNAL_LINK)_SLOT:|\[INTERNAL_LINK:/i.test(markdown)) issues.push("contains_pseudo_slot");
  if (/\[\d+\]/.test(markdown)) issues.push("contains_visible_citations");
  if (/(운전선생|검증된 자료|확인된 콘텐츠 재료|작성 범위|소개 가능한 후보 수|API 자료|제공된 자료|후기 필드|긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료|직접 매칭 후보 수|사용 가능한 이미지 슬롯|본문에 사용할 수 있는 후보|본문에 사용할 수 있는 사진 슬롯|작성자 주의|내부자료ID|내부 데이터|내부 API|DrivingPlus|api-dev\.drivingplus\.me|get-all-academy|zipcode\/search-seo|firebasestorage\.googleapis\.com|storage\.googleapis\.com)/i.test(`${title}\n${markdown}`)) issues.push("exposes_internal_fact_language");
  if (hasRiskyDurationClaim(`${title}\n${markdown}`)) issues.push("risky_duration_or_pass_guarantee_claim");
  const inflated = inflatedCandidateCountClaim(`${title}\n${markdown}`, candidateCount);
  if (inflated) issues.push(`inflated_candidate_count_${inflated.claimed}_gt_${inflated.actual}`);
  if (/[가-힣]+(?:시|군|구|읍|면|동)운전면허학원/.test(title)) issues.push("keyword_spacing_issue");
  if (imageKeys.length && usedImageKeys.length === 0) issues.push("missing_available_image_slot");
  const unknown = usedImageKeys.filter((key) => !imageKeys.includes(key));
  if (unknown.length) issues.push(`unknown_image_slots_${Array.from(new Set(unknown)).join("_")}`);
  return issues;
}

function readabilityIssues(markdown: string): string[] {
  const issues: string[] = [];
  const paragraphs = readableParagraphs(markdown);
  const longParagraphs = paragraphs.filter((paragraph) => paragraph.length > 420);
  if (longParagraphs.length) issues.push(`overlong_paragraph_${Math.max(...longParagraphs.map((p) => p.length))}`);
  if (adjacentHeadingCount(markdown) > 0) issues.push('adjacent_headings_without_body');
  if (orphanHeadingCount(markdown) > 1) issues.push('too_many_thin_or_empty_heading_sections');
  return issues;
}

function readableParagraphs(markdown: string): string[] {
  return String(markdown || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part && !/^(?:#{1,6}\s+|\|.+\||[-*]\s+|\d+[.)]\s+|>|\[IMAGE:)/m.test(part));
}

function adjacentHeadingCount(markdown: string): number {
  const lines = String(markdown || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let count = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^#{2,3}\s+/.test(lines[i] || '') && /^#{2,3}\s+/.test(lines[i + 1] || '')) count++;
  }
  return count;
}

function orphanHeadingCount(markdown: string): number {
  const sections = String(markdown || '').split(/^##\s+/gm).slice(1);
  let count = 0;
  for (const section of sections) {
    const lines = section.split(/\r?\n/);
    lines.shift();
    const text = lines.join('\n')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\[IMAGE:[A-Za-z0-9_-]+\]/g, '')
      .replace(/^\|.+\|$/gm, '')
      .replace(/(^|\n)\s*(?:[-*]\s+|\d+[.)]\s+|✅|✓).*$/gm, '')
      .replace(/^#{3,6}\s+.+$/gm, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 0 && text.length < 80) count++;
  }
  return count;
}

const RISKY_DURATION_OR_GUARANTEE_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합\s*격|무조건\s*합\s*격|합\s*격\s*보장|보장\s*합\s*격/u;
const SPECIFIC_MONEY_RE = /\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;
const SPECIFIC_REVIEW_CLAIM_RE = /실제\s*수강생|수강생들은|수강생이|후기에서는|후기에서|리뷰에서는|리뷰에서|블로그\s*후기/u;

function hasRiskyDurationClaim(value: string): boolean {
  return RISKY_DURATION_OR_GUARANTEE_RE.test(value);
}

function hasSpecificMoneyClaim(value: string): boolean {
  return SPECIFIC_MONEY_RE.test(value);
}

function hasVerifiedPriceFacts(facts: string): boolean {
  return /(?:수강료|가격|비용):\s*[^/\n]+/u.test(facts);
}

function hasReviewFacts(facts: string): boolean {
  return /긍정 수강생 리뷰 보충자료|긍정 블로그 리뷰글 보충자료/u.test(facts);
}

function hasSpecificReviewClaim(value: string): boolean {
  return SPECIFIC_REVIEW_CLAIM_RE.test(value);
}

function inflatedCandidateCountClaim(markdown: string, actual: number): { claimed: number; actual: number } | null {
  if (!actual || actual < 1) return null;
  const headings = Array.from(markdown.matchAll(/^#{1,3}\s+(.+)$/gm)).map((m) => m[1] || "");
  const titleLine = markdown.split(/\r?\n/, 1)[0] || "";
  const targets = Array.from(new Set([titleLine.replace(/^#\s+/, ""), ...headings]));
  let maxClaim = 0;
  for (const target of targets) {
    for (const count of candidateCountClaims(target)) maxClaim = Math.max(maxClaim, count);
  }
  return maxClaim > actual ? { claimed: maxClaim, actual } : null;
}

function candidateCountClaims(value: string): number[] {
  const text = String(value || "");
  const claims: number[] = [];
  const patterns = [
    /(?:BEST|TOP)\s*(\d{1,2})/giu,
    /(?:추천|비교|후보|학원)\s*(\d{1,2})\s*(?:곳|개)/gu,
    /(\d{1,2})\s*(?:곳|개)\s*(?:추천|비교|후보|학원)/gu,
    /운전면허학원\s*(\d{1,2})\s*(?:곳|개)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const n = Number(match[1]);
      if (Number.isFinite(n)) claims.push(n);
    }
  }
  return claims;
}

function candidateCountFromFacts(facts: string): number {
    const direct = facts.match(/(?:직접 매칭 후보 수|본문에 사용할 수 있는 후보|소개 가능한 후보 수):\s*(\d+)/);
  if (direct) return Number(direct[1]);
  return (facts.match(/^\[\d+\]/gm) || []).length;
}

function candidateNamesFromFacts(facts: string): string[] {
  return Array.from(facts.matchAll(/^\[\d+\]\s+([^\n/]+?)(?:\s*\/|\s*$)/gm))
    .map((m) => String(m[1] || "").trim())
    .filter((name) => name.length >= 2 && !/^(?:test|테스트|sample|dummy)/i.test(name));
}

function markdownTableText(markdown: string): string {
  return markdown.split(/\r?\n/).filter((line) => line.includes("|")).join("\n");
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

function isDrivingTenant(tenant: Row): boolean {
  const vertical = String(tenant.vertical || "").toLowerCase();
  return vertical === "driving" || vertical.includes("drive") || vertical.includes("운전");
}

function genericFactsForSlot(tenant: Row, slot: Row): GenerationFacts {
  const lines = [
    `브랜드: ${publicBrandName(tenant)}`,
    `업종: ${tenant.vertical || "general"}`,
    `주 키워드: ${slot.primary_keyword}`,
    `지역/범위: ${slot.region || "전국/온라인"}`,
    `페르소나: ${slot.persona || "일반 독자"}`,
    `검색 의도: ${slot.intent || "정보 탐색"}`,
    `강조점: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ") || "체크리스트와 비교 기준"}`,
    `브랜드 메모: ${tenant.content_brief || "초보자가 바로 판단할 수 있는 생활정보형 글을 만든다."}`,
    "작성 범위: 확인되지 않은 수치, 가격, 치료 효과, 보장 표현은 쓰지 않는다.",
  ];
  return { text: lines.join("\n"), images: {} };
}

function buildGenericPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string): string {
  const brand = publicBrandName(tenant);
  const vertical = String(tenant.vertical || "general");
  return `너는 ${brand} 블로그를 쓰는 한국어 SEO 에디터다. 아래 슬롯을 바탕으로 검색자가 바로 저장하고 공유할 수 있는 완성형 Markdown 글을 작성하라.

브랜드: ${brand}
업종: ${vertical}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${genericDesignWritingGuide(designTemplateId)}
주 키워드: ${slot.primary_keyword}
지역/범위: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
브랜드/작성 메모: ${tenant.content_brief || "없음"}

작성 재료:
${facts || "없음"}

일반 도메인 작성 원칙:
- 이 글은 운전학원 글이 아니다. 운전면허, 학원, 셔틀, 합격률, 도로주행 같은 운전 도메인 표현을 쓰지 않는다.
- 건강/생활정보 주제라면 진단, 치료, 완치, 보장, 의학적 효능을 단정하지 않는다. 필요한 경우 "개인 상태에 따라 다르므로 전문가와 상담" 정도로 안전하게 표현한다.
- 확인되지 않은 가격, 확률, 후기, 통계, 제품 순위, 기관명은 만들지 않는다.
- 독자가 바로 판단할 수 있도록 기준, 체크리스트, 비교표, 주의사항, 다음 행동을 구체화한다.
- 첫 줄은 '# ' H1 제목으로 시작한다.
- H2 4~7개, Markdown 표 1개 이상, 체크리스트/불릿 1개 이상을 포함한다.
- 본문은 2,800~4,800자 안에서 작성한다.
- 문단은 짧게 끊고, 제목만 연속으로 나열하지 않는다.
- 마지막 섹션은 ${brand}에서 이어 볼 수 있는 자연스러운 CTA로 마무리한다.
- 출력은 Markdown 본문만 제공한다. 설명, 주석, 내부 자료 표현은 쓰지 않는다.`;
}

function buildGenericRepairPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string, markdown: string, issues: string[]): string {
  const brand = publicBrandName(tenant);
  return `아래 Markdown 글은 품질 게이트를 통과하지 못했다. 운전학원 도메인 표현을 제거하고, ${brand}의 일반 생활정보 글로 다시 작성하라.

브랜드: ${brand}
업종: ${tenant.vertical || "general"}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${genericDesignWritingGuide(designTemplateId)}
주 키워드: ${slot.primary_keyword}
지역/범위: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}

실패 사유:
${issues.map((issue) => `- ${issue}`).join("\n")}

작성 재료:
${facts || "없음"}

재작성 규칙:
- 첫 줄은 '# ' 제목.
- 2,800~4,800자, H2 4~7개, Markdown 표 1개, 체크리스트/불릿 1개 이상.
- 건강/생활정보 주제는 진단·치료·완치·보장·의학적 효능을 단정하지 않는다.
- 운전면허, 학원, 셔틀, 합격률, 도로주행 같은 이전 도메인 표현을 넣지 않는다.
- 확인되지 않은 가격, 후기, 통계, 기관명은 만들지 않는다.
- 출력은 수정된 Markdown 본문만 제공한다.

기존 Markdown:
${markdown}`;
}

function genericDesignWritingGuide(designTemplateId: string): string {
  const guides: Record<string, string> = {
    editorial: "정보성 매거진형. 공감 도입, 핵심 기준, 자세한 설명, FAQ/체크리스트, 자연스러운 CTA가 이어지도록 작성한다.",
    comparison: "비교형. 선택 기준과 비교표를 앞쪽에 배치하고 장단점, 추천 대상, 주의사항을 명확히 작성한다.",
    "local-guide": "지역/상황형. 지역이나 생활 상황이 있으면 그 맥락을 먼저 잡고, 선택 기준과 다음 행동을 제시한다.",
    checklist: "체크리스트형. 따라 하기 쉬운 순서, 준비물, 실수 방지 항목을 앞쪽에 배치한다.",
    conversion: "전환형. 과장 없이 문제 공감, 판단 기준, 확인 질문, CTA를 배치한다.",
    custom: "사용자 지정형. 저장된 기획 메모를 우선 따르되 섹션을 명확히 나눠 작성한다.",
  };
  return guides[designTemplateId] || guides.editorial!;
}

function buildRepairPrompt(tenant: Row, slot: Row, facts: string, designTemplateId: string, markdown: string, issues: string[]): string {
  const brand = publicBrandName(tenant);
  return `아래 Markdown 글은 품질 게이트를 통과하지 못했다. 확인된 콘텐츠 재료만 사용해서 같은 주제의 완성형 글로 다시 작성하라.

테넌트: ${brand}
디자인 템플릿: ${designTemplateId}
디자인 작성 지침: ${designWritingGuide(designTemplateId)}
템플릿 필수 구조:
${designStructureGuide(designTemplateId)}
원본 엑셀 기반 템플릿 작성법:
${originalTemplateGuide(slot.template_id)}
원본 전체 글 패턴 기반 작성법:
${originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}

실패 사유:
${issues.map((issue) => `- ${issue}`).join("\n")}

확인된 콘텐츠 재료:
${facts || "없음"}

재작성 규칙:
- 제목/지역/후보 학원/이미지는 확인된 콘텐츠 재료와 반드시 일치시킨다.
- 소개 가능한 후보가 1곳 이상이면 본문과 표에 실제 후보명 최소 1개를 반드시 넣는다. 후보명이 빠진 일반 가이드 글은 실패다.
- 후보별 설명은 원본 블로그처럼 작은 카드형으로 쓴다: **후보명** → 위치/생활권 → 추천 대상 → 상담 때 확인할 질문 → 사진 순서.
- 긍정 수강생 리뷰/블로그 리뷰글 보충자료가 있으면 리뷰 원문을 길게 인용하지 말고 후보 설명을 보강하는 용도로만 1~2문장 짧게 요약한다.
- 좋은 리뷰라도 합격 보장·과장된 효능은 만들지 말고, “실제 수강후기에서는 친절/동선/설명 방식이 언급된다”처럼 보충 근거로만 쓴다.
- 후보 수보다 큰 숫자, 다른 지역 후보, 없는 가격·합격률·셔틀·후기·3일 합격·당일 합격·합격 보장 주장을 만들지 않는다.
- 구체 금액은 수강료 자료가 있을 때만 쓴다. 자료가 없으면 “비용은 상담 때 확인”과 확인 질문으로 처리한다.
- 주소가 주제 지역과 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근 후보"로만 구분해 설명한다.
- 첫 줄은 '# ' 제목, H2 4~6개 중심, 많아도 10개를 넘기지 말고 3,500~5,600자 이내로 쓴다.
- 후보 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 비교표 대신 주소/연락처/과정/상담 확인점을 담은 요약표로 작성한다.
- 체크리스트는 포함하되 FAQ는 주제가 실제 질문형일 때만 2~4개로 짧게 둔다. 원본처럼 FAQ가 억지로 붙은 느낌이면 만들지 않는다.
- 사용 가능한 이미지 슬롯이 있으면 실제 키만 [IMAGE:academy_1] 형식으로 본문 흐름에 3~4개까지 배치한다.
- 학원명·가격·셔틀·면허종류·준비물처럼 독자가 스캔해야 하는 핵심어는 Markdown bold를 적당히 사용한다.
- 관련 글 후보가 있으면 실제 링크만 2~4개 연결한다. 후보가 없으면 링크를 꾸며내지 않는다.
- [1], [2] 같은 출처번호와 입력 묶음 표현(확인된 콘텐츠 재료, 작성 범위, 소개 가능한 후보 수, API 자료, 후보 수, 참고자료, 내부 API URL 등)은 노출하지 않는다.
- 출처/참고자료는 도로교통공단처럼 실제 외부 공신력 자료를 별도로 인용했을 때만 작성한다. 이번 입력의 학원 API는 출처가 아니라 내부 데이터다.
- 원문보다 더 자연스럽고 풍성한 ${brand} 블로그 톤으로 작성하되, 원본 레퍼런스처럼 구체적인 지역 생활권·비용 확인점·사진·내부링크·CTA가 보이게 만든다.
- 문단은 눈으로 훑기 좋게 짧고 리듬 있게 쓴다. 한 문단은 2~3문장, 가능하면 300자 안팎으로 끊고 420자를 넘기지 않는다.
- H2/H3 제목만 연속으로 붙이지 말고, 제목 아래에는 최소 한 문단·표·리스트·이미지 중 하나를 둔다.
- 긴 설명만 이어가지 말고 표, ✅ 체크리스트, 후보별 소제목, 후기 요약/주의문을 섞는다.
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
원본 엑셀 기반 템플릿 작성법:
${originalTemplateGuide(slot.template_id)}
템플릿: ${slot.template_id}
원본 전체 글 패턴 기반 작성법:
${originalArticlePatternGuide(slot)}
주 키워드: ${slot.primary_keyword}
지역: ${slot.region || ""}
페르소나: ${slot.persona || ""}
의도: ${slot.intent || ""}
수식어: ${[slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ")}
브랜드/작성 메모: ${tenant.content_brief || "없음"}

확인된 콘텐츠 재료:
${facts || "없음"}

절대 원칙:
- API 자료는 글 재료일 뿐이다. 주 키워드/지역/제목과 직접 맞는 학원만 본문 후보·표·사진·CTA에 사용한다.
- 소개 가능한 후보가 1곳 이상이면 실제 후보명을 본문과 표에 반드시 최소 1개 이상 포함한다. 후보명이 빠진 글은 일반론이라 실패다.
- 주소가 주제 지역과 일치하는 후보를 먼저 소개한다. 주소가 다르지만 "지역 중심 기준 거리"가 있는 후보는 해당 지역 안의 학원이 아니라 "인근/주변 후보"로 분리해 설명한다.
- 다른 시·군·구 후보를 주제 지역 내부 학원처럼 쓰지 말 것. 후보가 부족하면 부족한 그대로 설명한다.
- 확인된 콘텐츠 재료에 없는 학원명·사진·주소·전화번호·가격·셔틀·합격률·3일 합격·당일 합격·합격 보장·지역화폐·후기는 절대 생성하지 말 것.
- 제공된 후보 수보다 큰 숫자를 제목/본문에 쓰지 말 것. 예: 후보가 2곳이면 '3곳', 'BEST5' 금지.
- 출처번호 [1], [2]를 본문에 노출하지 말 것. 근거는 문장 안에 자연스럽게 녹인다.
- 내부 API URL이나 get-all-academy 주소는 내부 데이터 경로이므로 참고자료/출처 섹션에 절대 쓰지 말 것.
- 출처/참고자료 섹션은 도로교통공단 등 외부 공신력 자료를 실제로 인용했을 때만 만든다. 그렇지 않으면 출처 섹션 자체를 만들지 않는다.
- Markdown 굵게 표시는 원본 블로그처럼 핵심 학원명·비용·셔틀·준비물·주의점에만 적당히 사용한다. 문장 전체를 굵게 만들지는 않는다.

원본 레퍼런스 품질 기준:
- 원본 엑셀의 평균 형태에 맞춘다: 4,000~5,200자대, H2는 4~6개 중심, 표 1개 이상, 리스트 1개 이상, 이미지 3~4개 권장, 관련 내부링크 2~4개 권장, FAQ는 필수 아님.
- 딱딱한 데이터 나열이 아니라 ${brand} 블로그처럼 자연스럽게 시작한다. 예: 지역 생활권, 면허 준비 상황, 비용/동선 고민을 먼저 짚고 후보로 연결한다.
- 원본처럼 "왜 이 후보가 이 지역/상황에 맞는지"를 구체화한다. 주소만 쓰지 말고 생활권, 셔틀 확인 포인트, 면허 종류, 상담 질문, 사진을 같이 엮는다.
- 후보 소개는 원본 블로그의 카드형 리듬을 따른다. 후보마다 **후보명**, 위치/동선, 추천 대상, 상담 질문, 사진을 짧은 문단과 불릿으로 섞어 보여준다.
- 후보가 적은 지역은 억지로 BEST 숫자를 키우지 말고 “직접 확인 가능한 후보와 인근 선택지”처럼 정직하게 풀되, 실제 후보명이 보이게 쓴다.
- 가격·셔틀·합격률·후기는 검증된 자료에 있을 때만 단정한다. 없으면 "상담 때 확인"으로 처리하되, 무엇을 물어봐야 하는지 구체적인 질문으로 써서 빈말처럼 보이지 않게 한다.
- 수강료 자료가 없으면 60만원대, 70만원대, 709,600원 같은 구체 금액을 추정하지 않는다. 비용 문단은 “상담 시 확인할 항목” 중심으로 쓴다.
- 관련 글 후보가 있으면 실제 URL만 Markdown 링크로 자연스럽게 넣는다. 관련 글 후보가 없으면 내부링크를 만들지 않는다.
- 긍정 수강생 리뷰 보충자료가 있으면 후보 설명 안에서 친절·설명·동선 같은 확인된 후기 포인트를 요약 1문장으로만 사용한다. 단, “운전선생 출처”라는 표현은 쓰지 않는다. 리뷰가 없으면 실제 후기처럼 꾸며 쓰지 말고 상담 확인 팁으로 대체한다.
- 긍정 블로그 리뷰글 보충자료가 있으면 공식 근거처럼 단정하지 말고 “블로그 후기 흐름에서는 이런 점을 확인할 수 있다” 정도로 자연스럽게 녹인다. 링크를 넣을 때는 제공된 실제 URL만 사용한다.

필수 출력 구조:
- 첫 줄은 '# ' H1 제목. 제목은 주 키워드/지역/직접 매칭 후보 수와 모순되면 안 된다.
- H2 섹션은 4~6개를 기본으로 사용한다. 너무 잘게 쪼개 원본과 다르게 보이지 않게 하고, 많아도 10개를 넘기지 않는다.
- 권장 흐름은 템플릿 필수 구조를 우선 따른다. 공통적으로 도입 → 기준 → 후보/절차 → 비교/요약 → 체크리스트 → 상담/예약 CTA가 자연스럽게 이어져야 한다.
- 제공된 학원 수와 관계없이 Markdown 표 1개를 반드시 포함한다. 후보가 1곳이면 주소/연락처/과정/추천 대상/상담 확인점을 담은 요약표로 작성한다.
- 표는 정상 Markdown 표로 작성한다. 예: | 비교 항목 | 후보 A | 후보 B | 형태. 실제 후보가 있으면 표 안에도 실제 후보명을 넣는다.
- 후보별 설명에는 가능한 경우 학원명, 주소, 대표전화(vphone 우선), 운영 과정/유형, 추천 대상, 상담 시 확인할 점을 포함한다.
- 이미지가 제공된 학원이 하나라도 있으면 해당 학원 설명 직후 [IMAGE:academy_1] 같은 실제 이미지 슬롯을 최소 2개, 가능하면 3~4개 배치한다. 이미지가 없으면 임의 이미지/플레이스홀더를 만들지 않는다.
- 허용된 이미지 슬롯은 검증된 자료의 "사용 가능한 이미지 슬롯"에 있는 키만 사용한다.
- [IMAGE_SLOT: ...], [TABLE_SLOT: ...], [CTA_SLOT: ...], [QUOTE_SLOT: ...] 같은 임의 플레이스홀더는 절대 쓰지 말 것.
- 체크리스트 섹션은 ✅ 불릿 목록으로 작성한다.
- FAQ는 필수 아님. 필기시험/접수/준비물처럼 질문형 검색 의도일 때만 2~4개로 짧게 작성한다.
- 마지막 H2 섹션은 ${brand}에서 비교·상담·예약으로 이어지는 자연스러운 CTA로 마무리하고, 브랜드명을 3~7회 정도 자연스럽게 언급한다.

문체/분량:
- 4,000~5,200자를 우선 목표로 하고, 최소 3,500자 이상 5,600자 이내로 작성한다. 원본처럼 구체적인 설명과 표/이미지/링크가 있는 풍성한 글을 목표로 한다.
- 문단 하나는 2~3문장 안에서 끊고, 가능하면 300자 안팎으로 유지한다. 긴 설명 뒤에는 표/불릿/짧은 확인 질문을 넣어 읽기 좋게 만든다.
- 제목만 이어지는 구조는 피한다. 각 H2 아래에는 독자가 바로 이해할 수 있는 짧은 설명, 표, 리스트, 이미지 중 하나가 반드시 따라와야 한다.
- 독자가 바로 도움받을 수 있게 구체적으로 쓰되, 확인되지 않은 장점은 "상담 때 확인"으로 표현한다.
- SEO 키워드는 참고용으로만 사용하고 부자연스럽게 반복하지 말 것.
- 주 키워드와 맞지 않는 내용으로 글 방향을 틀지 말 것.
- 출력은 Markdown 본문만 제공하고 설명/주석은 쓰지 말 것.
- 마지막에 참고자료/출처 목록을 붙이지 말 것. 단, 도로교통공단 등 외부 공신력 자료를 실제로 인용한 경우에만 간단히 남긴다.`;
}
function designWritingGuide(designTemplateId: string): string {
  const guides: Record<string, string> = {
    editorial: "원본 블로그형. 생활권 공감 도입, 실제 이미지 3~4개, 요약/비교표 1개, 관련 글 링크, 자연스러운 브랜드 CTA가 이어지도록 작성한다.",
    comparison: "BEST 비교형. 비교표를 앞쪽에 배치하고 후보별 장단점, 추천 대상, 가격·셔틀·과정 확인점을 명확히 작성한다.",
    "local-guide": "지역 추천형. 지역명, 생활권, 셔틀/동선, 가까운 후보 요약/비교표를 중심으로 로컬 큐레이터처럼 작성한다.",
    checklist: "체크리스트형. 필기시험/접수/준비물처럼 따라 하기 쉬운 순서와 실수 방지 확인표를 앞쪽에 배치한다.",
    conversion: "예약 전환형. 상담, 예약, 비용 문의로 이어지되 원본처럼 과장보다 구체적인 확인 질문과 후보 사진을 강조한다.",
    custom: "사용자 지정형. 저장된 기획 메모와 템플릿 구조를 우선 따르되, 섹션을 명확히 나눠 작성한다.",
  };
  return guides[designTemplateId] || guides.editorial!;
}

function originalArticlePatternGuide(slot: Row): string {
  const summary = loadArticlePatternSummary();
  const articleType = articleTypeForSlot(slot);
  const titlePatterns = selectPatterns(summary.top_title_patterns, articleType, 4);
  const headingPatterns = selectPatterns(summary.top_heading_patterns, articleType, 3);
  const metrics = summary.average_structure_metrics || {};
  const metricLine = [
    `H2 평균 ${formatMetric(metrics.heading_count, "5~6")}`,
    `이미지 평균 ${formatMetric(metrics.image_count, "2~3")}`,
    `표 평균 ${formatMetric(metrics.table_count, "1~2")}`,
    `리스트 평균 ${formatMetric(metrics.bullet_count, "7~8")}`,
    `CTA 표현 평균 ${formatMetric(metrics.cta_term_count, "20+")}`,
  ].join(" / ");
  const lines = [
    `- 이 글은 원본 전체 21,275개 글에서 추출한 '${articleType}' 패턴을 우선 따른다.`,
    `- 평균 구조 기준: ${metricLine}. 단, 검증된 후보/이미지/자료가 부족하면 과장하지 말고 안전하게 축소한다.`,
  ];
  if (titlePatterns.length) {
    lines.push("- 제목 패턴 후보(그대로 복붙하지 말고 슬롯 지역/키워드/후보 수에 맞게 자연화):");
    for (const pattern of titlePatterns) lines.push(`  - ${pattern.pattern} (예: ${pattern.example_title || ""})`);
  }
  if (headingPatterns.length) {
    lines.push("- 헤딩 흐름 후보(H2 순서 참고, 실제 후보 수/자료에 맞게 조정):");
    for (const pattern of headingPatterns) lines.push(`  - ${pattern.pattern}`);
  }
  lines.push("- 패턴보다 사실 검증이 우선이다. 후보 수, 가격, 셔틀, 합격률, 후기, 이미지가 자료와 모순되면 패턴을 버리고 검증된 사실 기준으로 쓴다.");
  return lines.join("\n");
}

function loadArticlePatternSummary(): ArticlePatternSummary {
  const cached = (loadArticlePatternSummary as any).cache as ArticlePatternSummary | undefined;
  if (cached) return cached;
  const file = resolve(PROJECT_DIR, "data/keyword_extract/summaries/summary_all_article_patterns.json");
  try {
    const parsed = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const summary = parsed && typeof parsed === "object" ? parsed as ArticlePatternSummary : {};
    (loadArticlePatternSummary as any).cache = summary;
    return summary;
  } catch {
    const summary: ArticlePatternSummary = {};
    (loadArticlePatternSummary as any).cache = summary;
    return summary;
  }
}

function articleTypeForSlot(slot: Row): string {
  const templateId = String(slot.template_id || "");
  const text = [slot.primary_keyword, slot.intent, slot.modifier_1, slot.modifier_2].filter(Boolean).join(" ");
  if (/T06|T08|T09|T10|T11|T15/u.test(templateId) || /필기|학과시험|기능시험|도로주행|시험장|접수|문제|앱|어플/u.test(text)) return "exam_best";
  if (/T05|T04/u.test(templateId) || /비용|가격|수강료|절약|1종|2종|보통/u.test(text)) return "cost_comparison";
  if (/T01/u.test(templateId) || /BEST|추천|비교|합격률/u.test(text)) return "local_best_comparison";
  if (/T07|T14/u.test(templateId) || /셔틀|동선|주변|근처|지역/u.test(text)) return "local_access";
  return "general_best";
}

function selectPatterns(patterns: ArticlePattern[] | undefined, articleType: string, limit: number): ArticlePattern[] {
  const rows = Array.isArray(patterns) ? patterns : [];
  const exact = rows.filter((row) => row.article_type === articleType && row.pattern);
  const fallback = rows.filter((row) => row.pattern);
  return (exact.length ? exact : fallback).slice(0, limit);
}

function formatMetric(value: any, fallback: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : fallback;
}

function designStructureGuide(designTemplateId: string): string {
  const guides: Record<string, string[]> = {
    editorial: [
      "1) 상황 공감형 도입: 독자가 왜 지금 이 정보를 찾는지 2~3문장으로 시작",
      "2) 원본형 핵심 기준: 비용·동선·과정·셔틀·후기 여부를 묶어 설명",
      "3) 후보 소개: 각 후보를 생활권/추천 대상/상담 확인점/사진으로 풀어쓰기",
      "4) 요약/비교표: 후보 수와 관계없이 핵심 차이 또는 핵심 정보를 표로 정리",
      "5) 관련 글 링크와 자연스러운 상담 CTA로 마무리",
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
      "4) FAQ는 검색 의도가 질문형일 때만 실수 방지 질문 중심으로 구성",
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

function originalTemplateGuide(templateId: string): string {
  const guides: Record<string, string[]> = {
    T01: [
      "제목은 '지역 + 운전면허학원/BEST/가격 비교/셔틀' 축으로 잡되, 실제 후보 수보다 큰 숫자는 금지",
      "도입에서 지역 생활권·출퇴근/통학 동선을 짚고, 후보별 사진과 비교표를 넣는다",
      "가격·셔틀·후기는 자료가 있을 때만 단정하고 없으면 상담 질문으로 구체화한다",
    ],
    T03: [
      "검색자가 전체 흐름을 한 번에 이해하도록 준비 순서, 비용 확인, 시험 단계, 학원 선택 기준을 이어 쓴다",
      "표는 '단계/확인할 것/놓치기 쉬운 점' 형태가 적합하다",
    ],
    T04: [
      "1종/2종/자동/수동/대형 등 선택지가 헷갈리는 상황을 비교한다",
      "추천 대상과 주의점을 표로 정리하고 과장된 합격 보장은 피한다",
    ],
    T05: [
      "원본의 비용·시간 절약 전략형처럼 총액, 추가비, 재시험 가능성, 셔틀 동선을 구체 질문으로 풀어낸다",
      "확정 가격이 없으면 '상담 때 물을 질문'을 상세히 적어 빈말을 줄인다",
    ],
    T06: [
      "필기/기능/도로주행 중 하나의 시험 단계를 집중 공략한다",
      "자주 틀리는 포인트, 연습 순서, 체크리스트를 앞쪽에 둔다",
    ],
    T07: [
      "지역 허브 글처럼 학원 선택, 시험장/접수/비용/준비물을 넓게 연결한다",
      "관련 글 후보가 있으면 내부 링크를 묶어 다음 글로 이어지게 한다",
    ],
    T08: [
      "운전면허 필기시험 접수형. 온라인/현장 접수, 준비물, 사진, 신분증, 수수료 확인 항목을 절차형으로 쓴다",
      "공식 정보는 최신 확인 필요 문장으로 보수적으로 처리한다",
    ],
    T09: [
      "필기시험 팁형. 공부 순서, 문제 유형, 앱/모의고사 활용, 시험 당일 체크를 경험형으로 쓴다",
    ],
    T10: [
      "필기시험 앱 추천형. 앱을 임의로 꾸며내지 말고, 앱 선택 기준과 기능 체크리스트 중심으로 쓴다",
    ],
    T11: [
      "지역 운전면허시험장 소개형. 시험장 위치/동선/방문 전 확인사항 중심으로 작성하고 학원 글과 구분한다",
    ],
    T12: [
      "운전면허 취득 총정리형. 교육→필기→기능→도로주행→면허발급 순서로 큰 그림을 제공한다",
    ],
    T13: [
      "특정 타겟 맞춤형. 페르소나의 시간표·예산·이동수단을 기준으로 추천 기준을 달리한다",
    ],
    T14: [
      "전문학원 단독 소개형. 가장 적합한 1곳을 중심으로 사진, 과정, 위치, 상담 질문을 깊게 쓴다",
    ],
    T15: [
      "지역+시험단계 혼합형. 지역 후보와 필기/기능/도로주행 준비 팁을 연결한다",
    ],
  };
  return (guides[templateId] || guides.T03!).map((line) => `- ${line}`).join("\n");
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
    .filter((line) => !/^\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]$/i.test(line.trim()))
    .join("\n")
    .replace(/\[(?:IMAGE|TABLE|CTA|FAQ|QUOTE|INTERNAL_LINK)_SLOT:[^\]]+\]/gi, "")
    .replace(/\[INTERNAL_LINK:[^\]]+\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function ensureImageSlots(md: string, images: Record<string, string>) {
  const keys = Object.keys(images).sort((a, b) => a.localeCompare(b));
  if (!keys.length || /\[IMAGE:[A-Za-z0-9_-]+\]/.test(md)) return md;
  const insertions = keys.slice(0, Math.min(4, keys.length)).map((key) => `[IMAGE:${key}]`);
  const blocks = md.split(/\n{2,}/);
  if (blocks.length <= 2) return `${md}\n\n${insertions.join("\n\n")}`.trim();
  blocks.splice(Math.min(3, blocks.length), 0, insertions[0]!);
  if (insertions[1]) blocks.splice(Math.max(5, Math.floor(blocks.length * 0.55)), 0, insertions[1]);
  if (insertions[2]) blocks.splice(Math.max(7, Math.floor(blocks.length * 0.75)), 0, insertions[2]);
  if (insertions[3]) blocks.splice(Math.max(9, Math.floor(blocks.length * 0.88)), 0, insertions[3]);
  return blocks.join("\n\n").trim();
}
function metaDescription(md: string) { for (const raw of md.split(/\r?\n/)) { const s = raw.trim(); if (s && !s.startsWith("#") && !s.startsWith(">") && !s.startsWith("|") && !/^\[IMAGE:[A-Za-z0-9_-]+\]$/.test(s)) return s.replace(/[\*_`#]/g, "").slice(0, 155); } return ""; }
function publishMarkdownArtifact(slug: string, md: string) { const dir = resolve(PROJECT_DIR, "output"); mkdirSync(dir, { recursive: true }); const staleHtml = resolve(dir, `${slug}.html`); if (existsSync(staleHtml)) unlinkSync(staleHtml); writeFileSync(resolve(dir, `${slug}.md`), md, "utf8"); }
function jaccard(a: string, b: string) { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (!A.size || !B.size) return 0; let inter = 0; for (const t of A) if (B.has(t)) inter++; return inter / (A.size + B.size - inter); }
function tokens(s: string) { return s.toLowerCase().replace(/[^\w가-힣\s]/g, " ").split(/\s+/).filter((t) => t.length > 1); }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
