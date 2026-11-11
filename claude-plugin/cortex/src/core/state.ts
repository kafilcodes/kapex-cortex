import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { runSerialized } from "../util/lock.ts";
import type { RepoPaths } from "./paths.ts";
import { openItems, readExchanges } from "./exchanges.ts";
import { readEpisodes, TEST } from "./episodes.ts";
import { scrub } from "./scrub.ts";
import { buildBrief } from "./brief.ts";
import { budgets } from "./prefs.ts";

export const STATE_MAX = 8_000;

export interface StateInput {
  harness: string;
  model?: string;
  session: string;
  lastUser?: string;
  lastAssistant?: string;
  lastFailure?: string;
  now?: Date;
}

export interface HandoffNote { goal?: string; next?: string; ts: string; session?: string }

const handoffPath = (p: RepoPaths) => join(p.priv, "handoff.json");
export const statePath = (p: RepoPaths) => join(p.vault, "STATE.md");

export function readHandoff(p: RepoPaths): HandoffNote | null {
  try { return JSON.parse(readFileSync(handoffPath(p), "utf8")) as HandoffNote; } catch { return null; }
}

export function writeHandoff(p: RepoPaths, note: Omit<HandoffNote, "ts">, now = new Date()): HandoffNote {
  const full: HandoffNote = {
    goal: note.goal ? scrub(note.goal).text : undefined,
    next: note.next ? scrub(note.next).text : undefined,
    session: note.session,
    ts: now.toISOString(),
  };
  atomicWriteIfChanged(handoffPath(p), JSON.stringify(full, null, 2));
  return full;
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 1_500 });
  return r.status === 0 ? r.stdout.trim() : null;
}

export interface GitInfo { branch: string; diffStat: string; untracked: number; wipRef: string | null }

/**
 * One `git status` per turn (cheap). With `snapshot`, also a diff stat and a WIP ref made with
 * `git stash create` + `update-ref`, which never touches the branch, index or working tree.
 * Snapshots run only at handoff moments (rate limit, pre-compaction, /cortex-handoff), not every turn.
 */
export function gitInfo(root: string, session: string, snapshot = false): GitInfo | null {
  const status = git(root, ["status", "--porcelain=v2", "--branch"]);
  if (status === null) return null;
  let branch = "(detached)";
  const changed: string[] = [];
  let untracked = 0;
  for (const line of status.split("\n")) {
    if (line.startsWith("# branch.head ")) branch = line.slice(14);
    else if (line.startsWith("? ")) untracked++;
    else if (/^[12u] /.test(line)) {
      const parts = line.split(" ");
      const xy = parts[1].replace(/\./g, " ").trim() || "M";
      const path = line.startsWith("2 ") ? line.split("\t")[0].split(" ").slice(9).join(" ") : parts.slice(line.startsWith("u ") ? 10 : 8).join(" ");
      changed.push(`${xy.padEnd(2)} ${path}`);
    }
  }
  let diffStat = changed.slice(0, 15).join("\n") + (changed.length > 15 ? `\n… ${changed.length - 15} more` : "");
  let wipRef: string | null = null;
  if (snapshot && changed.length) {
    diffStat = git(root, ["diff", "--stat", "HEAD"]) ?? diffStat;
    const sha = git(root, ["stash", "create", `cortex wip ${session}`]);
    if (sha) {
      const ref = `refs/cortex/wip/${session.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      if (git(root, ["update-ref", ref, sha]) !== null) wipRef = `${ref} (${sha.slice(0, 10)})`;
    }
  }
  return { branch, diffStat, untracked, wipRef };
}

/** Commands that define "done": .vault/verify.txt, else common project scripts. */
export function verifyCommands(root: string): string[] {
  const file = join(root, ".vault", "verify.txt");
  if (existsSync(file)) {
    return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  }
  const out: string[] = [];
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const scripts = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const s of ["check", "typecheck", "lint", "test"]) if (scripts[s]) out.push(`npm run ${s}`);
      if (out.includes("npm run check")) return ["npm run check"];
    } catch { /* ignore */ }
  }
  if (existsSync(join(root, "go.mod"))) out.push("go build ./... && go test ./...");
  if (existsSync(join(root, "Cargo.toml"))) out.push("cargo test");
  if (existsSync(join(root, "pyproject.toml"))) out.push("pytest -q");
  return out;
}

function firstHeading(root: string): string {
  for (const f of ["SPEC.md", "README.md"]) {
    const path = join(root, f);
    if (!existsSync(path)) continue;
    const m = /^#\s+(.+)$/m.exec(readFileSync(path, "utf8"));
    if (m) return `${m[1].trim()} (from ${f})`;
  }
  return "";
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " […]" : s);
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

export function renderState(p: RepoPaths, inp: StateInput, gi: GitInfo | null): string {
  const now = inp.now ?? new Date();
  const handoff = readHandoff(p);
  const verify = verifyCommands(p.root);
  const repo = p.root.split("/").pop();
  const user = inp.lastUser ? scrub(inp.lastUser).text : "";
  const asst = inp.lastAssistant ? scrub(inp.lastAssistant).text : "";
  const brief = buildBrief(p, { session: inp.session, lastAssistant: inp.lastAssistant, handoff, heading: firstHeading(p.root), now });
  const { goal, next } = brief;
  const sections = [
    `# STATE — ${repo} · ${gi?.branch ?? "no git"} · updated ${now.toISOString()} · from ${inp.harness}${inp.model ? "/" + inp.model : ""} · session ${inp.session}`,
    "",
    "> Handoff packet written by Kapex Cortex at the end of every turn. The project's rules load by themselves (CLAUDE.md, .claude/rules, auto memory): read this, then continue from **Next action**.",
    "",
    "## Goal", goal, "",
    "## Next action", next, "",
    "## Verify (done = these pass)", verify.length ? verify.map((c) => "- `" + c + "`").join("\n") : "_No verify commands found. Add them to `.vault/verify.txt`._", "",
    "## Working tree",
    gi ? (gi.diffStat ? "```\n" + clip(gi.diffStat, 1_500) + "\n```" : "Clean (no tracked changes).") : "Not a git repository.",
    gi && gi.untracked ? `${gi.untracked} untracked file(s) (not in the WIP snapshot).` : "",
    gi?.wipRef ? `WIP snapshot: \`${gi.wipRef}\` (restore with \`git stash apply <sha>\`).` : "",
    "",
    "## Last failure", inp.lastFailure ? "```\n" + clip(scrub(inp.lastFailure).text, 1_200) + "\n```" : "None recorded.", "",
    ...workingContext(p, inp, gi),
  ];
  let text = sections.filter((s, i, a) => !(s === "" && a[i - 1] === "")).join("\n");
  const max = budgets(p).state;
  // the exchanges come last and are fitted to the budget, so nothing above them is ever cut
  const ex = exchangesSection(p, inp, asst, user, max - text.length - 200);
  text = `${text}\n${ex}`.replace(/\n{3,}/g, "\n\n");
  if (text.length > max) text = text.slice(0, max - 40) + "\n\n[…truncated for length]\n";
  return text;
}

/** Write this session's state and promote the newest session state to .vault/STATE.md, under the views lock. */
export function refreshState(p: RepoPaths, inp: StateInput, opts: { snapshot?: boolean } = {}): void {
  const gi = gitInfo(p.root, inp.session, opts.snapshot ?? false);
  const text = renderState(p, inp, gi);
  const base = join(p.states, inp.session.replace(/[^A-Za-z0-9_-]/g, "_"));
  runSerialized(p.viewsLock, p.viewsDirty, () => {
    atomicWriteIfChanged(`${base}.input.json`, JSON.stringify({ ...inp, now: undefined }));
    atomicWriteIfChanged(`${base}.md`, text);
    const newest = newestSessionState(p);
    if (newest) atomicWriteIfChanged(statePath(p), readFileSync(newest, "utf8"));
  });
}

/** The inputs last used for one session's STATE (to keep good fields when a failure payload lacks them). */
export function previousInput(p: RepoPaths, session: string): StateInput | null {
  try {
    return JSON.parse(readFileSync(join(p.states, `${session.replace(/[^A-Za-z0-9_-]/g, "_")}.input.json`), "utf8")) as StateInput;
  } catch {
    return null;
  }
}

/** Re-render the newest session's STATE (e.g. after /cortex-handoff recorded a goal and next action). */
export function rerenderNewest(p: RepoPaths): boolean {
  const newest = newestSessionState(p);
  if (!newest) return false;
  try {
    const inp = JSON.parse(readFileSync(newest.replace(/\.md$/, ".input.json"), "utf8")) as StateInput;
    refreshState(p, inp, { snapshot: true });
    return true;
  } catch {
    return false;
  }
}

function newestSessionState(p: RepoPaths): string | null {
  if (!existsSync(p.states)) return null;
  let best: { f: string; t: number } | null = null;
  for (const f of readdirSync(p.states)) {
    if (!f.endsWith(".md")) continue; // ignore *.input.json
    const path = join(p.states, f);
    const t = statSync(path).mtimeMs;
    if (!best || t > best.t) best = { f: path, t };
  }
  return best?.f ?? null;
}

/** Mark the current STATE as a rate-limit handoff (no model is available to write anything richer). */
export function stampHandoffReady(p: RepoPaths, reason: string, now = new Date()): void {
  const path = statePath(p);
  if (!existsSync(path)) return;
  runSerialized(p.viewsLock, p.viewsDirty, () => {
    const cur = readFileSync(path, "utf8").replace(/^> ⚠️ HANDOFF READY.*\n\n/m, "");
    const lines = cur.split("\n");
    const banner = `> ⚠️ HANDOFF READY (${reason}, ${now.toISOString()}). Continue in another harness with /cortex-resume.\n`;
    atomicWriteIfChanged(path, [lines[0], "", banner, ...lines.slice(1)].join("\n").replace(/\n{3,}/g, "\n\n"));
  });
}

export function stateAgeNotice(p: RepoPaths, now = new Date()): string {
  const path = statePath(p);
  if (!existsSync(path)) return "";
  const age = now.getTime() - statSync(path).mtimeMs;
  const head = readFileSync(path, "utf8").split("\n")[0].replace(/^# STATE — /, "");
  const ready = /HANDOFF READY/.test(readFileSync(path, "utf8")) ? " It was stamped HANDOFF READY." : "";
  if (age < 10 * 60_000 && !ready) return "";
  return ` A handoff packet .vault/STATE.md exists from ${ago(age)} ago (${head}).${ready} If the user wants to continue earlier work, read it first (or the user can run /cortex-resume).`;
}

/** The command as you'd type it: no `cd "…" &&` in front, no redirects or pipes after ("npm run check"). */
export function shortCommand(cmd: string): string {
  const part = cmd.split(/\s*(?:&&|;)\s*/).find((c) => TEST.test(c)) ?? cmd;
  return part.replace(/\s*(?:\d?>>?|\|).*$/, "").replace(/\s+/g, " ").trim().slice(0, 60) || "tests";
}

/** Active files, the last check and what's still open: the "where are we" a new chat needs before it touches anything. */
function workingContext(p: RepoPaths, inp: StateInput, gi: GitInfo | null): string[] {
  const eps = readEpisodes(p, 8).filter((e) => e.session === inp.session);
  // paths relative to the project, with "/" on every OS (Windows paths come in as C:\…\src\a.ts)
  const rel = (f: string) => { const r = relative(p.root, f); return (r && !r.startsWith("..") && !isAbsolute(r) ? r : f).replace(/\\/g, "/"); };
  const edited = [...new Set(eps.slice(0, 5).flatMap((e) => e.files).map(rel))].slice(0, 20);
  const changed = (gi?.diffStat ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !/^…|files? changed/.test(l)).slice(0, 20);
  const tested = eps.find((e) => e.tests.ran);
  const testCmd = shortCommand(tested?.commands.find((c) => TEST.test(c)) ?? "tests");
  const open = [...new Set([...openItems(inp.lastAssistant ?? ""), ...eps.slice(0, 3).map((e) => e.next).filter(Boolean)])].slice(0, 12);
  return [
    "## Active files",
    edited.length ? `Edited in the last turns: ${edited.map((f) => "`" + f + "`").join(", ")}` : "_No edits in the last turns._",
    changed.length ? "Uncommitted:\n```\n" + changed.join("\n") + "\n```" : "",
    "",
    "## Last check",
    tested ? `\`${testCmd.slice(0, 80)}\` ${tested.tests.failed ? `FAILED (${tested.tests.failed} of ${tested.tests.ran} runs)` : "passed"}, ${ago(Date.now() - Date.parse(tested.end))} ago.` : "_No test or check run in the last turns._",
    "",
    ...(open.length ? ["## Open items", open.map((o) => `- [ ] ${o}`).join("\n"), ""] : []),
  ];
}

/** The last exchanges in full (oldest first): the newest reply gets most of the room, so a plan written there survives whole. */
function exchangesSection(p: RepoPaths, inp: StateInput, asst: string, user: string, room: number): string {
  const lean = !budgets(p).lastReply;
  let ex = readExchanges(p, inp.session).slice(lean ? -1 : -3);
  if (!ex.length && (user || asst)) ex = [{ ts: (inp.now ?? new Date()).toISOString(), user, assistant: asst }];
  // a later payload can extend the newest reply (a usage limit adds "the next turn ended with …"): the longer one wins
  const last = ex[ex.length - 1];
  if (last && asst && asst !== last.assistant && asst.startsWith(last.assistant.slice(0, 200))) ex = [...ex.slice(0, -1), { ...last, assistant: asst }];
  if (!ex.length || room < 400) return "";
  const head = "## Where we left off (the last exchanges, oldest first; continue from the newest)\n";
  const newestRoom = Math.floor((room - head.length) * (ex.length > 1 ? 0.65 : 0.95));
  const otherRoom = ex.length > 1 ? Math.floor((room - head.length - newestRoom) / (ex.length - 1)) : 0;
  return head + ex.map((x, i) => {
    const r = i === ex.length - 1 ? newestRoom : otherRoom;
    const u = clip(x.user, Math.max(200, Math.floor(r * 0.25)));
    const a = lean ? "" : clip(x.assistant, Math.max(300, r - u.length - 60));
    return `\n### You (${x.ts.slice(0, 16).replace("T", " ")})\n${u}\n${a ? `\n### Assistant\n${a}\n` : ""}`;
  }).join("");
}
