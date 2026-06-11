/**
 * /community/[slug] 상세 페이지 (App Router, ISR).
 * 중앙 API에서 글 상세를 가져와 디자인 템플릿 + 마크다운 렌더러로 렌더한다.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPost, listAllSlugs } from "../../../lib/content-api";
import { DesignLayout } from "../../../components/design-templates";
import { PostRenderer } from "../../../components/PostRenderer";

export const revalidate = 3600;
// 새 글은 ISR(fallback)로 첫 요청 시 생성. 빌드 타임 정적 생성을 원하면 dynamicParams 유지.
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await listAllSlugs(1000).catch(() => []);
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "글을 찾을 수 없음" };
  return {
    title: post.title,
    description: post.meta_description ?? undefined,
    openGraph: { title: post.title, description: post.meta_description ?? undefined, type: "article" },
  };
}

export default async function CommunityPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();
  const bodyHtml = stripLeadingH1(post.body_html);

  return (
    <DesignLayout designId={post.design_template_id} title={post.title} ctaHref="/contact">
      {bodyHtml ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} /> : <PostRenderer markdown={post.body_markdown} images={post.images ?? {}} />}
    </DesignLayout>
  );
}

function stripLeadingH1(html: string | null | undefined): string {
  return String(html || "").trim().replace(/^<h1>[\s\S]*?<\/h1>\s*/i, "");
}
