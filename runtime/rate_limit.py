"""레이트리밋 적응 백오프 (TS rate_limit.ts 포팅).

llm.run_llm 이 수집하는 Claude rate_limit_info 를 방어적으로 해석해
다음 슬롯 생성 전 추가 대기 시간을 산출한다. 스키마를 가정하지 않는다.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class RateSignal:
    pressure: float | None      # 0..1 최대 사용률
    status: str | None          # 'allowed' | 'allowed_warning' | 'rejected' 등
    resets_in_sec: int | None   # 리셋까지 남은 초


_PRESSURE_KEY = re.compile(r"util|usage|used|percent|pct", re.I)
_RESET_IN_KEY = re.compile(r"resets?_in(_seconds)?$", re.I)
_RESET_AT_KEY = re.compile(r"resets?_at$|reset_at$|resets$", re.I)


def _to_num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _norm_pressure(v: float) -> float:
    p = v / 100 if v > 1 else v
    return min(max(p, 0.0), 1.0)


def parse_rate_signal(rl: dict | None, now_sec: float | None = None) -> RateSignal:
    if not isinstance(rl, dict):
        return RateSignal(None, None, None)
    now = now_sec if now_sec is not None else time.time()
    max_pressure = -1.0
    status: str | None = None
    resets_in: int | None = None

    def visit(obj: dict, depth: int) -> None:
        nonlocal max_pressure, status, resets_in
        if depth > 3:
            return
        for raw_key, val in obj.items():
            key = str(raw_key).lower()
            if status is None and key == "status" and isinstance(val, str):
                status = val
            if _PRESSURE_KEY.search(key):
                n = _to_num(val)
                if n is not None:
                    max_pressure = max(max_pressure, _norm_pressure(n))
            if resets_in is None:
                if _RESET_IN_KEY.search(key):
                    n = _to_num(val)
                    if n is not None:
                        resets_in = max(0, round(n))
                elif _RESET_AT_KEY.search(key):
                    n = _to_num(val)
                    if n is not None:
                        epoch = n / 1000 if n > 1e12 else n
                        resets_in = max(0, round(epoch - now))
                    elif isinstance(val, str):
                        try:
                            from datetime import datetime
                            t = datetime.fromisoformat(val.replace("Z", "+00:00")).timestamp()
                            resets_in = max(0, round(t - now))
                        except Exception:
                            pass
            if isinstance(val, dict):
                visit(val, depth + 1)

    visit(rl, 0)
    return RateSignal(
        pressure=max_pressure if max_pressure >= 0 else None,
        status=status,
        resets_in_sec=resets_in,
    )


def next_backoff_sec(
    signal: RateSignal,
    prev_sec: int,
    *,
    base_sec: int = 30,
    max_sec: int = 600,
    warn_at: float = 0.75,
    hard_at: float = 0.9,
) -> int:
    def clamp(n: float) -> int:
        return min(max(round(n), 0), max_sec)

    status = signal.status.lower() if signal.status else None
    rejected = status is not None and re.search(r"reject|exceed|throttl|denied|429", status) is not None

    if rejected:
        if signal.resets_in_sec is not None and signal.resets_in_sec > 0:
            return clamp(signal.resets_in_sec)
        return clamp(max(prev_sec * 2, base_sec))
    if signal.pressure is not None and signal.pressure >= hard_at:
        return clamp(max(prev_sec * 2, base_sec))
    if signal.pressure is not None and signal.pressure >= warn_at:
        return clamp(max(prev_sec, base_sec))
    if status is not None and "warn" in status:
        return clamp(max(prev_sec, base_sec))
    return 0
