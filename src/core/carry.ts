import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { tryLock } from "../util/lock.ts";
import { readEpisodes } from "./episodes.ts";
import { chatTitle } from "./history.ts";
import type { LegacyParent } from "./mission.ts";
import type { RepoPaths } from "./paths.ts";
import { readCursor } from "./transcript.ts";
import type { Turn } from "./turns.ts";

/**
 * Carry-over between chats. A chat that continues another (it ran /cortex-resume, or read the handoff packet) keeps
 * that chat's mission contract (mission.ts) and its milestones: turns that committed or fixed a failing check.
 * Which chat it continues is decided in its first three turns and then remembered (carry.json, chat → parent):
 *   1. the packet it actually read: the Stop hook sees the "# STATE — … · session X" header in a tool result, so
 *      a second chat that wrote STATE.md in between can't take its place;
 *   2. else, a resume message: the session STATE.md named at that moment.
 */
export interface Carry { from: string; chat: string; goal: string; /** the parent's own Next action */ next: string; rules: string[]; decisions: string[]; milestones: string[]; legacy: LegacyParent | null }

const RESUME = /cortex-resume|Resume from the Kapex Cortex handoff/i;
const mapFile = (p: RepoPaths) => join(p.priv, "carry.json");
const snapFile = (p: RepoPaths, s: string) => join(p.states, `${s.replace(/[^A-Za-z0-9_-]/g, "_")}.md`);
const readMap = (p: RepoPaths): Record<string, string> => {
  try { const m = JSON.parse(readFileSync(mapFile(p), "utf8")) as unknown; return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, string>) : {}; } catch { return {}; }
};

/** A packet header seen in a tool result ("# STATE — repo · branch · … · session X"): the session it came from. */
export function packetSession(text: string): string {
  return /# STATE — [^\n]*?· session ([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? "";
}

/** The session this one continues ("" when it started fresh). Decided in its first three turns, then remembered. */
export function carriedFrom(p: RepoPaths, session: string, turns: Turn[]): string {
  const map = readMap(p);
  if (session in map) return map[session]!;
  if (!turns.length) return "";
  let from = readCursor(p, `claude-${session}`).packet ?? "";
  if (!from && turns.slice(0, 3).some((t) => RESUME.test(t.text))) {
    try { from = packetSession(readFileSync(join(p.vault, "STATE.md"), "utf8").split("\n")[0] ?? ""); } catch { /* no handoff to continue */ }
  }
  if (from === session) from = "";
  // undecided until a parent is known or three turns have gone by (a "hi" before /cortex-resume still counts)
  if (!from && turns.length < 3) return "";
  // two chats can take their first turn at once: the map is read and written under a lock, and written atomically.
  // A lock still busy after a second leaves the decision unsaved: the next turn decides again (never someone else's)
  const release = tryLock(join(p.priv, "locks", "carry.lock"), { waitMs: 1_000 });
  if (!release) return from;
  try {
    const cur = readMap(p);
    if (session in cur) return cur[session]!;
    const keep = Object.entries({ ...cur, [session]: from }).slice(-200);
    atomicWriteIfChanged(mapFile(p), JSON.stringify(Object.fromEntries(keep)), { durable: false });
    return from;
  } finally { release(); }
}

/** The "- item" lines under a bold heading of a STATE packet, without their "_(turn 3)_" tags. */
export function listUnder(text: string, title: string): string[] {
  const i = text.indexOf(`**${title}`);
  if (i < 0) return [];
  const out: string[] = [];
  for (const line of text.slice(i).split("\n").slice(1)) {
    if (!line.startsWith("- ")) break;
    out.push(line.slice(2).replace(/\s*_\((?:turn \d+|earlier chat)\)_\s*$/, "").trim());
  }
  return out.filter((x) => x && x !== "[…]");
}

const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

export function carry(p: RepoPaths, session: string, turns: Turn[]): Carry | null {
  const from = carriedFrom(p, session, turns);
  if (!from || !existsSync(snapFile(p, from))) return null;
  let text = "";
  try { text = readFileSync(snapFile(p, from), "utf8"); } catch { return null; }
  const goal = (/## Goal\n([^\n]+)/.exec(text)?.[1] ?? "").trim();
  // relative to the project, whichever spelling of its path the transcript used (macOS: /var vs /private/var)
  const bare = (x: string) => x.replace(/^\/private(?=\/)/, "");
  const roots = [...new Set([p.root, p.vaultRoot, ...[p.root, p.vaultRoot].map((r) => { try { return realpathSync.native(r); } catch { return r; } })].map(bare))];
  const rel = (f: string) => { const b = bare(f), r = roots.find((x) => b.startsWith(`${x}/`)); return r ? b.slice(r.length + 1) : f; };
  const milestones = readEpisodes(p, 400).filter((e) => e.session === from && (e.commits > 0 || (e.tests.failed > 0 && e.tests.lastOk)))
    .slice(0, 4).reverse()
    .map((e) => `${oneLine(e.ask || "(follow-up)", 100)}${e.done ? ` → ${oneLine(e.done, 140)}` : ""}${e.files.length ? ` _(files: ${e.files.slice(0, 3).map(rel).join(", ")}${e.tests.failed && e.tests.lastOk ? "; a failing check fixed" : ""})_` : ""}`);
  const rules = listUnder(text, "Your standing instructions"), decisions = listUnder(text, "Decisions recorded at handoff");
  // a parent from before v4.5 has no mission record: its packet is read back once, its first message included
  const started = (/\*\*Started with\*\* \([^)]*\): ([^\n]+)/.exec(text)?.[1] ?? "").trim();
  const legacy: LegacyParent = { session: from, goal: goal.startsWith("_") ? "" : goal, started, rules, decisions };
  // the parent's next step without its notes ("_(carried from …)_", "_(stated earlier …)_")
  const next = (/## Next action\n([^\n]+)/.exec(text)?.[1] ?? "").replace(/\s*_\((?:carried from|stated earlier)[^\n]*\)_\s*$/, "").replace(/^Carried from the chat this one continues \(“[^”]*”\): /, "").trim();
  return { from, chat: chatTitle(p, from) || from.slice(0, 8), goal: goal.startsWith("_") ? "" : goal, next: /^Continue from the last assistant message/.test(next) ? "" : next, rules, decisions, milestones, legacy };
}
