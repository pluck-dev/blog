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

  async fetchAcademies(): Promise<DrivingplusAcademy[]> {
    const payload = await this.get<{ code?: number; message?: string; data?: unknown }>("/v1/academy/get-all-academy");
    const rows = requireArray(payload, "academy data");
    return rows.map(normalizeAcademy).filter((row): row is DrivingplusAcademy => Boolean(row));
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

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
