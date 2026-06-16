#!/usr/bin/env python3
"""Extract SEO keywords from DrivingTeacher BEST-related blog posts.

This is a reproducible, dependency-light extractor for the original 20k+ CSV.
It filters rows whose template label is BEST/베스트 related, then scores keywords
from SEO fields, titles/descriptions, and lightweight markdown signals.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

try:
    from openpyxl import Workbook
except Exception:  # pragma: no cover - CSV output still works
    Workbook = None

SOURCE_DEFAULT = Path("data/drivingteacher_blog_posts.csv")
OUT_DIR_DEFAULT = Path("data/keyword_extract")
BRAND_RE = re.compile(r"운전\s*선생|driving\s*teacher", re.I)
BEST_RE = re.compile(r"BEST\s*\d*|베스트", re.I)
TOKEN_RE = re.compile(r"[가-힣A-Za-z0-9]+")
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
MARKDOWN_IMAGE_RE = re.compile(r"!?\[[^\]]*\]\([^)]*\)")
HTML_RE = re.compile(r"<[^>]+>")
MULTISPACE_RE = re.compile(r"\s+")

FIELDS = [
    "hashTags",
    "metaKeywords",
    "templateLabel",
    "title",
    "metaTitle",
    "ogTitle",
    "metaDescription",
    "ogDescription",
]
OUTPUT_FIELDS = FIELDS + ["markdown_full"]
FIELD_WEIGHTS = {
    "hashTags": 7.0,
    "metaKeywords": 6.6,
    "templateLabel": 1.0,
    "title": 6.2,
    "metaTitle": 5.4,
    "ogTitle": 5.2,
    "metaDescription": 2.5,
    "ogDescription": 2.3,
    "markdown_full": 0.55,
}
FIELD_ALIASES = {"markdown_full": "markdown"}

LOCAL_WORDS = (
    "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
    "특별시", "광역시", "특별자치", "도", "시", "군", "구", "읍", "면", "동", "역", "로", "길",
)
REGION_HINT_RE = re.compile(
    r"(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|[가-힣]{1,}(?:시|군|구|읍|면|동|역)(?=\s|$))"
)
CORE_RE = re.compile(r"운전\s*면허|운전면허|운전\s*학원|운전학원|자동차\s*학원|자동차학원|면허\s*학원|면허학원")
EXAM_RE = re.compile(r"필기|학과시험|기능시험|도로주행|면허시험|시험장|코스|감점|접수|문제|공부법|어플|앱")
LICENSE_RE = re.compile(r"1종|2종|대형|소형|보통|자동|수동|원동기")
INTENT_RE = re.compile(r"추천|비교|BEST|베스트|비용|가격|수강료|합격|합격률|후기|셔틀|단기|최단기|빠른|빠르게|가성비|저렴|절약|친절|준비물|총정리|팁|방법|가이드")
TEMPLATE_ARTIFACT_RE = re.compile(r"group\d+|템플릿|전용|BEST\s*\d*$|베스트\s*\d*$", re.I)

GENERIC_SINGLE_KEYWORDS = {
    "합격", "추천", "비교", "단기", "최단기", "빠른", "빠르게", "셔틀", "비용", "가격", "수강료", "합격률", "후기", "가이드", "꿀팁", "팁", "문제", "필기", "총정리", "선택", "분석", "전략", "방법", "비법", "접수", "코스"
}

STOPWORDS = {
    "및", "그리고", "또는", "으로", "에서", "에게", "까지", "부터", "하는", "있는", "없는", "하면", "해서", "위해", "위한", "관련", "정보", "소개", "오늘", "이번", "바로", "정말", "가능", "확인", "있습니다", "합니다", "입니다", "됩니다", "합니다", "때문", "경우", "기준", "선택", "완벽", "분석",
    "BEST", "best", "Best", "BEST5", "TOP", "top", "곳", "개", "명", "년", "월", "일", "원", "만원", "대", "약", "등", "더", "수", "것", "그", "이", "저", "첫", "한", "중", "내", "외", "전", "후", "각", "별", "총", "꼭", "왜", "좀",
}
NOISE_SUBSTRINGS = (
    "firebasestorage", "googleapis", "appspot", "http", "www", "utm", "token", "media", "alt", "png", "jpg", "jpeg", "webp", "svg",
    "drivingteacher", "블로그", "본문", "마무리", "결론", "FAQ", "faq", "Table", "image", "출처",
)

@dataclass
class KeywordStat:
    keyword: str
    rows: set[str] = field(default_factory=set)
    total_mentions: int = 0
    weighted_mentions: float = 0.0
    field_counts: Counter = field(default_factory=Counter)
    examples: list[str] = field(default_factory=list)

    def add(self, row_id: str, field_name: str, count: int, weight: float) -> None:
        if count <= 0:
            return
        self.rows.add(row_id)
        self.total_mentions += count
        self.weighted_mentions += count * weight
        self.field_counts[field_name] += count
        if row_id and row_id not in self.examples and len(self.examples) < 3:
            self.examples.append(row_id)


def clean_text(value: str) -> str:
    text = str(value or "")
    text = URL_RE.sub(" ", text)
    text = MARKDOWN_IMAGE_RE.sub(" ", text)
    text = HTML_RE.sub(" ", text)
    text = BRAND_RE.sub(" ", text)
    text = text.replace("&nbsp;", " ").replace("·", " ").replace("ㆍ", " ")
    text = re.sub(r"[`*_~>|\[\](){}]", " ", text)
    text = MULTISPACE_RE.sub(" ", text).strip()
    return text


def normalize_keyword(value: str) -> str:
    kw = clean_text(value)
    kw = kw.strip(" #,.;:!?/\\|+-_=\"'“”‘’()[]{}")
    kw = re.sub(r"\bBEST\s*(\d+)\b", r"BEST\1", kw, flags=re.I)
    kw = re.sub(r"운전\s+면허", "운전면허", kw)
    kw = re.sub(r"자동차\s+운전\s+전문\s+학원", "자동차운전전문학원", kw)
    kw = re.sub(r"운전\s+전문\s+학원", "운전전문학원", kw)
    kw = re.sub(r"\s+", " ", kw).strip()
    # Remove common Korean case/topic particles from the last token to reduce prose fragments.
    parts = kw.split()
    if parts:
        parts[-1] = re.sub(r"(을|를|으로|로|에서|에게|과|와)$", "", parts[-1])
        kw = " ".join(part for part in parts if part).strip()
    return kw


def split_explicit(value: str) -> Iterable[str]:
    text = clean_text(value)
    for part in re.split(r"[,#|/\n\r\t]+", text):
        kw = normalize_keyword(part)
        if kw:
            yield kw


def tokens(text: str) -> list[str]:
    out = []
    for tok in TOKEN_RE.findall(clean_text(text)):
        tok = tok.strip()
        if not tok:
            continue
        if tok.lower() in {"https", "http", "www"}:
            continue
        # Preserve BEST as a signal but do not let it dominate usable outputs.
        out.append(tok)
    return out


def ngrams_from_text(text: str, min_n: int = 1, max_n: int = 5) -> Iterable[str]:
    toks = tokens(text)
    if not toks:
        return
    nmax = min(max_n, len(toks))
    for n in range(min_n, nmax + 1):
        for i in range(0, len(toks) - n + 1):
            gram = " ".join(toks[i : i + n])
            kw = normalize_keyword(gram)
            if kw:
                yield kw


def markdown_signal_text(value: str, max_lines: int = 80) -> str:
    """Use headings/bold/list/table cells from markdown to avoid body-noise explosion."""
    lines: list[str] = []
    for raw in str(value or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#") or line.startswith("-") or line.startswith("|") or "**" in line:
            # Drop table separator rows and very long prose/list blocks.
            if re.fullmatch(r"[|:\-\s]+", line):
                continue
            lines.append(line[:180])
            if len(lines) >= max_lines:
                break
    return "\n".join(lines)


def is_valid_keyword(kw: str, *, clean: bool = False) -> bool:
    if not kw:
        return False
    if BRAND_RE.search(kw):
        return False
    if len(kw) < 2 or len(kw) > 48:
        return False
    if any(s.lower() in kw.lower() for s in NOISE_SUBSTRINGS):
        return False
    if re.search(r"[{}<>]|={2,}|_{2,}", kw):
        return False
    if re.fullmatch(r"[0-9A-Za-z]+", kw) and not re.search(r"1종|2종|BEST\d*", kw, re.I):
        return False
    compact = kw.replace(" ", "")
    if compact in STOPWORDS or compact in GENERIC_SINGLE_KEYWORDS:
        return False
    parts = kw.split()
    if all(part in STOPWORDS for part in parts):
        return False
    # Avoid generic prose fragments unless they contain a concrete SEO anchor.
    has_anchor = bool(CORE_RE.search(kw) or EXAM_RE.search(kw) or LICENSE_RE.search(kw) or REGION_HINT_RE.search(kw) or INTENT_RE.search(kw))
    if not has_anchor:
        return False
    if re.search(r"(하는|하여|하려면|한다면|있다면|있나요|됩니다|입니다|합니다)$", kw):
        return False
    if clean:
        if TEMPLATE_ARTIFACT_RE.search(kw) and not CORE_RE.search(kw) and not EXAM_RE.search(kw):
            return False
        if BEST_RE.search(kw) or re.search(r"\bTOP\b|TOP\d+", kw, re.I):
            return False
        # Pure region labels are useful for grouping but weak as standalone keywords.
        if REGION_HINT_RE.fullmatch(kw) and not (CORE_RE.search(kw) or EXAM_RE.search(kw) or LICENSE_RE.search(kw) or INTENT_RE.search(kw)):
            return False
    return True


def category_for(kw: str) -> str:
    if TEMPLATE_ARTIFACT_RE.search(kw) and not CORE_RE.search(kw) and not EXAM_RE.search(kw):
        return "template_artifact"
    if REGION_HINT_RE.search(kw) and (CORE_RE.search(kw) or re.search(r"학원|시험장|셔틀|비용|가격|추천|비교", kw)):
        return "local"
    if EXAM_RE.search(kw):
        return "exam"
    if LICENSE_RE.search(kw):
        return "license_type"
    if INTENT_RE.search(kw):
        return "intent_modifier"
    if CORE_RE.search(kw):
        return "core"
    if REGION_HINT_RE.search(kw):
        return "local_region"
    return "other"


def score_stat(stat: KeywordStat) -> float:
    row_count = len(stat.rows)
    diversity = sum(1 for c in stat.field_counts.values() if c > 0)
    category = category_for(stat.keyword)
    category_boost = {
        "local": 1.28,
        "exam": 1.18,
        "license_type": 1.10,
        "intent_modifier": 1.16,
        "core": 1.08,
        "local_region": 0.58,
        "template_artifact": 0.35,
        "other": 0.7,
    }.get(category, 1.0)
    length_boost = 1.0 + min(len(stat.keyword.replace(" ", "")), 18) * 0.012
    row_boost = math.log1p(row_count) * 2.0
    return round((stat.weighted_mentions + row_boost + diversity * 1.7) * category_boost * length_boost, 4)


def row_is_best_related(row: dict[str, str]) -> bool:
    # Main intended filter: templates such as "서울 BEST5", "필기시험BEST5".
    # Title/meta fallback catches rows whose template label is blank but title is clearly BEST/베스트 themed.
    template = row.get("templateLabel", "")
    title_meta = "\n".join(row.get(k, "") for k in ["title", "metaTitle", "ogTitle"])
    return bool(BEST_RE.search(template) or BEST_RE.search(title_meta))


def candidate_counts_for_field(field_name: str, value: str) -> Counter[str]:
    c: Counter[str] = Counter()
    if not value:
        return c

    if field_name in {"hashTags", "metaKeywords"}:
        for kw in split_explicit(value):
            c[kw] += 3
            # Also mine useful shorter combinations inside explicit keyword phrases.
            for gram in ngrams_from_text(kw, 1, 4):
                c[gram] += 1
    elif field_name == "templateLabel":
        clean = BEST_RE.sub(" ", str(value or ""))
        clean = re.sub(r"group\d+|전용템플릿\d*", " ", clean, flags=re.I)
        for kw in ngrams_from_text(clean, 1, 3):
            c[kw] += 1
        # Keep original template in all output for traceability, scored low/filtered from clean.
        original = normalize_keyword(value)
        if original:
            c[original] += 1
    elif field_name in {"title", "metaTitle", "ogTitle"}:
        for kw in ngrams_from_text(value, 1, 5):
            c[kw] += 1
    elif field_name in {"metaDescription", "ogDescription"}:
        for kw in ngrams_from_text(value, 2, 4):
            c[kw] += 1
    elif field_name == "markdown_full":
        signal = markdown_signal_text(value)
        for kw in ngrams_from_text(signal, 2, 5):
            c[kw] += 1
    return c


def extract(source: Path) -> tuple[list[dict], dict]:
    stats: dict[str, KeywordStat] = {}
    rows_scanned = 0
    best_rows = 0
    template_counts: Counter[str] = Counter()

    with source.open(newline="", encoding="utf-8-sig", errors="replace") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows_scanned += 1
            if not row_is_best_related(row):
                continue
            best_rows += 1
            row_id = row.get("id") or str(rows_scanned)
            template_counts[row.get("templateLabel", "")] += 1
            for field_name in FIELDS:
                field_value = row.get(field_name, "")
                counts = candidate_counts_for_field(field_name, field_value)
                weight = FIELD_WEIGHTS[field_name]
                alias = FIELD_ALIASES.get(field_name, field_name)
                for kw, count in counts.items():
                    kw = normalize_keyword(kw)
                    if not is_valid_keyword(kw):
                        continue
                    stat = stats.setdefault(kw, KeywordStat(keyword=kw))
                    stat.add(row_id, alias, count, weight)

    records = []
    for stat in stats.values():
        category = category_for(stat.keyword)
        records.append(
            {
                "keyword": stat.keyword,
                "category": category,
                "score": score_stat(stat),
                "row_count": len(stat.rows),
                "total_mentions": stat.total_mentions,
                **{f"{FIELD_ALIASES.get(f, f)}_count": stat.field_counts.get(FIELD_ALIASES.get(f, f), 0) for f in OUTPUT_FIELDS},
                "example_ids": "|".join(stat.examples),
            }
        )
    records.sort(key=lambda r: (-float(r["score"]), -int(r["row_count"]), str(r["keyword"])))

    summary = {
        "source": str(source),
        "filter": "templateLabel/title/metaTitle/ogTitle contains BEST or 베스트",
        "rows_scanned": rows_scanned,
        "best_related_rows": best_rows,
        "unique_keywords": len(records),
        "top_templates": dict(template_counts.most_common(50)),
    }
    return records, summary



def write_xlsx(path: Path, rows: list[dict], sheet_name: str = "keywords") -> None:
    if Workbook is None or not rows:
        return
    wb = Workbook(write_only=True)
    ws = wb.create_sheet(sheet_name[:31])
    headers = list(rows[0].keys())
    ws.append(headers)
    for row in rows:
        ws.append([row.get(h, "") for h in headers])
    wb.save(path)


def write_readme(path: Path, summary: dict, top_rows: list[dict]) -> None:
    lines = [
        "# DrivingTeacher BEST 관련글 키워드 추출 결과",
        "",
        f"- 원본: `{summary['source']}`",
        f"- 필터: `{summary['filter']}`",
        f"- 스캔 행: {summary['rows_scanned']:,}",
        f"- BEST 관련글 행: {summary['best_related_rows']:,}",
        f"- 전체 유니크 키워드: {summary['unique_keywords']:,}",
        "- 제거 규칙: `운전선생` 브랜드명 제거, URL/이미지/템플릿 노이즈 제거, 단독 일반어 제거",
        "",
        "## 파일",
        "",
        "- 전체: `data/keyword_extract/keywords/drivingteacher_keywords_best_all.xlsx`",
        "- Top 10000: `data/keyword_extract/keywords/drivingteacher_keywords_best_top10000.xlsx`",
        "- 추천 정제본: `data/keyword_extract/keywords/drivingteacher_keywords_best_recommended_clean.xlsx`",
        "- 추천 JSON: `data/keyword_extract/keywords/drivingteacher_keywords_best_recommended_clean.json`",
        "- 요약: `data/keyword_extract/summaries/summary_best.json`",
        "",
        "## Top 100",
        "",
        "| keyword | category | score | rows |",
        "|---|---:|---:|---:|",
    ]
    for row in top_rows[:100]:
        lines.append(f"| {row['keyword']} | {row['category']} | {row['score']} | {row['row_count']} |")
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract keywords from BEST-related DrivingTeacher blog posts")
    parser.add_argument("--source", type=Path, default=SOURCE_DEFAULT)
    parser.add_argument("--out-dir", type=Path, default=OUT_DIR_DEFAULT)
    parser.add_argument("--top", type=int, default=10000)
    parser.add_argument("--recommended", type=int, default=10000)
    parser.add_argument("--include-markdown", action="store_true", help="also mine markdown headings/lists; slower and noisier")
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    global FIELDS
    if args.include_markdown and "markdown_full" not in FIELDS:
        FIELDS = FIELDS + ["markdown_full"]
    records, summary = extract(args.source)
    top = records[: args.top]
    clean = [r for r in records if is_valid_keyword(str(r["keyword"]), clean=True) and r["category"] not in {"template_artifact", "local_region", "other"}]
    clean = clean[: args.recommended]
    summary.update(
        {
            "top_rows": len(top),
            "recommended_clean_rows": len(clean),
            "top100": records[:100],
        }
    )

    keyword_dir = args.out_dir / "keywords"
    summary_dir = args.out_dir / "summaries"
    docs_dir = args.out_dir / "docs"
    for directory in [keyword_dir, summary_dir, docs_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    outputs = {
        "all_xlsx": keyword_dir / "drivingteacher_keywords_best_all.xlsx",
        "top_xlsx": keyword_dir / "drivingteacher_keywords_best_top10000.xlsx",
        "clean_xlsx": keyword_dir / "drivingteacher_keywords_best_recommended_clean.xlsx",
        "clean_json": keyword_dir / "drivingteacher_keywords_best_recommended_clean.json",
        "summary": summary_dir / "summary_best.json",
        "readme": docs_dir / "README_best.md",
    }
    write_xlsx(outputs["all_xlsx"], records, "best_all")
    write_xlsx(outputs["top_xlsx"], top, "best_top10000")
    write_xlsx(outputs["clean_xlsx"], clean, "best_recommended")
    outputs["clean_json"].write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    outputs["summary"].write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    write_readme(outputs["readme"], summary, clean)

    print(json.dumps({k: str(v) for k, v in outputs.items()} | {
        "rows_scanned": summary["rows_scanned"],
        "best_related_rows": summary["best_related_rows"],
        "unique_keywords": summary["unique_keywords"],
        "recommended_clean_rows": summary["recommended_clean_rows"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
