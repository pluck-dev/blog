import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Separator } from "@renderer/components/ui/separator";
import { useToast } from "@renderer/components/toast";
import {
  ArrowLeft, Trash2, Download,
  Copy, List, Share2, ChevronUp,
  MessageCircle,
} from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { getDesignTemplatePreset } from "@shared/designTemplates";
import type { DesignTemplateId, Post, Tenant } from "@shared/types";

const TEMPLATE_LABEL: Record<string, string> = {
  T01: "지역 BEST 5", T02: "단일 업체 소개",
  T03: "가이드 총정리", T04: "옵션 비교",
  T05: "비용 절약 전략", T06: "시험 BEST 5", T07: "허브 페이지",
};

const TEMPLATE_COLOR: Record<string, { badge: string; gradient: string; accent: string }> = {
  T01: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    gradient: "from-amber-100 via-orange-50 to-rose-50 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-rose-950/40",
    accent: "bg-amber-500",
  },
  T02: {
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    gradient: "from-sky-100 via-blue-50 to-cyan-50 dark:from-sky-950/40 dark:via-blue-950/30 dark:to-cyan-950/40",
    accent: "bg-sky-500",
  },
  T03: {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    gradient: "from-emerald-100 via-teal-50 to-green-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-green-950/40",
    accent: "bg-emerald-500",
  },
  T04: {
    badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
    gradient: "from-fuchsia-100 via-pink-50 to-purple-50 dark:from-fuchsia-950/40 dark:via-pink-950/30 dark:to-purple-950/40",
    accent: "bg-fuchsia-500",
  },
  T05: {
    badge: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    gradient: "from-rose-100 via-red-50 to-orange-50 dark:from-rose-950/40 dark:via-red-950/30 dark:to-orange-950/40",
    accent: "bg-rose-500",
  },
  T06: {
    badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
    gradient: "from-indigo-100 via-blue-50 to-violet-50 dark:from-indigo-950/40 dark:via-blue-950/30 dark:to-violet-950/40",
    accent: "bg-indigo-500",
  },
  T07: {
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
    gradient: "from-violet-100 via-purple-50 to-fuchsia-50 dark:from-violet-950/40 dark:via-purple-950/30 dark:to-fuchsia-950/40",
    accent: "bg-violet-500",
  },
};

const DEFAULT_COLOR = {
  badge: "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
  gradient: "from-zinc-100 via-zinc-50 to-zinc-50 dark:from-zinc-900/60 dark:via-zinc-950/40 dark:to-zinc-950/40",
  accent: "bg-zinc-500",
};

const DESIGN_COLOR: Record<DesignTemplateId, { badge: string; gradient: string; accent: string }> = {
  editorial: {
    badge: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
    gradient: "from-violet-100 via-indigo-50 to-amber-50 dark:from-violet-950/40 dark:via-indigo-950/30 dark:to-amber-950/30",
    accent: "bg-violet-600",
  },
  comparison: {
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    gradient: "from-blue-100 via-sky-50 to-emerald-50 dark:from-blue-950/40 dark:via-sky-950/30 dark:to-emerald-950/30",
    accent: "bg-blue-600",
  },
  "local-guide": {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    gradient: "from-emerald-100 via-lime-50 to-sky-50 dark:from-emerald-950/40 dark:via-lime-950/20 dark:to-sky-950/30",
    accent: "bg-emerald-600",
  },
  checklist: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    gradient: "from-amber-100 via-yellow-50 to-stone-50 dark:from-amber-950/40 dark:via-yellow-950/20 dark:to-stone-950/30",
    accent: "bg-amber-500",
  },
  conversion: {
    badge: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-200",
    gradient: "from-fuchsia-100 via-violet-50 to-yellow-50 dark:from-fuchsia-950/40 dark:via-violet-950/30 dark:to-yellow-950/20",
    accent: "bg-fuchsia-600",
  },
  custom: DEFAULT_COLOR,
};

type DesignChrome = {
  page: string;
  topBand: string;
  topTitle: string;
  topAction: string;
  headerWidth: string;
  headerAlign: string;
  hero: string;
  article: string;
  prose: string;
  aside: string;
  bottomCta: string;
};

const DESIGN_CHROME: Record<DesignTemplateId, DesignChrome> = {
  editorial: {
    page: "bg-[#fbfaf8] dark:bg-zinc-950",
    topBand: "bg-[#5132d7] text-white",
    topTitle: "브랜드와 함께라면 면허 합격은 시간 문제!",
    topAction: "나도 도전하기",
    headerWidth: "max-w-3xl",
    headerAlign: "text-center",
    hero: "mx-auto mt-8 aspect-video max-w-2xl rounded-2xl bg-[linear-gradient(135deg,#d9dcff,#fff4c4)] p-8 shadow-sm",
    article: "rounded-[18px] bg-white px-6 py-8 shadow-sm ring-1 ring-zinc-200/70 dark:bg-zinc-950 dark:ring-zinc-800",
    prose: "prose-h2:border-b-0 prose-h2:relative prose-h2:after:mt-3 prose-h2:after:block prose-h2:after:h-[3px] prose-h2:after:w-16 prose-h2:after:rounded-full prose-h2:after:bg-[#5132d7] prose-blockquote:border-[#5132d7] prose-blockquote:bg-violet-50/60 dark:prose-blockquote:bg-violet-950/20",
    aside: "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-zinc-200/70 dark:bg-zinc-950 dark:ring-zinc-800",
    bottomCta: "border-[#ffd84d] bg-[#fffbea]",
  },
  comparison: {
    page: "bg-slate-50 dark:bg-slate-950",
    topBand: "bg-slate-950 text-white",
    topTitle: "비교 기준부터 빠르게 보고 결정하세요",
    topAction: "BEST 비교",
    headerWidth: "max-w-5xl",
    headerAlign: "text-left",
    hero: "mt-8 grid min-h-[170px] rounded-xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900/50 dark:bg-slate-950 sm:grid-cols-3",
    article: "rounded-xl border bg-white px-6 py-8 dark:bg-slate-950",
    prose: "prose-h2:border-blue-200 prose-table:ring-1 prose-table:ring-blue-100 prose-th:bg-blue-50 dark:prose-th:bg-blue-950/30 prose-blockquote:border-blue-500 prose-blockquote:bg-blue-50/60 dark:prose-blockquote:bg-blue-950/20",
    aside: "rounded-xl border bg-white p-4 dark:bg-slate-950",
    bottomCta: "border-blue-200 bg-blue-50/70 dark:bg-blue-950/20",
  },
  "local-guide": {
    page: "bg-emerald-50/30 dark:bg-zinc-950",
    topBand: "bg-emerald-700 text-white",
    topTitle: "내 동선에 맞는 가까운 학원을 먼저 확인하세요",
    topAction: "지역 보기",
    headerWidth: "max-w-4xl",
    headerAlign: "text-left",
    hero: "mt-8 rounded-2xl border-2 border-dashed border-emerald-300 bg-white p-6 shadow-sm dark:border-emerald-900 dark:bg-zinc-950",
    article: "rounded-2xl border border-emerald-200 bg-white px-6 py-8 dark:border-emerald-900 dark:bg-zinc-950",
    prose: "prose-h2:border-dashed prose-h2:border-emerald-300 prose-a:text-emerald-700 dark:prose-a:text-emerald-300 prose-blockquote:border-emerald-500 prose-blockquote:bg-emerald-50/70 dark:prose-blockquote:bg-emerald-950/20",
    aside: "rounded-2xl border border-emerald-200 bg-white p-4 dark:border-emerald-900 dark:bg-zinc-950",
    bottomCta: "border-emerald-200 bg-emerald-50/80 dark:bg-emerald-950/20",
  },
  checklist: {
    page: "bg-yellow-50/30 dark:bg-zinc-950",
    topBand: "bg-zinc-950 text-yellow-200",
    topTitle: "등록 전 체크할 것만 빠르게 정리했습니다",
    topAction: "체크하기",
    headerWidth: "max-w-3xl",
    headerAlign: "text-left",
    hero: "mt-8 rounded-xl border-l-8 border-yellow-400 bg-white p-6 shadow-sm dark:bg-zinc-950",
    article: "rounded-xl border bg-white px-6 py-8 shadow-sm dark:bg-zinc-950",
    prose: "prose-h2:border-yellow-300 prose-h2:bg-yellow-50 prose-h2:px-3 prose-h2:py-2 prose-h2:rounded-lg dark:prose-h2:bg-yellow-950/20 prose-blockquote:border-yellow-500 prose-blockquote:bg-yellow-50/70 dark:prose-blockquote:bg-yellow-950/20",
    aside: "rounded-xl border bg-white p-4 shadow-sm dark:bg-zinc-950",
    bottomCta: "border-yellow-300 bg-yellow-50/90 dark:bg-yellow-950/20",
  },
  conversion: {
    page: "bg-violet-50/40 dark:bg-zinc-950",
    topBand: "bg-[#30137a] text-white",
    topTitle: "지금 예약 가능한 학원을 바로 비교하세요",
    topAction: "예약 찾기",
    headerWidth: "max-w-5xl",
    headerAlign: "text-left",
    hero: "mt-8 rounded-[18px] bg-[#5132d7] p-6 text-white shadow-lg",
    article: "rounded-[18px] bg-white px-6 py-8 shadow-md ring-1 ring-violet-100 dark:bg-zinc-950 dark:ring-violet-950",
    prose: "prose-h2:border-violet-200 prose-h2:text-violet-950 dark:prose-h2:text-violet-100 prose-a:text-violet-700 dark:prose-a:text-violet-300 prose-blockquote:border-violet-600 prose-blockquote:bg-violet-50/80 dark:prose-blockquote:bg-violet-950/20",
    aside: "rounded-[18px] bg-white p-4 shadow-md ring-1 ring-violet-100 dark:bg-zinc-950 dark:ring-violet-950",
    bottomCta: "border-[#5132d7] bg-[#fff7c2]",
  },
  custom: {
    page: "bg-zinc-50 dark:bg-zinc-950",
    topBand: "bg-zinc-900 text-white",
    topTitle: "선택한 구성으로 완성된 글입니다",
    topAction: "확인하기",
    headerWidth: "max-w-3xl",
    headerAlign: "text-left",
    hero: "mt-8 rounded-xl border bg-white p-6 dark:bg-zinc-950",
    article: "rounded-xl border bg-white px-6 py-8 dark:bg-zinc-950",
    prose: "",
    aside: "rounded-xl border bg-white p-4 dark:bg-zinc-950",
    bottomCta: "border-zinc-200 bg-zinc-50 dark:bg-zinc-900",
  },
};

function templateOfSlot(slug: string | null | undefined): string | undefined {
  const m = slug?.match(/^(T\d{2})_/);
  return m?.[1];
}

function slugify(text: string): string {
  return text.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/(\*\*\d+[.)]\s*[^*\n]+\*\*)[ \t]+(?=\S)/g, "$1\n\n")
    .replace(/(\*\*[^*\n]+:\*\*)[ \t]+(?=\S)/g, "$1\n\n");
}

function extractHeadings(text: string): { id: string; text: string; level: 2 | 3 }[] {
  const out: { id: string; text: string; level: 2 | 3 }[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      const t = line.slice(3).trim();
      out.push({ id: slugify(t), text: t, level: 2 });
    } else if (line.startsWith("### ")) {
      const t = line.slice(4).trim();
      out.push({ id: slugify(t), text: t, level: 3 });
    }
  }
  return out;
}

export default function PostDetail() {
  const { domain, postId } = useParams<{ domain: string; postId: string }>();
  const decoded = domain ? decodeURIComponent(domain) : "";
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [err, setErr] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [activeHeading, setActiveHeading] = useState<string>("");
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (!postId) { setState("notfound"); return; }
    if (!window.api?.posts) { setState("error"); setErr("preload api 미노출"); return; }
    Promise.all([
      window.api.posts.get(postId),
      decoded ? window.api.tenants.get(decoded) : Promise.resolve(null),
    ])
      .then(([p, t]) => {
        if (p) {
          setPost(p);
          setTenant(t);
          setState("ready");
        } else {
          setState("notfound");
        }
      })
      .catch((e) => { setState("error"); setErr((e as Error).message ?? String(e)); });
  }, [decoded, postId]);

  // scroll progress + active heading
  useEffect(() => {
    if (state !== "ready") return;
    const scroller = scrollerRef.current?.closest("main") ?? document.scrollingElement;
    const target = scroller as HTMLElement | null;
    if (!target) return;

    const onScroll = () => {
      const total = target.scrollHeight - target.clientHeight;
      const ratio = total > 0 ? target.scrollTop / total : 0;
      setProgress(Math.min(100, Math.max(0, ratio * 100)));

      const headings = Array.from(document.querySelectorAll<HTMLElement>("article h2[id], article h3[id]"));
      let current = "";
      for (const h of headings) {
        if (h.getBoundingClientRect().top < 120) current = h.id;
        else break;
      }
      setActiveHeading(current);
    };
    target.addEventListener("scroll", onScroll);
    onScroll();
    return () => target.removeEventListener("scroll", onScroll);
  }, [state]);

  const normalized = useMemo(
    () => (post ? normalizeMarkdown(post.body_markdown) : ""),
    [post],
  );
  const headings = useMemo(() => (post ? extractHeadings(normalized) : []), [post, normalized]);

  if (state === "loading") {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        로딩 중...
        <div className="text-[11px] font-mono mt-1">post={postId}</div>
      </div>
    );
  }
  if (state === "notfound") {
    return (
      <div className="p-8 max-w-xl">
        <h2 className="text-lg font-bold">글을 찾을 수 없습니다</h2>
        <p className="text-sm text-muted-foreground mt-2">
          요청한 글 <code className="px-1 bg-muted rounded">{postId}</code> 가 DB 에 없습니다.
        </p>
        <Link to={`/t/${encodeURIComponent(decoded)}?tab=posts`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-3">
          <ArrowLeft className="h-4 w-4" /> 글 목록으로
        </Link>
      </div>
    );
  }
  if (state === "error" || !post) {
    return (
      <div className="p-8 max-w-xl">
        <h2 className="text-lg font-bold text-destructive">불러오기 실패</h2>
        <p className="text-sm text-muted-foreground mt-2">{err || "알 수 없는 오류"}</p>
      </div>
    );
  }

  async function remove() {
    if (!confirm("이 글을 삭제할까요?")) return;
    await window.api.posts.remove(post!.id);
    toast({ title: "삭제됨" });
    navigate(`/t/${encodeURIComponent(decoded)}?tab=posts`);
  }

  async function exportOne() {
    const res = await window.api.posts.exportToDir({
      tenant: decoded, post_ids: [post!.id], format: "html",
    });
    if (res.dir) toast({ title: "Export 완료", description: res.dir, variant: "success" });
  }

  async function copyMarkdown() {
    await navigator.clipboard.writeText(post!.body_markdown);
    toast({ title: "Markdown 복사됨", variant: "success" });
  }

  function scrollTop() {
    const scroller = scrollerRef.current?.closest("main");
    scroller?.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jumpTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const tmpl = templateOfSlot(post.slot_id);
  const tmplLabel = tmpl ? TEMPLATE_LABEL[tmpl] ?? tmpl : null;
  const design = getDesignTemplatePreset(post.design_template_id ?? tenant?.design_template_id);
  const brandName = tenant?.display_name?.trim() || "운전면허플러스";
  const color = DESIGN_COLOR[design.id] ?? (tmpl ? TEMPLATE_COLOR[tmpl] ?? DEFAULT_COLOR : DEFAULT_COLOR);
  const dateOnly = post.generated_at?.split(" ")[0] ?? "";
  const displayDate = dateOnly ? dateOnly.replace(/^20/, "").replace(/-/g, ".") : "";

  return (
    <div ref={scrollerRef} className={cn("min-h-full", DESIGN_CHROME[design.id]?.page)}>
      {/* 읽기 진행률 바 (sticky 상단) */}
      <div className="sticky top-0 z-20">
        <div className={cn("h-0.5 transition-all", color.accent)} style={{ width: `${progress}%` }} />
      </div>

      {/* 툴바 */}
      <div className="sticky top-0.5 z-10 backdrop-blur-md bg-background/80 border-b">
        <div className="max-w-6xl mx-auto px-6 lg:px-8 h-12 flex items-center justify-between">
          <Link to={`/t/${encodeURIComponent(decoded)}?tab=posts`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors min-w-0">
            <ArrowLeft className="h-4 w-4 shrink-0" />
            <span className="font-medium truncate max-w-[180px]">{decoded}</span>
            <span className="text-xs hidden sm:inline">/ 글 목록</span>
          </Link>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={copyMarkdown}>
              <Copy className="h-3.5 w-3.5 mr-1" /> 복사
            </Button>
            <Button size="sm" variant="ghost" onClick={exportOne}>
              <Download className="h-3.5 w-3.5 mr-1" /> Export
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} className="text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,860px)_340px] xl:justify-center">
          <article className={cn("overflow-hidden rounded-[18px] bg-white shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800", DESIGN_CHROME[design.id]?.article)}>
            <div className={cn("flex items-center justify-between px-4 py-4", DESIGN_CHROME[design.id]?.topBand)}>
              <div className="text-[13px] font-bold leading-5">
                <p className="mb-0">{brandName}와 함께라면</p>
                <p className="mb-0">면허 합격은 시간 문제!</p>
              </div>
              <div className="rounded-xl bg-[#ffe64d] px-4 py-2 text-xs font-bold text-zinc-900">나도 도전하기</div>
            </div>

            <div className="px-4 pt-6">
              <DesignImageSlot designId={design.id} label="blog main image" hero />
            </div>

            <header className="px-6 pb-4 pt-8 text-center">
              <div className="mb-3 flex flex-wrap justify-center gap-1.5">
                {tmplLabel && <Badge variant="outline" className="rounded-full text-[10px]">{tmplLabel}</Badge>}
                <Badge variant="outline" className="rounded-full text-[10px]">{design.name}</Badge>
              </div>
              <h1 className="text-[24px] font-extrabold leading-[1.45] tracking-normal text-zinc-950 dark:text-zinc-50 sm:text-[32px]">
                {post.title}
              </h1>
              <div className="mt-4 flex items-center justify-center gap-3 text-xs text-zinc-400">
                <span>{displayDate}</span>
                <span className="inline-flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5 fill-zinc-300 text-zinc-300" />0</span>
              </div>
              <SpecialDivider designId={design.id} />
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <span className="rounded-full border px-3 py-1 text-[11px] text-zinc-500">가이드</span>
                <span className="rounded-full border px-3 py-1 text-[11px] text-zinc-500">FAQ</span>
                <span className="rounded-full border px-3 py-1 text-[11px] text-zinc-500">정보성</span>
              </div>
            </header>

          <div
            className={cn(
              `
              prose prose-zinc max-w-none px-6 pb-8 dark:prose-invert
              prose-headings:font-bold prose-headings:tracking-tight prose-headings:scroll-mt-24
              prose-h1:hidden
              prose-h2:text-[21px] sm:prose-h2:text-[26px] prose-h2:mt-10 prose-h2:mb-4 prose-h2:pb-0 prose-h2:border-b-0
              prose-h3:text-[18px] sm:prose-h3:text-[21px] prose-h3:mt-7 prose-h3:mb-3
              prose-h4:text-[16px] prose-h4:mt-5 prose-h4:mb-2
              prose-p:leading-[1.9] prose-p:my-5 prose-p:text-[15px] sm:prose-p:text-[16px]
              prose-li:my-1.5 prose-li:leading-relaxed
              prose-ul:my-5 prose-ol:my-5
              prose-a:text-[#5132d7] dark:prose-a:text-violet-300 prose-a:font-medium prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground prose-strong:font-bold
              prose-em:text-foreground/90
              prose-table:my-6 prose-table:text-sm
              prose-th:bg-zinc-100 dark:prose-th:bg-zinc-800/60 prose-th:font-semibold prose-th:px-4 prose-th:py-2
              prose-td:px-4 prose-td:py-2 prose-td:border-zinc-200 dark:prose-td:border-zinc-800
              prose-tr:border-zinc-200 dark:prose-tr:border-zinc-800
              prose-img:rounded-xl prose-img:shadow-md prose-img:my-6
              prose-blockquote:border-l-4 prose-blockquote:border-amber-400 prose-blockquote:bg-amber-50/40 dark:prose-blockquote:bg-amber-950/20 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r prose-blockquote:not-italic prose-blockquote:font-medium
              prose-code:before:content-none prose-code:after:content-none prose-code:px-1.5 prose-code:py-0.5 prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:rounded prose-code:text-[0.875em] prose-code:font-mono
              prose-hr:my-10 prose-hr:border-zinc-200 dark:prose-hr:border-zinc-800
            `,
              DESIGN_CHROME[design.id]?.prose,
            )}
          >
            <ReactMarkdown
              remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
              components={{
                p: ({ children }) => {
                  const text = flattenText(children);
                  const image = text.match(/^\[IMAGE_SLOT:\s*([^\]]+)\]$/);
                  if (image) return <DesignImageSlot designId={design.id} label={image[1]} />;
                  const table = text.match(/^\[TABLE_SLOT:\s*([^\]]+)\]$/);
                  if (table) return <DesignTableSlot designId={design.id} label={table[1]} />;
                  const link = text.match(/^\[INTERNAL_LINK:\s*([^\]]+)\]$/);
                  if (link) return <DesignInternalLink designId={design.id} label={link[1]} />;
                  return <p>{children}</p>;
                },
                h2: ({ children, ...rest }) => {
                  const t = String(children);
                  return <h2 id={slugify(t)} {...rest}>{children}<SpecialDivider designId={design.id} compact /></h2>;
                },
                h3: ({ children, ...rest }) => {
                  const t = String(children);
                  return <h3 id={slugify(t)} {...rest}>{children}</h3>;
                },
              }}
            >
              {normalized}
            </ReactMarkdown>
          </div>

          {/* 본문 끝 공유 + 액션 */}
          <Separator className="mx-6 my-6" />
          <div className={cn("mx-6 mb-6 rounded-2xl border p-5", DESIGN_CHROME[design.id]?.bottomCta)}>
            <div className="flex items-center gap-2 text-sm font-semibold mb-3">
              <Share2 className="h-4 w-4" />
              이 글로 할 수 있는 것
            </div>
            <div className="grid sm:grid-cols-3 gap-2">
              <Button variant="outline" onClick={copyMarkdown} className="justify-start">
                <Copy className="h-4 w-4 mr-2" />
                Markdown 복사
              </Button>
              <Button variant="outline" onClick={exportOne} className="justify-start">
                <Download className="h-4 w-4 mr-2" />
                파일로 내보내기
              </Button>
              <Link to={`/t/${encodeURIComponent(decoded)}?tab=posts`}>
                <Button variant="outline" className="w-full justify-start">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  글 목록으로
                </Button>
              </Link>
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              💡 <strong>이 글은 자동 생성된 상태</strong>입니다 — 아직 외부 검색에 노출되지 않습니다.
              [파일로 내보내기]는 디자인이 포함된 HTML로 저장되고, Markdown 복사는 CMS 편집용 원문입니다.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-2 items-center">
            {tmplLabel && <Badge variant="outline" className="text-[10px]">{tmplLabel}</Badge>}
            <Badge variant="outline" className="text-[10px] font-mono">{post.slug}</Badge>
            <Badge variant="outline" className="text-[10px]">{decoded}</Badge>
          </div>
        </article>

        <aside className="hidden xl:block">
          <div className={cn("sticky top-20 space-y-6", DESIGN_CHROME[design.id]?.aside)}>
            <div>
              <div className="text-xs font-semibold text-muted-foreground">적용된 디자인</div>
              <div className="mt-1 text-lg font-bold">{design.name}</div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{design.summary}</p>
            </div>
            {headings.length > 0 && (
              <nav className="text-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  <List className="h-3 w-3" />
                  목차
                </div>
                <ul className="space-y-1 border-l border-zinc-200 dark:border-zinc-800">
                  {headings.map((h) => (
                    <li key={h.id} className={cn(h.level === 3 && "ml-3")}>
                      <button
                        onClick={() => jumpTo(h.id)}
                        className={cn(
                          "block w-full text-left pl-3 -ml-px py-1 border-l-2 border-transparent text-muted-foreground hover:text-foreground hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors text-[13px] leading-snug",
                          activeHeading === h.id && "border-zinc-900 dark:border-zinc-100 text-foreground font-medium",
                          h.level === 3 && "text-[12px]",
                        )}
                      >
                        {h.text}
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            )}

            <button
              onClick={scrollTop}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronUp className="h-3 w-3" />
              맨 위로
            </button>
          </div>
        </aside>
        </div>
      </div>
    </div>
  );
}

function flattenText(children: ReactNode): string {
  if (typeof children === "string") return children.trim();
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join("").trim();
  return "";
}

function SpecialDivider({ designId, compact }: { designId: DesignTemplateId; compact?: boolean }) {
  const color = designId === "conversion" ? "bg-[#5132d7]" : designId === "checklist" ? "bg-[#ffe64d]" : designId === "local-guide" ? "bg-emerald-500" : designId === "comparison" ? "bg-blue-500" : "bg-[#ffe64d]";
  return (
    <div className={cn("mx-auto flex items-center gap-3", compact ? "mt-2" : "mt-6")}>
      <div className="h-px flex-1 bg-zinc-200" />
      <div className={cn("h-1.5 w-14 rounded-full", color)} />
      <div className="h-px flex-1 bg-zinc-200" />
    </div>
  );
}

function DesignImageSlot({ designId, label, hero }: { designId: DesignTemplateId; label: string; hero?: boolean }) {
  const cleanLabel = label.replace(/_/g, " ");
  const imageTitle = imageSlotTitle(label);
  const block = designId === "conversion"
    ? "bg-[linear-gradient(135deg,#5132d7,#ffe64d)]"
    : designId === "local-guide"
      ? "bg-[linear-gradient(135deg,#d1fae5,#e0f2fe)]"
      : designId === "comparison"
        ? "bg-[linear-gradient(135deg,#dbeafe,#ecfeff)]"
        : "bg-[linear-gradient(135deg,#d9dcff,#fff4c4,#ffe66b)]";
  if (!hero) {
    return (
      <figure className="not-prose my-6 overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50">
        <div className="flex min-h-[118px] items-center gap-4 px-4 py-5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:ring-zinc-800">
            +
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">이미지 슬롯</div>
            <div className="mt-1 text-sm font-bold text-zinc-900 dark:text-zinc-100">{imageTitle}</div>
            <figcaption className="mt-1 text-xs leading-5 text-zinc-500">
              발행 전에 실제 이미지 URL이나 업로드 이미지로 교체하세요.
              <span className="ml-1 font-mono text-[11px] text-zinc-400">{cleanLabel}</span>
            </figcaption>
          </div>
        </div>
      </figure>
    );
  }
  return (
    <div className={cn("my-5 overflow-hidden rounded-xl p-5", block, hero ? "aspect-video" : "min-h-[170px]")}>
      <div className="h-12 w-16 rounded-lg bg-white/70" />
      <div className="mt-10 flex items-end justify-between">
        <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-bold text-[#5132d7]">{cleanLabel}</span>
        <div className="h-16 w-24 rounded-xl bg-[#5132d7]/80" />
      </div>
    </div>
  );
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

function DesignTableSlot({ designId, label }: { designId: DesignTemplateId; label: string }) {
  const header = designId === "checklist" ? "bg-yellow-100" : designId === "local-guide" ? "bg-emerald-50" : designId === "comparison" ? "bg-blue-50" : "bg-violet-50";
  return (
    <div className="my-5 overflow-hidden rounded-xl border not-prose">
      <div className={cn("px-4 py-3 text-sm font-bold", header)}>{label.replace(/_/g, " ")}</div>
      <div className="grid grid-cols-3 border-t text-xs">
        <div className="border-r px-3 py-2 font-semibold">기준</div>
        <div className="border-r px-3 py-2 font-semibold">확인 포인트</div>
        <div className="px-3 py-2 font-semibold">추천</div>
        {["가격", "셔틀", "일정"].map((row) => (
          <Fragment key={row}>
            <div className="border-r border-t px-3 py-2">{row}</div>
            <div className="border-r border-t px-3 py-2">상담 전 확인</div>
            <div className="border-t px-3 py-2">높음</div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function DesignInternalLink({ designId, label }: { designId: DesignTemplateId; label: string }) {
  const bg = designId === "conversion" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-900";
  return (
    <div className={cn("not-prose my-5 rounded-xl p-4", bg)}>
      <div className="text-sm font-bold">자연스러운 CTA</div>
      <p className="mt-1 text-xs opacity-80">{label} 관련 글로 부드럽게 연결합니다.</p>
      <button className="mt-3 rounded-md bg-[#ffe64d] px-3 py-2 text-xs font-bold text-zinc-900">상담/예약으로 연결</button>
    </div>
  );
}
