import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Button } from "@renderer/components/ui/button";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { useToast } from "@renderer/components/toast";
import { Rocket } from "lucide-react";
import type { DesignTemplateId, Provider } from "@shared/types";

export default function GenerateDialog({
  open, onOpenChange, tenant, slotIds, onQueued,
  defaultProvider = "claude",
  defaultModel = "",
  designTemplateId = "editorial",
  defaultUseWebResearch = true,
  defaultCooldown = "60",
  defaultTimeout = "600",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenant: string;
  slotIds: string[];
  onQueued: () => void;
  defaultProvider?: Provider;
  defaultModel?: string;
  designTemplateId?: DesignTemplateId;
  defaultUseWebResearch?: boolean;
  defaultCooldown?: string;
  defaultTimeout?: string;
}) {
  const [provider, setProvider] = useState<Provider>(defaultProvider);
  const [model, setModel] = useState(defaultModel);
  const [useWebResearch, setUseWebResearch] = useState(defaultUseWebResearch);
  const [cooldown, setCooldown] = useState(defaultCooldown);
  const [timeout, setTimeoutSec] = useState(defaultTimeout);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const cooldownValue = parseInt(cooldown, 10) || 60;
  const expectedMinutes = Math.ceil((slotIds.length * (cooldownValue + 30)) / 60);

  useEffect(() => {
    if (!open) return;
    setProvider(defaultProvider);
    setModel(defaultModel);
    setUseWebResearch(defaultUseWebResearch);
    setCooldown(defaultCooldown);
    setTimeoutSec(defaultTimeout);
  }, [open, defaultProvider, defaultModel, defaultUseWebResearch, defaultCooldown, defaultTimeout]);

  async function submit() {
    setBusy(true);
    try {
      const jobId = await window.api.jobs.enqueue({
        tenant,
        payload: {
          slot_ids: slotIds,
          provider,
          model: model.trim(),
          design_template_id: designTemplateId,
          use_web_research: useWebResearch,
          cooldown_sec: parseInt(cooldown, 10) || 60,
          timeout_sec: parseInt(timeout, 10) || 600,
        },
      });
      toast({
        title: "작업 큐잉됨",
        description: `${slotIds.length}개 글 후보 / ${provider}${model ? ` ${model}` : ""} / ${designTemplateId} / 웹자료 ${useWebResearch ? "사용" : "미사용"}`,
        variant: "success",
      });
      onOpenChange(false);
      onQueued();
      navigate(`/jobs?job=${jobId}`);
    } catch (err) {
      toast({ title: "큐잉 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            글 작성 시작 ({slotIds.length}개 후보)
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>작성 엔진</Label>
              <Select value={provider} onValueChange={(v) => setProvider(v as Provider)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">Claude</SelectItem>
                  <SelectItem value="codex">Codex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>모델 (선택)</Label>
              <Input
                placeholder={provider === "claude" ? "예: sonnet" : "예: gpt-5"}
                value={model} onChange={(e) => setModel(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>글 사이 대기시간 (초)</Label>
              <Input type="number" value={cooldown} onChange={(e) => setCooldown(e.target.value)} />
              <p className="text-[11px] text-muted-foreground">API 제한을 피하기 위한 쉬는 시간입니다.</p>
            </div>
            <div className="grid gap-2">
              <Label>글 1개 최대 작성시간 (초)</Label>
              <Input type="number" value={timeout} onChange={(e) => setTimeoutSec(e.target.value)} />
            </div>
          </div>
          <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-xs leading-5">
            <Checkbox
              checked={useWebResearch}
              onCheckedChange={(v) => setUseWebResearch(Boolean(v))}
              className="mt-0.5"
            />
            <span>
              <strong className="text-foreground">웹 자료 수집 후 작성</strong>
              <span className="block text-muted-foreground">
                검색 결과와 실제 페이지 발췌에 있는 상호명/주소/가격/셔틀만 쓰게 합니다.
              </span>
            </span>
          </label>
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            예상 시간: 약 <strong>{expectedMinutes}분</strong>
            {" "}(글 1개당 평균 30초 + 대기시간 가정). 작업은 백그라운드 진행됩니다.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button onClick={submit} disabled={busy || slotIds.length === 0}>
            {busy ? "준비 중..." : "글 작성 시작"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
