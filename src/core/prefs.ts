import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { cortexHome } from "./home.ts";
import type { RepoPaths } from "./paths.ts";

/**
 * Cortex preferences. Per-user values live in ~/.cortex/config.json under "prefs"; a project can override any
 * of them in .vault/private/prefs.json (private, never committed). Unknown keys from older versions are ignored.
 *
 *   tokenMode        how big the handoff a new chat reads is (lean / balanced / rich)
 *   dreamBackend     who judges a Dream: claude (your plan), opencode (its free models), api (your key), off (checks only)
 *   dreamModel       the model it uses (claude: haiku, sonnet or opus)
 *   dreamTranscripts how many recent chats a Dream reads
 *   autoDream        dream by itself after a session ends (at most once a day): off until you switch it on
 */
export const TOKEN_MODES = ["lean", "balanced", "rich"] as const;
export const DREAM_BACKENDS = ["claude", "opencode", "api", "off"] as const;
export type TokenMode = (typeof TOKEN_MODES)[number];
export type DreamBackend = (typeof DREAM_BACKENDS)[number];
export interface Prefs {
  tokenMode: TokenMode;
  greeting: boolean; name: string;
  dreamBackend: DreamBackend; dreamModel: string; dreamApi: "anthropic" | "openai"; dreamUrl: string;
  dreamTranscripts: number; autoDream: boolean;
}
export const DEFAULT_PREFS: Prefs = {
  tokenMode: "balanced", greeting: true, name: "",
  dreamBackend: "claude", dreamModel: "sonnet", dreamApi: "anthropic", dreamUrl: "", dreamTranscripts: 10, autoDream: false,
};

/** The handoff packet's size in characters (~4 per token), and whether it carries the assistant's last reply. */
export const MODES: Record<TokenMode, { state: number; lastReply: boolean }> = {
  lean: { state: 8_000, lastReply: false },
  balanced: { state: 30_000, lastReply: true },
  rich: { state: 48_000, lastReply: true },
};

const MODEL = /^[\w.:/@+-]{0,120}$/;
const userFile = () => join(cortexHome(), "config.json");
const projectFile = (p: RepoPaths) => join(p.priv, "prefs.json");
const readObj = (f: string): Record<string, unknown> => { try { return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; } catch { return {}; } };

function clean(raw: Record<string, unknown>): Partial<Prefs> {
  const out: Partial<Prefs> = {};
  if (TOKEN_MODES.includes(raw.tokenMode as TokenMode)) out.tokenMode = raw.tokenMode as TokenMode;
  if (typeof raw.greeting === "boolean") out.greeting = raw.greeting;
  if (typeof raw.name === "string" && raw.name.length <= 40) out.name = raw.name;
  if (DREAM_BACKENDS.includes(raw.dreamBackend as DreamBackend)) out.dreamBackend = raw.dreamBackend as DreamBackend;
  if (typeof raw.dreamModel === "string" && MODEL.test(raw.dreamModel)) out.dreamModel = raw.dreamModel;
  if (raw.dreamApi === "anthropic" || raw.dreamApi === "openai") out.dreamApi = raw.dreamApi;
  if (typeof raw.dreamUrl === "string" && raw.dreamUrl.length <= 300) out.dreamUrl = raw.dreamUrl;
  if (typeof raw.dreamTranscripts === "number" && raw.dreamTranscripts >= 1 && raw.dreamTranscripts <= 50) out.dreamTranscripts = Math.round(raw.dreamTranscripts);
  if (typeof raw.autoDream === "boolean") out.autoDream = raw.autoDream;
  return out;
}

const cache = new Map<string, Prefs & { overridden: (keyof Prefs)[] }>();

export function readPrefs(p?: RepoPaths): Prefs & { overridden: (keyof Prefs)[] } {
  const key = `${cortexHome()}|${p?.root ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const user = clean((readObj(userFile()).prefs ?? {}) as Record<string, unknown>);
  const proj = p ? clean(readObj(projectFile(p))) : {};
  const out = { ...DEFAULT_PREFS, ...user, ...proj, overridden: Object.keys(proj) as (keyof Prefs)[] };
  cache.set(key, out);
  return out;
}

export const forgetPrefs = () => cache.clear();
export const budgets = (p?: RepoPaths) => MODES[readPrefs(p).tokenMode];

/** Parse "on/off" and validate one setting; returns the value or an error message. */
export function parsePref(key: string, value: string): { key: keyof Prefs; value: Prefs[keyof Prefs] } | string {
  const bool = (v: string) => (/^(on|true|yes|1)$/i.test(v) ? true : /^(off|false|no|0)$/i.test(v) ? false : null);
  switch (key) {
    case "tokenMode": return TOKEN_MODES.includes(value as TokenMode) ? { key, value: value as TokenMode } : `tokenMode must be one of ${TOKEN_MODES.join(", ")}`;
    case "greeting":
    case "autoDream": { const b = bool(value); return b === null ? `${key} must be on or off` : { key, value: b }; }
    case "name": return /^[\p{L}' -]{0,40}$/u.test(value) ? { key, value: value.trim() } : "a name is letters and spaces, up to 40";
    case "dreamBackend": return DREAM_BACKENDS.includes(value as DreamBackend) ? { key, value: value as DreamBackend } : `dreamBackend must be one of ${DREAM_BACKENDS.join(", ")}`;
    case "dreamModel": return MODEL.test(value) ? { key, value } : "that isn't a model name";
    case "dreamApi": return value === "anthropic" || value === "openai" ? { key, value } : "dreamApi must be anthropic or openai";
    case "dreamUrl": return value === "" || /^https?:\/\//.test(value) ? { key, value } : "dreamUrl must be a web address";
    case "dreamTranscripts": { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 50 ? { key, value: n } : "dreamTranscripts must be a whole number from 1 to 50"; }
    default: return `unknown setting "${key}" (tokenMode, greeting, name, dreamBackend, dreamModel, dreamApi, dreamUrl, dreamTranscripts, autoDream)`;
  }
}

/** Save one preference for the user (default) or for this project only. */
export function setPref(key: keyof Prefs, value: Prefs[keyof Prefs], scope: "user" | "project", p?: RepoPaths): void {
  cache.clear();
  if (scope === "project") {
    if (!p) throw new Error("no project");
    const cur = readObj(projectFile(p));
    atomicWriteIfChanged(projectFile(p), JSON.stringify({ ...cur, [key]: value }, null, 2) + "\n");
    return;
  }
  const cfg = readObj(userFile());
  cfg.prefs = { ...((cfg.prefs ?? {}) as Record<string, unknown>), [key]: value };
  mkdirSync(cortexHome(), { recursive: true });
  writeFileSync(userFile(), JSON.stringify(cfg, null, 2) + "\n");
}
