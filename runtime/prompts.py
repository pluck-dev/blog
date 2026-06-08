"""슬롯 → LLM 프롬프트 변환.

docs/PROMPT_LIBRARY.md 의 T01~T07 템플릿을 Python 함수로 옮긴 것.
슬롯 dict 의 필수 키: template_id, primary_keyword
선택 키: region, persona, modifier_1, modifier_2, intent, title_pattern_seed
"""

from __future__ import annotations

import os
from typing import Callable

# 발행 주체 브랜드. 환경변수로 교체 가능. 경쟁사 '운전선생'은 본문에 절대 노출 금지.
BRAND = os.environ.get("SEO_BRAND_NAME", "운전면허플러스")


SYSTEM_INSTRUCTION = (
    "당신은 10년 경력의 한국어 SEO 블로그 작가입니다. "
    f'최종 발행 주체는 "{BRAND}" 입니다. 본문 브랜드명과 CTA는 반드시 "{BRAND}"만 사용하고, '
    "경쟁사명 '운전선생'은 어떤 맥락에서도 절대 쓰지 마세요. "
    "글은 자연스럽고 실제 사람이 쓴 것처럼 보여야 하며 "
    "AI 흔적(예: '이 글에서는~', '오늘은 알아보겠습니다') 을 피합니다. "
    "제공된 자료에서 가져온 가격·합격률·통계·주소 같은 수치는 문장 끝에 [1], [2] 형식의 출처 번호를 달고, "
    "글 맨 끝 '## 참고자료' 섹션에 그 번호와 출처 제목·URL을 나열하세요. "
    "근거가 없는 수치·상호명·후기는 지어내지 말고 '상담 시 확인' 같은 표현으로 대체하며, "
    "'출처: (브랜드명)' 같은 근거 없는 가짜 출처 꼬리표는 절대 붙이지 마세요. "
    "최종 발행본은 충분한 글양, 중간 이미지, 표, 인용, CTA가 있는 완성형 글이어야 합니다."
)

FORBIDDEN_PHRASES = [
    "이 글에서는", "오늘은 알아보겠습니다", "마무리하며",
    "완벽하게", "확실히", "100%", "절대",
]


def _common_constraints() -> str:
    return (
        "출력 규칙:\n"
        "- markdown 만 출력. 코드블록(```) 으로 감싸지 말 것.\n"
        "- 제목은 # 한 줄, 부제목은 ## 사용.\n"
        f"- 다음 표현 금지: {', '.join(FORBIDDEN_PHRASES)}\n"
        "- 종결어미는 '~입니다 / ~예요 / ~죠 / ~네요' 를 적절히 섞어 단조로움 회피.\n"
        "- 첫 줄은 반드시 # 으로 시작하는 제목.\n"
        "- 본문 공백 제외 2,000~3,200자 분량으로 충실하게 작성(너무 짧으면 발행 불가). "
        "각 섹션을 구체적 예시·비교·확인 포인트로 충분히 풀되, 의미 없는 반복 패딩은 금지.\n"
        "- H2는 4~7개, 각 핵심 H2 아래에는 2~3문단을 배치.\n"
        "- [IMAGE_SLOT: hero] 1개와 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior], [IMAGE_SLOT: shuttle] 중 2개 이상을 본문 중간에 자연스럽게 삽입.\n"
        "- [TABLE_SLOT: ...] 1개 이상을 반드시 삽입. 표 주변에는 표를 해석하는 문단을 붙일 것.\n"
        "- 실제 후기처럼 읽히는 blockquote 1개 이상, 체크리스트 또는 bullet list 1개 이상 포함.\n"
        f"- 마지막에는 {BRAND} 앱/예약/주변 학원 찾기 CTA와 [INTERNAL_LINK: ...] placeholder 1개 이상 포함.\n"
        "- 본문 맨 끝에는 해시태그 5개를 한 줄로 (예: #지역명운전면허 #운전면허학원 #운전연수 #초보운전 #면허취득).\n"
        "- 표·이미지 슬롯은 후처리에서 치환되므로 절대 삭제하거나 임의 URL로 바꾸지 말 것.\n"
        "- IMAGE/TABLE/INTERNAL_LINK 슬롯은 반드시 영문 대문자 형식 그대로 출력 "
        "([IMAGE_SLOT: ...], [TABLE_SLOT: ...], [INTERNAL_LINK: ...]). '[내부링크: ...]' 같은 한글 변형 금지.\n"
        "출처 표기 규칙:\n"
        "- 제공된 '검증된 자료'는 [1], [2] 번호가 매겨져 있습니다. 그 자료에서 가져온 가격·합격률·통계·주소·후기는 문장 끝에 [1] 형태로 번호를 붙이세요.\n"
        "- 본문에서 출처를 1개라도 인용했다면, 해시태그 줄 바로 앞에 '## 참고자료' H2 섹션을 만들고 인용한 출처만 '1. 제목 — URL' 형식으로 나열하세요.\n"
        "- 검증된 자료가 없으면 가격·후기·상호명을 지어내지 말고 '상담 시 확인'으로 쓰고, 참고자료 섹션은 생략하세요.\n"
    )


def t01_region_best5(slot: dict) -> str:
    region = slot.get("region", "")
    persona = slot.get("persona") or "일반 운전자"
    keyword = slot["primary_keyword"]
    mods = ", ".join(filter(None, [slot.get("modifier_1"), slot.get("modifier_2")])) or "가성비, 셔틀 편리"
    # 운전선생 실측 구조: 도입+메인이미지 → 비교 표 → 학원별(이미지+⭐POINT 3개+후기) ×3 → 마무리.
    # 학원 3곳 비교가 기본형 (실측 글이 3곳). 본문은 2,400~3,000자로 간결하게.
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {region} {keyword} 비교 — 합격률 높은 3곳 엄선\n"
        f"타깃 페르소나: {persona}\n"
        f"강조 키워드: {mods}\n\n"
        "검증된 자료에 실제 학원 3곳 정보가 있을 때만 그 상호명을 사용하세요. "
        "자료가 없으면 상호명을 지어내지 말고 '학원 선택 기준 3가지' 형식으로 바꿔 작성하세요.\n\n"
        "구성:\n"
        f"1) 도입 — {region} 운전 환경/학원 분포에 공감하는 멘트 2~3문장 (250~350자, [IMAGE_SLOT: hero] 삽입)\n"
        "2) ## 핵심 정보 한눈에 비교 — [TABLE_SLOT: academy_comparison] 삽입 + 표 해석 1문단.\n"
        "   표 컬럼은 반드시: 학원명 | 핵심 특징 | 수강료 | 주소 (행 3개)\n"
        "3) 학원 3곳을 각각 ## H2 한 개씩 배정. 각 학원 블록은 다음을 모두 포함:\n"
        "   - 학원 소개 2~3문장 (180~260자)\n"
        "   - [IMAGE_SLOT: exterior] 또는 [IMAGE_SLOT: interior] 또는 [IMAGE_SLOT: shuttle] 중 1개 (학원마다 다른 슬롯)\n"
        "   - '⭐ POINT 1 / ⭐ POINT 2 / ⭐ POINT 3' 형식의 핵심 강점 3개 (각 한 줄)\n"
        "   - 검증된 후기 자료가 있을 때만 그 문장을 blockquote로 인용하고 끝에 출처 번호 [n] 표기. "
        "자료가 없으면 후기를 지어내지 말고 '상담 전 확인하면 좋은 질문' blockquote 1개로 대체\n"
        f"4) ## 마무리 — 어떤 사람에게 어느 학원이 맞는지 1~2문장 정리 + {BRAND} 앱/주변 학원 찾기 CTA "
        "+ [INTERNAL_LINK: ...] 1개 이상 (200~300자)\n\n"
        "전체 분량: 2,400~3,000자\n\n"
        f"{_common_constraints()}"
    )


def t03_guide_overview(slot: dict) -> str:
    keyword = slot["primary_keyword"]
    persona = slot.get("persona") or "처음 준비하시는 분"
    modifier = slot.get("modifier_1") or "최단기"
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {keyword} 총정리 가이드 ({modifier})\n"
        f"타깃 페르소나: {persona}\n\n"
        "구성:\n"
        "1) 도입 — 왜 지금 이 정보를 찾는 사람이 많은가 (350~450자, [IMAGE_SLOT: hero] 삽입)\n"
        "2) 절차 단계별 정리 (numbered list, 각 단계 180~250자)\n"
        "3) 비용/시간 표는 [TABLE_SLOT: cost_time] placeholder로 삽입하고 표 해석 문단 작성\n"
        "4) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입\n"
        "5) 자주 묻는 질문 FAQ 5개 (Q/A, 각 답변 100자 이상)\n"
        f"6) 마지막 체크리스트 (- 으로 5~7항목) + {BRAND} CTA\n\n"
        "전체 분량: 2,500~3,200자\n\n"
        f"{_common_constraints()}"
    )


def t04_option_compare(slot: dict) -> str:
    keyword = slot["primary_keyword"]
    persona = slot.get("persona") or "선택 고민 중인 분"
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {keyword} 옵션 비교 (가격·기간·난이도·활용도)\n"
        f"타깃: {persona}\n\n"
        "구성:\n"
        "1) 도입 (350~450자, 왜 비교가 필요한지, [IMAGE_SLOT: hero] 삽입)\n"
        "2) 두 옵션 정의와 선택 전제 설명\n"
        "3) 비교 표는 [TABLE_SLOT: option_comparison] placeholder로 삽입하고 4~6행 구성\n"
        "4) 옵션 A 추천 케이스 (450~600자, 페르소나 시나리오, [IMAGE_SLOT: exterior] 삽입)\n"
        "5) 옵션 B 추천 케이스 (450~600자, [IMAGE_SLOT: interior] 삽입)\n"
        "6) 검증된 후기 자료가 있으면 출처 번호와 함께 인용, 없으면 '상담 전 확인 질문' blockquote 1개\n"
        f"7) 결정 가이드 체크리스트 5개 + {BRAND} CTA\n\n"
        "전체 분량: 2,500~3,200자\n\n"
        f"{_common_constraints()}"
    )


def t05_cost_save(slot: dict) -> str:
    keyword = slot["primary_keyword"]
    persona = slot.get("persona") or "예산이 빠듯한 분"
    modifier = slot.get("modifier_1") or "비용 절약"
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {keyword} 전략 BEST 7 ({modifier})\n"
        f"타깃: {persona}\n\n"
        "구성:\n"
        "1) 도입 — 평균 비용 수준 언급 + 절약 가능 폭(체감), [IMAGE_SLOT: hero] 삽입\n"
        "2) 절약 전략 7가지 (번호 + 굵은 헤드라인 + 본문 180~250자)\n"
        "3) 전략 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: shuttle] 삽입\n"
        "4) 절약 시 주의할 함정 3가지 (각 180자 이상)\n"
        "5) 마지막 요약 표는 [TABLE_SLOT: saving_strategy] placeholder로 삽입\n"
        f"6) 검증된 후기 자료가 있으면 출처 번호와 함께 인용, 없으면 '상담 전 확인 질문' blockquote 1개 + {BRAND} CTA\n\n"
        "전체 분량: 2,500~3,200자\n\n"
        f"{_common_constraints()}"
    )


def t06_exam_best5(slot: dict) -> str:
    keyword = slot["primary_keyword"]
    intent = slot.get("intent") or "시험팁"
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {keyword} 핵심 BEST 5 ({intent})\n\n"
        "구성:\n"
        "1) 도입 (왜 이 부분에서 많이 떨어지는지, 350~450자, [IMAGE_SLOT: hero] 삽입)\n"
        "2) 핵심 항목 5개 (각 항목 H3 + 본문 220~300자)\n"
        "3) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입\n"
        "4) 실전 체크 표는 [TABLE_SLOT: exam_checklist] placeholder로 삽입\n"
        "5) FAQ 5개 (실제 응시생들의 빈도 높은 질문)\n"
        f"6) 검증된 후기 자료가 있으면 출처 번호와 함께 인용, 없으면 '상담 전 확인 질문' blockquote 1개 + {BRAND} CTA\n\n"
        "전체 분량: 2,500~3,200자\n\n"
        f"{_common_constraints()}"
    )


def t07_hub(slot: dict) -> str:
    region = slot.get("region") or ""
    intent = slot.get("intent") or "종합 가이드"
    keyword = slot["primary_keyword"]
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {region} {keyword} {intent} (허브 페이지)\n\n"
        "허브 페이지는 카테고리의 중심 노드입니다. "
        "하위 글들을 큐레이션하는 느낌으로 작성하되, 실제 링크는 [INTERNAL_LINK: 키워드] 형태로 placeholder 남기세요.\n\n"
        "구성:\n"
        "1) 인트로 (이 지역/주제 전체 개관, 400~500자, [IMAGE_SLOT: hero] 삽입)\n"
        f"2) 핵심 하위 주제 5~7개 (각 주제 2문단 + [INTERNAL_LINK: ...] placeholder 2~3개)\n"
        "3) 비교 표는 [TABLE_SLOT: hub_comparison] placeholder로 삽입\n"
        "4) 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: shuttle] 삽입\n"
        "5) FAQ 5개 (각 답변 100자 이상)\n"
        "6) 검증된 후기 자료가 있으면 출처 번호와 함께 인용, 없으면 '상담 전 확인 질문' blockquote 1개\n"
        "7) 마지막 CTA + 내부링크 placeholder 3~5개\n\n"
        "전체 분량: 2,600~3,400자\n\n"
        f"{_common_constraints()}"
    )


def t02_single_entity(slot: dict) -> str:
    entity = slot.get("entity_id") or "○○학원"
    region = slot.get("region") or ""
    modifier = slot.get("modifier_1") or "친절강사"
    return (
        f"{SYSTEM_INSTRUCTION}\n\n"
        f"주제: {region} {entity} 단일 소개 ({modifier})\n\n"
        "구성:\n"
        "1) 인트로 (이 업체가 이런 분에게 어울린다 — 350~450자, [IMAGE_SLOT: hero] 삽입)\n"
        "2) 강점 4가지 (H3 + 본문 220~300자, 중간에 [IMAGE_SLOT: exterior], [IMAGE_SLOT: interior] 삽입)\n"
        "3) 이용 절차 또는 코스 안내 표는 [TABLE_SLOT: academy_course] placeholder로 삽입\n"
        "4) 검증된 후기 자료가 있으면 출처 번호와 함께 발췌 인용(blockquote 1개 포함), 없으면 후기를 지어내지 말고 '상담 전 확인 질문' 3개로 대체\n"
        "5) 위치/셔틀/비용 안내 placeholder + CTA + [INTERNAL_LINK: ...]\n\n"
        "전체 분량: 2,500~3,200자\n\n"
        f"{_common_constraints()}"
    )


TEMPLATE_REGISTRY: dict[str, Callable[[dict], str]] = {
    "T01": t01_region_best5,
    "T02": t02_single_entity,
    "T03": t03_guide_overview,
    "T04": t04_option_compare,
    "T05": t05_cost_save,
    "T06": t06_exam_best5,
    "T07": t07_hub,
}


def _facts_section(slot: dict) -> str:
    """검증된 학원 자료(facts) 주입 섹션. 워커가 slot['facts'] 에 번호매긴 자료를 채워준다."""
    facts = (slot.get("facts") or "").strip()
    if facts:
        return (
            "검증된 자료 (아래 [번호]를 본문 인용과 '## 참고자료' 섹션에 사용):\n"
            f"{facts}\n\n"
            "규칙: 위 자료에 있는 상호명·주소·수강료·셔틀·합격률만 사용하고, 해당 수치 문장 끝에 [번호]를 다세요. "
            "자료에 없는 정보는 지어내지 말고 '상담 시 확인'으로 쓰세요. "
            "본문에서 인용한 출처만 '## 참고자료'에 '번호. 출처명 — URL' 형식으로 나열하세요."
        )
    return (
        "검증된 자료: (없음) — 실제 상호명·가격·후기·합격률을 지어내지 말고, "
        "'고르는 기준'·'상담 시 확인' 중심으로 작성하고 '## 참고자료' 섹션은 생략하세요."
    )


def render(slot: dict) -> str:
    """슬롯의 template_id 에 맞는 프롬프트 빌더를 호출하고, 검증된 자료(facts)를 주입."""
    tid = slot.get("template_id") or ""
    builder = TEMPLATE_REGISTRY.get(tid)
    if builder is None:
        raise ValueError(f"unknown template_id: {tid!r} (slot {slot.get('slot_id')})")
    return f"{builder(slot)}\n\n{_facts_section(slot)}"
