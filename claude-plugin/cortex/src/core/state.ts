import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { runSerialized } from "../util/lock.ts";
import { repoPaths, type RepoPaths } from "./paths.ts";
import { type GitInfo, gitInfo, verifyCommands } from "./gitinfo.ts";
import { computeMission, pinKey, readMissionRecord, writeMissionRecord, type MissionRecord } from "./mission.ts";
import { renderMission } from "./mission-view.ts";
import { chatTitle } from "./history.ts";
import { checkouts } from "./worktree.ts";
import { openItems, readExchanges } from "./exchanges.ts";
import { readEpisodes, TEST } from "./episodes.ts";
import { scrub } from "./scrub.ts";
import { carry } from "./carry.ts";
import { readTurns, rewoundRanges } from "./turns.ts";
import { buildBrief } from "./brief.ts";
import { budgets, readPrefs } from "./prefs.ts";
import { buildTiers } from "./tiers.ts";

export const STATE_MAX = 8_000;
export type { GitInfo } from "./gitinfo.ts";

export interface StateInput {
  harness: string;
  model?: string;
  session: string;
  lastUser?: string;
  lastAssistant?: string;
  lastFailure?: string;
  now?: Date;
  /** set when saved: the checkout this chat works in, and whether it did real work (a trivial chat never takes over
   * STATE.md: a "hi" or a side question must not stand in for the handoff a real task left) */
  checkout?: string;
  real?: boolean;
}

export interface HandoffNote { goal?: string; next?: string; decisions?: string[]; ts: string; session?: string }

const handoffPath = (p: RepoPaths) => join(p.priv, "handoff.json");
export const statePath = (p: RepoPaths) => join(p.vault, "STATE.md");

export function readHandoff(p: RepoPaths): HandoffNote | null {
  try { return JSON.parse(readFileSync(handoffPath(p), "utf8")) as HandoffNote; } catch { return null; }
}

/** What a handoff note keeps of each decision, and how many (kc handoff warns past either). */
export const DECISION_CHARS = 300, MAX_DECISIONS = 8;

/** Save the note for a chat. A field left out keeps what that chat's note already had (`--next` alone never wipes the
 *  goal or decisions); new decisions are added to the old ones. A note saved for another chat starts fresh. */
export function writeHandoff(p: RepoPaths, note: Omit<HandoffNote, "ts">, now = new Date()): HandoffNote {
  const prev = readHandoff(p), was = prev && prev.session === note.session ? prev : null;
  const decisions = [...new Set([...(was?.decisions ?? []), ...(note.decisions ?? []).map((d) => scrub(d).text.slice(0, DECISION_CHARS))])];
  const full: HandoffNote = {
    goal: note.goal ? scrub(note.goal).text : was?.goal,
    next: note.next ? scrub(note.next).text : was?.next,
    decisions: decisions.length ? decisions.slice(-MAX_DECISIONS) : undefined,
    session: note.session,
    ts: now.toISOString(),
  };
  atomicWriteIfChanged(handoffPath(p), JSON.stringify(full, null, 2));
  return full;
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
  const m = Math.max(0, Math.round(ms / 60_000)); // a clock that jumped back never makes "-3 min"
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
};

/** This session's mission contract (mission.ts): inherited from the chat it continues, plus its own messages. */
function missionFor(p: RepoPaths, inp: StateInput, carried: ReturnType<typeof carry>, handoff: HandoffNote | null, gi: GitInfo | null, now: Date): MissionRecord {
  const turns = readTurns(p, inp.session);
  const parent = carried ? readMissionRecord(p, carried.from) : null;
  const episodes = readEpisodes(p, 400).filter((e) => e.session === inp.session).reverse().map((e) => ({ end: e.end, ask: e.ask, done: e.done }));
  // /cortex-handoff names the chat it saved for: its decisions bind that chat only (never every chat open at the time)
  const mine = !!handoff?.session && handoff.session === inp.session;
  return computeMission(p, {
    session: inp.session, turns, now, parent, legacy: parent ? null : carried?.legacy ?? null, episodes,
    decisions: mine ? handoff!.decisions ?? [] : [], goal: mine ? handoff!.goal : undefined, git: gi ? { head: gi.head ?? null, branch: gi.branch, worktree: gi.worktree } : undefined,
  });
}

export function renderStateFull(p: RepoPaths, inp: StateInput, gi: GitInfo | null): { text: string; mission: MissionRecord } {
  const now = inp.now ?? new Date();
  const handoff = readHandoff(p);
  const verify = verifyCommands(p.root, p.vaultRoot);
  const repo = basename(p.vaultRoot);
  const user = inp.lastUser ? scrub(inp.lastUser).text : "";
  const asst = inp.lastAssistant ? scrub(inp.lastAssistant).text : "";
  const carried = carry(p, inp.session, readTurns(p, inp.session));
  const mission = missionFor(p, inp, carried, handoff, gi, now);
  const brief = buildBrief(p, { session: inp.session, lastAssistant: inp.lastAssistant, handoff, heading: firstHeading(p.root), now, carry: carried, mission: mission.mission.status === "active" && mission.lineage.hop > 1 ? mission.mission.goal : "" });
  const { goal, next } = brief;
  const max = budgets(p).state;
  const lean = !budgets(p).lastReply;
  // the contract is never cut: it takes the room it needs (up to 40% of the packet, pins shortened past that)
  const contract = renderMission(mission, { chat: (s) => chatTitle(p, s), room: Math.max(2_400, Math.round(max * 0.4)), head: gi?.head, branch: gi?.branch, worktree: gi?.worktree });
  const pinned = new Set(mission.mission.pins.map((x) => pinKey(x.text)));
  const tiers = buildTiers(p, { session: inp.session, goal, handoff, recentTurns: lean ? 1 : 3, git: !!gi, carry: carried, pinned, room: { pinned: Math.max(1_500, Math.round(max * 0.14)), trail: Math.max(1_200, Math.round(max * 0.18)) } });
  const sections = [
    `# STATE — ${repo} · ${gi?.branch ?? "no git"} · updated ${now.toISOString()} · from ${inp.harness}${inp.model ? "/" + inp.model : ""} · session ${inp.session}`,
    "",
    "> Handoff packet written by Kapex Cortex at the end of every turn. The **Mission contract** carries over from chat to chat: its goal, the user's binding rules and rejected approaches hold until the user says the mission is done. Below it, the rolling part: this chat's goal and next step, the trail of earlier turns, and the last exchanges word for word. The project's rules load by themselves (CLAUDE.md, .claude/rules, auto memory): read this, then continue from **Next action**.",
    "",
    contract,
    "## Goal", goal, "",
    "## Next action", next, "",
    "## Verify (done = these pass)", verify.length ? verify.map((c) => "- `" + c + "`").join("\n") : "_No verify commands found. Add them to `.vault/verify.txt`._", "",
    tiers.pinned,
    "## Working tree",
    gi ? (gi.diffStat ? "```\n" + clip(gi.diffStat, 1_500) + "\n```" : "Clean (no tracked changes).") : "Not a git repository.",
    gi?.op ? `**Careful:** ${gi.op} in \`${gi.worktree || "."}\`. Finish or abort it before other git work.` : "",
    gi && gi.untracked ? `${gi.untracked} untracked file(s) (not in the WIP snapshot).` : "",
    gi?.wipRef ? `WIP snapshot: \`${gi.wipRef}\` (restore with \`git stash apply <sha>\`).` : "",
    "",
    "## Last failure", inp.lastFailure ? "```\n" + clip(scrub(inp.lastFailure).text, 1_200) + "\n```" : "None recorded.", "",
    tiers.trail,
    ...workingContext(p, inp, gi),
  ];
  let text = sections.filter((s, i, a) => !(s === "" && a[i - 1] === "")).join("\n");
  // the exchanges come last and are fitted to the budget, so nothing above them is ever cut
  const ex = exchangesSection(p, inp, asst, user, max - text.length - 200);
  text = `${text}\n${ex}`.replace(/\n{3,}/g, "\n\n");
  if (text.length > max) text = text.slice(0, max - 40) + "\n\n[…truncated for length]\n";
  return { text, mission };
}
export const renderState = (p: RepoPaths, inp: StateInput, gi: GitInfo | null): string => renderStateFull(p, inp, gi).text;

/** Make the newest session's packet .vault/STATE.md, and the same file in every other checkout of the repo that has a
 * .vault/ (a chat opened in a worktree reads its own folder's copy). Idempotent: whoever holds the lock does it for all. */
function promote(p: RepoPaths, durable: boolean): void {
  const newest = newestSession(p);
  if (!newest) return;
  atomicWriteIfChanged(statePath(p), readFileSync(newest.file, "utf8"), { durable });
  // each other checkout gets the newest real work done in it, else the repo's newest (a new worktree still resumes)
  for (const c of checkouts(p.vaultRoot).slice(1)) {
    if (!existsSync(join(c, ".vault"))) continue;
    const own = newestSession(p, c) ?? newest;
    try { atomicWriteIfChanged(join(c, ".vault", "STATE.md"), readFileSync(own.file, "utf8"), { durable: false }); } catch { /* a locked or vanished worktree */ }
  }
}

/**
 * Write this session's packet and promote the newest one to .vault/STATE.md. The session's own files are written
 * first, outside the lock: they are this chat's alone, written atomically. (Before v4.5 they were written inside the
 * lock, and a second chat that found it busy only flagged it dirty, so its turn's packet was never written.)
 * `quiet`: the turn ran no command and edited nothing, so the last `git status` can be reused (gitinfo.ts).
 */
export function refreshState(p: RepoPaths, inp: StateInput, opts: { snapshot?: boolean; quiet?: boolean; /** a HANDOFF READY reason (a usage limit) */ stamp?: string } = {}): GitInfo | null {
  const gi = gitInfo(p, inp.session, { snapshot: opts.snapshot ?? false, quiet: opts.quiet ?? false });
  const { text, mission } = renderStateFull(p, inp, gi);
  const base = join(p.states, inp.session.replace(/[^A-Za-z0-9_-]/g, "_"));
  const m = mission.mission;
  const worked = readEpisodes(p, 200).some((e) => e.session === inp.session && Object.keys(e.tools).some((t) => /^(?:Edit|Write|MultiEdit|NotebookEdit|Bash)$/.test(t)));
  const real = mission.lineage.hop > 1 || m.pins.length > 0 || worked || readTurns(p, inp.session).some((t) => { const w = t.text.trim(); return w.length >= 15 && !/\?\s*$/.test(w); });
  atomicWriteIfChanged(`${base}.input.json`, JSON.stringify({ ...inp, now: undefined, lastUser: inp.lastUser ? scrub(inp.lastUser).text : undefined, lastAssistant: inp.lastAssistant ? scrub(inp.lastAssistant).text : undefined, checkout: realPath(p.root), real }), { durable: false });
  writeMissionRecord(p, mission);
  atomicWriteIfChanged(`${base}.md`, opts.stamp ? stamped(text, opts.stamp) : text, { durable: !!opts.snapshot });
  runSerialized(p.viewsLock, p.viewsDirty, () => promote(p, !!opts.snapshot), { waitMs: 250 });
  return gi;
}

/** The inputs last used for one session's STATE (to keep good fields when a failure payload lacks them). */
export function previousInput(p: RepoPaths, session: string): StateInput | null {
  try {
    return JSON.parse(readFileSync(join(p.states, `${session.replace(/[^A-Za-z0-9_-]/g, "_")}.input.json`), "utf8")) as StateInput;
  } catch {
    return null;
  }
}

/** Re-render the newest session's STATE (e.g. after /cortex-handoff recorded a goal and next action): the newest real
 * chat of this checkout, rendered against its own checkout (another worktree's chat gets its own branch and diff). */
export function rerenderNewest(p: RepoPaths): boolean {
  const newest = newestSession(p, p.root);
  if (!newest) return false;
  try {
    const root = newest.input.checkout && existsSync(newest.input.checkout) ? newest.input.checkout : p.root;
    refreshState(realPath(root) === realPath(p.root) ? p : repoPaths(root), newest.input, { snapshot: true });
    return true;
  } catch {
    return false;
  }
}

/** One spelling per folder (macOS: /var and /private/var are the same place). */
const realPath = (x: string) => { try { return realpathSync.native(x); } catch { return x; } }; // .native: Windows 8.3 short paths expand

/** The newest session packet that did real work, preferring `checkout` when given (null when there is none). Packets
 * saved before v4.5 (no `real` flag) count as real. Falls back to the newest of any kind. */
export function newestSession(p: RepoPaths, checkout?: string): { file: string; session: string; input: StateInput } | null {
  if (!existsSync(p.states)) return null;
  const all = readdirSync(p.states).filter((f) => f.endsWith(".md")).map((f) => {
    const file = join(p.states, f);
    try { return { file, t: statSync(file).mtimeMs }; } catch { return null; }
  }).filter((x): x is { file: string; t: number } => !!x).sort((a, b) => b.t - a.t);
  const input = (file: string): StateInput | null => { try { return JSON.parse(readFileSync(file.replace(/\.md$/, ".input.json"), "utf8")) as StateInput; } catch { return null; } };
  const pick = (want: (i: StateInput | null) => boolean) => {
    for (const x of all.slice(0, 60)) { const i = input(x.file); if (want(i)) return { file: x.file, session: i?.session ?? x.file.replace(/^.*\/|\.md$/g, ""), input: i ?? { harness: "unknown", session: x.file.replace(/^.*\/|\.md$/g, "") } }; }
    return null;
  };
  const real = (i: StateInput | null) => i?.real !== false;
  if (checkout) { const c = realPath(checkout); return pick((i) => real(i) && !!i?.checkout && realPath(i.checkout) === c); }
  return pick(real) ?? pick(() => true);
}

/** A packet with the HANDOFF READY banner under its header (a usage limit: no model is there to write more). */
export function stamped(text: string, reason: string, now = new Date()): string {
  const lines = text.replace(/^> ⚠️ HANDOFF READY.*\n\n/m, "").split("\n");
  const banner = `> ⚠️ HANDOFF READY (${reason}, ${now.toISOString()}). Continue in another harness with /cortex-resume.\n`;
  return [lines[0], "", banner, ...lines.slice(1)].join("\n").replace(/\n{3,}/g, "\n\n");
}
/** Mark STATE.md as a rate-limit handoff (for a caller that has no session; the hooks stamp their own packet). */
export function stampHandoffReady(p: RepoPaths, reason: string, now = new Date()): void {
  const path = statePath(p);
  if (!existsSync(path)) return;
  runSerialized(p.viewsLock, p.viewsDirty, () => atomicWriteIfChanged(path, stamped(readFileSync(path, "utf8"), reason, now)));
}

/** The one line a new chat gets at its start about a saved handoff. Off by default since v4.5: the packet is pull-only
 * (/cortex-resume, or the strip's Resume button), so a chat on a new task never reads an old task's packet. */
export function stateAgeNotice(p: RepoPaths, now = new Date()): string {
  const path = statePath(p);
  if (!readPrefs(p).startNotice || !existsSync(path)) return "";
  const age = Math.max(0, now.getTime() - statSync(path).mtimeMs);
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
  // the newest check of this chat; else the newest one in the journal (an earlier chat), so "did it pass?" has an answer
  const tested = eps.find((e) => e.tests.ran) ?? readEpisodes(p, 60).find((e) => e.tests.ran);
  const earlier = !!tested && tested.session !== inp.session;
  const testCmd = shortCommand(tested?.commands.find((c) => TEST.test(c)) ?? "tests");
  const open = [...new Set([...openItems(inp.lastAssistant ?? ""), ...eps.slice(0, 3).map((e) => e.next).filter(Boolean)])].slice(0, 12);
  return [
    "## Active files",
    edited.length ? `Edited in the last turns: ${edited.map((f) => "`" + f + "`").join(", ")}` : "_No edits in the last turns._",
    changed.length ? "Uncommitted:\n```\n" + changed.join("\n") + "\n```" : "",
    "",
    "## Last check",
    tested ? `\`${testCmd.slice(0, 80)}\` ${!tested.tests.failed ? "passed" : tested.tests.lastOk ? `passed on the last run (${tested.tests.failed} of ${tested.tests.ran} runs failed earlier and were fixed)` : `FAILED on the last run (${tested.tests.failed} of ${tested.tests.ran} runs failed)`}, ${ago(Date.now() - Date.parse(tested.end))} ago${earlier ? " (in an earlier chat)" : ""}.` : "_No test or check run in the last turns._",
    "",
    ...(open.length ? ["## Open items", open.map((o) => `- [ ] ${o}`).join("\n"), ""] : []),
  ];
}

/** The last exchanges in full (oldest first): the newest reply gets most of the room, so a plan written there survives whole. */
function exchangesSection(p: RepoPaths, inp: StateInput, asst: string, user: string, room: number): string {
  const lean = !budgets(p).lastReply;
  const cut = rewoundRanges(p, inp.session); // a rewound exchange is not where we left off
  let ex = readExchanges(p, inp.session).filter((x) => !cut.some((r) => x.ts > r.since && x.ts < r.until)).slice(lean ? -1 : -3);
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
    // a turn with no words of its own (it only ran /cortex-resume or another command) says so, never an empty block
    const u = clip(x.user, Math.max(200, Math.floor(r * 0.25))) || "_(no message of its own: a command such as /cortex-resume)_";
    const a = lean ? "" : clip(x.assistant, Math.max(300, r - u.length - 60));
    return `\n### You (${x.ts.slice(0, 16).replace("T", " ")})\n${u}\n${a ? `\n### Assistant\n${a}\n` : ""}`;
  }).join("");
}
