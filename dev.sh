#!/usr/bin/env bash
# 로컬 개발용 — 서버 + 워커를 한 번에 띄우고, Ctrl-C 로 같이 종료.
#
#   ./dev.sh
#
# .env 파일이 있으면 자동 로드. venv 가 없으면 안내.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  echo "[dev] .venv 가 없습니다. 먼저:"
  echo "    python3 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"
  exit 1
fi

if [ -f .env ]; then
  echo "[dev] .env 로드"
  set -a; . ./.env; set +a
fi

# 개발 스크립트는 깔끔한 종료를 위해 reload 기본 off (.env 에서 켜면 유지)
export ADMIN_RELOAD="${ADMIN_RELOAD:-0}"

PY=.venv/bin/python

echo "[dev] 서버 기동 → http://${ADMIN_HOST:-127.0.0.1}:${ADMIN_PORT:-8765}"
$PY -m admin &
SERVER=$!

echo "[dev] 워커 기동"
$PY -m admin.worker &
WORKER=$!

# Ctrl-C 면 서버+워커(+자식) 같이 정리 (bash 3.2 호환 — wait -n 미사용)
cleanup() {
  echo; echo "[dev] 종료 중..."
  pkill -P "$SERVER" 2>/dev/null || true
  pkill -P "$WORKER" 2>/dev/null || true
  kill "$SERVER" "$WORKER" 2>/dev/null || true
}
trap cleanup INT TERM

echo "[dev] 실행 중 — 종료하려면 Ctrl-C"
wait
