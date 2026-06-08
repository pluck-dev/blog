"""PoC 산출물 검증: 구조·SEO·Anti-Detection 자동 점검."""
import re, json
from pathlib import Path

ROOT = Path(__file__).parent
post_md = (ROOT / "04_generated_post.md").read_text(encoding="utf-8")

def strip_markdown(text: str) -> str:
    text = re.sub(r'\[(TABLE|IMAGE)_SLOT:[^\]]+\]', '', text)
    text = re.sub(r'\[INTERNAL_LINK:[^\]]+\]', '', text)
    text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.M)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    text = re.sub(r'\s+', '', text)  # 공백 제거 (한국어 글자수 산정)
    return text

results = []
def check(name, ok, detail=""):
    results.append({"check": name, "pass": ok, "detail": detail})

# 1. 길이
text_only = strip_markdown(post_md)
length = len(text_only)
check("길이 (1,800~2,800 한국어 글자)", 1800 <= length <= 2800, f"실측: {length}자")

# 2. H1 개수 (정확히 1개)
h1 = re.findall(r'^# [^#]', post_md, re.M)
check("H1 정확히 1개", len(h1) == 1, f"발견: {len(h1)}개")

# 3. H2 개수 (3~6개)
h2 = re.findall(r'^## ', post_md, re.M)
check("H2 3~6개", 3 <= len(h2) <= 6, f"발견: {len(h2)}개")

# 4. H3 개수
h3 = re.findall(r'^### ', post_md, re.M)
check("H3 ≥3개 (학원 5곳)", len(h3) >= 3, f"발견: {len(h3)}개")

# 5. 주 키워드 출현 (5~12회)
primary_kw = "수원운전면허학원"
kw_count = post_md.count(primary_kw)
check(f"주 키워드 '{primary_kw}' 5~12회", 5 <= kw_count <= 12, f"실측: {kw_count}회")

# 5-1. 지역명 분포 (3~5회 이상)
region_variants = ["수원시", "수원 시내", "수원 권역", "수원에서", "수원 ", "수원역"]
region_total = sum(post_md.count(v) for v in region_variants)
check("지역명 자연 분포 (변형 포함 ≥10회)", region_total >= 10, f"실측: {region_total}회")

# 6. 페르소나 출현
persona = "직장인"
p_count = post_md.count(persona)
check(f"페르소나 '{persona}' ≥3회", p_count >= 3, f"실측: {p_count}회")

# 7. 금지어
forbidden = ["최고의", "완벽한", "100%", "절대로", "무조건", "여러분도", "결론적으로", "본격적으로"]
violations = [w for w in forbidden if w in post_md]
check(f"금지어 미포함", not violations, f"발견: {violations}" if violations else "0개")

# 8. AI 클리셰
ai_phrases = [
    "이 글에서는", "오늘은 ", "지금부터 ", "다시 한번",
    "도움이 되셨", "유용한 정보", "함께 알아보", "다음과 같이 정리할",
]
ai_violations = [p for p in ai_phrases if p in post_md]
check("AI 클리셰 미포함", not ai_violations, f"발견: {ai_violations}" if ai_violations else "0개")

# 9. 표 슬롯
table_slots = re.findall(r'\[TABLE_SLOT:[^\]]+\]', post_md)
check("표 슬롯 ≥1개", len(table_slots) >= 1, f"발견: {len(table_slots)} ({table_slots})")

# 10. 이미지 슬롯
image_slots = re.findall(r'\[IMAGE_SLOT:[^\]]+\]', post_md)
check("이미지 슬롯 ≥3개", len(image_slots) >= 3, f"발견: {len(image_slots)}개")

# 11. 내부 링크 슬롯
internal_links = re.findall(r'\[INTERNAL_LINK:[^\]]+\]', post_md)
check("내부 링크 슬롯 ≥1개", len(internal_links) >= 1, f"발견: {len(internal_links)}")

# 12. 외부 신뢰 도메인 (.go.kr/공식)
official_refs = re.findall(r'(safedriving\.or\.kr|\.go\.kr)', post_md)
check("외부 권위 출처 ≥1개", len(official_refs) >= 1, f"발견: {official_refs}")

# 13. 숫자 정보 (가격·기간 등)
numbers = re.findall(r'\d+\s*(?:만\s*원|만원|일|개|%|시)', post_md)
check("숫자 정보 ≥10개", len(numbers) >= 10, f"실측: {len(numbers)}개")

# 14. 시점 표기
date_refs = ["2026년 5월", "2026"]
date_count = sum(post_md.count(d) for d in date_refs)
check("시점(2026) 표기 ≥2회", date_count >= 2, f"실측: {date_count}회")

# 15. 강조 (굵게) 빈도
bold_count = len(re.findall(r'\*\*[^*]+\*\*', post_md))
check("굵게 강조 3~10개", 3 <= bold_count <= 10, f"실측: {bold_count}개")

# 16. 종결어미 다양성 (입니다/예요/죠/네요 모두 1회 이상)
endings = {
    "~입니다": len(re.findall(r'입니다[\.\s]', post_md)),
    "~예요": len(re.findall(r'예요[\.\s]', post_md)),
    "~죠": len(re.findall(r'죠[\.\s]', post_md)),
    "~네요": len(re.findall(r'네요[\.\s]', post_md)),
}
variety = sum(1 for v in endings.values() if v > 0)
check("종결어미 다양성 ≥3종", variety >= 3, f"실측: {endings}")

# 17. 명확한 입장 표명
clear_stance = ["1순위 후보", "추천", "가성비 종합 1위"]
stance_found = [s for s in clear_stance if s in post_md]
check("명확한 입장 표명 ≥1회", len(stance_found) >= 1, f"발견: {stance_found}")

# 18. 약점/단점 명시
weakness_terms = ["단점", "약점", "협소", "불편", "비싸"]
weakness_total = sum(post_md.count(w) for w in weakness_terms)
check("객관성 (약점/단점 ≥3회)", weakness_total >= 3, f"실측: {weakness_total}회")

# 19. FAQ 섹션
faq_questions = re.findall(r'\*\*Q\.[^*]+\*\*', post_md)
check("FAQ Q ≥3개", len(faq_questions) >= 3, f"발견: {len(faq_questions)}개")

# 20. 단락 길이 다양성 (한 문장 단락 ≥1개, 4문장+ 단락 ≥1개)
paragraphs = [p.strip() for p in post_md.split('\n\n') if p.strip() and not p.startswith('#')]
one_sent = sum(1 for p in paragraphs if len(re.split(r'[.!?]', p)) <= 2)
multi_sent = sum(1 for p in paragraphs if len(re.split(r'[.!?]', p)) >= 4)
check("단락 길이 다양성", one_sent >= 1 and multi_sent >= 1, f"1문장: {one_sent}, 4문장+: {multi_sent}")

# 출력
total = len(results)
passed = sum(1 for r in results if r["pass"])
print(f"\n=== 검증 결과: {passed}/{total} 통과 ===\n")
for r in results:
    icon = "✅" if r["pass"] else "❌"
    print(f"{icon} {r['check']:<40} {r['detail']}")

# JSON 저장
out = ROOT / "06_validation_results.json"
out.write_text(json.dumps({
    "summary": {"total": total, "passed": passed, "pass_rate": round(passed/total*100, 1)},
    "checks": results,
    "stats": {
        "length": length,
        "h1_count": len(h1),
        "h2_count": len(h2),
        "h3_count": len(h3),
        "primary_keyword_count": kw_count,
        "persona_count": p_count,
        "image_slots": len(image_slots),
        "table_slots": len(table_slots),
        "internal_links": len(internal_links),
        "bold_count": bold_count,
        "ending_distribution": endings,
        "number_data_count": len(numbers),
    }
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n저장: {out.name}")
