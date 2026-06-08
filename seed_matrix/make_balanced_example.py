"""균형 잡힌 50건 예시 추출 (템플릿별 분포 보장)."""
import csv
from pathlib import Path
from collections import defaultdict

ROOT = Path(__file__).parent

# 템플릿별 할당량 (총 50건)
QUOTA = {
    "T01": 18,  # 지역×페르소나×modifier — 메인
    "T02": 5,   # 단일 학원
    "T03": 10,  # 가이드
    "T04": 3,   # 비교
    "T05": 7,   # 비용 절약
    "T06": 4,   # 시험 BEST5
    "T07": 3,   # 허브
}

rows_by_tpl = defaultdict(list)
with open(ROOT / "04_seed_matrix_full.csv", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        rows_by_tpl[row["template_id"]].append(row)

selected = []
for tpl, quota in QUOTA.items():
    pool = rows_by_tpl.get(tpl, [])
    # 이미 priority_score 내림차순 정렬됨 → 상위 quota개
    selected.extend(pool[:quota])

# T02, T04는 full에 없을 수 있음 (entity, keyword_pair는 placeholder)
# 부족한 만큼 다른 템플릿으로 채움
shortfall = 50 - len(selected)
if shortfall > 0:
    selected.extend(rows_by_tpl["T01"][18:18+shortfall])

# 우선순위 재정렬
selected.sort(key=lambda r: -float(r["priority_score"]))

# 발행일 재할당 (일 5건)
from datetime import date, timedelta
base = date.today() + timedelta(days=7)
for i, r in enumerate(selected):
    r["target_publish_date"] = (base + timedelta(days=i // 5)).isoformat()

out = ROOT / "04_seed_matrix_example.csv"
with open(out, "w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(selected[0].keys()))
    w.writeheader()
    w.writerows(selected)

print(f"균형 예시 {len(selected)}건 저장: {out.name}")
from collections import Counter
dist = Counter(r["template_id"] for r in selected)
for t, n in dist.most_common():
    print(f"  {t}: {n}")
