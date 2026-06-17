"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, getOptions, listTenants } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import type { AdminOptions, Job, Tenant } from "@/lib/types";

export default function DashboardClient() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const [opts, tenantRes, jobRes] = await Promise.all([
      getOptions(),
      listTenants(),
      api<{ count: number; items: Job[] }>("/jobs?limit=8"),
    ]);
    setOptions(opts);
    setTenants(tenantRes.items);
    setJobs(jobRes.items);
  }

  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  async function createTenant(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    try {
      await api("/tenants", {
        method: "POST",
        body: JSON.stringify({
          domain: String(fd.get("domain") || "").trim(),
          display_name: String(fd.get("display_name") || "").trim(),
          vertical: String(fd.get("vertical") || "").trim(),
          theme: String(fd.get("theme") || "clean"),
          brand_color: String(fd.get("brand_color") || "#5132d7"),
          daily_limit: Number(fd.get("daily_limit") || 30),
          apply_preset: fd.get("apply_preset") === "on",
        }),
      });
      setOpen(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <p className="eyebrow">Next.js 관리자</p>
          <h1>대시보드</h1>
          <p className="muted">블로그를 만들고 글/숏츠 작업을 체크리스트처럼 진행합니다.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen((v) => !v)}>+ 새 도메인</button>
      </div>

      {error && <p className="toast-error">{error}</p>}

      {open && (
        <form onSubmit={createTenant} className="card card-pad grid" style={{ maxWidth: 720, marginBottom: 20 }}>
          <div><h2>새 블로그 만들기</h2><p className="muted small">처음에는 도메인과 이름만 넣어도 됩니다. 나머지는 추천값으로 시작합니다.</p></div>
          <div className="grid grid-2">
            <Field label="도메인"><input className="input" name="domain" placeholder="checkpick.kr" required pattern="[a-z0-9.\-]+" /></Field>
            <Field label="표시 이름"><input className="input" name="display_name" placeholder="체크픽" required /></Field>
          </div>
          <details className="advanced-panel">
            <summary>고급 옵션</summary>
            <div className="grid" style={{ marginTop: 12 }}>
              <Field label="업종"><input className="input" name="vertical" list="verticals" placeholder="health" defaultValue="health" required /></Field>
              <datalist id="verticals">{options?.verticals.map((v) => <option key={v} value={v} />)}</datalist>
              <div className="grid grid-3">
                <Field label="테마"><select className="select" name="theme">{options?.themes.map((v) => <option key={v}>{v}</option>)}</select></Field>
                <Field label="브랜드 컬러"><input className="input" name="brand_color" type="color" defaultValue="#5132d7" /></Field>
                <Field label="일일 한도"><input className="input" name="daily_limit" type="number" defaultValue={30} min={1} max={500} /></Field>
              </div>
            </div>
          </details>
          <label className="row small"><input type="checkbox" name="apply_preset" defaultChecked /> 프리셋 이름 매칭 시 자동 적용</label>
          <div className="row"><button className="btn primary" disabled={busy}>{busy ? "생성 중..." : "생성"}</button><button type="button" className="btn" onClick={() => setOpen(false)}>닫기</button></div>
        </form>
      )}

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="도메인" value={tenants.length} />
        <Stat label="전체 슬롯" value={tenants.reduce((a, t) => a + (t.slot_count ?? 0), 0)} />
        <Stat label="발행 글" value={tenants.reduce((a, t) => a + (t.published_count ?? 0), 0)} accent />
        <Stat label="숏츠 패키지" value={tenants.reduce((a, t) => a + (t.social_package_count ?? 0), 0)} />
      </div>

      {tenants.length === 0 ? (
        <div className="card card-pad" style={{ textAlign: "center", padding: 52 }}>
          <h2>아직 도메인이 없습니다</h2>
          <p className="muted">새 도메인을 만들면 다음 화면에서 체크리스트 순서대로 진행합니다.</p>
        </div>
      ) : (
        <div className="grid grid-3">
          {tenants.map((t) => (
            <Link href={`/t/${encodeURIComponent(t.domain)}`} className="card card-pad" key={t.domain}>
              <div className="spread"><h3>{t.display_name}</h3><span className="badge">{t.vertical}</span></div>
              <p className="muted mono small">{t.domain}</p>
              <div className="grid grid-4" style={{ gap: 8, marginTop: 16 }}>
                <Mini label="슬롯" value={t.slot_count ?? 0} />
                <Mini label="대기" value={t.planned_count ?? 0} />
                <Mini label="발행" value={t.published_count ?? 0} />
                <Mini label="숏츠" value={t.social_package_count ?? 0} />
              </div>
            </Link>
          ))}
        </div>
      )}

      <section style={{ marginTop: 28 }}>
        <div className="spread" style={{ marginBottom: 10 }}><h2>최근 작업</h2><Link className="btn" href="/jobs">전체 보기</Link></div>
        <div className="table-wrap">
          <table><thead><tr><th>도메인</th><th>종류</th><th>상태</th><th>예약</th><th>완료</th></tr></thead><tbody>
            {jobs.length === 0 && <tr><td colSpan={5} className="muted">작업 없음</td></tr>}
            {jobs.map((j) => <tr key={j.id}><td className="mono small">{j.tenant}</td><td>{j.kind}</td><td><Status status={j.status} /></td><td className="small muted">{formatDateTime(j.scheduled_at)}</td><td className="small muted">{formatDateTime(j.finished_at)}</td></tr>)}
          </tbody></table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value.toLocaleString()}</div></div>; }
function Mini({ label, value }: { label: string; value: number }) { return <div style={{ textAlign: "center", background: "#f8fafc", borderRadius: 12, padding: 10 }}><b>{value.toLocaleString()}</b><div className="muted small">{label}</div></div>; }
function Status({ status }: { status: string }) { const cls = status === "done" ? "success" : status === "failed" ? "danger" : status === "running" ? "info" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
