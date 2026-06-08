"""FastAPI 관리자 앱.

라우트 구조:
  GET  /                                 → 대시보드 (테넌트 목록)
  POST /tenants                          → 테넌트 생성
  POST /tenants/{domain}/delete         → 테넌트 삭제
  GET  /t/{domain}                       → 테넌트 상세 (모든 탭)
  POST /t/{domain}/settings              → 설정 업데이트
  POST /t/{domain}/axes                  → 한 축 통째 교체
  POST /t/{domain}/axes/preset           → 수직별 프리셋 적용
  POST /t/{domain}/slots/generate        → 슬롯 생성 (DB 적재)
  POST /t/{domain}/jobs                  → 양산 job 큐잉
  POST /t/{domain}/slots/{slot_id}/delete
  GET  /t/{domain}/post/{post_id}        → 글 상세 (markdown 렌더)
  POST /t/{domain}/post/{post_id}/delete
  GET  /jobs                             → 전체 작업 큐
  POST /jobs/{job_id}/cancel             → job 취소 (queued 만)

인증:
  단순 X-Admin-Token 헤더 또는 ADMIN_PASSWORD 환경변수로 보호.
  로컬 전용이므로 기본은 비활성. 외부 노출 시 ADMIN_PASSWORD 설정 권장.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from . import db, slot_gen, presets, ai_axes
from . import markdown_render as md_render


ADMIN_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = ADMIN_DIR / "templates"
STATIC_DIR = ADMIN_DIR / "static"

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()

templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
templates.env.cache = None  # Python 3.14 LRUCache 호환성 우회
templates.env.auto_reload = True
app = FastAPI(title="Programmatic SEO Admin")

# 정적 파일 (없어도 무관)
STATIC_DIR.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ---------- 시작 시 ----------

@app.on_event("startup")
def _startup() -> None:
    db.init_db()


# ---------- 인증 (최소) ----------

def _check_auth(request: Request) -> None:
    if not ADMIN_PASSWORD:
        return
    cookie = request.cookies.get("admin_token") or ""
    if cookie != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, error: str = ""):
    return templates.TemplateResponse(request, "login.html", {"error": error})


@app.post("/login")
def login_submit(password: str = Form(...)):
    if not ADMIN_PASSWORD or password == ADMIN_PASSWORD:
        resp = RedirectResponse("/", status_code=303)
        resp.set_cookie("admin_token", ADMIN_PASSWORD or "open",
                        httponly=True, max_age=60 * 60 * 24 * 30)
        return resp
    return RedirectResponse("/login?error=invalid", status_code=303)


# ---------- 대시보드 ----------

@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    _check_auth(request)
    tenants = db.list_tenants()
    jobs = db.list_jobs(limit=10)
    return templates.TemplateResponse(request, "dashboard.html", {
        "tenants": tenants,
        "recent_jobs": jobs,
        "verticals": ["driving", "car-mapping", "gym", "academy", "general"],
        "themes": ["clean", "modern", "pro"],
    })


@app.post("/tenants")
def tenant_create(
    request: Request,
    domain: str = Form(...),
    display_name: str = Form(...),
    vertical: str = Form(...),
    theme: str = Form("clean"),
    brand_color: str = Form("#0066ff"),
    daily_limit: int = Form(30),
    apply_preset: str = Form(""),
):
    _check_auth(request)
    domain = domain.strip().lower()
    vertical_clean = vertical.strip()
    if not domain or not display_name.strip() or not vertical_clean:
        raise HTTPException(400, "domain, name, vertical required")
    if db.get_tenant(domain) is not None:
        raise HTTPException(409, "tenant already exists")
    db.create_tenant(
        domain=domain, display_name=display_name.strip(), vertical=vertical_clean,
        theme=theme, brand_color=brand_color, daily_limit=daily_limit,
    )
    # 알려진 프리셋 이름이면 자동 적용 (모르는 업종이면 그냥 빈 상태)
    if apply_preset == "1":
        presets.apply(domain, vertical_clean)
    return RedirectResponse(f"/t/{domain}?tab=axes", status_code=303)


@app.post("/t/{domain}/axes/ai-fill")
async def axes_ai_fill(
    request: Request, domain: str,
    provider: str = Form("claude"),
    model: str = Form(""),
    extra_context: str = Form(""),
    timeout_sec: int = Form(300),
):
    _check_auth(request)
    t = db.get_tenant(domain)
    if t is None:
        raise HTTPException(404, "tenant not found")
    if provider not in ("claude", "codex"):
        raise HTTPException(400, "invalid provider")
    try:
        summary = await ai_axes.generate_axes(
            tenant=domain, vertical=t["vertical"],
            context=extra_context, provider=provider,
            model=model.strip(), timeout_sec=timeout_sec,
        )
    except RuntimeError as exc:
        return RedirectResponse(
            f"/t/{domain}?tab=axes&ai_error={str(exc)[:200]}",
            status_code=303,
        )
    msg = ",".join(f"{k}={v}" for k, v in summary.items() if not k.startswith("_"))
    return RedirectResponse(f"/t/{domain}?tab=axes&ai_ok={msg}",
                             status_code=303)


@app.post("/tenants/{domain}/delete")
def tenant_delete(request: Request, domain: str):
    _check_auth(request)
    db.delete_tenant(domain)
    return RedirectResponse("/", status_code=303)


# ---------- 테넌트 상세 ----------

@app.get("/t/{domain}", response_class=HTMLResponse)
def tenant_detail(
    request: Request, domain: str,
    tab: str = Query("overview"),
    slot_status: str = Query(""),
    slot_template: str = Query(""),
):
    _check_auth(request)
    t = db.get_tenant(domain)
    if t is None:
        raise HTTPException(404, "tenant not found")

    axes = db.list_axes(domain)
    slot_counts = db.count_slots(domain)
    slots_list: list[dict] = []
    posts_list: list[dict] = []
    if tab == "slots":
        slots_list = db.list_slots(
            domain,
            status=slot_status or None,
            template=slot_template or None,
            limit=300,
        )
    if tab == "posts":
        posts_list = db.list_posts(domain, limit=100)

    return templates.TemplateResponse(request, "tenant.html", {
        "tenant": t,
        "templates_enabled": json.loads(t.get("templates_enabled") or "[]"),
        "all_templates": ["T01", "T03", "T04", "T05", "T06", "T07"],
        "axes": axes,
        "slot_counts": slot_counts,
        "slots_list": slots_list,
        "posts_list": posts_list,
        "tab": tab,
        "verticals": ["driving", "car-mapping", "gym", "academy", "general"],
        "themes": ["clean", "modern", "pro"],
        "slot_status": slot_status,
        "slot_template": slot_template,
        "providers": ["claude", "codex"],
        "preset_options": list(presets.PRESETS.keys()),
    })


@app.post("/t/{domain}/settings")
def tenant_settings(
    request: Request, domain: str,
    display_name: str = Form(...),
    vertical: str = Form(...),
    theme: str = Form(...),
    brand_color: str = Form("#0066ff"),
    daily_limit: int = Form(30),
    templates_enabled: list[str] = Form([]),
):
    _check_auth(request)
    db.update_tenant(
        domain,
        display_name=display_name, vertical=vertical, theme=theme,
        brand_color=brand_color, daily_limit=daily_limit,
        templates_enabled=json.dumps(templates_enabled, ensure_ascii=False),
    )
    return RedirectResponse(f"/t/{domain}?tab=settings", status_code=303)


# ---------- 축 ----------

@app.post("/t/{domain}/axes")
def axes_update(
    request: Request, domain: str,
    axis: str = Form(...),
    values_csv: str = Form(""),
):
    """한 축 통째 교체. values_csv 형식:
       값,weight,월간검색량,KD (한 줄 한 값)
    """
    _check_auth(request)
    rows: list[dict] = []
    for line in values_csv.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split(",")]
        v = parts[0]
        if not v:
            continue
        rows.append({
            "value": v,
            "weight": int(parts[1]) if len(parts) > 1 and parts[1] else 3,
            "monthly_search_volume": int(parts[2]) if len(parts) > 2 and parts[2] else None,
            "competition_kd": int(parts[3]) if len(parts) > 3 and parts[3] else None,
        })
    db.bulk_replace_axis(tenant=domain, axis=axis, values=rows)
    return RedirectResponse(f"/t/{domain}?tab=axes", status_code=303)


@app.post("/t/{domain}/axes/preset")
def axes_preset(request: Request, domain: str,
                preset_key: str = Form(...)):
    _check_auth(request)
    presets.apply(domain, preset_key)
    return RedirectResponse(f"/t/{domain}?tab=axes", status_code=303)


# ---------- 슬롯 ----------

@app.post("/t/{domain}/slots/generate")
def slots_generate(
    request: Request, domain: str,
    max_per_template: int = Form(200),
):
    _check_auth(request)
    summary = slot_gen.generate_slots_for_tenant(
        domain, max_per_template=max_per_template,
    )
    # 결과를 쿼리로 전달
    msg = " / ".join(f"{k}:{v}" for k, v in summary.items() if k != "_inserted_total")
    return RedirectResponse(
        f"/t/{domain}?tab=slots", status_code=303,
    )


@app.post("/t/{domain}/slots/{slot_id}/delete")
def slot_delete(request: Request, domain: str, slot_id: str):
    _check_auth(request)
    with db.connect() as con:
        con.execute("DELETE FROM slots WHERE slot_id=? AND tenant=?",
                    (slot_id, domain))
    return RedirectResponse(f"/t/{domain}?tab=slots", status_code=303)


@app.post("/t/{domain}/slots/{slot_id}/reset")
def slot_reset(request: Request, domain: str, slot_id: str):
    _check_auth(request)
    db.update_slot_status(slot_id, "planned", error=None)
    return RedirectResponse(f"/t/{domain}?tab=slots", status_code=303)


# ---------- 작업(생성 큐잉) ----------

@app.post("/t/{domain}/jobs")
def enqueue_generate(
    request: Request, domain: str,
    slot_ids: list[str] = Form([]),
    provider: str = Form("claude"),
    model: str = Form(""),
    cooldown_sec: int = Form(60),
    timeout_sec: int = Form(600),
):
    _check_auth(request)
    if provider not in ("claude", "codex"):
        raise HTTPException(400, "invalid provider")
    if not slot_ids:
        raise HTTPException(400, "no slots selected")
    job_id = db.enqueue_job(
        tenant=domain, kind="generate",
        payload={
            "slot_ids": slot_ids,
            "provider": provider,
            "model": model.strip(),
            "cooldown_sec": cooldown_sec,
            "timeout_sec": timeout_sec,
        },
    )
    return RedirectResponse(f"/jobs?focus={job_id}", status_code=303)


# ---------- Posts ----------

@app.get("/t/{domain}/post/{post_id}", response_class=HTMLResponse)
def post_detail(request: Request, domain: str, post_id: str):
    _check_auth(request)
    post = db.get_post(post_id)
    if post is None or post["tenant"] != domain:
        raise HTTPException(404, "post not found")
    body_html = md_render.render(post["body_markdown"])

    # 운전선생 스타일 발행 미리보기 (placeholder 치환 + 디자인 셸)
    from runtime import publish
    try:
        slot_meta = {"slot": {"slot_id": post["slot_id"],
                              "region": post["region"] if "region" in post.keys() else ""}}
        published_html = publish.render_html(post["body_markdown"], slot_meta, post["slot_id"])
    except Exception:  # noqa: BLE001
        published_html = ""

    return templates.TemplateResponse(request, "post_view.html", {
        "post": post, "body_html": body_html, "published_html": published_html,
        "tenant": db.get_tenant(domain),
    })


@app.post("/t/{domain}/post/{post_id}/delete")
def post_delete(request: Request, domain: str, post_id: str):
    _check_auth(request)
    db.delete_post(post_id)
    return RedirectResponse(f"/t/{domain}?tab=posts", status_code=303)


# ---------- Jobs ----------

@app.get("/jobs", response_class=HTMLResponse)
def jobs_page(request: Request, tenant: str = "", focus: str = ""):
    _check_auth(request)
    jobs = db.list_jobs(tenant=tenant or None, limit=200)
    # payload JSON 펴기
    for j in jobs:
        try:
            j["payload_obj"] = json.loads(j["payload"])
        except Exception:
            j["payload_obj"] = {}
        if j["result"]:
            try:
                j["result_obj"] = json.loads(j["result"])
            except Exception:
                j["result_obj"] = {}
    return templates.TemplateResponse(request, "jobs.html", {
        "jobs": jobs, "focus": focus,
    })


# ---------- JSON API (워커가 폴링) ----------

@app.get("/api/jobs/claim")
def api_claim_job(token: str = ""):
    """워커가 호출하는 폴링 엔드포인트. 외부 접근 토큰 체크."""
    expected = os.environ.get("WORKER_TOKEN", "")
    if expected and token != expected:
        raise HTTPException(401, "bad worker token")
    job = db.claim_next_job()
    if job is None:
        return JSONResponse({"job": None})
    return JSONResponse({"job": job})


@app.post("/api/jobs/{job_id}/complete")
def api_complete_job(job_id: str, body: dict, token: str = ""):
    expected = os.environ.get("WORKER_TOKEN", "")
    if expected and token != expected:
        raise HTTPException(401, "bad worker token")
    db.complete_job(
        job_id,
        ok=bool(body.get("ok")),
        result=body.get("result"),
        error=body.get("error"),
    )
    return {"ok": True}
