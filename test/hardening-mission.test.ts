import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { addPin, computeMission, MAX_PINS, pinKind, pinsOf, readMissionRecord, writeMissionRecord, type Mission } from "../src/core/mission.ts";
import { refreshState, statePath } from "../src/core/state.ts";
import { runTelephone, score, telephoneRepo } from "../scripts/telephone.ts";
import { ROOT, tmpRepo } from "./helpers.ts";

const HOOK = join(ROOT, "claude-plugin", "cortex", "hook.mjs");
const hook = (event: string, input: object) => spawnSync(process.execPath, [HOOK, event, "--plugin"], { input: JSON.stringify(input), encoding: "utf8" });
const ts = (min: number) => new Date(Date.parse("2026-11-20T09:00:00Z") + min * 60_000).toISOString();

test("5-hop telephone: chat 5 still holds chat 1's mandatory skill, never-rule, scope rule, rejected approach and goal, verbatim", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-tel-"));
  telephoneRepo(root);
  const r = runTelephone(root, HOOK);
  const s = score(r.packet);
  assert.deepEqual(s.filter((x) => !x.ok).map((x) => x.name), [], "every probe passes");
  // every hop, not only the last: the skill mandate is in chats 1-5 alike
  for (const [i, packet] of r.perChat.entries()) assert.match(packet, /\[skill\/workflow\] “Use the stageshow skill fully/, `chat ${i + 1}`);
  // the mission is one, from chat 1 to chat 5
  const ids = r.perChat.map((x) => /mission=(\S+)/.exec(x)?.[1]);
  assert.equal(new Set(ids).size, 1, `one mission id across the chain: ${ids.join(", ")}`);
  assert.deepEqual(r.perChat.map((x) => /hop=(\d+)/.exec(x)?.[1]), ["1", "2", "3", "4", "5"]);
});

test("rule reading: a mandate needs no 'must'; turn-only words, questions and pasted text are not rules", () => {
  assert.equal(pinKind("and use best of stage show skill (and give full context about project to skill)"), "skill");
  assert.equal(pinKind("Invoke the stageshow skill fully via the Skill tool."), "skill");
  assert.equal(pinKind("Do NOT touch v4.10 or v4.11."), "never");
  assert.equal(pinKind("Keep v4.10 and v4.11 untouched as unmerged branches."), "never");
  assert.equal(pinKind("Keep the Stop hook p95 under 60 ms."), "must");
  assert.equal(pinKind("don't edit yet"), null, "about this turn only");
  assert.equal(pinKind("should we never merge this?"), null, "a question");
  assert.equal(pinKind("Build the export page."), null, "a task, not a rule");
  const p = tmpRepo();
  // the user pasted an earlier reply that is full of rule words: none of it is theirs to keep
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "<pasted_content>I've stopped and saved. I kept the gray theme. You must never merge. Always use the gray theme.</pasted_content>\nok go" });
  addTurn(p, { ts: ts(1), harness: "claude-code", session: "s", ref: "u2", text: "Build the export page. Never push to GitHub without asking." });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(2)), parent: null, episodes: [] });
  assert.deepEqual(rec.mission.pins.map((x) => x.text), ["Never push to GitHub without asking."]);
  assert.equal(rec.mission.goal, "Build the export page. Never push to GitHub without asking.");
});

test("rule reading, precision: directives are rules; reports, reassurance and passing words are not (review fixtures)", () => {
  const rules: [string, string][] = [
    ["and use best of stage show skill (and give full context about project to skill, so it dont assume this as mobile or web app )", "skill"],
    ["Keep `v4.10` and `v4.11` untouched as unmerged branches—we are pausing UI/stageshow visual revamps for now.", "never"],
    ["Do NOT touch `v4.10` or `v4.11`, and do NOT merge or publish to GitHub yet until I review your report.", "never"],
    ["Keep all existing features, 6 tabs, Dream, Quick check, Handoff, sounds, and graphics 100% intact.", "never"],
    ["Never let a 5-hour limit reached or Rewound event corrupt the handoff Goal or Timeline.", "never"],
    ["don’t merge, just stop", "never"],
    ["Switch everything to XML and never use CSV again.", "never"],
    ["Second: never ship on Fridays.", "never"],
    ["It must stay under 60 ms at p95.", "must"],
    ["Always run npm run check before every commit.", "must"],
  ];
  for (const [s, kind] of rules) assert.equal(pinKind(s), kind, s);
  const reports = [
    "I don't see the button on the settings page.", "It crashes without the network connection.", "It always crashes when I click save.",
    "Don't worry about the lint warnings for now.", "I'm happy with the skills page now, nice work.", "I don’t think that matters much here.",
    "The build always fails on CI without the cache.", "We tried that without luck last week.", "That looks good, keep going with the next one.",
  ];
  for (const s of reports) assert.equal(pinKind(s), null, s);
  // closing and rejecting need their own words: a passing "work done" or "No problem" never does either
  const p = tmpRepo();
  const say = (n: number, text: string) => addTurn(p, { ts: ts(n), harness: "claude-code", session: "s", ref: `u${n}`, text });
  say(0, "Redesign the panel. Use the stageshow skill fully via the Skill tool.");
  ["Work done in the last chat broke the build, please look at it.", "Project complete means tests pass on every page, so check all six tabs.", "No problem, carry on with the next page.", "Nope, all good, ship it.", "Undo works now, thanks.", "Wrong file was open on my side, carry on."].forEach((x, i) => say(i + 1, x));
  const m = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(9)), parent: null, episodes: [{ end: ts(0.5), ask: "", done: "Built the Overview with a stageshow mockup" }] }).mission;
  assert.equal(m.status, "active");
  assert.match(m.goal, /^Redesign the panel/);
  assert.deepEqual(m.rejected, []);
  assert.deepEqual(m.pins.map((x) => x.kind), ["skill"]);
});

test("a new task archives the old mission: its rules stop binding, so they never send new work on a side quest", () => {
  const p = tmpRepo();
  const say = (n: number, text: string) => addTurn(p, { ts: ts(n), harness: "claude-code", session: "s", ref: `u${n}`, text });
  say(0, "Redesign the panel. Use the stageshow skill for every mockup.");
  say(1, "reject, this is a downgrade");
  say(2, "New task: add CSV export to the invoice CLI. Never change the JSON output.");
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(3)), parent: null, episodes: [] });
  writeMissionRecord(p, rec); // as refreshState does after each turn
  assert.match(rec.mission.goal, /^add CSV export to the invoice CLI/);
  assert.deepEqual(rec.mission.pins.map((x) => x.text), ["Never change the JSON output."]);
  assert.equal(rec.mission.rejected.length, 0);
  const archived = readFileSync(join(p.priv, "missions-archive.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Mission);
  assert.equal(archived.length, 1);
  assert.match(archived[0]!.pins[0]!.text, /stageshow/);
  // computing again (the next Stop) archives nothing twice
  computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(4)), parent: null, episodes: [] });
  assert.equal(readFileSync(join(p.priv, "missions-archive.jsonl"), "utf8").trim().split("\n").length, 1);
});

test("'the task is done' closes the mission; the next real task starts a fresh one, and a question never closes it", () => {
  const p = tmpRepo();
  const say = (n: number, text: string) => addTurn(p, { ts: ts(n), harness: "claude-code", session: "s", ref: `u${n}`, text });
  say(0, "Ship the login page. Always keep the old route working.");
  say(1, "is the task done?");
  let m = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(2)), parent: null, episodes: [] }).mission;
  assert.equal(m.status, "active");
  say(3, "Great, the task is done.");
  m = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(4)), parent: null, episodes: [] }).mission;
  assert.equal(m.status, "done");
  say(5, "Now build the settings screen with a dark mode toggle and a reset button for every field.");
  m = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(6)), parent: null, episodes: [] }).mission;
  assert.equal(m.status, "active");
  assert.match(m.goal, /settings screen/);
  assert.equal(m.pins.length, 0);
});

test("a parent from before v4.5 (no mission record) still hands over its first message's mandate", () => {
  const p = tmpRepo();
  mkdirSync(p.states, { recursive: true });
  // an old packet: the mandate lived only in "Started with", which v4.4 never carried
  writeFileSync(join(p.states, "old.md"), "# STATE — x · main · updated 2026-11-18T10:00:00Z · from claude-code · session old\n\n## Goal\nFinish v4.10\n\n## Pinned for this session (kept whatever the last turns were about)\n**Started with** (turn 1, 11:34): and use best of stage show skill (give it full context) and i want production quality\n\n**Your standing instructions** (your words, from this session):\n- never merge without before/after images _(turn 3)_\n");
  writeFileSync(join(p.vault, "STATE.md"), readFileSync(join(p.states, "old.md"), "utf8"));
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "new", ref: "n1", text: "/cortex-resume" });
  refreshState(p, { harness: "claude-code", session: "new" });
  const rec = readMissionRecord(p, "new")!;
  assert.equal(rec.lineage.hop, 2);
  assert.ok(rec.mission.pins.some((x) => x.kind === "skill" && /stage show skill/.test(x.text)), JSON.stringify(rec.mission.pins));
  assert.ok(rec.mission.pins.some((x) => /never merge without before\/after images/.test(x.text)));
  assert.match(readFileSync(statePath(p), "utf8"), /\[skill\/workflow\] “and use best of stage show skill/);
});

test("lineage follows the packet the chat really read, even when another chat wrote STATE.md in between", () => {
  const p = tmpRepo();
  const tp = (s: string) => join(p.root, `${s}.jsonl`);
  const user = (s: string, n: number, content: unknown) => appendFileSync(tp(s), JSON.stringify({ type: "user", uuid: `${s}-${n}`, timestamp: ts(n), message: { role: "user", content } }) + "\n");
  user("a", 0, "Write the parser. Never use regex for dates.");
  hook("claude.stop", { session_id: "a", transcript_path: tp("a"), cwd: p.root, last_assistant_message: "Parser written." });
  const packetA = readFileSync(statePath(p), "utf8");
  // chat c resumes and reads a's packet; chat b writes STATE.md before c's turn ends
  user("c", 2, "/cortex-resume");
  appendFileSync(tp("c"), JSON.stringify({ type: "user", uuid: "c-r", timestamp: ts(3), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: packetA }] } }) + "\n");
  user("b", 4, "Unrelated: what time zone does the server use?");
  hook("claude.stop", { session_id: "b", transcript_path: tp("b"), cwd: p.root, last_assistant_message: "UTC." });
  hook("claude.stop", { session_id: "c", transcript_path: tp("c"), cwd: p.root, last_assistant_message: "Picking up the parser." });
  const rec = readMissionRecord(p, "c")!;
  assert.equal(rec.lineage.parentSession, "a");
  assert.ok(rec.mission.pins.some((x) => x.text === "Never use regex for dates."));
});

test("a rewind (a branch to an earlier message, or a shrunk transcript) drops the abandoned messages from goal, rules and trail", () => {
  const p = tmpRepo();
  const tp = join(p.root, "t.jsonl");
  const line = (o: object) => appendFileSync(tp, JSON.stringify(o) + "\n");
  line({ type: "user", uuid: "u1", timestamp: ts(0), message: { role: "user", content: "Build the export page with a CSV button." } });
  line({ type: "assistant", uuid: "a1", parentUuid: "u1", timestamp: ts(1), message: { role: "assistant", content: [{ type: "text", text: "Built it." }] } });
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "Built it." });
  line({ type: "user", uuid: "u2", parentUuid: "a1", timestamp: ts(2), message: { role: "user", content: "Switch everything to XML and never use CSV again." } });
  line({ type: "assistant", uuid: "a2", parentUuid: "u2", timestamp: ts(3), message: { role: "assistant", content: [{ type: "text", text: "Switched to XML." }] } });
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "Switched to XML." });
  assert.ok(readMissionRecord(p, "s")!.mission.pins.some((x) => /never use CSV/.test(x.text)));
  // the user rewinds to after a1 and says something else: u3's parent is a1, not a2
  line({ type: "user", uuid: "u3", parentUuid: "a1", timestamp: ts(4), message: { role: "user", content: "Add a PDF button next to CSV." } });
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "Added PDF." });
  const texts = readTurns(p, "s").map((t) => t.text);
  assert.deepEqual(texts, ["Build the export page with a CSV button.", "Add a PDF button next to CSV."]);
  assert.ok(!readMissionRecord(p, "s")!.mission.pins.some((x) => /never use CSV/.test(x.text)), "the rewound rule is gone");
  assert.doesNotMatch(readFileSync(statePath(p), "utf8"), /XML/);
  // a transcript that shrank (rewritten shorter) is read again without counting a message twice
  writeFileSync(tp, readFileSync(tp, "utf8").split("\n").slice(0, 2).join("\n") + "\n");
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "ok" });
  assert.deepEqual(readTurns(p, "s").map((t) => t.text), ["Build the export page with a CSV button."]);
});

test("over the pin cap, skill mandates and never-rules outlive any number of must-rules", () => {
  const m: Mission = { id: "m", goal: "g", goalAt: "", goalHop: 1, pins: [], rejected: [], status: "active" };
  addPin(m, { text: "Use the stageshow skill for every mockup.", kind: "skill", at: ts(0), session: "a", hop: 1 });
  addPin(m, { text: "Never merge into main.", kind: "never", at: ts(0), session: "a", hop: 1 });
  for (let i = 0; i < 40; i++) addPin(m, { text: `Always keep rule number ${i} in mind.`, kind: "must", at: ts(i + 1), session: "b", hop: 2 });
  assert.equal(m.pins.length, MAX_PINS);
  assert.ok(m.pins.some((x) => x.kind === "skill") && m.pins.some((x) => x.kind === "never"));
  assert.ok(m.pins.some((x) => /number 39/.test(x.text)), "the newest must-rules are the ones kept");
  assert.deepEqual(pinsOf("Use the stageshow skill. Use the stageshow skill.").length, 2, "pinsOf reads; addPin dedupes");
});

test("one vault per repo: a chat in a linked worktree writes the main checkout's handoff, names the worktree, and mirrors STATE.md", () => {
  const main = mkdtempSync(join(tmpdir(), "cortex-wt-"));
  telephoneRepo(main);
  const wt = join(main, ".claude", "worktrees", "feature");
  spawnSync("git", ["-C", main, "worktree", "add", "-q", "-b", "feature", wt]);
  assert.ok(existsSync(join(wt, ".vault", "cortex.json")), "the tracked marker is in the worktree too");
  const tp = join(main, "w.jsonl");
  writeFileSync(tp, JSON.stringify({ type: "user", uuid: "w1", timestamp: ts(0), message: { role: "user", content: "Fix the feature flag parsing. Never touch main directly." } }) + "\n");
  // the agent cd'ed into the worktree: the hook's cwd is the worktree
  assert.equal(hook("claude.stop", { session_id: "w", transcript_path: tp, cwd: wt, last_assistant_message: "Fixed." }).status, 0);
  const shared = readFileSync(join(main, ".vault", "STATE.md"), "utf8");
  assert.match(shared, /· feature · /, "the worktree's branch");
  assert.match(shared, /worktree `\.claude\/worktrees\/feature`/);
  assert.equal(readFileSync(join(wt, ".vault", "STATE.md"), "utf8"), shared, "the worktree's copy is the same packet");
  assert.ok(!existsSync(join(wt, ".vault", "private", "states")), "nothing private written in the worktree's own vault");
});

test("a pasted brief's directives are kept (people paste their own instructions); a pasted reply's never are", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "<pasted_content>### Phase 1\nKeep `v4.10` and `v4.11` untouched. Run the full gate one final time.\nDo NOT merge or publish until I review your report.\nUse the stageshow skill via the Skill tool for every mockup.\nI think the strip looks fine.</pasted_content>\ndo this carefully" });
  addTurn(p, { ts: ts(1), harness: "claude-code", session: "s", ref: "u2", text: "<pasted_content>Stopped. I've saved the handoff. Never merge without images. Done: all tests pass.</pasted_content>\nwhy did you say this?" });
  const pins = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(2)), parent: null, episodes: [] }).mission.pins;
  assert.deepEqual(pins.map((x) => [x.kind, x.text]), [
    ["never", "Keep `v4.10` and `v4.11` untouched."],
    ["never", "Do NOT merge or publish until I review your report."],
    ["skill", "Use the stageshow skill via the Skill tool for every mockup."],
  ]);
});

test("a message that is only a paste (no typed words) still pins its directives: the case a live chat missed", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Ship the release." });
  addTurn(p, { ts: ts(1), harness: "claude-code", session: "s", ref: "u2", text: "<pasted_content id=\"0f24\">\nI verified the strip fix in the live app.\n\nKeep `v4.10` and `v4.11` untouched.\nNever push before CI is green on all three OSes.\n</pasted_content>" });
  const pins = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(2)), parent: null, episodes: [] }).mission.pins;
  assert.deepEqual(pins.map((x) => [x.kind, x.text]), [
    ["never", "Keep `v4.10` and `v4.11` untouched."],
    ["never", "Never push before CI is green on all three OSes."],
  ]);
  // pasted on its own right after "the task is done": a new mission, so its rules aren't archived with the old one
  addTurn(p, { ts: ts(3), harness: "claude-code", session: "s", ref: "u3", text: "Great, the task is done." });
  addTurn(p, { ts: ts(4), harness: "claude-code", session: "s", ref: "u4", text: "<pasted_content>Never touch the billing module.</pasted_content>" });
  const next = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(5)), parent: null, episodes: [] }).mission;
  assert.equal(next.status, "active");
  assert.deepEqual(next.pins.map((x) => x.text), ["Never touch the billing module."]);
});

test("a pre-v4.5 parent: only its directive-like instructions carry, and its stale goal gives way to the first real task", () => {
  const legacy = { session: "old", goal: "Finish Cortex v4.10 on branch v4.10", started: "and use best of stage show skill and give it full context", rules: ["You were right that v4.5 was polish only, so it was safe to merge.", "Lists as rows:** Memory files are one card each.", "never merge without before/after images"], decisions: [] };
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "n", ref: "n1", text: "/cortex-resume" });
  addTurn(p, { ts: ts(1), harness: "claude-code", session: "n", ref: "n2", text: "Harden the core engine: multi-hop handoffs, the strip's per-chat state and edge cases." });
  const m = computeMission(p, { session: "n", turns: readTurns(p, "n"), now: new Date(ts(2)), parent: null, legacy, episodes: [] }).mission;
  assert.match(m.goal, /^Harden the core engine/);
  assert.deepEqual(m.pins.map((x) => x.kind).sort(), ["never", "skill"]);
  assert.ok(!m.pins.some((x) => /You were right|Lists as rows/.test(x.text)));
});

