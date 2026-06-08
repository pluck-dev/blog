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


def _slugify(text: str) -> str:
    """제목 → SEO 슬러그(한글 허용). 공백·특수문자→하이픈, 길이 제한."""
    import re
    t = (text or "").strip()
    t = re.sub(r"[^\w가-힣\s-]", "", t)   # 한글/영숫자/언더스코어/공백/하이픈만
    t = re.sub(r"[\s_]+", "-", t)
    t = re.sub(r"-{2,}", "-", t).strip("-")
    return t[:80] or "post"


def _meta_description(markdown_text: str, limit: int = 155) -> str:
    """본문 첫 일반 문단을 메타 디스크립션으로(헤딩/슬롯/표/인용 제외)."""
    import re
    for raw in markdown_text.splitlines():
        s = raw.strip()
        if not s or s.startswith("#") or s.startswith(">") or s.startswith("|"):
            continue
        if re.match(r"^\[(IMAGE|TABLE|INTERNAL_LINK)_SLOT", s):
            continue
        if s.startswith("#") or s.startswith("⭐"):
            continue
        # 인라인 마크다운/슬롯/출처번호 제거
        s = re.sub(r"\[(?:IMAGE|TABLE|INTERNAL_LINK)_SLOT:[^\]]*\]", "", s)
        s = re.sub(r"\[(\d+)\]", "", s)
        s = re.sub(r"[*_`#]", "", s)
        s = re.sub(r"\s+([.,!?])", r"\1", s)   # 인용 제거 후 ' .' 정리
        s = re.sub(r"\s{2,}", " ", s).strip()
        if len(s) >= 20:
            return s[:limit].rstrip()
    return ""


def _strip_preamble(markdown_text: str) -> str:
    """LLM 이 본문 앞에 붙인 메타 코멘트(예: '파일 저장 권한이 없어...')를 제거.
    첫 '# ' H1 헤딩부터를 본문으로 간주."""
    lines = markdown_text.splitlines()
    for i, line in enumerate(lines):
        if line.lstrip().startswith("# "):
            return "\n".join(lines[i:]).strip()
    return markdown_text.strip()


_ACAD_LABELS = [("주소", "address"), ("수강료", "price"), ("셔틀", "shuttle"),
                ("영업시간", "hours"), ("합격률", "pass_rate"), ("전화", "phone"),
                ("후기", "review")]


def _build_facts(tenant: str, slot: dict) -> str:
    """슬롯 지역(region)에 해당하는 학원 자료를 번호매긴 '검증된 자료' 텍스트로."""
    region = slot.get("region") or ""
    if not region:
        return ""
    academies = db.list_academies(tenant, region=region, limit=5)
    if not academies:
        return ""
    lines: list[str] = []
    for i, a in enumerate(academies, 1):
        parts = [f"[{i}] {a['name']}"]
        for label, key in _ACAD_LABELS:
            v = a.get(key)
            if v:
                parts.append(f"{label}: {v}")
        src = " ".join(filter(None, [a.get("source_name"), a.get("source_url")])).strip()
        if src:
            parts.append(f"(출처: {src})")
        lines.append(" / ".join(parts))
    return "\n".join(lines)


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

        prompt_dict = _slot_to_prompt_dict(slot)
        facts = _build_facts(tenant, slot)          # 지역 학원 자료 주입
        prompt_dict["facts"] = facts
        require_sources = bool(facts)
        prompt = prompt_lib.render(prompt_dict)
        log.info("generating slot=%s provider=%s template=%s (%d chars prompt, facts=%s)",
                 sid, provider, slot["template_id"], len(prompt), "있음" if facts else "없음")
        db.update_slot_status(sid, "in_progress")

        result = None
        report = None
        active_prompt = prompt
        max_attempts = int(os.environ.get("SEO_QUALITY_MAX_ATTEMPTS", "2"))
        for attempt in range(1, max_attempts + 1):
            result = await run_llm(
                active_prompt, provider=provider, model=model or "", timeout_sec=timeout_sec,
            )
            if result.summary:
                result.summary = _strip_preamble(result.summary)  # LLM 군더더기 제거
            if not result.ok or not result.summary.strip():
                if attempt < max_attempts:
                    continue
                break
            report = quality.validate_post(result.summary, require_sources=require_sources)
            if report.ok:
                log.info("quality OK slot=%s attempt=%d/%d: %s",
                         sid, attempt, max_attempts, report.summary())
                break
            log.warning("quality FAIL slot=%s attempt=%d/%d: %s",
                        sid, attempt, max_attempts, report.summary())
            if attempt < max_attempts:
                active_prompt = quality.retry_prompt(prompt, report, require_sources=require_sources)

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
            meta_desc = _meta_description(result.summary)
            slug = db.unique_slug(tenant, _slugify(title), sid)

            # 이미지 수집(키 있으면 원격 CDN URL 맵, 없으면 빈 dict) — 발행 콘텐츠에 저장
            img_map: dict = {}
            try:
                prompt_slot = _slot_to_prompt_dict(slot)
                img_map = images.collect_urls_for_slot(sid, result.summary, prompt_slot)
            except Exception as exc:  # noqa: BLE001
                log.warning("이미지 수집 실패 slot=%s: %s", sid, exc)

            db.insert_post(
                tenant=tenant, slot_id=sid, slug=slug,
                title=title, body_markdown=result.summary,
                meta_description=meta_desc,
                images=json.dumps(img_map, ensure_ascii=False) if img_map else None,
                provider=result.provider, model=result.model,
                session_id=result.session_id, cost_usd=result.cost_usd,
                duration_sec=result.duration_sec,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
            )
            db.update_slot_status(sid, "published")

            # 발행 HTML 파일(미리보기용, best-effort)
            try:
                slot_meta = {"slot": _slot_to_prompt_dict(slot)}
                html_out = publish.render_html(result.summary, slot_meta, sid, images=img_map)
                publish.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
                (publish.OUTPUT_DIR / f"{slug}.html").write_text(html_out, encoding="utf-8")
                log.info("발행: slug=%s, meta=%d자, 이미지 %d개", slug, len(meta_desc or ""), len(img_map))
            except Exception as exc:  # noqa: BLE001
                log.warning("발행 HTML 생성 실패 slot=%s: %s", sid, exc)

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
