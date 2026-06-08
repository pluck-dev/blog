import { useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@renderer/components/ui/card";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { useToast } from "@renderer/components/toast";
import { Trash2 } from "lucide-react";
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
