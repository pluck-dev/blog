"""백그라운드 워커 — jobs 테이블 polling.

같은 SQLite 파일을 공유한다 (admin/data/admin.db). 따라서 FastAPI 서버와
같은 노트북에서 별도 프로세스로 띄우면 됨:

  cd /Users/simjaehyeong/Desktop/pluck/tools/seo
  .venv/bin/python -m admin.worker

종료: Ctrl-C
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time

from . import db
from runtime import images, prompts as prompt_lib, publish, quality
from runtime.llm import run_llm

log = logging.getLogger("admin.worker")

POLL_INTERVAL = float(os.environ.get("WORKER_POLL_INTERVAL", "3"))


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


def _slot_to_prompt_dict(slot: dict) -> dict:
    return {
        "slot_id": slot["slot_id"],
        "template_id": slot["template_id"],
        "primary_keyword": slot["primary_keyword"],
        "region": slot.get("region") or "",
        "persona": slot.get("persona") or "",
        "intent": slot.get("intent") or "",
        "modifier_1": slot.get("modifier_1") or "",
        "modifier_2": slot.get("modifier_2") or "",
        "entity_id": slot.get("entity_id") or "",
        "title_pattern_seed": "",
    }


def _extract_title(markdown_text: str, fallback: str) -> str:
    for line in markdown_text.splitlines():
        s = line.strip()
        if s.startswith("# "):
            return s[2:].strip() or fallback
    return fallback


async def _process_generate(job: dict) -> dict:
    payload = job["payload_obj"]
    tenant = job["tenant"]
    provider = payload.get("provider") or "claude"
    model = (payload.get("model") or "").strip()
    timeout_sec = int(payload.get("timeout_sec") or 600)
    cooldown_sec = int(payload.get("cooldown_sec") or 60)
    slot_ids: list[str] = list(payload.get("slot_ids") or [])

    ok = fail = 0
    per_slot: list[dict] = []

    for i, sid in enumerate(slot_ids):
        slot = db.get_slot(sid)
        if not slot:
            log.warning("slot not found: %s", sid)
            per_slot.append({"slot_id": sid, "ok": False, "error": "not found"})
            fail += 1
            continue
        if slot["tenant"] != tenant:
            log.warning("tenant mismatch slot=%s tenant=%s", sid, slot["tenant"])
            per_slot.append({"slot_id": sid, "ok": False, "error": "tenant mismatch"})
            fail += 1
            continue

        prompt = prompt_lib.render(_slot_to_prompt_dict(slot))
        log.info("generating slot=%s provider=%s template=%s (%d chars prompt)",
                 sid, provider, slot["template_id"], len(prompt))
        db.update_slot_status(sid, "in_progress")

        result = None
        report = None
        active_prompt = prompt
        max_attempts = int(os.environ.get("SEO_QUALITY_MAX_ATTEMPTS", "2"))
        for attempt in range(1, max_attempts + 1):
            result = await run_llm(
                active_prompt, provider=provider, model=model or "", timeout_sec=timeout_sec,
            )
            if not result.ok or not result.summary.strip():
                if attempt < max_attempts:
                    continue
                break
            report = quality.validate_post(result.summary)
            if report.ok:
                log.info("quality OK slot=%s attempt=%d/%d: %s",
                         sid, attempt, max_attempts, report.summary())
                break
            log.warning("quality FAIL slot=%s attempt=%d/%d: %s",
                        sid, attempt, max_attempts, report.summary())
            if attempt < max_attempts:
                active_prompt = quality.retry_prompt(prompt, report)

        assert result is not None

        if not result.ok or not result.summary.strip():
            err = result.error or "empty summary"
            log.error("FAIL slot=%s (%.1fs): %s", sid, result.duration_sec, err)
            db.update_slot_status(sid, "failed", error=err)
            per_slot.append({"slot_id": sid, "ok": False, "error": err,
                              "duration_sec": result.duration_sec})
            fail += 1
        elif report is not None and not report.ok:
            err = f"quality gate failed: {report.summary()}"
            log.error("FAIL slot=%s (%.1fs): %s", sid, result.duration_sec, err)
            db.update_slot_status(sid, "failed", error=err)
            per_slot.append({"slot_id": sid, "ok": False, "error": err,
                              "duration_sec": result.duration_sec,
                              "chars": len(result.summary)})
            fail += 1
        else:
            title = _extract_title(result.summary, slot["primary_keyword"])
            db.insert_post(
                tenant=tenant, slot_id=sid, slug=sid,
                title=title, body_markdown=result.summary,
                provider=result.provider, model=result.model,
                session_id=result.session_id, cost_usd=result.cost_usd,
                duration_sec=result.duration_sec,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
            db.update_slot_status(sid, "published")

            # 이미지 수집 + 운전선생 스타일 발행 HTML (best-effort — 실패해도 발행은 유효)
            try:
                prompt_slot = _slot_to_prompt_dict(slot)
                slot_meta = {"slot": prompt_slot}
                img_map = images.collect_for_slot(sid, result.summary, prompt_slot)
                html_out = publish.render_html(result.summary, slot_meta, sid, images=img_map)
                publish.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                (publish.OUTPUT_DIR / f"{sid}.html").write_text(html_out, encoding="utf-8")
                if img_map:
                    (publish.OUTPUT_DIR / f"{sid}.images.json").write_text(
                        json.dumps(img_map, ensure_ascii=False, indent=2), encoding="utf-8")
                log.info("발행 HTML → %s.html (이미지 %d개)", sid, len(img_map))
            except Exception as exc:  # noqa: BLE001
                log.warning("발행 HTML/이미지 생성 실패 slot=%s: %s", sid, exc)

            per_slot.append({"slot_id": sid, "ok": True,
                              "duration_sec": result.duration_sec,
                              "chars": len(result.summary),
                              "model": result.model})
            log.info("OK   slot=%s (%.1fs, %s, %d chars)",
                     sid, result.duration_sec, result.model or "?",
                     len(result.summary))
            ok += 1

        if i < len(slot_ids) - 1 and cooldown_sec > 0:
            log.info("cooldown %ds", cooldown_sec)
            await asyncio.sleep(cooldown_sec)

    return {"ok": ok, "fail": fail, "per_slot": per_slot}


async def _main() -> int:
    _setup_logging()
    db.init_db()
    log.info("worker started; DB=%s; poll=%.1fs", db.DB_PATH, POLL_INTERVAL)
    while True:
        try:
            job = db.claim_next_job()
        except Exception as exc:
            log.exception("claim failed: %s", exc)
            await asyncio.sleep(5)
            continue

        if job is None:
            await asyncio.sleep(POLL_INTERVAL)
            continue

        log.info("claimed job=%s kind=%s tenant=%s",
                 job["id"], job["kind"], job["tenant"])

        try:
            if job["kind"] == "generate":
                result = await _process_generate(job)
                db.complete_job(job["id"], ok=True, result=result)
                log.info("job %s done: %s", job["id"], result)
            else:
                db.complete_job(job["id"], ok=False,
                                 error=f"unsupported kind: {job['kind']}")
        except Exception as exc:
            log.exception("job %s failed: %s", job["id"], exc)
            db.complete_job(job["id"], ok=False, error=str(exc))

    return 0


def main() -> None:
    try:
        sys.exit(asyncio.run(_main()))
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
