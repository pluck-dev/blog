# Next.js 커뮤니티 통합 키트 (Pull 발행)

양산 API(이 레포의 `apps/api-nest` NestJS)가 만든 발행글을, **운영 중인 Next.js 사이트**(예: `academy.drivingplus.me`)의 `/community` 라우트에 **API로 가져와(Pull) 그 사이트의 디자인으로 렌더**하기 위한 복붙용 키트입니다.

> 핵심: 콘텐츠(데이터)는 중앙 API에서 오고, **디자인은 타깃 사이트가 소유**합니다. 그래서 테넌트(도메인)마다 다른 디자인이 가능 = SaaS.

## 아키텍처

```
[NestJS SEO API (호스팅)]
   └─ GET /api/v1/{domain}/posts        목록
   └─ GET /api/v1/{domain}/posts/{slug} 상세
   └─ GET /api/v1/{domain}/sitemap.xml  사이트맵
            │  (HTTP fetch, ISR 캐시)
            ▼
[타깃 Next.js 사이트  academy.drivingplus.me]
   app/community/page.tsx          목록
   app/community/[slug]/page.tsx   상세 → DesignLayout + PostRenderer
            │
            ▼
   구글/네이버 색인 (관리자의 indexing 잡이 URL 제출)
```

## 파일 구성

```
lib/content-api.ts               중앙 API fetch + 타입 (ISR 포함)
components/PostRenderer.tsx       마크다운→React (IMAGE/TABLE/INTERNAL_LINK/출처·참고자료/표)
components/design-templates.tsx   디자인 5종(editorial/comparison/local-guide/checklist/conversion)
app/community/page.tsx            목록 라우트
app/community/[slug]/page.tsx     상세 라우트 (generateMetadata/StaticParams)
app/community/sitemap.ts          /community 사이트맵
styles/community.css              기본 스타일(교체 가능)
.env.example                      환경변수 예시
```

## 설치 (타깃 레포에서)

1. **파일 복사**: `lib/`, `components/`, `app/community/`, `styles/` 를 타깃 Next.js 프로젝트(App Router)로 복사.
   - 이미 `app/` 구조가 있으면 `app/community/` 폴더만 통째로 넣으면 됩니다.
   - import 경로(`../../lib/...`)는 타깃 구조에 맞게 조정하거나 `@/` 별칭으로 바꾸세요.

2. **CSS 연결**: 루트 레이아웃(`app/layout.tsx`)에서 `import "../styles/community.css";` (또는 글로벌 CSS에 합치기).

3. **환경변수**: `.env.example` 참고해 `.env.local`(또는 배포 환경변수) 설정.
   - `CONTENT_API_BASE` = admin 서버 주소
   - `CONTENT_API_DOMAIN` = 이 사이트의 테넌트 도메인(관리자에 등록한 값)

4. **빌드/배포**: 평소처럼 `next build` → Vercel/기존 배포. ISR(`revalidate=3600`)로 1시간마다 새 글 반영.

## 동작 방식

- **목록** `/community`: 발행글 카드 목록.
- **상세** `/community/{slug}`: `design_template_id` 에 맞는 디자인 셸(`DesignLayout`) 안에 본문(`PostRenderer`)을 렌더.
- **출처/참고자료**: 본문의 `[1]` 인용은 위첨자로, `## 참고자료` 섹션의 URL은 자동 링크로 렌더.
- **이미지 슬롯**: 기본은 자리표시(`.image-slot`). 실제 이미지를 쓰려면 `<PostRenderer images={{ hero: url, ... }} />` 로 매핑 전달.
- **CTA 링크**: `DesignLayout ctaHref="/contact"` 를 타깃 사이트의 예약/상담 경로로 바꾸세요.
- **브랜드명**: `DesignLayout brand="..."` (기본 "운전면허플러스").

## 디자인 커스터마이즈 (테넌트별)

`components/design-templates.tsx` 의 `SPECS` 색상/문구를 바꾸거나, `DesignLayout` 을 타깃 사이트 컴포넌트로 교체하면 됩니다. 콘텐츠 데이터 구조는 그대로 두고 **이 파일만 갈아끼우면** 다른 업체용 디자인이 됩니다.

## 색인(Indexing) 연동

관리자의 `indexing` 잡이 `https://{domain}/community/{slug}` URL을 구글 Indexing API로 제출합니다.
→ 관리자 설정의 **발행 URL 템플릿**을 `https://{domain}/community/{slug}` 로 맞추세요.
→ 서비스계정 이메일을 이 사이트의 **Search Console 속성에 소유자**로 추가해야 실제 제출이 동작합니다.

## 주의

- 이 키트는 **타깃 레포에서 빌드**됩니다(이 레포엔 Next.js 의존성이 없어 여기선 빌드 안 함).
- App Router(Next 13+) 기준. `params` 가 Promise 인 Next 15 시그니처를 사용했으니, Next 13/14면 `params` 를 동기 객체로 바꾸세요(`{ params: { slug } }`).
- API는 인증 없는 공개 읽기 전용입니다. 노출 도메인을 좁히려면 admin 서버에서 `PUBLIC_API_ORIGINS` 로 CORS 제한.
