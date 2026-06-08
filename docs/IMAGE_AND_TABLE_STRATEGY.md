# 양산형 SEO의 이미지·표 운용 전략

> 운전선생(drivingteacher.co.kr) 21,275건의 실측 데이터를 기반으로 정리한 이미지·표 처리 전략.
> `PROGRAMMATIC_SEO_PLAYBOOK.md` / `PROMPT_LIBRARY.md`의 보완 문서.

작성일: 2026-05-22

---

## 1. 실측 결과 요약 (운전선생 분석)

| 지표 | 값 |
|---|---|
| 호스팅 | **100% 자체 호스팅** (Firebase Storage) |
| 외부 핫링킹 | 0건 |
| 글당 이미지 평균 | **3.9장** (최소 1, 최대 6) |
| 이미지 0장 글 | 4/5000 (= 0.08%, 사실상 모든 글에 이미지) |
| 이미지 고유성 | **98.3% unique** |
| 51회 이상 재사용 | 45장 (0.4%) — 모두 학원별 대표 사진 |
| 표(table) 사용 | **99.9%가 1개 이상**, 평균 1.6개 |

### URL 패턴
- `/academy_data/{uuid}.png` — **객체(학원) 사진 풀**. 학원당 N장 미리 등록.
- `/blog-images/blog-main-{timestamp}.png` — **글마다 다른 커버**. 글 발행 시 자동 생성/업로드.

이 두 패턴이 핵심 인사이트입니다.

---

## 2. 이미지 전략의 4가지 축

이미지를 채우는 방법은 4가지가 있고, **운전선생은 ①+②를 메인으로**, ④는 보조로 씁니다.

| 전략 | 차별화 | 비용 | 운전선생 | 우리 권장 |
|---|---|---|---|---|
| ① 실체 객체 매핑 (사진 1:N) | ★★★★★ | 객체 등록 비용만 | 메인 | 메인 |
| ② AI 생성 (커버 이미지) | ★★★★ | 장당 $0.003~0.04 | 메인 | 메인 |
| ③ 스톡 이미지 | ★★ | 월 $30~200 | 미사용 | 보조 |
| ④ 카테고리 풀 (수동 큐레이션) | ★★★ | 큐레이션 인건비 | 보조 | 보조 |

---

## 3. 전략 ①: 실체 객체 매핑 (운전선생 메인 전략)

### 3.1 핵심 개념
> **"양산할 글이 다루는 실체(학원, 매장, 상품, 지역)에 사진을 미리 묶어둔다."**

운전선생의 경우:
- 학원 객체 1개당 → 사진 5~10장 사전 업로드 (외관, 차량, 강사실, 휴게실, 시험장 등)
- 글 생성 시: 글이 다루는 학원의 사진 풀에서 3~5장 자동 선택
- 같은 학원을 다루는 100개 글이라도 매번 다른 조합으로 픽업 가능

### 3.2 DB 설계 (Postgres 기준)

```sql
CREATE TABLE entities (
  id            UUID PRIMARY KEY,
  type          TEXT NOT NULL,  -- 'academy', 'restaurant', 'product', ...
  name          TEXT NOT NULL,
  region        TEXT,
  data_json     JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE entity_images (
  id            UUID PRIMARY KEY,
  entity_id     UUID REFERENCES entities(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  type          TEXT,    -- 'exterior', 'interior', 'product', 'staff', 'detail'
  caption       TEXT,    -- "수원 영통 본관 전경" 등
  alt_keywords  TEXT[],  -- alt 텍스트 생성용 키워드
  width         INT,
  height        INT,
  priority      INT DEFAULT 0,  -- 0~100, 노출 우선순위
  usage_count   INT DEFAULT 0,  -- 자동 누적
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_entity_images_entity ON entity_images(entity_id, type, priority DESC);
```

### 3.3 자동 선택 알고리즘

```python
def pick_images_for_post(
    entity_id: str,
    needed_count: int = 4,
    types_required: list[str] = None,
) -> list[Image]:
    """
    한 글에 들어갈 이미지 N장을 픽업.
    - 같은 글에 같은 사진 두 번 X
    - 최근 사용한 사진은 잠시 피함 (다양성 ↑)
    - type이 다양하게 섞이도록
    """
    types_required = types_required or ['exterior', 'interior', 'detail']
    picked = []

    # 1) 우선 type 별로 1장씩 (다양성 확보)
    for t in types_required:
        candidates = db.query("""
            SELECT * FROM entity_images
            WHERE entity_id = %s AND type = %s
            ORDER BY
              CASE WHEN last_used_at < NOW() - INTERVAL '7 days' THEN 0 ELSE 1 END,
              usage_count ASC,
              priority DESC,
              RANDOM()
            LIMIT 1
        """, [entity_id, t])
        if candidates:
            picked.append(candidates[0])

    # 2) 남은 슬롯은 type 무관하게 채우기
    while len(picked) < needed_count:
        candidates = db.query("""
            SELECT * FROM entity_images
            WHERE entity_id = %s
              AND id != ALL(%s)
            ORDER BY usage_count ASC, RANDOM()
            LIMIT 1
        """, [entity_id, [p.id for p in picked]])
        if not candidates:
            break
        picked.append(candidates[0])

    # 3) 사용 카운트 업데이트
    db.execute("""
        UPDATE entity_images
        SET usage_count = usage_count + 1, last_used_at = NOW()
        WHERE id = ANY(%s)
    """, [[p.id for p in picked]])

    return picked
```

### 3.4 alt 텍스트 자동 생성

이미지 alt는 SEO에서 매우 중요. LLM으로 자동 생성:

```python
async def generate_alt_text(image: Image, post_context: dict) -> str:
    """
    이미지의 alt 텍스트를 본문 맥락 + 이미지 메타로 생성.
    """
    prompt = f"""
    다음 이미지의 alt 텍스트를 한국어로 작성하세요.
    - 길이: 60~100자
    - 키워드 자연스럽게 포함: {post_context['primary_keyword']}, {image.alt_keywords}
    - 형식: "{image.caption}을(를) 보여주는 사진. {post_context['context_short']}."
    - 과장·중복 형용사 금지

    이미지 정보:
    - 캡션: {image.caption}
    - 타입: {image.type}
    - 객체: {post_context['entity_name']}
    - 글 주제: {post_context['topic']}
    """
    response = await haiku.complete(prompt, max_tokens=120)
    return response.strip().strip('"')
```

alt 예시:
- ❌ 나쁜 예: `"이미지"`, `"수원운전면허학원"`
- ✅ 좋은 예: `"뉴삼성자동차운전전문학원 본관 외관과 학원 차량이 보이는 전경 사진. 수원 영통구 위치."`

### 3.5 본문 삽입 패턴

LLM 본문 생성 시, 이미지 슬롯을 placeholder로 표시한 뒤 후처리에서 실제 이미지로 치환:

```
[LLM 출력 본문]
## 학원 외관 및 접근성

[IMAGE_SLOT: exterior]

뉴삼성자동차운전전문학원은 수원 영통구에 위치한 ...

## 차량 및 시설

[IMAGE_SLOT: vehicle]

학원에서 사용하는 차량은 ...
```

```python
def replace_image_slots(content: str, picked_images: dict[str, Image], primary_kw: str) -> str:
    """[IMAGE_SLOT: type] → ![alt](url) 변환."""
    def replacer(match):
        slot_type = match.group(1)
        img = picked_images.get(slot_type)
        if not img:
            return ""  # 슬롯에 해당하는 이미지 없으면 제거
        alt = generate_alt_text_sync(img, ctx)
        return f'![{alt}]({img.url})'
    return re.sub(r'\[IMAGE_SLOT:\s*(\w+)\]', replacer, content)
```

### 3.6 객체 사진 확보 방법

**선택지 A: 객체 제공자가 직접 업로드** (가장 좋음)
- 운전선생: 가맹 학원이 자기 사진을 자유롭게 업로드
- 음식점 플랫폼: 점주가 직접 등록
- 효과: 진짜 사진 → 신뢰도 ↑↑↑

**선택지 B: 운영팀이 현장 촬영**
- 비용: 객체당 5만~30만원 (사진사 / 출장비)
- 1,000개 객체 = 5,000만~3억원
- 효과: 품질 균일

**선택지 C: 객체 공식 사이트/지도에서 수집**
- 네이버 플레이스/카카오맵 API: 사진 사용 약관 확인 필수
- 구글 Street View Static API: 외관 사진은 사용 가능 (조건 있음)
- 효과: 합법적이지만 차별화 약함

**선택지 D: 객체에 사진 요청 (소셜 프루프)**
- "사진 1장 등록 시 등급 ↑" 같은 게임화
- 비용 거의 0
- 효과: 시간 걸리지만 지속가능

---

## 4. 전략 ②: AI 이미지 생성 (커버 이미지 메인 전략)

### 4.1 왜 커버 이미지는 AI 생성인가
- 글마다 **고유한 OG image** 필요 (SNS 공유 시 미리보기, 네이버/구글 검색 결과 썸네일)
- 같은 객체 사진을 200개 글에 다 쓰면 OG가 동일 → 검색 결과에서 차별화 X
- 글의 키워드·인텐트에 맞춰 매번 새로 생성

### 4.2 모델·비용 비교 (2026년 5월 기준)

| 모델 | 가격/장 | 품질 | 한국어 텍스트 | 1만건 비용 | 권장 용도 |
|---|---|---|---|---|---|
| **Flux Schnell** (Replicate) | $0.003 | ★★★★ | △ | $30 | 메인 (대량) |
| **Flux Pro** (Replicate) | $0.05 | ★★★★★ | ○ | $500 | 프리미엄 |
| **DALL-E 3 standard** | $0.04 | ★★★★ | △ | $400 | 검증된 안정성 |
| **DALL-E 3 HD** | $0.08 | ★★★★★ | △ | $800 | 메인 비주얼 |
| **Imagen 3** (Vertex AI) | $0.03 | ★★★★★ | ○ | $300 | 한글 텍스트 |
| **Stable Diffusion XL** (셀프호스팅) | $0.0001 (전기료) | ★★★ | ✗ | $1 | 무한 양산 |
| **Midjourney** (셀프 자동화 어려움) | $30/월 무제한 | ★★★★★ | ✗ | n/a | 수동 큐레이션 |

**우리 권장 조합**:
- 커버 이미지: **Flux Schnell** ($0.003 × 10,000 = $30) 또는 **Imagen 3** (한글 텍스트 포함 시)
- 본문 다이어그램/일러스트: DALL-E 3 standard
- 백업: SDXL 셀프호스팅 (Replicate Public Models)

### 4.3 프롬프트 라이브러리 — 이미지 생성용

같은 글이라도 매번 다른 비주얼이 나오게 변수 다이얼:

```yaml
image_prompt_template:
  base: "Korean blog header image, {topic}, {visual_style}, {composition}, {color_palette}, {time_of_day}"

  variables:
    visual_style:
      - "minimalist illustration"
      - "soft watercolor"
      - "modern flat design"
      - "photorealistic"
      - "isometric 3D"
      - "hand-drawn sketch with subtle color"

    composition:
      - "centered subject, clean background"
      - "diagonal composition with depth"
      - "top-down view"
      - "wide shot with negative space"
      - "close-up detail"

    color_palette:
      - "warm pastel tones"
      - "cool blue and white"
      - "earthy autumn"
      - "vibrant pop colors"
      - "monochromatic blue gradient"

    time_of_day:
      - "morning light"
      - "golden hour"
      - "soft daylight"
      - "evening warmth"

  constraints:
    - "no text overlay"   # 한글 텍스트는 LLM이 잘 못 그림. 따로 합성
    - "no recognizable faces"
    - "no copyrighted logos"
    - "16:9 aspect ratio"
    - "subject must clearly represent: {topic_main_visual}"
```

### 4.4 텍스트 오버레이는 후처리

AI 이미지에 한글 텍스트를 직접 그리게 하면 깨짐. 대신:

```python
from PIL import Image, ImageDraw, ImageFont

def add_text_overlay(image_path: str, title: str, output_path: str):
    img = Image.open(image_path).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0,0,0,0))
    draw = ImageDraw.Draw(overlay)

    # Pretendard 같은 한글 폰트
    font = ImageFont.truetype("Pretendard-Bold.ttf", size=64)

    # 텍스트 배경 그라데이션 (반투명 어두운 박스)
    text_y = img.height - 200
    draw.rectangle([0, text_y-20, img.width, img.height], fill=(0,0,0,140))

    # 텍스트
    draw.text((40, text_y), title, font=font, fill=(255,255,255,255))

    out = Image.alpha_composite(img, overlay).convert("RGB")
    out.save(output_path, "WEBP", quality=85)
```

### 4.5 자동 파이프라인

```python
async def generate_cover_image(post: Post) -> str:
    """글의 커버 이미지를 생성하고 자체 호스팅에 업로드."""

    # 1) 프롬프트 빌드
    variables = sample_image_variables()
    image_prompt = render_image_prompt(post.topic, variables)

    # 2) AI 생성 (Flux Schnell via Replicate)
    raw_image_url = await replicate.run(
        "black-forest-labs/flux-schnell",
        input={
            "prompt": image_prompt,
            "aspect_ratio": "16:9",
            "output_format": "webp",
            "output_quality": 80,
        },
    )

    # 3) 다운로드 + 텍스트 오버레이
    raw_path = await download(raw_image_url, "/tmp/raw.webp")
    final_path = "/tmp/final.webp"
    add_text_overlay(raw_path, post.title_short(), final_path)

    # 4) 자체 호스팅 업로드 (Firebase Storage / R2 / S3)
    public_url = await upload_to_storage(
        final_path,
        key=f"blog-covers/{post.id}.webp",
        content_type="image/webp",
        cache_control="public, max-age=31536000, immutable",
    )

    # 5) 메타 갱신
    post.image = public_url
    post.og_image = public_url
    return public_url
```

비용 추정 (1만 건):
- Flux 생성: $30
- 저장: 1만장 × 평균 100KB = 1GB → $0.02/월 (R2)
- CDN 트래픽: 무료 (Cloudflare R2 + Workers 무제한)

---

## 5. 전략 ③: 스톡 이미지 (보조)

### 5.1 사용 시점
- 일반적인 컨셉 이미지 ("자동차 키를 받는 모습", "공부하는 학생")
- 객체에 없는 시나리오 그림이 필요할 때
- AI 생성으로 어색한 인물·자연 풍경

### 5.2 추천 소스
| 소스 | 라이센스 | 비용 | 차별화 |
|---|---|---|---|
| **Unsplash+** | 상업적 무제한 | $20/월 | △ (인기 이미지 중복) |
| **Pexels** | 무료 | 무료 | △ |
| **Adobe Stock** | 사용 횟수 기반 | $30~80/월 | ○ (양질 다수) |
| **iStock 무제한** | 상업적 무제한 | $200/월 | ○ |
| **Shutterstock** | 묶음 | $50~250/월 | ○ |
| **freepik premium** | 상업적 | $10/월 | △ |

**경고**: 같은 스톡을 경쟁사도 쓰면 OG image SERP에서 묻힘. **반드시 후처리(필터, 크롭, 텍스트 오버레이)로 차별화**.

### 5.3 스톡 차별화 후처리 자동화

```python
def stock_to_branded(stock_path: str, brand_overlay: dict) -> str:
    """
    스톡 이미지에 브랜드 필터를 입혀 차별화.
    - 색조 시프트
    - 텍스트 오버레이
    - 그라데이션 마스크
    """
    img = Image.open(stock_path)

    # 1) 색조 조정 (브랜드 색상 톤)
    img = ImageEnhance.Color(img).enhance(0.8)  # 채도 ↓

    # 2) 그라데이션 오버레이 (브랜드 컬러)
    gradient = create_gradient(img.size, brand_overlay["color_a"], brand_overlay["color_b"], alpha=80)
    img = Image.alpha_composite(img.convert("RGBA"), gradient)

    # 3) 텍스트
    add_text_overlay_inplace(img, brand_overlay["title"])

    return img
```

---

## 6. 전략 ④: 카테고리 풀 (수동 큐레이션)

### 6.1 구조
객체에 묶을 수 없는 일반 컨셉 이미지를 카테고리별로 미리 모아둠.

```
image_pool/
├─ 운전수업/
│  ├─ instructor_1.webp
│  ├─ practice_road_1.webp
│  └─ ... (50장)
├─ 시험장/
│  ├─ exam_center_1.webp
│  └─ ... (50장)
├─ 면허증/
│  └─ ... (30장)
├─ 도로/
│  └─ ... (100장)
└─ 차량/
   └─ ... (80장)
```

### 6.2 자동 선택 (객체 매핑과 비슷)

```python
def pick_from_pool(category: str, exclude_recent_days: int = 30) -> Image:
    return db.query("""
        SELECT * FROM pool_images
        WHERE category = %s
          AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL '%s days')
        ORDER BY usage_count ASC, RANDOM()
        LIMIT 1
    """, [category, exclude_recent_days]).first()
```

### 6.3 LLM 본문에서 카테고리 명시

```
[LLM 출력]
## 도로주행 시험의 핵심 포인트

[POOL_IMAGE: 도로]

도로주행 시험에서 가장 중요한 것은 ...
```

---

## 7. 종합: 이미지 슬롯 결정 트리

글 1건당 이미지 4장을 채운다고 가정:

```
┌─ 표지 이미지 (1장)
│  └─ ② AI 생성 (Flux Schnell) + 텍스트 오버레이
│
├─ 본문 이미지 (3장)
│  ├─ 객체 다루는 글인 경우
│  │  └─ ① 객체 매핑 풀에서 3장 픽업 (type 다양화)
│  └─ 일반 가이드 글인 경우
│     ├─ ④ 카테고리 풀에서 2장
│     └─ ③ 스톡 후처리 1장 또는 ② AI 1장
```

운전선생의 실제 배분 추정:
- 표지: 글마다 신규 ② (`blog-images/blog-main-{ts}.png`)
- 본문 3~5장: 객체(학원) 사진 풀 ① (`academy_data/{uuid}`)

이게 **98.3% unique** 라는 수치가 나오는 메커니즘. 객체 풀이 충분히 크면 (예: 학원당 8장 × 학원 500곳 = 4,000장) 절대 중복이 안 생김.

---

## 8. 표(Table) 처리 전략

### 8.1 실측 (운전선생)
- 99.9% 글이 표 1개 이상
- 평균 1.6개 / 최대 5개
- 모든 표가 **마크다운 표** (HTML 직접 작성 거의 없음)

### 8.2 표 종류별 패턴

| 표 유형 | 출현 빈도 | 용도 |
|---|---|---|
| 비교표 (학원 5곳 비교) | 매우 높음 | T01 지역 BEST5 핵심 |
| 가격표 (1종/2종 비용) | 높음 | T02, T05 |
| 절차표 (단계·소요시간·비용) | 중간 | T03 가이드형 |
| 옵션 비교 (장단점) | 중간 | T04 비교형 |
| FAQ | 낮음 | 모든 템플릿 |

### 8.3 LLM에 표 생성 시키기 (안정 패턴)

LLM이 마크다운 표를 깨먹는 경우가 자주 있어서, **데이터 JSON → 표 변환은 후처리**가 안전:

```python
def json_to_md_table(data: list[dict], columns: list[tuple[str,str]]) -> str:
    """
    columns: [(key, header_label), ...]
    """
    header = "| " + " | ".join(h for _, h in columns) + " |"
    sep = "|" + "|".join(["---"] * len(columns)) + "|"
    rows = []
    for item in data:
        row = "| " + " | ".join(str(item.get(k, '-')) for k, _ in columns) + " |"
        rows.append(row)
    return "\n".join([header, sep] + rows)

# 사용 예:
academy_table = json_to_md_table(
    data=academy_data_list,
    columns=[
        ("name", "학원명"),
        ("location_short", "위치"),
        ("price_type2", "2종 비용"),
        ("duration_days", "교육 기간"),
        ("shuttle", "셔틀"),
        ("highlight", "특징"),
    ],
)
```

### 8.4 LLM 프롬프트에서 표 슬롯 처리

```
[LLM 출력]
## 한눈에 비교해보세요

[TABLE_SLOT: academy_comparison]

위 표에서 보듯이 가격은 ○○이 가장 저렴하지만 ...
```

후처리에서 슬롯을 실제 표로 치환.

### 8.5 표 디자인 (마크다운 + CSS)

마크다운 표를 Next.js MDX로 렌더링할 때 CSS:

```css
.prose table {
  width: 100%;
  border-collapse: collapse;
  margin: 1.5rem 0;
  font-size: 0.95rem;
  overflow-x: auto;
  display: block;  /* 모바일에서 가로 스크롤 */
}
.prose thead {
  background: linear-gradient(180deg, #1F4E78 0%, #2B6CB0 100%);
  color: white;
}
.prose th, .prose td {
  padding: 12px 16px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
}
.prose tbody tr:nth-child(even) { background: #f7fafc; }
.prose tbody tr:hover { background: #edf2f7; }
```

모바일에서 가로 스크롤되도록 하는 게 핵심 (테이블 너비 줄여서 깨지지 않도록).

### 8.6 표를 이미지로 변환할지 여부?

가끔 보이는 패턴: 복잡한 표를 PNG로 캡처해 이미지로 삽입.
**권장하지 않음**:
- 검색엔진이 표 안 텍스트를 못 읽음
- 모바일 가독성 떨어짐
- alt 텍스트로 보완해도 SEO 손해

**예외**: 인포그래픽처럼 디자인 핵심인 경우만.

---

## 9. 이미지 SEO 최적화 체크리스트

### 9.1 파일명 (업로드 시점)
- ❌ 나쁨: `IMG_2734.jpg`, `image1.png`
- ✅ 좋음: `suwon-driving-academy-exterior-2026.webp`

```python
def seo_filename(post_topic: str, image_type: str, post_id: str) -> str:
    base = re.sub(r'[^\w가-힣]+', '-', f"{post_topic}-{image_type}").lower()
    base = re.sub(r'-+', '-', base).strip('-')
    return f"{base}-{post_id[:8]}.webp"
```

### 9.2 포맷
- **WebP 기본** (95% 브라우저 지원, 용량 30% 감소)
- AVIF 보조 (Next.js Image 자동 처리)
- PNG는 투명 필요 시만, JPG는 사진 + 큰 사이즈 시만

### 9.3 크기
- 표지: 1200×630 (OG 표준)
- 본문: 800×450 또는 1200×675
- 반응형: Next.js `<Image>` 가 `srcset` 자동 생성

### 9.4 alt 텍스트
- 길이 60~100자
- 주 키워드 1회 자연스럽게 포함
- 이미지 내용을 사실적으로 묘사
- "이미지", "사진" 같은 단어 자체는 alt에 넣지 말기

### 9.5 lazy loading + priority
```jsx
// 표지 이미지: 우선 로드
<Image src={post.image} alt={...} priority width={1200} height={630} />

// 본문 이미지: 지연 로드
<Image src={img.url} alt={...} loading="lazy" width={800} height={450} />
```

### 9.6 Schema.org
```html
<script type="application/ld+json">
{
  "@type": "Article",
  "image": [
    "https://.../suwon-driving-academy-exterior-2026.webp",
    "https://.../suwon-driving-academy-interior-2026.webp"
  ],
  ...
}
</script>
```

### 9.7 sitemap-images.xml
구글에게 이미지 색인을 명시적으로 요청:
```xml
<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>https://example.com/blog/post-id</loc>
    <image:image>
      <image:loc>https://example.com/.../cover.webp</image:loc>
      <image:caption>...</image:caption>
    </image:image>
  </url>
</urlset>
```

---

## 10. 비용 + 운영 부담 종합

### 10.1 1만 건 양산 시 이미지·표 비용

| 항목 | 비용 | 비고 |
|---|---|---|
| 객체 사진 등록 (1,000 객체 × 5장) | 사진사 외주 시 5천만원 / 자체 촬영 시 인건비만 | 1회성, 자산화 |
| Flux Schnell 커버 1만장 | $30 | 매번 신규 |
| 텍스트 오버레이 처리 (서버) | 무료 (셀프 호스팅) | |
| 자체 호스팅 (Cloudflare R2) | $0.02/월 (1만장 ≈ 1GB) | |
| CDN | $0 (Cloudflare 무료) | |
| 스톡 보조 (선택) | $30~200/월 | |
| **총** | **객체 사진 1회성 + 월 $50 이하** | |

운전선생은 가맹 학원이 사진을 제공하므로 객체 사진 비용 = 0. 우리도 비슷한 구조로 갈 수 있으면 거의 무료.

### 10.2 운영 부담
- 객체 풀: 한 번 셋업하면 새 객체 추가만
- 카테고리 풀: 한 카테고리당 50~100장 한 번에 큐레이션
- AI 커버: 완전 자동
- 표: 데이터 JSON만 갱신하면 자동

---

## 11. 우리가 운전선생보다 더 잘할 수 있는 영역

1. **이미지 다양성 ↑**: 운전선생 5,000건 분석 결과 0.4%(45장)가 51회 이상 재사용. 우리는 객체당 사진 풀을 더 크게 (10~15장) 운영해 재사용 0회 가능.
2. **표지 텍스트 오버레이**: 운전선생 표지(`blog-main-{ts}.png`)는 단순 이미지. 우리는 글 제목 자동 합성으로 SNS/검색 결과 CTR ↑.
3. **이미지 alt 길이·키워드 밀도**: 운전선생 일부 alt가 짧거나 비어있음. 우리는 LLM 생성으로 일관성 확보.
4. **인포그래픽**: 비교표 + 핵심 데이터를 PNG 인포그래픽으로 생성 (Canva API, Bannerbear) — 핀터레스트·네이버 이미지 검색 노출 ↑.
5. **이미지 sitemap 운영**: 운전선생 sitemap에는 이미지 정보 없음. 우리는 `sitemap-images.xml` 등록.

---

## 12. 구현 우선순위 (실행 순서)

### Week 1: 인프라
- [ ] R2/S3 + CDN 셋업
- [ ] DB: `entities`, `entity_images`, `pool_images` 테이블 생성
- [ ] WebP 변환 파이프라인 + 텍스트 오버레이 라이브러리

### Week 2: AI 이미지 파이프라인
- [ ] Flux Schnell (Replicate) 키 발급
- [ ] 표지 이미지 생성 함수 + 텍스트 오버레이
- [ ] alt 텍스트 LLM 생성기

### Week 3: 객체 풀 + 카테고리 풀
- [ ] 첫 10개 객체 사진 등록 (자체 또는 외주)
- [ ] 카테고리 풀 5종 × 50장 큐레이션
- [ ] 자동 픽업 함수 동작 검증

### Week 4: 표 + SEO
- [ ] JSON → 마크다운 표 변환 유틸
- [ ] 이미지 SEO 메타 (Schema.org, sitemap-images) 자동 주입
- [ ] 1차 100건 발행 + 색인 확인

---

## 13. 한 줄 요약

> **"실체 객체에 사진 묶기(①) + 글마다 AI 커버 생성(②)" — 이 두 가지가 운전선생의 98.3% 이미지 고유성을 만든 핵심.
> 양산 글이 진짜처럼 보이려면 결국 진짜 객체에 진짜 사진이 묶여 있어야 한다.**

표는 마크다운 + 데이터 JSON 후처리가 가장 안정적. LLM에게 표 생성을 직접 시키지 말 것.
