import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RepoPaths } from "./paths.ts";

/**
 * What this project's Claude Code chats cost, in tokens, from the usage numbers Claude Code writes into its own
 * transcripts (0 tokens to compute). Each reply is logged once per content block with the same usage, so replies are
 * counted once by message id; subagent chats (<session>/subagents/*.jsonl) count too, since they draw on the plan.
 * Per day, so the panel can show today, the last 7 days and everything kept (Claude Code deletes transcripts after
 * cleanupPeriodDays, 30 by default). Cached per file by size and time: only a chat that grew is read again.
 */
export interface Tokens { input: number; output: number; cacheRead: number; cacheWrite: number; replies: number }
export interface Spend { today: Tokens; week: Tokens; all: Tokens; since: string | null; chats: number; resumed: number; resumedContext: number; sessions: Record<string, number> }
type Day = Record<string, Tokens>;
interface FileSum { days: Day; first: string; resumed: boolean; firstContext: number; lastContext: number }

const zero = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 });
const add = (a: Tokens, b: Tokens) => { a.input += b.input; a.output += b.output; a.cacheRead += b.cacheRead; a.cacheWrite += b.cacheWrite; a.replies += b.replies; };
const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** A chat that began with /cortex-resume (or the panel's resume words). */
const RESUME = /cortex-resume|Resume from the Kapex Cortex handoff/;

function sumFile(path: string): FileSum {
  const out: FileSum = { days: {}, first: "", resumed: false, firstContext: 0, lastContext: 0 };
  const seen = new Set<string>();
  let firstUser = true;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (firstUser && line.includes('"type":"user"')) {
      firstUser = false;
      if (RESUME.test(line.slice(0, 4_000))) out.resumed = true;
    }
    if (!line.includes('"usage"')) continue; // most lines carry no usage: skip the JSON parse
    let e: { type?: string; timestamp?: string; message?: { id?: string; usage?: Record<string, number> } };
    try { e = JSON.parse(line); } catch { continue; }
    const u = e.message?.usage;
    if (e.type !== "assistant" || !u || !e.timestamp) continue;
    const id = e.message?.id ?? "";
    if (id && seen.has(id)) continue;
    seen.add(id);
    const t: Tokens = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, replies: 1 };
    add((out.days[localDay(e.timestamp)] ??= zero()), t);
    const ctx = t.input + t.cacheRead + t.cacheWrite;
    if (!out.first) { out.first = e.timestamp; out.firstContext = ctx; }
    out.lastContext = ctx;
  }
  return out;
}

/** Every transcript of this project, subagents included, with its size and time. */
function files(dir: string): { f: string; key: string; sig: string; main: boolean }[] {
  const out: { f: string; key: string; sig: string; main: boolean }[] = [];
  const push = (f: string, key: string, main: boolean) => { try { const s = statSync(f); out.push({ f, key, sig: `${s.size}:${Math.round(s.mtimeMs)}`, main }); } catch { /* gone */ } };
  for (const n of readdirSync(dir)) {
    if (n.endsWith(".jsonl")) push(join(dir, n), n, true);
    const sub = join(dir, n, "subagents");
    if (!n.includes(".") && existsSync(sub)) for (const s of readdirSync(sub)) if (s.endsWith(".jsonl")) push(join(sub, s), `${n}/${s}`, false);
  }
  return out;
}

export function projectSpend(p: RepoPaths, now = new Date(), home = process.env.CORTEX_CLAUDE_HOME ?? join(homedir(), ".claude")): Spend {
  const dir = join(home, "projects", p.root.replace(/[^A-Za-z0-9]/g, "-"));
  const res: Spend = { today: zero(), week: zero(), all: zero(), since: null, chats: 0, resumed: 0, resumedContext: 0, sessions: {} };
  if (!existsSync(dir)) return res;
  const cacheFile = join(p.priv, "spend-cache.json");
  let cache: Record<string, { sig: string; s: FileSum }> = {};
  try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* first run */ }
  const next: typeof cache = {};
  const sums: { s: FileSum; main: boolean; key: string }[] = [];
  for (const x of files(dir)) {
    const s = cache[x.key]?.sig === x.sig ? cache[x.key]!.s : sumFile(x.f);
    next[x.key] = { sig: x.sig, s };
    sums.push({ s, main: x.main, key: x.key });
  }
  atomicWriteIfChanged(cacheFile, JSON.stringify(next));
  const today = localDay(now.toISOString());
  const weekAgo = localDay(new Date(now.getTime() - 6 * 86_400_000).toISOString());
  for (const { s } of sums) for (const [day, t] of Object.entries(s.days)) {
    add(res.all, t);
    if (day >= weekAgo) add(res.week, t);
    if (day === today) add(res.today, t);
    if (!res.since || day < res.since) res.since = day;
  }
  // chats started from a handoff, and how big the chat before each one had grown: the context its first message didn't re-read
  const mains = sums.filter((x) => x.main && x.s.first).map((x) => x.s).sort((a, b) => a.first.localeCompare(b.first));
  res.chats = mains.length;
  // each recent chat's own total (its subagents included), for "this chat" on Overview
  const all = (d: FileSum) => Object.values(d.days).reduce((a, t) => a + t.input + t.output + t.cacheRead + t.cacheWrite, 0);
  for (const x of sums.filter((y) => y.main && y.s.first).sort((a, b) => b.s.first.localeCompare(a.s.first)).slice(0, 8)) {
    const id = x.key.replace(/\.jsonl$/, "");
    res.sessions[id] = all(x.s) + sums.filter((y) => !y.main && y.key.startsWith(`${id}/`)).reduce((a, y) => a + all(y.s), 0);
  }
  mains.forEach((s, i) => { if (s.resumed && i > 0) { res.resumed++; res.resumedContext += Math.max(0, mains[i - 1]!.lastContext - s.firstContext); } });
  return res;
}
