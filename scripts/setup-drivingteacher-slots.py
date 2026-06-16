#!/usr/bin/env python3
"""Reset driving SEO axes/slots from the original DrivingTeacher blog export.

This script intentionally keeps published posts untouched and replaces only
non-published slot queue rows. It converts each original blog row into one
planned source-shaped slot so generation follows the original corpus
distribution instead of a synthetic cartesian product.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


TEMPLATE_IDS = ["T01", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10", "T11", "T12", "T13", "T14", "T15"]

TEMPLATE_INTENT = {
    "T01": "지역BEST비교",
    "T03": "가이드총정리",
    "T04": "면허종류비교",
    "T05": "비용시간절약",
    "T06": "시험단계집중",
    "T07": "지역허브",
    "T08": "필기시험접수",
    "T09": "필기시험팁",
    "T10": "필기시험앱추천",
    "T11": "운전면허시험장",
    "T12": "취득총정리",
    "T13": "타겟맞춤",
    "T14": "전문학원소개",
    "T15": "지역시험혼합",
}

PERSONA_PATTERNS = [
    ("대학생", r"대학생|대학\s*생|캠퍼스"),
    ("직장인", r"직장인|출퇴근|퇴근|회사원"),
    ("사회초년생", r"사회초년생|첫\s*면허|처음"),
    ("초보운전자", r"초보|초보운전|입문"),
    ("주부", r"주부|엄마|학부모"),
    ("고등학생", r"고등학생|수능|수험생"),
    ("시니어", r"시니어|노년|중장년|장년"),
]

MODIFIER_PATTERNS = [
    ("BEST", r"BEST|TOP|추천|베스트"),
    ("가격비교", r"가격|비용|수강료|가성비"),
    ("최단기", r"최단기|단기|빠른|3일|속성"),
    ("셔틀편리", r"셔틀|통학|픽업|동선"),
    ("합격후기", r"합격|후기|리뷰|만족"),
    ("시험팁", r"필기|기능|도로주행|시험|접수"),
    ("준비물", r"준비물|신체검사|사진|신분증"),
    ("1종2종", r"1종|2종|대형|자동|수동"),
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/admin.db")
    parser.add_argument("--source", default="data/drivingteacher_blog_posts.csv")
    parser.add_argument("--tenant", default="drivingplus.me")
    parser.add_argument("--summary", default="data/drivingteacher_slot_setup_summary.json")
    parser.add_argument("--keep-published", action="store_true", default=True)
    parser.add_argument("--nationwide", action="store_true", default=True, help="Add coverage slots for every region in seo_regions.")
    parser.add_argument("--coverage-per-region", type=int, default=8, help="Minimum planned regional slots to add per seo_regions region.")
    args = parser.parse_args()

    rows = read_rows(Path(args.source))
    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    canonical_regions = load_canonical_regions(con, args.tenant)
    region_aliases = build_region_aliases(canonical_regions)

    source_slots = []
    template_counts: Counter[str] = Counter()
    template_label_counts: Counter[str] = Counter()
    region_counts: Counter[str] = Counter()
    keyword_counts: Counter[str] = Counter()
    persona_counts: Counter[str] = Counter()
    modifier_counts: Counter[str] = Counter()

    for idx, row in enumerate(rows):
        tid = classify_template(row)
        text = searchable_text(row)
        region = match_region(text, region_aliases)
        persona = detect_first(text, PERSONA_PATTERNS)
        modifiers = detect_many(text, MODIFIER_PATTERNS, 2)
        primary_keyword = choose_primary_keyword(row, tid, region)

        template_counts[tid] += 1
        template_label_counts[(row.get("templateLabel") or "(blank)").strip() or "(blank)"] += 1
        if region:
            region_counts[region] += 1
        for kw in split_keywords(row.get("metaKeywords", ""))[:5]:
            keyword_counts[kw] += 1
        if primary_keyword:
            keyword_counts[primary_keyword] += 3
        if persona:
            persona_counts[persona] += 1
        for modifier in modifiers:
            modifier_counts[modifier] += 1

        priority = priority_score(tid, idx, bool(region), bool(primary_keyword))
        source_slots.append({
            "slot_id": slot_id(row, tid),
            "tenant": args.tenant,
            "template_id": tid,
            "primary_keyword": primary_keyword,
            "region": region,
            "persona": persona,
            "intent": TEMPLATE_INTENT[tid],
            "modifier_1": modifiers[0] if len(modifiers) > 0 else None,
            "modifier_2": modifiers[1] if len(modifiers) > 1 else None,
            "entity_id": row.get("id") or None,
            "priority_score": priority,
        })

    if args.nationwide:
        add_nationwide_coverage_slots(
            slots=source_slots,
            tenant=args.tenant,
            regions=canonical_regions,
            existing_region_counts=region_counts,
            per_region=max(1, args.coverage_per_region),
        )
        for region in canonical_regions:
            region_counts.setdefault(region, 1)

    apply_to_db(
        con=con,
        tenant=args.tenant,
        slots=source_slots,
        region_counts=region_counts,
        keyword_counts=keyword_counts,
        persona_counts=persona_counts,
        modifier_counts=modifier_counts,
    )

    summary = {
        "tenant": args.tenant,
        "source": args.source,
        "source_rows": len(rows),
        "inserted_slots": len(source_slots),
        "template_counts": dict(template_counts.most_common()),
        "top_template_labels": dict(template_label_counts.most_common(50)),
        "axis_counts": {
            "region": len(region_counts),
            "keyword": min(len(keyword_counts), 1200),
            "intent": len(TEMPLATE_INTENT),
            "persona": len(persona_counts) or len(PERSONA_PATTERNS),
            "modifier": len(modifier_counts) or len(MODIFIER_PATTERNS),
        },
        "nationwide": {
            "enabled": args.nationwide,
            "canonical_regions": len(canonical_regions),
            "coverage_per_region": args.coverage_per_region,
        },
        "top_regions": dict(region_counts.most_common(50)),
        "top_keywords": dict(keyword_counts.most_common(50)),
        "slot_counts": count_slots(con, args.tenant),
    }
    Path(args.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def searchable_text(row: dict[str, str]) -> str:
    keys = ["templateLabel", "title", "metaTitle", "metaDescription", "metaKeywords", "hashTags", "ogTitle", "ogDescription"]
    return " ".join(str(row.get(k) or "") for k in keys)


def classify_template(row: dict[str, str]) -> str:
    label = (row.get("templateLabel") or "").strip()
    s = f"{label} {searchable_text(row)}"
    if re.search(r"필기시험.*어플|필기시험.*앱|어플 추천", s):
        return "T10"
    if re.search(r"필기시험.*접수|필기시험접수|접수.*필기시험", s):
        return "T08"
    if re.search(r"필기시험|필기시험BEST|필기시험 팁", s):
        return "T09"
    if "시험장" in s:
        return "T11"
    if re.search(r"면허설명|면허.*비교|1종|2종|대형", label):
        return "T04"
    if re.search(r"특정시험단계|기능시험|도로주행|장내기능", label):
        return "T06"
    if re.search(r"취득총정리|취득 총정리", s):
        return "T12"
    if re.search(r"특정타겟|타겟|대학생|직장인|주부|고등학생|사회초년생|초보|시니어|노년", label):
        return "T13"
    if re.search(r"전용템플릿|단독", label) or "/academy/" in (row.get("ctaHref") or ""):
        return "T14"
    if re.search(r"BEST\s*5|BEST5|BEST\s*\d|TOP|추천\s*\d*곳|\d+곳|학원", s):
        return "T01"
    if re.search(r"비용|가격|절약|수강료", s):
        return "T05"
    if re.search(r"1종|2종|대형|면허.*비교|종류", s):
        return "T04"
    return "T03"


def choose_primary_keyword(row: dict[str, str], template_id: str, region: str | None) -> str:
    keywords = split_keywords(row.get("metaKeywords", ""))
    title = clean_keyword(row.get("title") or "")
    short_region = short_region_name(region) if region else ""

    if template_id == "T08":
        return "운전면허 필기시험 접수"
    if template_id == "T09":
        return first_matching(keywords, r"필기시험") or "운전면허 필기시험 팁"
    if template_id == "T10":
        return first_matching(keywords, r"어플|앱") or "운전면허 필기시험 어플"
    if template_id == "T11":
        return f"{short_region} 운전면허시험장".strip() if short_region else "운전면허시험장"
    if template_id == "T01":
        local = first_matching(keywords, r"운전면허학원|자동차학원|운전학원")
        return normalize_keyword_spacing(local or f"{short_region} 운전면허학원".strip() or title[:35])
    if template_id == "T14":
        return normalize_keyword_spacing(keywords[0] if keywords else title[:35])
    if template_id == "T04":
        return first_matching(keywords, r"1종|2종|대형|면허") or "운전면허 종류 비교"
    if template_id == "T05":
        return first_matching(keywords, r"비용|가격|수강료|절약") or "운전면허 비용"
    if template_id == "T06":
        return first_matching(keywords, r"필기|기능|도로주행|시험") or "운전면허 시험"
    if template_id == "T12":
        return first_matching(keywords, r"취득|준비|총정리|운전면허") or "운전면허 취득 총정리"
    if template_id == "T13":
        return normalize_keyword_spacing(keywords[0] if keywords else title[:35])
    return normalize_keyword_spacing(keywords[0] if keywords else title[:35] or "운전면허")


def split_keywords(value: str) -> list[str]:
    out = []
    seen = set()
    for raw in re.split(r"[,#|/·\n]+", value or ""):
        kw = clean_keyword(raw)
        if not kw or "운전선생" in kw or len(kw) > 40 or kw in seen:
            continue
        seen.add(kw)
        out.append(kw)
    return out


def clean_keyword(value: str) -> str:
    return normalize_keyword_spacing(re.sub(r"\s+", " ", str(value or "").strip(" #,|/")))


def normalize_keyword_spacing(value: str) -> str:
    value = re.sub(r"([가-힣]+(?:시|군|구|읍|면|동))(운전면허|자동차학원|운전학원)", r"\1 \2", value)
    value = re.sub(r"(운전면허)(학원|시험장|필기시험|비용|준비물)", r"\1 \2", value)
    return re.sub(r"\s+", " ", value).strip()


def first_matching(keywords: list[str], pattern: str) -> str | None:
    rx = re.compile(pattern)
    return next((kw for kw in keywords if rx.search(kw)), None)


def detect_first(text: str, patterns: list[tuple[str, str]]) -> str | None:
    for label, pattern in patterns:
        if re.search(pattern, text):
            return label
    return None


def detect_many(text: str, patterns: list[tuple[str, str]], limit: int) -> list[str]:
    out = []
    for label, pattern in patterns:
        if re.search(pattern, text):
            out.append(label)
            if len(out) >= limit:
                break
    return out


def load_canonical_regions(con: sqlite3.Connection, tenant: str) -> list[str]:
    rows = [r[0] for r in con.execute(
        "SELECT region FROM seo_regions WHERE tenant=? AND level=2 ORDER BY region", [tenant]
    )]
    if rows:
        return rows
    return [r[0] for r in con.execute(
        "SELECT region FROM academies WHERE tenant=? AND region IS NOT NULL GROUP BY region ORDER BY COUNT(*) DESC, region", [tenant]
    )]


def build_region_aliases(regions: list[str]) -> list[tuple[str, str]]:
    alias_candidates: defaultdict[str, set[str]] = defaultdict(set)
    for region in regions:
        tokens = region.split()
        aliases = {region}
        if len(tokens) >= 2:
            province_short = short_admin_token(tokens[0])
            aliases.add(" ".join(tokens[1:]))
            aliases.add(f"{province_short} {' '.join(tokens[1:])}".strip())
            aliases.add(tokens[1].replace("시", "").replace("군", ""))
        if len(tokens) >= 3:
            aliases.add(" ".join(tokens[1:3]))
            aliases.add(f"{tokens[1].replace('시', '').replace('군', '')} {tokens[2]}")
            aliases.add(tokens[2])
        for alias in aliases:
            alias = alias.strip()
            if len(alias) < 2:
                continue
            alias_candidates[alias].add(region)
    alias_to_region: dict[str, str] = {}
    for alias, candidates in alias_candidates.items():
        # Ambiguous one-token district names such as 남구/동구/중구 exist in many cities.
        # Skip them unless the alias uniquely identifies one canonical region.
        if len(candidates) == 1:
            alias_to_region[alias] = next(iter(candidates))
    return sorted(alias_to_region.items(), key=lambda item: len(item[0]), reverse=True)


def short_admin_token(token: str) -> str:
    return (
        token.replace("특별자치도", "")
        .replace("특별자치시", "")
        .replace("특별시", "")
        .replace("광역시", "")
        .replace("특별자치", "")
        .replace("도", "")
        .strip()
    )


def match_region(text: str, aliases: list[tuple[str, str]]) -> str | None:
    squashed = re.sub(r"\s+", "", text)
    for alias, region in aliases:
        if alias in text or alias.replace(" ", "") in squashed:
            return region
    return None


def short_region_name(region: str | None) -> str:
    if not region:
        return ""
    tokens = region.split()
    if len(tokens) >= 3:
        return " ".join(tokens[1:3])
    if len(tokens) >= 2:
        return tokens[1]
    return region


def priority_score(template_id: str, index: int, has_region: bool, has_keyword: bool) -> float:
    template_weight = {
        "T01": 1.0, "T14": 0.96, "T09": 0.94, "T11": 0.93, "T08": 0.92,
        "T04": 0.90, "T12": 0.89, "T13": 0.88, "T10": 0.87, "T06": 0.86,
        "T05": 0.84, "T03": 0.80, "T07": 0.82, "T15": 0.85,
    }.get(template_id, 0.8)
    recency = max(0, 1 - index / 25000)
    completeness = (0.05 if has_region else 0) + (0.03 if has_keyword else 0)
    return round((template_weight * 0.72 + recency * 0.20 + completeness) * 100, 2)


def add_nationwide_coverage_slots(
    slots: list[dict[str, object]],
    tenant: str,
    regions: list[str],
    existing_region_counts: Counter[str],
    per_region: int,
) -> None:
    """Ensure every seo_regions entry has regional generation opportunities.

    Original blog rows preserve corpus distribution. These supplemental slots
    guarantee coverage for regions that did not exist in the source export.
    """

    regional_templates = [
        ("T01", "운전면허학원", "지역BEST비교", "BEST", "가격비교"),
        ("T07", "운전면허", "지역허브", "가이드총정리", None),
        ("T11", "운전면허시험장", "운전면허시험장", "시험팁", "준비물"),
        ("T15", "운전면허 필기시험", "지역시험혼합", "시험팁", "준비물"),
        ("T01", "자동차학원", "지역BEST비교", "BEST", "셔틀편리"),
        ("T05", "운전면허 비용", "비용시간절약", "가격비교", None),
        ("T12", "운전면허 취득", "취득총정리", "시험팁", None),
        ("T13", "운전면허학원", "타겟맞춤", "BEST", "합격후기"),
    ]
    for region in regions:
        existing = existing_region_counts.get(region, 0)
        needed = max(0, per_region - existing)
        for index in range(needed):
            template_id, keyword, intent, modifier_1, modifier_2 = regional_templates[index % len(regional_templates)]
            primary = f"{short_region_name(region)} {keyword}".strip()
            sid = f"NW_{template_id}_{hashlib.sha1(f'{region}|{template_id}|{keyword}|{index}'.encode('utf-8')).hexdigest()[:12]}"
            slots.append({
                "slot_id": sid,
                "tenant": tenant,
                "template_id": template_id,
                "primary_keyword": normalize_keyword_spacing(primary),
                "region": region,
                "persona": None,
                "intent": intent,
                "modifier_1": modifier_1,
                "modifier_2": modifier_2,
                "entity_id": f"nationwide:{region}:{index + 1}",
                "priority_score": round(76 - min(index, 7) * 0.3, 2),
            })
        if needed:
            existing_region_counts[region] += needed


def slot_id(row: dict[str, str], template_id: str) -> str:
    source_id = row.get("id") or row.get("url") or row.get("title") or json.dumps(row, ensure_ascii=False)
    digest = hashlib.sha1(str(source_id).encode("utf-8")).hexdigest()[:12]
    return f"DT_{template_id}_{digest}"


def axis_rows(counter: Counter[str], limit: int, fallback: list[str] = None) -> list[tuple[str, int, int | None, int | None]]:
    items = counter.most_common(limit)
    if not items and fallback:
        items = [(v, 1) for v in fallback]
    max_count = max((count for _, count in items), default=1)
    rows = []
    for value, count in items:
        weight = max(3, min(10, round(3 + 7 * count / max_count)))
        monthly = max(100, min(20000, int(count * 25)))
        rows.append((value, weight, monthly, None))
    return rows


def apply_to_db(
    con: sqlite3.Connection,
    tenant: str,
    slots: list[dict[str, object]],
    region_counts: Counter[str],
    keyword_counts: Counter[str],
    persona_counts: Counter[str],
    modifier_counts: Counter[str],
) -> None:
    cur = con.cursor()
    cur.execute("UPDATE tenants SET templates_enabled=? WHERE domain=?", [json.dumps(TEMPLATE_IDS, ensure_ascii=False), tenant])

    axes = {
        "region": axis_rows(region_counts, 300),
        "keyword": axis_rows(keyword_counts, 1200),
        "intent": [(label, 8, None, None) for label in TEMPLATE_INTENT.values()],
        "persona": axis_rows(persona_counts, 20, [p[0] for p in PERSONA_PATTERNS]),
        "modifier": axis_rows(modifier_counts, 30, [m[0] for m in MODIFIER_PATTERNS]),
    }
    for axis, rows in axes.items():
        cur.execute("DELETE FROM axes WHERE tenant=? AND axis=?", [tenant, axis])
        cur.executemany(
            "INSERT INTO axes (tenant, axis, value, weight, monthly_search_volume, competition_kd) VALUES (?, ?, ?, ?, ?, ?)",
            [(tenant, axis, value, weight, monthly, kd) for value, weight, monthly, kd in rows],
        )

    cur.execute("DELETE FROM slots WHERE tenant=? AND status!='published'", [tenant])
    cur.executemany(
        """
        INSERT INTO slots (
          slot_id, tenant, template_id, primary_keyword, region, persona, intent,
          modifier_1, modifier_2, entity_id, priority_score, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned')
        ON CONFLICT(slot_id) DO UPDATE SET
          primary_keyword=excluded.primary_keyword,
          region=excluded.region,
          persona=excluded.persona,
          intent=excluded.intent,
          modifier_1=excluded.modifier_1,
          modifier_2=excluded.modifier_2,
          entity_id=excluded.entity_id,
          priority_score=excluded.priority_score
        """,
        [
            (
                s["slot_id"], s["tenant"], s["template_id"], s["primary_keyword"], s["region"],
                s["persona"], s["intent"], s["modifier_1"], s["modifier_2"], s["entity_id"], s["priority_score"],
            )
            for s in slots
        ],
    )
    con.commit()


def count_slots(con: sqlite3.Connection, tenant: str) -> dict[str, int]:
    return {
        f"{r['template_id']}:{r['status']}": r["n"]
        for r in con.execute(
            "SELECT template_id, status, COUNT(*) AS n FROM slots WHERE tenant=? GROUP BY template_id, status ORDER BY template_id, status",
            [tenant],
        )
    }


if __name__ == "__main__":
    main()
