import PostDetailClient from "@/components/PostDetailClient";

export default async function PostPage({ params }: { params: Promise<{ domain: string; postId: string }> }) {
  const { domain, postId } = await params;
  return <PostDetailClient domain={decodeURIComponent(domain)} postId={postId} />;
}
