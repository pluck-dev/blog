/**
 * 중앙 콘텐츠 API(Pull) fetch 레이어.
 *
 * NestJS SEO API가 제공하는 읽기 전용 API에서 발행글을 가져온다.
 * 타깃 사이트(예: academy.drivingplus.me)의 /community 라우트가 이걸 호출해
 * 자기 디자인 컴포넌트로 렌더한다.
 *
 * 환경변수:
 *   CONTENT_API_BASE   예) https://admin.yourserver.com   (admin 서버 주소)
 *   CONTENT_API_DOMAIN 예) academy.drivingplus.me         (이 사이트의 테넌트 도메인)
 *   CONTENT_REVALIDATE 초 단위 ISR 재검증 주기(기본 3600)
 */

const BASE = (process.env.CONTENT_API_BASE ?? "").replace(/\/$/, "");
const DOMAIN = process.env.CONTENT_API_DOMAIN ?? "";
const REVALIDATE = Number(process.env.CONTENT_REVALIDATE ?? "3600");

export interface PostListItem {
  slug: string;
  title: string;
  meta_description: string | null;
  design_template_id: string;
  generated_at: string;
}

export interface PostDetail extends PostListItem {
  body_markdown: string;
  /** API가 렌더링한 HTML. 있으면 마크다운 렌더러 대신 우선 사용한다. */
  body_html?: string;
  /** 이미지 슬롯 kind → CDN URL (키 미설정 시 빈 객체) */
  images?: Record<string, string>;
}

function assertConfigured(): void {
  if (!BASE || !DOMAIN) {
    throw new Error(
      "콘텐츠 API 미설정: CONTENT_API_BASE / CONTENT_API_DOMAIN 환경변수를 설정하세요.",
    );
  }
}

async function api<T>(path: string): Promise<T> {
  assertConfigured();
  const res = await fetch(`${BASE}/api/v1/${encodeURIComponent(DOMAIN)}${path}`, {
    next: { revalidate: REVALIDATE },
  });
  if (!res.ok) throw new Error(`content api ${res.status}: ${path}`);
  return (await res.json()) as T;
}

/** 발행글 목록(본문 제외). */
export async function listPosts(params: { limit?: number; offset?: number } = {}): Promise<PostListItem[]> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;
  const data = await api<{ items: PostListItem[] }>(`/posts?limit=${limit}&offset=${offset}`);
  return data.items;
}

/** 발행글 상세(본문 포함). 없으면 null. */
export async function getPost(slug: string): Promise<PostDetail | null> {
  try {
    const data = await api<{ post: PostDetail; body_html?: string }>(`/posts/${encodeURIComponent(slug)}?include_rendered=true`);
    return { ...data.post, body_html: data.body_html };
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

/** generateStaticParams 용 — 전체 슬러그(상한). */
export async function listAllSlugs(max = 1000): Promise<string[]> {
  const out: string[] = [];
  const pageSize = 200;
  for (let offset = 0; offset < max; offset += pageSize) {
    const items = await listPosts({ limit: pageSize, offset });
    out.push(...items.map((i) => i.slug));
    if (items.length < pageSize) break;
  }
  return out;
}
