import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { Badge } from "@renderer/components/ui/badge";
import { useToast } from "@renderer/components/toast";
import { Sparkles, Wand2 } from "lucide-react";
import type { Tenant, AxisValue, Axis, Provider } from "@shared/types";

const AXES: Axis[] = ["region", "keyword", "intent", "persona", "modifier"];
const AXIS_LABEL: Record<Axis, string> = {
  region: "지역", keyword: "키워드", intent: "검색 의도", persona: "페르소나", modifier: "수식어",
};

export default function AxesTab({ tenant, onAxesChanged }: { tenant: Tenant; onAxesChanged: () => void }) {
  const [axes, setAxes] = useState<Record<Axis, AxisValue[]>>({
    region: [], keyword: [], intent: [], persona: [], modifier: [],
  });
  const [presets, setPresets] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiProvider, setAiProvider] = useState<Provider>("claude");
  const [aiContext, setAiContext] = useState("");
  const [presetKey, setPresetKey] = useState("");
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    const a = await window.api.axes.list(tenant.domain);
    setAxes(a);
  }, [tenant.domain]);

  useEffect(() => {
    refresh();
    window.api.axes.presets().then(setPresets);
  }, [refresh]);

  async function applyPreset() {
    if (!presetKey) return;
    const res = await window.api.axes.applyPreset({ tenant: tenant.domain, preset_key: presetKey });
    setAxes(res.axes);
    toast({ title: "프리셋 적용됨", description: Object.entries(res.summary).map(([k, v]) => `${k}=${v}`).join(", ") });
  }

  async function aiFill() {
    setAiBusy(true);
    try {
      const res = await window.api.axes.aiFill({
        tenant: tenant.domain, vertical: tenant.vertical,
        context: aiContext, provider: aiProvider,
      });
      setAxes(res.axes);
      const summary = Object.entries(res.summary).filter(([k]) => !k.startsWith("_")).map(([k, v]) => `${k}=${v}`).join(", ");
      toast({
        title: "AI 재료 생성 완료",
        description: `${summary} (${(res.summary as Record<string, unknown>)._provider} ${(res.summary as Record<string, unknown>)._duration_sec}s)`,
        variant: "success",
      });
    } catch (err) {
      toast({ title: "AI 생성 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setAiBusy(false);
      onAxesChanged();
    }
  }

  async function saveAxis(axis: Axis, csvText: string) {
    const lines = csvText.split("\n").map((l) => l.trim()).filter(Boolean);
    const values = lines.map((line) => {
      const parts = line.split(",").map((p) => p.trim());
      return {
        value: parts[0],
        weight: parts[1] ? parseInt(parts[1], 10) || 3 : 3,
        monthly_search_volume: parts[2] ? parseInt(parts[2], 10) || null : null,
        competition_kd: parts[3] ? parseInt(parts[3], 10) || null : null,
      };
    }).filter((v) => v.value);
    const next = await window.api.axes.replace({ tenant: tenant.domain, axis, values });
    setAxes(next);
    toast({ title: `${AXIS_LABEL[axis]} 저장됨`, description: `${values.length}개 값`, variant: "success" });
    onAxesChanged();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">고급 재료 편집</CardTitle>
          <p className="text-xs text-muted-foreground">
            일반적으로는 [기획] 탭만 쓰면 됩니다. 여기서는 검색량, 경쟁도, 가중치처럼 글 후보 우선순위에 쓰는 세부값을 수정합니다.
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">조정 팁</CardTitle>
          <p className="text-xs text-muted-foreground">
            후보 수가 너무 많거나 원하는 주제가 잘 안 나오면 여기서 재료의 중요도와 수치를 조정하세요.
          </p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <Tip title="입력 형식" body="한 줄에 하나씩 `값,weight,월간검색량,KD` 순서로 적습니다. 예: `대구,5,2100,38`" />
          <Tip title="weight" body="1~5 사이 중요도입니다. 꼭 쓰고 싶은 값은 5, 실험용이나 덜 중요한 값은 1~2로 낮추세요." />
          <Tip title="월간검색량" body="숫자가 높을수록 후보 점수가 올라갑니다. 정확한 수치를 모르면 비워둬도 됩니다." />
          <Tip title="KD" body="경쟁 난이도입니다. 낮을수록 쓰기 쉬운 주제로 봅니다. 보통 0~100 값으로 넣고, 모르면 비워두세요." />
          <Tip title="재료 개수" body="처음에는 각 항목을 10~30개 정도만 넣는 게 좋습니다. 너무 많이 넣으면 후보가 과하게 늘어납니다." />
          <Tip title="추천 사용법" body="지역은 실제 서비스 지역, 키워드는 검색어, 검색 의도는 비교/비용/후기, 페르소나는 직장인/대학생처럼 독자를 넣으세요." />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wand2 className="h-4 w-4" /> AI 자동 채우기
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Textarea
                placeholder="추가 컨텍스트 (선택). 예: 강남구 위주, 30대 직장인 타깃, 야간 진료..."
                value={aiContext}
                onChange={(e) => setAiContext(e.target.value)}
                rows={3}
              />
              <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as Provider)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude">claude</SelectItem>
                  <SelectItem value="codex">codex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={aiFill} disabled={aiBusy}>
              <Sparkles className="h-4 w-4 mr-1" />
              {aiBusy ? "생성 중..." : `${tenant.vertical} 글 재료 생성`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">프리셋 적용</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">미리 정의된 업종 프리셋으로 글 재료를 채웁니다.</p>
            <div className="flex gap-2">
              <Select value={presetKey} onValueChange={setPresetKey}>
                <SelectTrigger><SelectValue placeholder="프리셋 선택" /></SelectTrigger>
                <SelectContent>
                  {presets.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={applyPreset} disabled={!presetKey} variant="secondary">적용</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {AXES.map((axis) => (
          <AxisEditor key={axis} axis={axis} values={axes[axis]} onSave={(csv) => saveAxis(axis, csv)} />
        ))}
      </div>
    </div>
  );
}

function Tip({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="font-medium text-foreground">{title}</div>
      <p className="mt-1 leading-5 text-muted-foreground">{body}</p>
    </div>
  );
}

function AxisEditor({ axis, values, onSave }: { axis: Axis; values: AxisValue[]; onSave: (csv: string) => void }) {
  const initial = values.map((v) =>
    [v.value, v.weight, v.monthly_search_volume ?? "", v.competition_kd ?? ""].join(","),
  ).join("\n");
  const [text, setText] = useState(initial);

  // 외부에서 values 가 바뀌면 textarea 도 동기화
  useEffect(() => { setText(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(values)]);

  const dirty = text !== initial;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {AXIS_LABEL[axis]}
          <Badge variant="secondary" className="text-[10px]">{values.length}</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          한 줄당 한 값. 형식: <code>값,weight,월간검색량,KD</code>
        </p>
      </CardHeader>
      <CardContent>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="font-mono text-xs"
        />
        <div className="flex justify-end mt-2">
          <Button size="sm" disabled={!dirty} onClick={() => onSave(text)}>
            저장
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
