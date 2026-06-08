"""발행 페이지 렌더 — 운전선생 스타일 HTML 생성.

`generate.py` 가 만든 마크다운(placeholder 포함) 을 독자용 발행 페이지로 변환한다.

  output/{slot}.md   (placeholder 포함 본문)
  output/{slot}.json (메타: slot, provider, model ...)
        │
        ▼  runtime.publish
  output/{slot}.html (SEO 메타 head + 운전선생 디자인 셸)

운전선생 실측 디자인 재현:
  * Pretendard 폰트, 본문 720px 컨테이너, 카드형 레이아웃
  * 브랜드 옐로우(#FFE94D) 포인트 + 연노랑 강조(#FFFDCC) + 텍스트 #181818
  * ⭐ POINT 강점 카드, 후기 blockquote 카드, 해시태그 칩
  * 하단 CTA 3종 + 지역 검색폼 + 운전선생 푸터(입점·제휴 문의)

placeholder 치환:
  [IMAGE_SLOT: x]    → <figure> 이미지(매핑 없으면 플레이스홀더 박스)
  [INTERNAL_LINK: k] → <a> 내부링크 (매핑 없으면 #)
  [TABLE_SLOT: x]    → 제거 (실제 표는 본문 마크다운에 LLM 이 생성)

외부 의존성: markdown (admin 과 공유). 없으면 경량 fallback 변환기 사용.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path

# 발행 주체 브랜드. 환경변수로 교체 가능. 경쟁사 '운전선생'은 발행물에 노출 금지.
BRAND = os.environ.get("SEO_BRAND_NAME", "운전면허플러스")

RUNTIME_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RUNTIME_DIR.parent
OUTPUT_DIR = PROJECT_DIR / "output"

# 운전선생 실측 디자인 토큰
BRAND_YELLOW = "#FFE94D"
BRAND_YELLOW_SOFT = "#FFFDCC"
INK = "#181818"
GRAY = "#8A8C88"
LINE = "#ECECEC"


# ---------- 메타 ----------

@dataclass(slots=True)
class PageMeta:
    title: str
    description: str
    keywords: list[str]
    hashtags: list[str]
    og_image: str
    url: str


def _extract_meta(markdown_text: str, slot_meta: dict, slot_id: str) -> PageMeta:
    # H1 → title
    m_h1 = re.search(r"^#\s+(.+)$", markdown_text, re.M)
    title = m_h1.group(1).strip() if m_h1 else slot_id

    # 첫 일반 문단 → description (헤딩/슬롯/표 제외)
    description = ""
    for line in markdown_text.splitlines():
        s = line.strip()
        if not s or s.startswith(("#", ">", "|", "-", "*", "[", "!")):
            continue
        description = re.sub(r"[#*_`>]", "", s)[:155]
        break

    # 본문 끝 해시태그 라인
    hashtags: list[str] = []
    for line in reversed(markdown_text.splitlines()):
        if line.strip().startswith("#") and " #" in line:
            hashtags = re.findall(r"#([^\s#]+)", line)
            break

    slot = slot_meta.get("slot", {}) if slot_meta else {}
    kw_seed = [slot.get("primary_keyword", ""), slot.get("region", "")]
    keywords = [k for k in kw_seed if k] + hashtags[:3]

    return PageMeta(
        title=title,
        description=description or title,
        keywords=[k for k in keywords if k],
        hashtags=hashtags,
        og_image=slot_meta.get("og_image", "") if slot_meta else "",
        url=f"/blog/{slot_id}",
    )


# ---------- placeholder 치환 ----------

def _replace_placeholders(markdown_text: str, images: dict[str, str],
                          internal_links: dict[str, str]) -> str:
    def img_repl(m: re.Match) -> str:
        key = m.group(1).strip()
        url = images.get(key, "")
        if url:
            return (f'\n<figure class="post-img">'
                    f'<img src="{html.escape(url)}" alt="{html.escape(key)} 사진" loading="lazy">'
                    f"</figure>\n")
        # 매핑 없으면 운전선생 톤 플레이스홀더 박스
        label = {"hero": "대표 이미지", "exterior": "학원 외관",
                 "interior": "내부/코스", "shuttle": "셔틀버스"}.get(key, key)
        return (f'\n<figure class="post-img post-img--placeholder">'
                f'<span>🖼 {html.escape(label)}</span></figure>\n')

    text = re.sub(r"\[IMAGE_SLOT:\s*([^\]]+?)\s*\]", img_repl, markdown_text)

    def link_repl(m: re.Match) -> str:
        key = m.group(1).strip()
        href = internal_links.get(key, "#")
        label = key.replace("_", " ")
        return f"[{label}]({href})"

    text = re.sub(r"\[INTERNAL_LINK:\s*([^\]]+?)\s*\]", link_repl, text)
    # 한글 변형(혹시 모를 LLM 일탈)도 흡수
    text = re.sub(r"\[내부\s*링크:\s*([^\]]+?)\s*\]",
                  lambda m: f"[{m.group(1).strip()}](#)", text)
    # 표는 본문 마크다운에 실제로 들어오므로 placeholder 자체는 제거
    text = re.sub(r"\[TABLE_SLOT:\s*[^\]]+?\s*\]\s*", "", text)
    return text


def _strip_trailing_hashtags(markdown_text: str) -> str:
    """해시태그 라인은 별도 칩으로 렌더하므로 본문 끝에서 제거."""
    lines = markdown_text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and lines[-1].strip().startswith("#") and " #" in lines[-1]:
        lines.pop()
    return "\n".join(lines)


# ---------- markdown → HTML ----------

def _md_to_html(markdown_text: str) -> str:
    try:
        import markdown as md_lib
        body = md_lib.markdown(
            markdown_text,
            extensions=["extra", "tables", "sane_lists", "nl2br"],
            output_format="html5",
        )
    except ImportError:
        body = _fallback_md(markdown_text)
    return _decorate_points(body)


def _decorate_points(body_html: str) -> str:
    """'⭐ POINT n: ...' 문단을 강점 카드로 변환."""
    def repl(m: re.Match) -> str:
        inner = m.group(1)
        items = re.split(r"<br\s*/?>", inner)
        cards = []
        for it in items:
            it = it.strip()
            if not it:
                continue
            cards.append(f'<li class="point">{it}</li>')
        return f'<ul class="point-list">{"".join(cards)}</ul>' if cards else m.group(0)

    return re.sub(r"<p>((?:\s*⭐[^<]*(?:<br\s*/?>|))+)</p>", repl, body_html)


def _fallback_md(text: str) -> str:
    """markdown 라이브러리 부재 시 최소 변환 (h1~3, p, blockquote, li)."""
    out: list[str] = []
    for raw in text.splitlines():
        s = raw.rstrip()
        if not s:
            continue
        if s.startswith("### "):
            out.append(f"<h3>{html.escape(s[4:])}</h3>")
        elif s.startswith("## "):
            out.append(f"<h2>{html.escape(s[3:])}</h2>")
        elif s.startswith("# "):
            out.append(f"<h1>{html.escape(s[2:])}</h1>")
        elif s.startswith("> "):
            out.append(f"<blockquote>{html.escape(s[2:])}</blockquote>")
        elif s.lstrip().startswith(("- ", "* ")):
            out.append(f"<li>{html.escape(s.lstrip()[2:])}</li>")
        elif s.startswith("<"):
            out.append(s)
        else:
            out.append(f"<p>{html.escape(s)}</p>")
    return "\n".join(out)


# ---------- HTML 셸 ----------

def _page_css() -> str:
    return f"""
:root {{
  --yellow: {BRAND_YELLOW}; --yellow-soft: {BRAND_YELLOW_SOFT};
  --ink: {INK}; --gray: {GRAY}; --line: {LINE};
}}
* {{ box-sizing: border-box; }}
body {{
  margin: 0; color: var(--ink); background: #fff;
  font-family: Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
  -webkit-font-smoothing: antialiased; line-height: 1.7;
}}
.wrap {{ max-width: 720px; margin: 0 auto; padding: 24px 20px 80px; }}
.post h1 {{ font-size: 1.7rem; font-weight: 800; line-height: 1.35; margin: 8px 0 20px; }}
.post h2 {{ font-size: 1.25rem; font-weight: 700; margin: 2em 0 0.6em;
  padding-bottom: 0.4em; border-bottom: 2px solid var(--yellow); }}
.post h3 {{ font-size: 1.08rem; font-weight: 700; margin: 1.4em 0 0.5em; }}
.post p {{ margin: 0.8em 0; font-size: 1rem; }}
.post a {{ color: #1b6fd6; text-decoration: none; }}
.post a:hover {{ text-decoration: underline; }}
.post ul {{ padding-left: 1.3em; margin: 0.8em 0; }}
.post li {{ margin: 0.35em 0; }}
.post table {{ width: 100%; border-collapse: collapse; margin: 1.2em 0; font-size: 0.94rem; }}
.post th, .post td {{ border: 1px solid var(--line); padding: 0.7em 0.6em; text-align: left; }}
.post th {{ background: var(--yellow-soft); font-weight: 700; }}
.post blockquote {{
  margin: 1.2em 0; padding: 16px 18px; background: #FAFAF7;
  border-left: 4px solid var(--yellow); border-radius: 8px;
  color: #333; font-style: normal;
}}
.post .post-img {{
  margin: 1.4em 0; border-radius: 12px; overflow: hidden;
}}
.post .post-img img {{ width: 100%; display: block; }}
.post .post-img--placeholder {{
  display: flex; align-items: center; justify-content: center;
  height: 220px; background: var(--yellow-soft); color: var(--gray);
  font-size: 0.95rem; border: 1px dashed #E2DFA8;
}}
.post .point-list {{ list-style: none; padding: 0; margin: 1em 0; }}
.post .point-list .point {{
  background: var(--yellow-soft); border-radius: 10px;
  padding: 12px 14px; margin: 8px 0; font-weight: 600; font-size: 0.97rem;
}}
.hashtags {{ margin: 28px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }}
.hashtags a {{
  font-size: 0.85rem; color: #555; background: #F4F4F2;
  padding: 6px 12px; border-radius: 999px; text-decoration: none;
}}
.cta-band {{ margin-top: 40px; display: grid; gap: 12px; }}
.cta {{
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px; border-radius: 14px; background: var(--ink); color: #fff;
  font-weight: 700; text-decoration: none;
}}
.cta--primary {{ background: var(--yellow); color: var(--ink); }}
.cta small {{ display: block; font-weight: 500; font-size: 0.8rem; opacity: 0.75; margin-top: 2px; }}
.cta .arrow {{ font-size: 1.3rem; }}
.locator {{
  margin-top: 28px; padding: 20px; border: 1px solid var(--line);
  border-radius: 14px; background: #FCFCFA;
}}
.locator h3 {{ margin: 0 0 12px; font-size: 1.05rem; }}
.locator .selects {{ display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }}
.locator select {{
  width: 100%; padding: 10px; border: 1px solid var(--line);
  border-radius: 8px; font-size: 0.9rem; background: #fff;
}}
.locator button {{
  margin-top: 12px; width: 100%; padding: 13px; border: 0;
  border-radius: 10px; background: var(--yellow); color: var(--ink);
  font-weight: 800; font-size: 1rem; cursor: pointer;
}}
.site-footer {{
  margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line);
  color: var(--gray); font-size: 0.85rem; text-align: center;
}}
.site-footer .logo {{ font-weight: 800; color: var(--ink); font-size: 1rem; }}
.site-footer a {{ color: var(--gray); }}
"""


def _cta_band(region: str) -> str:
    near = f"{region} 내 근처" if region else "내 근처"
    return f"""
<div class="cta-band">
  <a class="cta cta--primary" href="#reserve">
    <span>지금 바로 최저가로 예약<small>{html.escape(BRAND)} 앱에서 실시간 비교</small></span>
    <span class="arrow">→</span>
  </a>
  <a class="cta" href="#cheaper">
    <span>더 저렴하게!<small>제휴 할인·기간한정 프로모션 확인</small></span>
    <span class="arrow">→</span>
  </a>
  <a class="cta" href="#locator">
    <span>{html.escape(near)} 학원 찾기<small>위치·셔틀·수강료 한눈에</small></span>
    <span class="arrow">→</span>
  </a>
</div>
"""


def _locator() -> str:
    return """
<section class="locator" id="locator">
  <h3>내 근처 운전면허학원 찾기</h3>
  <div class="selects">
    <select aria-label="시/도"><option>시·도</option></select>
    <select aria-label="시/군/구"><option>시·군·구</option></select>
    <select aria-label="동/읍/면"><option>동·읍·면·리</option></select>
  </div>
  <button type="button">학원 검색</button>
</section>
"""


def _footer() -> str:
    return f"""
<footer class="site-footer">
  <div class="logo">{html.escape(BRAND)}</div>
  <p>전국 운전면허학원 실시간 비교·예약 플랫폼</p>
  <p><a href="#partner">입점 및 제휴 문의</a></p>
</footer>
"""


def _hashtags_html(tags: list[str]) -> str:
    if not tags:
        return ""
    chips = "".join(f'<a href="#tag">#{html.escape(t)}</a>' for t in tags)
    return f'<div class="hashtags">{chips}</div>'


def _schema_org(meta: PageMeta) -> str:
    data = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": meta.title,
        "description": meta.description,
        "keywords": ", ".join(meta.keywords),
        "mainEntityOfPage": {"@type": "WebPage", "@id": meta.url},
        "publisher": {"@type": "Organization", "name": BRAND},
    }
    if meta.og_image:
        data["image"] = meta.og_image
    return json.dumps(data, ensure_ascii=False, indent=2)


def render_html(markdown_text: str, slot_meta: dict, slot_id: str, *,
                images: dict[str, str] | None = None,
                internal_links: dict[str, str] | None = None) -> str:
    meta = _extract_meta(markdown_text, slot_meta, slot_id)
    region = (slot_meta.get("slot", {}) or {}).get("region", "") if slot_meta else ""

    body_md = _strip_trailing_hashtags(markdown_text)
    body_md = _replace_placeholders(body_md, images or {}, internal_links or {})
    body_html = _md_to_html(body_md)

    kw = ",".join(meta.keywords)
    og_img = html.escape(meta.og_image) if meta.og_image else ""
    og_img_tag = f'<meta property="og:image" content="{og_img}">' if og_img else ""

    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(meta.title)}</title>
<meta name="description" content="{html.escape(meta.description)}">
<meta name="keywords" content="{html.escape(kw)}">
<meta name="robots" content="index,follow">
<meta name="googlebot" content="index,follow">
<meta name="NaverBot" content="index,follow">
<meta name="Yeti" content="index,follow">
<link rel="canonical" href="{html.escape(meta.url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="{html.escape(BRAND)}">
<meta property="og:locale" content="ko_KR">
<meta property="og:title" content="{html.escape(meta.title)}">
<meta property="og:description" content="{html.escape(meta.description)}">
<meta property="og:url" content="{html.escape(meta.url)}">
{og_img_tag}
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<script type="application/ld+json">
{_schema_org(meta)}
</script>
<style>{_page_css()}</style>
</head>
<body>
<div class="wrap">
  <article class="post">
{body_html}
  </article>
{_hashtags_html(meta.hashtags)}
{_cta_band(region)}
{_locator()}
{_footer()}
</div>
</body>
</html>"""


# ---------- CLI ----------

def publish_slot(slot_id: str, *, images: dict[str, str] | None = None,
                 internal_links: dict[str, str] | None = None) -> Path:
    md_path = OUTPUT_DIR / f"{slot_id}.md"
    if not md_path.exists():
        raise FileNotFoundError(f"본문 없음: {md_path} (먼저 runtime.generate 실행)")
    markdown_text = md_path.read_text(encoding="utf-8")

    meta_path = OUTPUT_DIR / f"{slot_id}.json"
    slot_meta = {}
    if meta_path.exists():
        try:
            slot_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            slot_meta = {}

    html_out = render_html(markdown_text, slot_meta, slot_id,
                           images=images, internal_links=internal_links)
    out_path = OUTPUT_DIR / f"{slot_id}.html"
    out_path.write_text(html_out, encoding="utf-8")
    return out_path


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="발행 페이지 렌더 (운전선생 스타일 HTML)")
    p.add_argument("--slot", required=True, help="슬롯 ID (output/{slot}.md 필요)")
    p.add_argument("--images", default="",
                   help="이미지 매핑 JSON 경로 ({\"hero\":\"url\", ...})")
    p.add_argument("--links", default="",
                   help="내부링크 매핑 JSON 경로 ({\"키\":\"/path\", ...})")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    images = json.loads(Path(args.images).read_text(encoding="utf-8")) if args.images else {}
    links = json.loads(Path(args.links).read_text(encoding="utf-8")) if args.links else {}
    out = publish_slot(args.slot, images=images, internal_links=links)
    print(f"✅ 발행 페이지 생성: {out}")


if __name__ == "__main__":
    main()
