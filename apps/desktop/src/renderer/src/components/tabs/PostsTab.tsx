import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@renderer/components/ui/table";
import { Checkbox } from "@renderer/components/ui/checkbox";
import { Badge } from "@renderer/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select";
import { useToast } from "@renderer/components/toast";
import { Download, Trash2, ExternalLink, CopyCheck, Scissors, Send } from "lucide-react";
import type { ExportFormat, Tenant, PostSummary } from "@shared/types";

export default function PostsTab({ tenant, onAfter }: { tenant: Tenant; onAfter: () => void }) {
  const [posts, setPosts] = useState<PostSummary[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("html");
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const list = await window.api.posts.list({ tenant: tenant.domain, limit: 500 });
    setPosts(list);
  }, [tenant.domain]);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    if (!keyword.trim()) return posts;
    const k = keyword.toLowerCase();
    return posts.filter((p) => p.title.toLowerCase().includes(k) || p.slug.toLowerCase().includes(k));
  }, [posts, keyword]);

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => p.id)));
  }
  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function exportSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await window.api.posts.exportToDir({
        tenant: tenant.domain, post_ids: Array.from(selected), format,
      });
      if (res.dir) {
        toast({
          title: "Export 완료",
          description: `${res.count}개 → ${res.dir}`,
          variant: "success",
        });
      }
    } catch (err) {
      toast({ title: "Export 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runDedup() {
    if (!confirm(
      "발행된 글 전체를 비교해 중복(유사도 75% 이상)을 찾아 noindex 처리합니다.\n" +
      "각 중복 그룹에서 우선순위가 가장 높은 글 1개만 남깁니다. 계속할까요?",
    )) return;
    setBusy(true);
    try {
      await window.api.jobs.enqueueDedup({ tenant: tenant.domain, payload: { threshold: 0.75 } });
      toast({ title: "중복 검사 시작", description: "작업 큐에 등록됨 — 진행 상황은 작업 큐에서 확인하세요.", variant: "success" });
      navigate("/jobs");
    } catch (err) {
      toast({ title: "중복 검사 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runPrune() {
    if (!confirm(
      "약한 글과 수명이 끝난 글을 정리합니다.\n" +
      "· 본문 700자 미만 발행글 → noindex(검색에서 내림)\n" +
      "· noindex된 지 90일 넘은 글 → 삭제(410)\n" +
      "상태만 바꾸므로 되돌릴 수 있습니다. 계속할까요?",
    )) return;
    setBusy(true);
    try {
      await window.api.jobs.enqueuePrune({ tenant: tenant.domain, payload: { min_body_chars: 700, stale_noindex_days: 90 } });
      toast({ title: "가지치기 시작", description: "작업 큐에 등록됨 — 진행 상황은 작업 큐에서 확인하세요.", variant: "success" });
      navigate("/jobs");
    } catch (err) {
      toast({ title: "가지치기 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runIndexing() {
    const cfg = await window.api.settings.getIndexing();
    if (!cfg.has_key) {
      toast({
        title: "서비스계정 키 미설정",
        description: "설정 탭에서 Google 색인 키(JSON)를 먼저 등록하세요.",
        variant: "destructive",
      });
      return;
    }
    const targetIds = selected.size > 0 ? Array.from(selected) : undefined;
    const scope = targetIds ? `선택 ${targetIds.length}건` : "발행글 전체";
    if (!confirm(`Google 색인 요청을 보냅니다 (${scope}).\nURL 템플릿: ${cfg.url_template}\n하루 쿼터(기본 200건)를 넘기면 보류됩니다. 계속할까요?`)) return;
    setBusy(true);
    try {
      await window.api.jobs.enqueueIndexing({ tenant: tenant.domain, payload: { post_ids: targetIds } });
      toast({ title: "색인 요청 시작", description: "작업 큐에서 진행 상황을 확인하세요.", variant: "success" });
      navigate("/jobs");
    } catch (err) {
      toast({ title: "색인 요청 실패", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}개 완성 글을 삭제할까요? 연결된 글 후보는 다시 대기 상태로 돌아갑니다.`)) return;
    for (const id of selected) await window.api.posts.remove(id);
    setSelected(new Set());
    refresh();
    onAfter();
  }

  async function deleteOne(post: PostSummary) {
    if (!confirm(`"${post.title}" 글을 삭제할까요? 연결된 글 후보는 다시 대기 상태로 돌아갑니다.`)) return;
    await window.api.posts.remove(post.id);
    toast({ title: "완성 글 삭제됨", description: post.title });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(post.id);
      return next;
    });
    refresh();
    onAfter();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="제목/슬러그 검색..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-56"
        />
        <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="html">디자인 HTML</SelectItem>
            <SelectItem value="plain">Markdown</SelectItem>
            <SelectItem value="hugo">Hugo</SelectItem>
            <SelectItem value="next">Next.js MDX</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex gap-2">
          <span className="text-sm text-muted-foreground self-center">
            {selected.size}개 선택 / {filtered.length}개
          </span>
          <Button size="sm" variant="outline" onClick={runDedup} disabled={busy || posts.length < 2}>
            <CopyCheck className="h-3.5 w-3.5 mr-1" /> 중복 검사
          </Button>
          <Button size="sm" variant="outline" onClick={runPrune} disabled={busy || posts.length === 0}>
            <Scissors className="h-3.5 w-3.5 mr-1" /> 가지치기
          </Button>
          <Button size="sm" variant="outline" onClick={runIndexing} disabled={busy || posts.length === 0}>
            <Send className="h-3.5 w-3.5 mr-1" /> 색인 요청
          </Button>
          <Button size="sm" variant="outline" onClick={deleteSelected} disabled={selected.size === 0}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> 삭제
          </Button>
          <Button size="sm" onClick={exportSelected} disabled={selected.size === 0 || busy}>
            <Download className="h-3.5 w-3.5 mr-1" /> {busy ? "내보내는 중..." : "Export"}
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
              <TableHead>제목</TableHead>
              <TableHead className="w-28">디자인</TableHead>
              <TableHead className="w-20">자수</TableHead>
              <TableHead className="w-24">provider</TableHead>
              <TableHead className="w-20">$</TableHead>
              <TableHead className="w-32">생성일</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">생성된 글이 없습니다.</TableCell></TableRow>
            )}
            {filtered.slice(0, 300).map((p) => (
              <TableRow key={p.id} data-state={selected.has(p.id) ? "selected" : undefined}>
                <TableCell>
                  <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5">
                    <Link
                      to={`/t/${encodeURIComponent(tenant.domain)}/post/${p.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    {p.status === "noindex" && (
                      <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-600">중복·noindex</Badge>
                    )}
                  </span>
                  <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate max-w-md">{p.slug}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">
                    {p.design_template_id ?? tenant.design_template_id}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs font-mono">{p.body_chars.toLocaleString()}</TableCell>
                <TableCell>
                  {p.provider && <Badge variant="outline" className="text-[10px]">{p.provider}</Badge>}
                </TableCell>
                <TableCell className="text-xs font-mono">{p.cost_usd ? `$${p.cost_usd.toFixed(3)}` : "—"}</TableCell>
                <TableCell className="text-[11px] text-muted-foreground">{p.generated_at}</TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      to={`/t/${encodeURIComponent(tenant.domain)}/post/${p.id}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-accent"
                      title="글 보기"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteOne(p)}
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-destructive hover:bg-destructive/10"
                      title="글 삭제"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
