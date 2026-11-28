import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RepoPaths } from "./paths.ts";
import { cmdline, IS_BINARY } from "./self.ts";
import { cliFromHook } from "./dream-spawn.ts";
import { scrub } from "./scrub.ts";

/**
 * A mission's steps (v4.6): what the user asked for, item by item, ticked off as the work really gets done, through
 * every handoff.
 *
 *   from your words   a numbered list in your own message (yours, typed or pasted, never a quoted reply) becomes the
 *                     steps, word for word: each item's bold title, else its first clause
 *   Claude ticks      `kc mission done <n>` when a step is finished; `kc mission add "…"` for one the list missed,
 *                     `kc mission drop <n>` for one that no longer applies. A first chat doesn't know the command:
 *                     there, Claude's own final reply saying "Step 2 is done" is its tick (claimedSteps, strict)
 *   Cortex verifies   a tick is "verified" only while the newest check (tests, type check, lint) run in that chat at or
 *                     after it passed; a later failing check turns it back to "check failing". No check: "not verified"
 *   you decide        the panel ticks, unticks and drops too (by you: no proof needed); the mission itself never closes
 *                     by itself: when every step is done, the panel asks you
 *
 * Steps live in the mission (copied whole from chat to chat); every tick is one append-only line in
 * .vault/private/mission-marks.jsonl, keyed by the mission's id and the step's words, so a contract rebuilt from the
 * transcript keeps them.
 */
export type StepState = "open" | "done" | "dropped";
export interface Step { n: number; text: string; key: string; at: string; hop: number; from: "you" | "claude"; state: StepState;
  /** who ticked it last, when, in which chat, and what they said it rests on */ by?: "claude" | "you"; doneAt?: string; doneSession?: string; why?: string }
export type MarkOp = "done" | "open" | "drop" | "add" | "close" | "reopen";
export interface Mark { mission: string; key: string; op: MarkOp; by: "claude" | "you"; at: string; session: string; text?: string; why?: string;
  /** a tick read from Claude's reply: which reply (a hash), so the same reply never ticks twice, even after you untick it */ ref?: string }

export const MAX_STEPS = 30, STEP_CHARS = 140;
/** The command a chat runs to tick a step, spelled the way that works from its shell: the very CLI this hook runs
 * (a `kc` on the PATH can be an older install without `mission`; the e2e run with OpenCode hit exactly that). */
export const missionRun = (): string => (IS_BINARY ? cmdline(process.execPath, "") : cmdline(process.execPath, cliFromHook()));
const marksFile = (p: RepoPaths) => join(p.priv, "mission-marks.jsonl");
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t; };
export const stepKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);

// ---- reading steps out of your words -------------------------------------------------------------------------------

const ITEM = /^( {0,3})(?:#{1,6}\s*)?(?:\*\*)?(\d{1,2})[.)](?:\*\*)?\s+(\S.*)$/;
/** One item's title: its bold words when they are the title ("**Default theme** — …"), else its first clause ("**Fix**
 * the login" is "Fix the login"), without markdown. */
function title(raw: string): string {
  const bold = /^\*\*(.+?)\*\*\s*(?:$|[—–:(-])/.exec(raw.trim())?.[1];
  const t = (bold ?? raw.split(/(?<=\S)(?::\s|\s[—–-]\s|\.\s)/)[0] ?? raw).replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
  return oneLine(t, STEP_CHARS);
}

/**
 * The steps in one message: each run of numbered items (1, 2, 3 …; a new "1." starts another run, as under a second
 * heading, and a list may go on numbering after a heading: "## Part B / 3. …") with at least two items. A more indented
 * numbered line is a sub-item of the one above it, part of its body, never a run of its own. Left out: anything inside a multi-line [ … ] or a > quote (a reply
 * pasted for context), and a run that reads like a reply (`isReply`: mission.ts looksLikeReply, "I've…", "Done…").
 */
export function stepsOf(text: string, isReply: (t: string) => boolean = () => false): string[] {
  if (!/^ {0,3}(?:#{1,6}\s*)?(?:\*\*)?1[.)]/m.test(text)) return []; // no list starts here: the Stop hook's common case, in one test
  // a bracketed block over several lines is quoted material, as is a > quote
  const clean = text.replace(/\[[^\][]*\n[^\][]*\n[^\][]*\]/g, (m) => m.replace(/[^\n]/g, " ")).split("\n").map((l) => (/^\s*>/.test(l) ? "" : l));
  type Item = { n: number; indent: number; title: string; body: string };
  const runs: Item[][] = [];
  let run: Item[] = [], afterHeading = false;
  const close = () => { if (run.length >= 2) runs.push(run); run = []; };
  for (const line of clean) {
    const m = ITEM.exec(line);
    if (m && run.length && m[1]!.length > run[0]!.indent) { run[run.length - 1]!.body += `\n${line}`; continue; } // a sub-item
    if (m) {
      const n = Number(m[2]);
      if (n === 1 || (afterHeading && !run.length)) close(); else if (!run.length || n !== run[run.length - 1]!.n + 1) { close(); continue; }
      run.push({ n, indent: m[1]!.length, title: title(m[3]!), body: m[3]! });
      afterHeading = false;
    } else if (/^\s*#{1,6}\s/.test(line)) { close(); afterHeading = true; } // a new heading ends the run
    else if (run.length) run[run.length - 1]!.body += `\n${line}`;
  }
  close();
  return runs.filter((r) => !isReply(r.map((x) => x.body).join("\n")))
    .flatMap((r) => r.map((x) => scrub(x.title).text)).filter((t) => t.length >= 4).slice(0, MAX_STEPS);
}

/** Adds a step unless one with the same words is there (numbers are never reused: a dropped step keeps its own). Past
 * MAX_STEPS nothing more is added: never a step taken away, so a full rebuild and a step-by-step one agree. */
export function addStep(steps: Step[], s: Omit<Step, "n" | "key" | "state">): Step | null {
  const key = stepKey(s.text);
  if (!key || steps.length >= MAX_STEPS || steps.some((x) => x.key === key)) return null;
  const step: Step = { ...s, n: Math.max(0, ...steps.map((x) => x.n)) + 1, key, state: "open" };
  steps.push(step);
  return step;
}

// ---- ticks --------------------------------------------------------------------------------------------------------

/** Every tick for one mission, oldest first (the file's last 256 KB: a mission's ticks are a few lines each). */
export function readMarks(p: RepoPaths, mission: string): Mark[] {
  try {
    const f = marksFile(p);
    if (!existsSync(f)) return []; // no tick yet: no exception to throw and catch on every turn
    const size = statSync(f).size;
    const text = readFileSync(f, "utf8"), tail = size > 262_144 ? text.slice(-262_144) : text;
    // in time order (a tick read from a reply is dated at its turn's start, after later presses were written)
    return tail.split("\n").flatMap((l) => { try { const m = JSON.parse(l) as Mark; return m && m.mission === mission && typeof m.key === "string" && typeof m.at === "string" ? [m] : []; } catch { return []; } }).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  } catch { return []; }
}
export function appendMark(p: RepoPaths, m: Mark): void {
  appendFileSync(marksFile(p), `${JSON.stringify({ ...m, ...(m.text ? { text: oneLine(scrub(m.text).text, STEP_CHARS) } : {}), ...(m.why ? { why: oneLine(scrub(m.why).text, 200) } : {}) })}\n`);
}

/** The steps as the ticks leave them: Claude's added steps in, each step's newest tick applied; and whether the
 * mission was closed (or reopened) from the panel or the command. */
export function applyMarks(steps: Step[], marks: Mark[], hop: number): { steps: Step[]; closed: { at: string } | null | undefined } {
  const out = steps.map((x) => ({ ...x }));
  let closed: { at: string } | null | undefined;
  for (const m of marks) {
    if (m.op === "close") { closed = { at: m.at }; continue; }
    if (m.op === "reopen") { closed = null; continue; }
    if (m.op === "add" && m.text) { addStep(out, { text: m.text, at: m.at, hop, from: m.by === "you" ? "you" : "claude" }); continue; }
    const s = out.find((x) => x.key === m.key);
    if (!s) continue;
    if (m.op === "done") Object.assign(s, { state: "done", by: m.by, doneAt: m.at, doneSession: m.session, why: m.why });
    else if (m.op === "drop") Object.assign(s, { state: "dropped", by: m.by, doneAt: m.at, doneSession: m.session, why: m.why });
    else Object.assign(s, { state: "open", by: undefined, doneAt: undefined, doneSession: undefined, why: undefined });
  }
  return { steps: out, closed };
}

// ---- proof --------------------------------------------------------------------------------------------------------

export type Proof = { level: "verified" | "failing" | "unverified" | "you"; text: string };
/** What a tick rests on: the newest check run at or after it, in the chat that ticked it or a later chat of the same
 * mission (`sessions`: the one reading it), so a step that breaks after a handoff says so. Ticked by you: your call.
 * `abs`: the time as a date (the STATE.md packet, read hours later); else "9 min ago" (the panel, drawn now). */
export function proofOf(s: Step, eps: { session: string; start: string; end: string; tests: { ran: number; failed: number; lastOk?: boolean }; commits: number; commands: string[] }[], test: RegExp, now = Date.now(), o: { sessions?: string[]; abs?: boolean } = {}): Proof | null {
  if (s.state !== "done") return null;
  if (s.by === "you") return { level: "you", text: "ticked by you" };
  const at = s.doneAt ?? "", chats = new Set([s.doneSession, ...(o.sessions ?? [])]);
  // the turn the tick was made in ends after it; a check in that turn or any later one counts
  const later = eps.filter((e) => chats.has(e.session) && e.end >= at).sort((a, b) => (a.end < b.end ? 1 : -1));
  const ran = later.find((e) => e.tests.ran > 0);
  const ago = (iso: string) => { if (o.abs) return `at ${iso.slice(0, 16).replace("T", " ")}`; const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  if (ran) {
    // the command as you'd type it (state.ts shortCommand): no `cd … &&` in front, no pipe or redirect after
    const full = ran.commands.find((c) => test.test(c)) ?? "", part = full.split(/\s*(?:&&|;)\s*/).find((c) => test.test(c)) ?? full;
    const cmd = part.replace(/\s*(?:\d?>>?|\|).*$/, "").replace(/\s+/g, " ").trim().slice(0, 40) || "the checks";
    const ok = ran.tests.lastOk ?? ran.tests.failed === 0;
    return ok ? { level: "verified", text: `${cmd} passed ${ago(ran.end)}` } : { level: "failing", text: `${cmd} failed ${ago(ran.end)}` };
  }
  if (later.some((e) => e.commits > 0)) return { level: "unverified", text: "committed; no check run since" };
  return { level: "unverified", text: "no check run since" };
}

// ---- inside computeMission ----------------------------------------------------------------------------------------

type Missionish = { id: string; status: "active" | "done"; doneAt?: string; steps?: Step[]; marksAt?: string };
/** What computeMission calls, message by message: each message's lists become steps, and the ticks made before it
 * (an add, a close, a reopen) land in time order, so a contract rebuilt from scratch numbers and closes them as they
 * happened. `settle` applies the rest, then every step's newest tick. */
export function stepTicker(p: RepoPaths, hop: number, isReply: (t: string) => boolean) {
  const byMission = new Map<string, Mark[]>()
  const marks = (id: string) => { let m = byMission.get(id); if (!m) { m = readMarks(p, id); byMission.set(id, m); } return m; };
  // a close or reopen is applied once (m.marksAt: the newest one applied), so a "done" you typed after a reopen stands
  const life = (m: Missionish, until: string | null) => {
    const steps = m.steps ?? (m.steps = []);
    for (const k of marks(m.id).filter((x) => (until === null || x.at < until) && (x.op === "add" || x.op === "close" || x.op === "reopen"))) {
      if (k.op === "add" && k.text) { addStep(steps, { text: k.text, at: k.at, hop, from: k.by === "you" ? "you" : "claude" }); continue; }
      if (m.marksAt && k.at <= m.marksAt) continue;
      m.marksAt = k.at;
      if (k.op === "close" && m.status === "active") { m.status = "done"; m.doneAt = k.at; }
      else if (k.op === "reopen" && m.status === "done") { m.status = "active"; m.doneAt = undefined; }
    }
  };
  return {
    /** before a message: the ticks made earlier; then the message's own numbered lists */
    message(m: Missionish, text: string, ts: string): void {
      life(m, ts);
      if (m.status !== "active") return;
      for (const t of stepsOf(text, isReply)) addStep(m.steps ?? (m.steps = []), { text: t, at: ts, hop, from: "you" });
    },
    settle(m: Missionish): void {
      life(m, null);
      if (m.steps?.length) m.steps = applyMarks(m.steps, marks(m.id).filter((x) => x.op === "done" || x.op === "open" || x.op === "drop"), hop).steps;
    },
  };
}

// ---- Claude's own words as its tick -------------------------------------------------------------------------------

/** A plan, a condition, a question or a "not" is no claim: "once step 2 is done", "step 3 is not finished". */
const HEDGE = /\b(?:not|n't|no|once|when|after|before|until|unless|if|will|would|should|could|next|then|still|yet|almost|partly|partially|mostly)\b|\?/i;
/** Steps Claude's final reply says it finished, strictly: a sentence that begins with the step and says it is done
 * ("Step 1 is done: …", "Steps 2 and 3 are finished.", "Step 4: done"), with nothing hedging it. */
export function claimedSteps(reply: string): number[] {
  const out = new Set<number>();
  for (const raw of reply.split(/(?<=[.!?])\s+|\n+/)) {
    const s = raw.replace(/^[\s*_>#-]*(?:✅|✔|☑)?\s*/, "").trim();
    const m = /^steps?\s+(\d{1,2}(?:\s*(?:,|and|&|[-–]|to)\s*\d{1,2})*)\s*(?:\([^)]*\))?\s*(?:is|are|:|—|–|-)?\s*(?:now\s+|all\s+)?(?:done|finished|complete|completed|fixed)\b/i.exec(s);
    if (!m || HEDGE.test(s.slice(0, m.index + m[0].length))) continue;
    const nums = m[1]!.match(/\d{1,2}/g)!.map(Number);
    const range = /[-–]|to/.test(m[1]!) && nums.length === 2 && nums[1]! > nums[0]! && nums[1]! - nums[0]! <= 12;
    for (const n of range ? Array.from({ length: nums[1]! - nums[0]! + 1 }, (_, i) => nums[0]! + i) : nums) out.add(n);
  }
  return [...out];
}
/** At the Stop hook: the steps Claude's reply says it finished become its ticks (dated at the start of that turn, so
 * the turn's own check is their proof), once per reply. Returns the steps as they now stand. */
export function tickClaims(p: RepoPaths, m: { id: string; status: string; steps?: Step[] }, reply: string, session: string, turnAt: () => string, hop: number): Step[] | undefined {
  if (!reply || !m.steps?.length || m.status !== "active") return m.steps;
  const want = claimedSteps(reply);
  if (!want.length) return m.steps;
  const ref = createHash("sha256").update(reply).digest("hex").slice(0, 16), had = readMarks(p, m.id), start = turnAt();
  const fresh: Mark[] = want.map((n) => m.steps!.find((x) => x.n === n)).filter((x): x is Step => !!x && x.state === "open" && !had.some((k) => k.key === x.key && k.ref === ref))
    .map((x) => ({ mission: m.id, key: x.key, op: "done", by: "claude", at: start, session, why: "Claude said so in its reply", ref }));
  for (const k of fresh) appendMark(p, k);
  return fresh.length ? applyMarks(m.steps, fresh, hop).steps : m.steps;
}
