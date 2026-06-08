import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardContent } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@renderer/components/ui/table";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Badge } from "@renderer/components/ui/badge";
import { useToast } from "@renderer/components/toast";
import GenerateDialog from "@renderer/components/GenerateDialog";
import { Boxes, Rocket } from "lucide-react";
import type { Tenant, Slot, SlotStatus, Provider } from "@shared/types";

const STATUS_LABEL: Record<SlotStatus, string> = {
  planned: "대기", in_progress: "진행 중", published: "발행됨", failed: "실패", pruned: "정리됨",
};

const STATUS_VARIANT: Record<SlotStatus, "secondary" | "default" | "success" | "warning" | "destructive" | "outline"> = {
  planned: "secondary", in_progress: "warning", published: "success", failed: "destructive", pruned: "outline",
};

export default function SlotsTab({ tenant, onAfter }: { tenant: Tenant; onAfter: () => void }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("planned");
  const [templateFilter, setTemplateFilter] = useState<string>("__all__");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxPerTemplate, setMaxPerTemplate] = useState("200");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [templates, setTemplates] = useState<string[]>([]);
  const [sampleBusy, setSampleBusy] = useState(false);
  const [provider, setProvider] = useState<Provider>("claude");
  const [model, setModel] = useState("");
  const [useWebResearch, setUseWebResearch] = useState(true);
  const [cooldown, setCooldown] = useState("60");
  const [timeout, setTimeoutSec] = useState("600");
  const { toast } = useToast();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const list = await window.api.slots.list({
      tenant: tenant.domain,
      status: statusFilter || null,
      template: templateFilter && templateFilter !== "__all__" ? templateFilter : null,
      limit: 500,
    });
    setSlots(list);
  }, [tenant.domain, statusFilter, templateFilter]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { window.api.meta.templates().then(setTemplates); }, []);

  const filtered = useMemo(() => {
    if (!keyword.trim()) return slots;
    const k = keyword.toLowerCase();
    return slots.filter((s) => s.primary_keyword.toLowerCase().includes(k) || s.slot_id.toLowerCase().includes(k));
  }, [slots, keyword]);

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.slot_id)));
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function generateSlots() {
    const summary = await window.api.slots.generate({
      tenant: tenant.domain, max_per_template: parseInt(maxPerTemplate, 10) || 200,
    });
    toast({
      title: "글 후보 생성됨",
      description: Object.entries(summary)
        .filter(([k]) => !k.startsWith("_"))
        .map(([k, v]) => `${k}:${v}`)
        .join(" / "),
      variant: "success",
    });
    refresh();
    onAfter();
  }

  async function makeSamplePost() {
    setSampleBusy(true);
    try {
      let planned = await window.api.slots.list({
        tenant: tenant.domain,
        status: "planned",
        template: null,
        limit: 1,
      });
      if (planned.length === 0) {
        await window.api.slots.generate({ tenant: tenant.domain, max_per_template: 1 });
        planned = await window.api.slots.list({
          tenant: tenant.domain,
          status: "planned",
          template: null,
          limit: 1,
        });
      }
      const first = planned[0];
      if (!first) {
        toast({
          title: "예시를 만들 재료가 부족합니다",
          description: "기획/재료 탭에서 지역, 키워드 같은 글 재료를 먼저 입력하세요.",
          variant: "destructive",
        });
        return;
      }
      const jobId = await window.api.jobs.enqueue({
        tenant: tenant.domain,
        payload: {
          slot_ids: [first.slot_id],
          provider,
          model: model.trim(),
          design_template_id: tenant.design_template_id,
          use_web_research: useWebResearch,
          cooldown_sec: 0,
          timeout_sec: parseInt(timeout, 10) || 600,
        },
      });
      toast({
        title: "예시 글 1개 작성 시작",
        description: `${first.primary_keyword} / ${provider}${model.trim() ? ` ${model.trim()}` : ""} / ${tenant.design_template_id} / 웹자료 ${useWebResearch ? "사용" : "미사용"}`,
        variant: "success",
      });
      onAfter();
      navigate(`/jobs?job=${jobId}`);
    } catch (err) {
      toast({ title: "예시 글 작성 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSampleBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}개 글 후보를 삭제할까요?`)) return;
    for (const id of selected) {
      await window.api.slots.remove({ tenant: tenant.domain, slot_id: id });
    }
    setSelected(new Set());
    refresh();
    onAfter();
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Boxes className="h-4 w-4" /> 글 후보 만들기
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[140px_180px_180px_150px_150px]">
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">글 유형마다 최대</label>
              <Input
                type="number" value={maxPerTemplate}
                onChange={(e) => setMaxPerTemplate(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">작성 엔진</label>
              <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">모델 (선택)</label>
              <Input
                placeholder={provider === "claude" ? "예: sonnet" : "예: gpt-5"}
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">대량 대기시간</label>
              <Input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <label className="text-xs text-muted-foreground">글 1개 제한시간</label>
              <Input type="number" value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={generateSlots}>재료로 글 후보 만들기</Button>
            <Button variant="secondary" onClick={makeSamplePost} disabled={sampleBusy}>
              <Rocket className="h-4 w-4" />
              {sampleBusy ? "예시 준비 중..." : `예시 글 1개 만들기 (${provider})`}
            </Button>
            <label className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
              <Checkbox checked={useWebResearch} onCheckedChange={(v) => setUseWebResearch(Boolean(v))} />
              웹 자료 수집 후 작성
            </label>
            <p className="text-xs text-muted-foreground">
              선택한 작성 엔진과 웹자료 옵션이 예시 글과 대량 작성 작업 큐에 그대로 들어갑니다.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-36"><SelectValue placeholder="상태" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">전체 상태</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={templateFilter} onValueChange={setTemplateFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="글 유형" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">전체 글 유형</SelectItem>
            {templates.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="키워드 검색..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-56"
        />

        <div className="ml-auto flex gap-2">
          <span className="text-sm text-muted-foreground self-center">
            {selected.size}개 선택 / {filtered.length}개
          </span>
          <Button
            size="sm" variant="outline" disabled={selected.size === 0} onClick={deleteSelected}
          >삭제</Button>
          <Button
            size="sm"
            disabled={selected.size === 0 || statusFilter === "published"}
            onClick={() => setDialogOpen(true)}
          >
            <Rocket className="h-4 w-4 mr-1" />
            {selected.size > 0 ? `${selected.size}개 글 작성` : "글 작성"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <Checkbox
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onCheckedChange={toggleAll}
                />
              </TableHead>
              <TableHead className="w-20">글 유형</TableHead>
              <TableHead>키워드</TableHead>
              <TableHead className="w-20">지역</TableHead>
              <TableHead className="w-24">페르소나</TableHead>
              <TableHead className="w-20">점수</TableHead>
              <TableHead className="w-20">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">아직 글 후보가 없습니다.</TableCell></TableRow>
            )}
            {filtered.slice(0, 300).map((s) => (
              <TableRow key={s.slot_id} data-state={selected.has(s.slot_id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox checked={selected.has(s.slot_id)} onCheckedChange={() => toggle(s.slot_id)} />
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px]">{s.template_id}</Badge>
                </TableCell>
                <TableCell className="font-medium truncate max-w-xs">{s.primary_keyword}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.region ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{s.persona ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono">{s.priority_score?.toFixed(1) ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[s.status]} className="text-[10px]">{STATUS_LABEL[s.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {filtered.length > 300 && (
        <p className="text-xs text-muted-foreground text-center">
          {filtered.length}개 중 300개만 표시. 필터를 좁히세요.
        </p>
      )}

      <GenerateDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tenant={tenant.domain}
        slotIds={Array.from(selected)}
        defaultProvider={provider}
        defaultModel={model}
        designTemplateId={tenant.design_template_id}
        defaultUseWebResearch={useWebResearch}
        defaultCooldown={cooldown}
        defaultTimeout={timeout}
        onQueued={() => { setSelected(new Set()); refresh(); }}
      />
    </div>
  );
}
