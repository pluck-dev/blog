# 프로그래매틱 SEO 프롬프트 라이브러리 (한국어 양산용)

> `PROGRAMMATIC_SEO_PLAYBOOK.md`의 3장(템플릿·프롬프트)을 풀 디테일로 확장한 실전 라이브러리.
> 그대로 복붙해서 LLM API에 넣을 수 있게 작성. 모든 변수는 `{변수명}`으로 표기.

## 현재 런타임 기본 품질 계약

`apps/api-nest/src/worker.service.ts`의 실제 생성 파이프라인은 아래 규칙을 모든 신규 글에 공통 적용한다.

- API/DB 자료는 **사실 원천**으로만 사용한다. 제목의 지역·키워드와 직접 맞는 학원만 후보, 표, 사진, CTA에 사용하며, API URL은 독자용 참고자료/출처로 노출하지 않는다.
- 주변 지역·유사 생활권 학원을 섞어 후보 수를 늘리지 않는다. 후보가 부족하면 부족한 그대로 설명한다.
- 검증된 자료에 없는 가격, 합격률, 셔틀, 후기, 3일 합격, 지역화폐, 전화번호는 생성하지 않는다.
- 글은 운전선생 블로그형 품질을 기본값으로 한다: 자연스러운 도입, H2 6개 이상, 후보별 설명, 비교표, 체크리스트, FAQ, 이미지, CTA.
- 분량은 3,000~5,000자 이내를 목표로 하며, 런타임 품질 게이트가 2,600자 미만 또는 5,000자 초과 글을 재작성/차단한다.
- 후보가 2곳 이상이면 Markdown 비교표가 필수다. 사용 가능한 이미지가 있으면 `[IMAGE:academy_N]` 슬롯이 본문에 포함되어야 한다.
- `[1]`, `[2]` 같은 출처번호, `[IMAGE_SLOT: ...]` 같은 임의 플레이스홀더, “검증된 자료/API 자료/참고자료/DrivingPlus API URL” 같은 내부 표현은 발행 본문에 노출하지 않는다.
- 출처/참고자료는 도로교통공단처럼 외부 공신력 자료를 실제로 인용했을 때만 남긴다. 학원 API는 내부 데이터이므로 출처 목록에 쓰지 않는다.
- 품질 게이트 실패 시 한 번 자동 재작성하고, 재작성 후에도 실패하면 낮은 품질 글을 발행하지 않는다.

## 목차
1. [라이브러리 아키텍처](#1-라이브러리-아키텍처)
2. [System Prompt — 페르소나 정의](#2-system-prompt--페르소나-정의)
3. [공통 규칙 블록 (모든 템플릿 공유)](#3-공통-규칙-블록-모든-템플릿-공유)
4. [무작위성·다양성 변수](#4-무작위성다양성-변수)
5. [템플릿 1: 지역 BEST 5 비교](#5-템플릿-1-지역-best-5-비교)
6. [템플릿 2: 학원 단일 집중 소개](#6-템플릿-2-학원-단일-집중-소개)
7. [템플릿 3: 가이드형 (총정리/절차)](#7-템플릿-3-가이드형-총정리절차)
8. [템플릿 4: 비교형 (1종 vs 2종 같은 옵션 비교)](#8-템플릿-4-비교형-1종-vs-2종-같은-옵션-비교)
9. [템플릿 5: 비용/가격 절약 전략](#9-템플릿-5-비용가격-절약-전략)
10. [템플릿 6: 시험·필기 BEST5](#10-템플릿-6-시험필기-best5)
11. [메타데이터(제목/디스크립션/키워드) 생성기](#11-메타데이터제목디스크립션키워드-생성기)
12. [Anti-AI-Detection 규칙](#12-anti-ai-detection-규칙)
13. [검증·재생성 트리거](#13-검증재생성-트리거)
14. [실 호출 코드 (Anthropic + OpenAI)](#14-실-호출-코드-anthropic--openai)

---

## 1. 라이브러리 아키텍처

```
prompts/
├─ system/
│  ├─ persona_seo_blogger.md       # 베이스 페르소나
│  ├─ persona_local_expert.md      # 지역 전문가 페르소나
│  └─ persona_beginner_friendly.md # 초보자 친화 페르소나
├─ shared/
│  ├─ common_rules.md              # 모든 템플릿 공유 규칙
│  ├─ anti_detection.md            # AI 흔적 제거 규칙
│  ├─ ko_style_guide.md            # 한국어 문체 가이드
│  └─ forbidden_phrases.md         # 금지 표현 목록
├─ templates/
│  ├─ T01_region_best5.yaml
│  ├─ T02_single_academy.yaml
│  ├─ T03_guide.yaml
│  ├─ T04_comparison.yaml
│  ├─ T05_cost_strategy.yaml
│  └─ T06_exam_best5.yaml
├─ meta/
│  ├─ title_generator.md
│  ├─ description_generator.md
│  └─ keyword_expander.md
└─ validators/
   ├─ structural.py                 # 길이/구조 검증
   ├─ similarity.py                 # 임베딩 유사도 검증
   └─ detection.py                  # GPTZero/Originality 점검
```

각 템플릿은 YAML 형태로 정의되며, 다음 키를 갖는다:
- `id`, `version`, `intent`, `audience`
- `system_prompt_ref` — system 폴더 참조
- `sections[]` — 섹션별 프롬프트
- `variables[]` — 주입 변수 명세
- `constraints` — 길이/금지어/필수요소
- `meta_template` — 제목/디스크립션 패턴
- `few_shot` — 1~2개의 짧은 예시

---

## 2. System Prompt — 페르소나 정의

### 2.1 베이스 페르소나 (`persona_seo_blogger.md`)

```
당신은 한국어 SEO 블로그를 10년 이상 운영한 베테랑 작가입니다.

[전문성]
- 운전·자동차·교통·면허 분야 정보를 다루며, 검색 의도를 정확히 읽어 글의 구조와 톤을 매번 조정합니다.
- 네이버/구글/다음 검색 알고리즘의 차이를 이해하고, 양쪽 모두에 친화적인 글을 씁니다.
- 표시광고법, 저작권법을 인지하고 과장·허위 표현을 절대 쓰지 않습니다.

[문체 원칙]
1. **존댓말 일관성**: 한 글 안에서 "~입니다/~예요" 톤을 섞지 않습니다.
2. **친근하지만 정보 밀도 ↑**: 잡담은 도입과 클로징에만, 본문은 사실·숫자·실용 정보 위주.
3. **문장 길이 다양성**: 짧은 문장(15자 이하)과 긴 문장(40자 이상)을 의도적으로 섞어 리듬을 만듭니다.
4. **자연스러운 감탄/접속어**: 단, 한 문단에 1회 이하로 절제 ("자, 그럼", "정말로", "솔직히" 등).
5. **이모지**: 300자당 1~2개 이하. 본문보다 소제목·강조 포인트에 배치.

[금지]
- "이 글에서는 ~를 알아보겠습니다" 같은 메타 멘트
- "결론적으로", "다시 한번 말씀드리지만" 같은 중복 강조
- "최고의", "완벽한", "100%", "절대로", "무조건" 같은 단정·과장
- "여러분도 ~하실 수 있습니다!" 같은 정형 마케팅 클로징
- 같은 단어를 한 문단에서 3번 이상 반복

[필수]
- 글의 시작은 본론 키워드를 1문장 안에 자연스럽게 포함 (네이버 D.I.A. 알고리즘 대응)
- 가격·통계·시간 같은 숫자 정보는 출처(연도·기관)를 함께 표기
- 외부 사실 인용 시 출처 명시 ("도로교통공단 2025년 발표 기준" 등)
- 결말은 다음 행동(상담 신청, 후속 글 클릭)으로 자연스럽게 연결
```

### 2.2 변형 페르소나

**`persona_local_expert.md`** (지역 BEST5 같은 로컬 글에 사용)
```
[추가 페르소나]
- 해당 지역에서 5년 이상 거주한 로컬 전문가. 동네 분위기, 교통편, 주차 가능 여부 등 디테일을 알고 있음.
- 지역명을 글 내내 자연스럽게 3~5회 등장시키되, 키워드 스터핑처럼 보이지 않도록 다양한 표현 사용 (예: "수원시", "수원 시내", "수원 거주민들 사이에서").
```

**`persona_beginner_friendly.md`** (가이드형에 사용)
```
[추가 페르소나]
- 처음 운전면허를 따려는 사람의 시점에서 글을 씁니다.
- 전문 용어는 최초 1회 등장 시 괄호로 풀어서 설명 ("기능시험(운전 조작 실습 시험)").
- 절차 설명 시 번호 매기기로 시퀀스를 명확히.
```

---

## 3. 공통 규칙 블록 (모든 템플릿 공유)

`shared/common_rules.md` — 모든 user prompt 끝에 자동 첨부:

```
[공통 작성 규칙]

A. 구조
- H1은 메타 제목과 같거나 변형. 한 글에 H1은 단 한 번.
- H2 소제목 3~6개. 각 H2 아래 H3을 0~3개 둘 수 있음.
- 단락은 한 단락당 3~5문장. 줄바꿈으로 시각적 호흡 유지.
- 목록(불릿/번호)은 글당 1~2회만 사용. 본문이 통째로 목록이 되지 않도록.

B. SEO
- 주 키워드는 첫 100자 안에 1회, 본문 전체에 3~5회 자연스럽게 분포.
- 변형 키워드(동의어, 지역명+키워드 조합)를 의도적으로 섞어 LSI(잠재 의미 인덱싱) 강화.
- 외부 링크는 권위 있는 출처(.go.kr, 주요 언론사)만 1~2개. 내부 링크 슬롯은 [INTERNAL_LINK]로 표시.

C. 길이
- 최소 1,500자, 최대 3,000자 (공백 제외).
- 짧으면 검색 신호 약함, 길면 LLM이 반복 패턴 만들기 시작함.

D. 마크다운
- 출력은 마크다운. 코드블록은 사용 금지(블로그 컨텍스트에서 어색함).
- 강조는 **굵게**만 사용. 기울임은 한국어에서 가독성 떨어지므로 금지.
- 표(table)는 비교형 콘텐츠에서 1회 사용 가능.

E. 사실성
- 데이터는 주입된 {data_json}만 사용. 모르는 사실을 추측해서 작성 금지.
- 데이터가 비어있는 항목은 "정보 미공개"로 솔직히 표기. 환각 금지.
```

---

## 4. 무작위성·다양성 변수

같은 템플릿이 200번 호출돼도 글이 매번 달라지게 만드는 **변수 다이얼**:

```python
import random

DIVERSITY_KNOBS = {
    # LLM 파라미터
    "temperature": lambda: random.uniform(0.75, 0.95),
    "top_p": lambda: random.uniform(0.85, 0.95),

    # 도입 훅 스타일 (1개 선택)
    "intro_style": lambda: random.choice([
        "통계_훅",      # "도로교통공단에 따르면 매년 약 70만 명이..."
        "질문_훅",      # "운전면허, 빨리 따고 싶은데 어디서부터 시작해야 할지 막막하시죠?"
        "사연_훅",      # "회사 동료 A씨도 작년에 ○○에서 면허를 땄는데..."
        "비교_훅",      # "옆 동네 학원과 5만원 차이? 그 이유는..."
        "시즌_훅",      # "곧 여름방학, 면허 따기 가장 좋은 시기인데..."
    ]),

    # 클로징 스타일
    "outro_style": lambda: random.choice([
        "행동_유도",   # "지금 상담 예약하시면..."
        "요약_정리",   # "지금까지 살펴본 핵심을 다시 정리하면..."
        "다음_글_유도", # "다음 글에서는 ~를 다룰 예정입니다."
        "공감_마무리", # "운전면허 취득, 생각보다 어렵지 않죠?"
    ]),

    # 섹션 순서 셔플 (특정 섹션만)
    "shuffleable_sections": lambda sections: random.sample(sections, len(sections)),

    # 이모지 풀
    "emoji_set": lambda: random.sample([
        "🚗", "🛣️", "🅿️", "🚦", "🎯", "💡", "✨", "📝",
        "⏰", "💰", "🔑", "📍", "👍", "🌟", "📌", "🎓",
    ], k=4),

    # 종결어미 분포 (한 글 안에서)
    "ending_distribution": lambda: random.choice([
        {"입니다": 0.5, "예요": 0.3, "죠": 0.1, "네요": 0.1},
        {"입니다": 0.7, "예요": 0.2, "죠": 0.05, "네요": 0.05},
        {"예요": 0.6, "입니다": 0.3, "죠": 0.05, "네요": 0.05},
    ]),

    # 강조 빈도 (**굵게** 횟수)
    "bold_count": lambda: random.randint(3, 8),

    # 시점 명시 (글의 권위 ↑)
    "date_reference": lambda: random.choice([
        "2026년 5월 기준",
        "최근 (2026년 2분기)",
        "현행 기준 (2026년)",
        "가장 최신 정보 (2026년 5월 22일 확인)",
    ]),
}
```

이걸 모든 호출 시점에 generate한 뒤 프롬프트 변수로 주입합니다.

---

## 5. 템플릿 1: 지역 BEST 5 비교

**파일**: `templates/T01_region_best5.yaml`

```yaml
id: T01_region_best5
version: "1.2"
intent: "지역×학원 5곳 비교"
audience: "{region}에 거주하거나 출퇴근하는 운전면허 취득 희망자"
system_prompt_ref: persona_local_expert
language: ko

variables:
  - region              # "수원", "안산", "대구 동구" 등
  - persona_keyword     # "직장인", "대학생", "주부"
  - academy_data_json   # 학원 5개 정보 (이름, 가격, 위치, 셔틀, 합격률, 후기 등)
  - target_audience_pain # "셔틀 불편", "비싼 가격", "예약 어려움" 중 1~2개
  - intro_style         # 무작위성 변수에서 주입
  - outro_style
  - emoji_set
  - date_reference

meta_template:
  title:
    - "{region} 운전면허학원 BEST 5 | {persona_keyword} 추천 ({year})"
    - "{region}자동차운전학원 추천 BEST 5: {persona_keyword} 위한 학원 총정리"
    - "{region}운전면허학원 비교 BEST 5 — {pain_point} 해결까지"
  description:
    - "{region} 운전면허학원 추천 5곳을 비용·기간·셔틀 기준으로 비교. {persona_keyword}에게 딱 맞는 학원 찾기."
  keywords:
    - "{region}운전면허학원,{region}자동차학원,{region}운전학원,{persona_keyword}운전면허,운전면허추천"

constraints:
  min_length: 1800
  max_length: 2800
  must_include:
    - "{region}"                          # 본문에 5회 이상
    - "학원"
    - 가격_정보_1개_이상
    - 위치_정보_1개_이상
  must_not_include:
    - "최고의"
    - "완벽한"
    - "100%"
    - "절대"
  required_sections:
    - hook
    - problem
    - comparison_table
    - detail_5_academies
    - selection_tips
    - faq
    - cta

few_shot:
  - title_example: "수원운전면허학원 BEST 5: 직장인 추천, 셔틀 편한 학원 총정리"
    opening_example: |
      퇴근 후 운전학원까지 한 시간 넘게 걸려서 포기하셨던 분 계신가요?
      수원에서 출퇴근하는 직장인분들이라면 한 번쯤 겪어보셨을 고민이죠.
      이번 글에서는 셔틀 서비스가 편리하고, 야간·주말반이 활발한
      **수원 운전면허학원 5곳**을 추려서 비교해 드릴게요.

sections:
  - name: hook
    length: "180~250자"
    prompt: |
      {region}에서 운전면허를 따려는 {persona_keyword}의 입장에서 공감 가는 도입을 작성하세요.
      스타일: {intro_style}
      - 이 글의 주제(운전면허학원 비교)를 1문장 안에 자연스럽게 녹일 것
      - 클리셰 ("오늘은 ~를 알아보겠습니다") 금지
      - 이모지 1개 (선택: {emoji_set})

  - name: problem
    length: "250~350자"
    prompt: |
      {region}에서 운전학원을 고를 때 흔히 겪는 고민 2~3가지를 자연스럽게 나열하세요.
      특히 {target_audience_pain}에 초점.
      나열은 글자수 1/3 이하에서만, 나머지는 문단형 서술로.

  - name: comparison_table
    length: "표 1개 + 표 위 50자 도입"
    prompt: |
      아래 데이터를 사용해 5개 학원 비교표를 만드세요:
      {academy_data_json}

      비교 항목 (열): 학원명 | 위치 | 1종/2종 비용 | 교육 기간 | 셔틀 여부 | 특징 한 줄
      - 표 위에 1문장으로 "한눈에 비교해 보세요" 같은 도입
      - 표 아래는 빈 줄 1개로 끊기

  - name: detail_5_academies
    length: "각 학원 200~350자 × 5"
    prompt: |
      각 학원에 대해 다음 구성으로 한 문단씩:
      - **학원명** (H3 헤더)
      - 위치·접근성 (1~2문장)
      - 가격·기간 (1~2문장, {date_reference} 표기)
      - 강점·약점 (1~2문장, 솔직하게)
      - 추천 대상 1줄 ("{persona_keyword} 중 ~한 분께 추천")

      *주의: 5개 학원 설명이 같은 문장 구조로 반복되지 않도록.
      어떤 학원은 "강점부터", 어떤 학원은 "위치부터" 시작하는 식으로 도입 변형.

  - name: selection_tips
    length: "300~400자"
    prompt: |
      {region}에서 학원 고를 때 체크포인트 3가지를 제시.
      - 각 포인트는 굵게 한 줄 + 설명 2~3문장
      - "셔틀 동선 확인", "환불 약관 확인", "취득률 공시 확인" 같이 실용적 항목

  - name: faq
    length: "Q&A 3쌍, 각 100~150자"
    prompt: |
      자주 묻는 질문 3개를 Q/A 형식으로:
      - Q1: 비용 관련
      - Q2: 기간 관련
      - Q3: {persona_keyword} 특화 질문 (직장인이면 야간반, 대학생이면 방학반 등)
      *답변은 실용적·구체적으로. 가격은 데이터 안의 숫자만 사용.

  - name: cta
    length: "100~150자"
    prompt: |
      스타일: {outro_style}
      행동 유도: 학원별 상세 페이지 클릭 또는 무료 상담
      - 과장 금지 ("지금 바로 연락하세요!" 같은 마케팅 클로징 X)
      - [INTERNAL_LINK: {region}_가이드_페이지] 표시 1개

output_format: markdown
post_validation:
  - check: keyword_density
    target: "{region}"
    min_occurrences: 5
    max_occurrences: 12
  - check: section_count
    min: 6
  - check: image_slot_count
    expected: 3  # ![image_slot_1] ~ ![image_slot_3] 자리 표시
```

### 5.1 실제 호출 예시 (Python 의사코드)

```python
from prompt_lib import load_template, render

t = load_template("T01_region_best5")
knobs = {k: f() for k, f in DIVERSITY_KNOBS.items() if not callable(f) or k != "shuffleable_sections"}

prompt = render(t, variables={
    "region": "수원",
    "persona_keyword": "직장인",
    "academy_data_json": json.dumps(academy_data),
    "target_audience_pain": "퇴근 후 시간 부족, 셔틀 불편",
    "year": "2026",
    "pain_point": "셔틀 불편",
    **knobs,
})

response = anthropic.messages.create(
    model="claude-sonnet-4-6",
    system=load_system_prompt(t["system_prompt_ref"]),
    messages=[{"role": "user", "content": prompt}],
    temperature=knobs["temperature"],
    max_tokens=4000,
)
```

---

## 6. 템플릿 2: 학원 단일 집중 소개

**파일**: `templates/T02_single_academy.yaml`

```yaml
id: T02_single_academy
version: "1.1"
intent: "단일 학원 1곳을 깊게 소개 (장점·후기·가격)"
audience: "특정 학원에 관심 있는 후보 학습자"
system_prompt_ref: persona_seo_blogger

variables:
  - academy_name           # "뉴삼성자동차운전전문학원"
  - academy_data_json      # 위치, 면허종류, 가격, 셔틀, 합격률, 시설
  - reviews_excerpt_json   # 사용자 후기 3~5개 발췌
  - nearby_region          # 학원이 커버하는 인근 지역 (이 글이 노릴 지역 키워드)
  - selling_point          # "친절한 강사", "최단기 3일", "셔틀 폭넓음" 중 택1
  - intro_style
  - emoji_set

meta_template:
  title:
    - "{academy_name}, {nearby_region}에서 {selling_point} 인기 학원"
    - "{academy_name} 후기 & 가격 총정리 — {nearby_region} 추천 운전학원"
  description:
    - "{academy_name}의 가격, 기간, 셔틀, 후기를 정리. {nearby_region} 지역에서 {selling_point}로 알려진 학원."

constraints:
  min_length: 1500
  max_length: 2500
  must_include:
    - "{academy_name}"     # 5회 이상
    - "{nearby_region}"    # 3회 이상
    - 가격 정보
    - 실제 후기 인용 2개 이상

sections:
  - name: hook
    length: "180~250자"
    prompt: |
      {nearby_region}에서 {selling_point}로 알려진 {academy_name}을 소개하는 도입을 작성하세요.
      스타일: {intro_style}
      - 학원 이름을 첫 문장에 자연스럽게 노출

  - name: why_this_academy
    length: "300~400자"
    prompt: |
      이 학원이 다른 학원과 다른 점 2~3가지를 설명. {selling_point}를 중심으로.
      - 추상적 형용사 ("훌륭한", "최고의") 금지
      - 구체적 숫자·사실 ("강사 1인당 학생 4명", "셔틀 12개 노선") 사용

  - name: detail_info
    length: "500~700자"
    prompt: |
      다음 데이터를 자연스럽게 본문에 녹여서 서술하세요:
      {academy_data_json}

      구조:
      ## 위치 & 접근성
      ## 면허 종류 & 가격
      ## 교육 일정 & 기간
      ## 시설 & 차량

      - 표는 가격 부분에만 1개 사용
      - 같은 형용사 반복 금지 (예: "넓은", "좋은"이 5번 이상 나오면 안 됨)

  - name: real_reviews
    length: "300~450자"
    prompt: |
      다음 후기를 1~2문장씩 자연스럽게 인용 (따옴표 사용):
      {reviews_excerpt_json}

      - 인용 후 작성자가 한 줄로 코멘트
      - 광고처럼 들리지 않게, 단점 후기도 1개는 포함 (있다면)

  - name: who_should_consider
    length: "200~300자"
    prompt: |
      이 학원이 잘 맞는 사람 / 안 맞는 사람을 솔직하게 1~2문장씩.
      - 솔직함이 신뢰감 형성에 결정적

  - name: cta
    length: "100~150자"
    prompt: |
      상담 예약 또는 가격 페이지로 자연스럽게 유도.
      [INTERNAL_LINK: {academy_name}_상세_페이지] 1개 포함.

post_validation:
  - check: review_quote_count
    min: 2
  - check: number_data_count   # 숫자가 본문에 6개 이상
    min: 6
```

---

## 7. 템플릿 3: 가이드형 (총정리/절차)

**파일**: `templates/T03_guide.yaml`

```yaml
id: T03_guide
version: "1.0"
intent: "특정 절차·제도·정보를 처음 접하는 사람에게 친절히 안내"
audience: "{topic}에 대해 전혀 모르는 입문자"
system_prompt_ref: persona_beginner_friendly

variables:
  - topic                  # "운전면허 갱신", "도로주행 시험 절차", "1종보통 비용"
  - steps_data_json        # 절차 데이터 (순서, 소요시간, 비용, 준비물)
  - common_mistakes_json   # 흔히 하는 실수 데이터
  - regulation_date        # "2026년 1월 1일 개정 기준" 등
  - intro_style
  - emoji_set

meta_template:
  title:
    - "{topic} 완벽 가이드 ({regulation_date} 기준)"
    - "{topic} 절차·비용·준비물 총정리"
    - "{topic} 처음 하시는 분 필독 가이드"

constraints:
  min_length: 1800
  max_length: 3000
  must_include:
    - "{topic}"
    - 절차_순서
    - 비용_정보
    - 준비물_목록
    - {regulation_date}

sections:
  - name: hook
    length: "150~200자"
    prompt: |
      "{topic}" 절차가 막막한 입문자에 공감하는 도입.
      - 절차 수 ("총 4단계") 또는 시간 ("평균 2시간 소요") 같은 숫자 미리 노출

  - name: prerequisites
    length: "200~300자"
    prompt: |
      시작 전 알아야 할 전제 조건·자격 요건을 정리.
      - 항목 3~5개 (불릿)
      - 각 항목은 한 줄, 추가 설명은 불릿 아래 2~3 문장 평문으로

  - name: step_by_step
    length: "각 단계 200~350자 × N (N개 단계)"
    prompt: |
      다음 데이터로 단계별 절차를 H2/H3 구조로:
      {steps_data_json}

      각 단계마다:
      - **1단계: 단계명** (H2)
      - 무엇을 하는지 (2~3문장)
      - 소요 시간·비용 ({regulation_date} 기준)
      - 주의사항 1개 (있다면)

      *모든 단계가 같은 톤이 되지 않도록. 어떤 단계는 "팁:"으로, 어떤 단계는 "주의:"로 다양화.

  - name: common_mistakes
    length: "300~400자"
    prompt: |
      자주 하는 실수 3개를 다음 데이터에서 추려서:
      {common_mistakes_json}

      - 각 실수: **굵게 한 줄** + 해결법 2~3 문장
      - 두 번째 인칭 ("당신") 대신 일반화 ("처음 하시는 분들이 자주...")

  - name: faq
    length: "Q&A 4쌍"
    prompt: |
      자주 묻는 질문 4개. 한 개는 반드시 "비용 관련", 한 개는 "기간 관련".
      답변은 구체적 수치 포함.

  - name: cta
    length: "100~150자"
    prompt: |
      이어서 읽으면 좋을 글 1개로 자연스럽게 연결.
      [INTERNAL_LINK: 관련_가이드] 1개.

structural_requirements:
  - 절차 단계 H2는 "{N}단계:" 패턴으로 시작
  - 첫 100자 안에 {topic} 1회 + 숫자 정보 1개
```

---

## 8. 템플릿 4: 비교형 (1종 vs 2종 같은 옵션 비교)

**파일**: `templates/T04_comparison.yaml`

```yaml
id: T04_comparison
version: "1.0"
intent: "두 옵션을 비교하고 추천 시나리오를 제시"
audience: "두 옵션 중 고민하는 사람"
system_prompt_ref: persona_seo_blogger

variables:
  - option_a               # "1종보통"
  - option_b               # "2종보통"
  - option_a_data_json     # A의 가격/조건/장단점
  - option_b_data_json     # B의 가격/조건/장단점
  - decision_criteria      # ["가격", "활용도", "취득난이도", "유지비"]
  - intro_style

meta_template:
  title:
    - "{option_a} vs {option_b} 차이점 & 추천 가이드"
    - "{option_a}과 {option_b} 어떤 게 나에게 맞을까? 비교 분석"

constraints:
  min_length: 1500
  max_length: 2500

sections:
  - name: hook
    length: "150~200자"
    prompt: |
      "{option_a} vs {option_b}" 사이에서 고민하는 사람의 시점으로 도입.
      - "둘 다 X처럼 보이는데 무엇이 다를까?" 같은 자연스러운 의문 제기

  - name: at_a_glance
    length: "표 + 도입 50자"
    prompt: |
      비교 항목: {decision_criteria}
      각 항목에 대해 A/B를 한 줄씩 비교한 표.
      - 표 위 도입 1문장 ("핵심 차이를 한눈에 정리하면...")

  - name: option_a_detail
    length: "350~450자"
    prompt: |
      {option_a}을 다음 데이터로 깊이 설명:
      {option_a_data_json}
      - 강점 2개 + 약점 1개를 솔직하게

  - name: option_b_detail
    length: "350~450자"
    prompt: |
      {option_b}을 다음 데이터로 깊이 설명:
      {option_b_data_json}
      - 강점 2개 + 약점 1개

  - name: who_should_pick_what
    length: "300~400자"
    prompt: |
      "{option_a}을 추천하는 경우 3가지" / "{option_b}을 추천하는 경우 3가지"
      - 시나리오 기반 ("출퇴근 거리가 30km 이상이라면..." 같이 구체적)

  - name: cost_difference
    length: "200~300자"
    prompt: |
      가격·시간 차이를 숫자로 명확히. 3년간 누적 비용 같은 구체적 환산.

  - name: cta
    length: "100~150자"
    prompt: |
      각 옵션에 해당하는 상세 페이지로 자연스럽게 분기.

forbidden_patterns:
  - "둘 다 좋습니다"     # 결론 회피 금지
  - "본인의 상황에 따라"  # 너무 흔한 도피
required_takeaway: "글 끝에 명확한 추천 시나리오 3개 이상"
```

---

## 9. 템플릿 5: 비용/가격 절약 전략

**파일**: `templates/T05_cost_strategy.yaml`

```yaml
id: T05_cost_strategy
version: "1.0"
intent: "특정 서비스/상품의 비용을 절약하는 실용 전략 제공"
audience: "예산 민감한 학습자/소비자"
system_prompt_ref: persona_seo_blogger

variables:
  - service_name           # "운전면허 취득"
  - region                 # "전국" 또는 특정 지역
  - average_cost_data      # 평균 비용 통계 (출처 포함)
  - strategies_json        # 절약 전략 5~8개 데이터
  - target_persona         # "대학생", "사회초년생", "재취업자"
  - season_modifier        # 계절·시기 변수 (방학, 연말 할인 등)
  - intro_style

meta_template:
  title:
    - "{service_name} 비용 절약 전략 BEST 7 ({target_persona} 필독)"
    - "{service_name} 싸게 따는 법 — {region} {target_persona} 완전 가이드"

constraints:
  min_length: 1800
  max_length: 2700
  must_include:
    - 평균_비용_수치
    - 절약_금액_수치
    - 출처_표기

sections:
  - name: hook
    length: "200~250자"
    prompt: |
      "{service_name} 비용 부담"에 대한 공감.
      - {target_persona}의 예산 상황을 한 줄로 묘사
      - 평균 비용 수치를 도입에 노출 ("평균 ○○만원...")

  - name: average_cost_breakdown
    length: "350~450자"
    prompt: |
      다음 데이터로 평균 비용을 항목별로 분해:
      {average_cost_data}

      - 항목 4~6개 표
      - 표 아래 "이 중 가장 줄일 수 있는 항목은..." 한 줄 코멘트

  - name: strategies
    length: "각 전략 150~250자 × 5~7개"
    prompt: |
      다음 데이터의 전략들을 본문화:
      {strategies_json}

      각 전략:
      - **전략 N: 제목** (H3)
      - 어떻게 (2~3 문장)
      - 절약 가능액 (구체 숫자, 예: "약 12만원")
      - 적용 조건 (1 문장)

      *전략 7개라면 각 전략 도입 문장을 다르게 ("우선," "다음으로," "또한," 같은 접속어 다양화)

  - name: season_tip
    length: "200~250자"
    prompt: |
      {season_modifier}에 특화된 추가 절약 팁 1~2개.
      - 시기성을 활용한 콘텐츠 신선도 ↑

  - name: pitfalls
    length: "250~300자"
    prompt: |
      가격만 보고 선택할 때 흔히 빠지는 함정 2~3개.
      - "싼 게 비지떡인 경우" 시나리오를 솔직하게

  - name: cta
    length: "100~150자"
    prompt: |
      지역별 가격 비교 페이지 또는 상담으로 연결.

post_validation:
  - check: number_count
    min: 8
  - check: strategy_count
    min: 5
```

---

## 10. 템플릿 6: 시험·필기 BEST5

**파일**: `templates/T06_exam_best5.yaml`

```yaml
id: T06_exam_best5
version: "1.0"
intent: "특정 시험의 핵심 포인트 BEST 5 제공"
audience: "시험 준비 중인 학습자"
system_prompt_ref: persona_beginner_friendly

variables:
  - exam_name              # "운전면허 필기시험"
  - top_5_topics_json      # BEST 5 데이터 (각 주제, 출제빈도, 함정 포인트)
  - stats_source           # 출제 통계 출처
  - intro_style

meta_template:
  title:
    - "{exam_name} 합격 핵심 BEST 5 — 가장 많이 출제되는 유형"
    - "{exam_name} BEST 5 정리 (합격률 ↑)"

constraints:
  min_length: 1600
  max_length: 2400

sections:
  - name: hook
    length: "150~200자"
    prompt: |
      {exam_name} 준비 중인 사람의 시점.
      - 합격률 통계 1개 노출 ("응시자 중 약 ○%가...")

  - name: why_these_5
    length: "200~300자"
    prompt: |
      왜 이 5가지가 핵심인지 설명.
      - "{stats_source}에 따르면 최근 3년간 출제 빈도 상위 5개"

  - name: top_5_breakdown
    length: "각 항목 250~350자 × 5"
    prompt: |
      다음 데이터로 5개 주제를 한 개씩 설명:
      {top_5_topics_json}

      각 주제:
      - **N위: 주제명** (H3)
      - 왜 자주 나오는지 (2 문장)
      - 핵심 정답 포인트 (2~3 문장)
      - 함정 ("이 부분에서 실수 자주 함") (1 문장)
      - 예시 문제 1개 (Q + 정답 + 짧은 해설)

  - name: study_tips
    length: "300~400자"
    prompt: |
      위 BEST 5를 효율적으로 공부하는 팁 3개.
      - 시간 분배 추천 ("BEST 5에 전체 학습 시간의 60% 투자" 같이 구체적)

  - name: cta
    length: "100~150자"
    prompt: |
      모의고사 페이지 또는 가이드로 연결.
```

---

## 11. 메타데이터(제목/디스크립션/키워드) 생성기

### 11.1 제목 변형 생성기 (`meta/title_generator.md`)

```
[Title Generation]

System:
당신은 한국어 SEO 제목을 생성하는 전문가입니다.
같은 정보를 표현하는 5가지 다른 제목 패턴을 생성하세요.

User:
주제: {topic}
주 키워드: {primary_keyword}
보조 키워드: {secondary_keywords}
타깃: {audience}
글 인텐트: {intent} (정보/비교/추천/가이드)

규칙:
1. 모든 제목은 28~45자 (한글 기준).
2. 주 키워드는 반드시 첫 15자 안에 등장.
3. 다음 패턴을 1개씩 사용:
   - [숫자형]    "{primary_keyword} BEST 5: ..."
   - [질문형]    "{primary_keyword}, ~할 때 ~할까?"
   - [가이드형]  "{primary_keyword} 완벽 가이드 ({year})"
   - [비교형]    "{primary_keyword} vs ~ 비교"
   - [후킹형]    "~한 이유, {primary_keyword}의 ~"
4. 클릭베이트 표현 ("충격", "역대급", "?!?!") 금지.
5. 5개가 모두 "느낌"이 다르게 작성.

출력: JSON 배열
```

### 11.2 디스크립션 생성기 (`meta/description_generator.md`)

```
[Meta Description]

System:
한국어 SEO 디스크립션을 생성합니다. 검색 결과에 잘리지 않게 정확한 길이로.

User:
글 요약: {summary}
주 키워드: {primary_keyword}
보조 키워드: {secondary_keywords}
CTA 단어: {cta_word}  # 예: "확인", "비교", "정리"

규칙:
1. 길이: 120~155자 (구글), 80~90자 (네이버) — 둘 다 만족하는 130~150자 권장.
2. 첫 80자 안에 주 키워드 반드시 포함.
3. 결말은 행동 유도 한 단어로 ("확인하세요", "비교해보세요").
4. 같은 단어 2회 이상 반복 금지.
5. 과장 형용사 ("최고의", "완벽한") 금지.

출력: 디스크립션 3개 (다양한 톤)
```

### 11.3 키워드 확장 (`meta/keyword_expander.md`)

```
[Keyword Expansion]

System:
주 키워드 1개를 받아서 SEO에 유효한 변형·LSI 키워드 8~12개를 생성합니다.

User:
주 키워드: {primary_keyword}
지역(있다면): {region}
인텐트: {intent}

생성 규칙:
1. 변형: 어순 변경, 동의어 ("학원" ↔ "교습소"), 형용사 변형
2. 지역 조합: 시·구·동 단위 1~2개
3. 인텐트 조합: 가격/추천/후기/비교/기간 등 인텐트 키워드 1~2개
4. 롱테일: 4단어 이상 조합 2~3개 ("○○ 운전면허학원 비용 비교 2026")
5. 네거티브: 검색 의도와 다른 키워드 제외 (예: 면허 글에 "자동차 정비"는 X)

출력: JSON 배열, 우선순위 순.
```

---

## 12. Anti-AI-Detection 규칙

`shared/anti_detection.md` — 모든 user prompt 끝에 추가:

```
[Anti-Detection 규칙]

LLM 흔적을 줄이기 위한 필수 사항:

1. **메타 멘트 금지**
   - "이 글에서는 ~를 다루고자 합니다"
   - "결론적으로 ~할 수 있습니다"
   - "지금부터 ~에 대해 알아보겠습니다"
   - "다음과 같이 정리할 수 있습니다"

2. **'균형' 강박 금지**
   - LLM은 항상 "장점도 있고 단점도 있다"는 균형 추구 성향이 있음.
   - 한 글에 한 번 정도는 명확한 입장 ("이 학원이 더 낫다")을 취할 것.
   - 단, 광고처럼 보이지 않는 선에서.

3. **문장 구조 다양화**
   - 모든 문장이 "~입니다." 로 끝나면 안 됨.
   - 한 단락 안에 문장 길이를 의도적으로 변주 (짧고 - 길고 - 중간).
   - 명사형 종결 ("...라는 점.") 가끔 1~2회 사용 가능.

4. **불완전한 인간성 주입**
   - 약간의 구어체 ("사실 좀 헷갈리는데...", "근데 의외로...")
   - 한 글에 1~2번은 개인 의견 흉내 ("개인적으로는 ~를 추천")

5. **불필요한 강조 어절 금지**
   - "정말로", "매우", "엄청", "굉장히" 같은 부사를 한 글에 5회 이상 쓰지 말 것.

6. **단락 길이 다양화**
   - 모든 단락이 4~5 문장이면 AI 티남.
   - 1 문장짜리 단락, 6 문장짜리 단락을 의도적으로 섞을 것.

7. **첫 문장 셔플**
   - LLM은 모든 글을 "○○에 대해" 또는 "○○하시는 분들"로 시작하는 경향.
   - 도입 첫 문장은 다음 5가지 중 매번 다른 패턴 사용:
     a) 통계 인용 시작
     b) 질문 시작
     c) 시간/장소 묘사 시작
     d) 인용·대사 시작
     e) 짧은 단문 + 줄바꿈 시작

8. **퀴즈/예시 활용**
   - 한 글에 1번은 "예를 들어..." 같은 구체 예시 삽입.
   - 추상적 설명만 이어지면 AI 점수 ↑.

9. **숫자에 단위 다양화**
   - "10만원" / "100,000원" / "10만 원" 같은 표기를 의도적으로 1~2회씩 변주.

10. **이모지 위치**
    - 본문 한가운데가 아닌, 소제목·강조 포인트에만.
    - 한 문장에 2개 이상 이모지 금지.
```

---

## 13. 검증·재생성 트리거

생성 후 자동 검증 (`validators/`):

### 13.1 구조 검증 (`structural.py`)
```python
def validate_structure(content: str, template: dict) -> list[str]:
    issues = []

    # 길이
    text_only = strip_markdown(content)
    if len(text_only) < template["constraints"]["min_length"]:
        issues.append(f"length_short: {len(text_only)}")
    if len(text_only) > template["constraints"]["max_length"]:
        issues.append(f"length_long: {len(text_only)}")

    # H2 개수
    h2_count = len(re.findall(r"^## ", content, re.M))
    if h2_count < 3 or h2_count > 7:
        issues.append(f"h2_count_off: {h2_count}")

    # 금지어
    for word in template["constraints"].get("must_not_include", []):
        if word in content:
            issues.append(f"forbidden_word: {word}")

    # 필수 포함
    for word in template["constraints"].get("must_include", []):
        if word not in content:
            issues.append(f"missing_required: {word}")

    return issues
```

### 13.2 유사도 검증 (`similarity.py`)
```python
async def validate_uniqueness(content: str, db, threshold=0.85) -> tuple[bool, float]:
    emb = await embed(content[:1500])
    nearest = await db.fetch(
        "SELECT 1 - (embedding <=> %s) AS sim FROM posts ORDER BY embedding <=> %s LIMIT 1",
        emb, emb,
    )
    if not nearest:
        return True, 0.0
    sim = nearest[0]["sim"]
    return sim < threshold, sim
```

### 13.3 AI 흔적 검증 (`detection.py`)
```python
AI_PHRASES = [
    "이 글에서는", "오늘은", "결론적으로", "다시 한번",
    "지금부터", "다음과 같이 정리", "여러분도 ~하실 수 있",
    "본격적으로", "함께 알아보", "도움이 되셨", "유용한 정보",
]
def detect_ai_traits(content: str) -> int:
    score = sum(content.count(p) for p in AI_PHRASES)
    # 추가: 동일 종결어미 5회 이상 연속, 같은 부사 5회 이상
    return score  # 임계치 3 초과 시 재생성
```

### 13.4 재생성 로직
```python
MAX_RETRIES = 3
for attempt in range(MAX_RETRIES):
    content = await generate(prompt, temperature=0.7 + 0.1*attempt)

    # 1) 구조 검증
    issues = validate_structure(content, template)
    if issues:
        prompt = add_fix_instructions(prompt, issues)
        continue

    # 2) 유사도 검증
    unique, sim = await validate_uniqueness(content, db)
    if not unique:
        prompt = add_diversity_instructions(prompt, sim)
        continue

    # 3) AI 흔적 검증
    if detect_ai_traits(content) > 3:
        prompt = add_human_tone_instructions(prompt)
        continue

    return content  # 모든 검증 통과

raise GenerationFailed(slot)
```

### 13.5 재생성 시 프롬프트 보강 패턴

```
# 구조 미달 시:
"위 출력은 {issue_description}. 다시 작성하되 {fix_directive}."

# 유사도 높을 시 (sim=0.87):
"위 출력은 기존 글과 유사도 0.87로 너무 비슷합니다. 다음을 바꿔서 재작성하세요:
- 도입 훅 스타일을 '{new_intro_style}'로
- 본문 예시를 다른 시나리오로
- 종결어미 분포를 변경"

# AI 흔적 검출 시:
"위 출력은 AI 흔적이 강합니다. 특히 다음 표현을 모두 제거하고 재작성:
{detected_phrases}
대신 더 구어체적이고 불완전한 인간미가 느껴지는 표현 사용."
```

---

## 14. 실 호출 코드 (Anthropic + OpenAI)

### 14.1 메인 생성 함수

```python
"""
generate_post.py
"""
import anthropic
import asyncio
import json
import random
import re
from pathlib import Path

import yaml
from openai import AsyncOpenAI

anthropic_client = anthropic.AsyncAnthropic()
openai_client = AsyncOpenAI()

PROMPT_DIR = Path(__file__).parent / "prompts"

DIVERSITY_KNOBS = { ... }  # 위 4장 참고

def load_yaml(rel_path: str) -> dict:
    return yaml.safe_load((PROMPT_DIR / rel_path).read_text())

def load_md(rel_path: str) -> str:
    return (PROMPT_DIR / rel_path).read_text()

def render_user_prompt(template: dict, variables: dict) -> str:
    """템플릿 + 변수 + 공통 규칙을 합쳐 최종 user prompt 생성."""
    sections_prompt = ""
    for s in template["sections"]:
        rendered = s["prompt"].format(**variables)
        sections_prompt += f"\n## 섹션: {s['name']} (목표 길이: {s['length']})\n{rendered}\n"

    common_rules = load_md("shared/common_rules.md")
    anti_detection = load_md("shared/anti_detection.md")

    return f"""
다음 정보로 한국어 SEO 블로그 글을 작성하세요.

[글 메타]
- 인텐트: {template['intent']}
- 타깃: {template['audience'].format(**variables)}
- 길이: 최소 {template['constraints']['min_length']}자, 최대 {template['constraints']['max_length']}자
- 시점 표기: {variables.get('date_reference', '2026년 기준')}

[섹션 구성]
{sections_prompt}

{common_rules}

{anti_detection}

이제 마크다운으로 글 전체를 작성해주세요.
""".strip()

async def generate_post(template_id: str, variables: dict) -> dict:
    template = load_yaml(f"templates/{template_id}.yaml")
    system_prompt = load_md(f"system/{template['system_prompt_ref']}.md")

    # 다양성 변수 주입
    knobs = {k: f() for k, f in DIVERSITY_KNOBS.items() if k != "shuffleable_sections"}
    variables = {**variables, **knobs}

    user_prompt = render_user_prompt(template, variables)

    response = await anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4500,
        temperature=knobs["temperature"],
        top_p=knobs["top_p"],
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )

    return {
        "content_md": response.content[0].text,
        "template_id": template_id,
        "variables": variables,
        "knobs": knobs,
        "usage": response.usage.model_dump(),
    }

async def generate_meta(template: dict, variables: dict, content: str) -> dict:
    """제목 5개 + 디스크립션 3개 + 키워드 10개 동시 생성."""
    summary = content[:800]  # 본문 앞부분만 메타 생성에 사용

    title_prompt = load_md("meta/title_generator.md").format(
        topic=variables.get("topic", ""),
        primary_keyword=variables.get("primary_keyword", ""),
        secondary_keywords=", ".join(variables.get("secondary_keywords", [])),
        audience=template["audience"].format(**variables),
        intent=template["intent"],
        year=variables.get("year", "2026"),
    )

    # 메타는 빠른 모델 (haiku/mini)
    title_resp, desc_resp, kw_resp = await asyncio.gather(
        anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=600,
            messages=[{"role": "user", "content": title_prompt}],
        ),
        anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            messages=[{"role": "user", "content": load_md("meta/description_generator.md").format(
                summary=summary,
                primary_keyword=variables["primary_keyword"],
                secondary_keywords=", ".join(variables.get("secondary_keywords", [])),
                cta_word=variables.get("cta_word", "비교"),
            )}],
        ),
        anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{"role": "user", "content": load_md("meta/keyword_expander.md").format(
                primary_keyword=variables["primary_keyword"],
                region=variables.get("region", ""),
                intent=template["intent"],
            )}],
        ),
    )

    return {
        "title_candidates": parse_json(title_resp.content[0].text),
        "description_candidates": parse_json(desc_resp.content[0].text),
        "keywords": parse_json(kw_resp.content[0].text),
    }

async def main_pipeline(slot: dict):
    """1개 슬롯 → 본문 + 메타 + 검증 + 저장."""
    # 1) 본문 생성 (검증 루프)
    for attempt in range(3):
        post = await generate_post(slot["template_id"], slot["variables"])
        issues = validate_structure(post["content_md"], load_yaml(f"templates/{slot['template_id']}.yaml"))
        if not issues:
            break
        slot["variables"]["_retry_reason"] = issues
    else:
        log.error(f"slot={slot['id']} failed structural validation")
        return

    # 2) 유사도 검증
    unique, sim = await validate_uniqueness(post["content_md"], db)
    if not unique:
        log.warn(f"slot={slot['id']} too similar (sim={sim:.3f}) — queueing for human review")
        return

    # 3) 메타 생성
    meta = await generate_meta(
        load_yaml(f"templates/{slot['template_id']}.yaml"),
        slot["variables"],
        post["content_md"],
    )

    # 4) DB 저장 + 임베딩
    emb = await embed(post["content_md"][:1500])
    await db.save_post(
        slot_id=slot["id"],
        content_md=post["content_md"],
        title=meta["title_candidates"][0],
        description=meta["description_candidates"][0],
        keywords=meta["keywords"],
        embedding=emb,
    )
```

### 14.2 배치 실행 (병렬 처리)

```python
async def batch_generate(slots: list[dict], concurrency: int = 10):
    sem = asyncio.Semaphore(concurrency)

    async def worker(slot):
        async with sem:
            try:
                await main_pipeline(slot)
            except Exception as e:
                log.exception(f"slot={slot['id']} failed: {e}")

    await asyncio.gather(*[worker(s) for s in slots])

# 사용 예:
slots = load_slots_from_matrix("matrix/region_x_persona.csv")
await batch_generate(slots, concurrency=10)
```

---

## 부록 A: 데이터 주입 JSON 스키마

각 템플릿이 받는 데이터의 표준 형식.

```json
// academy_data_json (T01, T02)
{
  "academies": [
    {
      "name": "뉴삼성자동차운전전문학원",
      "location": "수원시 영통구 영통로 ...",
      "address_short": "수원 영통",
      "lat": 37.265, "lng": 127.069,
      "prices": {
        "type1_manual": 850000,
        "type2_auto": 720000
      },
      "duration_days": { "min": 3, "typical": 7 },
      "shuttle": {
        "available": true,
        "routes": ["안산", "수원", "오산", "화성"],
        "free": true
      },
      "pass_rate": 0.87,
      "facilities": ["주차장", "구내식당", "휴게실"],
      "phone": "031-...",
      "homepage": "https://...",
      "selling_points": ["3일 최단기", "셔틀 폭넓음", "신차 보유"],
      "weaknesses": ["주말 예약 어려움"]
    }
  ],
  "source": "자체 DB 2026-05",
  "as_of": "2026-05-22"
}
```

```json
// reviews_excerpt_json (T02)
{
  "reviews": [
    {
      "author_initial": "김○○",
      "rating": 5,
      "text": "강사님이 정말 친절하셔서 긴장 안 하고 할 수 있었어요.",
      "date": "2026-03-15"
    }
  ]
}
```

```json
// steps_data_json (T03)
{
  "steps": [
    {
      "order": 1,
      "name": "응시원서 접수",
      "duration_min": 30,
      "cost_won": 18000,
      "requirements": ["신분증", "사진 2매"],
      "tips": ["인터넷 사전 접수 가능"]
    }
  ]
}
```

---

## 부록 B: 디버깅 체크리스트

생성 결과가 이상할 때 체크 순서:
1. **너무 짧다** → max_tokens 늘리기, 섹션별 prompt에 "최소 X자 이상" 강조
2. **반복 패턴 발생** → temperature 0.9 이상, frequency_penalty 추가 (OpenAI)
3. **메타 정보 누락** → 메타 생성 모델을 sonnet으로 격상
4. **유사도 검증 자주 실패** → 슬롯 매트릭스 자체에 중복 슬롯 있는지 확인
5. **AI 흔적 검출 빈번** → anti_detection 규칙을 system_prompt에 직접 삽입
6. **숫자 환각** → 모든 숫자는 데이터 JSON에서만 가져오게 system_prompt에 강조

---

## 한 줄 요약

> **System prompt(페르소나) + Template(섹션) + 다양성 변수(랜덤 다이얼) + 공통 규칙(SEO·Anti-Detection) + 검증 루프(구조·유사도·AI 흔적)**.
> 이 5요소를 모듈화해두면 한 번 셋업으로 수만 건 발행이 가능합니다.
