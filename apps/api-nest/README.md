# SEO API Nest

프로젝트의 단일 백엔드인 NestJS API/워커입니다. 기존 SQLite DB(`data/admin.db`)를 그대로 사용합니다.

```bash
cd apps/api-nest
npm install
npm run dev
```

기본 주소: `http://127.0.0.1:8765`

워커까지 한 프로세스로 같이 띄우려면:

```bash
API_WORKER=1 npm run dev
```

워커만 별도 실행:

```bash
npm run worker
```
