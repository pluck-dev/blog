# 배포 / 실행 가이드

양산형 SEO 서버는 **admin(FastAPI 웹+공개 API)** 와 **worker(잡 처리)** 2개 프로세스로 구성되며, 같은 SQLite DB를 공유한다.

## 1. 로컬 실행 (개발/테스트 — 권장)

```bash
# 최초 1회
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env        # 필요 값 채우기

# 실행 (서버 + 워커 한 번에, Ctrl-C 로 같이 종료)
./dev.sh
```
→ http://127.0.0.1:8765

LLM 생성은 호스트의 `claude` / `codex` CLI 구독 로그인이 되어 있어야 한다:
```bash
claude    # claude.ai 로그인 확인
codex     # ChatGPT 로그인 확인
```

## 2. Docker 실행 (서버 배포)

```bash
cp .env.example .env        # 운영 값 설정 (ADMIN_PASSWORD 필수!)
docker compose up --build
```
- `server` + `worker` 2서비스가 `seo-db` 볼륨(`/data/admin.db`)을 공유.
- 공개 API: `http://<host>:8765/api/v1/{domain}/posts`

### ⚠️ 생성(LLM) 인증 — 가장 중요한 주의점
컨테이너 안에서 글을 생성하려면 `claude`/`codex` CLI 의 **구독 OAuth 인증**이 필요하다. 두 가지 방법:

1. **호스트 인증 마운트** (같은 머신에서 돌릴 때): `docker-compose.yml` 의 volumes 주석을 해제
   ```yaml
   - ${HOME}/.claude:/root/.claude:ro
   - ${HOME}/.codex:/root/.codex:ro
   ```
   (토큰이 머신에 묶여 있을 수 있어 원격 서버에선 안 될 수 있음)

2. **컨테이너 내 로그인**: 컨테이너에 들어가 `claude` / `codex` 로 직접 로그인 후 토큰을 볼륨에 영속화.

> 참고: 구독 CLI 를 서버에서 자동화하는 것은 각 사 약관 회색지대다. 안정적 운영이 필요하면 API 키 방식으로 전환하는 것을 검토.

## 3. 환경변수 (요약)
`.env.example` 참고. 핵심:
- `ADMIN_PASSWORD` — 운영 필수(웹 UI 보호)
- `PUBLIC_API_ORIGINS` — 공개 API CORS 를 발행 도메인으로 제한
- `INGEST_TOKEN` — 학원데이터 수신 API 보호
- `SEO_DB_PATH` — DB 위치(도커는 `/data/admin.db`)
- `SEO_QUALITY_MIN_TEXT_CHARS` — 품질 최소 분량(기본 1500)
- `UNSPLASH_ACCESS_KEY` / `PEXELS_API_KEY` — 이미지 자동수집(선택)

## 4. 발행 연동(Pull)
- 공개 API: `/api/v1/{domain}/posts`, `/posts/{slug}`, `/sitemap.xml`
- `integration/nextjs-community-kit/` 를 발행 사이트의 `/community` 에 복붙
- 색인 URL 템플릿: `https://{domain}/community/{slug}`

## 5. 운영 체크리스트
- [ ] `ADMIN_PASSWORD` 설정
- [ ] `PUBLIC_API_ORIGINS` 를 실제 도메인으로 제한
- [ ] DB 볼륨 백업 전략
- [ ] LLM 인증 영속화(위 2)
- [ ] (대규모 시) SQLite → Postgres 마이그레이션 검토 (스키마는 호환 설계됨)
