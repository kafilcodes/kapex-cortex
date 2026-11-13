import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readEpisodes } from "./episodes.ts";
import { chatTitle } from "./history.ts";
import type { RepoPaths } from "./paths.ts";
import type { Turn } from "./turns.ts";

/**
 * Carry-over between chats. A chat that starts with /cortex-resume continues another one, and its own handoff must
 * keep what that chat pinned: the goal, your standing instructions, the decisions, and its milestones (turns that
 * committed or fixed a failing check, with their files). Without this, chat 3 would know nothing of chat 1.
 * Which chat it continues is noted once, at its first turn: the session the handoff (.vault/STATE.md) came from then.
 * Each chat carries its predecessor's pinned lists, which already hold what that one carried, so the chain holds.
 */
export interface Carry { from: string; chat: string; goal: string; rules: string[]; decisions: string[]; milestones: string[] }

const RESUME = /cortex-resume|Resume from the Kapex Cortex handoff/i;
const mapFile = (p: RepoPaths) => join(p.priv, "carry.json");
const snapFile = (p: RepoPaths, s: string) => join(p.states, `${s.replace(/[^A-Za-z0-9_-]/g, "_")}.md`);

/** The session this one continues ("" when it started fresh). Decided at its first turn, then remembered. */
export function carriedFrom(p: RepoPaths, session: string, turns: Turn[]): string {
  let map: Record<string, string> = {};
  try { map = JSON.parse(readFileSync(mapFile(p), "utf8")) as Record<string, string>; } catch { /* none yet */ }
  if (session in map) return map[session]!;
  const first = turns[0];
  if (!first) return "";
  let from = "";
  if (RESUME.test(first.text)) {
    try {
      const head = readFileSync(join(p.vault, "STATE.md"), "utf8").split("\n")[0] ?? "";
      const id = /· session ([^\s·]+)/.exec(head)?.[1] ?? "";
      if (id && id !== session) from = id;
    } catch { /* no handoff to continue */ }
  }
  const keep = Object.entries({ ...map, [session]: from }).slice(-60);
  try { writeFileSync(mapFile(p), JSON.stringify(Object.fromEntries(keep))); } catch { /* best effort */ }
  return from;
}

/** The "- item" lines under a bold heading of a STATE packet, without their "_(turn 3)_" tags. */
function listUnder(text: string, title: string): string[] {
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
  const text = readFileSync(snapFile(p, from), "utf8");
  const goal = (/## Goal\n([^\n]+)/.exec(text)?.[1] ?? "").trim();
  // relative to the project, whichever spelling of its path the transcript used (macOS: /var vs /private/var)
  const bare = (x: string) => x.replace(/^\/private(?=\/)/, "");
  const roots = [...new Set([p.root, (() => { try { return realpathSync(p.root); } catch { return p.root; } })()].map(bare))];
  const rel = (f: string) => { const b = bare(f), r = roots.find((x) => b.startsWith(`${x}/`)); return r ? b.slice(r.length + 1) : f; };
  const milestones = readEpisodes(p, 400).filter((e) => e.session === from && (e.commits > 0 || (e.tests.failed > 0 && e.tests.lastOk)))
    .slice(0, 4).reverse()
    .map((e) => `${oneLine(e.ask || "(follow-up)", 100)}${e.done ? ` → ${oneLine(e.done, 140)}` : ""}${e.files.length ? ` _(files: ${e.files.slice(0, 3).map(rel).join(", ")}${e.tests.failed && e.tests.lastOk ? "; a failing check fixed" : ""})_` : ""}`);
  return { from, chat: chatTitle(p, from) || from.slice(0, 8), goal: goal.startsWith("_") ? "" : goal, rules: listUnder(text, "Your standing instructions"), decisions: listUnder(text, "Decisions recorded at handoff"), milestones };
}
