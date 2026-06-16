"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import type { Job } from "@/lib/types";

export default function JobsClient() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [status, setStatus] = useState("");
  const [tenant, setTenant] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (tenant) qs.set("tenant", tenant);
    qs.set("limit", "300");
    const res = await api<{ count: number; items: Job[] }>(`/jobs?${qs}`);
    setJobs(res.items);
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); const id = setInterval(() => refresh().catch(() => undefined), 3000); return () => clearInterval(id); }, [status, tenant]);

  const tenants = useMemo(() => Array.from(new Set(jobs.map((j) => j.tenant))).sort(), [jobs]);
  return <div>
    <div className="page-head"><div><p className="eyebrow">3초마다 자동 새로고침</p><h1>작업 큐</h1><p className="muted">worker가 처리하는 generate/dedup/prune/indexing 작업 상태입니다.</p></div><button className="btn" onClick={refresh}>새로고침</button></div>
    {error && <p className="toast-error">{error}</p>}
    <div className="row" style={{ marginBottom: 16 }}><select className="select" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option><option>queued</option><option>running</option><option>done</option><option>failed</option></select><select className="select" style={{ width: 240 }} value={tenant} onChange={(e) => setTenant(e.target.value)}><option value="">전체 도메인</option>{tenants.map((t) => <option key={t}>{t}</option>)}</select></div>
    <div className="grid">{jobs.length === 0 && <div className="card card-pad muted">작업 없음</div>}{jobs.map((j) => <JobCard key={j.id} job={j} />)}</div>
  </div>;
}

function JobCard({ job }: { job: Job }) {
  const total = Array.isArray(job.payload_obj?.slot_ids) ? job.payload_obj.slot_ids.length : Number(job.result_obj?.total_posts ?? job.result_obj?.total ?? 0) || 1;
  const done = Number(job.result_obj?.ok ?? 0) + Number(job.result_obj?.fail ?? 0);
  const percent = job.status === "done" ? 100 : job.status === "failed" ? 100 : job.status === "running" ? Math.max(20, Math.min(90, Math.round((done / total) * 100) || 35)) : 5;
  return <details className="card" open={job.status === "running" || job.status === "failed"}>
    <summary className="spread" style={{ padding: 16, cursor: "pointer" }}><div className="row"><Status status={job.status} /><b>{job.kind}</b><Link href={`/t/${encodeURIComponent(job.tenant)}`} className="mono small">{job.tenant}</Link></div><span className="muted small">{formatDateTime(job.scheduled_at)}</span></summary>
    <div className="card-pad" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="progress"><span style={{ width: `${percent}%` }} /></div>
      <p className="muted small">진행률 {percent}% · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)}</p>
      {job.error && <p className="toast-error">{job.error}</p>}
      {job.result_obj && Object.keys(job.result_obj).length > 0 && <pre className="codebox small">{JSON.stringify(job.result_obj, null, 2)}</pre>}
      <details><summary className="small muted">payload</summary><pre className="codebox small">{JSON.stringify(job.payload_obj, null, 2)}</pre></details>
    </div>
  </details>;
}
function Status({ status }: { status: string }) { const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : "warn"; return <span className={`badge ${cls}`}>{status}</span>; }
