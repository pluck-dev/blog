import { useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Label } from "@renderer/components/ui/label";
import { Button } from "@renderer/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { useToast } from "./toast";

const VERTICALS = ["driving", "car-mapping", "gym", "academy", "general"];
const PRESET_AVAILABLE = new Set(["driving", "car-mapping", "general"]);

export default function NewTenantDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (domain: string) => void;
}) {
  const [domain, setDomain] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [vertical, setVertical] = useState("general");
  const [applyPreset, setApplyPreset] = useState(true);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  async function submit() {
    if (!domain.trim() || !displayName.trim()) {
      toast({ title: "필수 항목 누락", description: "도메인과 표시 이름이 필요합니다.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await window.api.tenants.create({
        domain: domain.trim().toLowerCase(),
        display_name: displayName.trim(),
        vertical,
        apply_preset: applyPreset && PRESET_AVAILABLE.has(vertical),
      });
      onOpenChange(false);
      setDomain(""); setDisplayName(""); setVertical("general"); setApplyPreset(true);
      onCreated(res.domain);
    } catch (err) {
      toast({
        title: "생성 실패",
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>도메인 추가</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="d-domain">도메인</Label>
            <Input
              id="d-domain"
              placeholder="예: example.co.kr"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="d-name">표시 이름</Label>
            <Input
              id="d-name"
              placeholder="예: 우리 학원"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>업종</Label>
            <Select value={vertical} onValueChange={setVertical}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {VERTICALS.map((v) => (
                  <SelectItem key={v} value={v}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={applyPreset}
              onCheckedChange={(v) => setApplyPreset(v === true)}
              disabled={!PRESET_AVAILABLE.has(vertical)}
            />
            <span className={!PRESET_AVAILABLE.has(vertical) ? "text-muted-foreground" : ""}>
              프리셋 자동 적용 (운전/맵핑/general 만 가능)
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            글 재료가 비어있는 업종은 다음 화면에서 [AI 자동 생성] 또는 [수동 입력]으로 채울 수 있습니다.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>취소</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "생성 중..." : "생성"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
