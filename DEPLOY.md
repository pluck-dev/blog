# 배포 / 실행

현재 기준 백엔드는 **NestJS API + Nest worker**입니다. Python FastAPI/Jinja와 Electron 관리자는 제거했고, 새 관리자/공개 API의 실행 기준은 `apps/api-nest`입니다.

## 로컬 개발

가장 간단한 실행:

```bash
./dev.sh
```

수동 실행:

```bash
# 터미널 1 — Nest API + worker
cd apps/api-nest
npm install
API_WORKER=1 npm run dev

# 터미널 2 — Next 관리자
cd ../admin-next
npm install
SEO_API_BASE_URL=http://127.0.0.1:8765 npm run dev
```

주소:

- Nest API: `http://127.0.0.1:8765`
- Next 관리자: `http://localhost:3001`
- 공개 API: `http://127.0.0.1:8765/api/v1/{domain}/posts`

## Docker

```bash
cp .env.example .env
# ADMIN_PASSWORD 등 수정
docker compose up --build
```

SQLite DB는 `seo-db` 볼륨의 `/data/admin.db`에 저장됩니다.

## 인증

`ADMIN_PASSWORD`를 설정하면 관리자 API는 아래 중 하나가 필요합니다.

- cookie `admin_token`
- `x-admin-token`
- `Authorization: Bearer`

Next 관리자 프록시는 `.env.local`의 `ADMIN_API_TOKEN` 값을 API로 전달합니다.
