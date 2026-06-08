"""v2 검증 (재생성 후) — v1과 비교 가능하도록 동일 체크."""
import re, json
from pathlib import Path

ROOT = Path(__file__).parent
post = (ROOT / "04_generated_post_v2.md").read_text(encoding="utf-8")

def strip_md(t):
    t = re.sub(r'\[(TABLE|IMAGE)_SLOT:[^\]]+\]', '', t)
    t = re.sub(r'\[INTERNAL_LINK:[^\]]+\]', '', t)
    t = re.sub(r'!\[.*?\]\(.*?\)', '', t)
    t = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', t)
    t = re.sub(r'^#{1,6}\s+', '', t, flags=re.M)
    t = re.sub(r'\*\*(.*?)\*\*', r'\1', t)
    return re.sub(r'\s+', '', t)

R = []
def c(name, ok, detail=""): R.append({"check":name, "pass":ok, "detail":detail})

length = len(strip_md(post))
c("길이 1,800~2,800", 1800 <= length <= 2800, f"{length}자")
c("H1 = 1", len(re.findall(r'^# [^#]', post, re.M)) == 1, "")
h2 = re.findall(r'^## ', post, re.M); c("H2 3~6", 3 <= len(h2) <= 6, f"{len(h2)}개")
h3 = re.findall(r'^### ', post, re.M); c("H3 ≥3", len(h3) >= 3, f"{len(h3)}개")
kw = post.count("수원운전면허학원"); c("주키워드 5~12", 5 <= kw <= 12, f"{kw}회")
rt = sum(post.count(v) for v in ["수원시","수원 시내","수원 권역","수원에서","수원 ","수원역"])
c("지역명 ≥10", rt >= 10, f"{rt}회")
c("페르소나 직장인 ≥3", post.count("직장인") >= 3, f"{post.count('직장인')}회")
fb = ["최고의","완벽한","100%","절대로","무조건","여러분도","결론적으로","본격적으로"]
viol = [w for w in fb if w in post]; c("금지어 미포함", not viol, str(viol) if viol else "OK")
ai = ["이 글에서는","오늘은 ","지금부터 ","다시 한번","도움이 되셨","유용한 정보"]
ai_v = [w for w in ai if w in post]; c("AI 클리셰 미포함", not ai_v, str(ai_v) if ai_v else "OK")
c("표 슬롯 ≥1", len(re.findall(r'\[TABLE_SLOT:[^\]]+\]', post)) >= 1, "")
c("이미지 슬롯 ≥3", len(re.findall(r'\[IMAGE_SLOT:[^\]]+\]', post)) >= 3, "")
c("내부 링크 ≥1", len(re.findall(r'\[INTERNAL_LINK:[^\]]+\]', post)) >= 1, "")
c("권위 출처 ≥1", "safedriving.or.kr" in post or ".go.kr" in post, "")
nums = re.findall(r'\d+\s*(?:만\s*원|만원|일|개|%|시)', post)
c("숫자 ≥10", len(nums) >= 10, f"{len(nums)}개")
c("시점(2026) ≥2", sum(post.count(d) for d in ["2026년 5월","2026"]) >= 2, "")
bold = len(re.findall(r'\*\*[^*]+\*\*', post)); c("굵게 3~10", 3 <= bold <= 10, f"{bold}개")
end = {
    "~입니다": len(re.findall(r'입니다[\.\s]', post)),
    "~예요": len(re.findall(r'예요[\.\s]', post)),
    "~죠": len(re.findall(r'죠[\.\s]', post)),
    "~네요": len(re.findall(r'네요[\.\s]', post)),
}
variety = sum(1 for v in end.values() if v > 0)
c("종결어미 ≥3종", variety >= 3, str(end))
c("입장 표명 ≥1", any(s in post for s in ["1순위 후보","추천","종합 1위"]), "")
c("객관성(약점 ≥3)", sum(post.count(w) for w in ["단점","약점","협소","불편","비싸"]) >= 3, "")
c("FAQ Q ≥3", len(re.findall(r'\*\*Q\.[^*]+\*\*', post)) >= 3, "")
ps = [p.strip() for p in post.split('\n\n') if p.strip() and not p.startswith('#')]
one = sum(1 for p in ps if len(re.split(r'[.!?]', p)) <= 2)
multi = sum(1 for p in ps if len(re.split(r'[.!?]', p)) >= 4)
c("단락 길이 다양성", one >= 1 and multi >= 1, f"1문장:{one}, 4문장+:{multi}")

passed = sum(1 for r in R if r["pass"])
total = len(R)
print(f"\n=== v2 검증: {passed}/{total} 통과 ===\n")
for r in R:
    icon = "✅" if r["pass"] else "❌"
    print(f"{icon} {r['check']:<30} {r['detail']}")

# v1 결과와 합쳐 비교 저장
v1_results = json.loads((ROOT/"06_validation_results.json").read_text(encoding="utf-8"))
combined = {
    "v1_initial_generation": v1_results,
    "v2_after_regeneration": {
        "summary": {"total": total, "passed": passed, "pass_rate": round(passed/total*100, 1)},
        "checks": R,
    },
    "improvement": {
        "v1_pass_rate": v1_results["summary"]["pass_rate"],
        "v2_pass_rate": round(passed/total*100, 1),
        "fixed_checks": [
            "주 키워드 출현 횟수 (4 → 6회)",
            "굵게 강조 개수 (13 → 10개)",
            "종결어미 다양성 (2종 → 4종)",
        ],
    },
}
(ROOT/"06_validation_results.json").write_text(json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"\n저장: 06_validation_results.json (v1+v2 비교)")
