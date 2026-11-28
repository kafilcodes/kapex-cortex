import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { apiBase, callHttpModel } from "./api-call.ts";

/**
 * The models a full check can call. Each takes a system prompt and one message and returns the model's text, or
 * throws with a plain-English reason. All have a hard timeout; none ever runs inside a hook.
 *
 *   claude   → `claude -p` on the user's own Claude subscription (counts toward their usage limits)
 *   api      → the user's own API key: Anthropic, or any OpenAI-compatible endpoint (OpenRouter, Groq, NVIDIA NIM, …).
 *              When it fails for any reason, judge() asks Claude on the user's plan instead and says so.
 * OpenCode judged Dreams until v4.9 (`opencode run`); it was dropped for launch (docs/drafts.md keeps the design).
 *
 * The key never lives in a file: env var CORTEX_CLASSIFIER_KEY, or the macOS keychain item "kapex-cortex-classifier".
 */
export type Backend = "claude" | "api";
export interface ModelConfig { backend: string; model: string; api: "anthropic" | "openai"; url: string }
export interface CallOptions { timeoutMs?: number; effort?: "low" | "medium" | "high"; maxTokens?: number }
export const TIMEOUT_MS = 45_000;
export const KEYCHAIN_SERVICE = "kapex-cortex-classifier";

export function modelProblem(backend: Backend, model: string): string | null {
  if (backend === "claude" && !model) return null; // defaults to Sonnet
  if (!model) return "pick a model first";
  if (!/^[\w.:/@+-]{1,120}$/.test(model)) return "the model name has characters a model name can't have";
  return null;
}

export function urlProblem(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) return null;
    return "the endpoint must start with https:// (or http://localhost for a local server)";
  } catch { return "that isn't a web address"; }
}

/** The API key, from the environment or the macOS keychain. Never written anywhere by Cortex. */
export function apiKey(): string | null {
  const env = process.env.CORTEX_CLASSIFIER_KEY?.trim();
  if (env) return env;
  if (process.platform !== "darwin") return null;
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"], { encoding: "utf8", timeout: 3_000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** A program on PATH, or in the usual install folders (hooks and GUI apps often get a short PATH). */
function findProgram(name: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const dirs = [...(process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":"), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".opencode", "bin")];
  for (const d of dirs) for (const e of exts) if (d && existsSync(join(d, name + e))) return join(d, name + e);
  return null;
}

/** Run a program with the prompt on stdin (or as an argument), outside any project so no project hooks or plugins load. */
function runProgram(cmd: string, args: string[], stdin: string | null, timeoutMs = TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: tmpdir(),
      env: { ...process.env, CORTEX_CLASSIFIER: "1" }, // Cortex's own hooks see this and do nothing
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" && cmd.endsWith(".cmd"), // .cmd launchers need cmd.exe; args are plain words
      windowsHide: true,
    });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd.split(/[\\/]/).pop()} exited with ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
    child.stdin.end(stdin ?? "");
  });
}

async function viaClaude(system: string, message: string, model: string, schema: object | undefined, o: CallOptions): Promise<string> {
  const claude = findProgram("claude");
  if (!claude) throw new Error("the claude command wasn't found");
  // No tools, no MCP servers, no settings (so no plugins or hooks), our own short system prompt, nothing saved.
  // with a schema, Claude fills that exact JSON shape (structured output), so the answer always parses
  const args = ["-p", "--model", model || "sonnet", "--output-format", "json", "--tools", "", "--strict-mcp-config", "--setting-sources", "", "--system-prompt", system, "--no-session-persistence", "--effort", o.effort ?? "low", ...(schema ? ["--json-schema", JSON.stringify(schema)] : [])];
  const out = await runProgram(claude, args, message, o.timeoutMs);
  const j = JSON.parse(out) as { result?: string; is_error?: boolean; structured_output?: unknown };
  if (j.is_error) throw new Error(`claude returned an error: ${String(j.result ?? "").slice(0, 200)}`);
  if (j.structured_output !== undefined) return JSON.stringify(j.structured_output);
  if (typeof j.result !== "string") throw new Error("claude gave no answer");
  return j.result;
}

async function viaApi(system: string, message: string, cfg: ModelConfig, o: CallOptions, json: boolean): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("no API key: set CORTEX_CLASSIFIER_KEY, or save it with `kc key` (macOS keychain)");
  // retries, plain reasons and thinking models are handled in api-call.ts
  return callHttpModel({ api: cfg.api, url: cfg.url, model: cfg.model, key }, system, message, { timeoutMs: o.timeoutMs ?? TIMEOUT_MS, maxTokens: o.maxTokens ?? 800, json });
}

/** Ask the configured model. Throws on any problem (the caller saves the reason and shows it in the panel). */
export async function askModel(cfg: ModelConfig, system: string, message: string, schema?: object, o: CallOptions = {}): Promise<string> {
  // tests: a canned answer instead of a real model (never set outside the test suite)
  if (process.env.CORTEX_TEST_MODEL_ANSWER !== undefined) { const a = process.env.CORTEX_TEST_MODEL_ANSWER; if (a.startsWith("ERROR ")) throw new Error(a.slice(6)); return a; }
  const backend = cfg.backend as Backend;
  const bad = modelProblem(backend, cfg.model);
  if (bad) throw new Error(bad);
  if (backend === "claude") return viaClaude(system, message, cfg.model, schema, o);
  if (backend === "api") {
    if (cfg.api === "openai") { if (!cfg.url.trim()) throw new Error("no endpoint address is set (Settings → Memory check)"); const u = urlProblem(apiBase(cfg.url)); if (u) throw new Error(u); }
    return viaApi(system, message, cfg, o, !!schema);
  }
  throw new Error(`"${cfg.backend}" can't run a model`);
}

/** What a judge needs from the preferences (prefs.ts). */
export interface JudgePrefs { dreamBackend: string; dreamModel: string; dreamEffort: "low" | "medium" | "high"; dreamApiModel: string; dreamApi: "anthropic" | "openai"; dreamUrl: string }
/** Who answered, as the report and the panel say it ("claude · sonnet", "api · nvidia/nemotron…"). */
export const judgeName = (backend: string, model: string) => `${backend}${model ? ` · ${model}` : ""}`;

/**
 * Ask the judge the preferences name. With your own key (api), any failure (no key, a bad address or model, a
 * timeout, an answer that isn't JSON when a shape was asked for) falls back to Claude on your plan with your Claude
 * model, and `fallback` says what failed, so the report can say "your key failed: …; judged by Sonnet instead".
 * Throws only when nothing could answer (both failed, with both reasons).
 */
export async function judge(pr: JudgePrefs, system: string, message: string, schema: object | undefined, o: CallOptions = {}): Promise<{ raw: string; by: string; fallback?: { from: string; why: string } }> {
  const claude: ModelConfig = { backend: "claude", model: pr.dreamModel || "sonnet", api: "anthropic", url: "" }
  const opts = { ...o, effort: pr.dreamEffort ?? o.effort }
  if (pr.dreamBackend !== "api") return { raw: await askModel(claude, system, message, schema, opts), by: judgeName("claude", claude.model) }
  const mine: ModelConfig = { backend: "api", model: pr.dreamApiModel, api: pr.dreamApi, url: pr.dreamUrl }
  let why: string
  try {
    const raw = await askModel(mine, system, message, schema, { ...o, timeoutMs: Math.min(o.timeoutMs ?? TIMEOUT_MS, 180_000) })
    if (!schema || /\{[\s\S]*\}/.test(raw)) return { raw, by: judgeName("api", mine.model) }
    why = "its answer had no JSON in it"
  } catch (err) { why = String((err as Error).message ?? err).slice(0, 200) }
  const from = judgeName("api", mine.model || "no model chosen")
  try { return { raw: await askModel(claude, system, message, schema, opts), by: judgeName("claude", claude.model), fallback: { from, why } } }
  catch (err) { throw new Error(`your own key's model failed (${why}), and Claude on your plan failed too: ${String((err as Error).message ?? err).slice(0, 160)}`) }
}
