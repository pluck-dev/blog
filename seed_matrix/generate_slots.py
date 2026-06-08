"""
시드 매트릭스 슬롯 자동 생성기.

입력:
  - 01_axes.csv (축 정의)
  - 02_template_axis_mapping.csv (템플릿별 사용 축)

출력:
  - 04_seed_matrix_generated.csv (자동 생성된 슬롯)

사용:
  python generate_slots.py [--limit N] [--template T01,T03] [--min-volume 500]
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import itertools
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).parent

def load_axes() -> dict[str, list[dict]]:
    axes = defaultdict(list)
    with open(ROOT / "01_axes.csv", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            axes[row["axis"]].append(row)
    return dict(axes)

def load_template_mapping() -> list[dict]:
    with open(ROOT / "02_template_axis_mapping.csv", encoding="utf-8") as f:
        return list(csv.DictReader(f))

def slot_id(template_id: str, *parts: str) -> str:
    h = hashlib.sha1(("|".join(parts)).encode("utf-8")).hexdigest()[:8]
    return f"{template_id}_{h}"

def calc_priority(sv: int, kd: int, template_weight: float) -> float:
    """검색량과 경쟁도, 템플릿 가중치로 우선순위 점수 계산."""
    # 검색량 로그 스케일, 경쟁도 역수
    import math
    sv_score = math.log10(max(sv, 1) + 1) / 4.5   # 0~1 정규화 (검색량 30000 ≈ 1.0)
    kd_score = max(0, (100 - kd) / 100)           # 경쟁도 낮을수록 높은 점수
    return round((sv_score * 0.6 + kd_score * 0.4) * template_weight * 100, 2)

def render_title_seed(template_id: str, vars: dict) -> str:
    """제목 생성 시 LLM에 줄 시드 문구 (운전선생 패턴 차용)."""
    r = vars.get("region", "")
    k = vars.get("keyword", "")
    p = vars.get("persona", "")
    m1 = vars.get("modifier_1", "")
    m2 = vars.get("modifier_2", "")

    if template_id == "T01":
        # 지역 BEST5
        parts = [f"{r}운전면허학원 BEST 5"]
        if p and p != "일반": parts.append(f"{p} 추천")
        if m1: parts.append(m1)
        return ": ".join(parts)
    elif template_id == "T03":
        # 가이드형
        return f"{k} 완벽 가이드 ({p} 기준)" if p and p != "일반" else f"{k} 완벽 가이드"
    elif template_id == "T05":
        # 비용 절약
        return f"{k} 비용 절약 전략 BEST 7" + (f" ({p})" if p and p != "일반" else "")
    elif template_id == "T06":
        # 시험 BEST5
        return f"{k} 합격 핵심 BEST 5 — 가장 많이 출제되는 유형"
    elif template_id == "T07":
        # 허브
        intent = vars.get("intent", "")
        return f"{r} 운전면허 {intent} 종합 가이드"
    else:
        return f"{r} {k} {p}".strip()

def primary_keyword_for_slot(template_id: str, vars: dict) -> str:
    r = vars.get("region", "")
    k = vars.get("keyword", "")
    if template_id in ("T01", "T07"):
        return f"{r}운전면허학원"
    if template_id == "T03":
        return k
    if template_id == "T05":
        return f"{k} 비용 절약"
    if template_id == "T06":
        return k
    return k or r

KEYWORD_PAIR_BASELINE_VOLUME = {
    "1종보통_vs_2종보통": 5400,
    "1종보통_vs_1종대형": 1200,
    "수동_vs_자동": 3200,
}

def estimate_volume(vars: dict, axes: dict) -> int:
    """축 값들의 monthly_search_volume 평균. 없으면 0."""
    vols = []
    for axis_name in ["region", "keyword"]:
        v = vars.get(axis_name)
        if not v: continue
        for row in axes.get(axis_name, []):
            if row["value"] == v and row.get("monthly_search_volume"):
                try: vols.append(int(row["monthly_search_volume"]))
                except ValueError: pass
    # keyword_pair fallback
    kp = vars.get("keyword_pair")
    if kp:
        vols.append(KEYWORD_PAIR_BASELINE_VOLUME.get(kp, 2000))
    return int(sum(vols) / len(vols)) if vols else 0

def estimate_kd(vars: dict, axes: dict) -> int:
    """축 값들의 competition_kd 평균."""
    kds = []
    for axis_name in ["region", "keyword"]:
        v = vars.get(axis_name)
        if not v: continue
        for row in axes.get(axis_name, []):
            if row["value"] == v and row.get("competition_kd"):
                try: kds.append(int(row["competition_kd"]))
                except ValueError: pass
    return int(sum(kds) / len(kds)) if kds else 50

def expand_template(tpl: dict, axes: dict) -> list[dict]:
    """한 템플릿에 해당하는 슬롯 후보를 cartesian product로 생성."""
    primary = tpl["primary_axes"].split("|") if tpl["primary_axes"] else []
    secondary = tpl["secondary_axes"].split("|") if tpl["secondary_axes"] else []
    modifier_count = int(tpl["modifier_count"] or 0)

    # 각 축의 value 목록
    pools = {}
    for ax in primary + secondary:
        if ax == "entity":
            # entity는 별도 디렉토리 (지금은 스킵, T02만 해당)
            pools[ax] = ["{ENTITY_PLACEHOLDER}"]
        elif ax == "keyword_pair":
            # T04용. 일단 hardcoded pair만 (1종 vs 2종 등)
            pools[ax] = ["1종보통_vs_2종보통", "1종보통_vs_1종대형", "수동_vs_자동"]
        else:
            pools[ax] = [r["value"] for r in axes.get(ax, [])]

    # modifier_count 만큼 modifier 풀에서 조합
    modifier_pool = [r["value"] for r in axes.get("modifier", [])]

    slots = []
    main_axes = primary + secondary
    main_values = [pools[a] for a in main_axes]

    for combo in itertools.product(*main_values):
        vars = dict(zip(main_axes, combo))

        if modifier_count == 0:
            slots.append(vars)
        elif modifier_count == 1:
            for m in modifier_pool:
                slots.append({**vars, "modifier_1": m})
        else:
            for m1, m2 in itertools.combinations(modifier_pool, modifier_count):
                slots.append({**vars, "modifier_1": m1, "modifier_2": m2})

    return slots

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="최대 슬롯 수")
    parser.add_argument("--template", type=str, default=None, help="특정 템플릿만 (콤마구분: T01,T03)")
    parser.add_argument("--min-volume", type=int, default=0, help="최소 검색량 필터")
    parser.add_argument("--min-priority", type=float, default=0, help="최소 우선순위 점수")
    parser.add_argument("--output", type=str, default="04_seed_matrix_generated.csv")
    args = parser.parse_args()

    axes = load_axes()
    templates = load_template_mapping()

    if args.template:
        wanted = set(args.template.split(","))
        templates = [t for t in templates if t["template_id"] in wanted]

    base_publish = date.today() + timedelta(days=7)

    out_rows = []
    for tpl in templates:
        tw = float(tpl["priority_weight"] or 1.0)
        min_v_for_tpl = int(tpl["min_search_volume"] or 0)
        cand = expand_template(tpl, axes)

        for v in cand:
            sv = estimate_volume(v, axes)
            if sv < max(min_v_for_tpl, args.min_volume):
                continue

            kd = estimate_kd(v, axes)
            prio = calc_priority(sv, kd, tw)
            if prio < args.min_priority:
                continue

            sid = slot_id(tpl["template_id"], *(v.get(k, "") for k in
                ["region","keyword","persona","intent","modifier_1","modifier_2","entity"]))

            out_rows.append({
                "slot_id": sid,
                "template_id": tpl["template_id"],
                "primary_keyword": primary_keyword_for_slot(tpl["template_id"], v),
                "secondary_keywords": "",
                "region": v.get("region", ""),
                "intent": v.get("intent", ""),
                "persona": v.get("persona", ""),
                "modifier_1": v.get("modifier_1", ""),
                "modifier_2": v.get("modifier_2", ""),
                "entity_id": v.get("entity", ""),
                "estimated_search_volume": sv,
                "competition_kd": kd,
                "priority_score": prio,
                "status": "planned",
                "target_publish_date": "",
                "assigned_to": "",
                "internal_link_targets": "",
                "title_pattern_seed": render_title_seed(tpl["template_id"], v),
                "seo_objective": f"검색 노출 / 클러스터: {tpl['template_id']}",
                "notes": "",
            })

    # 우선순위 내림차순 정렬
    out_rows.sort(key=lambda r: -r["priority_score"])

    if args.limit:
        out_rows = out_rows[:args.limit]

    # 발행 일정 자동 분배 (일 30건씩)
    daily_cap = 30
    for i, row in enumerate(out_rows):
        row["target_publish_date"] = (base_publish + timedelta(days=i // daily_cap)).isoformat()

    out_path = ROOT / args.output
    fieldnames = list(out_rows[0].keys()) if out_rows else []
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(out_rows)

    # 요약
    from collections import Counter
    tpl_dist = Counter(r["template_id"] for r in out_rows)
    print(f"생성된 슬롯: {len(out_rows)}건 → {out_path.name}")
    print(f"\n템플릿별 분포:")
    for t, n in tpl_dist.most_common():
        print(f"  {t}: {n}")
    if out_rows:
        avg_sv = sum(r["estimated_search_volume"] for r in out_rows) / len(out_rows)
        avg_kd = sum(r["competition_kd"] for r in out_rows) / len(out_rows)
        avg_pr = sum(r["priority_score"] for r in out_rows) / len(out_rows)
        print(f"\n평균 지표:")
        print(f"  검색량: {avg_sv:.0f}")
        print(f"  경쟁도: {avg_kd:.1f}")
        print(f"  우선순위 점수: {avg_pr:.2f}")
        print(f"\n예상 발행 기간: {out_rows[0]['target_publish_date']} ~ {out_rows[-1]['target_publish_date']}")

if __name__ == "__main__":
    main()
