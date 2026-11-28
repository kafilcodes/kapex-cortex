import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { computeMission, looksLikeReply, writeMissionRecord } from "../src/core/mission.ts";
import { appendMark, claimedSteps, proofOf, stepsOf, tickClaims, type Step } from "../src/core/mission-steps.ts";
import { renderMission } from "../src/core/mission-view.ts";
import { TEST } from "../src/core/episodes.ts";
import { refreshState } from "../src/core/state.ts";
import { ROOT, tmpRepo } from "./helpers.ts";

const ts = (min: number) => new Date(Date.parse("2026-11-28T09:00:00Z") + min * 60_000).toISOString();
const BRIEF = `/cortex-resume

we are checking the new UI, and I found things to fix:

### Part 1: Fixes
1. **Intro Screen — Clipped Undo Icon**
   - On the last slide the icon is cut off. I took a screenshot.
2. **Plan card marker**
   - I clicked it and nothing happened.
3. Default theme: make AMOLED the default.

### Part 2: Research
1. **Smart recommendations**
2. **Deep audit**

Last chat response attached : [Looking at how your Desktop loads Cortex.
Your Desktop is now set to load Cortex 4.6.0.
1. Install
* I pointed the plugin at the worktree folder.
2. v47-motion: it's branch v4.11 with 7 commits.
]`;

test("steps: your numbered lists, word for word (bold title, else the first clause); a quoted reply's list never", () => {
  assert.deepEqual(stepsOf(BRIEF, looksLikeReply), ["Intro Screen — Clipped Undo Icon", "Plan card marker", "Default theme", "Smart recommendations", "Deep audit"]);
  assert.deepEqual(stepsOf("1. one thing only"), [], "a single item is not a list");
  assert.deepEqual(stepsOf("1. a\n3. b\n4. c"), [], "numbers that skip are not a run");
  assert.deepEqual(stepsOf("> 1. Quoted step one\n> 2. Quoted step two"), [], "a > quote is not yours");
  const reply = "1. **Install**\nI've pointed it at the worktree. I've backed up your settings. Done: all checks pass.\n2. **Cleanup**\nI'll remove it later. Here's the diff.";
  assert.deepEqual(stepsOf(reply, looksLikeReply), [], "a list that talks like a reply");
});

test("steps: through the contract and a rebuild; Claude's ticks, adds and drops are kept by mission id; numbers never move", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s1", ref: "u1", text: `<pasted_content>${BRIEF}</pasted_content>` });
  const r1 = computeMission(p, { session: "s1", turns: readTurns(p, "s1"), now: new Date(ts(1)), parent: null, episodes: [] });
  assert.deepEqual(r1.mission.steps?.map((x) => `${x.n}. ${x.text}`), ["1. Intro Screen — Clipped Undo Icon", "2. Plan card marker", "3. Default theme", "4. Smart recommendations", "5. Deep audit"]);
  const m = r1.mission.id, key = (n: number) => r1.mission.steps!.find((x) => x.n === n)!.key;
  appendMark(p, { mission: m, key: key(1), op: "done", by: "claude", at: ts(2), session: "s1" });
  appendMark(p, { mission: m, key: "add one", op: "add", by: "claude", at: ts(3), session: "s1", text: "Add one more thing" });
  appendMark(p, { mission: m, key: key(5), op: "drop", by: "you", at: ts(4), session: "s1" });
  addTurn(p, { ts: ts(5), harness: "claude-code", session: "s1", ref: "u2", text: "and also:\n1. Fix the README\n2. Update the screenshots" });
  const r2 = computeMission(p, { session: "s1", turns: readTurns(p, "s1"), now: new Date(ts(6)), parent: null, episodes: [] });
  assert.equal(r2.mission.id, m, "a rebuilt mission keeps its id (made from the message that began it)");
  assert.deepEqual(r2.mission.steps?.map((x) => `${x.n} ${x.state} ${x.text}`), ["1 done Intro Screen — Clipped Undo Icon", "2 open Plan card marker", "3 open Default theme", "4 open Smart recommendations", "5 dropped Deep audit", "6 open Add one more thing", "7 open Fix the README", "8 open Update the screenshots"]);
  // a full rebuild (no stored record) numbers them the same way: the add landed before the second list, in time order
  const fresh = tmpRepo();
  addTurn(fresh, { ts: ts(0), harness: "claude-code", session: "s1", ref: "u1", text: `<pasted_content>${BRIEF}</pasted_content>` });
  addTurn(fresh, { ts: ts(5), harness: "claude-code", session: "s1", ref: "u2", text: "and also:\n1. Fix the README\n2. Update the screenshots" });
  for (const line of readFileSync(join(p.priv, "mission-marks.jsonl"), "utf8").trim().split("\n")) appendMark(fresh, JSON.parse(line));
  const r3 = computeMission(fresh, { session: "s1", turns: readTurns(fresh, "s1"), now: new Date(ts(6)), parent: null, episodes: [] });
  assert.deepEqual(r3.mission.steps?.map((x) => `${x.n} ${x.state}`), r2.mission.steps?.map((x) => `${x.n} ${x.state}`));
  // the next chat inherits the steps whole
  writeMissionRecord(p, r2);
  addTurn(p, { ts: ts(10), harness: "claude-code", session: "s2", ref: "v1", text: "/cortex-resume" });
  const r4 = computeMission(p, { session: "s2", turns: readTurns(p, "s2"), now: new Date(ts(11)), parent: r2, episodes: [] });
  assert.equal(r4.mission.id, m);
  assert.equal(r4.mission.steps?.find((x) => x.n === 1)?.state, "done");
  assert.equal(r4.lineage.hop, 2);
});

test("steps: a close from the panel ends the mission at its time, so the next brief starts a new one", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Build the export page.\n1. CSV export\n2. PDF export" });
  const r1 = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  appendMark(p, { mission: r1.mission.id, key: "*", op: "close", by: "you", at: ts(2), session: "s" });
  addTurn(p, { ts: ts(3), harness: "claude-code", session: "s", ref: "u2", text: "Now build the settings screen with a dark mode toggle and a reset button." });
  const r2 = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(4)), parent: null, episodes: [] });
  assert.notEqual(r2.mission.id, r1.mission.id, "a new mission");
  assert.equal(r2.mission.steps?.length ?? 0, 0);
  assert.match(r2.mission.goal, /settings screen/);
});

test("proof: verified only while the newest check at or after the tick passed; a later failure says so; yours needs none", () => {
  const step = (o: Partial<Step>): Step => ({ n: 1, text: "x", key: "x", at: ts(0), hop: 1, from: "you", state: "done", by: "claude", doneAt: ts(10), doneSession: "s", ...o });
  const ep = (end: number, ok: boolean, cmd = "npm run check", commits = 0) => ({ session: "s", start: ts(end - 1), end: ts(end), tests: { ran: 1, failed: ok ? 0 : 1, lastOk: ok }, commits, commands: [cmd] });
  const now = Date.parse(ts(20));
  assert.deepEqual(proofOf(step({}), [ep(11, true)], TEST, now), { level: "verified", text: "npm run check passed 9 min ago" });
  assert.equal(proofOf(step({}), [ep(11, true), ep(15, false)], TEST, now)?.level, "failing", "the newest check failed");
  assert.equal(proofOf(step({}), [ep(5, true)], TEST, now)?.level, "unverified", "a check before the tick's turn proves nothing");
  assert.equal(proofOf(step({}), [{ ...ep(12, true), tests: { ran: 0, failed: 0 }, commits: 1 }], TEST, now)?.text, "committed; no check run since");
  assert.equal(proofOf(step({ by: "you" }), [], TEST, now)?.level, "you");
  assert.equal(proofOf(step({ state: "open" }), [ep(11, true)], TEST, now), null);
});

test("STATE.md: the steps under the contract with each tick's proof and the one-line how-to; done steps shorten first", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Ship v2.\n1. Fix the login bug\n2. Write the release notes" });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  rec.mission.steps![0] = { ...rec.mission.steps![0]!, state: "done", by: "claude", doneAt: ts(2), doneSession: "s" };
  const out = renderMission(rec, { chat: () => "", room: 6000, proof: (x) => (x.state === "done" ? { level: "verified", text: "npm test passed 2 min ago" } : null) });
  assert.match(out, /\*\*Steps \(1 of 2 done\)\. When one is finished and its check passes, tick it: `kc mission done <n> --mission m_\w+`/);
  assert.match(out, /^- \[x\] 1\. Fix the login bug _\(verified: npm test passed 2 min ago\)_$/m);
  assert.match(out, /^- \[ \] 2\. Write the release notes$/m);
});

test("kc mission: lists, ticks by number, says what a tick rests on, refuses a step that isn't there", () => {
  const p = tmpRepo();
  const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "src", "cli.ts"), "mission", ...a], { cwd: p.root, encoding: "utf8", env: { ...process.env, CORTEX_NO_NOTIFY: "1" } });
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Ship v2.\n1. Fix the login bug\n2. Write the release notes" });
  refreshState(p, { harness: "claude-code", session: "s" } as never) // the chat's state and mission record, as the Stop hook writes them
  const list = cli();
  assert.doesNotMatch(list.stdout, /No mission yet/, list.stdout + list.stderr)
  assert.match(list.stdout, /\[ \] 1\. Fix the login bug/);
  assert.equal(cli("done", "9").status, 1);
  assert.match(cli("done", "9").stdout, /No step 9/);
  const r = cli("done", "1", "--why", "login test added");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Done: step 1 \(not verified yet: no check run since\)\.$/m);
  assert.match(cli().stdout, /\[x\] 1\. Fix the login bug/);
});

test("Claude's own reply ticks a step, strictly: \"Step 1 is done\" yes; a plan, a question or a \"not\" no; once per reply", () => {
  assert.deepEqual(claimedSteps("Step 1 is done: `add()` now returns a + b, and npm test passes.\n\nI stopped there; steps 2 and 3 are not started."), [1]);
  assert.deepEqual(claimedSteps("Steps 2 and 3 are finished. Step 4: done."), [2, 3, 4]);
  assert.deepEqual(claimedSteps("✅ Steps 1-3 are complete."), [1, 2, 3]);
  assert.deepEqual(claimedSteps("Once step 2 is done I'll do the README."), []);
  assert.deepEqual(claimedSteps("Step 3 is not done yet."), []);
  assert.deepEqual(claimedSteps("Is step 2 done?"), []);
  assert.deepEqual(claimedSteps("Step 2 is almost done."), []);
  assert.deepEqual(claimedSteps("The next step is done by the CI."), []);
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Ship v2.\n1. Fix the login bug\n2. Write the release notes" });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  const reply = "Step 1 is done: the login test passes.";
  const steps = tickClaims(p, rec.mission, reply, "s", () => ts(0), 1)!;
  assert.deepEqual(steps.map((x) => x.state), ["done", "open"]);
  assert.equal(steps[0]!.by, "claude");
  // you untick it in the panel; the same reply re-rendered never ticks it again
  appendMark(p, { mission: rec.mission.id, key: steps[0]!.key, op: "open", by: "you", at: ts(2), session: "s" });
  const again = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(3)), parent: null, episodes: [] });
  assert.deepEqual(tickClaims(p, again.mission, reply, "s", () => ts(0), 1)!.map((x) => x.state), ["open", "open"]);
});

test("review fixes: nested lists keep their parents; a list may go on numbering after a heading; a short bold word keeps its clause", () => {
  assert.deepEqual(stepsOf("1. Build the parser\n   1. tokens first\n   2. then the grammar\n2. Write tests\n3. Ship"), ["Build the parser", "Write tests", "Ship"]);
  assert.deepEqual(stepsOf("## Part A\n1. One thing\n2. Two things\n## Part B\n3. Three things\n4. Four things"), ["One thing", "Two things", "Three things", "Four things"]);
  assert.deepEqual(stepsOf("1. **Fix** the login\n2. **Default theme** — make AMOLED the default"), ["Fix the login", "Default theme"]);
});

test("review fixes: a done you typed after a panel reopen stands; the step cap never takes a step away", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Build the export page.\n1. CSV export\n2. PDF export" });
  const r1 = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  appendMark(p, { mission: r1.mission.id, key: "*", op: "close", by: "you", at: ts(2), session: "s" });
  appendMark(p, { mission: r1.mission.id, key: "*", op: "reopen", by: "you", at: ts(3), session: "s" });
  writeMissionRecord(p, computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(3.5)), parent: null, episodes: [] }));
  addTurn(p, { ts: ts(4), harness: "claude-code", session: "s", ref: "u2", text: "The task is done." });
  assert.equal(computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(5)), parent: null, episodes: [] }).mission.status, "done", "incremental");
  const fresh = tmpRepo();
  for (const t of readTurns(p, "s")) addTurn(fresh, t);
  for (const line of readFileSync(join(p.priv, "mission-marks.jsonl"), "utf8").trim().split("\n")) appendMark(fresh, JSON.parse(line));
  assert.equal(computeMission(fresh, { session: "s", turns: readTurns(fresh, "s"), now: new Date(ts(5)), parent: null, episodes: [] }).mission.status, "done", "full rebuild");
  const many = Array.from({ length: 40 }, (_, i) => `${i + 1}. Task number ${i + 1}`).join("\n");
  const q = tmpRepo();
  addTurn(q, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: many });
  const r = computeMission(q, { session: "s", turns: readTurns(q, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  assert.equal(r.mission.steps?.[0]?.n, 1);
  assert.ok((r.mission.steps?.length ?? 0) <= 30);
});

test("review fixes: proof follows the mission into the next chat, and STATE.md says when as a date, never 'just now'", () => {
  const step: Step = { n: 1, text: "x", key: "x", at: ts(0), hop: 1, from: "you", state: "done", by: "claude", doneAt: ts(10), doneSession: "parent" };
  const ep = (session: string, end: number, ok: boolean) => ({ session, start: ts(end - 1), end: ts(end), tests: { ran: 1, failed: ok ? 0 : 1, lastOk: ok }, commits: 0, commands: ["npm test"] });
  assert.equal(proofOf(step, [ep("parent", 11, true), ep("child", 30, false)], TEST, Date.parse(ts(31)), { sessions: ["child"] })?.level, "failing", "the child's failing check counts");
  assert.equal(proofOf(step, [ep("parent", 11, true), ep("other", 30, false)], TEST, Date.parse(ts(31)), { sessions: ["child"] })?.level, "verified", "an unrelated chat's check doesn't");
  assert.equal(proofOf(step, [ep("parent", 11, true)], TEST, Date.parse(ts(12)), { abs: true })?.text, "npm test passed at 2026-11-28 09:11");
});

test("kc mission: --mission names the mission; a closed mission takes no ticks; --why with no value is no reason", () => {
  const p = tmpRepo();
  const cli = (...a: string[]) => spawnSync(process.execPath, [join(ROOT, "src", "cli.ts"), "mission", ...a], { cwd: p.root, encoding: "utf8", env: { ...process.env, CORTEX_NO_NOTIFY: "1" } });
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Ship v2.\n1. Fix the login bug\n2. Write the release notes" });
  refreshState(p, { harness: "claude-code", session: "s" } as never);
  const id = /^Mission (m_\w+)/m.exec(cli().stdout)?.[1]!;
  assert.match(cli("done", "1", "--mission", "m_NOPE").stdout, /No mission m_NOPE here/);
  assert.equal(cli("done", "1", "--mission", id, "--why", "--by", "you").status, 0);
  const marks = readFileSync(join(p.priv, "mission-marks.jsonl"), "utf8");
  assert.doesNotMatch(marks, /"why":"--by"/);
  assert.match(marks, /"by":"you"/);
  assert.equal(cli("close", "--mission", id).status, 0);
  const late = cli("done", "2", "--mission", id);
  assert.equal(late.status, 1);
  assert.match(late.stdout, /The mission is closed/);
});

test("proof names the check as you'd type it: no cd in front, no pipe after", () => {
  const step: Step = { n: 1, text: "x", key: "x", at: ts(0), hop: 1, from: "you", state: "done", by: "claude", doneAt: ts(10), doneSession: "s" };
  const ep = { session: "s", start: ts(10), end: ts(11), tests: { ran: 1, failed: 0, lastOk: true }, commits: 0, commands: ['cd "/x y" && npm test 2>&1 | tail -n 15'] };
  assert.equal(proofOf(step, [ep], TEST, Date.parse(ts(12)))?.text, "npm test passed 1 min ago");
});
