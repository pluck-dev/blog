import { ipcMain, BrowserWindow, dialog, app } from "electron";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import * as db from "./db";
import { generateSlotsForTenant, TEMPLATES } from "./slot_gen";
import { applyPreset, PRESET_KEYS } from "./presets";
import { generateAxesViaAi } from "./ai_axes";
import { ALL_TEMPLATES } from "./prompts";
import { getWorker } from "./worker";
import type {
  Axis, Provider, JobStatus, GeneratePayload, DedupPayload, PrunePayload, Post, ExportFormat,
} from "@shared/types";

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, payload);
  }
}

export function registerIpc(): void {
  db.initDb();
  const worker = getWorker();
  worker.on("progress", (ev) => broadcast("worker:progress", ev));
  worker.start();

  // Tenants
  ipcMain.handle("tenants:list", () => db.listTenants());
  ipcMain.handle("tenants:get", (_e, domain: string) => db.getTenant(domain));
  ipcMain.handle("tenants:create", (_e, args: {
    domain: string; display_name: string; vertical: string; theme?: string;
    brand_color?: string; daily_limit?: number; apply_preset?: boolean;
  }) => {
    const domain = args.domain.trim().toLowerCase();
    if (!domain || !args.display_name.trim() || !args.vertical.trim()) {
      throw new Error("domain, name, vertical required");
    }
    if (db.getTenant(domain)) throw new Error("tenant already exists");
    db.createTenant({
      domain, display_name: args.display_name.trim(), vertical: args.vertical.trim(),
      theme: args.theme, brand_color: args.brand_color, daily_limit: args.daily_limit,
    });
    let preset: Record<string, number> = {};
    if (args.apply_preset) preset = applyPreset(domain, args.vertical.trim());
    return { domain, preset };
  });
  ipcMain.handle("tenants:update", (_e, domain: string, fields: Record<string, unknown>) => {
    db.updateTenant(domain, fields);
    return db.getTenant(domain);
  });
  ipcMain.handle("tenants:delete", (_e, domain: string) => {
    db.deleteTenant(domain);
    return true;
  });

  // Axes
  ipcMain.handle("axes:list", (_e, tenant: string) => db.listAxes(tenant));
  ipcMain.handle("axes:replace", (_e, args: {
    tenant: string; axis: Axis;
    values: { value: string; weight?: number; monthly_search_volume?: number | null; competition_kd?: number | null }[];
  }) => {
    db.bulkReplaceAxis(args);
    return db.listAxes(args.tenant);
  });
  ipcMain.handle("axes:applyPreset", (_e, args: { tenant: string; preset_key: string }) => {
    const summary = applyPreset(args.tenant, args.preset_key);
    return { summary, axes: db.listAxes(args.tenant) };
  });
  ipcMain.handle("axes:aiFill", async (_e, args: {
    tenant: string; vertical: string; context?: string;
    provider?: Provider; model?: string; timeout_sec?: number;
  }) => {
    const summary = await generateAxesViaAi(args);
    return { summary, axes: db.listAxes(args.tenant) };
  });
  ipcMain.handle("axes:presets", () => PRESET_KEYS);

  // Slots
  ipcMain.handle("slots:list", (_e, args: {
    tenant: string; status?: string | null; template?: string | null; limit?: number;
  }) => db.listSlots(args as Parameters<typeof db.listSlots>[0]));
  ipcMain.handle("slots:count", (_e, tenant: string) => db.countSlots(tenant));
  ipcMain.handle("slots:generate", (_e, args: { tenant: string; max_per_template?: number }) => {
    return generateSlotsForTenant(args.tenant, { max_per_template: args.max_per_template });
  });
  ipcMain.handle("slots:delete", (_e, args: { tenant: string; slot_id: string }) => {
    db.deleteSlot(args.slot_id, args.tenant);
    return true;
  });
  ipcMain.handle("slots:reset", (_e, slot_id: string) => {
    db.updateSlotStatus(slot_id, "planned", null);
    return true;
  });

  // Posts
  ipcMain.handle("posts:list", (_e, args: { tenant: string; status?: string | null; limit?: number }) =>
    db.listPosts(args as Parameters<typeof db.listPosts>[0]));
  ipcMain.handle("posts:get", (_e, post_id: string) => db.getPost(post_id));
  ipcMain.handle("posts:delete", (_e, post_id: string) => {
    db.deletePost(post_id);
    return true;
  });

  // Export
  ipcMain.handle("posts:export", async (_e, args: {
    tenant: string; post_ids: string[]; format?: ExportFormat;
  }) => {
    if (args.post_ids.length === 0) return { count: 0, dir: null };
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog(focused!, {
      properties: ["openDirectory", "createDirectory"],
      title: "Export 위치 선택",
      defaultPath: app.getPath("documents"),
    });
    if (picked.canceled || picked.filePaths.length === 0) return { count: 0, dir: null };
    const outDir = join(picked.filePaths[0], args.tenant);
    await mkdir(outDir, { recursive: true });

    const format = args.format ?? "plain";
    const tenantMeta = db.getTenant(args.tenant);
    const brandName = tenantMeta?.display_name?.trim() || "운전면허플러스";
    const metaIndex: Array<Record<string, unknown>> = [];
    let count = 0;
    for (const pid of args.post_ids) {
      const post = db.getPost(pid);
      if (!post || post.tenant !== args.tenant) continue;
      const file = join(outDir, `${post.slug}.${format === "html" ? "html" : "md"}`);
      const body = formatPost(post, format, brandName);
      await writeFile(file, body, "utf-8");
      metaIndex.push({
        id: post.id,
        slug: post.slug,
        title: post.title,
        meta_description: post.meta_description,
        design_template_id: post.design_template_id,
        provider: post.provider,
        model: post.model,
        cost_usd: post.cost_usd,
        generated_at: post.generated_at,
      });
      count += 1;
    }
    await writeFile(join(outDir, "_meta.json"), JSON.stringify(metaIndex, null, 2), "utf-8");
    return { count, dir: outDir };
  });

  // Jobs
  ipcMain.handle("jobs:enqueue", (_e, args: { tenant: string; payload: GeneratePayload }) => {
    if (args.payload.provider !== "claude" && args.payload.provider !== "codex") {
      throw new Error("invalid provider");
    }
    if (!args.payload.slot_ids?.length) throw new Error("no slots selected");
    const tenant = db.getTenant(args.tenant);
    const payload: GeneratePayload = {
      ...args.payload,
      design_template_id: args.payload.design_template_id ?? tenant?.design_template_id ?? "editorial",
    };
    return db.enqueueJob({ tenant: args.tenant, kind: "generate", payload });
  });
  ipcMain.handle("jobs:enqueueDedup", (_e, args: { tenant: string; payload?: DedupPayload }) => {
    if (!db.getTenant(args.tenant)) throw new Error("unknown tenant");
    const payload: DedupPayload = {
      threshold: args.payload?.threshold ?? 0.75,
      dry_run: args.payload?.dry_run ?? false,
    };
    return db.enqueueJob({ tenant: args.tenant, kind: "dedup", payload });
  });
  ipcMain.handle("jobs:enqueuePrune", (_e, args: { tenant: string; payload?: PrunePayload }) => {
    if (!db.getTenant(args.tenant)) throw new Error("unknown tenant");
    const payload: PrunePayload = {
      min_body_chars: args.payload?.min_body_chars ?? 700,
      stale_noindex_days: args.payload?.stale_noindex_days ?? 90,
      dry_run: args.payload?.dry_run ?? false,
    };
    return db.enqueueJob({ tenant: args.tenant, kind: "prune", payload });
  });
  ipcMain.handle("jobs:list", (_e, args: { tenant?: string | null; status?: JobStatus | null; limit?: number }) =>
    db.listJobs(args ?? {}));
  ipcMain.handle("jobs:cancel", (_e, job_id: string) => db.cancelJob(job_id));

  // Metadata
  ipcMain.handle("meta:templates", () => ALL_TEMPLATES);
  ipcMain.handle("meta:templateSpecs", () => TEMPLATES);
  ipcMain.handle("meta:dbPath", () => db.dbPath());
}

function formatPost(post: Post, format: ExportFormat, brandName = "운전면허플러스"): string {
  const body = post.body_markdown;
  if (format === "html") return renderDesignedHtml(post, brandName);
  if (format === "hugo") {
    const fm = [
      "---",
      `title: ${JSON.stringify(post.title)}`,
      post.meta_description ? `description: ${JSON.stringify(post.meta_description)}` : null,
      `date: ${post.generated_at}`,
      `slug: ${post.slug}`,
      `designTemplate: ${post.design_template_id ?? "editorial"}`,
      "---",
      "",
    ].filter(Boolean).join("\n");
    return fm + body;
  }
  if (format === "next") {
    const fm = [
      "---",
      `title: ${JSON.stringify(post.title)}`,
      post.meta_description ? `description: ${JSON.stringify(post.meta_description)}` : null,
      `slug: ${post.slug}`,
      `generatedAt: ${post.generated_at}`,
      `designTemplate: ${post.design_template_id ?? "editorial"}`,
      "---",
      "",
    ].filter(Boolean).join("\n");
    return fm + body;
  }
  return body;
}

function renderDesignedHtml(post: Post, brandName: string): string {
  const design = post.design_template_id ?? "editorial";
  const body = renderMarkdownHtml(post.body_markdown, design);
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(post.title)}</title>
  ${post.meta_description ? `<meta name="description" content="${escapeHtml(post.meta_description)}">` : ""}
  <meta name="design-template" content="${escapeHtml(design)}">
  <style>${designedHtmlCss(design)}</style>
</head>
<body class="theme-${escapeHtml(design)}">
  <main class="page">
    <article class="post">
      <section class="top-cta">
        <div><strong>${escapeHtml(brandName)}와 함께라면</strong><br>면허 합격은 시간 문제!</div>
        <a class="top-button" href="#">나도 도전하기</a>
      </section>
      ${renderImageSlot("blog main image", true)}
      <header class="post-header">
        <div class="chips"><span>${escapeHtml(designLabel(design))}</span><span>정보성</span></div>
        <h1>${escapeHtml(post.title)}</h1>
        <div class="meta">${escapeHtml(formatDate(post.generated_at))} <span class="dot"></span> 댓글 0</div>
        <div class="special-divider"><i></i><b></b><i></i></div>
      </header>
      <div class="content">${body}</div>
      <section class="bottom-cta">
        <strong>${escapeHtml(brandName)}에서 운전학원 정보를 확인해보세요!</strong>
        <p>주변 학원 정보와 예약 가능 시간을 확인해보세요.</p>
        <a href="#">내 근처 학원 찾기</a>
      </section>
    </article>
  </main>
</body>
</html>`;
}

function renderMarkdownHtml(markdown: string, design: string): string {
  const lines = markdown.split(/\r?\n/);
  let html = "";
  let list: "ul" | "ol" | null = null;
  let paragraph: string[] = [];

  let tableBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html += `<p>${inlineMarkdown(escapeHtml(paragraph.join(" ")))}</p>`;
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    html += `</${list}>`;
    list = null;
  };
  const flushTable = () => {
    if (tableBuf.length === 0) return;
    html += renderMarkdownTable(tableBuf);
    tableBuf = [];
  };
  const isTableRow = (line: string) => /^\|.*\|$/.test(line);

  for (const raw of lines) {
    const line = raw.trim();
    // 실제 마크다운 표(|...|) 버퍼링
    if (isTableRow(line)) { flushParagraph(); closeList(); tableBuf.push(line); continue; }
    if (tableBuf.length) flushTable();
    if (!line) { flushParagraph(); closeList(); continue; }
    const image = line.match(/^\[IMAGE_SLOT:\s*([^\]]+)\]$/);
    const table = line.match(/^\[TABLE_SLOT:\s*([^\]]+)\]$/);
    const internal = line.match(/^\[INTERNAL_LINK:\s*([^\]]+)\]$/);
    if (image) { flushParagraph(); closeList(); html += renderImageSlot(image[1], false); continue; }
    if (table) { flushParagraph(); closeList(); html += renderTableSlot(table[1]); continue; }
    if (internal) { flushParagraph(); closeList(); html += renderInternalLink(internal[1], design); continue; }
    if (line.startsWith("# ")) continue;
    if (line.startsWith("## ")) {
      flushParagraph(); closeList();
      const title = line.slice(3);
      const isRef = /^참고\s*자료/.test(title);
      html += `<h2${isRef ? ' class="references-title"' : ""}>${escapeHtml(title)}<span class="h2-line"></span></h2>`;
      continue;
    }
    if (line.startsWith("### ")) { flushParagraph(); closeList(); html += `<h3>${escapeHtml(line.slice(4))}</h3>`; continue; }
    if (line.startsWith(">")) { flushParagraph(); closeList(); html += `<blockquote>${inlineMarkdown(escapeHtml(line.replace(/^>\s*/, "")))}</blockquote>`; continue; }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inlineMarkdown(escapeHtml(bullet[1]))}</li>`;
      continue;
    }
    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inlineMarkdown(escapeHtml(ordered[1]))}</li>`;
      continue;
    }
    paragraph.push(line);
  }
  flushTable();
  flushParagraph();
  closeList();
  return html;
}

// LLM이 생성한 실제 마크다운 표(|...|)를 HTML <table>로 변환. 구분행(|---|)은 헤더 경계로 처리.
function renderMarkdownTable(rows: string[]): string {
  const cells = (row: string): string[] =>
    row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const isSeparator = (row: string): boolean => /^\|?[\s:|-]+\|?$/.test(row) && row.includes("-");

  let headerCells: string[] | null = null;
  const bodyRows: string[][] = [];
  for (const row of rows) {
    if (isSeparator(row)) continue;
    const c = cells(row);
    if (!headerCells) headerCells = c;
    else bodyRows.push(c);
  }
  if (!headerCells) return "";

  const thead = `<thead><tr>${headerCells.map((c) => `<th>${inlineMarkdown(escapeHtml(c))}</th>`).join("")}</tr></thead>`;
  const tbody = bodyRows.length
    ? `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdown(escapeHtml(c))}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<div class="md-table"><table>${thead}${tbody}</table></div>`;
}

function renderImageSlot(label: string, hero: boolean): string {
  if (hero) {
    return `<div class="hero-image"><div class="image-chip">${escapeHtml(label)}</div><div class="hero-block"></div></div>`;
  }
  return `<figure class="image-slot"><div class="image-plus">+</div><figcaption><strong>이미지 슬롯</strong><span>${escapeHtml(imageSlotTitle(label))}</span><small>${escapeHtml(label)}</small></figcaption></figure>`;
}

function renderTableSlot(label: string): string {
  return `<section class="table-slot"><h3>${escapeHtml(label.replace(/_/g, " "))}</h3><table><thead><tr><th>기준</th><th>확인 포인트</th><th>메모</th></tr></thead><tbody><tr><td>가격</td><td>총비용 포함 여부</td><td>상담 시 확인</td></tr><tr><td>셔틀</td><td>노선/배차 시간</td><td>지역별 상이</td></tr><tr><td>일정</td><td>주말/야간 가능 여부</td><td>예약 전 확인</td></tr></tbody></table></section>`;
}

function renderInternalLink(label: string, design: string): string {
  return `<aside class="internal-link ${escapeHtml(design)}"><strong>자연스러운 CTA</strong><p>${escapeHtml(label)} 관련 정보로 이어집니다.</p><a href="#">상담/예약으로 연결</a></aside>`;
}

function designedHtmlCss(design: string): string {
  const accent = design === "local-guide" ? "#059669" : design === "comparison" ? "#2563eb" : design === "checklist" ? "#facc15" : design === "conversion" ? "#5132d7" : "#5132d7";
  const pageBg = design === "local-guide" ? "#f0fdf4" : design === "comparison" ? "#f8fafc" : design === "checklist" ? "#fefce8" : design === "conversion" ? "#f5f3ff" : "#fbfaf8";
  return `
*{box-sizing:border-box}body{margin:0;background:${pageBg};color:#242424;font-family:Pretendard,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.8}.page{width:100%;padding:48px 20px}.post{max-width:860px;margin:0 auto;background:#fff;border:1px solid #e7e5e4;border-radius:18px;overflow:hidden;box-shadow:0 10px 35px rgba(15,23,42,.06)}.top-cta{display:flex;align-items:center;justify-content:space-between;gap:16px;background:${accent};color:#fff;padding:24px 32px;font-size:15px;line-height:1.6}.top-button{display:inline-flex;background:#ffe64d;color:#18181b;text-decoration:none;font-weight:800;border-radius:12px;padding:10px 18px;white-space:nowrap}.hero-image{margin:42px auto 0;width:calc(100% - 64px);aspect-ratio:16/9;border-radius:18px;padding:28px;background:linear-gradient(135deg,#d9dcff,#fff4c4,#ffe66b);position:relative}.hero-image:before{content:"";display:block;width:76px;height:64px;border-radius:12px;background:rgba(255,255,255,.72)}.hero-block{position:absolute;right:34px;bottom:34px;width:130px;height:86px;border-radius:16px;background:rgba(81,50,215,.8)}.image-chip{position:absolute;left:34px;bottom:40px;background:rgba(255,255,255,.85);border-radius:999px;padding:5px 15px;font-size:12px;color:#5132d7;font-weight:800}.post-header{padding:54px 44px 24px;text-align:center}.chips{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:18px}.chips span{border:1px solid #ddd6d1;border-radius:999px;padding:5px 12px;font-size:12px;color:#57534e}h1{font-size:34px;line-height:1.42;margin:0;font-weight:900;letter-spacing:0}.meta{margin-top:18px;font-size:13px;color:#a1a1aa}.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#c4c4c4;margin:0 6px}.special-divider{display:flex;align-items:center;gap:16px;margin:34px auto 0}.special-divider i{height:1px;background:#e5e7eb;flex:1}.special-divider b{width:70px;height:7px;border-radius:999px;background:#ffe64d}.content{padding:0 56px 52px}.content p{font-size:17px;margin:24px 0}.content h2{font-size:27px;line-height:1.35;margin:54px 0 18px;font-weight:900}.h2-line{display:block;width:74px;height:4px;border-radius:999px;background:${accent};margin-top:13px}.content h3{font-size:21px;margin:32px 0 12px}.content ul,.content ol{padding-left:24px;margin:24px 0}.content li{margin:8px 0}.content blockquote{margin:30px 0;padding:18px 22px;border-left:5px solid ${accent};background:#fafafa;border-radius:0 12px 12px 0;color:#444}.image-slot{display:flex;gap:18px;align-items:center;border:1px dashed #d4d4d8;background:#fafafa;border-radius:16px;padding:22px;margin:34px 0}.image-plus{width:62px;height:62px;display:flex;align-items:center;justify-content:center;border-radius:14px;background:#fff;border:1px solid #e5e7eb;font-size:24px;color:#a1a1aa}.image-slot strong,.image-slot span,.image-slot small{display:block}.image-slot span{font-size:14px;font-weight:800}.image-slot small{font-size:12px;color:#71717a}.table-slot{margin:36px 0;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden}.table-slot h3{margin:0;padding:14px 18px;background:#f5f3ff;font-size:16px}.table-slot table{width:100%;border-collapse:collapse;font-size:14px}.table-slot th,.table-slot td{border-top:1px solid #e5e7eb;padding:12px;text-align:left}.table-slot th{background:#fafafa}.internal-link,.bottom-cta{margin:36px 0;border-radius:18px;padding:24px;background:#202020;color:#fff}.internal-link a,.bottom-cta a{display:inline-flex;margin-top:12px;background:#ffe64d;color:#18181b;text-decoration:none;font-weight:800;border-radius:10px;padding:10px 14px}.bottom-cta{margin:0 56px 56px}.bottom-cta p{margin:8px 0 0;color:#e5e5e5}@media(max-width:720px){.page{padding:0}.post{border-radius:0;border-left:0;border-right:0}.top-cta{padding:18px 20px}.hero-image{width:calc(100% - 32px);margin-top:28px}.post-header{padding:38px 24px 20px}h1{font-size:25px}.content{padding:0 24px 40px}.content p{font-size:15px}.content h2{font-size:22px}.bottom-cta{margin:0 24px 40px}.hero-block{width:96px;height:64px}}.content .md-table{margin:30px 0;overflow-x:auto;border:1px solid #e5e7eb;border-radius:14px}.content .md-table table{width:100%;border-collapse:collapse;font-size:15px}.content .md-table th,.content .md-table td{border-top:1px solid #eee;border-left:1px solid #f1f1f1;padding:12px 14px;text-align:left}.content .md-table th{background:#faf9ff;font-weight:800}.content .md-table tr:nth-child(even) td{background:#fcfcfd}sup.cite{color:${accent};font-weight:700;font-size:11px;margin-left:1px}h2.references-title{font-size:20px;margin-top:48px;color:#52525b}h2.references-title + ol,h2.references-title ~ ol{font-size:13px;color:#71717a;line-height:1.7}.content h2.references-title ~ ol a,.content a{color:${accent};text-decoration:underline;word-break:break-all}`;
}

function inlineMarkdown(html: string): string {
  return html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // 마크다운 링크 [텍스트](url) → 앵커. http(s) URL만 허용.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="nofollow noopener" target="_blank">$1</a>')
    // 맨 URL(참고자료의 '제목 — URL' 형식) 자동 링크화. 앞에 따옴표/괄호/= 가 오면(이미 앵커 내부) 제외.
    .replace(/(^|[\s—\-–])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" rel="nofollow noopener" target="_blank">$2</a>')
    // 본문에 남은 출처 번호 [1] → 위첨자 강조
    .replace(/\[(\d+)\]/g, '<sup class="cite">[$1]</sup>');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: string): string {
  return value.split(" ")[0]?.replace(/^20/, "").replace(/-/g, ".") ?? value;
}

function designLabel(id: string): string {
  const labels: Record<string, string> = {
    editorial: "브랜드 매거진",
    comparison: "BEST 비교 블로그",
    "local-guide": "지역 추천 블로그",
    checklist: "체크리스트 블로그",
    conversion: "예약 전환 블로그",
    custom: "직접 디자인",
  };
  return labels[id] ?? id;
}

function imageSlotTitle(label: string): string {
  const normalized = label.toLowerCase();
  if (normalized.includes("shuttle")) return "셔틀 노선이나 통학 동선을 보여줄 이미지";
  if (normalized.includes("exterior")) return "학원 외관 또는 입구 이미지";
  if (normalized.includes("interior")) return "상담실이나 교육장 내부 이미지";
  if (normalized.includes("course")) return "장내 기능 코스나 연습장 이미지";
  if (normalized.includes("car")) return "교육 차량 이미지";
  if (normalized.includes("price")) return "가격표나 비용 비교 이미지";
  if (normalized.includes("map")) return "위치나 주변 동선 이미지";
  return "본문 이해를 돕는 보조 이미지";
}
