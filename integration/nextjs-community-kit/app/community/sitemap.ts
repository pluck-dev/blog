/**
 * /community/sitemap.xml — Next.js Metadata 사이트맵.
 * 중앙 API의 발행글로 동적 사이트맵 생성(검색엔진 색인용).
 *
 * 사이트 루트 sitemap 과 합치려면 app/sitemap.ts 에서 이 결과를 병합하세요.
 */

import type { MetadataRoute } from "next";
import { listAllSlugs } from "../../lib/content-api";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.SITE_BASE_URL ?? "").replace(/\/$/, "");
  const slugs = await listAllSlugs(5000).catch(() => []);
  return slugs.map((slug) => ({
    url: `${base}/community/${slug}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
}
