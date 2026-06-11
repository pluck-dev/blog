# Next.js 관리자 앱

NestJS `apps/api-nest` 서버를 API 백엔드로 사용하는 Next.js 관리자 UI입니다.

## 실행

터미널 1 — NestJS API + 워커:

```bash
cd /Users/simjaehyeong/Desktop/pluck/tools/seo/apps/api-nest
npm install
API_WORKER=1 npm run dev
```

터미널 2 — Next 관리자:

```bash
cd /Users/simjaehyeong/Desktop/pluck/tools/seo/apps/admin-next
cp .env.example .env.local
npm install
npm run dev
```

`.env.local`:

```bash
SEO_API_BASE_URL=http://127.0.0.1:8765
ADMIN_API_TOKEN=  # Nest API ADMIN_PASSWORD를 쓰면 같은 값 입력
```

Next 앱은 `/api/admin/*` route handler로 Nest API의 `/api/admin/*`를 프록시합니다. 브라우저는 Next 서버만 호출하므로 CORS/토큰 노출을 최소화합니다.

## 포함 화면

- 대시보드: 도메인 생성, 도메인 카드, 최근 작업
- 테넌트 상세: 개요, 기획, 글유형/디자인, 축, 학원자료, 슬롯, 글, 설정
- 작업 큐: 3초 폴링, 상태/진행바, payload/result 확인
- 글 상세: 렌더 HTML 미리보기, Markdown/HTML 다운로드

## 검증

```bash
npm run typecheck
npm run build
npm audit
```
