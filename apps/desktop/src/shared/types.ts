export type Vertical = "driving" | "car-mapping" | "gym" | "academy" | "general";
export type Theme = "clean" | "modern" | "pro";
export type DesignTemplateId = "editorial" | "comparison" | "local-guide" | "checklist" | "conversion" | "custom";
export type Axis = "region" | "keyword" | "intent" | "persona" | "modifier";
export type SlotStatus = "planned" | "in_progress" | "published" | "failed" | "pruned";
export type PostStatus = "published" | "noindex" | "deleted";
export type JobKind = "generate" | "dedup" | "indexing" | "prune";
export type JobStatus = "queued" | "running" | "done" | "failed";
export type Provider = "claude" | "codex";
export type ExportFormat = "plain" | "hugo" | "next" | "html";

export interface Tenant {
  domain: string;
  display_name: string;
  vertical: string;
  theme: Theme;
  brand_color: string;
  logo_url: string | null;
  templates_enabled: string;
  design_template_id: DesignTemplateId;
  custom_design_templates: string | null;
  content_brief: string | null;
  daily_limit: number;
  created_at: string;
  slot_count?: number;
  planned_count?: number;
  published_count?: number;
}

export interface AxisValue {
  tenant: string;
  axis: Axis;
  value: string;
  weight: number;
  monthly_search_volume: number | null;
  competition_kd: number | null;
}

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

export interface Post {
  id: string;
  tenant: string;
  slot_id: string | null;
  slug: string;
  title: string;
  body_markdown: string;
  meta_description: string | null;
  design_template_id: DesignTemplateId | null;
  status: PostStatus;
  provider: string | null;
  model: string | null;
  session_id: string | null;
  cost_usd: number;
  duration_sec: number | null;
  input_tokens: number;
  output_tokens: number;
  generated_at: string;
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

export interface Job {
  id: string;
  tenant: string;
  kind: JobKind;
  payload: string;
  status: JobStatus;
  scheduled_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  result: string | null;
}

export interface JobWithPayload extends Job {
  payload_obj: GeneratePayload | Record<string, unknown>;
  result_obj?: Record<string, unknown>;
}

export interface JobLogEntry {
  at: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  slot_id?: string;
}

export interface GeneratePayload {
  slot_ids: string[];
  provider: Provider;
  model?: string;
  design_template_id?: DesignTemplateId;
  use_web_research?: boolean;
  cooldown_sec?: number;
  timeout_sec?: number;
}

export interface DedupPayload {
  /** Jaccard 임계값(이상이면 중복). 기본 0.75 */
  threshold?: number;
  /** true면 noindex 표시 없이 검출만(미리보기). */
  dry_run?: boolean;
}

export interface DedupResult {
  total_posts: number;
  clusters: number;
  duplicates_found: number;
  marked_noindex: number;
  dry_run: boolean;
  details: { canonical_id: string; duplicate_ids: string[]; max_similarity: number; size: number }[];
}

export interface SlotCounts {
  planned: number;
  in_progress: number;
  published: number;
  failed: number;
  pruned: number;
}

export interface JobProgressEvent {
  job_id: string;
  tenant: string;
  phase: "start" | "slot_start" | "slot_done" | "slot_fail" | "cooldown" | "complete" | "failed" | "dedup_scan" | "dedup_mark";
  message?: string;
  slot_id?: string;
  done: number;
  total: number;
  ok: number;
  fail: number;
  duration_sec?: number;
  error?: string;
}
