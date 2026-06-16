#!/usr/bin/env python3
"""Analyze article patterns from DrivingTeacher BEST-related posts."""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

try:
    from openpyxl import Workbook
except Exception:
    Workbook = None

SOURCE_DEFAULT = Path("data/drivingteacher_blog_posts.csv")
OUT_DIR_DEFAULT = Path("data/keyword_extract")
BEST_RE = re.compile(r"BEST\s*\d*|베스트", re.I)
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$", re.M)
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[[^\]]+\]\([^)]*\)")
TABLE_LINE_RE = re.compile(r"^\s*\|.+\|\s*$", re.M)
BULLET_RE = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.M)
QUOTE_RE = re.compile(r"^\s*>\s+", re.M)
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")
REGION_RE = re.compile(r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|(?!운전면|필기시|학과시)[가-힣]{1,6}(?:시|군|구|읍|면|동|역)(?=\s|$|[,.·!?:]))")
ACADEMY_RE = re.compile(r"[가-힣A-Za-z0-9]+(?:자동차운전전문학원|운전전문학원|운전면허학원|자동차학원|운전학원)")
CTA_RE = re.compile(r"예약|상담|문의|확인|비교|신청|다운로드|앱|바로|지금|추천|찾기|전화|수강료|비용")
INTENT_WORDS = ["추천", "비교", "비용", "가격", "수강료", "합격", "합격률", "후기", "셔틀", "단기", "최단기", "빠른", "초보", "필기", "학과시험", "도로주행", "시험장", "가이드", "총정리", "꿀팁"]


def is_best(row: dict[str, str]) -> bool:
    return bool(BEST_RE.search("\n".join(row.get(k, "") for k in ["templateLabel", "title", "metaTitle", "ogTitle"])))


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()


def normalize_pattern_text(text: str) -> str:
    p = clean(text)
    p = ACADEMY_RE.sub("{학원명}", p)
    protected = [
        ("운전면허학원", "§KW_SCHOOL§", "{운전면허학원}"),
        ("면허시험장", "§KW_TESTSITE§", "{면허시험장}"),
        ("운전면허", "§KW_LICENSE§", "{운전면허}"),
        ("운전학원", "§KW_DRIVING_SCHOOL§", "{운전학원}"),
        ("자동차학원", "§KW_CAR_SCHOOL§", "{자동차학원}"),
        ("필기시험", "§KW_WRITTEN§", "{필기시험}"),
        ("학과시험", "§KW_ACADEMIC§", "{학과시험}"),
        ("도로주행", "§KW_ROAD§", "{도로주행}"),
    ]
    for src, sentinel, _display in protected:
        p = p.replace(src, sentinel)
    p = REGION_RE.sub("{지역}", p)
    p = re.sub(r"\bBEST\s*\d+\b", "BEST{N}", p, flags=re.I)
    p = re.sub(r"\bTOP\s*\d+\b", "TOP{N}", p, flags=re.I)
    p = re.sub(r"\d+\s*곳", "{N}곳", p)
    p = re.sub(r"\d+", "{N}", p)
    for _src, sentinel, display in protected:
        p = p.replace(sentinel, display)
    p = re.sub(r"[!?~]+", "", p)
    return p

def title_pattern(title: str) -> str:
    return normalize_pattern_text(title)[:120]


def heading_pattern(markdown: str, max_h=8) -> tuple[str, list[str]]:
    hs = []
    for marks, text in HEADING_RE.findall(markdown or ""):
        level = len(marks)
        t = normalize_pattern_text(text)
        hs.append(f"H{level}:{t[:60]}")
    return " > ".join(hs[:max_h]), hs


def table_blocks(markdown: str) -> int:
    count = 0
    in_table = False
    for line in (markdown or "").splitlines():
        is_table = bool(re.match(r"^\s*\|.+\|\s*$", line))
        if is_table and not in_table:
            count += 1
        in_table = is_table
    return count


def classify_article(row: dict[str, str], htexts: list[str]) -> str:
    text = "\n".join([row.get("templateLabel", ""), row.get("title", ""), row.get("metaTitle", ""), " ".join(htexts)])
    if re.search(r"필기|학과시험|문제|어플|앱", text):
        return "exam_best"
    if re.search(r"비용|가격|수강료|최저|가성비", text):
        return "cost_comparison"
    if re.search(r"셔틀|역|동선|거리|주변", text):
        return "local_access"
    if re.search(r"후기|합격률|추천|BEST|비교", text, re.I):
        return "local_best_comparison"
    return "general_best"


def row_analysis(row: dict[str, str]) -> dict:
    md = row.get("markdown_full", "") or ""
    hp, hs = heading_pattern(md)
    htexts = [h.split(":", 1)[1] for h in hs]
    title = clean(row.get("title", ""))
    desc = clean(row.get("metaDescription", "") or row.get("ogDescription", ""))
    intents = [w for w in INTENT_WORDS if w in "\n".join([title, desc, row.get("metaKeywords", ""), row.get("hashTags", "")])]
    return {
        "id": row.get("id", ""),
        "templateLabel": row.get("templateLabel", ""),
        "article_type": classify_article(row, htexts),
        "title": title,
        "title_pattern": title_pattern(title),
        "heading_pattern": hp,
        "heading_count": len(hs),
        "image_count": len(IMAGE_RE.findall(md)),
        "table_count": table_blocks(md),
        "bullet_count": len(BULLET_RE.findall(md)),
        "quote_count": len(QUOTE_RE.findall(md)),
        "bold_count": len(BOLD_RE.findall(md)),
        "link_count": len(LINK_RE.findall(md)),
        "cta_term_count": len(CTA_RE.findall(md)),
        "intent_words": ", ".join(intents),
        "metaKeywords": row.get("metaKeywords", ""),
    }



def write_xlsx(path: Path, rows: list[dict], sheet="patterns") -> None:
    if Workbook is None or not rows:
        return
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(sheet[:31])
    headers = list(rows[0].keys())
    ws.append(headers)
    for r in rows:
        ws.append([r.get(h, "") for h in headers])
    wb.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, default=SOURCE_DEFAULT)
    ap.add_argument("--out-dir", type=Path, default=OUT_DIR_DEFAULT)
    ap.add_argument("--scope", choices=["best", "all"], default="best", help="analyze BEST-related rows or all rows")
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    scanned = best = 0
    with args.source.open(newline="", encoding="utf-8-sig", errors="replace") as f:
        for row in csv.DictReader(f):
            scanned += 1
            if args.scope == "best":
                if not is_best(row):
                    continue
                best += 1
            else:
                best += 1
            rows.append(row_analysis(row))

    title_patterns = Counter(r["title_pattern"] for r in rows)
    heading_patterns = Counter(r["heading_pattern"] for r in rows if r["heading_pattern"])
    type_counts = Counter(r["article_type"] for r in rows)
    template_counts = Counter(r["templateLabel"] for r in rows)
    metric_keys = ["heading_count", "image_count", "table_count", "bullet_count", "quote_count", "bold_count", "link_count", "cta_term_count"]
    averages = {k: round(sum(int(r[k]) for r in rows) / len(rows), 2) for k in metric_keys}

    pattern_rows = []
    for pattern, cnt in title_patterns.most_common(500):
        ex = next(r for r in rows if r["title_pattern"] == pattern)
        pattern_rows.append({"pattern_type": "title", "pattern": pattern, "count": cnt, "example_title": ex["title"], "article_type": ex["article_type"]})
    for pattern, cnt in heading_patterns.most_common(500):
        ex = next(r for r in rows if r["heading_pattern"] == pattern)
        pattern_rows.append({"pattern_type": "heading_flow", "pattern": pattern, "count": cnt, "example_title": ex["title"], "article_type": ex["article_type"]})

    filter_label = "templateLabel/title/metaTitle/ogTitle contains BEST or 베스트" if args.scope == "best" else "all rows"
    label = "best" if args.scope == "best" else "all"
    summary = {
        "source": str(args.source),
        "filter": filter_label,
        "rows_scanned": scanned,
        "best_related_rows": best,
        "article_type_counts": dict(type_counts.most_common()),
        "top_templates": dict(template_counts.most_common(50)),
        "average_structure_metrics": averages,
        "top_title_patterns": pattern_rows[:50],
        "top_heading_patterns": [r for r in pattern_rows if r["pattern_type"] == "heading_flow"][:50],
    }

    pattern_dir = args.out_dir / "article_patterns"
    summary_dir = args.out_dir / "summaries"
    docs_dir = args.out_dir / "docs"
    for directory in [pattern_dir, summary_dir, docs_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    detail_xlsx = pattern_dir / f"drivingteacher_{label}_article_pattern_rows.xlsx"
    pattern_xlsx = pattern_dir / f"drivingteacher_{label}_article_patterns.xlsx"
    summary_json = summary_dir / f"summary_{label}_article_patterns.json"
    readme = docs_dir / f"README_{label}_article_patterns.md"

    write_xlsx(detail_xlsx, rows, "article_rows")
    write_xlsx(pattern_xlsx, pattern_rows, "patterns")
    summary_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# " + ("BEST 관련글" if args.scope == "best" else "전체 글") + " 글 패턴 분석",
        "",
        f"- 원본: `{summary['source']}`",
        f"- 스캔 행: {scanned:,}",
        f"- 분석 행: {best:,}",
        f"- 필터: `{filter_label}`",
        "",
        "## 산출물",
        "",
        f"- 글별 구조: `data/keyword_extract/article_patterns/drivingteacher_{label}_article_pattern_rows.xlsx`",
        f"- 반복 패턴: `data/keyword_extract/article_patterns/drivingteacher_{label}_article_patterns.xlsx`",
        f"- 요약 JSON: `data/keyword_extract/summaries/summary_{label}_article_patterns.json`",
        "",
        "## 글 유형 분포",
        "",
        "| type | rows |",
        "|---|---:|",
    ]
    for k, v in type_counts.most_common():
        lines.append(f"| {k} | {v:,} |")
    lines += ["", "## 평균 구조 지표", "", "| metric | avg |", "|---|---:|"]
    for k, v in averages.items():
        lines.append(f"| {k} | {v} |")
    lines += ["", "## 상위 제목 패턴", "", "| pattern | count |", "|---|---:|"]
    for r in [x for x in pattern_rows if x["pattern_type"] == "title"][:50]:
        lines.append(f"| {r['pattern']} | {r['count']} |")
    readme.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({
        "detail_xlsx": str(detail_xlsx),
        "pattern_xlsx": str(pattern_xlsx),
        "summary_json": str(summary_json),
        "readme": str(readme),
        "rows_scanned": scanned,
        "best_related_rows": best,
        "pattern_rows": len(pattern_rows),
        "article_type_counts": summary["article_type_counts"],
        "average_structure_metrics": averages,
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
