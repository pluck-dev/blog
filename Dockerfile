# 양산형 SEO 서버 — NestJS API + worker 공용 이미지.
# 생성은 claude/codex CLI 의 OAuth 구독 인증에 의존한다.
# 실제 생성하려면 인증 파일을 docker-compose.yml 에서 마운트한다.

FROM node:25-slim

RUN npm install -g @anthropic-ai/claude-code @openai/codex || \
    echo "[warn] CLI 설치 실패 — 인증 마운트만으로 호스트 바이너리를 쓰거나 수동 설치하세요"

WORKDIR /app

COPY apps/api-nest/package*.json ./apps/api-nest/
RUN cd apps/api-nest && npm ci

COPY apps/api-nest ./apps/api-nest
RUN cd apps/api-nest && npm run build

ENV SEO_DB_PATH=/data/admin.db \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=8765 \
    API_WORKER=1
VOLUME ["/data"]
EXPOSE 8765

CMD ["node", "apps/api-nest/dist/main.js"]
