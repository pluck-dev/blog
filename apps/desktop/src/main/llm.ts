import { spawn } from "child_process";
import type { Provider } from "@shared/types";

export interface LLMResult {
  ok: boolean;
  provider: Provider;
  summary: string;
  model: string;
  duration_sec: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  session_id: string | null;
  num_turns: number;
  rate_limit: Record<string, unknown> | null;
  raw_json: Record<string, unknown>;
  error: string | null;
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  returncode: number;
  duration_sec: number;
  error: string | null;
}

async function spawnProcess(
  cmd: string,
  args: string[],
  input: string,
  env: NodeJS.ProcessEnv,
  cwd: string | undefined,
  timeoutSec: number,
): Promise<SpawnResult> {
  const start = Date.now();
  return new Promise<SpawnResult>((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { env, cwd });
    } catch (err) {
      resolve({
        stdout: "", stderr: "", returncode: 127, duration_sec: 0,
        error: `spawn failed: ${(err as Error).message}`,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
      resolved = true;
      resolve({
        stdout, stderr, returncode: -1,
        duration_sec: (Date.now() - start) / 1000,
        error: `timeout after ${timeoutSec}s`,
      });
    }, timeoutSec * 1000);

    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString("utf-8"); });
    child.stderr?.on("data", (b: Buffer) => { stderr += b.toString("utf-8"); });

    child.on("error", (err) => {
      if (resolved) return;
      clearTimeout(timer);
      resolved = true;
      const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `binary not found: ${cmd}. Run \`${cmd} login\` first.`
        : `spawn failed: ${err.message}`;
      resolve({ stdout, stderr, returncode: 127, duration_sec: (Date.now() - start) / 1000, error: msg });
    });

    child.on("close", (code) => {
      if (resolved) return;
      clearTimeout(timer);
      resolved = true;
      resolve({
        stdout, stderr,
        returncode: code ?? 1,
        duration_sec: (Date.now() - start) / 1000,
        error: null,
      });
    });

    try {
      child.stdin?.write(input);
      child.stdin?.end();
    } catch { /* ignore */ }
  });
}

function firstNonempty(text: string): string | null {
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (s) return s;
  }
  return null;
}

// ---------- Claude ----------

interface ParsedClaude {
  summary: string;
  cost_usd: number;
  model: string;
  session_id: string | null;
  num_turns: number;
  rate_limit: Record<string, unknown> | null;
  raw: Record<string, unknown>;
}

function parseClaudeStream(stdout: string): ParsedClaude {
  let summary = "";
  let cost_usd = 0;
  let model = "";
  let session_id: string | null = null;
  let num_turns = 0;
  let rate_limit: Record<string, unknown> | null = null;
  let last_result: Record<string, unknown> = {};
  const chunks: string[] = [];

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let obj: Record<string, unknown>;
    try { obj = JSON.parse(line); } catch { continue; }
    const ty = obj["type"];
    if (ty === "assistant") {
      const msg = (obj["message"] as Record<string, unknown>) || {};
      if (!model && typeof msg["model"] === "string") model = msg["model"] as string;
      if (!session_id) {
        const sid = obj["session_id"] ?? msg["session_id"];
        if (typeof sid === "string") session_id = sid;
      }
      const content = msg["content"] as unknown[] | undefined;
      for (const blk of content ?? []) {
        if (blk && typeof blk === "object" && (blk as { type?: string }).type === "text") {
          const txt = (blk as { text?: string }).text;
          if (txt) chunks.push(txt);
        }
      }
    } else if (ty === "result") {
      last_result = obj;
      if (typeof obj["result"] === "string") summary = obj["result"] as string;
      const c = obj["total_cost_usd"];
      if (typeof c === "number") cost_usd = c;
      const n = obj["num_turns"];
      if (typeof n === "number") num_turns = n;
      if (!session_id && typeof obj["session_id"] === "string") session_id = obj["session_id"] as string;
    } else if (ty === "rate_limit_event") {
      const info = obj["rate_limit_info"];
      if (info && typeof info === "object") rate_limit = info as Record<string, unknown>;
    }
  }

  if (!summary && chunks.length) summary = chunks.join("\n").trim();
  return { summary, cost_usd, model, session_id, num_turns, rate_limit, raw: last_result };
}

async function runClaude(prompt: string, opts: {
  cmd: string; model: string; timeout_sec: number; cwd?: string;
  extra_args?: string[]; allowed_tools?: string[];
}): Promise<LLMResult> {
  const args = [opts.cmd, "--print", "-", "--output-format", "stream-json", "--verbose"];
  if (opts.allowed_tools?.length) args.push("--allowedTools", opts.allowed_tools.join(","));
  if (opts.model) args.push("--model", opts.model);
  if (opts.extra_args?.length) args.push(...opts.extra_args);

  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;

  const proc = await spawnProcess(args[0], args.slice(1), prompt, env, opts.cwd, opts.timeout_sec);
  if (proc.error && !proc.stdout) {
    return {
      ok: false, provider: "claude", summary: "", model: opts.model,
      duration_sec: proc.duration_sec, cost_usd: 0,
      input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
      session_id: null, num_turns: 0, rate_limit: null,
      raw_json: {}, error: proc.error,
    };
  }
  const parsed = parseClaudeStream(proc.stdout);
  const ok = parsed.summary.trim() !== "" && proc.returncode === 0;
  const err = ok ? null : (firstNonempty(proc.stderr) || proc.error || `claude exit ${proc.returncode}`);
  return {
    ok, provider: "claude", summary: parsed.summary, model: parsed.model || opts.model,
    duration_sec: proc.duration_sec, cost_usd: parsed.cost_usd,
    input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
    session_id: parsed.session_id, num_turns: parsed.num_turns,
    rate_limit: parsed.rate_limit, raw_json: parsed.raw, error: err,
  };
}

// ---------- Codex ----------

interface ParsedCodex {
  summary: string;
  session_id: string | null;
  model: string;
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number };
  error: string | null;
  raw: Record<string, unknown>;
}

function parseCodexJsonl(stdout: string): ParsedCodex {
  let session_id: string | null = null;
  let final_message = "";
  let model = "";
  let error_message: string | null = null;
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  let last_event: Record<string, unknown> = {};

  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let ev: Record<string, unknown>;
    try { ev = JSON.parse(line); } catch { continue; }
    last_event = ev;
    const ty = ev["type"] ?? "";
    if (ty === "thread.started") {
      if (typeof ev["thread_id"] === "string") session_id = ev["thread_id"] as string;
      if (!model && typeof ev["model"] === "string") model = ev["model"] as string;
    } else if (ty === "item.completed") {
      const item = ev["item"] as { type?: string; text?: string } | undefined;
      if (item?.type === "agent_message" && item.text) final_message = item.text;
    } else if (ty === "turn.completed") {
      const u = (ev["usage"] as Record<string, number>) || {};
      if (typeof u.input_tokens === "number") usage.input_tokens = u.input_tokens;
      if (typeof u.cached_input_tokens === "number") usage.cached_input_tokens = u.cached_input_tokens;
      if (typeof u.output_tokens === "number") usage.output_tokens = u.output_tokens;
    } else if (ty === "turn.failed") {
      const err = (ev["error"] as { message?: string }) || {};
      if (err.message?.trim()) error_message = err.message.trim();
    } else if (ty === "error") {
      const m = ev["message"];
      if (typeof m === "string" && m.trim()) error_message = m.trim();
    }
  }
  return { summary: final_message.trim(), session_id, model, usage, error: error_message, raw: last_event };
}

async function runCodex(prompt: string, opts: {
  cmd: string; model: string; timeout_sec: number; cwd?: string; extra_args?: string[];
}): Promise<LLMResult> {
  const args = [
    opts.cmd, "exec", "--json",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "-c", 'approval_policy="never"',
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extra_args?.length) args.push(...opts.extra_args);
  args.push("-");

  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;

  const proc = await spawnProcess(args[0], args.slice(1), prompt, env, opts.cwd, opts.timeout_sec);
  if (proc.error && !proc.stdout) {
    return {
      ok: false, provider: "codex", summary: "", model: opts.model,
      duration_sec: proc.duration_sec, cost_usd: 0,
      input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
      session_id: null, num_turns: 0, rate_limit: null,
      raw_json: {}, error: proc.error,
    };
  }
  const parsed = parseCodexJsonl(proc.stdout);
  const ok = parsed.summary !== "" && proc.returncode === 0 && !parsed.error;
  const err = ok ? null : (parsed.error || firstNonempty(proc.stderr) || proc.error || `codex exit ${proc.returncode}`);
  return {
    ok, provider: "codex", summary: parsed.summary, model: parsed.model || opts.model,
    duration_sec: proc.duration_sec, cost_usd: 0,
    input_tokens: parsed.usage.input_tokens, cached_input_tokens: parsed.usage.cached_input_tokens,
    output_tokens: parsed.usage.output_tokens, session_id: parsed.session_id,
    num_turns: parsed.summary ? 1 : 0, rate_limit: null, raw_json: parsed.raw, error: err,
  };
}

// ---------- Main entry ----------

export async function runLlm(prompt: string, opts: {
  provider?: Provider; cmd?: string; model?: string; timeout_sec?: number;
  cwd?: string; extra_args?: string[]; allowed_tools?: string[];
}): Promise<LLMResult> {
  const provider = opts.provider ?? "claude";
  const timeout_sec = opts.timeout_sec ?? 600;
  if (provider === "claude") {
    return runClaude(prompt, {
      cmd: opts.cmd ?? "claude", model: opts.model ?? "",
      timeout_sec, cwd: opts.cwd, extra_args: opts.extra_args,
      allowed_tools: opts.allowed_tools,
    });
  }
  return runCodex(prompt, {
    cmd: opts.cmd ?? "codex", model: opts.model ?? "",
    timeout_sec, cwd: opts.cwd, extra_args: opts.extra_args,
  });
}
