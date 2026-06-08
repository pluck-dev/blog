# drivingteacher.co.kr 분석 + 양산형 SEO 전략 — 산출물 인덱스

> 운전선생 블로그 21,275건 스크래핑 → 분류 → 중복 검수 → 동일 전략 재현용 플레이북·프롬프트 라이브러리까지 전체 산출물 정리.

작성일: 2026-05-22

---

## 📂 산출물 디렉토리

```
/Users/simjaehyeong/Desktop/adrock/
├─ 데이터/
│  ├─ drivingteacher_blog_posts.xlsx              # 원본 (markdown_full 포함, 67MB)
│  ├─ drivingteacher_blog_posts_lite.xlsx         # 경량본 (summary500, 12MB)
│  ├─ drivingteacher_blog_posts.csv               # 전체 CSV (226MB)
│  └─ drivingteacher_blog_posts_classified.xlsx   # ⭐ 분류 + 중복 분석 결과 (24MB)
│
├─ 문서/
│  ├─ INDEX.md                                    # 이 파일
│  ├─ PROGRAMMATIC_SEO_PLAYBOOK.md                # 전체 전략 13장
│  ├─ PROMPT_LIBRARY.md                           # 프롬프트 라이브러리 풀 디테일
│  ├─ IMAGE_AND_TABLE_STRATEGY.md                 # 이미지·표 운용 전략 13장
│  └─ COST_ANALYSIS.md                            # 비용 분석 11장 (시나리오별 견적)
│
├─ PoC 실증/
│  └─ poc_output/                                 # ⭐ T01 1건 End-to-End 실증 (21/21 검증 통과)
│     ├─ POC_REPORT.md                            # PoC 결과 리포트
│     ├─ 01_input_slot.json                       # 시드 매트릭스 슬롯
│     ├─ 02_input_data.json                       # 학원 5곳 + 다양성 변수
│     ├─ 03_rendered_prompt.md                    # 최종 LLM 프롬프트
│     ├─ 04_generated_post.md                     # v1 (18/21 통과)
│     ├─ 04_generated_post_v2.md                  # v2 (21/21 통과, 재생성 후)
│     ├─ 05_generated_meta.json                   # 제목·디스크립션·키워드·Schema.org
│     ├─ 06_validation_results.json               # v1+v2 검증 비교
│     ├─ 07_published_post.md                     # ⭐ 슬롯 치환 완료 발행본
│     ├─ 08_published_html_head.html              # Next.js Head 시뮬레이션
│     ├─ validate.py / validate_v2.py             # 21개 항목 자동 검증
│     └─ post_process.py                          # 표·이미지·링크 치환
│
├─ 시드 매트릭스/
│  └─ seed_matrix/                                # ⭐ 슬롯 자동 도출 시스템
│     ├─ README.md                                # 운영 가이드 11장
│     ├─ 01_axes.csv                              # 축 값 정의 (60줄, 5축)
│     ├─ 02_template_axis_mapping.csv             # 템플릿별 축 매핑 (T01~T07)
│     ├─ 03_seed_matrix_template.csv              # 빈 슬롯 스키마
│     ├─ 04_seed_matrix_example.csv               # 균형 잡힌 50건 예시
│     ├─ 04_seed_matrix_full.csv                  # 전체 cartesian product (164,345건)
│     ├─ generate_slots.py                        # 자동 생성기 (CLI)
│     └─ make_balanced_example.py                 # 균형 예시 추출
│
└─ 스크립트/
   ├─ rebuild_full.py                             # 분류 + 클러스터링 통합 빌더
   ├─ dedup_cluster_v2.py                         # MinHash/LSH 디덕션 단독
   ├─ dedup_cluster.py                            # v1 (summary500 기반, deprecated)
   └─ .venv_dedup/                                # Python 가상환경 (datasketch, sklearn)
```

---

## 📊 핵심 분석 결과 (한 페이지 요약)

### 데이터 규모
| 항목 | 값 |
|---|---|
| 총 블로그 글 | **21,275건** |
| 사람 작성 추정 (`templateLabel` 없음) | **765건** |
| AI 양산 (50개 템플릿) | **20,510건** |
| 발행 시기 | 2023~2026 |
| 피크 발행 (2026-01) | 4,043건 (일 평균 130건) |

### 양산 품질 (놀라움)
| 검수 항목 | 중복률 |
|---|---|
| 제목 | 0.24% |
| 메타 디스크립션 | 0.01% |
| 본문 첫 200자 | 0.01% |
| 본문 전체 MinHash (k=9, Jaccard ≥ 0.75) | **0.005%** (21,259건 중 1쌍만) |
| 같은 템플릿 내부 본문 유니크율 | **100%** |
| 키워드 메타 | 15.8% (의도된 겹침) |

→ 운전선생은 **엔터프라이즈급 임베딩 기반 디덕션 파이프라인**이 작동 중. 우리 목표 수치로 사용 가능.

### 발견된 유일한 중복
- 제목: "운전면허 싸고 빠르게 따는 법: 사회초년생 대학생 위한 비용 절약 & 시간 단축 꿀팁"
- 발생: 2025-08-17 / 1분 차이로 2번 발행 → API 재시도 버그 추정

---

## 🗺️ 사이트 운영 메커니즘 (역설계)

### 노출 전략
1. **robots.txt**: 전부 허용 (`Allow: /`)
2. **사이트맵에는 블로그 미포함** — `/explore`, `/academy`만. 21K 블로그를 일부러 사이트맵에서 뺀 것으로 보임 (양산 신호 차단).
3. **Indexing API 직접 호출**로 즉시 색인 요청 (추정)
4. **모든 페이지에 완벽한 메타**: googlebot, NaverBot, Yeti, canonical, og:*, twitter:*, GSC/네이버 verification
5. **Next.js + Vercel SSR**: 봇이 받는 HTML 101KB로 본문·메타 완성형
6. **네이버 블로그 동시 발행**: `naverBlogUrl` 컬럼이 14K건에 채워져 있음 — 백링크 확보용

### 콘텐츠 양산 메커니즘
1. **50개 템플릿** (지역 BEST5, 학원 전용, 가이드, 비교, 비용 전략, 시험 BEST5)
2. **시드 매트릭스**: 지역(시·군·구) × 키워드 × 인텐트 × 페르소나 조합
3. **LLM 생성 + 임베딩 유사도 차단** (실시간)
4. **MinHash/LSH 사후 디덕션** (배치)
5. **약한 글 가지치기** (90일 노출 0 → noindex → 410)

---

## 📑 문서 가이드

### 1. `PROGRAMMATIC_SEO_PLAYBOOK.md` (전체 전략, 13장)
- 1장. 시드 매트릭스 설계 (200 × 50 × 5 × 4 = 200,000 슬롯)
- 2장. 데이터 소스 (공공 + 자체 + UGC)
- 3장. 템플릿 + 프롬프트 라이브러리 개요
- 4장. LLM 배치 + 실시간 중복 차단
- 5장. 사후 디덕션 (MinHash/LSH)
- 6장. 메타·Schema.org·내부 링크
- 7장. Next.js SSG/ISR
- 8장. 색인 가속 (Indexing API)
- 9장. 모니터링 & 가지치기
- 10장. 법적·윤리적 리스크
- 11장. 4주 실행 로드맵
- 12장. 운전선생 약점 6가지
- 13장. 한 줄 요약

### 3. `IMAGE_AND_TABLE_STRATEGY.md` (이미지·표 운용, 13장)
- 1장. 실측 결과 (운전선생 이미지 98.3% 고유성)
- 2장. 4가지 이미지 전략 비교 매트릭스
- 3장. **전략 ①: 실체 객체 매핑** (DB 설계 + 자동 픽업 알고리즘)
- 4장. **전략 ②: AI 이미지 생성** (Flux/DALL-E/Imagen 비용 비교, 텍스트 오버레이)
- 5장. **전략 ③: 스톡 이미지** (Unsplash+/Adobe Stock 비교, 차별화 후처리)
- 6장. **전략 ④: 카테고리 풀** (수동 큐레이션)
- 7장. 이미지 슬롯 결정 트리
- 8장. **표 처리 전략** (JSON→마크다운 표 후처리, CSS, 이미지 변환 여부)
- 9장. 이미지 SEO 체크리스트 (파일명·alt·sitemap-images.xml)
- 10장. 비용 + 운영 부담 종합
- 11장. 운전선생보다 더 잘할 수 있는 5가지
- 12장. 구현 우선순위 (4주)
- 13장. 한 줄 요약

### 4. `COST_ANALYSIS.md` (비용 분석, 11장)
- 1장. 콘텐츠 양산 직접비 (PoC 실측 1건 ≈ ₩70원)
- 2장. 월간 인프라 운영비
- 3장. SEO 도구 비용
- 4장. 객체 사진 1회성 비용 (전략별 ₩0 ~ ₩3억)
- 5장. 인력 비용
- 6장. **시나리오별 총비용** (1인 부트스트랩 ₩130만 / 소규모 팀 ₩1,500만 / 본격 스케일 연 ₩1.5억)
- 7장. ROI 추정 (운전면허 도메인 기준 연 매출 ₩4억, ROI 2.7배)
- 8장. 비용 최소화 팁 (프롬프트 캐싱·Batch API 등)
- 9장. 비용 vs 시간 트레이드오프
- 10장. 의사결정 체크리스트
- 11장. 비용 계산 워크시트

### 2. `PROMPT_LIBRARY.md` (프롬프트 풀 디테일, 14장)
- 1장. 라이브러리 아키텍처 (디렉토리 구조)
- 2장. System Prompt 페르소나 3종
- 3장. 공통 규칙 블록 (모든 템플릿 공유)
- 4장. 무작위성·다양성 변수 (Python 코드)
- 5장. **템플릿 1: 지역 BEST 5 비교** (YAML 완전 명세)
- 6장. **템플릿 2: 학원 단일 집중 소개**
- 7장. **템플릿 3: 가이드형 (총정리/절차)**
- 8장. **템플릿 4: 비교형 (1종 vs 2종)**
- 9장. **템플릿 5: 비용 절약 전략**
- 10장. **템플릿 6: 시험·필기 BEST5**
- 11장. 메타데이터 생성기 (제목·디스크립션·키워드)
- 12장. Anti-AI-Detection 규칙 10가지
- 13장. 검증·재생성 트리거 (Python)
- 14장. 실 호출 코드 (Anthropic + OpenAI)
- 부록 A. 데이터 주입 JSON 스키마
- 부록 B. 디버깅 체크리스트

---

## 📋 `drivingteacher_blog_posts_classified.xlsx` 시트 구성

| 시트 | 행 수 | 용도 |
|---|---|---|
| **Human** | 765 | `templateLabel` 비어있는 사람 작성 추정 글 |
| **AI_generated** | 20,510 | 50개 템플릿으로 양산된 글 |
| **All** | 21,275 | 원본 전체 + `classification` 컬럼 추가 |
| **Duplicate_Clusters** | 2 | 본문 유사도 ≥ 0.75 클러스터 (Union-Find) |
| **Duplicate_Pairs** | 1 | 유사 쌍 + Jaccard 점수 + 양 글 메타 |

각 시트 컬럼 (Human/AI/All):
`id | title | url | image | createdAt | publishedAt | updatedAt | naverBlogUrl | hashTags | metaTitle | metaDescription | metaKeywords | ogTitle | ogDescription | ogImage | ctaText | ctaHref | templateLabel | summary500 | classification`

---

## 🎯 실행 가이드 — "지금 무엇부터 할까?"

### Phase 0: 가설 검증 (1주)
- [ ] 우리 도메인 + 타깃 키워드 50개 정도 GSC/네이버 서치 어드바이저 등록
- [ ] 시드 매트릭스 v0.1 작성 (지역 30개 × 키워드 10개 = 300 슬롯)
- [ ] 데이터 소스 정의 (공공데이터, 자체 DB, 외부 검증된 자료)
- [ ] LLM API 가입 (Anthropic + OpenAI), 비용 한도 설정

### Phase 1: MVP 100건 (2주)
- [ ] `PROMPT_LIBRARY.md`의 템플릿 1개 (T01 또는 T03) 골라서 100건 생성
- [ ] 100건 사람 검수 → 평균 품질·반복 패턴·환각 여부 점검
- [ ] Postgres + pgvector 설치, 임베딩 검색 동작
- [ ] Next.js + Vercel 페이지 100건 호스팅, 색인 신청

### Phase 2: 자동화 + 스케일 (4주)
- [ ] 실시간 중복 차단 파이프라인 가동
- [ ] Indexing API 연동, 일 100건 발행 자동화
- [ ] MinHash 사후 디덕션 cron (주 1회)
- [ ] GSC 데이터 수집 + 약한 글 식별 자동화

### Phase 3: 최적화 (2~3개월)
- [ ] 발행 1,000건 → 3,000건 → 10,000건 단계적 확장
- [ ] 약한 키워드 폐기, 강한 키워드 클러스터 확장
- [ ] 허브 페이지 5~10개 직접 작성 (양산 글 위 PageRank 분배)

---

## 💰 비용 추산 (1만 건 양산 기준)

| 항목 | 비용 |
|---|---|
| Claude Sonnet 본문 생성 (평균 2000 토큰 출력) | $200~300 |
| Claude Haiku 메타 생성 (제목·디스크립션·키워드) | $20~50 |
| OpenAI 임베딩 (text-embedding-3-small) | $5 이하 |
| Vercel ISR 호스팅 (1만 페이지) | $20~50/월 |
| Postgres + pgvector (Supabase 무료 티어 가능) | $0~25/월 |
| **총 1만 건 발행 ≈ $250~400** | |

---

## ⚠️ 주의사항

1. **사실 기반 데이터 없이 양산 = 페널티 직행** (구글 Helpful Content Update)
2. **네이버 블로그 무단 리라이트는 저작권 위험** — 운전선생도 출처 표기로 일부 우회
3. **YMYL (의료·금융·법률)은 양산 금지** — 운전·생활 정보 같은 영역에서만 안전
4. **사이트맵에 양산 글 다 넣지 말 것** — Indexing API로 개별 처리가 더 안전
5. **가지치기 자동화 없이 양산만 하면 도메인 전체 페널티** — 정원사 사고방식 필수

---

## 📞 다음 액션 제안

원하는 영역 말씀해 주시면 더 깊이 들어갑니다:
- [ ] 시드 매트릭스 CSV 템플릿 작성 (도메인 키워드 50개 추출 후 200~500 슬롯 매트릭스 생성)
- [ ] 첫 템플릿 실제 호출 코드 + 1건 샘플 생성 PoC
- [ ] Postgres + pgvector 셋업 가이드 (Supabase / Neon)
- [ ] Indexing API 연동 코드 (서비스 계정 발급 → URL 제출)
- [ ] GSC API 자동 모니터링 스크립트 (약한 글 식별)
- [ ] Next.js [id] 동적 라우트 + ISR 보일러플레이트
