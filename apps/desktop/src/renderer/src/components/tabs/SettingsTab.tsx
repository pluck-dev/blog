import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Textarea } from "@renderer/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { useToast } from "@renderer/components/toast";
import { Trash2, KeyRound } from "lucide-react";
import type { Tenant } from "@shared/types";

const THEMES = ["clean", "modern", "pro"];
const VERTICALS = ["driving", "car-mapping", "gym", "academy", "general"];

export default function SettingsTab({
  tenant, onSaved, onDelete,
}: {
  tenant: Tenant;
  onSaved: (t: Tenant) => void;
  onDelete: () => void;
}) {
  const [displayName, setDisplayName] = useState(tenant.display_name);
  const [vertical, setVertical] = useState(tenant.vertical);
  const [theme, setTheme] = useState(tenant.theme);
  const [brandColor, setBrandColor] = useState(tenant.brand_color || "#0066ff");
  const [dailyLimit, setDailyLimit] = useState(String(tenant.daily_limit));
  const { toast } = useToast();

  // 전역 색인(Indexing) 설정
  const [hasKey, setHasKey] = useState(false);
  const [saJson, setSaJson] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("https://{domain}/{slug}");
  const [savingIdx, setSavingIdx] = useState(false);

  useEffect(() => {
    window.api.settings.getIndexing().then((cfg) => {
      setHasKey(cfg.has_key);
      setUrlTemplate(cfg.url_template);
    });
  }, []);

  async function saveIndexing() {
    setSavingIdx(true);
    try {
      const res = await window.api.settings.setIndexing({
        sa_json: saJson.trim() ? saJson : undefined, // 비우면 기존 키 유지
        url_template: urlTemplate,
      });
      setHasKey(res.has_key);
      setSaJson("");
      toast({ title: "색인 설정 저장됨", variant: "success" });
    } catch (err) {
      toast({ title: "저장 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSavingIdx(false);
    }
  }

  async function save() {
    const next = await window.api.tenants.update(tenant.domain, {
      display_name: displayName,
      vertical,
      theme,
      brand_color: brandColor,
      daily_limit: parseInt(dailyLimit, 10) || 30,
    });
    if (next) onSaved(next);
    toast({ title: "저장됨", variant: "success" });
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">메타 정보</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>도메인</Label>
            <Input value={tenant.domain} disabled />
          </div>
          <div className="grid gap-2">
            <Label>표시 이름</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>업종</Label>
              <Select value={vertical} onValueChange={setVertical}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VERTICALS.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>테마</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v as Tenant["theme"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>브랜드 컬러</Label>
              <Input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-9 w-20 p-1" />
            </div>
            <div className="grid gap-2">
              <Label>일일 한도</Label>
              <Input type="number" value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} />
            </div>
          </div>
          <Button onClick={save}>저장</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <KeyRound className="h-4 w-4" /> Google 색인(Indexing) — 전역 설정
            <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full ${hasKey ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
              {hasKey ? "키 설정됨" : "미설정"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            서비스계정 JSON 1개로 여러 사이트에 재사용할 수 있습니다. 각 사이트의 Search Console 속성에
            이 서비스계정 이메일을 <b>소유자</b>로 추가해야 실제 색인 요청이 동작합니다.
            (Indexing API는 공식적으로 JobPosting/BroadcastEvent 용도 — 일반 페이지 제출은 약관상 회색지대)
          </p>
          <div className="grid gap-2">
            <Label>서비스계정 키 (JSON 붙여넣기)</Label>
            <Textarea
              value={saJson}
              onChange={(e) => setSaJson(e.target.value)}
              placeholder={hasKey ? "(이미 저장됨 — 교체하려면 새 JSON 붙여넣기)" : '{ "client_email": "...", "private_key": "..." }'}
              className="font-mono text-xs h-28"
            />
          </div>
          <div className="grid gap-2">
            <Label>발행 URL 템플릿</Label>
            <Input value={urlTemplate} onChange={(e) => setUrlTemplate(e.target.value)} className="font-mono text-xs" />
            <span className="text-[11px] text-muted-foreground">{"{domain}"} 와 {"{slug}"} 가 각 글의 도메인·슬러그로 치환됩니다.</span>
          </div>
          <Button onClick={saveIndexing} disabled={savingIdx}>{savingIdx ? "저장 중..." : "색인 설정 저장"}</Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm text-destructive flex items-center gap-2">
            <Trash2 className="h-4 w-4" /> 위험 구역
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            이 도메인을 삭제하면 모든 글 후보/완성 글/작업 큐가 함께 영구 삭제됩니다.
          </p>
          <Button variant="destructive" onClick={onDelete}>도메인 삭제</Button>
        </CardContent>
      </Card>
    </div>
  );
}
