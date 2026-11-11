import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The models a Dream can call. Each takes a system prompt and one message and returns the model's text, or
 * throws with a plain-English reason. All have a hard timeout; none ever runs inside a hook.
 *
 *   claude   → `claude -p` on the user's own Claude subscription (counts toward their usage limits)
 *   opencode → `opencode run` with a model from the user's OpenCode setup (its free models cost nothing)
 *   api      → the user's own API key: Anthropic, or any OpenAI-compatible endpoint (OpenRouter, Groq, …)
 *
 * The key never lives in a file: env var CORTEX_CLASSIFIER_KEY, or the macOS keychain item "kapex-cortex-classifier".
 */
export type Backend = "claude" | "opencode" | "api";
export interface ModelConfig { backend: string; model: string; api: "anthropic" | "openai"; url: string }
export interface CallOptions { timeoutMs?: number; effort?: "low" | "medium" | "high"; maxTokens?: number }
export const TIMEOUT_MS = 45_000;
export const KEYCHAIN_SERVICE = "kapex-cortex-classifier";

export function modelProblem(backend: Backend, model: string): string | null {
  if (backend === "claude" && !model) return null; // defaults to Sonnet
  if (!model) return "pick a model first";
  if (!/^[\w.:/@+-]{1,120}$/.test(model)) return "the model name has characters a model name can't have";
  if (backend === "opencode" && !model.includes("/")) return 'OpenCode models are written provider/model, e.g. "opencode/deepseek-v4.1-flash-free"';
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

async function viaOpencode(system: string, message: string, model: string, o: CallOptions): Promise<string> {
  const oc = findProgram("opencode");
  if (!oc) throw new Error("the opencode command wasn't found");
  const out = await runProgram(oc, ["run", "-m", model, "--format", "json", `${system}\n\n${message}`], null, o.timeoutMs);
  // one JSON event per line; the answer is in the "text" events
  const text = out.split("\n").map((l) => { try { return JSON.parse(l) as { type?: string; part?: { text?: string } }; } catch { return null; } })
    .filter((e) => e?.type === "text").map((e) => e!.part?.text ?? "").join("");
  if (!text) throw new Error("opencode gave no text answer");
  return text;
}

async function viaApi(system: string, message: string, cfg: ModelConfig, o: CallOptions): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error("no API key: set CORTEX_CLASSIFIER_KEY, or save it with `kc key` (macOS keychain)");
  const signal = AbortSignal.timeout(o.timeoutMs ?? TIMEOUT_MS);
  const max = o.maxTokens ?? 800;
  if (cfg.api === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: max, temperature: 0, system, messages: [{ role: "user", content: message }] }),
    });
    const j = (await r.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(`Anthropic API ${r.status}: ${j.error?.message ?? "error"}`);
    return (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  }
  const base = cfg.url.replace(/\/+$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST", signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: cfg.model, temperature: 0, max_tokens: max, messages: [{ role: "system", content: system }, { role: "user", content: message }] }),
  });
  const j = (await r.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(`API ${r.status}: ${j.error?.message ?? "error"}`);
  return j.choices?.[0]?.message?.content ?? "";
}

/** Ask the configured model. Throws on any problem (the caller saves the reason and shows it in the panel). */
export async function askModel(cfg: ModelConfig, system: string, message: string, schema?: object, o: CallOptions = {}): Promise<string> {
  // tests: a canned answer instead of a real model (never set outside the test suite)
  if (process.env.CORTEX_TEST_MODEL_ANSWER !== undefined) { const a = process.env.CORTEX_TEST_MODEL_ANSWER; if (a.startsWith("ERROR ")) throw new Error(a.slice(6)); return a; }
  const backend = cfg.backend as Backend;
  const bad = modelProblem(backend, cfg.model);
  if (bad) throw new Error(bad);
  if (backend === "claude") return viaClaude(system, message, cfg.model, schema, o);
  if (backend === "opencode") return viaOpencode(system, message, cfg.model, o);
  if (backend === "api") {
    if (cfg.api === "openai") { const u = urlProblem(cfg.url); if (u) throw new Error(u); }
    return viaApi(system, message, cfg, o);
  }
  throw new Error(`"${cfg.backend}" can't run a model`);
}
