import { spawnSync } from "node:child_process";
import type { Carry } from "./carry.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { askOf, noRefs } from "./brief.ts";
import { readEpisodes } from "./episodes.ts";
import type { RepoPaths } from "./paths.ts";
import { scrub } from "./scrub.ts";
import { readTurns } from "./turns.ts";

/**
 * The two upper tiers of the handoff (the third is the last exchanges word for word, in state.ts). Built from what
 * Cortex already stored, with no model, at Stop:
 *   Tier 1, pinned: what this session set out to do, your standing instructions in your own words, the decisions
 *     /cortex-handoff recorded, and memory notes a check flagged. A run of small recent turns can't push these out.
 *   Tier 2, trail: one line per earlier turn (what you asked → what got done) and this session's commits, so a new
 *     chat knows the whole arc, not just the last three turns.
 * The idea follows long-context memory designs that keep a gist, the high-value items and the recent turns intact.
 */
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const hhmm = (iso: string) => iso.slice(11, 16);
// a sentence that sets a rule for the work: never/always/don't/must/instead…
const RULE = /\b(never|always|don'?t|do not|must|instead|make sure|avoid|keep|only|should not|shouldn'?t|no more)\b/i;
const STRONG = /\b(never|always|don'?t|do not|must|critical|important)\b/i;

/** Your standing instructions this session, in your words: newest first when ranking, shown oldest first. */
export function instructions(asks: { n: number; text: string }[], max = 8): { n: number; text: string }[] {
  const seen: string[] = [];
  const out: { n: number; text: string; score: number }[] = [];
  for (const a of asks) {
    for (const raw of a.text.split(/(?<=[.!?])\s+|\n+|\s+-\s+|\s*;\s+/)) {
      const s = raw.replace(/^[-*\d.)\s]+/, "").trim();
      if (s.length < 20 || s.length > 260 || !RULE.test(s) || /\?$/.test(s)) continue;
      const key = s.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60);
      if (seen.includes(key)) continue;
      seen.push(key);
      out.push({ n: a.n, text: s, score: (STRONG.test(s) ? 2 : 1) + a.n / 100 });
    }
  }
  return out.sort((x, y) => y.score - x.score).slice(0, max).sort((x, y) => x.n - y.n).map(({ n, text }) => ({ n, text }));
}

export interface MemoryCheck { at: string; open: { label: string; line: number; kind: string; why: string }[] }
export const memoryCheckPath = (p: RepoPaths) => join(p.priv, "memory-check.json");
export function readMemoryCheck(p: RepoPaths): MemoryCheck | null {
  try { return JSON.parse(readFileSync(memoryCheckPath(p), "utf8")) as MemoryCheck; } catch { return null; }
}

/** What the newest Dream left open, for STATE.md and the handoff (written whenever a Dream runs or you decide). */
export function writeMemoryCheck(p: RepoPaths, findings: { label: string; line: number; kind: string; why: string; done?: string; skip?: boolean }[], now = new Date()): void {
  const open = findings.filter((f) => !f.done && !f.skip).map(({ label, line, kind, why }) => ({ label, line, kind, why }));
  try { writeFileSync(memoryCheckPath(p), JSON.stringify({ at: now.toISOString(), open } satisfies MemoryCheck)); } catch { /* best effort */ }
}

/** The commit HEAD points at, read from .git without starting git (null for anything unusual: worktrees, detached). */
export function headSha(root: string): string | null {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    const ref = /^ref: (refs\/heads\/.+)$/.exec(head)?.[1];
    if (!ref) return null;
    try { return readFileSync(join(root, ".git", ref), "utf8").trim() || null; } catch { /* packed */ }
    const packed = readFileSync(join(root, ".git", "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
    return packed?.split(" ")[0] ?? null;
  } catch { return null; }
}

/** This session's commits. Asked of git only when HEAD moved since the last turn (most turns don't commit), which
 * keeps one process start (about 9 ms) out of most Stop hooks. */
function commitsSince(p: RepoPaths, since: string): string[] {
  const sha = headSha(p.root);
  const file = join(p.priv, "commits-cache.json");
  const key = `${since}|${sha}`;
  if (sha) { try { const c = JSON.parse(readFileSync(file, "utf8")) as { key: string; out: string[] }; if (c.key === key) return c.out; } catch { /* no cache yet */ } }
  const r = spawnSync("git", ["-C", p.root, "log", `--since=${since}`, "--format=%h %s", "-n", "15"], { encoding: "utf8", timeout: 1_500 });
  const out = r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
  if (sha && r.status === 0) { try { writeFileSync(file, JSON.stringify({ key, out })); } catch { /* best effort */ } }
  return out;
}

export interface Tiers { pinned: string; trail: string; counts: { instructions: number; decisions: number; flagged: number; trail: number; commits: number } }

/** Tier 1 and Tier 2 as markdown, each kept within its share of the packet. */
export function buildTiers(p: RepoPaths, a: { session: string; goal?: string; handoff?: { session?: string; ts: string; decisions?: string[] } | null; recentTurns: number; room: { pinned: number; trail: number }; git: boolean; carry?: Carry | null }): Tiers {
  const turns = readTurns(p, a.session);
  const asks = turns.map((t, i) => ({ n: i + 1, ts: t.ts, text: scrub(askOf(t)).text })).filter((x) => x.text.length >= 15);
  const first = asks[0];
  const rules = instructions(asks);
  // decisions from /cortex-handoff belong to the session that recorded them (or one started before they were written)
  const h = a.handoff;
  const mine = !!h && (h.session === a.session || (!!turns[0] && h.ts >= turns[0].ts));
  const c = a.carry;
  const same = (x: string, list: string[]) => list.some((y) => y.toLowerCase() === x.toLowerCase());
  const decisions = [...(mine ? (h!.decisions ?? []).filter(Boolean) : [])];
  for (const d of c?.decisions ?? []) if (!same(d, decisions)) decisions.push(d);
  decisions.splice(8);
  // instructions given in the chat this one continues still stand (yours win when they say the same thing)
  const carriedRules = (c?.rules ?? []).filter((r) => !same(r, rules.map((x) => oneLine(x.text, 240)))).slice(0, 8);
  const mc = readMemoryCheck(p);
  const flagged = mc?.open ?? [];

  const pinnedLines = [
    first && !(a.goal ?? "").startsWith(oneLine(first.text, 120).replace(/…$/, "")) ? `**Started with** (turn 1, ${hhmm(first.ts)}): ${oneLine(first.text, 420)}` : "",
    rules.length || carriedRules.length ? `**Your standing instructions** (your words${carriedRules.length ? ", this chat and the one it continues" : ", from this session"}):\n${[...rules.map((r) => `- ${oneLine(r.text, 240)} _(turn ${r.n})_`), ...carriedRules.map((r) => `- ${r} _(earlier chat)_`)].join("\n")}` : "",
    decisions.length ? `**Decisions recorded at handoff:**\n${decisions.map((d) => `- ${oneLine(d, 240)}`).join("\n")}` : "",
    c?.milestones.length ? `**Continued from “${oneLine(c.chat, 60)}”** (session ${c.from.slice(0, 8)}); what it got done:\n${c.milestones.map((m) => `- ${m}`).join("\n")}` : "",
    flagged.length ? `**Memory notes flagged, not fixed yet** (Claude Code loaded them anyway: don't rely on them, and mention them to the user):\n${flagged.slice(0, 5).map((f) => `- \`${f.label}${f.line ? `:${f.line}` : ""}\` ${f.kind}: ${oneLine(f.why, 160)}`).join("\n")}` : "",
  ].filter(Boolean);
  let pinned = pinnedLines.length ? `## Pinned for this session (kept whatever the last turns were about)\n${pinnedLines.join("\n\n")}\n` : "";
  if (pinned.length > a.room.pinned) pinned = `${pinned.slice(0, a.room.pinned - 20).replace(/\n[^\n]*$/, "")}\n- […]\n`;

  // one line per earlier turn of this session (the newest ones are in "Where we left off", word for word)
  const eps = readEpisodes(p, 200).filter((e) => e.session === a.session).reverse();
  const older = eps.slice(0, Math.max(0, eps.length - a.recentTurns));
  const line = (e: (typeof eps)[number], i: number) => {
    const ask = noRefs(e.ask) || "(follow-up, no new message)";
    const extra = [e.commits ? `${e.commits} commit${e.commits === 1 ? "" : "s"}` : "", e.tests.ran ? (e.tests.failed ? "checks failed" : "checks passed") : ""].filter(Boolean).join(", ");
    return `- T${i + 1} ${hhmm(e.start)} · ${oneLine(scrub(ask).text, 120)}${e.done ? ` → ${oneLine(scrub(e.done).text, 150)}` : ""}${extra ? ` _(${extra})_` : ""}`;
  };
  let trailLines = older.map(line);
  const commits = a.git && eps[0] ? commitsSince(p, eps[0].start) : [];
  const tail = commits.length ? `\n**Commits this session** (newest first): ${commits.map((c) => `\`${oneLine(c, 90)}\``).join(" · ")}` : "";
  const head = "## Session trail (earlier turns, oldest first; the newest are below, word for word)\n";
  while (trailLines.length > 1 && head.length + trailLines.join("\n").length + tail.length > a.room.trail) trailLines = trailLines.slice(1);
  const dropped = older.length - trailLines.length;
  const trail = older.length || commits.length ? `${head}${dropped ? `- … ${dropped} earlier turn${dropped === 1 ? "" : "s"}\n` : ""}${trailLines.join("\n")}${tail}\n` : "";
  return { pinned, trail, counts: { instructions: rules.length + carriedRules.length, decisions: decisions.length, flagged: flagged.length, trail: older.length, commits: commits.length } };
}
