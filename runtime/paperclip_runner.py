"""백워드 호환 shim — 신규 코드는 `runtime.llm.run_llm()` 사용 권장.

기존에 `from runtime.paperclip_runner import run_claude, ClaudeResult` 형태로
임포트하던 외부 스크립트가 깨지지 않도록 유지.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .llm import LLMResult, run_llm


@dataclass(slots=True)
class ClaudeResult:
    """과거 인터페이스 형태. 내부적으로는 LLMResult 를 미러링."""
    ok: bool
    summary: str
    cost_usd: float
    duration_sec: float
    model: str
    raw_json: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    session_id: str | None = None
    num_turns: int = 0
    rate_limit: dict[str, Any] | None = None

    @classmethod
    def from_llm(cls, r: LLMResult) -> "ClaudeResult":
        return cls(
            ok=r.ok,
            summary=r.summary,
            cost_usd=r.cost_usd,
            duration_sec=r.duration_sec,
            model=r.model,
            raw_json=r.raw_json,
            error=r.error,
            session_id=r.session_id,
            num_turns=r.num_turns,
            rate_limit=r.rate_limit,
        )


async def run_claude(
    prompt: str,
    *,
    cmd: str = "claude",
    model: str = "",
    timeout_sec: int = 600,
    cwd: str | None = None,
    extra_args: list[str] | None = None,
    allowed_tools: list[str] | None = None,
) -> ClaudeResult:
    """[DEPRECATED] 새 코드는 `llm.run_llm(provider='claude', ...)` 사용."""
    r = await run_llm(
        prompt,
        provider="claude",
        cmd=cmd,
        model=model,
        timeout_sec=timeout_sec,
        cwd=cwd,
        extra_args=extra_args,
        allowed_tools=allowed_tools,
    )
    return ClaudeResult.from_llm(r)
