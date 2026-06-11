"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, enqueueGenerate, getOptions, getTenantDetail, replaceAxis, syncDrivingplusAcademies, syncDrivingplusRegions, updateTenant } from "@/lib/api";
import type { Academy, AdminOptions, Axis, AxisValue, Job, PostSummary, Provider, Slot, SlotCounts, Tenant, TenantDetailPayload } from "@/lib/types";

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
  keyword: "운전면허학원\n운전면허 비용\n도로주행 시험",
  intent: "빠른 합격\n비용 절약\n초보자 준비",
  persona: "직장인\n대학생\n장롱면허",
  modifier: "셔틀 편리\n친절한 강사\n최단기",
};
const TABS = [
  ["overview", "개요"], ["plan", "기획"], ["templates", "글유형/디자인"], ["axes", "축"],
  ["academies", "학원자료"], ["slots", "슬롯"], ["posts", "글"], ["settings", "설정"],
] as const;
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
    title: "운전면허 처음 준비할 때 알아야 할 절차와 비용",
    lead: "초보자가 검색해서 들어왔을 때 필요한 배경 설명, 이미지, FAQ가 자연스럽게 이어집니다.",
    chips: ["가이드", "FAQ", "정보성"],
    sections: ["상단 CTA", "대표 이미지", "중앙 제목", "본문", "예약 CTA"],
    tone: "차분하고 친절한 전문가 톤",
    blocks: [
      { title: "도입", body: "왜 이 정보를 찾는지 공감한 뒤, 글에서 바로 얻을 수 있는 내용을 짧게 알려줍니다." },
      { title: "핵심 설명", body: "절차, 비용, 기간을 순서대로 풀고 중간에 이미지를 배치합니다." },
      { title: "FAQ", body: "처음 등록해도 되나요?|주말에도 가능한가요?|추가 비용은 언제 생기나요?", kind: "list" },
      { title: "자연스러운 CTA", body: "주변 학원 찾기나 예약 확인으로 부드럽게 연결합니다.", kind: "cta" },
    ],
  },
  comparison: {
    label: "표와 선택 기준이 먼저 보이는 비교형 화면",
    title: "강남 운전면허학원 BEST 5, 비용과 셔틀까지 한 번에 비교",
    lead: "여러 학원을 하나씩 찾지 않아도 되도록 가격대, 접근성, 추천 대상을 먼저 정리합니다.",
    chips: ["비교표", "BEST5", "추천"],
    sections: ["비교 기준", "요약 표", "선택지별 장단점", "추천 케이스", "CTA"],
    tone: "객관적이고 판단이 쉬운 톤",
    blocks: [
      { title: "비교 기준", body: "가격, 셔틀, 주말 수업, 도로주행 코스를 같은 기준으로 맞춰 비교합니다." },
      { title: "한눈에 보는 비교표", body: "표 아래에는 왜 이 항목이 중요한지 짧게 해석하는 문단이 붙습니다.", kind: "table" },
      { title: "추천 케이스", body: "직장인, 대학생, 장롱면허처럼 상황별 추천을 분리합니다." },
      { title: "마지막 전환", body: "가까운 학원과 예약 가능한 시간을 확인하도록 연결합니다.", kind: "cta" },
    ],
  },
  "local-guide": {
    label: "지역 검색어에 맞춘 로컬 랜딩 화면",
    title: "송파에서 운전면허 준비할 때 먼저 확인할 5가지",
    lead: "동네에서 실제로 고민하는 이동 거리, 셔틀, 야간 수업 여부를 앞쪽에 배치합니다.",
    chips: ["지역 SEO", "주변", "동선"],
    sections: ["지역 고민", "주변 선택 기준", "동선/접근성", "추천 시나리오", "CTA"],
    tone: "현장감 있는 로컬 큐레이터 톤",
    blocks: [
      { title: "지역 고민", body: "송파, 잠실, 문정처럼 생활권이 다른 사용자의 이동 동선을 나눠 설명합니다." },
      { title: "선택 체크", body: "집/학교와 가까운지|셔틀 시간이 맞는지|도로주행 코스가 어렵지 않은지", kind: "list" },
      { title: "실제 후기 톤", body: "퇴근 후 수업을 잡을 수 있어서 주말에 몰아서 배우는 부담이 줄었다는 식의 현실적인 후기를 넣습니다.", kind: "quote" },
      { title: "지역 CTA", body: "내 위치 기준으로 가까운 학원을 찾도록 연결합니다.", kind: "cta" },
    ],
  },
  checklist: {
    label: "빠르게 훑고 저장하기 좋은 체크리스트 화면",
    title: "도로주행 시험 전날 체크리스트, 실수 줄이는 순서",
    lead: "준비물과 감점 포인트를 먼저 보여주고, 상세 설명은 아래로 이어집니다.",
    chips: ["체크리스트", "시험", "절차"],
    sections: ["요약", "준비 체크", "절차", "주의사항", "FAQ"],
    tone: "간결하고 실무적인 안내 톤",
    blocks: [
      { title: "3분 요약", body: "신분증, 시험 시간, 코스 확인처럼 놓치면 바로 문제가 되는 항목을 맨 위에 둡니다." },
      { title: "준비 체크", body: "신분증 챙기기|시험장 도착 시간 확인|좌석/거울 조정 연습|감점 포인트 복습", kind: "list" },
      { title: "자주 하는 실수", body: "방향지시등, 일시정지, 속도 조절처럼 반복되는 실수를 짧은 예시로 설명합니다." },
      { title: "시험 전 연결", body: "불안한 구간만 추가 연습할 수 있는 학원/강습 탐색으로 이어집니다.", kind: "cta" },
    ],
  },
  conversion: {
    label: "상담과 예약 전환을 강조하는 화면",
    title: "운전면허 비용이 부담될 때, 단기반 선택 전에 볼 기준",
    lead: "사용자의 문제를 먼저 잡고 해결 기준, 후기, CTA가 반복되지 않게 이어집니다.",
    chips: ["상담", "예약", "비용"],
    sections: ["문제 공감", "해결 기준", "사례/후기", "비용/혜택", "CTA"],
    tone: "신뢰를 주는 세일즈 톤",
    blocks: [
      { title: "문제 공감", body: "시간과 비용이 동시에 부담되는 상황을 구체적으로 짚어 이탈을 줄입니다." },
      { title: "해결 기준", body: "단기반, 셔틀, 추가 비용 여부를 상담 전 질문 목록으로 정리합니다." },
      { title: "후기 배치", body: "상담 후 전체 일정을 한 번에 잡을 수 있어 편했다는 톤으로 신뢰를 보강합니다.", kind: "quote" },
      { title: "상담 CTA", body: "비용과 가능한 일정을 바로 확인하는 버튼을 강하게 보여줍니다.", kind: "cta" },
    ],
  },
  custom: {
    label: "직접 입력한 메모를 기준으로 잡는 화면",
    title: "내가 정한 화면 구상으로 만든 예시글",
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

      <Workflow tenant={tenant} counts={counts} active={tab} onTab={setTab} />

      <div className="tabs">
        {TABS.map(([id, label]) => <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === "overview" && <Overview tenant={tenant} counts={counts} onTab={setTab} />}
      {tab === "plan" && <Plan tenant={tenant} axes={payload.axes} busy={busy} onSave={saveTenant} onRefresh={refresh} onTab={setTab} />}
      {tab === "templates" && <Templates tenant={tenant} options={options} busy={busy} onSave={saveTenant} />}
      {tab === "axes" && <Axes tenant={tenant} axes={payload.axes} options={options} onRefresh={refresh} />}
      {tab === "academies" && <Academies tenant={tenant} academies={payload.academies ?? []} onRefresh={refresh} />}
      {tab === "slots" && <Slots tenant={tenant} slots={payload.slots ?? []} options={options} onRefresh={refresh} />}
      {tab === "posts" && <Posts tenant={tenant} posts={payload.posts ?? []} onRefresh={refresh} />}
      {tab === "settings" && <Settings tenant={tenant} options={options} onSave={saveTenant} onRefresh={refresh} />}
    </div>
  );
}

function Workflow({ tenant, counts, active, onTab }: { tenant: Tenant; counts: SlotCounts; active: string; onTab: (v: string) => void }) {
  const totalSlots = Object.values(counts).reduce((a, b) => a + b, 0);
  const steps = [
    { tab: "plan", title: "기획", done: Boolean(tenant.content_brief), count: tenant.content_brief ? "완료" : "필요" },
    { tab: "templates", title: "유형/디자인", done: tenant.templates_enabled.length > 0, count: `${tenant.templates_enabled.length}개` },
    { tab: "slots", title: "후보/작성", done: totalSlots > 0, count: `${totalSlots}개` },
    { tab: "posts", title: "완성", done: counts.published > 0, count: `${counts.published}개` },
  ];
  return <div className="workflow" style={{ marginBottom: 20 }}>{steps.map((s, i) => <button key={s.tab} className={`step ${s.done ? "done" : ""} ${active === s.tab ? "active" : ""}`} onClick={() => onTab(s.tab)}><b>{i + 1}. {s.title}</b><p className="muted small">{s.count}</p></button>)}</div>;
}

function Overview({ tenant, counts, onTab }: { tenant: Tenant; counts: SlotCounts; onTab: (v: string) => void }) {
  return <div className="grid">
    <div className="grid grid-4">
      <Stat label="대기 슬롯" value={counts.planned} /><Stat label="진행" value={counts.in_progress} /><Stat label="발행" value={counts.published} accent /><Stat label="실패" value={counts.failed} />
    </div>
    <div className="grid grid-2">
      <div className="card card-pad"><h2>양산 기획</h2><p className="muted">{tenant.content_brief || "아직 기획 메모가 없습니다."}</p><button className="btn" onClick={() => onTab("plan")}>기획 열기</button></div>
      <div className="card card-pad"><h2>글 유형/디자인</h2><p className="muted">글 유형 {tenant.templates_enabled.length}개 · 디자인 {tenant.design_template_id ?? "editorial"}</p><button className="btn" onClick={() => onTab("templates")}>디자인 고르기</button></div>
    </div>
    <div className="card card-pad"><h2>빠른 시작</h2><ol className="muted"><li>기획 탭에서 글 방향과 축 값을 입력</li><li>글유형/디자인 탭에서 템플릿 선택</li><li>슬롯 탭에서 후보 생성 후 예시 글 작성</li><li>글 탭에서 확인하고 색인/중복/가지치기 실행</li></ol></div>
  </div>;
}

function Plan({ tenant, axes, busy, onSave, onRefresh, onTab }: { tenant: Tenant; axes: TenantDetailPayload["axes"]; busy: boolean; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void>; onTab: (v: string) => void }) {
  const [brief, setBrief] = useState(tenant.content_brief ?? "");
  const [texts, setTexts] = useState<Record<Axis, string>>(() => Object.fromEntries(AXES.map((a) => [a, axes[a]?.map((v) => v.value).join("\n") ?? ""])) as Record<Axis, string>);
  async function save() {
    await Promise.all(AXES.map((axis) => {
      const values = parseLines(texts[axis]).map((value) => ({ value, weight: 3, monthly_search_volume: null, competition_kd: null }));
      return values.length ? replaceAxis(tenant.domain, axis, values) : Promise.resolve();
    }));
    await onSave({ content_brief: brief.trim() });
    await onRefresh();
  }
  return <div className="card card-pad grid">
    <h2>양산할 글 기획</h2>
    <Field label="이번에 양산할 글의 방향 / 검증된 자료"><textarea className="textarea" rows={7} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="예: 수도권 직장인이 빠르게 운전면허를 따기 위해 지역별 학원, 비용, 셔틀 여부를 비교하는 글을 만든다." /></Field>
    <div className="grid grid-2">{AXES.map((axis) => <Field key={axis} label={AXIS_LABEL[axis]}><textarea className="textarea" value={texts[axis]} onChange={(e) => setTexts((p) => ({ ...p, [axis]: e.target.value }))} placeholder={AXIS_PLACEHOLDER[axis]} /></Field>)}</div>
    <div className="row"><button className="btn primary" onClick={save} disabled={busy}>{busy ? "저장 중..." : "기획 저장"}</button><button className="btn" onClick={() => onTab("templates")}>글 유형 고르기</button><button className="btn" onClick={() => onTab("slots")}>글 후보 만들기</button></div>
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
          <textarea className="textarea" rows={7} value={custom} onChange={(e) => { setCustom(e.target.value); if (e.target.value.trim()) setDesign("custom"); }} placeholder={`예: 첫 화면에는 큰 제목과 핵심 요약 3개를 둔다.
비교표는 본문 상단에 배치한다.
CTA는 중간 1회, 마지막 1회만 사용한다.
모바일에서는 카드형 목록으로 보이게 한다.`} />
        </Field>
        <div className="row"><button className="btn primary" disabled={busy || enabled.size === 0} onClick={() => onSave({ templates_enabled: Array.from(enabled).sort(), design_template_id: design, custom_design_templates: custom.trim() })}>{busy ? "저장 중..." : "글 유형/화면 구상 저장"}</button><span className="muted small">저장 후 새 글 후보/생성글부터 적용됩니다.</span></div>
      </div>
      <DesignPreview blueprint={blueprint} designId={design} brand={tenant.display_name} title={activeDesign.name} summary={activeDesign.summary} />
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
      <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); ai(e.currentTarget); }}><h2>🤖 AI로 축 자동 생성</h2><textarea className="textarea" name="extra_context" placeholder="추가 컨텍스트" /><div className="row"><select className="select" name="provider" style={{ maxWidth: 160 }}><option>claude</option><option>codex</option></select><input className="input" name="model" placeholder="모델 선택" style={{ maxWidth: 180 }} /><button className="btn primary" disabled={aiBusy}>{aiBusy ? "생성 중..." : "생성"}</button></div></form>
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
  async function add(form: HTMLFormElement) { const fd = Object.fromEntries(new FormData(form).entries()); await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies`, { method: "POST", body: JSON.stringify(fd) }); form.reset(); await onRefresh(); }
  async function bulk(form: HTMLFormElement) { const text = String(new FormData(form).get("json") || ""); await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies`, { method: "POST", body: text }); form.reset(); await onRefresh(); }
  async function del(id: string) { if (!confirm("삭제할까요?")) return; await api(`/tenants/${encodeURIComponent(tenant.domain)}/academies/${id}`, { method: "DELETE" }); await onRefresh(); }
  async function syncAcademies() {
    setSyncBusy("academies");
    try {
      const res = await syncDrivingplusAcademies(tenant.domain);
      setSyncResult(`학원 ${res.fetched}개 조회 · ${res.upserted}개 반영 · ${res.skipped}개 제외${res.warnings?.length ? ` · 경고 ${res.warnings.length}개` : ""}`);
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
    <div className="card card-pad grid">
      <div className="spread"><div><h2>DrivingPlus 원천 데이터 동기화</h2><p className="muted">Swagger API의 학원/지역 데이터를 가져와 글 생성 프롬프트의 검증된 자료로 사용합니다.</p></div><span className="badge info">{academies.length}개 학원</span></div>
      <div className="grid grid-3">
        <Field label="지역 레벨"><select className="select" value={regionLevel} onChange={(e) => setRegionLevel(e.target.value as "2" | "3" | "all")}><option value="2">시군구(level=2, 권장)</option><option value="3">읍면동(level=3, 최대 500개)</option><option value="all">전체</option></select></Field>
        <Field label="지역 축 반영"><label className="row small" style={{ minHeight: 42 }}><input type="checkbox" checked={replaceRegionAxis} onChange={(e) => setReplaceRegionAxis(e.target.checked)} /> axes.region 교체</label></Field>
        <div className="row" style={{ alignItems: "end" }}><button className="btn" onClick={syncRegions} disabled={Boolean(syncBusy)}>{syncBusy === "regions" ? "지역 동기화 중..." : "지역 동기화"}</button><button className="btn primary" onClick={syncAcademies} disabled={Boolean(syncBusy)}>{syncBusy === "academies" ? "학원 동기화 중..." : "학원 동기화"}</button></div>
      </div>
      {syncResult && <p className="small badge success" style={{ width: "fit-content" }}>{syncResult}</p>}
      <p className="muted small">권장 순서: 지역 동기화(level=2, 축 교체) → 학원 동기화 → 슬롯 탭에서 후보 생성.</p>
    </div>
    <div className="card card-pad"><p className="muted">슬롯 지역과 일치하거나 가까운 학원 자료가 생성 프롬프트에 주입됩니다. DrivingPlus 학원은 SEO 설명, vphone, 사진 URL도 함께 사용됩니다.</p></div>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); add(e.currentTarget); }}><h2>학원 1곳 추가</h2><div className="grid grid-3">{["region","name","address","price","shuttle","hours","pass_rate","phone","source_name","source_url","review"].map((n) => <input key={n} className="input" name={n} placeholder={n} required={n === "name"} />)}</div><button className="btn primary">추가</button></form>
    <form className="card card-pad grid" onSubmit={(e) => { e.preventDefault(); bulk(e.currentTarget); }}><h2>JSON 일괄 업로드</h2><textarea className="textarea mono" name="json" placeholder='[{"region":"대구","name":"OO학원","price":"65만원"}]' /><button className="btn">업로드</button></form>
    <div className="table-wrap"><table><thead><tr><th>지역</th><th>학원명</th><th>전화/사진</th><th>SEO 설명</th><th>출처</th><th></th></tr></thead><tbody>{academies.map((a) => {
      const photoCount = parsePhotoCount(a.photos);
      return <tr key={a.id}><td>{a.region}</td><td><b>{a.name}</b><p className="muted small">{a.address}</p><p className="muted small">{a.academy_type || ""}{a.external_id ? ` · #${a.external_id}` : ""}</p></td><td>{a.vphone || a.phone}<p className="muted small">{photoCount ? `사진 ${photoCount}장` : "사진 없음"}</p></td><td><span className="small">{a.seo_description || a.review || "-"}</span></td><td>{a.source_url ? <a href={a.source_url} target="_blank">{a.source_name || "링크"}</a> : a.source_name}</td><td><button className="btn danger" onClick={() => del(a.id)}>삭제</button></td></tr>;
    })}</tbody></table></div>
  </div>;
}

function Slots({ tenant, slots, options, onRefresh }: { tenant: Tenant; slots: Slot[]; options: AdminOptions; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(new Set<string>()); const [status, setStatus] = useState("planned"); const [template, setTemplate] = useState(""); const [q, setQ] = useState(""); const [provider, setProvider] = useState<Provider>("claude"); const [model, setModel] = useState(""); const [cooldown, setCooldown] = useState(60); const [timeout, setTimeout] = useState(600); const [web, setWeb] = useState(true); const [max, setMax] = useState(200);
  const filtered = slots.filter((s) => (!status || s.status === status) && (!template || s.template_id === template) && (!q || `${s.primary_keyword} ${s.slot_id}`.toLowerCase().includes(q.toLowerCase())));
  const expectedMinutes = Math.max(1, Math.ceil(((selected.size || 1) * (cooldown + 30)) / 60));
  async function gen() { await api(`/tenants/${encodeURIComponent(tenant.domain)}/slots/generate`, { method: "POST", body: JSON.stringify({ max_per_template: max }) }); await onRefresh(); }
  async function queue(ids: string[]) { if (!ids.length) return; const r = await enqueueGenerate(tenant.domain, { slot_ids: ids, provider, model, design_template_id: tenant.design_template_id, use_web_research: web, cooldown_sec: cooldown, timeout_sec: timeout }); alert(`작업 큐 등록: ${r.job_id}`); setSelected(new Set()); await onRefresh(); }
  async function delSelected() { if (!confirm(`${selected.size}개 삭제?`)) return; for (const id of selected) await api(`/tenants/${encodeURIComponent(tenant.domain)}/slots/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); }
  return <div className="grid"><div className="card card-pad grid"><h2>글 후보 만들기/작성</h2><div className="grid grid-4"><Field label="템플릿당 최대"><input className="input" type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} /></Field><Field label="작성 엔진"><select className="select" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>{options.providers.map((p) => <option key={p}>{p}</option>)}</select></Field><Field label="모델"><input className="input" value={model} onChange={(e) => setModel(e.target.value)} /></Field><Field label="제한시간"><input className="input" type="number" value={timeout} onChange={(e) => setTimeout(Number(e.target.value))} /></Field></div><div className="row"><button className="btn primary" onClick={gen}>재료로 글 후보 만들기</button><button className="btn" onClick={() => queue(filtered.slice(0,1).map((s) => s.slot_id))}>예시 글 1개 만들기</button><label className="row small"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> 웹 자료 수집 후 작성</label><Field label="대량 대기시간"><input className="input" type="number" value={cooldown} onChange={(e) => setCooldown(Number(e.target.value))} /></Field></div><div className="writer-hint"><b>작성 옵션</b><span>{provider}{model ? ` / ${model}` : ""}</span><span>디자인 {tenant.design_template_id ?? "editorial"}</span><span>웹자료 {web ? "사용" : "미사용"}</span><span>선택 기준 예상 {expectedMinutes}분</span></div></div><div className="row"><select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">전체 상태</option>{["planned","in_progress","published","failed","pruned"].map((s) => <option key={s}>{s}</option>)}</select><select className="select" style={{ width: 150 }} value={template} onChange={(e) => setTemplate(e.target.value)}><option value="">전체 유형</option>{options.templates.map((t) => <option key={t}>{t}</option>)}</select><input className="input" style={{ width: 240 }} placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small">{selected.size}개 선택 / {filtered.length}개</span><button className="btn primary" disabled={!selected.size} onClick={() => queue(Array.from(selected))}>선택 글 작성</button><button className="btn danger" disabled={!selected.size} onClick={delSelected}>삭제</button></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.slot_id)))} /></th><th>유형</th><th>키워드</th><th>지역</th><th>페르소나</th><th>점수</th><th>상태</th></tr></thead><tbody>{filtered.slice(0,300).map((s) => <tr key={s.slot_id}><td><input type="checkbox" checked={selected.has(s.slot_id)} onChange={() => setSelected((p) => { const n = new Set(p); n.has(s.slot_id) ? n.delete(s.slot_id) : n.add(s.slot_id); return n; })} /></td><td><span className="badge">{s.template_id}</span></td><td><b>{s.primary_keyword}</b><p className="muted small mono">{s.slot_id}</p>{s.last_error && <p className="small" style={{ color: "var(--danger)" }}>{s.last_error}</p>}</td><td>{s.region ?? "-"}</td><td>{s.persona ?? "-"}</td><td>{s.priority_score?.toFixed(1) ?? "-"}</td><td><Status status={s.status} /></td></tr>)}</tbody></table></div></div>;
}

function Posts({ tenant, posts, onRefresh }: { tenant: Tenant; posts: PostSummary[]; onRefresh: () => Promise<void> }) {
  const [selected, setSelected] = useState(new Set<string>()); const [q, setQ] = useState("");
  const filtered = posts.filter((p) => !q || `${p.title} ${p.slug}`.toLowerCase().includes(q.toLowerCase()));
  async function job(kind: "dedup" | "prune" | "indexing") { const path = kind === "indexing" ? "indexing" : kind; await api(`/tenants/${encodeURIComponent(tenant.domain)}/jobs/${path}`, { method: "POST", body: JSON.stringify(kind === "dedup" ? { threshold: 0.75 } : kind === "prune" ? { min_body_chars: 700, stale_noindex_days: 90 } : { max: 200 }) }); alert(`${kind} 작업 등록`); }
  async function delSelected() { if (!confirm(`${selected.size}개 삭제?`)) return; for (const id of selected) await api(`/tenants/${encodeURIComponent(tenant.domain)}/posts/${id}`, { method: "DELETE" }); setSelected(new Set()); await onRefresh(); }
  function downloadMarkdown() { const chosen = posts.filter((p) => selected.has(p.id)); const text = chosen.map((p) => `# ${p.title}\n\nslug: ${p.slug}\n`).join("\n---\n"); const url = URL.createObjectURL(new Blob([text], { type: "text/markdown" })); const a = document.createElement("a"); a.href = url; a.download = `${tenant.domain}-posts.md`; a.click(); URL.revokeObjectURL(url); }
  return <div className="grid"><div className="row"><input className="input" style={{ width: 260 }} placeholder="제목/슬러그 검색" value={q} onChange={(e) => setQ(e.target.value)} /><span className="muted small">{selected.size}개 선택 / {filtered.length}개</span><button className="btn" onClick={() => job("dedup")} disabled={posts.length < 2}>중복 검사</button><button className="btn" onClick={() => job("prune")} disabled={!posts.length}>가지치기</button><button className="btn" onClick={() => job("indexing")} disabled={!posts.length}>색인 요청</button><button className="btn" onClick={downloadMarkdown} disabled={!selected.size}>Markdown Export</button><button className="btn danger" onClick={delSelected} disabled={!selected.size}>삭제</button></div><div className="table-wrap"><table><thead><tr><th><input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length} onChange={() => setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((p) => p.id)))} /></th><th>제목</th><th>디자인</th><th>자수</th><th>provider</th><th>$</th><th>생성일</th></tr></thead><tbody>{filtered.map((p) => <tr key={p.id}><td><input type="checkbox" checked={selected.has(p.id)} onChange={() => setSelected((prev) => { const n = new Set(prev); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })} /></td><td><Link href={`/t/${encodeURIComponent(tenant.domain)}/post/${p.id}`}><b>{p.title}</b></Link><p className="muted small mono">{p.slug}</p></td><td><span className="badge">{p.design_template_id ?? tenant.design_template_id}</span></td><td>{p.body_chars?.toLocaleString()}</td><td>{p.provider}</td><td>{p.cost_usd ? p.cost_usd.toFixed(3) : "-"}</td><td className="small muted">{p.generated_at}</td></tr>)}</tbody></table></div></div>;
}

function Settings({ tenant, options, onSave, onRefresh }: { tenant: Tenant; options: AdminOptions; onSave: (f: Record<string, unknown>) => Promise<void>; onRefresh: () => Promise<void> }) {
  const [form, setForm] = useState({ display_name: tenant.display_name, vertical: tenant.vertical, theme: tenant.theme, brand_color: tenant.brand_color ?? "#5132d7", daily_limit: tenant.daily_limit }); const [sa, setSa] = useState(""); const [url, setUrl] = useState(options.indexing.url_template);
  async function saveIndexing() { await api("/settings/indexing", { method: "PUT", body: JSON.stringify({ sa_json: sa, url_template: url }) }); setSa(""); await onRefresh(); alert("색인 설정 저장됨"); }
  async function deleteTenant() { if (!confirm("정말 삭제할까요? 모든 데이터가 삭제됩니다.")) return; await api(`/tenants/${encodeURIComponent(tenant.domain)}`, { method: "DELETE" }); location.href = "/"; }
  return <div className="grid grid-2"><div className="card card-pad grid"><h2>메타 정보</h2><Field label="표시 이름"><input className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field><div className="grid grid-2"><Field label="업종"><input className="input" value={form.vertical} onChange={(e) => setForm({ ...form, vertical: e.target.value })} /></Field><Field label="테마"><select className="select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>{options.themes.map((t) => <option key={t}>{t}</option>)}</select></Field></div><div className="grid grid-2"><Field label="브랜드 컬러"><input className="input" type="color" value={form.brand_color} onChange={(e) => setForm({ ...form, brand_color: e.target.value })} /></Field><Field label="일일 한도"><input className="input" type="number" value={form.daily_limit} onChange={(e) => setForm({ ...form, daily_limit: Number(e.target.value) })} /></Field></div><button className="btn primary" onClick={() => onSave(form)}>저장</button></div><div className="card card-pad grid"><h2>Google 색인 설정</h2><p className="muted small">현재 키 상태: {options.indexing.has_key ? "설정됨" : "미설정"}</p><Field label="서비스계정 JSON"><textarea className="textarea mono" value={sa} onChange={(e) => setSa(e.target.value)} placeholder="이미 저장됨 — 교체하려면 새 JSON 붙여넣기" /></Field><Field label="발행 URL 템플릿"><input className="input mono" value={url} onChange={(e) => setUrl(e.target.value)} /></Field><button className="btn" onClick={saveIndexing}>색인 설정 저장</button><hr /><button className="btn danger" onClick={deleteTenant}>도메인 삭제</button></div></div>;
}

function DesignPreview({ blueprint, designId, brand, title, summary }: { blueprint: typeof DESIGN_BLUEPRINTS[string]; designId: string; brand: string; title: string; summary: string }) {
  return <aside className="preview-panel">
    <div className="preview-head"><div><b>예시글 미리보기</b><p className="muted small">{blueprint.label}</p></div><span className="badge info">{designId}</span></div>
    <div className={`preview-phone design-${designId}`}>
      <div className="preview-top"><div><b>{brand}</b><p>면허 합격은 시간 문제!</p></div><span className="preview-cta">나도 도전하기</span></div>
      <div className="preview-hero"><span>blog main image</span></div>
      <div className="preview-body">
        <div className="preview-meta"><span>26.04.03</span><span>조회 0</span></div>
        <h4>{blueprint.title}</h4>
        <div className="preview-divider" />
        <div className="row">{blueprint.chips.map((chip) => <span className="badge" key={chip}>{chip}</span>)}</div>
        <p className="muted small">{blueprint.lead}</p>
        {blueprint.blocks.map((block) => <PreviewBlock key={block.title} block={block} />)}
        <section className="preview-bottom-cta"><b>지금 바로 최저가로 예약 가능한 곳을 찾아보세요!</b><button className="btn primary">내 근처 찾기</button></section>
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
  if (block.kind === "table") return <div className="preview-block"><b>{block.title}</b><div className="mini-table"><span>항목</span><span>장점</span><span>추천</span><span>A 학원</span><span>셔틀</span><span>직장인</span><span>B 학원</span><span>단기반</span><span>대학생</span></div><p>{block.body}</p></div>;
  if (block.kind === "quote") return <blockquote className="preview-quote">{block.body}</blockquote>;
  if (block.kind === "cta") return <div className="preview-block preview-cta-block"><b>{block.title}</b><p>{block.body}</p><button className="btn primary">상담/예약으로 연결</button></div>;
  if (block.kind === "list") return <div className="preview-block"><b>{block.title}</b><ul>{block.body.split("|").map((item) => <li key={item}>✓ {item}</li>)}</ul></div>;
  return <div className="preview-block"><b>{block.title}</b><p>{block.body}</p></div>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className="card stat"><div className="muted small">{label}</div><div className="num" style={{ color: accent ? "var(--success)" : undefined }}>{value}</div></div>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span className="label">{label}</span>{children}</label>; }
function Status({ status }: { status: string }) { const cls = status === "published" || status === "done" ? "success" : status === "failed" ? "danger" : status === "running" || status === "in_progress" ? "info" : status === "planned" || status === "queued" ? "warn" : ""; return <span className={`badge ${cls}`}>{status}</span>; }
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
