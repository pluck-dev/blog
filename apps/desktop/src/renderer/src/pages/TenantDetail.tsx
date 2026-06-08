import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent } from "@renderer/components/ui/tabs";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { useToast } from "@renderer/components/toast";
import { CheckCircle2, Circle, ClipboardList, Clock, Settings as SettingsIcon, SlidersHorizontal, Trash2 } from "lucide-react";
import type { Tenant, SlotCounts } from "@shared/types";
import OverviewTab from "@renderer/components/tabs/OverviewTab";
import PlanTab from "@renderer/components/tabs/PlanTab";
import TemplatesTab from "@renderer/components/tabs/TemplatesTab";
import AxesTab from "@renderer/components/tabs/AxesTab";
import SlotsTab from "@renderer/components/tabs/SlotsTab";
import PostsTab from "@renderer/components/tabs/PostsTab";
import SettingsTab from "@renderer/components/tabs/SettingsTab";

export default function TenantDetail({ onRefresh }: { onRefresh: () => void }) {
  const { domain } = useParams<{ domain: string }>();
  const decoded = domain ? decodeURIComponent(domain) : "";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [counts, setCounts] = useState<SlotCounts>({ planned: 0, in_progress: 0, published: 0, failed: 0, pruned: 0 });
  const [loadState, setLoadState] = useState<"loading" | "ready" | "notfound" | "error">("loading");
  const [errMsg, setErrMsg] = useState<string>("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    if (!decoded) {
      setLoadState("notfound");
      setErrMsg("URL 에 도메인이 없습니다.");
      return;
    }
    if (!window.api?.tenants) {
      setLoadState("error");
      setErrMsg("preload api 가 노출되지 않았습니다. 앱을 재시작하세요.");
      return;
    }
    try {
      const [t, c] = await Promise.all([
        window.api.tenants.get(decoded),
        window.api.slots.count(decoded),
      ]);
      if (!t) {
        setLoadState("notfound");
        return;
      }
      setTenant(t);
      setCounts(c);
      setLoadState("ready");
    } catch (err) {
      console.error("[TenantDetail] fetch failed", err);
      setLoadState("error");
      setErrMsg((err as Error).message ?? String(err));
    }
  }, [decoded]);

  useEffect(() => { refresh(); }, [refresh]);

  if (loadState === "loading") {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        로딩 중...
        <div className="text-[11px] font-mono mt-1">domain={decoded || "(empty)"}, hasApi={String(!!window.api?.tenants)}</div>
      </div>
    );
  }
  if (loadState === "notfound") {
    return (
      <div className="p-8 max-w-xl">
        <h2 className="text-lg font-bold">도메인을 찾을 수 없습니다</h2>
        <p className="text-sm text-muted-foreground mt-2">
          요청한 도메인 <code className="px-1 bg-muted rounded">{decoded}</code> 가 DB 에 없습니다.
          사이드바에서 다시 선택하거나 대시보드로 돌아가세요.
        </p>
      </div>
    );
  }
  if (loadState === "error" || !tenant) {
    return (
      <div className="p-8 max-w-xl">
        <h2 className="text-lg font-bold text-destructive">불러오기 실패</h2>
        <p className="text-sm text-muted-foreground mt-2">{errMsg || "알 수 없는 오류"}</p>
      </div>
    );
  }

  function setTab(value: string) {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  }

  async function deleteTenant() {
    if (!confirm(`정말 "${tenant!.domain}"을 삭제할까요? 모든 글 후보/완성 글이 함께 삭제됩니다.`)) return;
    await window.api.tenants.remove(tenant!.domain);
    toast({ title: "삭제됨", description: tenant!.domain });
    onRefresh();
    navigate("/");
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{tenant.display_name}</h1>
            <Badge variant="outline" className="text-[10px]">{tenant.vertical}</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{tenant.domain}</p>
        </div>
        <div className="flex items-center gap-2">
          <Stat label="후보" value={counts.planned} />
          <Stat label="실패" value={counts.failed} />
          <Stat label="완성" value={counts.published} accent />
          <Button
            variant="outline"
            size="sm"
            onClick={deleteTenant}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            도메인 삭제
          </Button>
        </div>
      </div>

      <WorkflowSteps
        tenant={tenant}
        counts={counts}
        activeTab={tab}
        onGoto={setTab}
        onGotoJobs={() => navigate("/jobs")}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsContent value="overview" className="mt-6">
          <OverviewTab tenant={tenant} counts={counts} onGoto={setTab} />
        </TabsContent>
        <TabsContent value="plan" className="mt-6">
          <PlanTab
            tenant={tenant}
            onGoto={setTab}
            onSaved={(t) => { setTenant(t); onRefresh(); }}
          />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesTab tenant={tenant} onSaved={(t) => { setTenant(t); onRefresh(); }} />
        </TabsContent>
        <TabsContent value="axes" className="mt-6">
          <AxesTab tenant={tenant} onAxesChanged={refresh} />
        </TabsContent>
        <TabsContent value="slots" className="mt-6">
          <SlotsTab tenant={tenant} onAfter={refresh} />
        </TabsContent>
        <TabsContent value="posts" className="mt-6">
          <PostsTab tenant={tenant} onAfter={refresh} />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <SettingsTab tenant={tenant} onSaved={(t) => { setTenant(t); onRefresh(); }} onDelete={deleteTenant} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function WorkflowSteps({
  tenant, counts, activeTab, onGoto, onGotoJobs,
}: {
  tenant: Tenant;
  counts: SlotCounts;
  activeTab: string;
  onGoto: (tab: string) => void;
  onGotoJobs: () => void;
}) {
  const totalSlots = counts.planned + counts.in_progress + counts.published + counts.failed + counts.pruned;
  const steps = [
    {
      n: 1,
      tab: "plan",
      title: "기획",
      hint: "어떤 글을 만들지 정하기",
      done: !!tenant.content_brief,
      count: tenant.content_brief ? "완료" : "필요",
    },
    {
      n: 2,
      tab: "templates",
      title: "유형/디자인",
      hint: "글 종류와 화면 구성 선택",
      done: parseTemplates(tenant.templates_enabled).length > 0,
      count: `${parseTemplates(tenant.templates_enabled).length}개`,
    },
    {
      n: 3,
      tab: "slots",
      title: "후보/작성",
      hint: "후보를 만들고 Claude/Codex 선택",
      done: totalSlots > 0,
      count: `${totalSlots}개`,
    },
    {
      n: 4,
      tab: "posts",
      title: "완성",
      hint: "완성 글 확인/내보내기",
      done: counts.published > 0,
      count: `${counts.published}개`,
    },
  ];
  const next = steps.find((s) => !s.done) ?? steps[steps.length - 1];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-sm font-semibold">작업 순서</div>
          <p className="mt-1 text-xs text-muted-foreground">
            아래 4단계만 순서대로 진행하면 됩니다. 고급 재료와 설정은 필요할 때만 여세요.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onGoto(next.tab)}>
            다음: {next.n} {next.title}
          </Button>
          <Button size="sm" variant="outline" onClick={onGotoJobs}>
            <Clock className="h-3.5 w-3.5" />
            작업 큐
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
        {steps.map((step) => {
          const active = activeTab === step.tab;
          return (
            <button
              key={step.tab}
              type="button"
              onClick={() => onGoto(step.tab)}
              className={[
                "rounded-lg border p-3 text-left transition-colors",
                active ? "border-foreground bg-muted/50" : "bg-background hover:bg-muted/30",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {step.done ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  {step.n}. {step.title}
                </div>
                <Badge variant={step.done ? "success" : "secondary"} className="text-[10px]">{step.count}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{step.hint}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button
          size="sm"
          variant={activeTab === "overview" ? "secondary" : "ghost"}
          onClick={() => onGoto("overview")}
        >
          <ClipboardList className="h-3.5 w-3.5" />
          전체 진행 보기
        </Button>
        <Button
          size="sm"
          variant={activeTab === "axes" ? "secondary" : "ghost"}
          onClick={() => onGoto("axes")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          고급 재료
        </Button>
        <Button
          size="sm"
          variant={activeTab === "settings" ? "secondary" : "ghost"}
          onClick={() => onGoto("settings")}
        >
          <SettingsIcon className="h-3.5 w-3.5" />
          설정
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="text-right px-3 py-1.5 rounded-md bg-muted/40 min-w-[60px]">
      <div className={accent ? "text-lg font-bold text-emerald-600 dark:text-emerald-400 leading-none" : "text-lg font-bold leading-none"}>
        {value.toLocaleString()}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase mt-1">{label}</div>
    </div>
  );
}

function parseTemplates(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // ignore invalid tenant config
  }
  return [];
}
