export type AxisName = "region" | "keyword" | "intent" | "persona" | "modifier";
export type ProviderName = "claude" | "codex";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";

export const AXES: AxisName[] = ["region", "keyword", "intent", "persona", "modifier"];

export const DRIVING_ORIGINAL_TEMPLATE_IDS = [
  "T01", "T03", "T04", "T05", "T06", "T07",
  "T08", "T09", "T10", "T11", "T12", "T13", "T14", "T15"
] as const;

export const TEMPLATE_SPECS = {
  T01: { name: "지역 학원 BEST 비교", primary: ["region"], use_persona: true, modifier_count: 2, weight: 1.0, min_sv: 0, kind: "local_best" },
  T03: { name: "운전면허 가이드 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 0, kind: "general_guide" },
  T04: { name: "면허 종류/옵션 비교", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.7, min_sv: 0, kind: "license_compare" },
  T05: { name: "비용 및 시간 절약 전략", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.95, min_sv: 0, kind: "cost_strategy" },
  T06: { name: "시험 단계 집중 BEST", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 0.85, min_sv: 0, with_intent: true, kind: "exam_best" },
  T07: { name: "지역 허브 총정리", primary: ["region"], use_persona: false, modifier_count: 0, weight: 1.2, min_sv: 0, with_intent: true, kind: "regional_hub" },
  T08: { name: "운전면허 필기시험 접수", primary: ["keyword"], use_persona: false, modifier_count: 0, weight: 1.05, min_sv: 0, with_intent: true, kind: "written_registration" },
  T09: { name: "운전면허 필기시험 팁", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "written_tips" },
  T10: { name: "운전면허 필기시험 앱 추천", primary: ["keyword"], use_persona: true, modifier_count: 0, weight: 0.9, min_sv: 0, kind: "written_app" },
  T11: { name: "지역 운전면허시험장 소개", primary: ["region"], use_persona: false, modifier_count: 0, weight: 0.95, min_sv: 0, with_intent: true, kind: "test_center" },
  T12: { name: "운전면허 취득 총정리", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 1.0, min_sv: 0, kind: "license_complete" },
  T13: { name: "특정 타겟 맞춤형", primary: ["keyword"], use_persona: true, modifier_count: 1, weight: 0.85, min_sv: 0, kind: "persona_target" },
  T14: { name: "전문학원 단독 소개", primary: ["region"], use_persona: true, modifier_count: 0, weight: 0.9, min_sv: 0, kind: "academy_profile" },
  T15: { name: "지역+시험단계 혼합", primary: ["region"], use_persona: true, modifier_count: 1, weight: 0.9, min_sv: 0, with_intent: true, kind: "local_exam_mix" }
} as const;

export const DESIGN_TEMPLATES = [
  { id: "editorial", name: "브랜드 매거진", summary: "큰 대표 이미지와 부드러운 CTA가 있는 정보성 블로그형", best_for: "정보성 키워드, 초보자 가이드, 총정리 글" },
  { id: "comparison", name: "BEST 비교 블로그", summary: "비교표와 추천 기준을 먼저 보여주는 선택형 구성", best_for: "BEST5, 추천, 가격/기간/옵션 비교" },
  { id: "local-guide", name: "지역 추천 블로그", summary: "지역명, 셔틀, 동선 정보를 강조하는 로컬 SEO 구성", best_for: "지역 SEO, 근처/주변/동네 검색어" },
  { id: "checklist", name: "체크리스트 블로그", summary: "저장하고 따라하기 쉬운 체크리스트형 구성", best_for: "시험, 신청, 준비, 절차 키워드" },
  { id: "conversion", name: "예약 전환 블로그", summary: "상담, 예약, 비용 문의 버튼을 강조하는 전환형 구성", best_for: "예약, 상담, 비용 문의, 업체 소개" },
  { id: "custom", name: "커스텀", summary: "직접 적은 디자인 메모를 프롬프트와 미리보기에 반영", best_for: "특수 랜딩, 브랜드 가이드가 있는 사이트" }
] as const;

export const PRESETS: Record<string, Record<AxisName, Array<Record<string, unknown>>>> = {
  driving: {
    region: [
      { value: "수원", weight: 5, monthly_search_volume: 2400, competition_kd: 42 },
      { value: "안산", weight: 5, monthly_search_volume: 1800, competition_kd: 38 },
      { value: "인천", weight: 5, monthly_search_volume: 2600, competition_kd: 45 },
      { value: "강남", weight: 4, monthly_search_volume: 3200, competition_kd: 68 },
      { value: "부산", weight: 5, monthly_search_volume: 2800, competition_kd: 40 },
      { value: "대구", weight: 5, monthly_search_volume: 2100, competition_kd: 38 },
      { value: "광주", weight: 4, monthly_search_volume: 1500, competition_kd: 35 },
      { value: "대전", weight: 4, monthly_search_volume: 1700, competition_kd: 36 },
      { value: "성남", weight: 3, monthly_search_volume: 1100, competition_kd: 38 },
      { value: "용인", weight: 3, monthly_search_volume: 900, competition_kd: 34 }
    ],
    keyword: [
      { value: "운전면허학원", weight: 10, monthly_search_volume: 9900, competition_kd: 55 },
      { value: "운전면허", weight: 10, monthly_search_volume: 12000, competition_kd: 48 },
      { value: "운전면허 합격", weight: 9, monthly_search_volume: 10000, competition_kd: 45 },
      { value: "자동차학원", weight: 8, monthly_search_volume: 5400, competition_kd: 48 },
      { value: "1종보통", weight: 6, monthly_search_volume: 3600, competition_kd: 42 },
      { value: "2종보통", weight: 6, monthly_search_volume: 5400, competition_kd: 40 },
      { value: "운전면허 비용", weight: 7, monthly_search_volume: 4400, competition_kd: 38 },
      { value: "운전면허 필기시험", weight: 8, monthly_search_volume: 8100, competition_kd: 40 },
      { value: "운전면허 필기시험 접수", weight: 8, monthly_search_volume: 7600, competition_kd: 38 },
      { value: "운전면허 필기시험 팁", weight: 8, monthly_search_volume: 7200, competition_kd: 36 },
      { value: "운전면허 필기시험 어플", weight: 7, monthly_search_volume: 6200, competition_kd: 34 },
      { value: "운전면허시험장", weight: 7, monthly_search_volume: 6800, competition_kd: 42 },
      { value: "운전면허 취득", weight: 7, monthly_search_volume: 6500, competition_kd: 40 },
      { value: "운전면허 준비물", weight: 6, monthly_search_volume: 5200, competition_kd: 35 },
      { value: "운전면허 기능시험", weight: 6, monthly_search_volume: 5800, competition_kd: 37 },
      { value: "운전면허 도로주행", weight: 6, monthly_search_volume: 5600, competition_kd: 37 },
      { value: "운전연수", weight: 6, monthly_search_volume: 9900, competition_kd: 42 }
    ],
    intent: ["비교추천", "가이드총정리", "비용절약", "후기리뷰", "시험팁", "접수방법", "준비물", "단기합격", "BEST", "가격비교"].map((value, i) => ({ value, weight: i < 4 ? 5 : i < 8 ? 4 : 3 })),
    persona: ["직장인", "대학생", "사회초년생", "주부", "노년층", "초보운전자"].map((value, i) => ({ value, weight: i < 2 ? 5 : i === 2 || i === 5 ? 4 : 3 })),
    modifier: ["최단기", "비용절약", "셔틀편리", "야간반", "주말반", "합격률높은", "가성비"].map((value, i) => ({ value, weight: i < 3 || i > 4 ? 4 : 3 }))
  },
  "car-mapping": {
    region: ["강남", "분당", "송파", "부천", "수원", "부산"].map((value, i) => ({ value, weight: i < 2 ? 5 : 4, monthly_search_volume: [1800, 900, 700, 600, 800, 900][i], competition_kd: [55, 40, 42, 35, 38, 42][i] })),
    keyword: [
      { value: "ECU 맵핑", weight: 10, monthly_search_volume: 2400, competition_kd: 35 },
      { value: "ECU 튜닝", weight: 9, monthly_search_volume: 3300, competition_kd: 40 },
      { value: "리맵핑", weight: 7, monthly_search_volume: 1500, competition_kd: 30 },
      { value: "Stage 1 맵핑", weight: 6, monthly_search_volume: 700, competition_kd: 25 },
      { value: "DPF 클리닝", weight: 7, monthly_search_volume: 1800, competition_kd: 30 },
      { value: "연비맵", weight: 6, monthly_search_volume: 600, competition_kd: 25 },
      { value: "디젤 튜닝", weight: 5, monthly_search_volume: 800, competition_kd: 30 }
    ],
    intent: ["비교추천", "가격정보", "후기리뷰", "효과분석", "안전성검토", "규제정보"].map((value, i) => ({ value, weight: i < 2 ? 5 : i < 5 ? 4 : 3 })),
    persona: ["출퇴근차주", "장거리운행자", "튜닝매니아", "화물차주", "영업용", "BMW오너", "벤츠오너"].map((value, i) => ({ value, weight: i === 0 ? 5 : i < 3 ? 4 : 3 })),
    modifier: ["다이노실측", "보증유지", "연비개선", "출력증가", "Stage1", "Stage2"].map((value, i) => ({ value, weight: i < 4 ? 4 : 3 }))
  },
  general: {
    region: [], keyword: [], intent: [{ value: "비교추천", weight: 5 }, { value: "가이드총정리", weight: 5 }], persona: [{ value: "일반", weight: 5 }], modifier: []
  }
};

export const VERTICAL_TO_PRESET: Record<string, string> = {
  driving: "driving",
  "car-mapping": "car-mapping",
  gym: "general",
  academy: "general",
  general: "general"
};
