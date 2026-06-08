import { useEffect, useMemo, useState } from "react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card";
import { Label } from "@renderer/components/ui/label";
import { Textarea } from "@renderer/components/ui/textarea";
import { useToast } from "@renderer/components/toast";
import { Check, Eye, FileText, LayoutTemplate, Save } from "lucide-react";
import { cn } from "@renderer/lib/utils";
import { DESIGN_TEMPLATE_PRESETS } from "@shared/designTemplates";
import type { DesignTemplateId, Tenant } from "@shared/types";

interface ContentTemplateSpec {
  name: string;
  description?: string;
  primary: string[];
  use_persona: boolean;
  modifier_count: number;
  with_intent?: boolean;
}

export default function TemplatesTab({
  tenant, onSaved,
}: {
  tenant: Tenant;
  onSaved: (t: Tenant) => void;
}) {
  const [specs, setSpecs] = useState<Record<string, ContentTemplateSpec>>({});
  const [enabled, setEnabled] = useState<Set<string>>(() => parseEnabled(tenant.templates_enabled));
  const [designId, setDesignId] = useState<DesignTemplateId>(tenant.design_template_id ?? "editorial");
  const [customDesign, setCustomDesign] = useState(tenant.custom_design_templates ?? "");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    window.api.meta.templateSpecs().then((next) => setSpecs(next as Record<string, ContentTemplateSpec>));
  }, []);

  const contentTemplates = useMemo(() => Object.entries(specs).sort(([a], [b]) => a.localeCompare(b)), [specs]);
  const preview = getPreview(designId, customDesign);

  function toggleTemplate(id: string) {
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setEnabled(next);
  }

  async function save() {
    setBusy(true);
    try {
      const next = await window.api.tenants.update(tenant.domain, {
        templates_enabled: JSON.stringify(Array.from(enabled).sort()),
        design_template_id: designId,
        custom_design_templates: customDesign.trim(),
      });
      if (next) onSaved(next);
      toast({ title: "글 유형 저장됨", description: "새 글 후보부터 선택한 글 유형과 디자인이 적용됩니다.", variant: "success" });
    } catch (err) {
      toast({ title: "저장 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            글 유형
          </CardTitle>
          <CardDescription>
            어떤 종류의 글을 만들지 고릅니다. 너무 많이 켜면 글 후보 수가 빠르게 늘어납니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {contentTemplates.map(([id, spec]) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleTemplate(id)}
                className={cn(
                  "text-left rounded-md border p-4 transition-colors",
                  enabled.has(id) ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900" : "hover:bg-muted/50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{id}</Badge>
                      <span className="font-semibold text-sm">{spec.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">{spec.description}</p>
                  </div>
                  {enabled.has(id) && <Check className="h-4 w-4" />}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {spec.primary.map((axis) => <Badge key={axis} variant="secondary" className="text-[10px]">{axis}</Badge>)}
                  {spec.use_persona && <Badge variant="secondary" className="text-[10px]">persona</Badge>}
                  {spec.with_intent && <Badge variant="secondary" className="text-[10px]">intent</Badge>}
                  {spec.modifier_count > 0 && <Badge variant="secondary" className="text-[10px]">modifier {spec.modifier_count}</Badge>}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <LayoutTemplate className="h-4 w-4" />
            디자인
          </CardTitle>
          <CardDescription>
            완성 글의 화면 구성입니다. 아래 5개 예시 중 하나를 고르거나 직접 기준을 적을 수 있습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-4 items-start">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {DESIGN_TEMPLATE_PRESETS.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => setDesignId(tpl.id)}
                  className={cn(
                    "text-left rounded-md border p-4 min-h-[170px] transition-colors",
                    designId === tpl.id ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900" : "hover:bg-muted/50",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-sm">{tpl.name}</div>
                    {designId === tpl.id && <Check className="h-4 w-4" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{tpl.summary}</p>
                  <p className="text-[11px] mt-3">
                    <span className="text-muted-foreground">추천:</span> {tpl.bestFor}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {tpl.sections.slice(0, 4).map((section) => (
                      <Badge key={section} variant="secondary" className="text-[10px]">{section}</Badge>
                    ))}
                  </div>
                </button>
              ))}
            </div>

            <DesignPreview preview={preview} brandName={tenant.display_name} />
          </div>

          <div className="grid gap-2">
            <Label>직접 만드는 디자인 메모</Label>
            <Textarea
              rows={6}
              value={customDesign}
              onChange={(e) => {
                setCustomDesign(e.target.value);
                if (e.target.value.trim()) setDesignId("custom");
              }}
              placeholder={"예: 첫 화면에는 큰 제목과 핵심 요약 3개를 둔다.\n비교표는 본문 상단에 배치한다.\nCTA는 중간 1회, 마지막 1회만 사용한다."}
            />
          </div>

          <Button onClick={save} disabled={busy || enabled.size === 0}>
            <Save className="h-4 w-4" />
            {busy ? "저장 중..." : "글 유형/디자인 저장"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function parseEnabled(raw: string): Set<string> {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    // fall through
  }
  return new Set(["T01", "T03", "T05", "T07"]);
}

interface PreviewData {
  style: "editorial" | "comparison" | "local" | "checklist" | "conversion" | "custom";
  label: string;
  title: string;
  lead: string;
  chips: string[];
  blocks: Array<{ title: string; body: string; kind?: "table" | "quote" | "cta" | "list" }>;
}

function DesignPreview({ preview, brandName }: { preview: PreviewData; brandName: string }) {
  const theme = PREVIEW_THEME[preview.style];
  return (
    <div className="rounded-md border bg-background overflow-hidden xl:sticky xl:top-4">
      <div className="border-b bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Eye className="h-4 w-4" />
          예시글 미리보기
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">{preview.label}</p>
      </div>
      <div className="p-4">
        <div className={cn("rounded-[14px] border text-zinc-950 shadow-sm overflow-hidden", theme.shell)}>
          <div className="flex items-center justify-between bg-[#5b35d5] px-4 py-3 text-white">
            <div className="shrink-0 text-[13px] font-extrabold leading-5">
              <p className="mb-0">{brandName}와 함께라면</p>
              <p>면허 합격은 시간 문제!</p>
            </div>
            <div className="rounded-[10px] bg-[#FFE94D] px-3 py-2 text-[11px] font-black text-[#232323]">
              나도 도전하기
            </div>
          </div>
          <PreviewHero preview={preview} />
          <div className={cn("px-5 pb-5 pt-7 space-y-4", theme.body)}>
            <div className="text-center">
              <h4 className={cn("mx-auto max-w-[300px] leading-tight", theme.title)}>{preview.title}</h4>
              <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-[#8A8C88]">
                <span>26.04.03</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full bg-[#C1C2BF]" />
                  0
                </span>
              </div>
            </div>

            <SpecialDivider style={preview.style} />

            <div className="flex flex-wrap gap-1.5">
              {preview.chips.map((chip) => (
                <span key={chip} className={cn("rounded-full px-2.5 py-1 text-[10px]", theme.chip)}>{chip}</span>
              ))}
            </div>

            <p className={cn("text-[13px] leading-6", theme.lead)}>{preview.lead}</p>

            {preview.blocks.map((block) => (
              <PreviewBlock key={block.title} block={block} style={preview.style} />
            ))}

            <div className="flex gap-1.5 overflow-hidden pt-2">
              {["# 대구 운전면허", "# 셔틀", "# 합격후기"].map((tag) => (
                <span key={tag} className="whitespace-nowrap rounded-full border border-[#E5E5E5] px-2.5 py-1 text-[10px] text-[#8A8C88]">
                  {tag}
                </span>
              ))}
            </div>

            <section className="pt-5">
              <p className="text-base font-black text-[#232323]">운전학원, 이제 온라인으로 예약해보세요!</p>
              <div className="mt-4 grid gap-3">
                <WhyDtCard title="더 저렴하게!" body="최저가 보상제와 지원금으로 더 합리적으로 예약할 수 있어요." />
                <WhyDtCard title="대기 없이 원하는 시간에!" body="방문 전 원하는 시간을 고르고 바로 수업 일정을 잡을 수 있어요." />
              </div>
            </section>

            <section className="rounded-[16px] border-2 border-[#FFE94D] bg-[#FAFAF7] px-4 py-6 text-center">
              <p className="text-base font-black leading-6">
                지금 바로 <span className="text-[#5b35d5]">최저가</span>로<br />예약 가능한 학원을 찾아보세요!
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <div className="rounded-[12px] bg-white px-3 py-2 text-left text-[11px] text-[#8A8C88]">시, 도</div>
                <div className="rounded-[12px] bg-white px-3 py-2 text-left text-[11px] text-[#8A8C88]">시, 군, 구</div>
                <div className="col-span-2 rounded-[12px] bg-white px-3 py-2 text-left text-[11px] text-[#8A8C88]">동, 읍, 면, 리</div>
              </div>
              <div className="mt-3 rounded-[12px] bg-[#FFE94D] px-4 py-3 text-sm font-black text-[#232323]">내 근처 학원 찾기</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function WhyDtCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[10px] bg-[#F7F7F4] p-3">
      <div className="h-20 rounded-[8px] bg-[linear-gradient(135deg,#fff7b8,#e7e1ff_55%,#d8f5ff)]" />
      <p className="mt-3 text-sm font-black text-[#232323]">{title}</p>
      <p className="mt-1 text-[12px] leading-5 text-[#8A8C88]">{body}</p>
    </div>
  );
}

const PREVIEW_THEME: Record<PreviewData["style"], {
  shell: string;
  body: string;
  chip: string;
  title: string;
  lead: string;
  heading: string;
  copy: string;
}> = {
  editorial: {
    shell: "bg-white",
    body: "bg-white",
    chip: "border border-[#E5E5E5] text-[#8A8C88]",
    title: "text-xl font-black tracking-normal text-[#232323]",
    lead: "text-[#555753]",
    heading: "text-base font-black text-[#232323]",
    copy: "text-[#555753]",
  },
  comparison: {
    shell: "bg-white",
    body: "bg-white",
    chip: "bg-[#FFFDCC] text-[#5b35d5]",
    title: "text-xl font-black text-[#232323]",
    lead: "text-[#52645d]",
    heading: "text-base font-black text-[#232323]",
    copy: "text-[#52645d]",
  },
  local: {
    shell: "bg-white",
    body: "bg-white",
    chip: "bg-[#F2EEFF] text-[#5b35d5]",
    title: "text-xl font-black text-[#232323]",
    lead: "text-[#587088]",
    heading: "text-base font-black text-[#232323]",
    copy: "text-[#587088]",
  },
  checklist: {
    shell: "bg-white",
    body: "bg-white",
    chip: "bg-[#FAFAF7] text-[#555753]",
    title: "text-xl font-black text-[#232323]",
    lead: "text-[#606854]",
    heading: "text-base font-black text-[#232323]",
    copy: "text-[#606854]",
  },
  conversion: {
    shell: "bg-white",
    body: "bg-white",
    chip: "bg-[#5b35d5] text-white",
    title: "text-xl font-black text-[#232323]",
    lead: "text-[#555753]",
    heading: "text-base font-black text-[#232323]",
    copy: "text-[#555753]",
  },
  custom: {
    shell: "bg-white",
    body: "bg-white",
    chip: "bg-zinc-100 text-zinc-600",
    title: "text-xl font-bold text-zinc-950",
    lead: "text-zinc-600",
    heading: "text-sm font-bold text-zinc-950",
    copy: "text-zinc-600",
  },
};

function PreviewHero({ preview }: { preview: PreviewData }) {
  const overlays: Record<PreviewData["style"], string> = {
    editorial: "from-[#5b35d5]/20 via-transparent to-[#FFE94D]/35",
    comparison: "from-[#232323]/15 via-transparent to-[#FFE94D]/45",
    local: "from-[#5b35d5]/25 via-transparent to-[#7ad7ff]/35",
    checklist: "from-[#232323]/10 via-transparent to-[#FFFDCC]/75",
    conversion: "from-[#5b35d5]/35 via-transparent to-[#FFE94D]/55",
    custom: "from-zinc-900/20 via-transparent to-zinc-200/60",
  };
  return (
    <div className="px-4 pt-6">
      <div className="relative aspect-video overflow-hidden rounded-[10px] bg-[#EEEFF1]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#d8e8ff,#f6f0ff_45%,#fff4a7)]" />
        <div className={cn("absolute inset-0 bg-gradient-to-br", overlays[preview.style])} />
        <div className="absolute left-5 top-5 h-12 w-16 rounded-[8px] bg-white/70 shadow-sm" />
        <div className="absolute bottom-5 right-5 h-16 w-24 rounded-[10px] bg-[#5b35d5]/85 shadow-lg" />
        <div className="absolute bottom-5 left-5 rounded-full bg-white/85 px-3 py-1 text-[10px] font-black text-[#5b35d5]">
          blog main image
        </div>
      </div>
    </div>
  );
}

function SpecialDivider({ style }: { style: PreviewData["style"] }) {
  if (style === "editorial") {
    return (
      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-[#DADADA]" />
        <div className="h-2 w-14 rounded-full bg-[#FFE94D]" />
        <div className="h-px flex-1 bg-[#DADADA]" />
      </div>
    );
  }
  if (style === "comparison") {
    return <div className="h-[10px] rounded-full bg-[repeating-linear-gradient(90deg,#5b35d5_0,#5b35d5_20px,#FFE94D_20px,#FFE94D_32px)]" />;
  }
  if (style === "local") {
    return (
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-[#5b35d5]/35" />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFE94D] ring-4 ring-white" />
      </div>
    );
  }
  if (style === "checklist") {
    return <div className="rounded-[10px] border border-[#FFE94D] bg-[#FFFDCC] py-2 text-center text-[10px] font-black tracking-[0.16em] text-[#5b35d5]">CHECK BEFORE RESERVATION</div>;
  }
  if (style === "conversion") {
    return <div className="h-[3px] rounded-full bg-[linear-gradient(90deg,#5b35d5,#FFE94D,#5b35d5)]" />;
  }
  return <div className="h-px bg-zinc-200" />;
}

function PreviewBlock({ block, style }: { block: PreviewData["blocks"][number]; style: PreviewData["style"] }) {
  const theme = PREVIEW_THEME[style];
  if (block.kind === "table") {
    return (
      <div>
        <h5 className={theme.heading}>{block.title}</h5>
        <div className={cn("mt-2 overflow-hidden rounded border text-[11px]", style === "conversion" ? "border-white/15" : "")}>
          <div className={cn("grid grid-cols-3 font-semibold", style === "comparison" ? "bg-[#FFFDCC] text-[#232323]" : "bg-[#FAFAF7] text-zinc-950")}>
            <div className="p-2">항목</div>
            <div className="p-2">장점</div>
            <div className="p-2">추천</div>
          </div>
          <div className={cn("grid grid-cols-3 border-t", style === "conversion" ? "border-white/15 text-zinc-200" : "")}>
            <div className="p-2">A 학원</div>
            <div className="p-2">셔틀</div>
            <div className="p-2">직장인</div>
          </div>
          <div className={cn("grid grid-cols-3 border-t", style === "conversion" ? "border-white/15 text-zinc-200" : "")}>
            <div className="p-2">B 학원</div>
            <div className="p-2">단기반</div>
            <div className="p-2">대학생</div>
          </div>
        </div>
        <p className={cn("mt-2 text-xs leading-5", theme.copy)}>{block.body}</p>
      </div>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote className={cn(
        "px-3 py-2 text-xs leading-5",
        style === "editorial" && "rounded-r border-l-4 border-[#FFE94D] bg-[#FAFAF7] text-[#555753]",
        style === "local" && "rounded-r border-l-4 border-[#5b35d5] bg-[#F2EEFF] text-[#555753]",
        style === "checklist" && "rounded border border-[#FFE94D] bg-[#FFFDCC] text-[#555753]",
        style === "conversion" && "rounded-r border-l-4 border-[#FFE94D] bg-[#5b35d5] text-white",
        style === "comparison" && "rounded-r border-l-4 border-[#FFE94D] bg-[#FFFDCC] text-[#555753]",
        style === "custom" && "rounded-r border-l-4 border-[#FFE94D] bg-[#FAFAF7] text-zinc-700",
      )}>
        {block.body}
      </blockquote>
    );
  }
  if (block.kind === "cta") {
    return (
      <div className={cn(
        "rounded-md p-3",
        style === "conversion" ? "bg-[#5b35d5] text-white" : "bg-[#232323] text-white",
      )}>
        <div className="text-sm font-semibold">{block.title}</div>
        <p className={cn("mt-1 text-xs leading-5", style === "conversion" ? "text-white/80" : "text-zinc-300")}>{block.body}</p>
        <div className={cn(
          "mt-3 inline-flex rounded px-3 py-1.5 text-xs font-semibold",
          style === "conversion" ? "bg-[#FFE94D] text-[#232323]" : "bg-[#FFE94D] text-[#232323]",
        )}>상담/예약으로 연결</div>
      </div>
    );
  }
  if (block.kind === "list") {
    return (
      <div>
        <h5 className={theme.heading}>{block.title}</h5>
        <ul className={cn("mt-2 space-y-1 text-xs", theme.copy)}>
          {block.body.split("|").map((item, idx) => (
            <li key={item} className="flex gap-2">
              <span className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                style === "checklist" ? "bg-[#FFE94D] text-[#232323]" : "bg-[#F2EEFF] text-[#5b35d5]",
              )}>{style === "checklist" ? "✓" : idx + 1}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div>
      <h5 className={theme.heading}>{block.title}</h5>
      <p className={cn("mt-1 text-xs leading-5", theme.copy)}>{block.body}</p>
    </div>
  );
}

function getPreview(id: DesignTemplateId, customDesign: string): PreviewData {
  if (id === "comparison") {
    return {
      style: "comparison",
      label: "표와 선택 기준이 먼저 보이는 구성",
      title: "강남 운전면허학원 BEST 5, 비용과 셔틀까지 한 번에 비교",
      lead: "여러 학원을 하나씩 찾지 않아도 되도록 가격대, 접근성, 추천 대상을 먼저 정리합니다.",
      chips: ["비교표", "BEST5", "추천"],
      blocks: [
        { title: "비교 기준", body: "가격, 셔틀, 주말 수업, 도로주행 코스를 같은 기준으로 맞춰 비교합니다." },
        { title: "한눈에 보는 비교표", body: "표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다.", kind: "table" },
        { title: "추천 케이스", body: "시간이 부족한 직장인, 비용을 아끼려는 대학생처럼 상황별 추천을 분리합니다." },
        { title: "마지막 전환", body: "가까운 학원과 예약 가능한 시간을 확인하도록 연결합니다.", kind: "cta" },
      ],
    };
  }
  if (id === "local-guide") {
    return {
      style: "local",
      label: "지역 검색어에 맞춘 랜딩 구성",
      title: "송파에서 운전면허 준비할 때 먼저 확인할 5가지",
      lead: "동네에서 실제로 고민하는 이동 거리, 셔틀, 야간 수업 여부를 앞쪽에 배치합니다.",
      chips: ["지역 SEO", "주변", "동선"],
      blocks: [
        { title: "지역 고민", body: "송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다." },
        { title: "선택 체크", body: "집/학교와 가까운지|셔틀 시간이 맞는지|도로주행 코스가 어렵지 않은지", kind: "list" },
        { title: "실제 후기 톤", body: "퇴근 후 수업을 잡을 수 있어서 주말에 몰아서 배우는 부담이 줄었다는 식의 현실적인 후기를 넣습니다.", kind: "quote" },
        { title: "지역 CTA", body: "내 위치 기준으로 가까운 학원을 찾도록 연결합니다.", kind: "cta" },
      ],
    };
  }
  if (id === "checklist") {
    return {
      style: "checklist",
      label: "빠르게 훑고 저장하기 좋은 구성",
      title: "도로주행 시험 전날 체크리스트, 실수 줄이는 순서",
      lead: "준비물과 감점 포인트를 먼저 보여주고, 상세 설명은 아래로 이어집니다.",
      chips: ["체크리스트", "시험", "절차"],
      blocks: [
        { title: "3분 요약", body: "신분증, 시험 시간, 코스 확인처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다." },
        { title: "준비 체크", body: "신분증 챙기기|시험장 도착 시간 확인|좌석/거울 조정 연습|감점 포인트 복습", kind: "list" },
        { title: "자주 하는 실수", body: "방향지시등, 일시정지, 속도 조절처럼 반복되는 실수를 짧은 예시로 설명합니다." },
        { title: "시험 전 연결", body: "불안한 구간만 추가 연습할 수 있는 학원/강습 탐색으로 이어집니다.", kind: "cta" },
      ],
    };
  }
  if (id === "conversion") {
    return {
      style: "conversion",
      label: "상담과 예약 전환을 강조하는 구성",
      title: "운전면허 비용이 부담될 때, 단기반 선택 전에 볼 기준",
      lead: "사용자의 문제를 먼저 잡고 해결 기준, 후기, CTA가 반복되지 않게 이어집니다.",
      chips: ["상담", "예약", "비용"],
      blocks: [
        { title: "문제 공감", body: "시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다." },
        { title: "해결 기준", body: "단기반, 셔틀, 추가 비용 여부를 상담 전 질문 목록으로 정리합니다." },
        { title: "후기 배치", body: "처음엔 비용 때문에 망설였지만 상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다.", kind: "quote" },
        { title: "상담 CTA", body: "비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다.", kind: "cta" },
      ],
    };
  }
  if (id === "custom") {
    return {
      style: "custom",
      label: "직접 입력한 메모를 기준으로 잡는 구성",
      title: "내가 정한 디자인 규칙으로 만든 예시글",
      lead: customDesign.trim() || "오른쪽 메모에 원하는 화면 구조를 적으면 직접 만든 디자인 기준으로 저장됩니다.",
      chips: ["커스텀", "직접 설계"],
      blocks: [
        { title: "상단 구성", body: "제목, 핵심 요약, 대표 이미지 등 직접 적은 규칙을 발행 렌더러가 참고할 수 있게 저장합니다." },
        { title: "본문 구성", body: "표, 이미지, CTA 위치처럼 반복될 디자인 규칙을 명시합니다." },
        { title: "전환 영역", body: "상담, 예약, 내부 링크 등 마지막 행동을 어디에 둘지 정합니다.", kind: "cta" },
      ],
    };
  }
  return {
    style: "editorial",
    label: "정보성 글에 가장 무난한 매거진형 구성",
    title: "운전면허 처음 준비할 때 알아야 할 절차와 비용",
    lead: "초보자가 검색해서 들어왔을 때 필요한 배경 설명, 이미지, FAQ가 자연스럽게 이어집니다.",
    chips: ["가이드", "FAQ", "정보성"],
    blocks: [
      { title: "도입", body: "왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다." },
      { title: "핵심 설명", body: "절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다." },
      { title: "FAQ", body: "처음 등록해도 되나요?|주말에도 가능한가요?|추가 비용은 언제 생기나요?", kind: "list" },
      { title: "자연스러운 CTA", body: "주변 학원 찾기나 예약 확인으로 부드럽게 연결합니다.", kind: "cta" },
    ],
  };
}
