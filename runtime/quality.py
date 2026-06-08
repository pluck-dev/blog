"""Generated post quality gates for publish-ready SEO articles."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass

# 발행 주체 브랜드. 환경변수로 교체 가능. 기본값은 데스크탑 앱과 동일.
BRAND = os.environ.get("SEO_BRAND_NAME", "운전면허플러스")
# 절대 본문에 노출되면 안 되는 경쟁사명.
COMPETITORS = ["운전선생"]


# 운전선생 실측 기준으로 하향 조정 (실제 양산글 본문 ~2,500~2,800자).
# 기존 3,200~6,500자는 실제보다 과도하게 길어 늘어지는 글을 유발했음.
MIN_TEXT_CHARS = 2300
MAX_TEXT_CHARS = 3600
MIN_H2 = 4
MAX_H2 = 8
MIN_IMAGE_SLOTS = 3

AI_CLICHES = [
    "이 글에서는",
    "오늘은 알아보겠습니다",
    "본격적으로 알아보",
    "도움이 되셨",
    "유용한 정보",
]


@dataclass(frozen=True)
class QualityReport:
    ok: bool
    issues: list[str]
    text_chars: int
    h2_count: int
    image_slot_count: int
    table_slot_count: int

    def summary(self) -> str:
        if self.ok:
            return (
                f"quality ok: text={self.text_chars}, h2={self.h2_count}, "
                f"images={self.image_slot_count}, tables={self.table_slot_count}"
            )
        return "; ".join(self.issues)


def strip_markdown(markdown_text: str) -> str:
    text = re.sub(r"\[(TABLE|IMAGE)_SLOT:[^\]]+\]", "", markdown_text)
    text = re.sub(r"\[INTERNAL_LINK:[^\]]+\]", "", text)
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
    text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.M)
    text = re.sub(r"[*_`>|-]", "", text)
    return re.sub(r"\s+", "", text)


def validate_post(markdown_text: str, require_sources: bool = False, brand_name: str | None = None) -> QualityReport:
    brand = (brand_name or BRAND).strip()
    text_chars = len(strip_markdown(markdown_text))
    h1_count = len(re.findall(r"^# [^#]", markdown_text, re.M))
    h2_count = len(re.findall(r"^## [^#]", markdown_text, re.M))
    image_slot_count = len(re.findall(r"\[IMAGE_SLOT:[^\]]+\]", markdown_text))
    image_md_count = len(re.findall(r"!\[[^\]]*\]\([^)]+\)", markdown_text))
    total_images = image_slot_count + image_md_count
    table_slot_count = len(re.findall(r"\[TABLE_SLOT:[^\]]+\]", markdown_text))
    table_md_count = len(re.findall(r"^\|.+\|\s*$", markdown_text, re.M))
    blockquote_count = len(re.findall(r"^>\s+", markdown_text, re.M))
    bullet_count = len(re.findall(r"^\s*[-*]\s+", markdown_text, re.M))
    internal_link_count = len(re.findall(r"\[INTERNAL_LINK:[^\]]+\]", markdown_text))

    issues: list[str] = []
    if h1_count != 1:
        issues.append(f"H1 must be exactly 1, got {h1_count}")
    if text_chars < MIN_TEXT_CHARS:
        issues.append(f"text too short: {text_chars} chars, minimum {MIN_TEXT_CHARS}")
    if text_chars > MAX_TEXT_CHARS:
        issues.append(f"text too long: {text_chars} chars, maximum {MAX_TEXT_CHARS}")
    if h2_count < MIN_H2 or h2_count > MAX_H2:
        issues.append(f"H2 count must be {MIN_H2}-{MAX_H2}, got {h2_count}")
    if total_images < MIN_IMAGE_SLOTS:
        issues.append(f"image slots/images must be at least {MIN_IMAGE_SLOTS}, got {total_images}")
    if table_slot_count + table_md_count < 1:
        issues.append("missing table slot or markdown table")
    if blockquote_count < 1:
        issues.append("missing blockquote review/example")
    if bullet_count < 1:
        issues.append("missing checklist or bullet list")
    if internal_link_count < 1:
        issues.append("missing INTERNAL_LINK placeholder")
    if brand and brand not in markdown_text:
        issues.append(f"missing {brand} CTA mention")
    for competitor in COMPETITORS:
        if competitor != brand and competitor in markdown_text:
            issues.append(f"경쟁사명 노출 금지: '{competitor}' 이(가) 본문에 포함됨")

    clichés = [phrase for phrase in AI_CLICHES if phrase in markdown_text]
    if clichés:
        issues.append(f"AI cliché phrases found: {', '.join(clichés)}")

    if require_sources:
        has_reference_section = bool(re.search(r"^##\s*참고\s*자료", markdown_text, re.M))
        citation_count = len(re.findall(r"\[\d+\]", markdown_text))
        if not has_reference_section:
            issues.append("웹자료를 사용했으나 '## 참고자료' 섹션이 없음")
        if citation_count < 1:
            issues.append("본문에 출처 번호([1] 등) 인용이 1개도 없음")
    fake_attr = re.search(r"출처\s*[:：]\s*(운전선생|" + re.escape(brand) + r")", markdown_text)
    if fake_attr:
        issues.append(f"근거 없는 가짜 출처 꼬리표('출처: {fake_attr.group(1)}') 사용")

    return QualityReport(
        ok=not issues,
        issues=issues,
        text_chars=text_chars,
        h2_count=h2_count,
        image_slot_count=total_images,
        table_slot_count=table_slot_count + table_md_count,
    )


def retry_prompt(original_prompt: str, report: QualityReport, require_sources: bool = False) -> str:
    source_rule = (
        "제공된 자료에서 가져온 수치·가격·후기는 문장 끝에 [1] 형식 출처 번호를 달고, "
        "글 끝에 '## 참고자료' 섹션으로 인용한 출처(제목 — URL)를 나열하세요. "
        "근거 없는 수치는 '상담 시 확인'으로 바꾸고 가짜 출처 꼬리표는 쓰지 마세요.\n"
        if require_sources
        else ""
    )
    return (
        f"{original_prompt}\n\n"
        "위 조건으로 다시 작성하세요. 이전 출력은 발행 품질 기준을 통과하지 못했습니다.\n"
        f"미달 항목: {report.summary()}\n"
        "반드시 본문 공백 제외 2,300~3,600자, H2 4개 이상, 이미지 슬롯 3개 이상, "
        f"표 슬롯 1개 이상, 후기 인용 1개, 체크리스트 1개, {BRAND} CTA와 INTERNAL_LINK를 포함하세요.\n"
        f"브랜드명은 반드시 {BRAND}만 사용하고, 경쟁사명 '운전선생'은 절대 쓰지 마세요.\n"
        f"{source_rule}"
        "마크다운 본문만 출력하세요."
    )
