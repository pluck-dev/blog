# 시드 매트릭스 (Seed Matrix) — 운영 가이드

> 양산형 SEO 콘텐츠의 **슬롯 자동 도출 시스템**.
> 축(axes)을 정의하면 카르테시안 곱으로 슬롯이 자동 생성되고, 검색량·경쟁도·템플릿 가중치로 자동 우선순위 매김.

---

## 1. 폴더 구성

```
seed_matrix/
├─ README.md                          # 이 파일
├─ 01_axes.csv                        # ⭐ 축 값 정의 (편집 시작점)
├─ 02_template_axis_mapping.csv       # 템플릿별로 어떤 축을 쓰는지
├─ 03_seed_matrix_template.csv        # 빈 슬롯 스키마 (헤더만)
├─ 04_seed_matrix_example.csv         # 균형 잡힌 50건 예시
├─ 04_seed_matrix_full.csv            # 전체 cartesian product (164,345건)
├─ generate_slots.py                  # 자동 생성기
└─ make_balanced_example.py           # 균형 예시 추출 (템플릿별 분포)
```

---

## 2. 실측: 운전면허 도메인 매트릭스 규모

축 5개로 운전선생 패턴을 따라 만든 결과:

| 축 | 값 개수 | 비고 |
|---|---|---|
| **region** (지역) | 20개 | 수원, 안산, 인천, 강남, 부산, 대구... |
| **keyword** (키워드) | 15개 | 운전면허학원, 1종보통, 필기시험... |
| **intent** (인텐트) | 7개 | 비교/가이드/비용/후기/단일/시험팁/상품비교 |
| **persona** (페르소나) | 8개 | 직장인/대학생/사회초년생/주부/노년층... |
| **modifier** (수정자) | 12개 | 2026/최단기/비용절약/친절강사/셔틀편리... |

**도출 슬롯**: **164,345건**

| 템플릿 | 슬롯 수 | 비고 |
|---|---|---|
| T01 지역 BEST5 | 126,720 | region × persona × modifier(2) |
| T03 가이드 | 17,280 | keyword × persona × modifier |
| T05 비용 절약 | 17,280 | keyword × persona × modifier |
| T02 단일 학원 | 2,880 | entity placeholder × region × modifier |
| T06 시험 BEST5 | 105 | keyword × intent |
| T07 허브 | 56 | region × intent |
| T04 옵션 비교 | 24 | keyword_pair × persona |

운전선생이 발행한 21K건은 이 매트릭스의 **약 13%**에 해당 — 즉, 같은 도메인에서 우리가 만들 수 있는 콘텐츠 잠재력은 아직도 7~8배 남아있다는 의미.

---

## 3. 5분 사용법

### Step 1: 축 편집 (`01_axes.csv`)
도메인에 맞게 axis 값을 추가/수정.
```csv
axis,value,value_en,weight,monthly_search_volume,competition_kd,aliases,notes
region,수원,suwon,5,2400,42,수원시|수원시청|수원역,경기 남부 핵심
```
- `weight`: 1~5 (높을수록 우선)
- `monthly_search_volume`: 키워드 플래너에서 수집한 월간 검색량
- `competition_kd`: Ahrefs/SEMrush의 키워드 난이도 0~100
- `aliases`: 동의어 (파이프 구분), LSI 키워드 보강용

### Step 2: 템플릿 매핑 편집 (`02_template_axis_mapping.csv`)
새 템플릿을 추가하거나 축 조합을 조정.
```csv
template_id,template_name,primary_axes,secondary_axes,modifier_count,priority_weight,min_search_volume
T01,지역_BEST5,region|persona,modifier,2,1.0,500
```
- `primary_axes`: 메인 축, `|`로 구분
- `modifier_count`: modifier 풀에서 몇 개를 조합할지 (0~2)
- `priority_weight`: 우선순위 가중치 (허브는 1.2, 일반 양산은 1.0)
- `min_search_volume`: 이 검색량 미만은 슬롯에서 제외

### Step 3: 슬롯 생성
```bash
cd seed_matrix

# 전체 매트릭스
python3 generate_slots.py

# 상위 우선순위 100건만
python3 generate_slots.py --limit 100

# 특정 템플릿만
python3 generate_slots.py --template T01,T03

# 검색량 1000 이상만
python3 generate_slots.py --min-volume 1000

# 우선순위 점수 70 이상만
python3 generate_slots.py --min-priority 70
```

### Step 4: 결과 확인
- `04_seed_matrix_generated.csv` (기본 출력) 또는 지정 파일
- 우선순위 내림차순 정렬
- `target_publish_date`는 일 30건 기준 자동 분배 (오늘+7일 시작)

---

## 4. 우선순위 점수 공식

```python
sv_score = log10(monthly_search_volume + 1) / 4.5    # 검색량 정규화 (0~1)
kd_score = (100 - competition_kd) / 100              # 경쟁도 역수 (0~1)
priority = (sv_score * 0.6 + kd_score * 0.4) * template_weight * 100
```

- 검색량 비중 60%, 경쟁도 비중 40%
- 템플릿 가중치 곱
- 100점 만점

**점수 해석**:
- 80+ : 즉시 작성. 골든 슬롯.
- 60~80 : 1차 발행 풀에 포함.
- 40~60 : 2차 풀로 미루기. 1차 결과 보고 결정.
- 40 미만 : 발행 보류. 검색량 재검증.

---

## 5. 슬롯 CSV 컬럼 정의

| 컬럼 | 자동/수동 | 의미 |
|---|---|---|
| `slot_id` | 자동 | 템플릿ID + SHA1 8자 (고유 ID) |
| `template_id` | 자동 | T01~T07 |
| `primary_keyword` | 자동 | 메인 SEO 키워드 (제목·메타·alt에 사용) |
| `secondary_keywords` | **수동** | LSI 키워드 (콤마 구분) |
| `region` | 자동 | 지역 축 값 |
| `intent` | 자동 | 인텐트 축 값 |
| `persona` | 자동 | 페르소나 축 값 |
| `modifier_1`, `modifier_2` | 자동 | 수정자 축 |
| `entity_id` | **수동** | 실체 객체 ID (T02용, 학원 ID) |
| `estimated_search_volume` | 자동 | axes에서 평균 산출 |
| `competition_kd` | 자동 | axes에서 평균 산출 |
| `priority_score` | 자동 | 위 공식 |
| `status` | 자동→수동 | planned → in_progress → published → pruned |
| `target_publish_date` | 자동→수동 | 일 30건 자동 분배, 조정 가능 |
| `assigned_to` | **수동** | 담당 워커/사람 |
| `internal_link_targets` | **수동** | 이 글에 내부 링크로 걸 슬롯 ID들 |
| `title_pattern_seed` | 자동 | LLM에 줄 제목 시드 |
| `seo_objective` | 자동 | 슬롯의 SEO 목적 메모 |
| `notes` | **수동** | 자유 메모 |

---

## 6. 새 도메인으로 포팅하는 법

운전면허 → 다른 업종 (예: 음식점·헬스·학원) 이동 시 편집할 부분:

1. **`01_axes.csv`** 모든 값을 새 도메인으로 교체
   - region: 같음 (지역 비즈니스인 경우)
   - keyword: 새 도메인 핵심 키워드
   - intent: 비교/가이드/비용 같은 메타 인텐트는 거의 동일
   - persona: 도메인 타깃에 맞게
   - modifier: 도메인 셀링 포인트

2. **`02_template_axis_mapping.csv`**의 템플릿은 거의 그대로 재사용 가능
   - 단, `min_search_volume`은 도메인 검색량 수준에 맞게 조정

3. **`generate_slots.py`의 `render_title_seed`, `primary_keyword_for_slot`** 함수만 도메인 어휘로 교체
   - "운전면허학원" → "헬스장", "운전면허" → "헬스 PT" 등

이렇게 하면 **하루 안에 새 도메인 매트릭스 셋업 가능**.

---

## 7. 운영 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 축 정의 (01_axes.csv)                                        │
│    └→ 키워드 플래너에서 검색량 데이터 수집해 채우기              │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. generate_slots.py 실행 → 슬롯 CSV 생성                      │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. CSV 검토                                                     │
│    ├ 우선순위 상위 100~500건만 1차 발행 대상                    │
│    ├ entity_id 컬럼 채우기 (학원 ID 매핑)                       │
│    └ internal_link_targets 묶기 (같은 region/keyword 클러스터)  │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. 발행 파이프라인에 슬롯 CSV 주입                              │
│    └→ PROMPT_LIBRARY.md의 템플릿이 슬롯을 받아 LLM 호출         │
└────────────────────────┬────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. status 업데이트 (planned → published)                        │
│    └→ GSC 모니터링 → 약한 슬롯은 status=pruned                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. 첫 100건 발행 시 권장 슬롯 믹스

160K 슬롯 다 풀로 돌리지 말고, **첫 100건은 신호 검증용**:

| 템플릿 | 권장 비중 | 이유 |
|---|---|---|
| T07 허브 | 5건 | 카테고리 페이지 — 양산 글 위 PageRank 흘려보냄 |
| T01 지역 BEST5 | 40건 | 메인 양산. 운전선생도 50%+ |
| T03 가이드 | 25건 | 검색 의도 명확, 색인률 ↑ |
| T05 비용 절약 | 15건 | 전환 의도 강한 사용자 흡수 |
| T06 시험 BEST5 | 10건 | 학습 인텐트, 백링크 잘 받음 |
| T04 옵션 비교 | 5건 | 결정 단계 사용자, CTR ↑ |

색인률·평균 노출 확인 후 강한 템플릿을 늘리고 약한 건 폐기하는 식으로 스케일.

---

## 9. 검색량 데이터 수집 팁

`01_axes.csv`의 `monthly_search_volume` 채우기 권장 출처:

| 도구 | 가격 | 한국 정확도 | 비고 |
|---|---|---|---|
| **네이버 검색광고 시스템** | 무료 | ★★★★★ | 네이버 중심이면 필수 |
| **Google Keyword Planner** | 무료 (광고 계정) | ★★★ | 구글 검색량만 |
| **Ahrefs** | $99~/월 | ★★★★ | 종합 + 경쟁도 |
| **SEMrush** | $130~/월 | ★★★★ | 종합 |
| **Keyword Tool Dominator** | $40 (1회) | ★★★ | 저비용 대안 |
| **Mangools KWFinder** | $30/월 | ★★★ | 저비용 |

**무료로 시작하는 방법**:
1. 네이버 검색광고 → 광고 계정 만들기 → 키워드 도구
2. 콘텐츠 키워드 → 월간 검색수 PC/모바일 따로 표시
3. CSV로 다운로드 → `01_axes.csv`에 붙여넣기

---

## 10. 자주 묻는 질문

**Q. 슬롯이 16만개나 나왔는데 다 만들어야 하나요?**
A. 아니요. 처음엔 priority 80 이상 300~500건만 가지고 시작. 발행 후 GSC 데이터로 강한 키워드 클러스터를 확인한 뒤 그 영역의 슬롯만 확장.

**Q. `01_axes.csv`에 검색량을 모르는 키워드는 어떻게 하나요?**
A. 빈칸으로 두면 `estimate_volume`이 0을 반환해 자동 필터됨. 일단 추가는 해두되, 데이터 수집 전엔 발행 후순위.

**Q. 같은 슬롯이 중복 생성되지 않나요?**
A. `slot_id`는 (template_id + 축 값들)의 SHA1 해시 → 동일 조합은 동일 ID. CSV 로딩 시 dedupe하면 됨.

**Q. T02(단일 학원)는 어떻게 entity_id를 채우나요?**
A. `entity_directory.csv`라는 별도 파일을 만들어 (academy_id, academy_name, region, ...) 보관하고, 후처리 스크립트로 T02 슬롯의 placeholder를 실제 academy_id 목록으로 expand. 운전선생도 학원 수백 곳을 이 방식으로 다루는 것으로 추정.

**Q. 슬롯 검색량은 어떻게 갱신하나요?**
A. 분기 1회 정도 키워드 도구에서 다운로드 → `01_axes.csv` 업데이트 → `generate_slots.py` 재실행. 트렌드 빠른 키워드는 월 1회 권장.

---

## 11. 다음 단계

이 매트릭스를 가지고 실제 콘텐츠 발행 파이프라인으로 연결하려면:

1. **`PROMPT_LIBRARY.md`의 템플릿 YAML**과 `template_id`가 1:1 매칭됨 → 슬롯 → 프롬프트 → LLM 호출
2. **`IMAGE_AND_TABLE_STRATEGY.md`의 entity_images** 테이블이 `entity_id`로 슬롯과 묶임
3. **`PROGRAMMATIC_SEO_PLAYBOOK.md` 4장(LLM 배치)** 의 worker가 슬롯 CSV를 큐로 받아 일 N건씩 처리

`INDEX.md`에서 전체 흐름 확인 가능.
