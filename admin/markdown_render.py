"""markdown → HTML 변환 (글 미리보기용)."""

from __future__ import annotations

import markdown as md_lib


def render(text: str) -> str:
    return md_lib.markdown(
        text,
        extensions=["extra", "tables", "fenced_code", "sane_lists", "nl2br"],
        output_format="html5",
    )
