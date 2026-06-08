"""슬롯 CSV 로더 + 파일 기반 상태 저장.

DB(Supabase) 도입 전까지는 output/state.json 으로 슬롯별 status 추적.
나중에 Postgres 로 옮길 때 같은 인터페이스(next_planned/mark_published/mark_failed)
를 유지하면 호출부 수정 없이 갈아끼울 수 있다.
"""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

RUNTIME_DIR = Path(__file__).resolve().parent
PROJECT_DIR = RUNTIME_DIR.parent
OUTPUT_DIR = PROJECT_DIR / "output"
STATE_FILE = OUTPUT_DIR / "state.json"
DEFAULT_SLOTS_CSV = PROJECT_DIR / "seed_matrix" / "04_seed_matrix_example.csv"


@dataclass(slots=True)
class Slot:
    slot_id: str
    template_id: str
    primary_keyword: str
    region: str = ""
    persona: str = ""
    intent: str = ""
    modifier_1: str = ""
    modifier_2: str = ""
    entity_id: str = ""
    priority_score: float = 0.0
    title_pattern_seed: str = ""

    @classmethod
    def from_row(cls, row: dict) -> "Slot":
        return cls(
            slot_id=row.get("slot_id", "").strip(),
            template_id=row.get("template_id", "").strip(),
            primary_keyword=row.get("primary_keyword", "").strip(),
            region=row.get("region", "").strip(),
            persona=row.get("persona", "").strip(),
            intent=row.get("intent", "").strip(),
            modifier_1=row.get("modifier_1", "").strip(),
            modifier_2=row.get("modifier_2", "").strip(),
            entity_id=row.get("entity_id", "").strip(),
            priority_score=_to_float(row.get("priority_score")),
            title_pattern_seed=row.get("title_pattern_seed", "").strip(),
        )

    def to_dict(self) -> dict:
        return {
            "slot_id": self.slot_id,
            "template_id": self.template_id,
            "primary_keyword": self.primary_keyword,
            "region": self.region,
            "persona": self.persona,
            "intent": self.intent,
            "modifier_1": self.modifier_1,
            "modifier_2": self.modifier_2,
            "entity_id": self.entity_id,
            "priority_score": self.priority_score,
            "title_pattern_seed": self.title_pattern_seed,
        }


def _to_float(v) -> float:
    try:
        return float(v) if v not in (None, "", "None") else 0.0
    except (TypeError, ValueError):
        return 0.0


# ---------- 상태 파일 ----------

def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


def get_status(slot_id: str) -> str:
    """planned / in_progress / published / failed."""
    return _load_state().get(slot_id, {}).get("status", "planned")


def set_status(slot_id: str, status: str, **extra) -> None:
    state = _load_state()
    record = state.get(slot_id, {})
    record["status"] = status
    record.update(extra)
    state[slot_id] = record
    _save_state(state)


def mark_in_progress(slot_id: str) -> None:
    set_status(slot_id, "in_progress")


def mark_published(slot_id: str, *, path: str, cost_usd: float, duration_sec: float,
                   model: str, session_id: str | None) -> None:
    set_status(
        slot_id,
        "published",
        path=path,
        cost_usd=cost_usd,
        duration_sec=duration_sec,
        model=model,
        session_id=session_id,
    )


def mark_failed(slot_id: str, error: str) -> None:
    set_status(slot_id, "failed", error=error)


# ---------- CSV 로딩 ----------

def load_slots(csv_path: Path | str = DEFAULT_SLOTS_CSV) -> list[Slot]:
    p = Path(csv_path)
    if not p.exists():
        raise FileNotFoundError(f"slots CSV not found: {p}")
    out: list[Slot] = []
    with p.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            s = Slot.from_row(row)
            if s.slot_id and s.template_id and s.primary_keyword:
                out.append(s)
    return out


def iter_planned(
    csv_path: Path | str = DEFAULT_SLOTS_CSV,
    *,
    templates: Iterable[str] | None = None,
    min_priority: float = 0.0,
    limit: int | None = None,
) -> list[Slot]:
    """priority 내림차순 + planned 상태만 반환."""
    state = _load_state()
    all_slots = load_slots(csv_path)
    pool = []
    template_set = set(templates) if templates else None
    for s in all_slots:
        if template_set and s.template_id not in template_set:
            continue
        if s.priority_score < min_priority:
            continue
        st = state.get(s.slot_id, {}).get("status", "planned")
        if st != "planned":
            continue
        pool.append(s)
    pool.sort(key=lambda x: x.priority_score, reverse=True)
    if limit is not None:
        pool = pool[:limit]
    return pool


def get_slot_by_id(slot_id: str, csv_path: Path | str = DEFAULT_SLOTS_CSV) -> Slot | None:
    for s in load_slots(csv_path):
        if s.slot_id == slot_id:
            return s
    return None
