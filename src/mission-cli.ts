import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readEpisodes, TEST } from "./core/episodes.ts";
import { readMissionRecord, type MissionRecord } from "./core/mission.ts";
import { appendMark, proofOf, stepKey, stepTicker, MAX_STEPS, STEP_CHARS, type Mark, type MarkOp, type Step } from "./core/mission-steps.ts";
import type { RepoPaths } from "./core/paths.ts";
import { newestSession, rerenderNewest } from "./core/state.ts";

/**
 * kc mission: the current mission's steps, and ticking them (v4.6).
 *   kc mission                      the north star and every step, with what each tick rests on
 *   kc mission done 3 [4 …]         a step is finished (add --why "…" for what it rests on); Cortex checks the proof
 *   kc mission open 3               not finished after all       kc mission drop 3 [--why "…"]   no longer applies
 *   kc mission add "…"              a step the list missed       kc mission close / reopen        the whole mission
 * `--mission <id>` names the mission (STATE.md's Steps line and the panel pass it, so two chats or worktrees never tick
 * each other's); without it, the newest chat's here. `--by you` marks a press in the panel. Each is one line in
 * .vault/private/mission-marks.jsonl; the panel reads ticks at once, and STATE.md is written again when it is that chat's.
 */
export const MISSION_HELP = `kc mission                 the mission's steps, ticked or not, and what each tick rests on
kc mission done <n> [<n>…]  mark steps finished (--why "what it rests on"); Cortex checks it against your checks
kc mission open <n>         mark a step not finished     kc mission drop <n>   a step that no longer applies
kc mission add "<step>"     a step the list missed       kc mission close | reopen   the whole mission
                            (--mission <id> names the mission; STATE.md's Steps line gives it)`;

/** The newest chat's record whose mission is `id` (any checkout's chat writes into this vault). */
function recordOf(p: RepoPaths, id: string): MissionRecord | null {
  let best: { rec: MissionRecord; t: number } | null = null;
  try {
    for (const f of readdirSync(p.states).filter((x) => x.endsWith(".mission.json"))) {
      const rec = readMissionRecord(p, f.replace(/\.mission\.json$/, ""));
      if (rec?.mission.id !== id) continue;
      const t = statSync(join(p.states, f)).mtimeMs;
      if (!best || t > best.t) best = { rec, t };
    }
  } catch { /* no states yet */ }
  return best?.rec ?? null;
}

export function missionCommand(p: RepoPaths, rest: string[]): void {
  const [sub = "list", ...args] = rest;
  const VALUED = ["--why", "--by", "--mission"];
  const flag = (f: string) => { const i = args.indexOf(f), v = i >= 0 ? args[i + 1] : undefined; return v && !v.startsWith("--") ? v : undefined; };
  const bare = args.filter((x, i) => !x.startsWith("--") && !VALUED.includes(args[i - 1] ?? ""));
  const by: Mark["by"] = flag("--by") === "you" ? "you" : "claude";
  const why = flag("--why"), wanted = flag("--mission");
  const say = (line: string, ok = true) => { console.log(line); if (!ok) process.exitCode = 1; };
  const newest = newestSession(p, p.root);
  const rec = wanted ? recordOf(p, wanted) : newest ? readMissionRecord(p, newest.session) : null;
  if (!rec) { say(wanted ? `No mission ${wanted} here.` : "No mission yet: Cortex starts one from your first message in a chat here.", false); return; }
  // the steps as they stand now: the record, plus every tick made since it was written
  const m = { ...rec.mission, steps: rec.mission.steps?.map((x) => ({ ...x })) };
  stepTicker(p, rec.lineage.hop, () => false).settle(m);
  const steps = m.steps ?? [], session = rec.session;
  const mark = (op: MarkOp, key: string, extra: Partial<Mark> = {}) => appendMark(p, { mission: m.id, key, op, by, at: new Date().toISOString(), session, ...(why ? { why } : {}), ...extra });
  const rewrite = () => { if (newest && readMissionRecord(p, newest.session)?.mission.id === m.id) rerenderNewest(p, false); }; // STATE.md shows it now
  const find = (n: number) => steps.find((x) => x.n === n);

  if (sub === "list" || sub === "ls") {
    const eps = readEpisodes(p, 60);
    const line = (s: Step) => { const pr = proofOf(s, eps, TEST, Date.now(), { sessions: [session] }); return `${s.state === "done" ? "[x]" : s.state === "dropped" ? "[-]" : "[ ]"} ${s.n}. ${s.text}${pr ? `  (${pr.level === "verified" ? "verified: " : pr.level === "failing" ? "check failing: " : pr.level === "you" ? "" : "not verified: "}${pr.text})` : s.state === "dropped" ? "  (dropped)" : ""}`; };
    say(`Mission ${m.id}${m.status === "done" ? " (closed)" : ""}: ${m.goal || "no north star yet"}`);
    say(steps.length ? steps.map(line).join("\n") : "No steps yet: a numbered list in your message becomes the steps, or add one with kc mission add \"…\".");
    return;
  }
  if (sub === "close" || sub === "reopen") {
    if ((sub === "close") === (m.status === "done")) { say(sub === "close" ? "The mission is already closed." : "The mission is open."); return; }
    mark(sub, "*");
    rewrite();
    say(sub === "close" ? "Mission closed: its rules stop binding, and the next brief starts a new one." : "Mission reopened: its rules bind again.");
    return;
  }
  if (m.status === "done") { say("The mission is closed: reopen it first (kc mission reopen), or start the next task.", false); return; }
  if (sub === "add") {
    const text = bare.join(" ").replace(/\s+/g, " ").trim();
    if (text.length < 4) { say("Say the step: kc mission add \"what to do\"", false); return; }
    if (steps.some((x) => x.key === stepKey(text))) { say("That step is already on the list."); return; }
    if (steps.length >= MAX_STEPS) { say(`The mission has ${MAX_STEPS} steps, the most it keeps: drop one first.`, false); return; }
    mark("add", stepKey(text), { text: text.slice(0, STEP_CHARS) });
    rewrite();
    say(`Added step ${Math.max(0, ...steps.map((x) => x.n)) + 1}: ${text.slice(0, STEP_CHARS)}`);
    return;
  }
  const op: MarkOp | null = sub === "done" ? "done" : sub === "open" || sub === "undo" ? "open" : sub === "drop" ? "drop" : null;
  if (!op) { say(MISSION_HELP, false); return; }
  const nums = bare.filter((x) => /^\d+$/.test(x)).map(Number);
  if (!nums.length) { say(`Which step? kc mission ${sub} <n> (kc mission lists them)`, false); return; }
  const missing = nums.filter((n) => !find(n));
  if (missing.length) { say(`No step ${missing.join(", ")} in this mission (it has ${steps.map((x) => x.n).join(", ") || "none"}).`, false); return; }
  for (const n of nums) mark(op, find(n)!.key);
  rewrite();
  const eps = readEpisodes(p, 60), now = new Date().toISOString();
  // the proof as it stands now: a tick by Claude with no passing check after it says so, plainly
  const told = nums.map((n) => { const s = { ...find(n)!, state: op === "done" ? "done" as const : find(n)!.state, by, doneAt: now, doneSession: session }; const pr = op === "done" ? proofOf(s, eps, TEST) : null; return `${n}${pr && pr.level !== "you" ? ` (${pr.level === "verified" ? "verified" : pr.level === "failing" ? "check failing" : "not verified yet"}: ${pr.text})` : ""}`; });
  say(`${op === "done" ? "Done" : op === "drop" ? "Dropped" : "Reopened"}: step ${told.join(", ")}.`);
}
