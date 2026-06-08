import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
  Tenant, Slot, Post, PostSummary, AxisValue, Axis, JobWithPayload,
  SlotCounts, JobProgressEvent, GeneratePayload, DedupPayload, PrunePayload, IndexingPayload, Provider, ExportFormat,
} from "@shared/types";

// bind 된 함수는 contextBridge 가 거부할 수 있어서 일반 closure 로 감싼다.
const invoke = (channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args);

const api = {
  tenants: {
    list: (): Promise<Tenant[]> => invoke("tenants:list"),
    get: (domain: string): Promise<Tenant | null> => invoke("tenants:get", domain),
    create: (args: {
      domain: string; display_name: string; vertical: string;
      theme?: string; brand_color?: string; daily_limit?: number; apply_preset?: boolean;
    }): Promise<{ domain: string; preset: Record<string, number> }> => invoke("tenants:create", args),
    update: (domain: string, fields: Record<string, unknown>): Promise<Tenant | null> =>
      invoke("tenants:update", domain, fields),
    remove: (domain: string): Promise<boolean> => invoke("tenants:delete", domain),
  },
  axes: {
    list: (tenant: string): Promise<Record<Axis, AxisValue[]>> => invoke("axes:list", tenant),
    replace: (args: {
      tenant: string; axis: Axis;
      values: { value: string; weight?: number; monthly_search_volume?: number | null; competition_kd?: number | null }[];
    }): Promise<Record<Axis, AxisValue[]>> => invoke("axes:replace", args),
    applyPreset: (args: { tenant: string; preset_key: string }) => invoke("axes:applyPreset", args),
    aiFill: (args: {
      tenant: string; vertical: string; context?: string;
      provider?: Provider; model?: string; timeout_sec?: number;
    }) => invoke("axes:aiFill", args),
    presets: (): Promise<string[]> => invoke("axes:presets"),
  },
  slots: {
    list: (args: { tenant: string; status?: string | null; template?: string | null; limit?: number }): Promise<Slot[]> =>
      invoke("slots:list", args),
    count: (tenant: string): Promise<SlotCounts> => invoke("slots:count", tenant),
    generate: (args: { tenant: string; max_per_template?: number }): Promise<Record<string, number>> =>
      invoke("slots:generate", args),
    remove: (args: { tenant: string; slot_id: string }): Promise<boolean> => invoke("slots:delete", args),
    reset: (slot_id: string): Promise<boolean> => invoke("slots:reset", slot_id),
  },
  posts: {
    list: (args: { tenant: string; status?: string | null; limit?: number }): Promise<PostSummary[]> =>
      invoke("posts:list", args),
    get: (post_id: string): Promise<Post | null> => invoke("posts:get", post_id),
    remove: (post_id: string): Promise<boolean> => invoke("posts:delete", post_id),
    exportToDir: (args: { tenant: string; post_ids: string[]; format?: ExportFormat }):
      Promise<{ count: number; dir: string | null }> => invoke("posts:export", args),
  },
  jobs: {
    enqueue: (args: { tenant: string; payload: GeneratePayload }): Promise<string> => invoke("jobs:enqueue", args),
    enqueueDedup: (args: { tenant: string; payload?: DedupPayload }): Promise<string> => invoke("jobs:enqueueDedup", args),
    enqueuePrune: (args: { tenant: string; payload?: PrunePayload }): Promise<string> => invoke("jobs:enqueuePrune", args),
    enqueueIndexing: (args: { tenant: string; payload?: IndexingPayload }): Promise<string> => invoke("jobs:enqueueIndexing", args),
    list: (args: { tenant?: string | null; status?: string | null; limit?: number }): Promise<JobWithPayload[]> =>
      invoke("jobs:list", args),
    cancel: (job_id: string): Promise<boolean> => invoke("jobs:cancel", job_id),
    onProgress: (handler: (ev: JobProgressEvent) => void) => {
      const wrapped = (_e: IpcRendererEvent, ev: JobProgressEvent) => handler(ev);
      ipcRenderer.on("worker:progress", wrapped);
      return () => ipcRenderer.removeListener("worker:progress", wrapped);
    },
  },
  settings: {
    getIndexing: (): Promise<{ has_key: boolean; url_template: string }> => invoke("settings:getIndexing"),
    setIndexing: (args: { sa_json?: string | null; url_template?: string | null }): Promise<{ has_key: boolean }> =>
      invoke("settings:setIndexing", args),
  },
  meta: {
    templates: (): Promise<string[]> => invoke("meta:templates"),
    templateSpecs: () => invoke("meta:templateSpecs"),
    dbPath: (): Promise<string> => invoke("meta:dbPath"),
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
    // eslint-disable-next-line no-console
    console.log("[preload] api exposed, keys:", Object.keys(api));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[preload] contextBridge expose failed:", error);
  }
} else {
  // @ts-expect-error noContextIso fallback
  window.electron = electronAPI;
  // @ts-expect-error noContextIso fallback
  window.api = api;
}

export type API = typeof api;
