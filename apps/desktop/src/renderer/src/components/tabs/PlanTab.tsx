import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { Label } from "@renderer/components/ui/label";
import { Textarea } from "@renderer/components/ui/textarea";
import { useToast } from "@renderer/components/toast";
import { ClipboardList, Save } from "lucide-react";
import type { Axis, Tenant } from "@shared/types";

const AXIS_LABEL: Record<Axis, string> = {
  region: "어느 지역 글인가요?",
  keyword: "어떤 검색어를 노릴까요?",
  intent: "사용자는 뭘 알고 싶어 하나요?",
  persona: "누구에게 말할까요?",
  modifier: "어떤 장점을 강조할까요?",
};

const AXIS_PLACEHOLDER: Record<Axis, string> = {
  region: "강남구\n송파구\n분당",
  keyword: "운전면허학원\n운전면허 비용\n도로주행 시험",
  intent: "빠른 합격\n비용 절약\n초보자 준비",
  persona: "직장인\n대학생\n장롱면허",
  modifier: "셔틀 편리\n친절한 강사\n최단기",
};

const AXES: Axis[] = ["region", "keyword", "intent", "persona", "modifier"];

export default function PlanTab({
  tenant, onSaved, onGoto,
}: {
  tenant: Tenant;
  onSaved: (t: Tenant) => void;
  onGoto: (tab: string) => void;
}) {
  const [brief, setBrief] = useState(tenant.content_brief ?? "");
  const [axisText, setAxisText] = useState<Record<Axis, string>>({
    region: "",
    keyword: "",
    intent: "",
    persona: "",
    modifier: "",
  });
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function save() {
    setBusy(true);
    try {
      await Promise.all(
        AXES.map((axis) => {
          const values = parseLines(axisText[axis]).map((value) => ({ value, weight: 3 }));
          if (values.length === 0) return Promise.resolve();
          return window.api.axes.replace({ tenant: tenant.domain, axis, values });
        }),
      );
      const next = await window.api.tenants.update(tenant.domain, { content_brief: brief.trim() });
      if (next) onSaved(next);
      toast({ title: "기획 저장됨", description: "입력한 주제 묶음으로 글 후보를 만들 수 있습니다.", variant: "success" });
    } catch (err) {
      toast({ title: "저장 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardList className="h-4 w-4" />
            양산할 글 기획
          </CardTitle>
          <CardDescription>
            만들고 싶은 글의 재료를 줄 단위로 넣으면 됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>이번에 양산할 글의 방향 / 검증된 자료</Label>
            <Textarea
              rows={6}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder={"예: 수도권 직장인이 빠르게 운전면허를 따기 위해 지역별 학원, 비용, 셔틀 여부를 비교하는 글을 만든다.\n\n검증된 학원명/주소/가격/셔틀/후기가 있으면 여기에 붙여넣으세요.\n여기에 없고 웹 자료에도 없는 상호명이나 가격은 생성하지 않습니다."}
            />
            <p className="text-xs text-muted-foreground">
              실제 데이터가 중요하면 학원명, 주소, 가격, 셔틀, 후기 원문을 여기에 넣거나 글 작성 단계에서 웹 자료 수집을 켜세요.
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {AXES.map((axis) => (
              <div key={axis} className="grid gap-2">
                <Label>{AXIS_LABEL[axis]}</Label>
                <Textarea
                  rows={5}
                  value={axisText[axis]}
                  onChange={(e) => setAxisText((prev) => ({ ...prev, [axis]: e.target.value }))}
                  placeholder={AXIS_PLACEHOLDER[axis]}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={busy}>
              <Save className="h-4 w-4" />
              {busy ? "저장 중..." : "기획 저장"}
            </Button>
            <Button variant="secondary" onClick={() => onGoto("templates")}>글 유형 고르기</Button>
            <Button variant="outline" onClick={() => onGoto("slots")}>글 후보 만들기</Button>
            <Button variant="ghost" onClick={() => onGoto("axes")}>고급 재료 편집</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function parseLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean)) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
