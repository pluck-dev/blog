import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@renderer/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card";
import { Badge } from "@renderer/components/ui/badge";
import { Progress } from "@renderer/components/ui/progress";
import { useToast } from "@renderer/components/toast";
import type { JobWithPayload, JobProgressEvent, JobStatus, GeneratePayload, JobLogEntry } from "@shared/types";

const STATUS_VARIANT: Record<JobStatus, "secondary" | "default" | "success" | "warning" | "destructive"> = {
  queued: "secondary", running: "warning", done: "success", failed: "destructive",
};

export default function JobsPage() {
  const [jobs, setJobs] = useState<JobWithPayload[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, JobProgressEvent>>({});
  const [logMap, setLogMap] = useState<Record<string, JobLogEntry[]>>({});
  const [params] = useSearchParams();
  const focusJobId = params.get("job");
  const { toast } = useToast();

  const refresh = useCallback(async () => {
    if (!window.api?.jobs) return;
    const list = await window.api.jobs.list({ limit: 50 });
    setJobs(list);
  }, []);

  useEffect(() => {
    refresh();
    let unsub: (() => void) | undefined;
    const interval = setInterval(refresh, 5000);
    if (window.api?.jobs?.onProgress) {
      unsub = window.api.jobs.onProgress((ev) => {
        setProgressMap((cur) => ({ ...cur, [ev.job_id]: ev }));
        const entry = eventToLog(ev);
        if (entry) {
          setLogMap((cur) => ({
            ...cur,
            [ev.job_id]: [...(cur[ev.job_id] ?? []), entry].slice(-100),
          }));
        }
        if (ev.phase === "complete" || ev.phase === "failed") refresh();
      });
    }
    return () => { unsub?.(); clearInterval(interval); };
  }, [refresh]);

  async function cancel(id: string) {
    const ok = await window.api.jobs.cancel(id);
    if (ok) toast({ title: "중지 요청됨", description: `${id.slice(0, 8)} 작업을 멈춥니다.` });
    else toast({ title: "취소 불가", description: "이미 종료된 작업입니다.", variant: "destructive" });
    refresh();
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl">
      <h1 className="text-2xl font-bold mb-1">작업 큐</h1>
      <p className="text-sm text-muted-foreground mb-6">
        총 {jobs.length}건. 실행 중인 작업의 진행 상황이 실시간으로 표시됩니다.
      </p>

      {jobs.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            작업이 없습니다. 슬롯 페이지에서 양산을 시작하세요.
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {jobs.map((job) => {
          const live = progressMap[job.id];
          const payload = job.payload_obj as Partial<GeneratePayload>;
          const total = (payload?.slot_ids?.length) ?? 0;
          const done = live?.done ?? (job.status === "done" ? total : 0);
          const ok = live?.ok ?? ((job.result_obj as { ok?: number })?.ok ?? 0);
          const fail = live?.fail ?? ((job.result_obj as { fail?: number })?.fail ?? 0);
          const percent = total > 0 ? Math.round((done / total) * 100) : 0;
          const highlight = focusJobId === job.id;
          const cancelable = job.status === "queued" || job.status === "running";
          const failedSlots = getPerSlot(job.result_obj).filter((r) => !r.ok);
          const persistentLogs = getResultLogs(job.result_obj);
          const liveLogs = logMap[job.id] ?? [];
          const logs = mergeLogs(persistentLogs, liveLogs);
          const errorMessage = formatJobError(job.error ?? live?.error ?? null);

          return (
            <Card key={job.id} className={highlight ? "ring-2 ring-amber-500/50" : ""}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 space-y-0">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[job.status]} className="text-[10px]">{job.status}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{job.id.slice(0, 8)}</span>
                    <span>{job.tenant}</span>
                    <Badge variant="outline" className="text-[10px]">{job.kind}</Badge>
                    {payload?.provider && (
                      <Badge variant="outline" className="text-[10px]">{payload.provider}{payload.model ? ` ${payload.model}` : ""}</Badge>
                    )}
                    {job.status === "done" && fail > 0 && (
                      <Badge variant="destructive" className="text-[10px]">실패 {fail}</Badge>
                    )}
                  </CardTitle>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {job.scheduled_at} {job.started_at && `→ ${job.started_at}`} {job.finished_at && `→ ${job.finished_at}`}
                  </div>
                </div>
                {cancelable && (
                  <Button size="sm" variant="outline" onClick={() => cancel(job.id)}>
                    {job.status === "running" ? "작업 중지" : "취소"}
                  </Button>
                )}
              </CardHeader>

              <CardContent className="pt-0">
                {total > 0 && (
                  <>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground">
                        {done}/{total} {live ? `· ${live.phase}` : ""}
                      </span>
                      <span className="font-mono">
                        ok={ok} fail={fail}
                      </span>
                    </div>
                    <Progress value={percent} />
                  </>
                )}
                {live?.slot_id && live.phase !== "complete" && (
                  <div className="mt-2 text-[11px] text-muted-foreground font-mono truncate">
                    현재: {live.slot_id} {live.duration_sec ? `(${live.duration_sec.toFixed(1)}s)` : ""}
                    {live.error && <span className="text-destructive ml-2">{live.error}</span>}
                  </div>
                )}
                {errorMessage && (
                  <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                    실패 사유: {errorMessage}
                  </div>
                )}
                {failedSlots.length > 0 && (
                  <div className="mt-3 rounded-md border bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium">실패한 글 후보</div>
                    <div className="mt-1 space-y-1">
                      {failedSlots.map((slot) => (
                        <div key={slot.slot_id} className="text-[11px] text-muted-foreground">
                          <span className="font-mono text-foreground">{slot.slot_id}</span>
                          {slot.error && <span className="ml-2 text-destructive">{slot.error}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <details className="mt-3 rounded-md border bg-muted/10 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">
                    로그 보기 {logs.length > 0 ? `(${logs.length})` : ""}
                  </summary>
                  <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                    {logs.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground">아직 기록된 로그가 없습니다.</div>
                    ) : (
                      logs.slice(-80).map((log, idx) => (
                        <div key={`${log.at}-${idx}`} className="grid grid-cols-[132px_64px_1fr] gap-2 text-[11px]">
                          <span className="font-mono text-muted-foreground">{formatLogTime(log.at)}</span>
                          <span className={logLevelClass(log.level)}>{log.level}</span>
                          <span className="min-w-0">
                            {log.slot_id && <span className="mr-2 font-mono text-muted-foreground">{log.slot_id}</span>}
                            {log.message}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </details>
                {job.status === "done" && fail > 0 && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    작업은 종료됐지만 일부 글이 실패했습니다. 성공한 글만 완성 글에 추가됩니다.
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

type PerSlotResult = {
  slot_id: string;
  ok: boolean;
  error?: string;
  duration_sec?: number;
  chars?: number;
  model?: string;
};

function getPerSlot(result: Record<string, unknown> | undefined): PerSlotResult[] {
  const raw = result?.per_slot;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is PerSlotResult => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<PerSlotResult>;
    return typeof row.slot_id === "string" && typeof row.ok === "boolean";
  });
}

function getResultLogs(result: Record<string, unknown> | undefined): JobLogEntry[] {
  const raw = result?.logs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is JobLogEntry => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<JobLogEntry>;
    return typeof row.at === "string" && typeof row.message === "string";
  });
}

function mergeLogs(saved: JobLogEntry[], live: JobLogEntry[]): JobLogEntry[] {
  const seen = new Set<string>();
  const out: JobLogEntry[] = [];
  for (const log of [...saved, ...live]) {
    const key = `${log.at}:${log.level}:${log.slot_id ?? ""}:${log.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out;
}

function eventToLog(ev: JobProgressEvent): JobLogEntry | null {
  const message = ev.message ?? ev.error ?? phaseLabel(ev.phase);
  return {
    at: new Date().toISOString(),
    level: ev.phase === "slot_fail" || ev.phase === "failed" ? "error" : ev.phase === "slot_done" || ev.phase === "complete" ? "success" : "info",
    message,
    slot_id: ev.slot_id,
  };
}

function phaseLabel(phase: JobProgressEvent["phase"]): string {
  switch (phase) {
    case "start": return "작업을 시작했습니다.";
    case "slot_start": return "글 작성을 시작했습니다.";
    case "slot_done": return "글 작성이 완료됐습니다.";
    case "slot_fail": return "글 작성에 실패했습니다.";
    case "cooldown": return "다음 글 작성 전 대기 중입니다.";
    case "complete": return "작업이 완료됐습니다.";
    case "failed": return "작업이 실패했습니다.";
  }
}

function formatJobError(error: string | null): string | null {
  if (!error) return null;
  if (error === "cancel_requested") return "사용자가 중지를 요청했습니다. 현재 처리 중인 글이나 대기 시간이 끝나면 멈춥니다.";
  if (error === "cancelled before start") return "시작 전에 사용자가 취소했습니다.";
  if (error === "cancelled by user") return "사용자가 작업을 중지했습니다.";
  return error;
}

function formatLogTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function logLevelClass(level: JobLogEntry["level"]): string {
  if (level === "error") return "font-medium text-destructive";
  if (level === "warning") return "font-medium text-amber-600";
  if (level === "success") return "font-medium text-emerald-600";
  return "font-medium text-muted-foreground";
}
