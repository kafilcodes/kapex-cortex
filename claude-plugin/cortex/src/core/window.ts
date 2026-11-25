import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { claudeHome } from "./home.ts";

/**
 * What used the 5-hour plan: every Claude Code chat touched in the last 5 hours, in any project (the plan is shared),
 * from the usage numbers Claude Code writes into its own transcripts (0 tokens to compute). In 10-minute slots, so the
 * panel can keep only what falls after the window's real start (it knows the reset time; this file does not).
 * Each slot is split by chat, model and main chat vs subagent, with a cost weight (see WEIGHT) and the tools called.
 * Read incrementally: each file is read from where the last read stopped, so a long chat costs only its new lines.
 */
export const SLOT_MS = 10 * 60_000;
const SPAN_MS = 5 * 60 * 60_000;

/** Relative cost of a token, as the API prices them: output 5× input, cache writes 1.25×, cache reads 0.1×, and Fable
 * about 2× Opus per token (.claude/rules/engineering.md). Sonnet and Haiku are rough. The plan's own accounting is not
 * public, so the panel calls the split an estimate. */
const MODEL_WEIGHT: [RegExp, number][] = [[/fable|mythos/i, 2], [/opus/i, 1], [/sonnet/i, 0.6], [/haiku/i, 0.2]];
const modelWeight = (m: string) => MODEL_WEIGHT.find(([re]) => re.test(m))?.[1] ?? 1;

export interface WindowRow { slot: number; chat: string; model: string; sub: boolean; tokens: number; weight: number; replies: number }
export interface WindowTool { slot: number; tool: string; n: number }
export interface WindowChat { id: string; title: string; project: string; /** the folder the chat ran in, to tell two projects of one name apart */ path: string }
export interface UsageWindow { since: string; slotMs: number; rows: WindowRow[]; tools: WindowTool[]; chats: WindowChat[] }

interface FileState { size: number; offset: number; chat: string; sub: boolean; title: string; project: string; path: string; lastId: string; rows: Record<string, WindowRow>; tools: Record<string, WindowTool>; /** reply id → slot, for the replies counted here (one id is counted once across every file) */ ids: Record<string, number> }

const CHUNK = 8 << 20; // read 8 MB at a time
const FIRST = 48 << 20; // a file seen for the first time: only its last 48 MB (far more than 5 hours of any chat)

/** A tool call in plain groups: the shell, files, the web, subagents, skills, each MCP server by name. */
export function toolGroup(name: string): string {
  if (name === "Bash" || name === "BashOutput" || name === "KillShell") return "Shell";
  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit|Glob|Grep|LS)$/.test(name)) return "Files";
  if (/^Web(Search|Fetch)$/.test(name)) return "Web";
  if (name === "Task" || name === "Agent") return "Subagents";
  if (name === "Skill") return "Skills";
  const m = /^mcp__(.+?)__/.exec(name);
  if (m && /^ccd_/.test(m[1]!)) return "Claude app"; // the desktop app's own plumbing (task list, sessions)
  if (m) return `MCP · ${/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(m[1]!) ? "connector" : m[1]!.replace(/^plugin_/, "").replace(/_/g, " ")}`;
  return "Other";
}

/** Reads the new part of one transcript into its slots, in chunks, by bytes (never by decoded text: a bad byte would
 * shift the offset). `seen` holds every reply id already counted in any file, so a chat copied into a new file by a
 * fork or resume is not counted twice. Never throws on a bad line. */
function readNew(f: string, st: FileState, size: number, from: number, seen: Set<string>): void {
  if (size <= st.offset) return;
  if (st.offset === 0 && size > FIRST) st.offset = size - FIRST; // first sight of a long chat: its tail; the first partial line is skipped below
  const fd = openSync(f, "r");
  try {
    let skipFirst = st.offset > 0 && st.size === 0
    while (st.offset < size) {
      const len = Math.min(CHUNK, size - st.offset), buf = Buffer.alloc(len);
      const got = readSync(fd, buf, 0, len, st.offset);
      const end = buf.subarray(0, got).lastIndexOf(10);
      if (end < 0) { if (got === CHUNK) { st.offset += got; continue } return } // one huge line: skip it; else a line still being written
      let lines = buf.toString("utf8", 0, end).split("\n");
      st.offset += end + 1;
      if (skipFirst) { lines = lines.slice(1); skipFirst = false }
      for (const line of lines) readLine(line, st, from, seen);
    }
  } finally { closeSync(fd); }
}

function readLine(line: string, st: FileState, from: number, seen: Set<string>): void {
  if (line.includes('"custom-title"')) { try { const t = JSON.parse(line).customTitle; if (typeof t === "string" && t.trim()) st.title = t.trim().slice(0, 80); } catch { /* skip */ } return; }
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return;
  let e: { type?: string; timestamp?: string; cwd?: string; message?: { id?: string; model?: string; usage?: Record<string, number>; content?: { type?: string; name?: string }[] } };
  try { e = JSON.parse(line); } catch { return; }
  const u = e.message?.usage, at = Date.parse(e.timestamp ?? "");
  if (e.type !== "assistant" || !u || !Number.isFinite(at) || at < from) return;
  if (e.cwd && !st.path) { st.path = e.cwd; st.project = basename(e.cwd); }
  const slot = Math.floor(at / SLOT_MS), id = e.message?.id ?? "";
  // one reply is logged once per content block with the same usage: its tools count per block, its tokens once
  const again = !!id && (id === st.lastId || (seen.has(id) && !(id in st.ids)));
  if (again && id !== st.lastId) return; // the same reply in another file (a fork or resume copied it): counted there
  for (const c of e.message?.content ?? []) if (c?.type === "tool_use" && c.name) { const g = toolGroup(c.name), k = `${slot}|${g}`; (st.tools[k] ??= { slot, tool: g, n: 0 }).n++; }
  if (again) return;
  st.lastId = id;
  if (id) { seen.add(id); st.ids[id] = slot; }
  const model = (e.message?.model ?? "unknown").replace(/^claude-/, "");
  if (model === "<synthetic>") return;
  const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const weight = ((u.input_tokens ?? 0) + 5 * (u.output_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0)) * modelWeight(model);
  const k = `${slot}|${model}`, r = (st.rows[k] ??= { slot, chat: st.chat, model, sub: st.sub, tokens: 0, weight: 0, replies: 0 });
  r.tokens += tokens; r.weight += weight; r.replies++;
}

/** The plan's last 5 hours, across every project. `cacheFile` keeps where each transcript was read up to. */
export function usageWindow(cacheFile: string, now = Date.now(), home = claudeHome()): UsageWindow {
  const from = now - SPAN_MS, minSlot = Math.floor(from / SLOT_MS)
  const out: UsageWindow = { since: new Date(from).toISOString(), slotMs: SLOT_MS, rows: [], tools: [], chats: [] };
  const root = join(home, "projects");
  if (!existsSync(root)) return out;
  let cache: Record<string, FileState> = {};
  try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* first run */ }
  const next: Record<string, FileState> = {};
  // every reply id already counted, from the files read before (a cache from an older version has none)
  const seen = new Set<string>();
  for (const st of Object.values(cache)) for (const id of Object.keys(st.ids ?? {})) seen.add(id);
  const visit = (f: string, chat: string, sub: boolean) => {
    let s; try { s = statSync(f); } catch { return; }
    if (s.mtimeMs < from) return; // untouched in the window: nothing of it counts
    const old = cache[f];
    const fresh = (): FileState => ({ size: 0, offset: 0, chat, sub, title: "", project: "", path: "", lastId: "", rows: {}, tools: {}, ids: {} });
    const st: FileState = old && old.ids && old.size <= s.size && old.offset <= s.size ? old : fresh(); // shorter now: rewritten, read again
    try { readNew(f, st, s.size, from, seen); } catch { /* unreadable now: keep what was read */ }
    st.size = s.size;
    for (const k of Object.keys(st.rows)) if (st.rows[k]!.slot < minSlot) delete st.rows[k];
    for (const k of Object.keys(st.tools)) if (st.tools[k]!.slot < minSlot) delete st.tools[k];
    for (const k of Object.keys(st.ids)) if (st.ids[k]! < minSlot) delete st.ids[k];
    next[f] = st;
  };
  for (const dir of safeList(root)) {
    const d = join(root, dir);
    for (const n of safeList(d)) {
      if (n.endsWith(".jsonl")) visit(join(d, n), n.slice(0, -6), false);
      else if (!n.includes(".")) for (const s of safeList(join(d, n, "subagents"))) if (s.endsWith(".jsonl")) visit(join(d, n, "subagents", s), n, true);
    }
  }
  atomicWriteIfChanged(cacheFile, JSON.stringify(next));
  const chats = new Map<string, WindowChat>();
  for (const st of Object.values(next)) {
    out.rows.push(...Object.values(st.rows));
    out.tools.push(...Object.values(st.tools));
    const c = chats.get(st.chat);
    if (!c) chats.set(st.chat, { id: st.chat, title: st.sub ? "" : st.title, project: st.project, path: st.path });
    else { if (!st.sub && st.title) c.title = st.title; if (!c.project) { c.project = st.project; c.path = st.path; } }
  }
  out.chats = [...chats.values()].filter(c => out.rows.some(r => r.chat === c.id));
  return out;
}

function safeList(d: string): string[] { try { return readdirSync(d); } catch { return []; } }
