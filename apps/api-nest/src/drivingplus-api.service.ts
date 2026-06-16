import { Injectable } from "@nestjs/common";

export type SeoRegionLevel = "all" | "2" | "3";

export interface DrivingplusAcademy {
  id: number;
  title: string;
  seoTitle?: string | null;
  seoKeywords?: string | null;
  seoDescription?: string | null;
  roadAddress?: string | null;
  phone?: string | null;
  vphone?: string | null;
  roadLatitude?: number | null;
  roadLongitude?: number | null;
  thumbSavePath?: string | null;
  type?: string | null;
  photos?: string[];
  reviews?: DrivingplusReview[];
  blogReviews?: DrivingplusBlogReview[];
}

export interface DrivingplusReview {
  id?: number | null;
  author?: string | null;
  point?: number | null;
  content: string;
  date?: string | null;
}

export interface DrivingplusBlogReview {
  title: string;
  content?: string | null;
  link?: string | null;
  postdate?: string | null;
  images?: string[];
}

export interface DrivingplusSeoRegion {
  level: number;
  region: string;
  latitude: number | null;
  longitude: number | null;
}

@Injectable()
export class DrivingplusApiService {
  private readonly baseUrl = (process.env.DRIVINGPLUS_API_BASE_URL || "https://api-dev.drivingplus.me:18104").replace(/\/$/, "");
  private readonly timeoutMs = Number(process.env.DRIVINGPLUS_API_TIMEOUT_MS || 30000);

  async fetchAcademies(opts: { includeBlogReviews?: boolean; blogReviewLimit?: number } = {}): Promise<DrivingplusAcademy[]> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>("/v1/academy/get-all-academy");
    const rows = requireArray(payload, "academy data");
    const academies = rows.map(normalizeAcademy).filter((row): row is DrivingplusAcademy => Boolean(row));
    if (!opts.includeBlogReviews) return academies;
    const limit = Math.max(1, Math.min(10, Math.trunc(Number(opts.blogReviewLimit ?? 3))));
    return mapLimit(academies, 8, async (academy) => {
      try {
        return { ...academy, blogReviews: await this.fetchBlogReviews(academy.id, limit) };
      } catch {
        return academy;
      }
    });
  }

  async fetchReviews(academyId: number, limit = 5, sort: "new" | "point" = "point"): Promise<DrivingplusReview[]> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/review/list/${encodeURIComponent(String(academyId))}?sort=${sort}&limit=${encodeURIComponent(String(limit))}`);
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const rows = Array.isArray(data.reviews) ? data.reviews : [];
    return rows.map(normalizeReview).filter((row): row is DrivingplusReview => Boolean(row)).slice(0, Math.max(1, limit));
  }

  async fetchBlogReviews(academyId: number, limit = 3): Promise<DrivingplusBlogReview[]> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/blog-review/list/${encodeURIComponent(String(academyId))}?limit=${encodeURIComponent(String(limit))}`);
    const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
    const rows = Array.isArray(data.reviews) ? data.reviews : [];
    return rows.map(normalizeBlogReview).filter((row): row is DrivingplusBlogReview => Boolean(row)).slice(0, Math.max(1, limit));
  }

  async fetchSeoRegions(level: SeoRegionLevel = "2"): Promise<DrivingplusSeoRegion[]> {
    const suffix = level === "all" ? "?level=all" : `?level=${encodeURIComponent(level)}`;
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>(`/v1/zipcode/search-seo${suffix}`);
    const rows = requireArray(payload, "seo region data");
    return rows.map(normalizeSeoRegion).filter((row): row is DrivingplusSeoRegion => Boolean(row));
  }

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`DrivingPlus API ${path} failed: ${res.status} ${res.statusText} ${text.slice(0, 300)}`);
      const payload = JSON.parse(text) as T & { code?: number; message?: string };
      if (payload && typeof payload === "object" && payload.code !== undefined && Number(payload.code) !== 200) {
        throw new Error(`DrivingPlus API ${path} returned code ${payload.code}: ${payload.message || ""}`);
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

function requireArray(payload: { data?: unknown }, label: string): unknown[] {
  if (!Array.isArray(payload.data)) throw new Error(`DrivingPlus ${label} is not an array`);
  return payload.data;
}

function normalizeAcademy(value: unknown): DrivingplusAcademy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const title = str(row.title);
  if (!Number.isFinite(id) || !title) return null;
  return {
    id,
    title,
    seoTitle: str(row.seoTitle),
    seoKeywords: str(row.seoKeywords),
    seoDescription: str(row.seoDescription),
    roadAddress: str(row.roadAddress),
    phone: str(row.phone),
    vphone: str(row.vphone),
    roadLatitude: num(row.roadLatitude),
    roadLongitude: num(row.roadLongitude),
    thumbSavePath: str(row.thumbSavePath),
    type: str(row.type),
    photos: Array.isArray(row.photos) ? row.photos.map(str).filter(Boolean) : [],
    reviews: Array.isArray(row.reviews) ? row.reviews.map(normalizeReview).filter((review): review is DrivingplusReview => Boolean(review)) : [],
  };
}

function normalizeReview(value: unknown): DrivingplusReview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const content = cleanText(row.content);
  const point = num(row.point);
  if (!isPositiveReviewText(content, point)) return null;
  return { id: num(row.id), author: str(row.author), point, content: content.slice(0, 500), date: str(row.date) };
}

function normalizeBlogReview(value: unknown): DrivingplusBlogReview | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = cleanText(row.title);
  const content = cleanText(row.content);
  const link = str(row.link);
  if (!title || !link) return null;
  if (!isPositiveReviewText(`${title} ${content}`, null)) return null;
  return {
    title: title.slice(0, 160),
    content: content ? content.slice(0, 500) : null,
    link,
    postdate: str(row.postdate),
    images: Array.isArray(row.images) ? row.images.map(str).filter(Boolean).slice(0, 3) : [],
  };
}

function normalizeSeoRegion(value: unknown): DrivingplusSeoRegion | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const level = Number(row.level);
  const region = str(row.region);
  if (!Number.isFinite(level) || !region) return null;
  return { level, region, latitude: num(row.latitude), longitude: num(row.longitude) };
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function cleanText(value: unknown): string {
  return str(value)
    .replace(/<[^>]+>/g, "")
    .replace(/#[0-9A-Za-z_가-힣]+/g, " ")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function isUsefulKoreanReview(text: string): boolean {
  if (!text || text.length < 12) return false;
  const korean = (text.match(/[가-힣]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  if (korean < 6) return false;
  if (digits > korean + 8) return false;
  if (/^(\d|[ㅋㅎㅠㅜ\s.,!?])+$/u.test(text)) return false;
  return true;
}

const NEGATIVE_REVIEW_RE = /불친절|최악|비추|별로|환불|짜증|화남|불만|실망|안\s*좋|안좋|문제\s*있|대기\s*길|너무\s*늦|엉망|후회/u;
const POSITIVE_REVIEW_RE = /친절|합격|좋|추천|감사|만족|편하|꼼꼼|잘\s*가르|빠르|한\s*번에|한번에|쉬웠|도움|최고|강추|자세히|설명|안심|쾌적|체계/u;
const RISKY_REVIEW_CLAIM_RE = /\d+\s*일\s*(?:만|컷|완성)|삼\s*일\s*(?:만|컷|완성)|하루\s*만|당일\s*합격|무조건|보장|\d{2,3}\s*만\s*(?:원|뤈|웜)?|\d{3},\d{3}\s*원/u;

function isPositiveReviewText(text: string, point: number | null): boolean {
  if (!isUsefulKoreanReview(text)) return false;
  if (NEGATIVE_REVIEW_RE.test(text)) return false;
  if (RISKY_REVIEW_CLAIM_RE.test(text)) return false;
  if (point !== null && point !== undefined && point < 4) return false;
  if (point !== null && point !== undefined && point >= 4) return true;
  return POSITIVE_REVIEW_RE.test(text);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
