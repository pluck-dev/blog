"""SEO 양산 CLI — claude/codex OAuth 구독제로 본문 생성.

사용 예:
  # 슬롯 1건 (기본: claude)
  python3 -m runtime.generate --slot T07_daa28b5f

  # codex 로 생성
  python3 -m runtime.generate --slot T07_daa28b5f --provider codex

  # 배치 + 모델 지정
  python3 -m runtime.generate --provider claude --model claude-sonnet-4-6 --limit 5

  # codex 배치 (gpt-5.3-codex 기본)
  python3 -m runtime.generate --provider codex --limit 5 --cooldown 90

작업 디렉토리 무관하게 동작. 출력:
  output/{slot_id}.md       — 생성된 markdown 본문
  output/{slot_id}.json     — 메타 (provider, cost, duration, model, session_id, slot)
  output/state.json         — 슬롯별 status 집계
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import Literal

from . import images, llm, prompts, publish, quality, slots

log = logging.getLogger("seo.generate")

OUTPUT_DIR = slots.OUTPUT_DIR
Provider = Literal["claude", "codex"]


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


async def generate_one(
    slot: slots.Slot,
    *,
    provider: Provider = "claude",
    cmd: str | None = None,
    model: str = "",
    timeout_sec: int = 600,
    with_images: bool = False,
    do_publish: bool = False,
) -> bool:
    prompt = prompts.render(slot.to_dict())
    log.info("slot=%s template=%s region=%s persona=%s provider=%s (prompt %d chars)",
             slot.slot_id, slot.template_id, slot.region or "-",
             slot.persona or "-", provider, len(prompt))
    slots.mark_in_progress(slot.slot_id)

    t0 = time.time()
    result: llm.LLMResult | None = None
    quality_report: quality.QualityReport | None = None
    active_prompt = prompt
    max_attempts = int(os.environ.get("SEO_QUALITY_MAX_ATTEMPTS", "2"))

    for attempt in range(1, max_attempts + 1):
        result = await llm.run_llm(
            active_prompt,
            provider=provider,
            cmd=cmd,
            model=model,
            timeout_sec=timeout_sec,
        )

        if not result.ok or not result.summary.strip():
            err = result.error or "empty summary"
            log.error("FAIL slot=%s attempt=%d/%d (%.1fs, provider=%s): %s",
                      slot.slot_id, attempt, max_attempts, result.duration_sec, provider, err)
            if attempt == max_attempts:
                slots.mark_failed(slot.slot_id, err)
                return False
            continue

        quality_report = quality.validate_post(result.summary)
        if quality_report.ok:
            log.info("quality OK slot=%s attempt=%d/%d: %s",
                     slot.slot_id, attempt, max_attempts, quality_report.summary())
            break

        log.warning("quality FAIL slot=%s attempt=%d/%d: %s",
                    slot.slot_id, attempt, max_attempts, quality_report.summary())
        if attempt == max_attempts:
            slots.mark_failed(slot.slot_id, f"quality gate failed: {quality_report.summary()}")
            return False
        active_prompt = quality.retry_prompt(prompt, quality_report)

    assert result is not None
    elapsed = time.time() - t0

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    md_path = OUTPUT_DIR / f"{slot.slot_id}.md"
    meta_path = OUTPUT_DIR / f"{slot.slot_id}.json"

    md_path.write_text(result.summary, encoding="utf-8")
    meta = {
        "slot": slot.to_dict(),
        "provider": result.provider,
        "model": result.model,
        "cost_usd": result.cost_usd,
        "input_tokens": result.input_tokens,
        "cached_input_tokens": result.cached_input_tokens,
        "output_tokens": result.output_tokens,
        "duration_sec": result.duration_sec,
        "num_turns": result.num_turns,
        "session_id": result.session_id,
        "rate_limit": result.rate_limit,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "summary_chars": len(result.summary),
        "quality": {
            "ok": quality_report.ok if quality_report else False,
            "issues": quality_report.issues if quality_report else ["not checked"],
            "text_chars": quality_report.text_chars if quality_report else 0,
            "h2_count": quality_report.h2_count if quality_report else 0,
            "image_slot_count": quality_report.image_slot_count if quality_report else 0,
            "table_slot_count": quality_report.table_slot_count if quality_report else 0,
        },
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    slots.mark_published(
        slot.slot_id,
        path=str(md_path.relative_to(OUTPUT_DIR.parent)),
        cost_usd=result.cost_usd,
        duration_sec=result.duration_sec,
        model=result.model,
        session_id=result.session_id,
    )
    log.info("OK   slot=%s (%.1fs, provider=%s, model=%s, %d chars) → %s",
             slot.slot_id, elapsed, provider, result.model or "?",
             len(result.summary), md_path.name)

    # 선택 단계: 이미지 수집 + 발행 HTML (best-effort — 실패해도 본문 발행은 유효)
    if with_images or do_publish:
        img_map: dict[str, str] = {}
        if with_images:
            try:
                img_map = images.collect_for_slot(slot.slot_id, result.summary, slot.to_dict())
            except Exception as exc:  # noqa: BLE001
                log.warning("이미지 수집 실패 slot=%s: %s", slot.slot_id, exc)
            (OUTPUT_DIR / f"{slot.slot_id}.images.json").write_text(
                json.dumps(img_map, ensure_ascii=False, indent=2), encoding="utf-8")
        if do_publish:
            try:
                html_out = publish.render_html(result.summary, meta, slot.slot_id, images=img_map)
                (OUTPUT_DIR / f"{slot.slot_id}.html").write_text(html_out, encoding="utf-8")
                log.info("발행 HTML → %s.html (이미지 %d개)", slot.slot_id, len(img_map))
            except Exception as exc:  # noqa: BLE001
                log.warning("발행 HTML 생성 실패 slot=%s: %s", slot.slot_id, exc)

    return True


async def run_batch(
    *,
    csv_path: Path,
    templates: list[str] | None,
    min_priority: float,
    limit: int,
    cooldown_sec: int,
    provider: Provider,
    cmd: str | None,
    model: str,
    timeout_sec: int,
    with_images: bool = False,
    do_publish: bool = False,
) -> dict:
    pool = slots.iter_planned(
        csv_path,
        templates=templates,
        min_priority=min_priority,
        limit=limit,
    )
    if not pool:
        log.warning("no planned slots match filters (csv=%s)", csv_path)
        return {"attempted": 0, "ok": 0, "fail": 0}

    log.info("batch start: %d slot(s), provider=%s, cooldown=%ds, model=%s",
             len(pool), provider, cooldown_sec, model or "<default>")

    ok = fail = 0
    for i, slot in enumerate(pool):
        success = await generate_one(
            slot,
            provider=provider,
            cmd=cmd,
            model=model,
            timeout_sec=timeout_sec,
            with_images=with_images,
            do_publish=do_publish,
        )
        if success:
            ok += 1
        else:
            fail += 1
        if i < len(pool) - 1 and cooldown_sec > 0:
            log.info("cooldown %ds...", cooldown_sec)
            await asyncio.sleep(cooldown_sec)

    log.info("batch done: ok=%d fail=%d", ok, fail)
    return {"attempted": len(pool), "ok": ok, "fail": fail}


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SEO 양산 (OAuth 구독제 claude/codex)")
    p.add_argument("--provider", choices=("claude", "codex"), default="claude",
                   help="LLM provider (기본: claude)")
    p.add_argument("--slot", help="단일 슬롯 ID")
    p.add_argument("--csv", default=str(slots.DEFAULT_SLOTS_CSV),
                   help=f"슬롯 CSV (기본: {slots.DEFAULT_SLOTS_CSV.name})")
    p.add_argument("--templates", default="",
                   help="템플릿 필터 (쉼표 구분, 예: T01,T03)")
    p.add_argument("--min-priority", type=float, default=0.0)
    p.add_argument("--limit", type=int, default=1)
    p.add_argument("--cooldown", type=int, default=60)
    p.add_argument("--cmd", default="",
                   help="CLI 바이너리 경로. 비우면 provider 기본값 (claude/codex)")
    p.add_argument("--model", default="",
                   help="모델 지정. claude: claude-sonnet-4-6 / codex: gpt-5.3-codex 등")
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--with-images", action="store_true",
                   help="생성 후 이미지 수집 (Unsplash/Pexels → 자체 호스팅). 키 없으면 플레이스홀더 유지")
    p.add_argument("--publish", action="store_true",
                   help="생성(+이미지) 후 운전선생 스타일 발행 HTML 생성 → output/{slot}.html")
    p.add_argument("-v", "--verbose", action="store_true")
    return p.parse_args()


async def _amain() -> int:
    args = _parse_args()
    _setup_logging(args.verbose)

    csv_path = Path(args.csv)
    cmd = args.cmd or None  # None → llm.run_llm 의 기본값 (claude/codex)

    if args.slot:
        slot = slots.get_slot_by_id(args.slot, csv_path)
        if slot is None:
            log.error("slot not found: %s", args.slot)
            return 2
        status = slots.get_status(slot.slot_id)
        if status not in ("planned", "failed"):
            log.warning("slot %s already %s — proceeding anyway",
                        slot.slot_id, status)
        ok = await generate_one(
            slot,
            provider=args.provider,
            cmd=cmd,
            model=args.model,
            timeout_sec=args.timeout,
            with_images=args.with_images,
            do_publish=args.publish,
        )
        return 0 if ok else 1

    templates = [t.strip() for t in args.templates.split(",") if t.strip()] or None
    summary = await run_batch(
        csv_path=csv_path,
        templates=templates,
        min_priority=args.min_priority,
        limit=args.limit,
        cooldown_sec=args.cooldown,
        provider=args.provider,
        cmd=cmd,
        model=args.model,
        timeout_sec=args.timeout,
        with_images=args.with_images,
        do_publish=args.publish,
    )
    return 0 if summary["fail"] == 0 else 1


def main() -> None:
    raise SystemExit(asyncio.run(_amain()))


if __name__ == "__main__":
    main()
