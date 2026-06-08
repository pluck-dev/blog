import type { DesignTemplateId } from "@shared/types";

const FORBIDDEN_PHRASES = [
  "이 글에서는", "오늘은 알아보겠습니다", "마무리하며",
  "완벽하게", "확실히", "100%", "절대",
];

function brandName(slot: SlotForPrompt): string {
  return slot.brand_name?.trim() || "운전면허플러스";
}

function systemInstruction(slot: SlotForPrompt): string {
  const brand = brandName(slot);
  return (
    "당신은 10년 경력의 한국어 SEO 블로그 작가입니다. " +
    `최종 발행 주체는 "${brand}"입니다. 본문 브랜드명과 CTA는 "${brand}"만 사용하세요. ` +
    "경쟁사명 '운전선생'은 후기·출처·예시 등 어떤 맥락에서도 절대 쓰지 마세요. " +
    "글은 자연스럽고 실제 사람이 쓴 것처럼 보여야 하며 " +
    "AI 흔적(예: '이 글에서는~', '오늘은 알아보겠습니다') 을 피합니다. " +
    "검증된 자료에 없는 상호명, 주소, 가격, 셔틀, 후기, 평점은 절대 만들지 않습니다. " +
    "제공된 자료에서 가져온 가격·통계·합격률·주소 같은 수치는 해당 문장 끝에 [1], [2] 형식의 출처 번호를 달고, " +
    "글 맨 끝 '## 참고자료' 섹션에 그 번호와 출처 제목·URL을 나열해 근거를 명시하세요. " +
    "근거가 없는 수치는 지어내지 말고 '상담 시 확인' 같은 표현으로 대체하세요. " +
    `${brand} 블로그에 게시할 수 있도록 충분한 글양, 중간 이미지, 표, 인용, CTA가 있는 완성형 글이어야 합니다.`
  );
}

function commonConstraints(slot: SlotForPrompt): string {
  const brand = brandName(slot);
  return (
    "출력 규칙:\n" +
    "- markdown 만 출력. 코드블록(```) 으로 감싸지 말 것.\n" +
    "- 제목은 # 한 줄, 부제목은 ## 사용.\n" +
    `- 다음 표현 금지: ${FORBIDDEN_PHRASES.join(", ")}\n` +
    "- 종결어미는 '~입니다 / ~예요 / ~죠 / ~네요' 를 적절히 섞어 단조로움 회피.\n" +
    "- 첫 줄은 반드시 # 으로 시작하는 제목.\n" +
    "- 본문 공백 제외 3,200~5,500자. 짧은 요약문처럼 끝내지 말고 실제 발행 가능한 장문으로 작성.\n" +
    "- H2는 5~8개, 각 핵심 H2 아래에는 2~4문단을 배치.\n" +
    "- [IMAGE_SLOT: hero] 1개와 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior], [IMAGE_SLOT: shuttle] 중 2개 이상을 본문 중간에 자연스럽게 삽입.\n" +
    "- [TABLE_SLOT: ...] 1개 이상을 반드시 삽입. 표 주변에는 표를 해석하는 문단을 붙일 것.\n" +
    "- blockquote 1개 포함. 검증된 후기가 없으면 실제 후기처럼 꾸미지 말고 '상담 전 확인 메모' 또는 '체크 예시'로 작성.\n" +
    `- 마지막에는 ${brand} 앱/예약/주변 학원 찾기 CTA와 [INTERNAL_LINK: ...] placeholder 1개 이상 포함.\n` +
    `- CTA와 본문 브랜드명은 반드시 "${brand}"만 사용. 다른 서비스명이나 경쟁 브랜드명 사용 금지.\n` +
    "- 표·이미지 슬롯은 후처리에서 치환되므로 절대 삭제하거나 임의 URL로 바꾸지 말 것.\n"
  );
}

export interface SlotForPrompt {
  template_id: string;
  primary_keyword: string;
  region?: string | null;
  persona?: string | null;
  intent?: string | null;
  modifier_1?: string | null;
  modifier_2?: string | null;
  entity_id?: string | null;
  slot_id?: string;
  design_template_id?: DesignTemplateId | null;
  custom_design_templates?: string | null;
  content_brief?: string | null;
  brand_name?: string | null;
}

function t01(slot: SlotForPrompt): string {
  const region = slot.region ?? "";
  const persona = slot.persona || "일반 운전자";
  const keyword = slot.primary_keyword;
  const mods = [slot.modifier_1, slot.modifier_2].filter(Boolean).join(", ") || "가성비, 셔틀 편리";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${region} ${keyword} BEST 5 추천\n` +
    `타깃 페르소나: ${persona}\n` +
    `강조 키워드: ${mods}\n\n` +
    "구성:\n" +
    "1) 도입 (공감 멘트, 이모지 1~2개, 350~450자, [IMAGE_SLOT: hero] 삽입)\n" +
    `2) ${region} 학원/업체 선택 시 흔한 고민 3가지 (450~600자)\n` +
    "3) BEST 5 비교 표([TABLE_SLOT: academy_comparison]) + 해석 문단. 검증된 학원명 목록이 없으면 표 컬럼은 선택 기준·확인 질문·앱에서 확인할 항목·추천 페르소나로 구성하고, 실제 상호명을 만들지 말 것.\n" +
    "4) 본문 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior], [IMAGE_SLOT: shuttle] 중 2개 이상 삽입\n" +
    "5) 비용 절약/시간 단축 팁 3가지 (500~700자)\n" +
    "6) 검증된 후기가 있으면 후기 인용, 없으면 상담 전 확인 메모 blockquote 1개\n" +
    `7) 자연스러운 CTA (방문/상담, ${brandName(slot)} 앱 언급, 250~350자)\n\n` +
    `전체 분량: 3200~5500자\n\n` +
    commonConstraints(slot)
  );
}

function t02(slot: SlotForPrompt): string {
  const entity = slot.entity_id || "선택한 학원";
  const region = slot.region ?? "";
  const modifier = slot.modifier_1 || "친절강사";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${region} ${entity} 단일 소개 (${modifier})\n\n` +
    "구성:\n" +
    "1) 인트로 (이 업체가 이런 분에게 어울린다 — 350~450자, [IMAGE_SLOT: hero] 삽입)\n" +
    "2) 강점 4가지 (H3 + 본문 220~300자, 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입)\n" +
    "3) 이용 절차 또는 코스 안내 표는 [TABLE_SLOT: academy_course] placeholder로 삽입\n" +
    "4) 검증된 후기 자료가 있을 때만 후기 발췌 작성. 없으면 상담 전 확인 질문 3개와 blockquote 1개 포함\n" +
    "5) 위치/셔틀/비용은 입력 자료에 있을 때만 구체적으로 작성. 없으면 확인 필요 항목으로 안내 + CTA + [INTERNAL_LINK: ...]\n\n" +
    "전체 분량: 3200~5200자\n\n" +
    commonConstraints(slot)
  );
}

function t03(slot: SlotForPrompt): string {
  const keyword = slot.primary_keyword;
  const persona = slot.persona || "처음 준비하시는 분";
  const modifier = slot.modifier_1 || "최단기";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${keyword} 총정리 가이드 (${modifier})\n` +
    `타깃 페르소나: ${persona}\n\n` +
    "구성:\n" +
    "1) 도입 — 왜 지금 이 정보를 찾는 사람이 많은가 (350~450자, [IMAGE_SLOT: hero] 삽입)\n" +
    "2) 절차 단계별 정리 (numbered list, 각 단계 180~250자)\n" +
    "3) 비용/시간 표는 [TABLE_SLOT: cost_time] placeholder로 삽입하고 표 해석 문단 작성\n" +
    "4) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입\n" +
    "5) 자주 묻는 질문 FAQ 5개 (Q/A, 각 답변 100자 이상)\n" +
    `6) 마지막 체크리스트 (- 으로 5~7항목) + ${brandName(slot)} CTA\n\n` +
    "전체 분량: 3200~5200자\n\n" +
    commonConstraints(slot)
  );
}

function t04(slot: SlotForPrompt): string {
  const keyword = slot.primary_keyword;
  const persona = slot.persona || "선택 고민 중인 분";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${keyword} 옵션 비교 (가격·기간·난이도·활용도)\n` +
    `타깃: ${persona}\n\n` +
    "구성:\n" +
    "1) 도입 (350~450자, 왜 비교가 필요한지, [IMAGE_SLOT: hero] 삽입)\n" +
    "2) 두 옵션 정의와 선택 전제 설명\n" +
    "3) 비교 표는 [TABLE_SLOT: option_comparison] placeholder로 삽입하고 4~6행 구성\n" +
    "4) 옵션 A 추천 케이스 (450~600자, 페르소나 시나리오, [IMAGE_SLOT: exterior] 삽입)\n" +
    "5) 옵션 B 추천 케이스 (450~600자, [IMAGE_SLOT: interior] 삽입)\n" +
    "6) 검증된 후기가 있으면 후기 인용, 없으면 상담 전 확인 메모 blockquote 1개\n" +
    `7) 결정 가이드 체크리스트 5개 + ${brandName(slot)} CTA\n\n` +
    "전체 분량: 3200~5000자\n\n" +
    commonConstraints(slot)
  );
}

function t05(slot: SlotForPrompt): string {
  const keyword = slot.primary_keyword;
  const persona = slot.persona || "예산이 빠듯한 분";
  const modifier = slot.modifier_1 || "비용 절약";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${keyword} 전략 BEST 7 (${modifier})\n` +
    `타깃: ${persona}\n\n` +
    "구성:\n" +
    "1) 도입 — 평균 비용 수준 언급 + 절약 가능 폭(체감), [IMAGE_SLOT: hero] 삽입\n" +
    "2) 절약 전략 7가지 (번호 + 굵은 헤드라인 + 본문 180~250자)\n" +
    "3) 전략 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: shuttle] 삽입\n" +
    "4) 절약 시 주의할 함정 3가지 (각 180자 이상)\n" +
    "5) 마지막 요약 표는 [TABLE_SLOT: saving_strategy] placeholder로 삽입\n" +
    `6) 검증된 후기가 있으면 후기 인용, 없으면 상담 전 확인 메모 blockquote 1개 + ${brandName(slot)} CTA\n\n` +
    "전체 분량: 3200~5200자\n\n" +
    commonConstraints(slot)
  );
}

function t06(slot: SlotForPrompt): string {
  const keyword = slot.primary_keyword;
  const intent = slot.intent || "시험팁";
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${keyword} 핵심 BEST 5 (${intent})\n\n` +
    "구성:\n" +
    "1) 도입 (왜 이 부분에서 많이 떨어지는지, 350~450자, [IMAGE_SLOT: hero] 삽입)\n" +
    "2) 핵심 항목 5개 (각 항목 H3 + 본문 220~300자)\n" +
    "3) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입\n" +
    "4) 실전 체크 표는 [TABLE_SLOT: exam_checklist] placeholder로 삽입\n" +
    "5) FAQ 5개 (실제 응시생들의 빈도 높은 질문)\n" +
    `6) 검증된 후기가 있으면 후기 인용, 없으면 상담 전 확인 메모 blockquote 1개 + ${brandName(slot)} CTA\n\n` +
    "전체 분량: 3200~5000자\n\n" +
    commonConstraints(slot)
  );
}

function t07(slot: SlotForPrompt): string {
  const region = slot.region ?? "";
  const intent = slot.intent || "종합 가이드";
  const keyword = slot.primary_keyword;
  return (
    `${systemInstruction(slot)}\n\n` +
    `주제: ${region} ${keyword} ${intent} (허브 페이지)\n\n` +
    "허브 페이지는 카테고리의 중심 노드입니다. " +
    "하위 글들을 큐레이션하는 느낌으로 작성하되, 실제 링크는 [INTERNAL_LINK: 키워드] 형태로 placeholder 남기세요.\n\n" +
    "구성:\n" +
    "1) 인트로 (이 지역/주제 전체 개관, 400~500자, [IMAGE_SLOT: hero] 삽입)\n" +
    "2) 핵심 하위 주제 5~7개 (각 주제 2문단 + [INTERNAL_LINK: ...] placeholder 2~3개)\n" +
    "3) 비교 표는 [TABLE_SLOT: hub_comparison] placeholder로 삽입\n" +
    "4) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: shuttle] 삽입\n" +
    "5) FAQ 5개 (각 답변 100자 이상)\n" +
    "6) 검증된 후기가 있으면 후기 인용, 없으면 상담 전 확인 메모 blockquote 1개\n" +
    "7) 마지막 CTA + 내부링크 placeholder 3~5개\n\n" +
    "전체 분량: 3400~5600자\n\n" +
    commonConstraints(slot)
  );
}

const TEMPLATE_REGISTRY: Record<string, (slot: SlotForPrompt) => string> = {
  T01: t01, T02: t02, T03: t03, T04: t04, T05: t05, T06: t06, T07: t07,
};

export const ALL_TEMPLATES = Object.keys(TEMPLATE_REGISTRY);

export function renderPrompt(slot: SlotForPrompt): string {
  const builder = TEMPLATE_REGISTRY[slot.template_id];
  if (!builder) throw new Error(`unknown template_id: ${slot.template_id} (slot ${slot.slot_id})`);
  return `${builder(slot)}\n\n${factualConstraints(slot)}\n\n${designConstraints(slot)}`;
}

function factualConstraints(slot: SlotForPrompt): string {
  const facts = slot.content_brief?.trim();
  return (
    "팩트 사용 규칙:\n" +
    "- 아래 '검증된 자료'와 슬롯 정보에 없는 학원명, 업체명, 주소, 전화번호, 가격, 셔틀 노선, 합격률, 리뷰 문구, 평점을 절대 생성하지 마세요.\n" +
    "- 웹검색 자료에 '신뢰도: 참고용'으로 표시된 블로그/카페/SEO 글의 상호명·가격·후기는 사실로 단정하지 마세요. 구체 정보는 '신뢰도: 검증용' 출처나 사용자가 직접 입력한 자료에 있을 때만 사용하세요.\n" +
    `- 검증된 자료에 실제 학원 목록이 없으면 BEST 글이라도 실제 상호명 순위를 쓰지 말고, '고르는 기준', '확인 질문', '${brandName(slot)} 앱에서 비교할 항목' 중심으로 작성하세요.\n` +
    "- 가격은 입력 자료에 있는 값만 사용하세요. 없으면 '학원별 상이', '상담 시 확인', '도로주행/보험료/검정료 포함 여부 확인'처럼 불확실성을 표시하세요.\n" +
    "- 후기는 입력 자료에 있는 문장만 인용하세요. 없으면 실제 후기처럼 꾸미지 말고 상담 전 확인 메모로 작성하세요.\n" +
    "- 이미지 URL이나 외부 이미지 출처를 임의로 만들지 말고 IMAGE_SLOT만 남기세요.\n" +
    "\n출처 표기 규칙:\n" +
    "- '검증된 자료'의 각 항목은 [1], [2] 처럼 번호가 매겨져 있습니다. 그 자료에서 가져온 가격·합격률·통계·주소·후기 문장 끝에는 해당 번호를 [1] 형태로 붙이세요.\n" +
    "- 표(TABLE_SLOT이 아닌 실제 마크다운 표)에 자료 기반 수치를 넣을 때도 셀 또는 표 바로 아래 문단에 출처 번호를 표기하세요.\n" +
    "- 글 맨 마지막에 '## 참고자료' H2 섹션을 만들고, 본문에서 실제 인용한 출처만 `1. 출처 제목 — URL` 형식의 번호 목록으로 나열하세요. 인용하지 않은 출처는 넣지 마세요.\n" +
    "- 자료가 전혀 없으면 수치를 지어내지 말고 '상담 시 확인', '학원별 상이'로 쓰고, 이때는 참고자료 섹션을 생략하세요.\n" +
    "- '출처: (브랜드명)' 처럼 근거 없는 가짜 출처 꼬리표를 후기나 수치에 붙이지 마세요.\n" +
    `검증된 자료:\n${facts || "(제공된 실제 학원/가격/셔틀/후기 자료 없음)"}\n`
  );
}

function designConstraints(slot: SlotForPrompt): string {
  const custom = slot.custom_design_templates?.trim();
  if (custom) {
    return (
      "선택된 디자인 템플릿: 직접 입력\n" +
      "아래 디자인 메모가 실제 글 구조에 드러나도록 섹션 순서, CTA 위치, 표/이미지 배치를 조정하세요.\n" +
      `${custom}\n`
    );
  }

  const id = slot.design_template_id ?? "editorial";
  const rules: Record<DesignTemplateId, string> = {
    editorial:
      `${brandName(slot)} 매거진: 상단 CTA 다음 큰 대표 이미지, 중앙 제목, 부드러운 구분선, 본문 중간 이미지와 마지막 예약 CTA가 자연스럽게 이어지는 매거진형 구성.`,
    comparison:
      "BEST 비교 블로그: 초반에 비교 기준과 요약표가 먼저 나오고, 후보별 장단점과 추천 페르소나를 명확히 나누는 비교 중심 구성.",
    "local-guide":
      "지역 추천 블로그: 지역명, 셔틀, 동선, 역세권/주거지 접근성을 반복적으로 강조하고 로컬 탐색 가이드처럼 구성.",
    checklist:
      "체크리스트 블로그: 등록 전 확인 항목, 절차, 주의사항, FAQ를 체크리스트 중심으로 배치하고 짧은 요약 박스를 자주 사용.",
    conversion:
      "예약 전환 블로그: 문제 공감 이후 비용/시간 절약 근거와 후기, 상담/예약 CTA를 중간과 마지막에 강하게 배치하는 전환 중심 구성.",
    custom:
      `직접 입력 디자인: 사용자가 입력한 디자인 메모가 없으면 ${brandName(slot)} 매거진 구조를 따른다.`,
  };

  return (
    `선택된 디자인 템플릿: ${id}\n` +
    `${rules[id]}\n` +
    "주의: 디자인 템플릿은 단순 색상이 아니라 글의 섹션 순서, 표 위치, 이미지 슬롯 위치, CTA 강도에 반영되어야 합니다.\n"
  );
}
