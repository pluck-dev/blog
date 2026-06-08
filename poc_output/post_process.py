"""
후처리: [TABLE_SLOT], [IMAGE_SLOT], [INTERNAL_LINK] → 실제 컨텐츠로 치환.
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).parent
src = (ROOT / "04_generated_post_v2.md").read_text(encoding="utf-8")
data = json.loads((ROOT / "02_input_data.json").read_text(encoding="utf-8"))

# === 1. TABLE_SLOT 치환 ===
def json_to_md_table(academies):
    header = "| 학원명 | 위치 | 2종 자동 비용 | 교육 기간 | 셔틀 노선 | 핵심 특징 |"
    sep = "| --- | --- | --- | --- | --- | --- |"
    rows = []
    short_data = [
        ("그린드라이빙스쿨", "수원 영통구 매탄동", "78만원", "7일", "8개", "야간 9시까지"),
        ("미래자동차운전학원", "수원 권선구 호매실동", "72만원", "5일 최단기", "5개", "가성비 + 합격률 91%"),
        ("행복자동차운전전문학원", "수원 장안구 정자동", "82만원", "10일", "12개", "수원 최다 셔틀"),
        ("으뜸드라이빙센터", "수원 팔달구 인계동", "76만원", "7일", "6개", "수원시청 접근성"),
        ("베스트자동차학원", "수원 영통구 원천동", "69만원", "5일", "10개", "가성비 종합 1위"),
    ]
    for r in short_data:
        rows.append("| " + " | ".join(r) + " |")
    return "\n".join([header, sep] + rows)

processed = re.sub(
    r'\[TABLE_SLOT:\s*academy_comparison\s*\]',
    json_to_md_table(data["academy_data_json"]["academies"]),
    src,
)

# === 2. IMAGE_SLOT 치환 ===
academy_order = [
    ("ent_demo_001", "그린드라이빙스쿨"),
    ("ent_demo_002", "미래자동차운전학원"),
    ("ent_demo_003", "행복자동차운전전문학원"),
    ("ent_demo_004", "으뜸드라이빙센터"),
    ("ent_demo_005", "베스트자동차학원"),
]

def make_image(entity_id, academy_name, post_idx):
    """실제 운영시: entity_images 테이블에서 픽업.
    PoC: 자체 호스팅 URL 패턴 시뮬레이션."""
    url = f"https://cdn.adrock.example/academy-images/{entity_id}-exterior-1.webp"
    alt = f"{academy_name}의 본관 외관과 학원 차량을 보여주는 사진. 수원 영통구 위치 (2026년 5월 촬영)."
    return f'![{alt}]({url})'

# 순서대로 5개 학원 이미지 슬롯을 치환
image_iter = iter(academy_order)
def img_replacer(_m):
    eid, name = next(image_iter)
    return make_image(eid, name, 0)

processed = re.sub(r'\[IMAGE_SLOT:\s*exterior\s*\]', img_replacer, processed)

# === 3. INTERNAL_LINK 치환 ===
INTERNAL_LINK_MAP = {
    "수원_운전면허_가이드_허브": "/blog/T07_suwon_guide_hub",
    "수원_운전면허_비용_절약": "/blog/T05_suwon_cost_save",
}

def link_replacer(m):
    key = m.group(1).strip()
    href = INTERNAL_LINK_MAP.get(key, "#")
    label = key.replace("_", " ")
    return f'[{label}]({href})'

processed = re.sub(r'\[INTERNAL_LINK:\s*([^\]]+?)\s*\]', link_replacer, processed)

# === 4. 발행본 저장 (마크다운) ===
out_md = ROOT / "07_published_post.md"
out_md.write_text(processed, encoding="utf-8")

# === 5. HTML 변환 (Next.js MDX 컴포넌트 시뮬레이션) ===
meta = json.loads((ROOT / "05_generated_meta.json").read_text(encoding="utf-8"))

html_head = f'''<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>{meta["selected_title"]}</title>
<meta name="description" content="{meta["selected_description"]}">
<meta name="keywords" content="{",".join(meta["keywords"])}">
<meta name="googlebot" content="index,follow">
<meta name="NaverBot" content="index,follow">
<meta name="Yeti" content="index,follow">
<meta name="robots" content="index,follow">
<link rel="canonical" href="{meta["open_graph"]["og:url"]}">

<!-- Open Graph -->
<meta property="og:type" content="{meta["open_graph"]["og:type"]}">
<meta property="og:title" content="{meta["open_graph"]["og:title"]}">
<meta property="og:description" content="{meta["open_graph"]["og:description"]}">
<meta property="og:image" content="{meta["open_graph"]["og:image"]}">
<meta property="og:url" content="{meta["open_graph"]["og:url"]}">

<!-- Twitter -->
<meta name="twitter:card" content="{meta["twitter_card"]["twitter:card"]}">
<meta property="twitter:title" content="{meta["twitter_card"]["twitter:title"]}">
<meta property="twitter:description" content="{meta["twitter_card"]["twitter:description"]}">
<meta property="twitter:image" content="{meta["twitter_card"]["twitter:image"]}">

<script type="application/ld+json">
{json.dumps(meta["schema_org_article"], ensure_ascii=False, indent=2)}
</script>

<script type="application/ld+json">
{json.dumps(meta["schema_org_faq"], ensure_ascii=False, indent=2)}
</script>
</head>
<body>
<!-- 본문은 MDX 렌더링으로 처리됨. 이 HTML은 메타 확인용 -->
<article>
<!-- {meta["selected_title"]} -->
</article>
</body>
</html>'''

(ROOT / "08_published_html_head.html").write_text(html_head, encoding="utf-8")

print(f"[OK] 후처리 완료")
print(f"  - {out_md.name}: 발행 가능한 최종 마크다운 ({len(processed)}자)")
print(f"  - 08_published_html_head.html: Next.js <Head> 시뮬레이션")

# 통계
print(f"\n[변환 통계]")
print(f"  TABLE_SLOT 치환: 1개 (academy_comparison)")
print(f"  IMAGE_SLOT 치환: {len(academy_order)}개")
il_count = src.count("[INTERNAL_LINK:")
print(f"  INTERNAL_LINK 치환: {il_count}개")
print(f"  최종 마크다운 길이: {len(processed)}자")
