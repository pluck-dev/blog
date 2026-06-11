#!/usr/bin/env bash
# 로컬 개발용 — NestJS API(+워커) + Next 관리자 동시 실행.
#
#   ./dev.sh
#
# .env 파일이 있으면 자동 로드.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  echo "[dev] .env 로드"
  set -a; . ./.env; set +a
fi

if [ ! -d apps/api-nest/node_modules ]; then
  echo "[dev] apps/api-nest 의존성 설치"
  (cd apps/api-nest && npm install)
fi
if [ ! -d apps/admin-next/node_modules ]; then
  echo "[dev] apps/admin-next 의존성 설치"
  (cd apps/admin-next && npm install)
fi

export ADMIN_HOST="${ADMIN_HOST:-127.0.0.1}"
export ADMIN_PORT="${ADMIN_PORT:-8765}"
export SEO_API_BASE_URL="${SEO_API_BASE_URL:-http://${ADMIN_HOST}:${ADMIN_PORT}}"
export API_WORKER="${API_WORKER:-1}"

echo "[dev] Nest API 기동 → ${SEO_API_BASE_URL}"
(cd apps/api-nest && npm run dev) &
API=$!

echo "[dev] Next 관리자 기동 → http://localhost:3001"
(cd apps/admin-next && SEO_API_BASE_URL="$SEO_API_BASE_URL" npm run dev) &
NEXT=$!

cleanup() {
  echo; echo "[dev] 종료 중..."
  pkill -P "$API" 2>/dev/null || true
  pkill -P "$NEXT" 2>/dev/null || true
  kill "$API" "$NEXT" 2>/dev/null || true
}
trap cleanup INT TERM

echo "[dev] 실행 중 — 종료하려면 Ctrl-C"
wait
