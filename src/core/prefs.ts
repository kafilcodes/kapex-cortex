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
 *   dreamBackend     who judges a full check: claude (your plan), api (your own key), off (checks only). OpenCode judged
 *                    Dreams until v4.9; a saved opencode now means claude (its model is dropped)
 *   dreamModel       the Claude model (haiku, sonnet or opus): the judge on your plan, and the fallback when your key fails
 *   dreamEffort      how hard the Claude model thinks: low, medium (the default) or high
 *   dreamApiModel    your own key's model, as its provider names it (until v4.9 it shared dreamModel)
 *   dreamTranscripts how many recent chats a full check reads
 *   autoDream        dream by itself after a session ends (at most once a day): off until you switch it on
 *   quickCheck       the free Quick check after every turn, in the background, only when a memory file or the code changed: on
 *   handoffAt        context % at which the panel offers a fresh chat from the handoff (lower with a cold cache): 80
 *   autoPark         park MCP servers and plugins unused in your recent chats here, from the next chat on: on
 *   sound            a short chime when a handoff is saved or a full check finishes (the panel's own sound): on
 *   startNotice      a one-line note to every new chat that a handoff exists: off (the packet is pull-only: /cortex-resume
 *                    or the strip's Resume button; a chat on a new task never reads an old task's packet)
 */
export const TOKEN_MODES = ["lean", "balanced", "rich"] as const;
export const DREAM_BACKENDS = ["claude", "api", "off"] as const;
export const DREAM_EFFORTS = ["low", "medium", "high"] as const;
export type DreamEffort = (typeof DREAM_EFFORTS)[number];
/** A Claude model as `claude -p --model` takes it: an alias or a full claude-… name. */
export const CLAUDE_MODEL = /^(?:haiku|sonnet|opus|claude-[\w.-]{1,80})$/i;
export type TokenMode = (typeof TOKEN_MODES)[number];
export type DreamBackend = (typeof DREAM_BACKENDS)[number];
export interface Prefs {
  tokenMode: TokenMode;
  greeting: boolean; name: string;
  dreamBackend: DreamBackend; dreamModel: string; dreamEffort: DreamEffort; dreamApiModel: string; dreamApi: "anthropic" | "openai"; dreamUrl: string;
  dreamTranscripts: number; autoDream: boolean;
  quickCheck: boolean; handoffAt: number; autoPark: boolean; sound: boolean; startNotice: boolean;
}
export const DEFAULT_PREFS: Prefs = {
  tokenMode: "balanced", greeting: true, name: "",
  dreamBackend: "claude", dreamModel: "sonnet", dreamEffort: "medium", dreamApiModel: "", dreamApi: "anthropic", dreamUrl: "", dreamTranscripts: 10, autoDream: false,
  quickCheck: true, handoffAt: 80, autoPark: true, sound: true, startNotice: false,
};

/** The handoff packet's size in characters (~4 per token), and whether it carries the assistant's last reply. */
export const MODES: Record<TokenMode, { state: number; lastReply: boolean }> = {
  lean: { state: 8_000, lastReply: false },
  balanced: { state: 30_000, lastReply: true },
  rich: { state: 48_000, lastReply: true },
};

const MODEL = /^(?:[\w.:/@+][\w.:/@+-]{0,119})?$/; // never starts with "-": it is passed to a model command as an argument
const userFile = () => join(cortexHome(), "config.json");
const projectFile = (p: RepoPaths) => join(p.priv, "prefs.json");
const readObj = (f: string): Record<string, unknown> => { try { return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; } catch { return {}; } };

/**
 * Until v4.9 one dreamModel served every judge. A saved layer with your own key (dreamBackend api), a dreamModel and
 * no dreamApiModel is from then: its model is your key's model (any name, an Anthropic one like claude-sonnet-4-5
 * included), and Claude's own model goes back to Sonnet, unless it was one of Claude Code's short names (haiku, sonnet,
 * opus), which an API never takes. Used on read and before every save, so the move is written down the first time
 * anything is saved, and a later save of one key can never drop it (a fresh-eyes review found exactly that).
 */
export function migrateRaw(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.dreamBackend !== "api" || typeof raw.dreamModel !== "string" || !raw.dreamModel || raw.dreamApiModel !== undefined) return raw;
  if (/^(?:haiku|sonnet|opus)$/i.test(raw.dreamModel)) return { ...raw, dreamApiModel: "" };
  return { ...raw, dreamApiModel: raw.dreamModel, dreamModel: "sonnet" };
}

function clean(input: Record<string, unknown>): Partial<Prefs> {
  const raw = migrateRaw(input);
  const out: Partial<Prefs> = {};
  if (TOKEN_MODES.includes(raw.tokenMode as TokenMode)) out.tokenMode = raw.tokenMode as TokenMode;
  if (typeof raw.greeting === "boolean") out.greeting = raw.greeting;
  if (typeof raw.name === "string" && raw.name.length <= 40) out.name = raw.name;
  if (DREAM_BACKENDS.includes(raw.dreamBackend as DreamBackend)) out.dreamBackend = raw.dreamBackend as DreamBackend;
  if (raw.dreamBackend === "opencode") out.dreamBackend = "claude"; // OpenCode no longer judges full checks
  if (typeof raw.dreamModel === "string" && MODEL.test(raw.dreamModel)) out.dreamModel = raw.dreamModel;
  if (DREAM_EFFORTS.includes(raw.dreamEffort as DreamEffort)) out.dreamEffort = raw.dreamEffort as DreamEffort;
  if (typeof raw.dreamApiModel === "string" && MODEL.test(raw.dreamApiModel)) out.dreamApiModel = raw.dreamApiModel;
  if (raw.dreamApi === "anthropic" || raw.dreamApi === "openai") out.dreamApi = raw.dreamApi;
  if (typeof raw.dreamUrl === "string" && raw.dreamUrl.length <= 300) out.dreamUrl = raw.dreamUrl;
  if (typeof raw.dreamTranscripts === "number" && raw.dreamTranscripts >= 1 && raw.dreamTranscripts <= 50) out.dreamTranscripts = Math.round(raw.dreamTranscripts);
  if (typeof raw.autoDream === "boolean") out.autoDream = raw.autoDream;
  if (typeof raw.quickCheck === "boolean") out.quickCheck = raw.quickCheck;
  if (typeof raw.autoPark === "boolean") out.autoPark = raw.autoPark;
  if (typeof raw.sound === "boolean") out.sound = raw.sound;
  if (typeof raw.startNotice === "boolean") out.startNotice = raw.startNotice;
  if (typeof raw.handoffAt === "number" && raw.handoffAt >= 50 && raw.handoffAt <= 95) out.handoffAt = Math.round(raw.handoffAt);
  return out;
}

const cache = new Map<string, Prefs & { overridden: (keyof Prefs)[] }>();

export function readPrefs(p?: RepoPaths): Prefs & { overridden: (keyof Prefs)[] } {
  const key = `${cortexHome()}|${p?.root ?? ""}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const user = clean((readObj(userFile()).prefs ?? {}) as Record<string, unknown>);
  const proj = p ? clean(readObj(projectFile(p))) : {};
  const out = settle({ ...DEFAULT_PREFS, ...user, ...proj, overridden: Object.keys(proj) as (keyof Prefs)[] });
  cache.set(key, out);
  return out;
}

/** Until v4.9 one dreamModel served every judge. Read now: a model that isn't Claude's moves to dreamApiModel (where
 * your own key used it) and the Claude model is Sonnet again, so the judge on your plan, and the fallback when your
 * key fails, always has a model `claude -p` takes. Nothing is rewritten on disk. */
function settle<T extends Prefs>(o: T): T {
  // Claude's model must be one `claude -p` takes (an OpenCode or provider name left over from v4.9 never is)
  if (CLAUDE_MODEL.test(o.dreamModel)) return o;
  // your own key's model saved in one file, the switch to your key in another (project vs user): keep the name
  return o.dreamBackend === "api" && !o.dreamApiModel && o.dreamModel ? { ...o, dreamApiModel: o.dreamModel, dreamModel: "sonnet" } : { ...o, dreamModel: "sonnet" };
}

export const forgetPrefs = () => cache.clear();
export const budgets = (p?: RepoPaths) => MODES[readPrefs(p).tokenMode];

/** Parse "on/off" and validate one setting; returns the value or an error message. */
export function parsePref(key: string, value: string): { key: keyof Prefs; value: Prefs[keyof Prefs] } | string {
  const bool = (v: string) => (/^(on|true|yes|1)$/i.test(v) ? true : /^(off|false|no|0)$/i.test(v) ? false : null);
  switch (key) {
    case "tokenMode": return TOKEN_MODES.includes(value as TokenMode) ? { key, value: value as TokenMode } : `tokenMode must be one of ${TOKEN_MODES.join(", ")}`;
    case "greeting":
    case "quickCheck":
    case "autoPark":
    case "sound":
    case "startNotice":
    case "autoDream": { const b = bool(value); return b === null ? `${key} must be on or off` : { key, value: b }; }
    case "name": return /^(?:\p{L}[\p{L}' -]{0,39})?$/u.test(value.trim()) ? { key, value: value.trim() } : "a name starts with a letter: letters and spaces, up to 40";
    case "dreamBackend": return DREAM_BACKENDS.includes(value as DreamBackend) ? { key, value: value as DreamBackend } : `dreamBackend must be one of ${DREAM_BACKENDS.join(", ")}`;
    case "dreamModel": return CLAUDE_MODEL.test(value) ? { key, value: value.toLowerCase() } : "dreamModel is Claude's model: haiku, sonnet or opus (your own key's model is dreamApiModel)";
    case "dreamEffort": return DREAM_EFFORTS.includes(value as DreamEffort) ? { key, value: value as DreamEffort } : `dreamEffort must be one of ${DREAM_EFFORTS.join(", ")}`;
    case "dreamApiModel": return MODEL.test(value) ? { key, value } : "that isn't a model name";
    case "dreamApi": return value === "anthropic" || value === "openai" ? { key, value } : "dreamApi must be anthropic or openai";
    case "dreamUrl": return value === "" || /^https?:\/\//.test(value) ? { key, value } : "dreamUrl must be a web address";
    case "dreamTranscripts": { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= 50 ? { key, value: n } : "dreamTranscripts must be a whole number from 1 to 50"; }
    case "handoffAt": { const n = Number(value); return Number.isInteger(n) && n >= 50 && n <= 95 ? { key, value: n } : "handoffAt must be a whole number from 50 to 95"; }
    default: return `unknown setting "${key}" (tokenMode, greeting, name, dreamBackend, dreamModel, dreamEffort, dreamApiModel, dreamApi, dreamUrl, dreamTranscripts, autoDream, quickCheck, handoffAt, autoPark, sound, startNotice)`;
  }
}

/** Save one preference for the user (default) or for this project only. */
export function setPref(key: keyof Prefs, value: Prefs[keyof Prefs], scope: "user" | "project", p?: RepoPaths): void {
  cache.clear();
  if (scope === "project") {
    if (!p) throw new Error("no project");
    const cur = migrateRaw(readObj(projectFile(p)));
    atomicWriteIfChanged(projectFile(p), JSON.stringify({ ...cur, [key]: value }, null, 2) + "\n");
    return;
  }
  const cfg = readObj(userFile());
  cfg.prefs = { ...migrateRaw((cfg.prefs ?? {}) as Record<string, unknown>), [key]: value };
  mkdirSync(cortexHome(), { recursive: true });
  writeFileSync(userFile(), JSON.stringify(cfg, null, 2) + "\n");
}
