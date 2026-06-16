export type Axis = "region" | "keyword" | "intent" | "persona" | "modifier";
export type SlotStatus = "planned" | "in_progress" | "published" | "failed" | "pruned";
export type PostStatus = "published" | "noindex" | "deleted";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";
export type Provider = "claude" | "codex";
export type DesignTemplateId = "editorial" | "comparison" | "local-guide" | "checklist" | "conversion" | "custom";

export interface Tenant {
  domain: string;
  display_name: string;
  vertical: string;
  theme: string;
  brand_color: string | null;
  logo_url: string | null;
  templates_enabled: string[];
  design_template_id?: DesignTemplateId;
  custom_design_templates?: string | null;
  content_brief?: string | null;
  daily_limit: number;
  created_at: string;
  slot_count?: number;
  planned_count?: number;
  published_count?: number;
}

export interface AxisValue {
  tenant?: string;
  axis?: Axis;
  value: string;
  weight: number;
  monthly_search_volume: number | null;
  competition_kd: number | null;
}

export type AxesMap = Record<Axis, AxisValue[]>;
export type SlotCounts = Record<SlotStatus, number>;

export interface Slot {
  slot_id: string;
  tenant: string;
  template_id: string;
  primary_keyword: string;
  region: string | null;
  persona: string | null;
  intent: string | null;
  modifier_1: string | null;
  modifier_2: string | null;
  entity_id: string | null;
  priority_score: number | null;
  status: SlotStatus;
  last_error: string | null;
  created_at: string;
}

export interface PostSummary {
  id: string;
  tenant: string;
  slot_id: string | null;
  slug: string;
  title: string;
  meta_description: string | null;
  design_template_id: DesignTemplateId | null;
  status: PostStatus;
  provider: string | null;
  model: string | null;
  cost_usd: number;
  duration_sec: number | null;
  generated_at: string;
  body_chars: number;
}

export interface PostDetail extends PostSummary {
  body_markdown: string;
  images?: string | Record<string, string> | null;
  session_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
}

export interface Academy {
  id: string;
  tenant: string;
  external_id?: string | null;
  region: string | null;
  name: string;
  address: string | null;
  price: string | null;
  shuttle: string | null;
  hours: string | null;
  pass_rate: string | null;
  phone: string | null;
  vphone?: string | null;
  review: string | null;
  review_json?: string | null;
  blog_reviews?: string | null;
  seo_title?: string | null;
  seo_keywords?: string | null;
  seo_description?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  thumb_url?: string | null;
  photos?: string | null;
  academy_type?: string | null;
  extra: string | null;
  source_name: string | null;
  source_url: string | null;
  synced_at?: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  tenant: string;
  kind: JobKind;
  payload: string;
  payload_obj: Record<string, unknown> & { slot_ids?: string[]; provider?: string; model?: string; cooldown_sec?: number; timeout_sec?: number };
  status: JobStatus;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: string | null;
  result_obj?: Record<string, unknown> & { ok?: number; fail?: number; per_slot?: unknown[] };
}

export interface TemplateSpec {
  name: string;
  description?: string;
  primary: string[];
  use_persona: boolean;
  modifier_count: number;
  weight?: number;
  min_sv?: number;
  with_intent?: boolean;
}

export interface AdminOptions {
  verticals: string[];
  themes: string[];
  templates: string[];
  template_specs: Record<string, TemplateSpec>;
  design_templates: Array<{ id: DesignTemplateId; name: string; summary: string; best_for: string }>;
  providers: Provider[];
  preset_options: string[];
  indexing: { has_key: boolean; url_template: string };
}

export interface TenantDetailPayload {
  tenant: Tenant;
  axes: AxesMap;
  slot_counts: SlotCounts;
  settings: { indexing_has_key: boolean; indexing_url_template: string };
  slots?: Slot[];
  posts?: PostSummary[];
  academies?: Academy[];
  jobs?: Job[];
}

export interface SlotListPayload {
  count: number;
  total: number;
  slot_counts: SlotCounts;
  items: Slot[];
}
