import type { AdminOptions, Axis, AxisValue, SlotListPayload, TenantDetailPayload } from "./types";

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
export const getTenantDetail = (domain: string, include = "slots,posts,academies,jobs,social,deployments,channels") =>
  api<TenantDetailPayload>(`/tenants/${encodeURIComponent(domain)}?include=${include}&limit=500`);
export const listSlots = (domain: string, params: { status?: string; template?: string; q?: string; limit?: number; offset?: number } = {}) => {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.template) search.set("template", params.template);
  if (params.q) search.set("q", params.q);
  search.set("limit", String(params.limit ?? 1000));
  if (params.offset) search.set("offset", String(params.offset));
  return api<SlotListPayload>(`/tenants/${encodeURIComponent(domain)}/slots?${search.toString()}`);
};
export const updateTenant = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; tenant: import("./types").Tenant }>(`/tenants/${encodeURIComponent(domain)}`, { method: "PATCH", body: JSON.stringify(body) });
export const replaceAxis = (domain: string, axis: Axis, values: AxisValue[]) =>
  api<{ ok: true }>(`/tenants/${encodeURIComponent(domain)}/axes/${axis}`, { method: "PUT", body: JSON.stringify({ values }) });
export const enqueueGenerate = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; job_id: string; slot_count?: number }>(`/tenants/${encodeURIComponent(domain)}/jobs/generate`, { method: "POST", body: JSON.stringify(body) });
export const enqueueSocialGenerate = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; job_id: string; post_count?: number }>(`/tenants/${encodeURIComponent(domain)}/jobs/social-generate`, { method: "POST", body: JSON.stringify(body) });
export const enqueueSocialRender = (domain: string, packageId: string, body: Record<string, unknown> = {}) =>
  api<{ ok: true; job_id: string; package_count?: number }>(`/tenants/${encodeURIComponent(domain)}/social-packages/${encodeURIComponent(packageId)}/render`, { method: "POST", body: JSON.stringify(body) });
export const enqueueSiteDeploy = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; deployment_id: string; job_id: string }>(`/tenants/${encodeURIComponent(domain)}/jobs/site-deploy`, { method: "POST", body: JSON.stringify(body) });
export const upsertSocialChannel = (domain: string, body: Record<string, unknown>) =>
  api<{ ok: true; channel: import("./types").SocialChannel }>(`/tenants/${encodeURIComponent(domain)}/channels`, { method: "POST", body: JSON.stringify(body) });
export const deleteSocialChannel = (domain: string, channelId: string) =>
  api<{ ok: true; deleted: number }>(`/tenants/${encodeURIComponent(domain)}/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
export const syncDrivingplusAcademies = (domain: string, body: { include_blog_reviews?: boolean; blog_review_limit?: number } = { include_blog_reviews: true, blog_review_limit: 3 }) =>
  api<{ ok: true; fetched: number; upserted: number; skipped: number; warnings?: string[] }>(`/tenants/${encodeURIComponent(domain)}/sync/drivingplus/academies`, { method: "POST", body: JSON.stringify(body) });
export const syncDrivingplusRegions = (domain: string, body: { level?: "all" | "2" | "3"; replace_axis?: boolean; max?: number }) =>
  api<{ ok: true; level: string; axis_replaced: boolean; fetched: number; upserted: number; skipped: number }>(`/tenants/${encodeURIComponent(domain)}/sync/drivingplus/regions`, { method: "POST", body: JSON.stringify(body) });
