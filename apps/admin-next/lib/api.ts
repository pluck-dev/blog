import type { AdminOptions, Axis, AxisValue, TenantDetailPayload } from "./types";

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message = typeof data?.detail === "string" ? data.detail : typeof data?.message === "string" ? data.message : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return text; }
}

export const getOptions = () => api<AdminOptions>("/options");
export const listTenants = () => api<{ count: number; items: import("./types").Tenant[] }>("/tenants");
export const getTenantDetail = (domain: string, include = "slots,posts,academies,jobs") =>
  api<TenantDetailPayload>(`/tenants/${encodeURIComponent(domain)}?include=${include}&limit=500`);
export const updateTenant = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; tenant: import("./types").Tenant }>(`/tenants/${encodeURIComponent(domain)}`, { method: "PATCH", body: JSON.stringify(body) });
export const replaceAxis = (domain: string, axis: Axis, values: AxisValue[]) =>
  api<{ ok: true }>(`/tenants/${encodeURIComponent(domain)}/axes/${axis}`, { method: "PUT", body: JSON.stringify({ values }) });
export const enqueueGenerate = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; job_id: string }>(`/tenants/${encodeURIComponent(domain)}/jobs/generate`, { method: "POST", body: JSON.stringify(body) });
export const syncDrivingplusAcademies = (domain: string) =>
  api<{ ok: true; fetched: number; upserted: number; skipped: number; warnings?: string[] }>(`/tenants/${encodeURIComponent(domain)}/sync/drivingplus/academies`, { method: "POST", body: "{}" });
export const syncDrivingplusRegions = (domain: string, body: { level?: "all" | "2" | "3"; replace_axis?: boolean; max?: number }) =>
  api<{ ok: true; level: string; axis_replaced: boolean; fetched: number; upserted: number; skipped: number }>(`/tenants/${encodeURIComponent(domain)}/sync/drivingplus/regions`, { method: "POST", body: JSON.stringify(body) });
