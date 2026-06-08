/**
 * /community 목록 페이지 (App Router, ISR).
 * 중앙 API에서 발행글 목록을 가져와 카드/링크로 보여준다.
 */

import Link from "next/link";
import type { Metadata } from "next";
import { listPosts } from "../../lib/content-api";

// ISR: content-api.ts 의 CONTENT_REVALIDATE 와 맞춰 1시간마다 갱신
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "커뮤니티",
  description: "운전면허 학원 정보, 비교, 가이드 모음",
};

export default async function CommunityListPage() {
  const posts = await listPosts({ limit: 50 });

  return (
    <main className="community-list">
      <h1>커뮤니티</h1>
      {posts.length === 0 && <p className="empty">아직 발행된 글이 없습니다.</p>}
      <ul className="post-grid">
        {posts.map((p) => (
          <li key={p.slug} className="post-card">
            <Link href={`/community/${p.slug}`}>
              <h2>{p.title}</h2>
              {p.meta_description && <p>{p.meta_description}</p>}
              <time dateTime={p.generated_at}>{(p.generated_at || "").slice(0, 10)}</time>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
