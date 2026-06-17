"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, deleteSocialChannel, enqueueGenerate, enqueueSiteDeploy, enqueueSocialGenerate, enqueueSocialRender, getOptions, getTenantDetail, listSlots, replaceAxis, syncDrivingplusAcademies, syncDrivingplusRegions, updateTenant, upsertSocialChannel } from "@/lib/api";
import { formatDateTime } from "@/lib/date";
import type { Academy, AdminOptions, Axis, AxisValue, Job, PostSummary, Provider, SiteDeployment, Slot, SlotCounts, SocialChannel, SocialPackage, Tenant, TenantDetailPayload } from "@/lib/types";

const AXES: Axis[] = ["region", "keyword", "intent", "persona", "modifier"];
const AXIS_LABEL: Record<Axis, string> = {
  region: "어느 지역 글인가요?",
  keyword: "어떤 검색어를 노릴까요?",
  intent: "사용자는 뭘 알고 싶어 하나요?",
  persona: "누구에게 말할까요?",
  modifier: "어떤 장점을 강조할까요?",
};
const AXIS_PLACEHOLDER: Record<Axis, string> = {
  region: "강남구\n송파구\n분당",
  keyword: "건강검진\n영양제 비교\n수면 관리",
  intent: "비교 추천\n비용 정리\n초보자 가이드",
  persona: "직장인\n부모님\n운동 입문자",
  modifier: "쉽게\n루틴\n주의할 점",
};
const PRIMARY_TABS = [
  ["overview", "쉬운 진행"], ["posts", "완성 글"], ["shorts", "숏츠"], ["jobs", "작업 상태"],
] as const;
const ADVANCED_TABS = [
  ["site", "사이트 설정"], ["plan", "기획 세부 수정"], ["templates", "글 유형/디자인"], ["axes", "키워드 축"],
  ["academies", "원천자료"], ["slots", "글 후보/작성"], ["settings", "설정"],
] as const;

const PREVIEW_DESIGN_SPECS: Record<string, { topCta: string; bottomCta: string }> = {
  editorial: { topCta: "지금 바로 비교·예약", bottomCta: "상담/예약하러 가기" },
  comparison: { topCta: "BEST 한눈에 비교", bottomCta: "내게 맞는 곳 찾기" },
  "local-guide": { topCta: "내 주변에서 찾기", bottomCta: "가까운 곳 예약하기" },
  checklist: { topCta: "체크리스트 저장", bottomCta: "준비 시작하기" },
  conversion: { topCta: "비용 상담 신청", bottomCta: "지금 예약하기" },
  custom: { topCta: "자세히 보기", bottomCta: "문의하기" },
};

const DESIGN_BLUEPRINTS: Record<string, {
  label: string;
  title: string;
  lead: string;
  chips: string[];
  sections: string[];
  tone: string;
  blocks: Array<{ title: string; body: string; kind?: "table" | "quote" | "cta" | "list" }>;
}> = {
  editorial: {
    label: "정보성 글에 가장 무난한 매거진형 화면",
    title: "건강검진 처음 준비할 때 알아야 할 절차와 비용",
    lead: "초보자가 검색해서 들어왔을 때 필요한 배경 설명, 체크리스트, FAQ가 자연스럽게 이어집니다.",
    chips: ["가이드", "FAQ", "정보성"],
    sections: ["상단 CTA", "대표 이미지", "중앙 제목", "본문", "예약 CTA"],
    tone: "차분하고 친절한 전문가 톤",
    blocks: [
      { title: "도입", body: "왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다." },
      { title: "핵심 설명", body: "절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다." },
      { title: "FAQ", body: "처음 받아도 되나요?|주말에도 가능한가요?|추가 비용은 언제 생기나요?", kind: "list" },
      { title: "자연스러운 CTA", body: "관련 글, 체크리스트 저장, 상담 전 확인으로 부드럽게 연결합니다.", kind: "cta" },
    ],
  },
  comparison: {
    label: "표와 선택 기준이 먼저 보이는 비교형 화면",
    title: "건강검진 항목 BEST 5, 비용과 준비사항 한 번에 비교",
    lead: "여러 정보를 하나씩 찾지 않아도 되도록 가격대, 준비사항, 추천 대상을 먼저 정리합니다.",
    chips: ["비교표", "BEST5", "추천"],
    sections: ["비교 기준", "요약 표", "선택지별 장단점", "추천 케이스", "CTA"],
    tone: "객관적이고 판단이 쉬운 톤",
    blocks: [
      { title: "비교 기준", body: "가격, 준비 시간, 주의사항, 추천 대상을 같은 기준으로 맞춰 비교합니다." },
      { title: "한눈에 보는 비교표", body: "표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다.", kind: "table" },
      { title: "추천 케이스", body: "직장인, 부모님, 초보자처럼 상황별 추천을 분리합니다." },
      { title: "마지막 전환", body: "관련 체크리스트와 다음 확인 글로 연결합니다.", kind: "cta" },
    ],
  },
  "local-guide": {
    label: "지역 검색어에 맞춘 로컬 랜딩 화면",
    title: "송파에서 건강검진 받을 때 먼저 확인할 5가지",
    lead: "동네에서 실제로 고민하는 이동 거리, 예약 가능 시간, 준비사항을 앞쪽에 배치합니다.",
    chips: ["지역 SEO", "주변", "동선"],
    sections: ["지역 고민", "주변 선택 기준", "동선/접근성", "추천 시나리오", "CTA"],
    tone: "현장감 있는 로컬 큐레이터 톤",
    blocks: [
      { title: "지역 고민", body: "송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다." },
      { title: "선택 체크", body: "집/회사와 가까운지|예약 시간이 맞는지|검사 전 준비가 쉬운지", kind: "list" },
      { title: "실제 후기 톤", body: "퇴근 후에도 예약 가능한 시간을 확인해서 주말에 몰리는 부담이 줄었다는 식의 현실적인 후기를 넣습니다.", kind: "quote" },
      { title: "지역 CTA", body: "내 위치와 일정 기준으로 다음 확인 글에 연결합니다.", kind: "cta" },
    ],
  },
  checklist: {
    label: "빠르게 훑고 저장하기 좋은 체크리스트 화면",
    title: "건강검진 전날 체크리스트, 실수 줄이는 순서",
    lead: "준비물과 주의사항을 먼저 보여주고, 상세 설명은 아래로 이어집니다.",
    chips: ["체크리스트", "검사", "절차"],
    sections: ["요약", "준비 체크", "절차", "주의사항", "FAQ"],
    tone: "간결하고 실무적인 안내 톤",
    blocks: [
      { title: "3분 요약", body: "신분증, 예약 시간, 금식 여부처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다." },
      { title: "준비 체크", body: "신분증 챙기기|예약 시간 확인|금식/복용약 확인|결과 확인 방법 저장", kind: "list" },
      { title: "자주 하는 실수", body: "전날 식사, 복용 중인 약, 문진표 작성처럼 반복되는 실수를 실제 상황 중심으로 설명합니다." },
      { title: "검진 전 연결", body: "놓치기 쉬운 준비사항을 다시 확인하는 글로 이어집니다.", kind: "cta" },
    ],
  },
  conversion: {
    label: "상담과 예약 전환을 강조하는 화면",
    title: "건강관리 비용이 부담될 때, 선택 전에 볼 기준",
    lead: "사용자의 문제를 먼저 잡고 해결 기준, 후기, CTA가 반복되지 않게 이어집니다.",
    chips: ["상담", "예약", "비용"],
    sections: ["문제 공감", "해결 기준", "사례/후기", "비용/혜택", "CTA"],
    tone: "신뢰를 주는 세일즈 톤",
    blocks: [
      { title: "문제 공감", body: "시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다." },
      { title: "해결 기준", body: "필수 항목, 추가 비용 여부, 내 상황에 맞는 선택 기준을 질문 목록으로 정리합니다." },
      { title: "후기 배치", body: "상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다.", kind: "quote" },
      { title: "상담 CTA", body: "비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다.", kind: "cta" },
    ],
  },
  custom: {
    label: "직접 입력한 메모를 기준으로 잡는 화면",
    title: "내가 정한 화면 구상을 반영한 글",
    lead: "오른쪽 메모에 원하는 화면 구조를 적으면 직접 만든 디자인 기준으로 저장됩니다.",
    chips: ["커스텀", "직접 설계"],
    sections: ["상단 구성", "본문 규칙", "표/이미지 위치", "CTA 위치"],
    tone: "사용자 정의",
    blocks: [
      { title: "상단 구성", body: "제목, 핵심 요약, 대표 이미지 등 직접 적은 규칙을 발행 렌더러가 참고할 수 있게 저장합니다." },
      { title: "본문 구성", body: "표, 이미지, CTA 위치처럼 반복될 디자인 규칙을 명시합니다." },
      { title: "전환 영역", body: "상담, 예약, 내부 링크 등 마지막 행동을 어디에 둘지 정합니다.", kind: "cta" },
    ],
  },
};


export default function TenantClient({ domain }: { domain: string }) {
  const [payload, setPayload] = useState<TenantDetailPayload | null>(null);
  const [options, setOptions] = useState<AdminOptions | null>(null);
  const [tab, setTab] = useState("overview");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [opts, detail] = await Promise.all([getOptions(), getTenantDetail(domain)]);
    setOptions(opts); setPayload(detail);
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, [domain]);

  if (error) return <div className="toast-error">{error}</div>;
  if (!payload || !options) return <div className="card card-pad">로딩 중...</div>;
  const tenant = payload.tenant;
  const counts = payload.slot_counts;

  async function saveTenant(fields: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await updateTenant(domain, fields);
      setPayload((prev) => prev ? { ...prev, tenant: res.tenant } : prev);
      await refresh();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <Link href="/" className="eyebrow">← 대시보드</Link>
          <h1><span style={{ color: tenant.brand_color ?? "var(--primary)" }}>●</span> {tenant.display_name}</h1>
          <p className="muted mono">{tenant.domain}</p>
        </div>
        <div className="row">
          <span className="badge">{tenant.vertical}</span>
          <span className="badge">{tenant.theme}</span>
          <Link href="/jobs" className="btn">작업 큐</Link>
        </div>
      </div>

      <EasyProgress steps={operatingSteps(tenant, counts)} active={tab} onTab={setTab} />

      <div className="tabs simple-tabs">
        {PRIMARY_TABS.map(([id, label]) => <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === "overview" && <Overview tenant={tenant} counts={counts} posts={payload.posts ?? []} packages={payload.social_packages ?? []} jobs={payload.jobs ?? []} onTab={setTab} />}
      {tab === "site" && <Site tenant={tenant} options={options} deployments={payload.deployments ?? []} channels={payload.social_channels ?? []} onSave={saveTenant} onRefresh={refresh} />}
      {tab === "plan" && <Plan tenant={tenant} axes={payload.axes} busy={busy} onSave={saveTenant} onRefresh={refresh} onTab={setTab} />}
      {tab === "templates" && <Templates tenant={tenant} options={options} busy={busy} onSave={saveTenant} />}
      {tab === "axes" && <Axes tenant={tenant} axes={payload.axes} options={options} onRefresh={refresh} />}
      {tab === "academies" && <Academies tenant={tenant} academies={payload.academies ?? []} onRefresh={refresh} />}
      {tab === "slots" && <Slots tenant={tenant} slots={payload.slots ?? []} options={options} onRefresh={refresh} onTab={setTab} />}
      {tab === "jobs" && <Jobs tenant={tenant} jobs={payload.jobs ?? []} onRefresh={refresh} />}
      {tab === "posts" && <Posts tenant={tenant} posts={payload.posts ?? []} onRefresh={refresh} />}
      {tab === "shorts" && <Shorts tenant={tenant} posts={payload.posts ?? []} packages={payload.social_packages ?? []} options={options} onRefresh={refresh} />}
      {tab === "settings" && <Settings tenant={tenant} options={options} onSave={saveTenant} onRefresh={refresh} />}
    </div>
  );
}

type OperatingStep = {
  tab: string;
  title: string;
  body: string;
  done: boolean;
  count: string;
  action: string;
};

function operatingSteps(tenant: Tenant, counts: SlotCounts): OperatingStep[] {
  const totalSlots = Object.values(counts).reduce((a, b) => a + b, 0);
  return [
    { tab: "plan", title: "무슨 글을 쓸지 정하기", body: "블로그 방향과 키워드를 한 번만 정리합니다.", done: Boolean(tenant.content_brief), count: tenant.content_brief ? "완료" : "필요", action: "기획 쓰기" },
    { tab: "slots", title: "글 후보 만들기", body: "정한 키워드로 작성할 글 목록을 자동으로 만듭니다.", done: totalSlots > 0, count: `${totalSlots}개`, action: totalSlots > 0 ? "후보 보기" : "후보 만들기" },
    { tab: "slots", title: "1개 테스트 글 작성", body: "대량 작성 전에 1개만 먼저 만들어 품질을 확인합니다.", done: counts.published > 0 || counts.in_progress > 0, count: counts.in_progress > 0 ? "진행 중" : `${counts.published}개`, action: "테스트 작성" },
    { tab: "posts", title: "완성 글 확인", body: "생성된 글을 열어 제목, 내용, 다운로드를 확인합니다.", done: counts.published > 0, count: `${counts.published}개`, action: "글 확인" },
    { tab: "shorts", title: "숏츠 패키지 만들기", body: "완성 글을 카드뉴스, 대본, 캡션, 해시태그로 바꿉니다.", done: Boolean(tenant.social_package_count), count: `${tenant.social_package_count ?? 0}개`, action: "숏츠 만들기" },
  ];
}

function EasyProgress({ steps, active, onTab }: { steps: OperatingStep[]; active: string; onTab: (v: string) => void }) {
  const complete = steps.filter((step) => step.done).length;
  return <section className="easy-progress" aria-label="운영 진행 상태">
    <div className="spread easy-progress-head">
      <div><b>오늘은 여기서 시작하세요</b><p className="muted small">왼쪽부터 체크하면서 진행하면 됩니다.</p></div>
      <span className="badge success">{complete}/{steps.length} 완료</span>
    </div>
    <div className="workflow">{steps.map((step, i) => <button key={`${step.tab}-${step.title}`} className={`step easy-step ${step.done ? "done" : ""} ${active === step.tab ? "active" : ""}`} onClick={() => onTab(step.tab)}>
      <span className="checkmark">{step.done ? "✓" : i + 1}</span>
      <b>{step.title}</b>
      <p className="muted small">{step.count}</p>
    </button>)}</div>
  </section>;
}

function Overview({ tenant, counts, posts, packages, jobs, onTab }: { tenant: Tenant; counts: SlotCounts; posts: PostSummary[]; packages: SocialPackage[]; jobs: Job[]; onTab: (v: string) => void }) {
  const steps = operatingSteps(tenant, counts);
  const nextStep = steps.find((step) => !step.done) ?? steps[steps.length - 1]!;
  const activeJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  return <div className="grid">
    <section className="easy-hero">
      <div>
        <p className="eyebrow">다음 할 일</p>
        <h2>{nextStep.title}</h2>
        <p>{nextStep.body}</p>
      </div>
      <button className="btn primary" onClick={() => onTab(nextStep.tab)}>{nextStep.action}</button>
    </section>

    <section className="checklist-board">
      {steps.map((step, i) => <button key={`${step.title}-${i}`} className={`task-card ${step.done ? "done" : ""}`} onClick={() => onTab(step.tab)}>
        <span className="task-check" aria-hidden="true">{step.done ? "✓" : i + 1}</span>
        <span className="task-copy"><b>{i + 1}. {step.title}</b><em>{step.body}</em></span>
        <span className="task-action">{step.done ? "완료" : step.action}</span>
      </button>)}
    </section>

    <div className="grid grid-4">
      <Stat label="글 후보" value={counts.planned} /><Stat label="작업 중" value={activeJobs} /><Stat label="완성 글" value={posts.length || counts.published} accent /><Stat label="숏츠" value={packages.length} />
    </div>

    <details className="advanced-panel">
      <summary>고급 설정 열기</summary>
      <div className="advanced-grid">
        {ADVANCED_TABS.map(([id, label]) => <button key={id} className="option-card compact-option" onClick={() => onTab(id)}>
          <b>{label}</b>
          <p className="muted small">{advancedHelp(id)}</p>
        </button>)}
      </div>
    </details>
  </div>;
}

function advancedHelp(id: string): string {
  if (id === "site") return "사이트 주소, 채널, 배포 기록";
  if (id === "plan") return "블로그 방향과 키워드 문장 수정";
  if (id === "templates") return "글 유형과 디자인 선택";
  if (id === "axes") return "지역/검색어/타겟 값 직접 편집";
  if (id === "academies") return "검증 자료 직접 추가";
  if (id === "slots") return "후보 검색, 테스트 작성, 대량 작성";
  if (id === "settings") return "도메인 정보와 색인 설정";
  return "";
}

function Site({ tenant, options, deployments, channels, onSave, onRefresh }: { tenant: Tenant; options: AdminOptions; deployments: SiteDeployment[]; channels: SocialChannel[]; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState({
    site_url: tenant.site_url ?? `https://${tenant.domain}`,
    deployment_provider: tenant.deployment_provider ?? "manual",
    deployment_project: tenant.deployment_project ?? "",
    video_style_id: tenant.video_style_id ?? "card-news-clean",
    social_profile: tenant.social_profile ?? "",
  });
  const [busy, setBusy] = useState("");
  async function saveSite() {
    await onSave({
      site_url: form.site_url.trim(),
      deployment_provider: form.deployment_provider,
      deployment_project: form.deployment_project.trim(),
      video_style_id: form.video_style_id,
      social_profile: form.social_profile.trim(),
    });
  }
  async function deploy() {
    setBusy("deploy");
    try {
      const res = await enqueueSiteDeploy(tenant.domain, { provider: form.deployment_provider, site_url: form.site_url, project_ref: form.deployment_project });
      alert(`배포 체크포인트 등록: ${res.job_id}`);
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(""); }
  }
  async function addChannel(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    await upsertSocialChannel(tenant.domain, {
      platform: fd.get("platform"),
      handle: fd.get("handle"),
      publish_mode: fd.get("publish_mode"),
      status: fd.get("status"),
      notes: fd.get("notes"),
    });
    form.reset();
    await onRefresh();
  }
  async function removeChannel(id: string) {
    if (!confirm("채널을 삭제할까요?")) return;
    await deleteSocialChannel(tenant.domain, id);
    await onRefresh();
  }
  return <div className="grid">
    <div className="grid grid-2">
      <section className="card card-pad grid">
        <div><h2>사이트 운영 설정</h2><p className="muted small">자체 사이트 배포와 숏츠 패키지에서 공통으로 쓰는 공개 URL/브랜드 설정입니다.</p></div>
        <Field label="공개 사이트 URL"><input className="input mono" value={form.site_url} onChange={(e) => setForm({ ...form, site_url: e.target.value })} /></Field>
        <div className="grid grid-2">
          <Field label="배포 방식"><select className="select" value={form.deployment_provider} onChange={(e) => setForm({ ...form, deployment_provider: e.target.value })}>{options.deployment_providers.map((provider) => <option key={provider}>{provider}</option>)}</select></Field>
          <Field label="프로젝트/사이트 ref"><input className="input mono" value={form.deployment_project} onChange={(e) => setForm({ ...form, deployment_project: e.target.value })} placeholder="vercel project, netlify site id..." /></Field>
        </div>
        <Field label="기본 숏츠 스타일"><select className="select" value={form.video_style_id} onChange={(e) => setForm({ ...form, video_style_id: e.target.value })}>{options.video_styles.map((style) => <option key={style.id} value={style.id}>{style.name} - {style.summary}</option>)}</select></Field>
        <Field label="대표 소셜 프로필"><input className="input" value={form.social_profile} onChange={(e) => setForm({ ...form, social_profile: e.target.value })} placeholder="@checkpick 또는 https://..." /></Field>
        <div className="row"><button className="btn primary" onClick={saveSite}>저장</button><button className="btn" onClick={deploy} disabled={busy === "deploy"}>{busy === "deploy" ? "등록 중..." : "배포 체크포인트"}</button></div>
      </section>

      <form className="card card-pad grid" onSubmit={addChannel}>
        <div><h2>채널 연결</h2><p className="muted small">1차는 수동 업로드 패키지 기준입니다. API 직접 발행은 나중에 연결합니다.</p></div>
        <div className="grid grid-2">
          <Field label="플랫폼"><select className="select" name="platform">{options.social_platforms.map((platform) => <option key={platform}>{platform}</option>)}</select></Field>
          <Field label="핸들"><input className="input" name="handle" placeholder="@checkpick" required /></Field>
        </div>
        <div className="grid grid-2">
          <Field label="발행 방식"><select className="select" name="publish_mode"><option>manual</option><option>api</option></select></Field>
          <Field label="상태"><select className="select" name="status"><option>planned</option><option>connected</option><option>paused</option></select></Field>
        </div>
        <Field label="메모"><textarea className="textarea" name="notes" placeholder="업로드 시간대, 톤, 금지어 등" /></Field>
        <button className="btn primary">채널 저장</button>
      </form>
    </div>

    <section className="card card-pad grid">
      <div className="spread"><h2>배포 기록</h2><span className="badge">{deployments.length}개</span></div>
      <div className="table-wrap"><table><thead><tr><th>상태</th><th>방식</th><th>URL</th><th>갱신</th><th>메모</th></tr></thead><tbody>
        {deployments.length === 0 && <tr><td colSpan={5} className="muted">아직 배포 기록이 없습니다.</td></tr>}
        {deployments.map((deployment) => <tr key={deployment.id}><td><Status status={deployment.status} /></td><td>{deployment.provider}<p className="muted small">{deployment.environment}</p></td><td>{deployment.site_url ? <a href={deployment.site_url} target="_blank" className="mono small">{deployment.site_url}</a> : "-"}</td><td className="small muted">{formatDateTime(deployment.updated_at)}</td><td className="small">{deployment.notes || deployment.project_ref || "-"}</td></tr>)}
      </tbody></table></div>
    </section>

    <section className="card card-pad grid">
      <div className="spread"><h2>소셜 채널</h2><span className="badge">{channels.length}개</span></div>
      <div className="table-wrap"><table><thead><tr><th>플랫폼</th><th>핸들</th><th>발행</th><th>상태</th><th></th></tr></thead><tbody>
        {channels.length === 0 && <tr><td colSpan={5} className="muted">아직 채널이 없습니다.</td></tr>}
        {channels.map((channel) => <tr key={channel.id}><td>{channel.platform}</td><td><b>{channel.handle}</b><p className="muted small">{channel.notes}</p></td><td>{channel.publish_mode}</td><td><Status status={channel.status} /></td><td><button className="btn danger" onClick={() => removeChannel(channel.id)}>삭제</button></td></tr>)}
      </tbody></table></div>
    </section>
  </div>;
}

function Plan({ tenant, axes, busy, onSave, onRefresh, onTab }: { tenant: Tenant; axes: TenantDetailPayload["axes"]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [brief, setBrief] = useState(tenant.content_brief ?? "");
  const [texts, setTexts] = useState<Record<Axis, string>>(() => Object.fromEntries(AXES.map((a) => [a, axes[a]?.map((v) => v.value).join("\n") ?? ""])) as Record<Axis, string>);
  const applyPreset = (kind: "checkup" | "wellness") => {
    const preset = kind === "checkup" ? {
      brief: "직장인과 부모님이 건강검진을 준비할 때 필요한 비용, 준비사항, 검진 항목 비교를 쉽게 정리하는 블로그를 만든다.",
      region: "전국\n서울\n경기\n부산\n대구",
      keyword: "건강검진\n건강검진 비용\n종합건강검진\n건강검진 준비사항\n건강검진 금식",
      intent: "비교 추천\n비용 정리\n준비물 체크\n주의사항\n초보자 가이드",
      persona: "직장인\n부모님\n30대\n40대\n건강검진 처음 받는 사람",
      modifier: "쉽게\n꼼꼼하게\n체크리스트\n주의할 점\n비용 절약",
    } : {
      brief: "바쁜 사람이 수면, 영양제, 운동 루틴 같은 생활건강 정보를 과장 없이 비교하고 실천할 수 있게 정리하는 블로그를 만든다.",
      region: "전국\n서울\n경기\n인천\n부산",
      keyword: "수면 관리\n영양제 비교\n운동 루틴\n스트레칭\n생활건강",
      intent: "입문 가이드\n비교 추천\n실수 방지\n체크리스트\n루틴 만들기",
      persona: "직장인\n운동 입문자\n부모님\n수면이 부족한 사람\n건강관리 초보자",
      modifier: "쉽게\n꾸준히\n현실적인\n주의할 점\n체크리스트",
    };
    setBrief(preset.brief);
    setTexts({ region: preset.region, keyword: preset.keyword, intent: preset.intent, persona: preset.persona, modifier: preset.modifier });
  };
  async function save() {
    await Promise.all(AXES.map((axis) => {
      const values = parseLines(texts[axis]).map((value) => ({ value, weight: 3, monthly_search_volume: null, competition_kd: null }));
      return values.length ? replaceAxis(tenant.domain, axis, values) : Promise.resolve();
    }));
    await onSave({ content_brief: brief.trim() });
    await onRefresh();
  }
  return <div className="card card-pad grid">
    <div className="spread"><div><h2>무슨 글을 쓸지 정하기</h2><p className="muted small">처음에는 예시를 넣고 저장해도 됩니다. 나중에 언제든 수정할 수 있습니다.</p></div><div className="row"><button className="btn" onClick={() => applyPreset("checkup")}>건강검진 예시 넣기</button><button className="btn" onClick={() => applyPreset("wellness")}>생활건강 예시 넣기</button></div></div>
    <Field label="블로그 방향"><textarea className="textarea" rows={5} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="직장인이 건강검진과 생활건강 정보를 쉽게 비교하고, 검진 전 준비사항과 비용 확인 기준을 저장할 수 있는 글을 만든다." /></Field>
    <div className="grid grid-2">{AXES.map((axis) => <Field key={axis} label={AXIS_LABEL[axis]}><textarea className="textarea" value={texts[axis]} onChange={(e) => setTexts((p) => ({ ...p, [axis]: e.target.value }))} placeholder={AXIS_PLACEHOLDER[axis]} /></Field>)}</div>
    <div className="row"><button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "저장하고 다음으로"}</button><button className="btn" onClick={() => onTab("slots")}>글 후보 만들기</button><button className="btn" onClick={() => onTab("overview")}>쉬운 진행으로 돌아가기</button></div>
  </div>;
}

function Templates({ tenant, options, busy, onSave }: { tenant: Tenant; options: AdminOptions; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void> }) {
  const [enabled, setEnabled] = useState(new Set(tenant.templates_enabled));
  const [design, setDesign] = useState(tenant.design_template_id ?? "editorial");
  const [custom, setCustom] = useState(tenant.custom_design_templates ?? "");
  const activeDesign = options.design_templates.find((d) => d.id === design) ?? options.design_templates[0];
  const blueprint = { ...(DESIGN_BLUEPRINTS[design] ?? DESIGN_BLUEPRINTS.editorial) };
  if (design === "custom" && custom.trim()) blueprint.lead = custom.trim();
  const toggle = (id: string) => setEnabled((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return <div className="grid">
    <section className="card card-pad grid">
      <div className="spread"><div><h2>글 유형</h2><p className="muted">어떤 종류의 글을 만들지 고릅니다. 너무 많이 켜면 후보 수가 빠르게 늘어납니다.</p></div><span className="badge info">{enabled.size}개 사용 중</span></div>
      <div className="grid grid-2">{Object.entries(options.template_specs).map(([id, spec]) => <button key={id} className={`option-card ${enabled.has(id) ? "active" : ""}`} onClick={() => toggle(id)}>
        <div className="spread"><b><span className="badge">{id}</span> {spec.name}</b><span>{enabled.has(id) ? "✓" : ""}</span></div>
        <p className="muted small">primary: {spec.primary.join(", ")} · persona {spec.use_persona ? "사용" : "미사용"} · intent {spec.with_intent ? "사용" : "미사용"} · modifier {spec.modifier_count}</p>
        <div className="row">{spec.primary.map((axis) => <span key={axis} className="badge">{axis}</span>)}{spec.use_persona && <span className="badge">persona</span>}{spec.with_intent && <span className="badge">intent</span>}{spec.modifier_count > 0 && <span className="badge">modifier {spec.modifier_count}</span>}</div>
      </button>)}</div>
    </section>

    <section className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(360px, 440px)", alignItems: "start" }}>
      <div className="card card-pad grid">
        <div><h2>화면 구상 / 디자인</h2><p className="muted">Electron에 있던 디자인 선택 화면처럼, 완성 글이 어떤 구조로 보일지 먼저 고릅니다.</p></div>
        <div className="grid grid-2">{options.design_templates.map((tpl) => {
          const bp = DESIGN_BLUEPRINTS[tpl.id] ?? DESIGN_BLUEPRINTS.editorial;
          return <button key={tpl.id} className={`option-card ${design === tpl.id ? "active" : ""}`} onClick={() => setDesign(tpl.id)}>
            <div className="spread"><b>{tpl.name}</b><span>{design === tpl.id ? "✓" : ""}</span></div>
            <p className="muted small">{tpl.summary}</p>
            <p className="small"><b>추천:</b> {tpl.best_for}</p>
            <p className="small"><b>톤:</b> {bp.tone}</p>
            <div className="row">{bp.sections.slice(0, 4).map((section) => <span key={section} className="badge">{section}</span>)}</div>
          </button>;
        })}</div>
        <Field label="직접 만드는 화면 구상 메모">
          <textarea className="textarea" rows={7} value={custom} onChange={(e) => { setCustom(e.target.value); if (e.target.value.trim()) setDesign("custom"); }} placeholder={`첫 화면에는 큰 제목과 핵심 요약 3개를 둔다.
비교표는 본문 상단에 배치한다.
CTA는 중간 1회, 마지막 1회만 사용한다.
모바일에서는 카드형 목록으로 보이게 한다.`} />
        </Field>
        <div className="row"><button className="btn primary" disabled={busy || enabled.size === 0} onClick={() => onSave({ templates_enabled: Array.from(enabled).sort(), design_template_id: design, custom_design_templates: custom.trim() })}>{busy ? "저장 중..." : "글 유형/화면 구상 저장"}</button><span className="muted small">저장 후 새 글 후보/생성글부터 적용됩니다.</span></div>
      </div>
      <DesignPreview blueprint={blueprint} designId={design} brand={publicBrandName(tenant.display_name)} title={activeDesign.name} summary={activeDesign.summary} />
    </section>
  </div>;
}

function Axes({ tenant, axes, options, onRefresh }: { tenant: Tenant; axes: TenantDetailPayload["axes"]; options: AdminOptions; onRefresh: () => Promise<void> }) {
  const [aiBusy, setAiBusy] = useState(false);
  async function saveAxis(axis: Axis, form: HTMLFormElement) {
    const values = parseCsv(String(new FormData(form).get("values") || ""));
    await replaceAxis(tenant.domain, axis, values); await onRefresh();
  }
  async function preset(form: HTMLFormElement) { const preset_key = String(new FormData(form).get("preset_key") || ""); await api(`/tenants/${encodeURIComponent(tenant.domain)}/axes/preset`, { method: "POST", body: JSON.stringify({ preset_key }) }); await onRefresh(); }
  async function ai(form: HTMLFormElement) { setAiBusy(true); try { const fd = new FormData(form); await api(`/tenants/${encodeURIComponent(tenant.domain)}/axes/ai-fill`, { method: "POST", body: JSON.stringify({ provider: fd.get("provider"), model: fd.get("model"), extra_context: fd.get("extra_context"), timeout_sec: 300 }) }); await onRefresh(); } catch (e) { alert((e as Error).message); } finally { setAiBusy(false); } }
  return <div className="grid">
    <div className="grid grid-2">
      <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); ai(e.currentTarget); }}><h2>🤖 AI로 축 자동 생성</h2><textarea className="textarea" name="extra_context" placeholder="추가 컨텍스트" /><div className="row"><select className="select" name="provider" style={{ maxWidth: 160 }}><option>codex</option><option>claude</option></select><input className="input" name="model" placeholder="모델 선택" style={{ maxWidth: 180 }} /><button className="btn primary" disabled={aiBusy}>{aiBusy ? "생성 중..." : "생성"}</button></div></form>
      <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); if (confirm("현재 축을 프리셋으로 덮어쓸까요?")) preset(e.currentTarget); }}><h2>프리셋 적용</h2><select className="select" name="preset_key">{options.preset_options.map((p) => <option key={p}>{p}</option>)}</select><button className="btn">덮어쓰기</button></form>
    </div>
    {AXES.map((axis) => <form key={axis} className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); saveAxis(axis, e.currentTarget); }}><div className="spread"><h2>{axis} 축 ({axes[axis]?.length ?? 0}개)</h2><button className="btn primary">저장</button></div><textarea className="textarea mono" name="values" rows={6} defaultValue={(axes[axis] ?? []).map((r) => `${r.value},${r.weight},${r.monthly_search_volume ?? ""},${r.competition_kd ?? ""}`).join("\n")} placeholder="값,가중치,월검색량,KD" /></form>)}
  </div>;
}

function Academies({ tenant, academies, onRefresh }: { tenant: Tenant; academies: Academy[]; onRefresh: () => Promise<void> }) {
  const [syncBusy, setSyncBusy] = useState("");
  const [regionLevel, setRegionLevel] = useState<"2" | "3" | "all">("2");
  const [replaceRegionAxis, setReplaceRegionAxis] = useState(true);
  const [syncResult, setSyncResult] = useState("");
  const isDriving = tenant.vertical === "driving";
  const sourceFields = isDriving ? ["region","name","address","price","shuttle","hours","pass_rate","phone","source_name","source_url","review"] : ["region","name","address","price","hours","phone","source_name","source_url","review"];
  async function add(form: HTMLFormElement) { const fd = Object.fromEntries(new FormData(form).entries()); await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies`, { method: "POST", body: JSON.stringify(fd) }); form.reset(); await onRefresh(); }
  async function bulk(form: HTMLFormElement) { const text = String(new FormData(form).get("json") || ""); await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies`, { method: "POST", body: text }); form.reset(); await onRefresh(); }
  async function del(id: string) { if (!confirm("삭제할까요?")) return; await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies/${id}`, { method: "DELETE" }); await onRefresh(); }
  async function syncAcademies() {
    setSyncBusy("academies");
    try {
      const res = await syncDrivingplusAcademies(tenant.domain, { include_blog_reviews: true, blog_review_limit: 3 });
      setSyncResult(`자료/리뷰 ${res.fetched}개 조회 · ${res.upserted}개 반영 · ${res.skipped}개 제외${res.warnings?.length ? ` · 경고 ${res.warnings.length}개` : ""}`);
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  async function syncRegions() {
    setSyncBusy("regions");
    try {
      const res = await syncDrivingplusRegions(tenant.domain, { level: regionLevel, replace_axis: replaceRegionAxis, max: regionLevel === "3" ? 500 : 10000 });
      setSyncResult(`지역 ${res.fetched}개 조회 · ${res.upserted}개 반영${res.axis_replaced ? " · region 축 교체" : ""}`);
      await onRefresh();
    } catch (e) { alert((e as Error).message); }
    finally { setSyncBusy(""); }
  }
  return <div className="grid">
    {isDriving ? <div className="card card-pad grid">
      <div className="spread"><div><h2>DrivingPlus 원천 데이터 동기화</h2><p className="muted">Swagger API의 학원/지역 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 사용합니다.</p></div><span className="badge info">{academies.length}개 자료</span></div>
      <div className="grid grid-3">
        <Field label="지역 레벨"><select className="select" value={regionLevel} onChange={(e) => setRegionLevel(e.target.value as "2" | "3" | "all")}><option value="2">시군구(level=2, 권장)</option><option value="3">읍면동(level=3, 최대 500개)</option><option value="all">전체</option></select></Field>
        <Field label="지역 축 반영"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={replaceRegionAxis} onChange={(e) => setReplaceRegionAxis(e.target.checked)} /> axes.region 교체</label></Field>
        <div className="row" style={{ alignItems: "end" }}><button className="btn" onClick={syncRegions} disabled={Boolean(syncBusy)}>{syncBusy === "regions" ? "지역 동기화 중..." : "지역 동기화"}</button><button className="btn primary" onClick={syncAcademies} disabled={Boolean(syncBusy)}>{syncBusy === "academies" ? "자료 동기화 중..." : "자료 동기화"}</button></div>
      </div>
      {syncResult && <p className="small badge success" style={{ width: "fit-content" }}>{syncResult}</p>}
      <p className="muted small">권장 순서: 지역 동기화(level=2, 축 교체) → 원천자료 동기화(사진·별점리뷰·블로그 리뷰 포함) → 슬롯 탭에서 후보 생성.</p>
    </div> : <div className="card card-pad"><p className="muted">건강/일반 도메인은 확인된 자료만 직접 넣어 사용합니다. 확인되지 않은 의학적 효능, 가격, 후기는 생성하지 않도록 프롬프트에서 제한합니다.</p></div>}
    <div className="card card-pad"><p className="muted">슬롯 지역과 주제에 맞는 원천자료가 글 생성 프롬프트에 주입됩니다. 자료가 부족하면 부족한 상태 그대로 설명하고, 없는 가격·후기·효능은 만들지 않습니다.</p></div>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}><h2>자료 1건 추가</h2><div className="grid grid-3">{sourceFields.map((n) => <input key={n} className="input" name={n} placeholder={n} required={n === "name"} />)}</div><button className="btn primary">추가</button></form>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); bulk(e.currentTarget); }}><h2>JSON 일괄 업로드</h2><textarea className="textarea mono" name="json" placeholder='[{"region":"전국","name":"건강검진 준비사항","price":"기관별 상이"}]' /><button className="btn">업로드</button></form>
    <div className="table-wrap"><table><thead><tr><th>지역</th><th>자료명</th><th>연락/사진</th><th>SEO 설명</th><th>출처</th><th></th></tr></thead><tbody>{academies.map((a) => {
      const photoCount = parsePhotoCount(a.photos);
      const reviewCount = parseJsonCount(a.review_json);
      const blogReviewCount = parseJsonCount(a.blog_reviews);
      return <tr key={a.id}><td>{a.region}</td><td><b>{a.name}</b><p className="muted small">{a.address}</p><p className="muted small">{a.academy_type || ""}{a.external_id ? ` · #${a.external_id}` : ""}</p></td><td>{a.vphone || a.phone}<p className="muted small">{photoCount ? `사진 ${photoCount}장` : "사진 없음"} · 리뷰 {reviewCount}개 · 블로그 {blogReviewCount}개</p></td><td><span className="small">{a.seo_description || a.review || "-"}</span></td><td>{a.source_url ? <a href={a.source_url} target="_blank">{a.source_name || "링크"}</a> : a.source_name}</td><td><button className="btn danger" onClick={() => del(a.id)}>삭제</button></td></tr>;
    })}</tbody></table></div>
  </div>;
}

function Slots({ tenant, slots, options, onRefresh, onTab }: { tenant: Tenant; slots: Slot[]; options: AdminOptions; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [selected, setSelected] = useState(new Set<string>());
  const [status, setStatus] = useState("planned");
  const [template, setTemplate] = useState("");
  const [q, setQ] = useState("");
  const [provider, setProvider] = useState<Provider>("codex");
  const [model, setModel] = useState("");
  const [cooldown, setCooldown] = useState(60);
  const [timeout, setTimeout] = useState(600);
  const [web, setWeb] = useState(true);
  const [max, setMax] = useState(200);
  const [remoteSlots, setRemoteSlots] = useState(slots);
  const [remoteTotal, setRemoteTotal] = useState(slots.length);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotError, setSlotError] = useState("");

  useEffect(() => { setRemoteSlots(slots); setRemoteTotal(slots.length); }, [slots]);

  async function loadCurrentSlots() {
    setLoadingSlots(true); setSlotError("");
    try {
      const payload = await listSlots(tenant.domain, { status, template, q, limit: 1000 });
      setRemoteSlots(payload.items); setRemoteTotal(payload.total ?? payload.count);
    } catch (err) { setSlotError(err instanceof Error ? err.message : String(err)); }
    finally { setLoadingSlots(false); }
  }
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setLoadingSlots(true); setSlotError("");
      try {
        const payload = await listSlots(tenant.domain, { status, template, q, limit: 1000 });
        if (!cancelled) { setRemoteSlots(payload.items); setRemoteTotal(payload.total ?? payload.count); setSelected(new Set()); }
      } catch (err) { if (!cancelled) setSlotError(err instanceof Error ? err.message : String(err)); }
      finally { if (!cancelled) setLoadingSlots(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(handle); };
  }, [tenant.domain, status, template, q]);

  const filtered = remoteSlots;
  const expectedMinutes = Math.max(1, Math.ceil(((selected.size || 1) * (cooldown + 30)) / 60));
  const selectedAllVisible = filtered.length > 0 && filtered.every((s) => selected.has(s.slot_id));
  const writerPayload = { provider, model, design_template_id: tenant.design_template_id, use_web_research: web, cooldown_sec: cooldown, timeout_sec: timeout };

  async function gen() { await api(`/tenants/${encodeURIComponent(tenant.domain)}/slots/generate`, { method: "POST", body: JSON.stringify({ max_per_template: max }) }); await onRefresh(); await loadCurrentSlots(); }
  async function queue(ids: string[]) { if (!ids.length) return; const r = await enqueueGenerate(tenant.domain, { slot_ids: ids, ...writerPayload }); alert(`작업 큐 등록: ${r.job_id} · ${r.slot_count ?? ids.length}개\\n작업 탭에서 진행상태를 확인하세요.`); setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); onTab("jobs"); }
  async function smartQueue(label: string, body: Record<string, unknown>) {
    const count = Number(body.max || 1);
    if (count >= 50 && !confirm(`${label}: ${count}개 글 작성을 큐에 등록할까요?`)) return;
    const r = await enqueueGenerate(tenant.domain, { ...body, ...writerPayload });
    alert(`${label} 큐 등록: ${r.job_id} · ${r.slot_count ?? count}개\\n작업 탭에서 진행상태를 확인하세요.`);
    setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); onTab("jobs");
  }
  async function delSelected() { if (!confirm(`${selected.size}개 삭제?`)) return; for (const id of selected) await api(`/tenants/${encodeURIComponent(tenant.domain)}/slots/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); await loadCurrentSlots(); }
  function toggleAllVisible() { setSelected((prev) => { if (selectedAllVisible) return new Set(); const next = new Set(prev); for (const s of filtered) next.add(s.slot_id); return next; }); }

  return <div className="grid"><div className="card card-pad grid"><h2>글 후보 만들기/작성</h2><div className="grid grid-4"><Field label="템플릿당 최대"><input className="input" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} /></Field><Field label="작성 엔진"><select className="select" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{options.providers.map((p) => <option key={p}>{p}</option>)}</select></Field><Field label="모델"><input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="비우면 기본 codex" /></Field><Field label="제한시간"><input className="input" type="number" value={timeout} onChange={(e) => setTimeout(Number(e.target.value))} /></Field></div><div className="row"><button className="btn primary" onClick={gen}>재료로 글 후보 만들기</button><button className="btn" onClick={() => smartQueue("1개 테스트 작성", { max: 1, q, template })}>1개 테스트 작성</button><button className="btn" onClick={() => smartQueue("현재 검색 10개 작성", { max: 10, q, template })}>현재 검색 10개 작성</button><button className="btn" onClick={() => smartQueue("전국 골고루 100개 작성", { max: 100, balanced: true })}>전국 골고루 100개 작성</button><label className="row small"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> 웹 자료 수집 후 작성</label><Field label="대량 대기시간"><input className="input" type="number" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} /></Field></div><div className="writer-hint"><b>작성 옵션</b><span>{provider}{model ? ` / ${model}` : " / 기본"}</span><span>디자인 {tenant.design_template_id ?? "editorial"}</span><span>웹자료 {web ? "사용" : "미사용"}</span><span>선택 기준 예상 {expectedMinutes}분</span></div><p className="muted small">추천 흐름: 1개 테스트 작성 → QA 확인 → 현재 검색 10개 → 전국 골고루 100개. 전국 작성은 지역을 라운드로빈으로 섞어 특정 지역 쏠림을 줄입니다.</p></div><div className="row"><select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["planned","in_progress","published","failed","pruned"].map((s) => <option key={s}>{s}</option>)}</select><select className="select" style={{ width: 150 }} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">전체 유형</option>{options.templates.map((t) => <option key={t}>{t}</option>)}</select><input className="input" style={{ width: 320 }} placeholder="지역/키워드/슬롯 검색 예: 서울, 강남구" value={q} onChange={(e) => setQ(e.target.value)} />{["서울","강남구","송파구","경기","부산","대구","제주"].map((label) => <button className="btn" key={label} onClick={() => setQ(label)}>{label}</button>)}<span className="muted small">{selected.size}개 선택 / {remoteTotal.toLocaleString()}개{loadingSlots ? " 검색 중" : ""}</span><button className="btn primary" disabled={!selected.size} onClick={() => queue(Array.from(selected))}>선택 글 작성</button><button className="btn danger" disabled={!selected.size} onClick={delSelected}>삭제</button></div><p className="muted small">슬롯은 전체 후보에서 서버 검색합니다. “현재 검색 10개 작성”은 검색어/유형 조건 안에서 주제가 겹치지 않게 선별합니다.</p>{slotError && <p className="small" style={{ color: "var(--danger)" }}>슬롯 검색 오류: {slotError}</p>}<div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={selectedAllVisible} onChange={toggleAllVisible} /></th><th>유형</th><th>키워드</th><th>지역</th><th>페르소나</th><th>점수</th><th>상태</th></tr></thead><tbody>{filtered.map((s) => <tr key={s.slot_id}><td><input type="checkbox" checked={selected.has(s.slot_id)} onChange={() => setSelected((p) => { const n = new Set(p); n.has(s.slot_id) ? n.delete(s.slot_id) : n.add(s.slot_id); return n; })} /></td><td><span className="badge">{s.template_id}</span></td><td><b>{s.primary_keyword}</b><p className="muted small mono">{s.slot_id}</p>{s.last_error && <p className="small" style={{ color: "var(--danger)" }}>{s.last_error}</p>}</td><td>{s.region ?? "-"}</td><td>{s.persona ?? "-"}</td><td>{s.priority_score?.toFixed(1) ?? "-"}</td><td><Status status={s.status} /></td></tr>)}</tbody></table></div></div>;
}

function Jobs({ tenant, jobs, onRefresh }: { tenant: Tenant; jobs: Job[]; onRefresh: () => Promise<void> }) {
  const [status, setStatus] = useState("");
  useEffect(() => {
    const id = window.setInterval(() => onRefresh().catch(() => undefined), 3000);
    return () => window.clearInterval(id);
  }, [onRefresh]);
  const filtered = jobs.filter((job) => !status || job.status === status);
  const counts = jobs.reduce<Record<string, number>>((acc, job) => {
    acc[job.status] = (acc[job.status] ?? 0) + 1;
    return acc;
  }, {});
  const active = (counts.queued ?? 0) + (counts.running ?? 0);
  return <div className="grid">
    <div className="card card-pad grid">
      <div className="spread"><div><h2>작업 상태판</h2><p className="muted">글 작성/중복검사/가지치기/색인 작업을 이 화면에서 바로 확인합니다. 3초마다 자동 새로고침됩니다.</p></div><button className="btn" onClick={onRefresh}>새로고침</button></div>
      <div className="grid grid-4"><Stat label="대기" value={counts.queued ?? 0} /><Stat label="진행" value={counts.running ?? 0} /><Stat label="완료" value={counts.done ?? 0} accent /><Stat label="실패" value={counts.failed ?? 0} /></div>
      <div className="writer-hint"><b>운영 순서</b><span>슬롯 탭에서 작성 등록</span><span>작업 탭에서 진행 확인</span><span>완료 후 글 탭에서 검수</span><span>필요 시 npm run worker:once</span></div>
      {active > 0 && <p className="muted small">대기/진행 작업이 멈춰 있으면 서버 터미널에서 <code>npm run worker:once</code>를 실행해 처리할 수 있습니다.</p>}
    </div>
    <div className="row">
      <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["queued", "running", "done", "failed"].map((s) => <option key={s}>{s}</option>)}</select>
      <span className="muted small">{filtered.length}개 표시 / 전체 {jobs.length}개</span>
      <Link href="/jobs" className="btn">전체 작업 큐 열기</Link>
    </div>
    {filtered.length === 0 && <div className="card card-pad muted">아직 작업이 없습니다. 슬롯 탭에서 “1개 테스트 작성”부터 등록하세요.</div>}
    <div className="grid">{filtered.map((job) => <TenantJobCard key={job.id} job={job} tenant={tenant} />)}</div>
  </div>;
}

function TenantJobCard({ job, tenant }: { job: Job; tenant: Tenant }) {
  const total = jobTotal(job);
  const ok = num(job.result_obj?.ok);
  const fail = num(job.result_obj?.fail);
  const done = ok + fail;
  const percent = job.status === "done" || job.status === "failed" ? 100 : job.status === "running" ? Math.max(20, Math.min(90, Math.round((done / Math.max(total, 1)) * 100) || 35)) : 5;
  const slotIds = Array.isArray(job.payload_obj?.slot_ids) ? job.payload_obj.slot_ids : [];
  return <details className="card" open={job.status === "running" || job.status === "failed"}>
    <summary className="spread" style={{ padding: 16, cursor: "pointer" }}>
      <div className="row"><Status status={job.status} /><b>{job.kind}</b><span className="muted small">{jobLabel(job)}</span></div>
      <span className="muted small">{formatDateTime(job.scheduled_at)}</span>
    </summary>
    <div className="card-pad grid" style={{ borderTop: "1px solid var(--line)" }}>
      <div className="progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="grid grid-4"><Stat label="대상" value={total} /><Stat label="성공" value={ok} accent /><Stat label="실패" value={fail} /><Stat label="진행률" value={percent} /></div>
      <div className="writer-hint"><b>작업 옵션</b><span>엔진 {String(job.payload_obj?.provider ?? "codex")}</span><span>모델 {String(job.payload_obj?.model || "기본")}</span><span>디자인 {String(job.payload_obj?.design_template_id ?? tenant.design_template_id ?? "editorial")}</span><span>웹자료 {job.payload_obj?.use_web_research === false ? "미사용" : "사용"}</span></div>
      <p className="muted small">예약 {formatDateTime(job.scheduled_at)} · 시작 {formatDateTime(job.started_at)} · 완료 {formatDateTime(job.finished_at)} · 대기 {String(job.payload_obj?.cooldown_sec ?? "-")}초 · 제한 {String(job.payload_obj?.timeout_sec ?? "-")}초</p>
      {slotIds.length > 0 && <p className="muted small mono">슬롯 {slotIds.slice(0, 8).join(", ")}{slotIds.length > 8 ? ` 외 ${slotIds.length - 8}개` : ""}</p>}
      {job.error && <p className="toast-error">{job.error}</p>}
      {job.result_obj?.per_slot && <details><summary className="small muted">개별 결과 보기</summary><pre className="codebox small">{JSON.stringify(job.result_obj.per_slot, null, 2)}</pre></details>}
      <details><summary className="small muted">원본 payload/result</summary><pre className="codebox small">{JSON.stringify({ payload: job.payload_obj, result: job.result_obj }, null, 2)}</pre></details>
    </div>
  </details>;
}

function Posts({ tenant, posts, onRefresh }: { tenant: Tenant; posts: PostSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(new Set<string>()); const [q, setQ] = useState("");
  const filtered = posts.filter((p) => !q || `${p.title} ${p.slug}`.toLowerCase().includes(q.toLowerCase()));
  async function job(kind: "dedup" | "prune" | "indexing") { const path = kind === "indexing" ? "indexing" : kind; await api(`/tenants/${encodeURIComponent(tenant.domain)}/jobs/${path}`, { method: "POST", body: JSON.stringify(kind === "dedup" ? { threshold: 0.75 } : kind === "prune" ? { min_body_chars: 700, stale_noindex_days: 90 } : { max: 200 }) }); alert(`${kind} 작업 등록`); }
  async function makeShorts() { const ids = Array.from(selected); const res = await enqueueSocialGenerate(tenant.domain, { post_ids: ids, style_id: tenant.video_style_id || "card-news-clean", platform: "youtube_shorts" }); alert(`숏츠 패키지 작업 등록: ${res.job_id} · ${res.post_count ?? ids.length}개`); setSelected(new Set()); await onRefresh(); }
  async function delSelected() { if (!confirm(`${selected.size}개 삭제?`)) return; for (const id of selected) await api(`/tenants/${encodeURIComponent(tenant.domain)}/posts/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); }
  function downloadMarkdown() { const chosen = posts.filter((p) => selected.has(p.id)); const text = chosen.map((p) => `# ${p.title}\n\nslug: ${p.slug}\n`).join("\n---\n"); const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); const a = document.createElement("a"); a.href = url; a.download = `${tenant.domain}-posts.md`; a.click(); URL.revokeObjectURL(url); }
  return <div className="grid"><div className="row"><input className="input" style={{ width: 260 }} placeholder="제목/슬러그 검색" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small">{selected.size}개 선택 / {filtered.length}개</span><button className="btn" onClick={makeShorts} disabled={!selected.size}>선택 숏츠 패키지</button><button className="btn" onClick={() => job("dedup")} disabled={posts.length < 2}>중복 검사</button><button className="btn" onClick={() => job("prune")} disabled={!posts.length}>가지치기</button><button className="btn" onClick={() => job("indexing")} disabled={!posts.length}>색인 요청</button><button className="btn" onClick={downloadMarkdown} disabled={!selected.size}>Markdown Export</button><button className="btn danger" onClick={delSelected} disabled={!selected.size}>삭제</button></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)))} /></th><th>제목</th><th>디자인</th><th>숏츠</th><th>자수</th><th>provider</th><th>$</th><th>생성일</th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><input type="checkbox" checked={selected.has(p.id)} onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /></td><td><Link href={`/t/${encodeURIComponent(tenant.domain)}/post/${p.id}`}><b>{p.title}</b></Link><p className="muted small mono">{p.slug}</p></td><td><span className="badge">{p.design_template_id ?? tenant.design_template_id}</span></td><td>{p.social_package_count ? <span className="badge success">{p.social_package_count}개</span> : <span className="badge">없음</span>}</td><td>{p.body_chars?.toLocaleString()}</td><td>{p.provider}</td><td>{p.cost_usd ? p.cost_usd.toFixed(3) : "-"}</td><td className="small muted">{formatDateTime(p.generated_at)}</td></tr>)}</tbody></table></div></div>;
}

function Shorts({ tenant, posts, packages, options, onRefresh }: { tenant: Tenant; posts: PostSummary[]; packages: SocialPackage[]; options: AdminOptions; onRefresh: () => Promise<void> }) {
  const [selectedPosts, setSelectedPosts] = useState(new Set<string>());
  const [selectedPackages, setSelectedPackages] = useState(new Set<string>());
  const [platform, setPlatform] = useState("youtube_shorts");
  const [styleId, setStyleId] = useState(tenant.video_style_id ?? "card-news-clean");
  const [cardCount, setCardCount] = useState(8);
  const selectedPackageRows = packages.filter((pkg) => selectedPackages.has(pkg.id));
  async function generateForSelected() {
    const ids = Array.from(selectedPosts);
    const res = await enqueueSocialGenerate(tenant.domain, { post_ids: ids, platform, style_id: styleId, card_count: cardCount });
    alert(`숏츠 패키지 생성 작업 등록: ${res.job_id} · ${res.post_count ?? ids.length}개`);
    setSelectedPosts(new Set());
    await onRefresh();
  }
  async function generateRecent() {
    const res = await enqueueSocialGenerate(tenant.domain, { max: Math.min(10, Math.max(1, posts.length)), platform, style_id: styleId, card_count: cardCount });
    alert(`최근 글 숏츠 생성 작업 등록: ${res.job_id} · ${res.post_count ?? 0}개`);
    await onRefresh();
  }
  async function renderSelected() {
    for (const pkg of selectedPackageRows) await enqueueSocialRender(tenant.domain, pkg.id, { renderer: "remotion", fps: 30 });
    alert(`${selectedPackageRows.length}개 렌더 manifest 작업 등록`);
    setSelectedPackages(new Set());
    await onRefresh();
  }
  function downloadPackage(pkg: SocialPackage) {
    const payload = {
      package_id: pkg.id,
      tenant: pkg.tenant,
      post_id: pkg.post_id,
      title: pkg.title,
      platform: pkg.platform,
      style_id: pkg.style_id,
      cards: pkg.cards_obj,
      script: pkg.script,
      caption: pkg.caption,
      hashtags: pkg.hashtags_obj,
      render_spec: pkg.render_spec_obj,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tenant.domain}-${pkg.post_slug || pkg.id}-shorts.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return <div className="grid">
    <section className="card card-pad grid">
      <div className="spread"><div><h2>숏츠/Reels 자동화</h2><p className="muted">글을 카드뉴스형 숏츠 패키지로 변환하고 Remotion 렌더 manifest를 만듭니다.</p></div><span className="badge info">{packages.length}개 패키지</span></div>
      <div className="grid grid-4">
        <Field label="플랫폼"><select className="select" value={platform} onChange={(e) => setPlatform(e.target.value)}>{options.social_platforms.map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="영상 스타일"><select className="select" value={styleId} onChange={(e) => setStyleId(e.target.value)}>{options.video_styles.map((style) => <option key={style.id} value={style.id}>{style.name}</option>)}</select></Field>
        <Field label="카드 수"><input className="input" type="number" min={5} max={12} value={cardCount} onChange={(e) => setCardCount(Number(e.target.value))} /></Field>
        <div className="row" style={{ alignItems: "end" }}><button className="btn" onClick={generateRecent} disabled={!posts.length}>최근 글 10개</button><button className="btn primary" onClick={generateForSelected} disabled={!selectedPosts.size}>선택 글 생성</button></div>
      </div>
      <p className="muted small">1차 발행 방식은 MP4/캡션/해시태그를 내려받아 수동 업로드하는 구조입니다. API 직접 발행은 채널 인증이 붙은 뒤 확장합니다.</p>
    </section>

    <section className="grid" style={{ gridTemplateColumns: "minmax(280px, 420px) minmax(0, 1fr)", alignItems: "start" }}>
      <div className="card card-pad grid">
        <div className="spread"><h2>글 선택</h2><span className="muted small">{selectedPosts.size}개 선택</span></div>
        <div className="short-list">
          {posts.length === 0 && <p className="muted small">먼저 글을 생성하세요.</p>}
          {posts.slice(0, 80).map((post) => <label key={post.id} className="short-row">
            <input type="checkbox" checked={selectedPosts.has(post.id)} onChange={() => setSelectedPosts((prev) => { const next = new Set(prev); next.has(post.id) ? next.delete(post.id) : next.add(post.id); return next; })} />
            <span><b>{post.title}</b><em>{post.slug} · 숏츠 {post.social_package_count ?? 0}개</em></span>
          </label>)}
        </div>
      </div>

      <div className="grid">
        <div className="row"><button className="btn" onClick={renderSelected} disabled={!selectedPackages.size}>선택 Remotion manifest</button><span className="muted small">{selectedPackages.size}개 패키지 선택</span></div>
        {packages.length === 0 && <div className="card card-pad muted">아직 숏츠 패키지가 없습니다. 글을 선택하고 “선택 글 생성”을 누르세요.</div>}
        {packages.map((pkg) => <details className="card" key={pkg.id} open={pkg.status === "failed"}>
          <summary className="spread" style={{ padding: 16, cursor: "pointer" }}>
            <div className="row"><input type="checkbox" checked={selectedPackages.has(pkg.id)} onClick={(e) => e.stopPropagation()} onChange={() => setSelectedPackages((prev) => { const next = new Set(prev); next.has(pkg.id) ? next.delete(pkg.id) : next.add(pkg.id); return next; })} /><Status status={pkg.status} /><b>{pkg.title}</b><span className="badge">{pkg.platform}</span><span className="badge">{pkg.style_id}</span></div>
            <span className="muted small">{formatDateTime(pkg.updated_at)}</span>
          </summary>
          <div className="card-pad grid" style={{ borderTop: "1px solid var(--line)" }}>
            <p className="muted small">원문: {pkg.post_title || pkg.post_slug || pkg.post_id}</p>
            {pkg.error && <p className="toast-error">{pkg.error}</p>}
            <div className="shorts-preview">{pkg.cards_obj.map((card) => <div className={`short-card ${card.role}`} key={`${pkg.id}-${card.index}`}><span>{card.index}</span><b>{card.title}</b><p>{card.body}</p></div>)}</div>
            <div className="grid grid-2">
              <div><h3>캡션</h3><pre className="codebox small">{pkg.caption || ""}</pre></div>
              <div><h3>대본</h3><pre className="codebox small">{pkg.script || ""}</pre></div>
            </div>
            <div className="row"><button className="btn" onClick={() => downloadPackage(pkg)}>JSON 다운로드</button><button className="btn primary" onClick={async () => { const res = await enqueueSocialRender(tenant.domain, pkg.id); alert(`렌더 manifest 작업 등록: ${res.job_id}`); await onRefresh(); }}>Remotion manifest</button></div>
            {Object.keys(pkg.render_spec_obj || {}).length > 0 && <details><summary className="small muted">render spec</summary><pre className="codebox small">{JSON.stringify(pkg.render_spec_obj, null, 2)}</pre></details>}
          </div>
        </details>)}
      </div>
    </section>
  </div>;
}

function Settings({ tenant, options, onSave, onRefresh }: { tenant: Tenant; options: AdminOptions; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState({ display_name: tenant.display_name, vertical: tenant.vertical, theme: tenant.theme, brand_color: tenant.brand_color ?? "#5132d7", daily_limit: tenant.daily_limit }); const [sa, setSa] = useState(""); const [url, setUrl] = useState(options.indexing.url_template);
  async function saveIndexing() { await api("/settings/indexing", { method: "PUT", body: JSON.stringify({ sa_json: sa, url_template: url }) }); setSa(""); await onRefresh(); alert("색인 설정 저장됨"); }
  async function deleteTenant() { if (!confirm("정말 삭제할까요? 모든 데이터가 삭제됩니다.")) return; await api(`/tenants/${encodeURIComponent(tenant.domain)}`, { method: "DELETE" }); location.href = "/"; }
  return <div className="grid grid-2"><div className="card card-pad grid"><h2>메타 정보</h2><Field label="표시 이름"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field><div className="grid grid-2"><Field label="업종"><input className="input" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} /></Field><Field label="테마"><select className="select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>{options.themes.map((t) => <option key={t}>{t}</option>)}</select></Field></div><div className="grid grid-2"><Field label="브랜드 컬러"><input className="input" type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} /></Field><Field label="일일 한도"><input className="input" type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} /></Field></div><button className="btn primary" onClick={() => onSave(form)}>저장</button></div><div className="card card-pad grid"><h2>Google 색인 설정</h2><p className="muted small">현재 키 상태: {options.indexing.has_key ? "설정됨" : "미설정"}</p><Field label="서비스계정 JSON"><textarea className="textarea mono" value={sa} onChange={(e) => setSa(e.target.value)} placeholder="이미 저장됨 — 교체하려면 새 JSON 붙여넣기" /></Field><Field label="발행 URL 템플릿"><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></Field><button className="btn" onClick={saveIndexing}>색인 설정 저장</button><hr /><button className="btn danger" onClick={deleteTenant}>도메인 삭제</button></div></div>;
}

function DesignPreview({ blueprint, designId, brand, title, summary }: { blueprint: typeof DESIGN_BLUEPRINTS[string]; designId: string; brand: string; title: string; summary: string }) {
  const spec = PREVIEW_DESIGN_SPECS[designId] ?? PREVIEW_DESIGN_SPECS.editorial;
  return <aside className="preview-panel">
    <div className="preview-head"><div><b>디자인 미리보기</b><p className="muted small">{blueprint.label}</p></div><span className="badge info">{designId}</span></div>
    <div className={`preview-phone design-${designId}`}>
      <div className="preview-top"><div><b>{brand}</b><p>{blueprint.tone}</p></div><span className="preview-cta">{spec.topCta}</span></div>
      <div className="preview-hero"><span>대표 영역</span></div>
      <div className="preview-body">
        <div className="preview-meta"><span>26.04.03</span><span>조회 0</span></div>
        <h4>{blueprint.title}</h4>
        <div className="preview-divider" />
        <div className="row">{blueprint.chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
        <p className="muted small">{blueprint.lead}</p>
        {blueprint.blocks.map((block) => <PreviewBlock key={block.title} block={block} />)}
        <section className="preview-bottom-cta"><b>{brand}에서 {spec.bottomCta}</b><button className="btn primary">{spec.bottomCta}</button></section>
      </div>
    </div>
    <div className="card card-pad preview-spec">
      <h3>{title}</h3>
      <p className="muted small">{summary}</p>
      <p className="small"><b>톤:</b> {blueprint.tone}</p>
      <div className="row">{blueprint.sections.map((s) => <span className="badge" key={s}>{s}</span>)}</div>
    </div>
  </aside>;
}

function PreviewBlock({ block }: { block: typeof DESIGN_BLUEPRINTS[string]["blocks"][number] }) {
  if (block.kind === "table") return <div className="preview-block"><b>{block.title}</b><div className="mini-table"><span>항목</span><span>장점</span><span>추천</span><span>선택지 A</span><span>준비 쉬움</span><span>직장인</span><span>선택지 B</span><span>주의사항</span><span>부모님</span></div><p>{block.body}</p></div>;
  if (block.kind === "quote") return <blockquote className="preview-quote">{block.body}</blockquote>;
  if (block.kind === "cta") return <div className="preview-block preview-cta-block"><b>{block.title}</b><p>{block.body}</p><button className="btn primary">다음 행동으로 연결</button></div>;
  if (block.kind === "list") return <div className="preview-block"><b>{block.title}</b><ul>{block.body.split("|").map((item) => <li key={item}>✓ {item}</li>)}</ul></div>;
  return <div className="preview-block"><b>{block.title}</b><p>{block.body}</p></div>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Status({ status }: { status: string }) { const cls = status === "published" || status === "done" ? "success" : status === "failed" ? "danger" : status === "running" || status === "in_progress" ? "info" : status === "planned" || status === "queued" ? "warn" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
function num(value: unknown): number { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function jobTotal(job: Job): number {
  if (Array.isArray(job.payload_obj?.slot_ids)) return job.payload_obj.slot_ids.length;
  if (Array.isArray(job.payload_obj?.post_ids)) return job.payload_obj.post_ids.length;
  if (Array.isArray(job.payload_obj?.package_ids)) return job.payload_obj.package_ids.length;
  return num(job.result_obj?.total_posts ?? job.result_obj?.total ?? job.payload_obj?.max) || 1;
}
function jobLabel(job: Job): string {
  if (job.kind === "generate") return `${jobTotal(job)}개 글 작성`;
  if (job.kind === "social_generate") return `${jobTotal(job)}개 숏츠 패키지 생성`;
  if (job.kind === "video_render") return `${jobTotal(job)}개 Remotion manifest`;
  if (job.kind === "site_deploy") return "사이트 배포 체크포인트";
  if (job.kind === "dedup") return "중복 검사";
  if (job.kind === "prune") return "품질 가지치기";
  if (job.kind === "indexing") return "Google 색인 요청";
  return job.kind;
}
function parseLines(text: string) { return Array.from(new Set(text.split(/[\n,]/).map((v) => v.trim()).filter(Boolean))); }
function parseCsv(text: string): AxisValue[] { return text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => { const [value, weight, sv, kd] = line.split(",").map((x) => x.trim()); return { value, weight: Number(weight || 3), monthly_search_volume: sv ? Number(sv) : null, competition_kd: kd ? Number(kd) : null }; }).filter((v) => v.value); }
function parsePhotoCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}
function parseJsonCount(value: unknown): number {
  if (!value) return 0;
  if (Array.isArray(value)) return value.length;
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch { return 0; }
}
function publicBrandName(value: string): string {
  return value.replace(/\s*(?:샘플|데모)\s*$/u, "").trim() || value;
}
