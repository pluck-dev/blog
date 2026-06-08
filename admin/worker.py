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
from runtime import dedup as dedup_lib
from runtime import rate_limit as rl
from runtime import indexing as indexing_lib
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
    rl_backoff_sec = 0  # 레이트리밋 압력 적응 백오프(슬롯 간)

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

        # 레이트리밋 신호로 적응 백오프 갱신
        signal = rl.parse_rate_signal(getattr(result, "rate_limit", None))
        rl_backoff_sec = rl.next_backoff_sec(signal, rl_backoff_sec)
        if rl_backoff_sec > 0:
            pct = f"{round(signal.pressure * 100)}%" if signal.pressure is not None else "?"
            log.warning("레이트리밋 압력(%s%s) → 추가 대기 %ds", pct,
                        f", {signal.status}" if signal.status else "", rl_backoff_sec)

        effective_cooldown = cooldown_sec + rl_backoff_sec
        if i < len(slot_ids) - 1 and effective_cooldown > 0:
            log.info("cooldown %ds%s", effective_cooldown,
                     f" (레이트리밋 +{rl_backoff_sec})" if rl_backoff_sec else "")
            await asyncio.sleep(effective_cooldown)

    return {"ok": ok, "fail": fail, "per_slot": per_slot}


async def _process_dedup(job: dict) -> dict:
    payload = job["payload_obj"]
    tenant = job["tenant"]
    threshold = float(payload.get("threshold") or 0.75)
    dry_run = bool(payload.get("dry_run"))

    posts = db.list_posts_for_dedup(tenant)
    clusters = dedup_lib.find_duplicate_clusters(posts, threshold=threshold)
    dup_ids = [pid for c in clusters for pid in c.duplicate_ids]
    marked = 0
    if not dry_run:
        for pid in dup_ids:
            db.update_post_status(pid, "noindex")
            marked += 1
    log.info("dedup tenant=%s clusters=%d dup=%d marked=%d dry=%s",
             tenant, len(clusters), len(dup_ids), marked, dry_run)
    return {
        "total_posts": len(posts),
        "clusters": len(clusters),
        "duplicates_found": len(dup_ids),
        "marked_noindex": marked,
        "dry_run": dry_run,
    }


async def _process_prune(job: dict) -> dict:
    payload = job["payload_obj"]
    tenant = job["tenant"]
    min_chars = int(payload.get("min_body_chars") or 700)
    stale_days = int(payload.get("stale_noindex_days") or 90)
    dry_run = bool(payload.get("dry_run"))

    posts = db.list_posts_for_dedup(tenant, include_noindex=True)
    now = time.time()

    def age_days(ts: str | None) -> float:
        if not ts:
            return 0.0
        try:
            from datetime import datetime
            t = datetime.fromisoformat(ts.replace(" ", "T") + ("" if "T" in ts else "+00:00"))
            return (now - t.timestamp()) / 86400.0
        except Exception:
            return 0.0

    thin = stale = 0
    for p in posts:
        if p["status"] == "published":
            if len(dedup_lib.normalize(p["body_markdown"])) < min_chars:
                if not dry_run:
                    db.update_post_status(p["id"], "noindex")
                thin += 1
        elif p["status"] == "noindex":
            if age_days(p.get("generated_at")) >= stale_days:
                if not dry_run:
                    db.update_post_status(p["id"], "deleted")
                stale += 1
    log.info("prune tenant=%s thin=%d stale=%d dry=%s", tenant, thin, stale, dry_run)
    return {"total_posts": len(posts), "thin_noindexed": thin,
            "stale_deleted": stale, "dry_run": dry_run}


async def _process_indexing(job: dict) -> dict:
    payload = job["payload_obj"]
    tenant = job["tenant"]
    sa_json = db.get_setting("google_sa_json")
    if not indexing_lib.is_configured(sa_json):
        msg = "Google 서비스계정 키 미설정. 설정에서 키를 등록하세요."
        log.warning("indexing tenant=%s: %s", tenant, msg)
        return {"configured": False, "total": 0, "submitted": 0,
                "failed": 0, "skipped_quota": 0, "message": msg}

    template = db.get_setting("indexing_url_template") or "https://{domain}/community/{slug}"
    notify_type = payload.get("type") or "URL_UPDATED"
    max_quota = int(payload.get("max") or 200)

    posts = db.list_posts(tenant, status="published", limit=100000)
    post_ids = payload.get("post_ids")
    if post_ids:
        idset = set(post_ids)
        posts = [p for p in posts if p["id"] in idset]
    total = len(posts)
    targets = posts[:max_quota]
    skipped = total - len(targets)

    try:
        token = indexing_lib.get_access_token(indexing_lib.parse_service_account(sa_json))
    except Exception as exc:  # noqa: BLE001
        return {"configured": True, "total": total, "submitted": 0,
                "failed": len(targets), "skipped_quota": skipped,
                "message": f"토큰 발급 실패: {exc}"}

    submitted = failed = 0
    for p in targets:
        url = indexing_lib.build_post_url(template, tenant, p["slug"])
        r = indexing_lib.submit_url(token, url, notify_type)
        if r.get("ok"):
            submitted += 1
        else:
            failed += 1
        await asyncio.sleep(0.12)
    log.info("indexing tenant=%s submitted=%d failed=%d skipped=%d",
             tenant, submitted, failed, skipped)
    return {"configured": True, "total": total, "submitted": submitted,
            "failed": failed, "skipped_quota": skipped}


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
            elif job["kind"] == "dedup":
                result = await _process_dedup(job)
                db.complete_job(job["id"], ok=True, result=result)
                log.info("job %s done: %s", job["id"], result)
            elif job["kind"] == "prune":
                result = await _process_prune(job)
                db.complete_job(job["id"], ok=True, result=result)
                log.info("job %s done: %s", job["id"], result)
            elif job["kind"] == "indexing":
                result = await _process_indexing(job)
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
