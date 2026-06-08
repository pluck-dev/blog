import type { DesignTemplateId } from "./types";

export interface DesignTemplatePreset {
  id: DesignTemplateId;
  name: string;
  summary: string;
  bestFor: string;
  sections: string[];
  tone: string;
}

export const DESIGN_TEMPLATE_PRESETS: DesignTemplatePreset[] = [
  {
    id: "editorial",
    name: "브랜드 매거진",
    summary: "보라 상단 CTA, 큰 대표 이미지, 중앙 제목, 부드러운 본문 구분선으로 브랜드형 블로그에 가깝게 구성합니다.",
    bestFor: "정보성 키워드, 초보자 가이드, 총정리 글",
    sections: ["상단 CTA", "대표 이미지", "중앙 제목", "본문", "예약 CTA"],
    tone: "차분하고 친절한 전문가 톤",
  },
  {
    id: "comparison",
    name: "BEST 비교 블로그",
    summary: "브랜드 톤은 유지하되 비교표와 추천 기준이 더 먼저 눈에 들어오게 만든 블로그형 템플릿입니다.",
    bestFor: "BEST5, 추천, 가격/기간/옵션 비교",
    sections: ["비교 기준", "요약 표", "선택지별 장단점", "추천 케이스", "CTA"],
    tone: "객관적이고 판단이 쉬운 톤",
  },
  {
    id: "local-guide",
    name: "지역 추천 블로그",
    summary: "지역명, 셔틀, 동선 정보를 강조하고 점선 구분선으로 로컬 탐색 느낌을 살립니다.",
    bestFor: "지역 SEO, 근처/주변/동네 검색어",
    sections: ["지역 고민", "주변 선택 기준", "동선/접근성", "추천 시나리오", "CTA"],
    tone: "현장감 있는 로컬 큐레이터 톤",
  },
  {
    id: "checklist",
    name: "체크리스트 블로그",
    summary: "브랜드 기본 디자인 위에 저장하고 싶은 체크리스트 박스와 노란 강조 구분선을 더합니다.",
    bestFor: "시험, 신청, 준비, 절차 키워드",
    sections: ["요약", "준비 체크", "절차", "주의사항", "FAQ"],
    tone: "간결하고 실무적인 안내 톤",
  },
  {
    id: "conversion",
    name: "예약 전환 블로그",
    summary: "보라/노랑 대비를 강하게 써서 앱 다운로드, 상담, 예약 버튼이 더 잘 보이게 구성합니다.",
    bestFor: "예약, 상담, 비용 문의, 업체 소개",
    sections: ["문제 공감", "해결 기준", "사례/후기", "비용/혜택", "CTA"],
    tone: "신뢰를 주는 세일즈 톤",
  },
];

export function getDesignTemplatePreset(id: string | null | undefined): DesignTemplatePreset {
  return DESIGN_TEMPLATE_PRESETS.find((tpl) => tpl.id === id) ?? DESIGN_TEMPLATE_PRESETS[0];
}
