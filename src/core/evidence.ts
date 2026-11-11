import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { autoMemory, claudeProjectDir } from "./home.ts";
import { segments } from "./judge.ts";
import { scrub } from "./scrub.ts";
import { shortCommand } from "./state.ts";
import { claudeUserText } from "./transcript.ts";

/**
 * Ground truth for a Dream (layer 1 of Anthropic's memory stack): what really happened, read mechanically from
 * Claude Code's own session transcripts and git, never from what a note claims. Every item gets an id (E1, E2…);
 * a Dream may only cite these ids, and the panel shows our text for them, never a model's wording.
 *   run    a command and whether it worked (a tool error = failed)
 *   you    your own typed words (pasted text and harness notices left out)
 *   note   Claude writing to a memory file, with when
 *   commit a git commit
 */
export interface Evidence { id: string; kind: "run" | "you" | "note" | "commit"; ts: string; session: string; text: string; cmd?: string; ok?: boolean }

const TAIL = 8 * 1024 * 1024; // read at most the last 8 MB of a transcript: the recent part is what matters
const CHECKY = /\b(test|check|build|lint|typecheck|tsc|pytest|vitest|jest|cargo|go (?:test|build|vet)|make|bench)\b/;

function tail(path: string): string {
  const size = statSync(path).size;
  const n = Math.min(size, TAIL);
  const buf = Buffer.alloc(n);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, n, size - n); } finally { closeSync(fd); }
  const text = buf.toString("utf8");
  return n < size ? text.slice(text.indexOf("\n") + 1) : text;
}

/** The newest `max` transcripts of this project (subagent transcripts left out). */
export function transcripts(root: string, max: number): string[] {
  const dir = claudeProjectDir(root);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => join(dir, f))
    .map((f) => ({ f, t: statSync(f).mtimeMs })).sort((a, b) => b.t - a.t).slice(0, max).map((x) => x.f);
}

const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const resultText = (c: unknown) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (x as { text?: string }).text ?? "").join("\n") : "");

/** The commands a note talks about: backticked ones and plain "npm test" / "npm run x" style ones. */
export function commandsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]{2,80})`/g)) if (/^(npm|pnpm|yarn|bun|npx|node|deno|python3?|pytest|uv|go|cargo|make|git|kc|cortex|claude)\b/.test(m[1]!)) out.add(shortCommand(m[1]!));
  for (const m of text.matchAll(/\b((?:npm|pnpm|yarn|bun) (?:run [\w:-]+|test|t)\b)/g)) out.add(m[1]!);
  return [...out];
}

/** Does a command that ran match a command a note names ("npm run check" matches `npm run check -- --watch`)? */
export const sameCommand = (ran: string, named: string) => { const a = shortCommand(ran), b = shortCommand(named); return a === b || a.startsWith(`${b} `) || (b === "npm test" && a === "npm run test") || (b === "npm run test" && a === "npm test"); };

export function gatherEvidence(root: string, o: { transcripts: number; mentioned?: string[] }): Evidence[] {
  const runs: Evidence[] = [], you: Evidence[] = [], notes: Evidence[] = [];
  const memDir = resolve(autoMemory(root).dir);
  const isMemory = (f: string) => { const r = resolve(f); return r.startsWith(memDir) || /(?:^|[\\/])(CLAUDE(?:\.local)?\.md|AGENTS\.md)$/.test(r) || /[\\/]\.claude[\\/]rules[\\/]/.test(r); };
  const wanted = (cmd: string) => CHECKY.test(cmd) || (o.mentioned ?? []).some((m) => sameCommand(cmd, m));
  for (const path of transcripts(root, o.transcripts)) {
    let text = "";
    try { text = tail(path); } catch { continue; }
    const pending = new Map<string, { cmd: string; ts: string; session: string }>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>;
      try { e = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      const ts = String(e.timestamp ?? ""), session = String(e.sessionId ?? "").slice(0, 8);
      const content = (e.message as { content?: unknown } | undefined)?.content;
      if (e.type === "assistant" && Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
          if (b.type !== "tool_use") continue;
          const input = (b.input ?? {}) as Record<string, unknown>;
          if (b.name === "Bash" && typeof input.command === "string") {
            const cmd = shortCommand(input.command);
            if (wanted(cmd)) pending.set(String(b.id), { cmd, ts, session });
          } else if ((b.name === "Write" || b.name === "Edit") && typeof input.file_path === "string" && isMemory(input.file_path)) {
            const said = String(input.content ?? input.new_string ?? "");
            notes.push({ id: "", kind: "note", ts, session, text: `Claude wrote to ${input.file_path.split(/[\\/]/).slice(-2).join("/")}: "${clip(scrub(said).text, 220)}"` });
          }
        }
      } else if (e.type === "user") {
        if (Array.isArray(content)) {
          for (const b of content as Record<string, unknown>[]) {
            const run = b.type === "tool_result" ? pending.get(String(b.tool_use_id)) : undefined;
            if (!run) continue;
            pending.delete(String(b.tool_use_id));
            const ok = b.is_error !== true;
            const why = ok ? "" : `: ${clip(resultText(b.content).split("\n").find((l) => /error|fail|✖|not ok/i.test(l)) ?? resultText(b.content).split("\n")[0] ?? "", 160)}`;
            runs.push({ id: "", kind: "run", ts: run.ts, session: run.session, cmd: run.cmd, ok, text: `\`${run.cmd}\` ${ok ? "succeeded" : `failed${why}`}` });
          }
        }
        const typed = claudeUserText(e);
        if (typed) {
          const mine = segments(typed).filter((s) => s.source === "you").map((s) => s.text).join(" ");
          if (mine.trim() && !mine.trim().startsWith("/")) you.push({ id: "", kind: "you", ts, session, text: `You said: "${clip(scrub(mine).text, 300)}"` });
        }
      }
    }
  }
  const byTime = (a: Evidence, b: Evidence) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0);
  // the newest 3 runs of each command, the newest 40 things you said, the newest 20 memory writes, the last 30 commits
  const perCmd = new Map<string, number>();
  const keptRuns = runs.sort(byTime).filter((r) => { const n = perCmd.get(r.cmd!) ?? 0; perCmd.set(r.cmd!, n + 1); return n < 3; }).slice(0, 60);
  const all = [...keptRuns, ...you.sort(byTime).slice(0, 40), ...notes.sort(byTime).slice(0, 20), ...commits(root)].sort(byTime);
  return all.map((x, i) => ({ ...x, id: `E${i + 1}` }));
}

function commits(root: string): Evidence[] {
  const r = spawnSync("git", ["-C", root, "log", "-n", "30", "--date=iso-strict", "--format=%h%x09%ad%x09%s"], { encoding: "utf8", timeout: 3_000 });
  if (r.status !== 0) return [];
  return r.stdout.trim().split("\n").filter(Boolean).map((l) => {
    const [sha = "", ts = "", subject = ""] = l.split("\t");
    return { id: "", kind: "commit" as const, ts: new Date(ts).toISOString(), session: "", text: `Commit ${sha}: ${clip(subject, 160)}` };
  });
}

/** Is a literal (a hex colour, a name) anywhere in the project's tracked files, memory files aside? */
export function inRepo(root: string, literal: string): boolean {
  const r = spawnSync("git", ["-C", root, "grep", "-q", "-I", "-F", "-i", "-e", literal, "--", ".", ":!CLAUDE.md", ":!CLAUDE.local.md", ":!AGENTS.md", ":!.claude/rules", ":!.vault"], { timeout: 5_000 });
  return r.status === 0 ? true : r.status === 1 ? false : true; // not a git repo or an error: never claim it's gone
}

/** The evidence as numbered lines for a model (newest first), within a size budget. */
export function renderEvidence(ev: Evidence[], max = 40_000): string {
  const out: string[] = [];
  let n = 0;
  for (const e of ev) {
    const line = `${e.id} [${e.kind}${e.session ? ` · session ${e.session}` : ""} · ${e.ts.slice(0, 16).replace("T", " ")}] ${e.text}`;
    if (n + line.length > max) break;
    out.push(line);
    n += line.length + 1;
  }
  return out.join("\n");
}
