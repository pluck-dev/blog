# 양산형 SEO 서버 — admin(FastAPI) + worker 공용 이미지.
# 생성은 claude/codex CLI 의 OAuth 구독 인증에 의존하므로 Node + CLI 도 함께 설치한다.
# (실제 생성하려면 인증 파일을 마운트해야 함 — docker-compose.yml 참고)

FROM python:3.12-slim

# Node (claude/codex CLI 용)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# LLM CLI (패키지명/버전은 환경에 맞게 조정 가능)
RUN npm install -g @anthropic-ai/claude-code @openai/codex || \
    echo "[warn] CLI 설치 실패 — 인증 마운트만으로 호스트 바이너리를 쓰거나 수동 설치하세요"

WORKDIR /app

# Python 의존성 먼저(캐시 활용)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 앱 소스
COPY admin ./admin
COPY runtime ./runtime
COPY seed_matrix ./seed_matrix

# DB 는 볼륨으로(SEO_DB_PATH)
ENV SEO_DB_PATH=/data/admin.db \
    ADMIN_HOST=0.0.0.0 \
    ADMIN_PORT=8765 \
    ADMIN_RELOAD=0
VOLUME ["/data"]
EXPOSE 8765

# 기본은 서버. 워커는 compose 에서 command override.
CMD ["python", "-m", "admin"]
