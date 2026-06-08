"""LLM provider 통합 레이어 — claude / codex 둘 다 지원.

설계 원칙:
  * 두 provider 모두 **OAuth 구독제 우선** (API 키는 명시적으로 제거)
  * 같은 LLMResult 로 정규화 → 호출부는 provider 만 바꾸면 됨
  * 외부 의존성 없음 (asyncio + json + subprocess 만 사용)

provider 별 차이:
  claude  : `claude --print - --output-format stream-json --verbose`
            ANTHROPIC_API_KEY 제거 → claude.ai OAuth (Pro/Max)
            stream-json 파싱 (assistant/result/rate_limit_event 이벤트)
  codex   : `codex exec --json -`
            OPENAI_API_KEY 제거 → ChatGPT OAuth (~/.codex/auth.json)
            JSONL 파싱 (thread.started/item.completed/turn.completed)
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any, Literal

log = logging.getLogger(__name__)

Provider = Literal["claude", "codex"]


@dataclass(slots=True)
class LLMResult:
    ok: bool
    provider: Provider
    summary: str
    model: str
    duration_sec: float
    cost_usd: float = 0.0           # claude 는 환산치, codex 는 0 (토큰만 카운트)
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    session_id: str | None = None
    num_turns: int = 0
    rate_limit: dict[str, Any] | None = None  # claude only (seven_day utilization)
    raw_json: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


# ---------- 메인 디스패처 ----------

async def run_llm(
    prompt: str,
    *,
    provider: Provider = "claude",
    cmd: str | None = None,
    model: str = "",
    timeout_sec: int = 600,
    cwd: str | None = None,
    extra_args: list[str] | None = None,
    allowed_tools: list[str] | None = None,
) -> LLMResult:
    if provider == "claude":
        return await _run_claude(
            prompt,
            cmd=cmd or "claude",
            model=model,
            timeout_sec=timeout_sec,
            cwd=cwd,
            extra_args=extra_args,
            allowed_tools=allowed_tools,
        )
    if provider == "codex":
        return await _run_codex(
            prompt,
            cmd=cmd or "codex",
            model=model,
            timeout_sec=timeout_sec,
            cwd=cwd,
            extra_args=extra_args,
        )
    raise ValueError(f"unknown provider: {provider!r}")


# ---------- Claude (Anthropic) ----------

async def _run_claude(
    prompt: str,
    *,
    cmd: str,
    model: str,
    timeout_sec: int,
    cwd: str | None,
    extra_args: list[str] | None,
    allowed_tools: list[str] | None,
) -> LLMResult:
    args = [cmd, "--print", "-", "--output-format", "stream-json", "--verbose"]
    if allowed_tools:
        args.extend(["--allowedTools", ",".join(allowed_tools)])
    if model:
        args.extend(["--model", model])
    if extra_args:
        args.extend(extra_args)

    env = {**os.environ}
    # 구독제 강제 — API 키가 있으면 빌링 타입이 바뀐다
    env.pop("ANTHROPIC_API_KEY", None)
    env.pop("ANTHROPIC_AUTH_TOKEN", None)

    proc_result = await _spawn(args, prompt, env=env, cwd=cwd, timeout_sec=timeout_sec)
    if proc_result.error and not proc_result.stdout:
        return LLMResult(
            ok=False, provider="claude", summary="", model=model,
            duration_sec=proc_result.duration_sec, error=proc_result.error,
        )

    parsed = _parse_claude_stream(proc_result.stdout)
    summary = parsed["summary"]
    ok = bool(summary.strip()) and proc_result.returncode == 0

    err = None
    if not ok:
        err = (
            _first_nonempty(proc_result.stderr)
            or proc_result.error
            or f"claude exit {proc_result.returncode}"
        )

    return LLMResult(
        ok=ok,
        provider="claude",
        summary=summary,
        model=parsed["model"],
        duration_sec=proc_result.duration_sec,
        cost_usd=parsed["cost_usd"],
        session_id=parsed["session_id"],
        num_turns=parsed["num_turns"],
        rate_limit=parsed["rate_limit"],
        raw_json=parsed["raw"],
        error=err,
    )


def _parse_claude_stream(stdout: str) -> dict[str, Any]:
    summary = ""
    cost_usd = 0.0
    model = ""
    session_id: str | None = None
    num_turns = 0
    rate_limit: dict[str, Any] | None = None
    last_result: dict[str, Any] = {}

    text_chunks: list[str] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        ty = obj.get("type")

        if ty == "assistant":
            msg = obj.get("message") or {}
            if not model:
                model = str(msg.get("model") or "")
            if not session_id:
                session_id = obj.get("session_id") or msg.get("session_id")
            for blk in msg.get("content", []) or []:
                if isinstance(blk, dict) and blk.get("type") == "text":
                    txt = blk.get("text") or ""
                    if txt:
                        text_chunks.append(txt)
        elif ty == "result":
            last_result = obj
            if obj.get("result"):
                summary = obj["result"]
            cost_usd = float(obj.get("total_cost_usd") or 0.0)
            num_turns = int(obj.get("num_turns") or 0)
            if not session_id:
                session_id = obj.get("session_id")
        elif ty == "rate_limit_event":
            rate_limit = obj.get("rate_limit_info") or rate_limit

    if not summary and text_chunks:
        summary = "\n".join(text_chunks).strip()

    return {
        "summary": summary,
        "cost_usd": cost_usd,
        "model": model,
        "session_id": session_id,
        "num_turns": num_turns,
        "rate_limit": rate_limit,
        "raw": last_result,
    }


# ---------- Codex (OpenAI ChatGPT) ----------

async def _run_codex(
    prompt: str,
    *,
    cmd: str,
    model: str,
    timeout_sec: int,
    cwd: str | None,
    extra_args: list[str] | None,
) -> LLMResult:
    # `codex exec --json -` 가 stdin 으로 prompt 받는다
    # --skip-git-repo-check : non-git 디렉토리에서도 동작 ("not inside trusted directory" 회피)
    # --sandbox read-only   : 텍스트 생성만 — shell 실행 차단
    # -c approval_policy="never" : 비대화식 (sandbox 권한 프롬프트 차단)
    args = [
        cmd, "exec", "--json",
        "--skip-git-repo-check",
        "--sandbox", "read-only",
        "-c", 'approval_policy="never"',
    ]
    if model:
        args.extend(["--model", model])
    if extra_args:
        args.extend(extra_args)
    args.append("-")  # stdin

    env = {**os.environ}
    # 구독제 강제 — OPENAI_API_KEY 있으면 API 빌링으로 전환됨
    env.pop("OPENAI_API_KEY", None)
    # Codex 가 어떤 변종을 더 본다 (paperclip codex-local 도 동일)
    env.pop("CODEX_API_KEY", None)

    proc_result = await _spawn(args, prompt, env=env, cwd=cwd, timeout_sec=timeout_sec)
    if proc_result.error and not proc_result.stdout:
        return LLMResult(
            ok=False, provider="codex", summary="", model=model,
            duration_sec=proc_result.duration_sec, error=proc_result.error,
        )

    parsed = _parse_codex_jsonl(proc_result.stdout)
    summary = parsed["summary"]
    ok = bool(summary.strip()) and proc_result.returncode == 0 and not parsed["error"]

    err = None
    if not ok:
        err = (
            parsed["error"]
            or _first_nonempty(proc_result.stderr)
            or proc_result.error
            or f"codex exit {proc_result.returncode}"
        )

    return LLMResult(
        ok=ok,
        provider="codex",
        summary=summary,
        model=parsed["model"] or model,
        duration_sec=proc_result.duration_sec,
        input_tokens=parsed["usage"]["input_tokens"],
        cached_input_tokens=parsed["usage"]["cached_input_tokens"],
        output_tokens=parsed["usage"]["output_tokens"],
        session_id=parsed["session_id"],
        num_turns=1 if summary else 0,
        raw_json=parsed["raw"],
        error=err,
    )


def _parse_codex_jsonl(stdout: str) -> dict[str, Any]:
    session_id: str | None = None
    final_message = ""
    model = ""
    error_message: str | None = None
    usage = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0}
    last_event: dict[str, Any] = {}

    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        last_event = ev
        ty = ev.get("type", "")

        if ty == "thread.started":
            session_id = ev.get("thread_id") or session_id
            if not model:
                model = str(ev.get("model") or "")
        elif ty == "item.completed":
            item = ev.get("item") or {}
            if item.get("type") == "agent_message":
                txt = item.get("text") or ""
                if txt:
                    final_message = txt
        elif ty == "turn.completed":
            u = ev.get("usage") or {}
            usage["input_tokens"] = int(u.get("input_tokens") or usage["input_tokens"])
            usage["cached_input_tokens"] = int(
                u.get("cached_input_tokens") or usage["cached_input_tokens"]
            )
            usage["output_tokens"] = int(u.get("output_tokens") or usage["output_tokens"])
        elif ty == "turn.failed":
            err = ev.get("error") or {}
            m = (err.get("message") or "").strip()
            if m:
                error_message = m
        elif ty == "error":
            m = (ev.get("message") or "").strip()
            if m:
                error_message = m

    return {
        "summary": final_message.strip(),
        "session_id": session_id,
        "model": model,
        "usage": usage,
        "error": error_message,
        "raw": last_event,
    }


# ---------- 공통 subprocess ----------

@dataclass(slots=True)
class _ProcResult:
    stdout: str
    stderr: str
    returncode: int
    duration_sec: float
    error: str | None = None


async def _spawn(
    args: list[str],
    prompt: str,
    *,
    env: dict[str, str],
    cwd: str | None,
    timeout_sec: int,
) -> _ProcResult:
    start = time.time()
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            env=env,
        )
    except FileNotFoundError:
        return _ProcResult(
            stdout="", stderr="", returncode=127,
            duration_sec=0.0,
            error=f"binary not found: {args[0]!r}. Run `{args[0]} login` first.",
        )
    except Exception as exc:
        return _ProcResult(
            stdout="", stderr="", returncode=1,
            duration_sec=0.0,
            error=f"spawn failed: {exc}",
        )

    try:
        out_b, err_b = await asyncio.wait_for(
            proc.communicate(prompt.encode("utf-8")),
            timeout=timeout_sec,
        )
    except asyncio.TimeoutError:
        log.warning("subprocess timeout after %ss — killing %s", timeout_sec, args[0])
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        await proc.wait()
        return _ProcResult(
            stdout="", stderr="", returncode=-1,
            duration_sec=time.time() - start,
            error=f"timeout after {timeout_sec}s",
        )

    duration = time.time() - start
    return _ProcResult(
        stdout=out_b.decode("utf-8", "ignore"),
        stderr=err_b.decode("utf-8", "ignore"),
        returncode=proc.returncode if proc.returncode is not None else 1,
        duration_sec=duration,
    )


def _first_nonempty(text: str) -> str | None:
    for line in text.splitlines():
        s = line.strip()
        if s:
            return s
    return None
