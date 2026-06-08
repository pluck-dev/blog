"""이미지 수집 — Unsplash / Pexels 검색 → 다운로드 → 자체 호스팅.

핫링크(남의 URL 직접 참조)는 저작권·SEO·깨짐 문제가 있어 금지.
대신 합법 무료 소스(Unsplash·Pexels)에서 검색 → 다운로드 → output/images/ 에
자체 저장한 뒤, 그 로컬 경로를 publish.py 의 --images 로 넘긴다.

  IMAGE_SLOT 종류(hero/exterior/interior/shuttle)
      → 검색어 매핑 → API 검색 → 슬롯별 다양성 인덱스 선택
      → 다운로드 → output/images/{slot_id}/{kind}.jpg
      → {kind: "images/{slot_id}/{kind}.jpg"} 반환

provider 자동 선택:
  UNSPLASH_ACCESS_KEY 있으면 unsplash, 없고 PEXELS_API_KEY 있으면 pexels.
  둘 다 없으면 빈 dict 반환 → publish 는 플레이스홀더 유지(안전).

외부 의존성 없음 (urllib + json, 표준 라이브러리만).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("seo.images")

RUNTIME_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RUNTIME_DIR.parent
OUTPUT_DIR = PROJECT_DIR / "output"
IMAGES_DIR = OUTPUT_DIR / "images"

# IMAGE_SLOT 종류 → 영어 검색어 (영어가 스톡 검색 품질이 좋음).
# 한국 지명(region)은 스톡엔 거의 없어 검색어에 넣지 않고 다양성 시드로만 사용.
# "korea" 같은 토큰은 결과량을 0으로 만들 수 있어 base 에는 넣지 않음(깨짐 방지).
SLOT_QUERIES: dict[str, str] = {
    "hero": "driving school road",
    "exterior": "driving academy building exterior",
    "interior": "car driving lesson student",
    "shuttle": "shuttle bus city",
}
DEFAULT_QUERY = "car driving road"
PER_PAGE = 30
TIMEOUT = 20

# 주요 운전 도메인 키워드 한→영 매핑 (hero 검색어 보정용)
KEYWORD_EN: dict[str, str] = {
    "운전면허학원": "driving school",
    "운전면허": "driving license test",
    "도로주행": "road driving test",
    "기능시험": "driving skill test course",
    "장롱면허": "nervous new driver",
    "도로연수": "driving practice road",
    "1종": "manual transmission car",
    "2종": "automatic car driving",
    "운전연수": "driving lesson instructor",
    "셔틀": "shuttle bus",
}

# 템플릿 인텐트별 hero 보정 (키워드 매핑이 없을 때 fallback)
TEMPLATE_HINT: dict[str, str] = {
    "T04": "car key comparison",   # 비교형
    "T05": "saving money car",     # 비용절약
    "T06": "driving test exam",    # 시험 BEST5
}


def _build_query(kind: str, slot_meta: dict | None) -> str:
    """슬롯 종류 + (hero 한정) 템플릿·키워드 맥락으로 검색어 구성.

    hero 외 종류는 base 가 이미 구체적이라 그대로 사용 — 과한 결합은
    스톡 검색 결과량을 떨어뜨려 이미지 누락을 유발하므로 피한다.
    """
    base = SLOT_QUERIES.get(kind, DEFAULT_QUERY)
    if not slot_meta or kind != "hero":
        return base
    kw = slot_meta.get("primary_keyword", "") or ""
    for ko, en in KEYWORD_EN.items():
        if ko in kw:
            return en
    return TEMPLATE_HINT.get(slot_meta.get("template_id", ""), base)


# ---------- provider 선택 ----------

def _active_provider() -> tuple[str, str] | None:
    key = os.environ.get("UNSPLASH_ACCESS_KEY", "").strip()
    if key:
        return ("unsplash", key)
    key = os.environ.get("PEXELS_API_KEY", "").strip()
    if key:
        return ("pexels", key)
    return None


# ---------- 검색 ----------

def _http_get_json(url: str, headers: dict[str, str]) -> dict:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _search_unsplash(query: str, key: str) -> list[dict]:
    """returns [{url, download_location}] candidates."""
    q = urllib.parse.urlencode({"query": query, "per_page": PER_PAGE, "orientation": "landscape"})
    url = f"https://api.unsplash.com/search/photos?{q}"
    data = _http_get_json(url, {"Authorization": f"Client-ID {key}", "Accept-Version": "v1"})
    out = []
    for r in data.get("results", []):
        urls = r.get("urls") or {}
        links = r.get("links") or {}
        if urls.get("regular"):
            out.append({"url": urls["regular"], "download_location": links.get("download_location", "")})
    return out


def _search_pexels(query: str, key: str) -> list[dict]:
    q = urllib.parse.urlencode({"query": query, "per_page": PER_PAGE, "orientation": "landscape"})
    url = f"https://api.pexels.com/v1/search?{q}"
    data = _http_get_json(url, {"Authorization": key})
    out = []
    for p in data.get("photos", []):
        src = p.get("src") or {}
        chosen = src.get("large") or src.get("medium") or src.get("original")
        if chosen:
            out.append({"url": chosen, "download_location": ""})
    return out


def _search(provider: str, key: str, query: str) -> list[dict]:
    try:
        if provider == "unsplash":
            return _search_unsplash(query, key)
        return _search_pexels(query, key)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, KeyError) as exc:
        log.warning("search failed (provider=%s, query=%r): %s", provider, query, exc)
        return []


# ---------- 다양성 선택 ----------

def _pick_index(slot_id: str, kind: str, n: int) -> int:
    """슬롯+종류 해시로 결과 중 하나를 결정적으로 선택 → 양산글 간 이미지 분산."""
    if n <= 0:
        return 0
    h = hashlib.sha1(f"{slot_id}:{kind}".encode("utf-8")).hexdigest()
    return int(h, 16) % n


# ---------- 다운로드 (자체 호스팅) ----------

def _download(url: str, dest: Path) -> bool:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 seo-bot"})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = resp.read()
        if not data:
            return False
        dest.write_bytes(data)
        return True
    except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
        log.warning("download failed (%s): %s", url, exc)
        return False


def _trigger_unsplash_download(download_location: str, key: str) -> None:
    """Unsplash API 가이드라인: 다운로드 시 download_location 을 호출해야 함(트래킹)."""
    if not download_location:
        return
    try:
        _http_get_json(download_location, {"Authorization": f"Client-ID {key}"})
    except Exception:  # noqa: BLE001 — 트래킹 실패는 치명적 아님
        pass


# ---------- 본문에서 필요한 슬롯 종류 추출 ----------

def needed_kinds(markdown_text: str) -> list[str]:
    kinds = re.findall(r"\[IMAGE_SLOT:\s*([^\]]+?)\s*\]", markdown_text)
    seen: list[str] = []
    for k in kinds:
        if k not in seen:
            seen.append(k)
    return seen


# ---------- 메인 ----------

def collect_for_slot(slot_id: str, markdown_text: str,
                     slot_meta: dict | None = None) -> dict[str, str]:
    """슬롯 본문의 IMAGE_SLOT 종류별로 이미지를 확보 → {kind: 상대경로} 반환.

    slot_meta(template_id, primary_keyword 등) 를 주면 hero 검색어를 주제에 맞게 보정.
    반환 경로는 output/ 기준 상대경로(예: 'images/T01_x/hero.jpg') 이므로
    output/{slot}.html 옆에서 그대로 동작한다.
    """
    prov = _active_provider()
    if prov is None:
        log.warning("이미지 API 키 없음 (UNSPLASH_ACCESS_KEY / PEXELS_API_KEY) — 플레이스홀더 유지")
        return {}
    provider, key = prov

    kinds = needed_kinds(markdown_text)
    if not kinds:
        return {}

    result: dict[str, str] = {}
    for kind in kinds:
        query = _build_query(kind, slot_meta)
        candidates = _search(provider, key, query)
        if not candidates:
            log.warning("후보 없음 slot=%s kind=%s query=%r", slot_id, kind, query)
            continue
        idx = _pick_index(slot_id, kind, len(candidates))
        chosen = candidates[idx]
        dest = IMAGES_DIR / slot_id / f"{kind}.jpg"
        if _download(chosen["url"], dest):
            if provider == "unsplash":
                _trigger_unsplash_download(chosen.get("download_location", ""), key)
            result[kind] = f"images/{slot_id}/{dest.name}"
            log.info("이미지 확보 slot=%s kind=%s ← %s", slot_id, kind, provider)
    return result


def collect_and_save(slot_id: str) -> Path:
    """output/{slot}.md 를 읽어 이미지 수집 후 output/{slot}.images.json 저장."""
    md_path = OUTPUT_DIR / f"{slot_id}.md"
    if not md_path.exists():
        raise FileNotFoundError(f"본문 없음: {md_path} (먼저 runtime.generate 실행)")
    markdown_text = md_path.read_text(encoding="utf-8")
    slot_meta = {}
    meta_path = OUTPUT_DIR / f"{slot_id}.json"
    if meta_path.exists():
        try:
            slot_meta = (json.loads(meta_path.read_text(encoding="utf-8")) or {}).get("slot", {})
        except (json.JSONDecodeError, OSError):
            slot_meta = {}
    images = collect_for_slot(slot_id, markdown_text, slot_meta)
    out = OUTPUT_DIR / f"{slot_id}.images.json"
    out.write_text(json.dumps(images, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


# ---------- CLI ----------

def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="이미지 수집 (Unsplash/Pexels → 자체 호스팅)")
    p.add_argument("--slot", required=True, help="슬롯 ID (output/{slot}.md 필요)")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s", datefmt="%H:%M:%S",
    )
    if _active_provider() is None:
        print("⚠️  이미지 API 키가 없습니다. 아래 중 하나를 설정하세요:")
        print("   export UNSPLASH_ACCESS_KEY=...   # https://unsplash.com/developers")
        print("   export PEXELS_API_KEY=...        # https://www.pexels.com/api/")
        raise SystemExit(2)
    out = collect_and_save(args.slot)
    images = json.loads(out.read_text(encoding="utf-8"))
    print(f"✅ 이미지 {len(images)}개 수집 → {out}")
    for kind, path in images.items():
        print(f"   {kind}: {path}")
    print(f"\n다음: .venv/bin/python -m runtime.publish --slot {args.slot} --images {out}")


if __name__ == "__main__":
    main()
