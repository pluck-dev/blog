import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { ArrowRight, Sparkles, Boxes, Rocket, FileText, LayoutTemplate, ClipboardList } from "lucide-react";
import { getDesignTemplatePreset } from "@shared/designTemplates";
import type { Tenant, SlotCounts } from "@shared/types";

export default function OverviewTab({
  tenant, counts, onGoto,
}: {
  tenant: Tenant;
  counts: SlotCounts;
  onGoto: (tab: string) => void;
}) {
  const totalSlots = counts.planned + counts.in_progress + counts.published + counts.failed + counts.pruned;
  const nextStep = computeNextStep(tenant, counts);
  const designTemplate = getDesignTemplatePreset(tenant.design_template_id);
  const contentTemplates = parseTemplates(tenant.templates_enabled);

  return (
    <div className="space-y-6 max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" />
            다음 단계
          </CardTitle>
          <CardDescription>{nextStep.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => onGoto(nextStep.tab)}>
            {nextStep.label} <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <BigStat icon={<Boxes className="h-4 w-4" />} label="전체 후보" value={totalSlots} />
        <BigStat icon={<Boxes className="h-4 w-4" />} label="대기 후보" value={counts.planned} />
        <BigStat icon={<Rocket className="h-4 w-4" />} label="진행 중" value={counts.in_progress} accent />
        <BigStat icon={<FileText className="h-4 w-4" />} label="완성 글" value={counts.published} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardList className="h-4 w-4" />
            양산 기획
          </div>
          <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
            {tenant.content_brief || "아직 기획 메모가 없습니다. 어떤 글을 대량으로 만들지 먼저 적어두면 운영자가 헷갈리지 않습니다."}
          </p>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => onGoto("plan")}>기획 열기</Button>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LayoutTemplate className="h-4 w-4" />
            글 유형/디자인 설정
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            글 유형 {contentTemplates.length}개 사용 중 · 디자인은 {designTemplate.name}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {contentTemplates.map((tpl) => (
              <span key={tpl} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{tpl}</span>
            ))}
          </div>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => onGoto("templates")}>글 유형 고르기</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">워크플로우</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3 text-sm">
            <Step n={1} label="무슨 글을 만들지 정하기" hint="지역, 키워드, 타깃을 입력" done={!!tenant.content_brief} />
            <Step n={2} label="글 유형과 디자인 고르기" hint="어떤 모양의 글로 만들지 선택" done={contentTemplates.length > 0} />
            <Step n={3} label="글 후보 만들기" hint="입력값 조합으로 작성 후보 생성" done={totalSlots > 0} />
            <Step n={4} label="후보 선택 → 글 작성" hint="claude / codex로 완성 글 생성" done={counts.published > 0} />
            <Step n={5} label="완성 글 확인 + 내보내기" hint="markdown / hugo / next" done={false} />
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ n, label, hint, done }: { n: number; label: string; hint: string; done: boolean }) {
  return (
    <li className="flex items-center gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>
        {n}
      </div>
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
    </li>
  );
}

function BigStat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span>{label}</span>
      </div>
      <div className={accent ? "mt-2 text-2xl font-bold text-amber-500" : "mt-2 text-2xl font-bold"}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function computeNextStep(_t: Tenant, counts: SlotCounts) {
  const totalSlots = counts.planned + counts.in_progress + counts.published + counts.failed + counts.pruned;
  if (!_t.content_brief) {
    return {
      label: "기획부터 입력",
      description: "어떤 글을 대량으로 만들지 먼저 정하면 글 유형과 후보 만들기가 쉬워집니다.",
      tab: "plan",
    };
  }
  if (parseTemplates(_t.templates_enabled).length === 0) {
    return {
      label: "글 유형 선택",
      description: "사용할 글 유형과 디자인을 선택하세요.",
      tab: "templates",
    };
  }
  if (totalSlots === 0) {
    return {
      label: "글 후보 만들기",
      description: "기획과 글 유형이 준비됐습니다. 이제 작성할 글 후보를 만들 수 있습니다.",
      tab: "slots",
    };
  }
  if (counts.planned > 0 && counts.published === 0) {
    return {
      label: "후보에서 글 작성 시작",
      description: `대기 중인 글 후보가 ${counts.planned}개 있습니다. 먼저 예시 1개를 만들어본 뒤 대량 작성하세요.`,
      tab: "slots",
    };
  }
  if (counts.published > 0) {
    return {
      label: "완성 글 보기",
      description: `${counts.published}개 글이 완성됐습니다. 미리보기와 내보내기가 가능합니다.`,
      tab: "posts",
    };
  }
  return {
    label: "글 후보 페이지",
    description: "다음 작업을 선택하세요.",
    tab: "slots",
  };
}

function parseTemplates(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // fall through
  }
  return [];
}
