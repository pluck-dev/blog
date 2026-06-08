"""LLM 으로 업종에 맞는 5축 자동 생성.

사용자가 "강남 치과", "분당 헬스장", "ECU 튜닝" 같은 업종 텍스트만 입력하면
claude / codex 가 5개 축(region/keyword/intent/persona/modifier)에 들어갈
한국어 SEO 키워드 값을 추천. JSON 으로 받아 DB에 적재.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Literal

from . import db
from runtime.llm import run_llm

log = logging.getLogger(__name__)

Provider = Literal["claude", "codex"]


SYSTEM_PROMPT = """당신은 한국어 SEO 전략가입니다.
주어진 업종에 대해 프로그래매틱 SEO 슬롯 생성에 쓸 5개 축의 값을 추천합니다.

축 정의:
- region: 지역(시/군/구). 업종이 지역 비즈니스가 아니면 빈 배열.
- keyword: 핵심 검색 키워드 (메인 + 롱테일). 5~12개.
- intent: 검색 의도 (비교추천/가이드총정리/비용절약/후기리뷰/시험팁/안전성/가격정보 등 업종에 맞게). 4~6개.
- persona: 타깃 고객 페르소나. 4~7개.
- modifier: 마케팅 수식어 (가성비/최단기/친절/24시 등). 5~10개.

각 값에 메타 정보:
- weight: 1~10 (우선순위, 핵심 키워드일수록 높게)
- monthly_search_volume: 추정 월간 검색량 (없으면 null)
- competition_kd: 추정 경쟁 강도 0~100 (없으면 null)

응답은 반드시 JSON 객체 하나만, 다른 설명 없이:
{
  "region": [{"value":"강남","weight":5,"monthly_search_volume":3200,"competition_kd":68}, ...],
  "keyword": [{"value":"강남 임플란트","weight":9,"monthly_search_volume":2400,"competition_kd":55}, ...],
  "intent": [{"value":"비교추천","weight":5}],
  "persona": [{"value":"20대 직장인","weight":5}],
  "modifier": [{"value":"당일진료","weight":4}]
}
"""


def build_prompt(vertical: str, context: str = "") -> str:
    body = f"업종: {vertical}\n"
    if context.strip():
        body += f"추가 컨텍스트: {context.strip()}\n"
    body += "\n위 업종에 가장 맞는 5축 값을 JSON 으로만 답하세요."
    return SYSTEM_PROMPT + "\n\n" + body


def _extract_json(text: str) -> dict | None:
    """LLM 응답에서 JSON 블록을 안전하게 추출."""
    # ```json ... ``` 코드블록 우선
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 첫 { 부터 마지막 } 까지
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None
    return None


def _normalize_value(v) -> dict | None:
    """LLM이 만든 값 항목을 표준 형태로 정리."""
    if isinstance(v, str):
        return {"value": v.strip(), "weight": 3,
                "monthly_search_volume": None, "competition_kd": None}
    if not isinstance(v, dict):
        return None
    value = (v.get("value") or "").strip()
    if not value:
        return None
    weight = v.get("weight")
    try:
        weight = int(weight) if weight is not None else 3
    except (TypeError, ValueError):
        weight = 3
    weight = max(1, min(10, weight))

    sv = v.get("monthly_search_volume")
    try:
        sv = int(sv) if sv is not None else None
    except (TypeError, ValueError):
        sv = None
    kd = v.get("competition_kd")
    try:
        kd = int(kd) if kd is not None else None
    except (TypeError, ValueError):
        kd = None

    return {"value": value, "weight": weight,
            "monthly_search_volume": sv, "competition_kd": kd}


async def generate_axes(
    *, tenant: str, vertical: str, context: str = "",
    provider: Provider = "claude", model: str = "",
    timeout_sec: int = 300,
) -> dict:
    """LLM 호출 → 결과 파싱 → DB 적재. 반환: 축별 적재 개수."""
    prompt = build_prompt(vertical, context)
    log.info("ai-axes call: tenant=%s vertical=%r provider=%s",
             tenant, vertical, provider)

    result = await run_llm(prompt, provider=provider, model=model,
                            timeout_sec=timeout_sec)
    if not result.ok or not result.summary.strip():
        raise RuntimeError(
            f"LLM call failed: {result.error or 'empty response'}"
        )

    parsed = _extract_json(result.summary)
    if not parsed:
        raise RuntimeError(
            "Could not parse JSON from LLM response: "
            + result.summary[:300]
        )

    summary: dict[str, int] = {}
    for axis in ("region", "keyword", "intent", "persona", "modifier"):
        raw_values = parsed.get(axis) or []
        if not isinstance(raw_values, list):
            continue
        normalized = [_normalize_value(v) for v in raw_values]
        normalized = [v for v in normalized if v]
        if not normalized:
            summary[axis] = 0
            continue
        db.bulk_replace_axis(tenant=tenant, axis=axis, values=normalized)
        summary[axis] = len(normalized)

    summary["_provider"] = result.provider
    summary["_model"] = result.model
    summary["_duration_sec"] = round(result.duration_sec, 1)
    return summary
