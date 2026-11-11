import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonl } from "../util/atomic.ts";
import { ulid } from "../util/ulid.ts";
import { segments } from "./judge.ts";
import type { RepoPaths } from "./paths.ts";
import { claudeUserText } from "./transcript.ts";

/**
 * The session journal: one episode per turn (your request → everything the AI did until it stopped), built by code
 * from the transcript lines the hooks already read. No model, no tokens, no extra file reads.
 *   ask       your own words (not pasted text, not harness notices)
 *   did       tools used, files changed, commands, tests and their result, commits, errors, interruptions
 *   cost      tokens out, context size at the end
 *   said      the AI's own "Done:" / "Next:" lines
 * Ratings (your stars or 👍/👎) and the background classifier's read of your reaction are separate append-only lines.
 * Everything stays in .vault/private/ (never committed).
 */
export interface Episode {
  id: string; session: string; start: string; end: string;
  ask: string;
  tools: Record<string, number>; files: string[]; commands: string[];
  tests: { ran: number; failed: number }; commits: number; errors: number; interrupted: boolean;
  skills: string[]; mcp: string[];
  outTokens: number; contextTokens: number;
  done: string; next: string;
}
export interface Rating { episode: string; ts: string; stars?: number; thumb?: "up" | "down"; note?: string; by: "you" | "model"; sentiment?: number }
export type EpisodeView = Episode & { rating?: Rating; feedback?: Rating };

const file = (p: RepoPaths) => join(p.priv, "episodes.jsonl");
const ratingsFile = (p: RepoPaths) => join(p.priv, "ratings.jsonl");
const openFile = (p: RepoPaths, session: string) => join(p.priv, `episode-open-${session.replace(/[^\w.-]/g, "_")}.json`);

/** A command that runs tests or checks (not one that merely mentions a tests/ folder). */
export const TEST = /\b(?:(?:npm|pnpm|yarn|bun) (?:run )?(?:test|check|typecheck|lint)|pytest|go test|cargo test|vitest|jest|node --test|make (?:test|check)|claude plugin (?:test|validate))\b/;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

type Open = Omit<Episode, "id" | "done" | "next"> & { pending: Record<string, string> };
const empty = (session: string, ts: string): Open => ({ session, start: ts, end: ts, ask: "", tools: {}, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 0, contextTokens: 0, pending: {} });

/** A turn the harness started (a background task, a side session, CI), named by what started it. */
function background(text: string): string {
  const summary = /<summary>([\s\S]*?)<\/summary>/.exec(text)?.[1]?.trim().replace(/\s+/g, " ").slice(0, 160);
  if (/<task-notification>/.test(text)) return `Background task finished${summary ? `: ${summary}` : ""}`;
  if (/<side-sessions-event>/.test(text)) return "A side session reported back";
  if (/<ci-monitor-event>/.test(text)) return "CI update on the pull request";
  return "";
}

/** Fold one transcript entry into the open episode. */
export function observe(ep: Open, entry: Record<string, unknown>): void {
  const ts = typeof entry.timestamp === "string" ? entry.timestamp : ep.end;
  ep.end = ts;
  const user = claudeUserText(entry);
  if (user) {
    if (/\[Request interrupted/.test(user)) ep.interrupted = true;
    const mine = segments(user).filter((s) => s.source === "you").map((s) => s.text.trim()).join(" ").replace(/\s+/g, " ");
    if (mine && !/^\//.test(mine)) ep.ask = (ep.ask ? `${ep.ask} · ` : "") + mine.slice(0, 400 - ep.ask.length);
    else if (!ep.ask) ep.ask = background(user);
  }
  const msg = entry.message as { content?: unknown; usage?: Record<string, number> } | undefined;
  if (entry.type === "assistant" && msg?.usage) {
    const u = msg.usage;
    ep.outTokens += u.output_tokens ?? 0;
    ep.contextTokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  }
  if (!Array.isArray(msg?.content)) return;
  for (const b of msg.content as Record<string, unknown>[]) {
    if (b.type === "tool_use") {
      const name = String(b.name ?? "?");
      const input = (b.input ?? {}) as Record<string, unknown>;
      ep.tools[name] = (ep.tools[name] ?? 0) + 1;
      if (EDIT_TOOLS.has(name) && typeof input.file_path === "string" && !ep.files.includes(input.file_path) && ep.files.length < 30) ep.files.push(input.file_path);
      if (name === "Skill" && typeof input.skill === "string" && !ep.skills.includes(input.skill)) ep.skills.push(input.skill);
      if (name.startsWith("mcp__")) { const server = name.split("__")[1] ?? name; if (!ep.mcp.includes(server)) ep.mcp.push(server); }
      if (name === "Bash" && typeof input.command === "string") {
        const cmd = input.command.replace(/\s+/g, " ").trim();
        if (ep.commands.length < 12) ep.commands.push(cmd.slice(0, 120));
        if (/\bgit commit\b/.test(cmd)) ep.commits++;
        if (TEST.test(cmd)) { ep.tests.ran++; ep.pending[String(b.id)] = "test"; }
      }
    } else if (b.type === "tool_result") {
      if (b.is_error) {
        ep.errors++;
        if (ep.pending[String(b.tool_use_id)] === "test") ep.tests.failed++;
      }
      delete ep.pending[String(b.tool_use_id)];
    }
  }
}

/** Collect entries into this session's open episode (several hooks may read parts of one turn). */
export function accumulate(p: RepoPaths, session: string, entries: Record<string, unknown>[]): void {
  if (!entries.length) return;
  const f = openFile(p, session);
  let ep: Open;
  try { ep = JSON.parse(readFileSync(f, "utf8")) as Open; } catch { ep = empty(session, String(entries[0]?.timestamp ?? new Date().toISOString())); }
  for (const e of entries) observe(ep, e);
  writeFileSync(f, JSON.stringify(ep));
}

/** A "Done: …" / "Next: …" line the AI wrote at the end of its reply. */
const pick = (reply: string, label: string) =>
  (new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${label}(?:\\*\\*)?\\s*[:：]\\s*(?:\\*\\*)?\\s*(.+)$`, "im").exec(reply)?.[1] ?? "").replace(/\*\*/g, "").trim().slice(0, 300);

/** Close the turn at Stop: the episode is written once, with the AI's own Done/Next lines. Empty turns are dropped. */
export function finalize(p: RepoPaths, session: string, lastAssistant = ""): Episode | null {
  const f = openFile(p, session);
  if (!existsSync(f)) return null;
  let ep: Open;
  try { ep = JSON.parse(readFileSync(f, "utf8")) as Open; } catch { rmSync(f, { force: true }); return null; }
  rmSync(f, { force: true });
  if (!ep.ask && !Object.keys(ep.tools).length) return null;
  const { pending: _pending, ...rest } = ep;
  const done: Episode = { id: ulid(), ...rest, done: pick(lastAssistant, "Done"), next: pick(lastAssistant, "Next") };
  appendFileSync(file(p), JSON.stringify(done) + "\n");
  return done;
}

/** Recent episodes, newest first, with your rating and the model's read of your reaction. */
export function readEpisodes(p: RepoPaths, limit = 30): EpisodeView[] {
  const eps = readJsonl<Episode>(file(p)).items.slice(-limit).reverse();
  const ratings = readJsonl<Rating>(ratingsFile(p)).items;
  return eps.map((e) => ({ ...e, rating: ratings.filter((r) => r.episode === e.id && r.by === "you").at(-1), feedback: ratings.filter((r) => r.episode === e.id && r.by === "model").at(-1) }));
}

/** Rate an episode: 1–5 stars or a thumb, an optional note. The latest rating wins. */
export function rate(p: RepoPaths, r: Omit<Rating, "ts">): void {
  appendFileSync(ratingsFile(p), JSON.stringify({ ...r, ts: new Date().toISOString(), note: r.note?.slice(0, 300) }) + "\n");
}

/** "rate: 4 great work" / "rate: up" typed in chat rates the turn before it. */
export function typedRating(text: string): { stars?: number; thumb?: "up" | "down"; note?: string } | null {
  const m = /^\s*rate\s*[:：]\s*([1-5]|up|down|👍|👎)\b\s*(.*)$/im.exec(text);
  if (!m) return null;
  const v = m[1]!;
  return { ...(/^[1-5]$/.test(v) ? { stars: Number(v) } : { thumb: v === "up" || v === "👍" ? "up" as const : "down" as const }), note: m[2]?.trim() || undefined };
}
