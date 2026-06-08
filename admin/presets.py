"""수직 카테고리별 축 프리셋.

운전선생 분석을 기반으로 한 운전면허 프리셋이 가장 충실.
나머지는 골격만 — 사용자가 관리자 UI에서 추가/편집.
"""

from __future__ import annotations

from . import db


PRESETS: dict[str, dict[str, list[dict]]] = {
    "driving": {
        "region": [
            {"value": "수원", "weight": 5, "monthly_search_volume": 2400, "competition_kd": 42},
            {"value": "안산", "weight": 5, "monthly_search_volume": 1800, "competition_kd": 38},
            {"value": "인천", "weight": 5, "monthly_search_volume": 2600, "competition_kd": 45},
            {"value": "강남", "weight": 4, "monthly_search_volume": 3200, "competition_kd": 68},
            {"value": "부산", "weight": 5, "monthly_search_volume": 2800, "competition_kd": 40},
            {"value": "대구", "weight": 5, "monthly_search_volume": 2100, "competition_kd": 38},
            {"value": "광주", "weight": 4, "monthly_search_volume": 1500, "competition_kd": 35},
            {"value": "대전", "weight": 4, "monthly_search_volume": 1700, "competition_kd": 36},
            {"value": "성남", "weight": 3, "monthly_search_volume": 1100, "competition_kd": 38},
            {"value": "용인", "weight": 3, "monthly_search_volume": 900, "competition_kd": 34},
        ],
        "keyword": [
            {"value": "운전면허학원", "weight": 10, "monthly_search_volume": 9900, "competition_kd": 55},
            {"value": "자동차학원", "weight": 8, "monthly_search_volume": 5400, "competition_kd": 48},
            {"value": "1종보통", "weight": 6, "monthly_search_volume": 3600, "competition_kd": 42},
            {"value": "2종보통", "weight": 6, "monthly_search_volume": 5400, "competition_kd": 40},
            {"value": "운전면허 비용", "weight": 7, "monthly_search_volume": 4400, "competition_kd": 38},
            {"value": "운전면허 필기시험", "weight": 8, "monthly_search_volume": 8100, "competition_kd": 40},
            {"value": "운전연수", "weight": 6, "monthly_search_volume": 9900, "competition_kd": 42},
        ],
        "intent": [
            {"value": "비교추천", "weight": 5},
            {"value": "가이드총정리", "weight": 5},
            {"value": "비용절약", "weight": 4},
            {"value": "후기리뷰", "weight": 3},
            {"value": "시험팁", "weight": 4},
        ],
        "persona": [
            {"value": "직장인", "weight": 5},
            {"value": "대학생", "weight": 5},
            {"value": "사회초년생", "weight": 4},
            {"value": "주부", "weight": 3},
            {"value": "노년층", "weight": 3},
            {"value": "초보운전자", "weight": 4},
        ],
        "modifier": [
            {"value": "최단기", "weight": 4},
            {"value": "비용절약", "weight": 4},
            {"value": "셔틀편리", "weight": 4},
            {"value": "야간반", "weight": 3},
            {"value": "주말반", "weight": 3},
            {"value": "합격률높은", "weight": 4},
            {"value": "가성비", "weight": 4},
        ],
    },
    "car-mapping": {
        "region": [
            {"value": "강남", "weight": 5, "monthly_search_volume": 1800, "competition_kd": 55},
            {"value": "분당", "weight": 5, "monthly_search_volume": 900, "competition_kd": 40},
            {"value": "송파", "weight": 4, "monthly_search_volume": 700, "competition_kd": 42},
            {"value": "부천", "weight": 4, "monthly_search_volume": 600, "competition_kd": 35},
            {"value": "수원", "weight": 4, "monthly_search_volume": 800, "competition_kd": 38},
            {"value": "부산", "weight": 4, "monthly_search_volume": 900, "competition_kd": 42},
        ],
        "keyword": [
            {"value": "ECU 맵핑", "weight": 10, "monthly_search_volume": 2400, "competition_kd": 35},
            {"value": "ECU 튜닝", "weight": 9, "monthly_search_volume": 3300, "competition_kd": 40},
            {"value": "리맵핑", "weight": 7, "monthly_search_volume": 1500, "competition_kd": 30},
            {"value": "Stage 1 맵핑", "weight": 6, "monthly_search_volume": 700, "competition_kd": 25},
            {"value": "DPF 클리닝", "weight": 7, "monthly_search_volume": 1800, "competition_kd": 30},
            {"value": "연비맵", "weight": 6, "monthly_search_volume": 600, "competition_kd": 25},
            {"value": "디젤 튜닝", "weight": 5, "monthly_search_volume": 800, "competition_kd": 30},
        ],
        "intent": [
            {"value": "비교추천", "weight": 5},
            {"value": "가격정보", "weight": 5},
            {"value": "후기리뷰", "weight": 4},
            {"value": "효과분석", "weight": 4},
            {"value": "안전성검토", "weight": 4},
            {"value": "규제정보", "weight": 3},
        ],
        "persona": [
            {"value": "출퇴근차주", "weight": 5},
            {"value": "장거리운행자", "weight": 4},
            {"value": "튜닝매니아", "weight": 4},
            {"value": "화물차주", "weight": 3},
            {"value": "영업용", "weight": 3},
            {"value": "BMW오너", "weight": 3},
            {"value": "벤츠오너", "weight": 3},
        ],
        "modifier": [
            {"value": "다이노실측", "weight": 4},
            {"value": "보증유지", "weight": 4},
            {"value": "연비개선", "weight": 4},
            {"value": "출력증가", "weight": 4},
            {"value": "Stage1", "weight": 3},
            {"value": "Stage2", "weight": 3},
        ],
    },
    "general": {
        "region": [], "keyword": [], "intent": [
            {"value": "비교추천", "weight": 5},
            {"value": "가이드총정리", "weight": 5},
        ],
        "persona": [{"value": "일반", "weight": 5}],
        "modifier": [],
    },
}

# 외부에서 vertical → preset key 매핑
VERTICAL_TO_PRESET = {
    "driving": "driving",
    "car-mapping": "car-mapping",
    "gym": "general",
    "academy": "general",
    "general": "general",
}


def apply(domain: str, key: str) -> dict[str, int]:
    """프리셋을 테넌트의 axes 에 적용 (덮어쓰기). 반환: 축별 적용 개수."""
    preset_key = VERTICAL_TO_PRESET.get(key, key)
    preset = PRESETS.get(preset_key)
    if preset is None:
        return {}
    summary: dict[str, int] = {}
    for axis, values in preset.items():
        if not values:
            continue
        db.bulk_replace_axis(tenant=domain, axis=axis, values=values)
        summary[axis] = len(values)
    return summary
