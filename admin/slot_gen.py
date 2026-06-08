"""테넌트의 축 값으로 슬롯을 생성.

seed_matrix/generate_slots.py 의 핵심 로직을 단순화 — DB 의 axes 테이블에서 읽어
slots 테이블에 적재.

priority_score = log10(SV+1)/4.5 × 0.6 + (100-KD)/100 × 0.4 → 0~100 정규화
template 매핑은 02_template_axis_mapping.csv 와 동일한 의미.
"""

from __future__ import annotations

import hashlib
import itertools
import json
import math
import random
from . import db

# 템플릿 정의 (PROMPT_LIBRARY.md + seed_matrix 의 mapping 와 동일)
TEMPLATES = {
    "T01": {"name": "지역 BEST5", "primary": ["region"], "use_persona": True,
            "modifier_count": 2, "weight": 1.0, "min_sv": 500},
    "T03": {"name": "가이드 총정리", "primary": ["keyword"], "use_persona": True,
            "modifier_count": 1, "weight": 0.9, "min_sv": 800},
    "T04": {"name": "옵션 비교", "primary": ["keyword"], "use_persona": True,
            "modifier_count": 0, "weight": 0.7, "min_sv": 400},
    "T05": {"name": "비용 절약 전략", "primary": ["keyword"], "use_persona": True,
            "modifier_count": 1, "weight": 0.95, "min_sv": 600},
    "T06": {"name": "시험/리스크 BEST5", "primary": ["keyword"], "use_persona": False,
            "modifier_count": 0, "weight": 0.85, "min_sv": 1000, "with_intent": True},
    "T07": {"name": "허브", "primary": ["region"], "use_persona": False,
            "modifier_count": 0, "weight": 1.2, "min_sv": 1500, "with_intent": True},
}


def _slot_id(template_id: str, parts: tuple[str, ...]) -> str:
    h = hashlib.sha1("|".join((template_id, *parts)).encode("utf-8")).hexdigest()[:8]
    return f"{template_id}_{h}"


def _priority(sv: int | None, kd: int | None, tpl_weight: float) -> float:
    sv = sv or 0
    kd = kd if kd is not None else 50
    sv_norm = math.log10(sv + 1) / 4.5
    kd_norm = (100 - kd) / 100
    raw = (sv_norm * 0.6 + kd_norm * 0.4) * tpl_weight * 100
    return round(min(max(raw, 0.0), 100.0), 2)


def _avg(values: list[int | None]) -> int | None:
    nums = [v for v in values if v is not None]
    if not nums:
        return None
    return int(sum(nums) / len(nums))


def generate_slots_for_tenant(
    tenant: str,
    *,
    templates: list[str] | None = None,
    max_per_template: int = 200,
    seed: int | None = None,
) -> dict:
    """테넌트의 축으로 슬롯 카르테시안 곱 생성 → DB 적재.

    반환: {template_id: 적재 개수}
    """
    t = db.get_tenant(tenant)
    if t is None:
        raise ValueError(f"unknown tenant: {tenant}")
    axes_map = db.list_axes(tenant)

    enabled = templates or json.loads(t.get("templates_enabled") or "[]")
    if not enabled:
        enabled = list(TEMPLATES.keys())

    rng = random.Random(seed)
    summary: dict[str, int] = {}
    all_rows: list[dict] = []

    for tid in enabled:
        spec = TEMPLATES.get(tid)
        if spec is None:
            continue

        primary_axis = spec["primary"][0]
        primary_values = axes_map.get(primary_axis, [])
        if not primary_values:
            summary[tid] = 0
            continue

        persona_values = axes_map.get("persona", []) if spec["use_persona"] else [{"value": None}]
        if not persona_values:
            persona_values = [{"value": None}]

        intent_values = axes_map.get("intent", []) if spec.get("with_intent") else [{"value": None}]
        if not intent_values:
            intent_values = [{"value": None}]

        modifier_values = axes_map.get("modifier", [])
        mod_count = spec["modifier_count"]
        if mod_count == 0:
            modifier_combos = [(None, None)]
        elif mod_count == 1:
            modifier_combos = [(m["value"], None) for m in modifier_values] or [(None, None)]
        else:  # 2
            if len(modifier_values) < 2:
                modifier_combos = [(modifier_values[0]["value"] if modifier_values else None, None)]
            else:
                # 모든 페어 (순서 무관)
                modifier_combos = list(itertools.combinations(
                    [m["value"] for m in modifier_values], 2))

        count_for_tpl = 0
        for pv in primary_values:
            keyword_axis = "keyword" if primary_axis == "region" else primary_axis
            # T01/T07 처럼 primary 가 region 이면 keyword 도 필요
            if tid in ("T01", "T07"):
                keyword_pool = axes_map.get("keyword") or []
                if not keyword_pool:
                    continue
                kw_row = keyword_pool[0]  # 가장 weight 높은 키워드
                primary_keyword = f"{pv['value']}{kw_row['value']}"
            else:
                primary_keyword = pv["value"]

            for persona_row in persona_values:
                for intent_row in intent_values:
                    for mod_pair in modifier_combos:
                        m1, m2 = mod_pair
                        parts = (
                            pv["value"] or "",
                            persona_row["value"] or "",
                            intent_row["value"] or "",
                            m1 or "", m2 or "",
                        )
                        sid = _slot_id(tid, parts)

                        sv = _avg([pv.get("monthly_search_volume")])
                        kd = _avg([pv.get("competition_kd")])
                        if sv is not None and sv < spec["min_sv"]:
                            continue
                        score = _priority(sv, kd, spec["weight"])

                        all_rows.append({
                            "slot_id": sid,
                            "tenant": tenant,
                            "template_id": tid,
                            "primary_keyword": primary_keyword,
                            "region": pv["value"] if primary_axis == "region" else None,
                            "persona": persona_row["value"],
                            "intent": intent_row["value"],
                            "modifier_1": m1,
                            "modifier_2": m2,
                            "entity_id": None,
                            "priority_score": score,
                        })
                        count_for_tpl += 1
                        if count_for_tpl >= max_per_template:
                            break
                    if count_for_tpl >= max_per_template:
                        break
                if count_for_tpl >= max_per_template:
                    break
            if count_for_tpl >= max_per_template:
                break

        summary[tid] = count_for_tpl

    # 우선순위 내림차순 정렬
    all_rows.sort(key=lambda r: -(r["priority_score"] or 0))

    inserted = db.bulk_upsert_slots(all_rows)
    summary["_inserted_total"] = inserted
    return summary
