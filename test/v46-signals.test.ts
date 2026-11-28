// v4.6: the 3-arm benchmark's handoff misses, fixed. A one-turn "Don't edit anything." never becomes a binding rule; a
// probe question never becomes the goal; "we tried X and it crashed" lands in Rejected; "Next time: X" is the next step.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { tmpRepo } from "./helpers.ts";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { computeMission } from "../src/core/mission.ts";
import { refreshState, statePath } from "../src/core/state.ts";
import { nextYouNamed, questionOnly, triedAndDropped, turnScoped } from "../src/core/mission-signals.ts";

const TURNS = [
  "Goal: add a divide(a, b) function to calc.js, with tests in calc.test.js using node:test. Rules: never add npm dependencies, because this project must stay zero-dependency so it runs offline on the CI box. Always run `node --test` before you say you're done.",
  "Change of plan for divide by zero: don't throw an exception. We tried throwing before and the callers crashed, so return null instead. Decision: results are rounded to 2 decimal places.",
  "Good. Stop here for today. Next time: add a modulo function the same way.",
];
const PROBE = "Don't edit anything. Answer in a short numbered list: 1) What is the next task in this project? 2) What rules must you follow here, and why? 3) What approach was tried and dropped, why, and what replaced it? 4) What rounding decision was made? 5) What command must pass before you say you're done?";
const ts = (min: number) => new Date(Date.parse("2026-11-27T14:00:00Z") + min * 60_000).toISOString();

test("signals: one-turn guardrails, question-only messages, tried-and-dropped approaches, the next step you named", () => {
  for (const t of ["Don't edit anything.", "Do not change anything for now.", "please don't touch any files yet"]) assert.equal(turnScoped(t), true, t);
  for (const t of ["Never push without asking.", "Do NOT touch `main`, `v4.10`, or `v4.11` yet, and do NOT rush straight into coding.", "Don't touch v4.10 or v4.11."]) assert.equal(turnScoped(t), false, t);
  assert.equal(questionOnly(PROBE), true);
  assert.equal(questionOnly("What is left on the export page?"), true);
  assert.equal(questionOnly("Can you add a modulo function to calc.js?"), false, "a request phrased as a question is a task");
  assert.equal(questionOnly("Fix the login redirect. Why does it loop on Safari?"), false, "a task with a question in it");
  assert.equal(questionOnly("Build the export page."), false);
  assert.deepEqual(triedAndDropped(TURNS[1]!), [{ what: "throwing", why: "the callers crashed, so return null instead" }]);
  assert.deepEqual(triedAndDropped("We tried the new parser and it works great."), [], "no failure word: no rejection");
  assert.equal(nextYouNamed(TURNS[2]!), "add a modulo function the same way.");
  assert.equal(nextYouNamed("Later, I realised the cache was cold."), null);
});

test("the benchmark's session, replayed: the packet keeps the rules, the rejection and the next step, and the probe changes none of it", () => {
  const p = tmpRepo();
  TURNS.forEach((text, i) => addTurn(p, { ts: ts(i), harness: "claude-code", session: "s1", ref: `u${i}`, text }));
  refreshState(p, { harness: "claude-code", session: "s1", lastAssistant: "Done: divide returns null on zero and rounds to 2 places. node --test passes." }, { quiet: true });
  let state = readFileSync(statePath(p), "utf8");
  assert.match(state, /## Next action\nadd a modulo function the same way\./);
  assert.match(state, /\*\*Rejected[^\n]*\n- throwing → the user: “the callers crashed, so return null instead”/);
  // a new chat asks the read-only probe: its "Don't edit anything." holds for that turn only, and it sets no goal
  addTurn(p, { ts: ts(10), harness: "claude-code", session: "s2", ref: "u9", text: PROBE });
  const rec = computeMission(p, { session: "s2", turns: readTurns(p, "s2"), now: new Date(ts(11)), parent: null, episodes: [] });
  assert.ok(!rec.mission.pins.some((x) => /Don't edit anything/i.test(x.text)), JSON.stringify(rec.mission.pins));
  assert.ok(!/What is the next task/.test(rec.mission.goal));
  refreshState(p, { harness: "claude-code", session: "s2", lastAssistant: "1) Add modulo…" }, { quiet: true });
  state = readFileSync(statePath(p), "utf8");
  assert.doesNotMatch(state, /\[never\] “Don't edit anything\.”/);
  assert.doesNotMatch(state, /## Goal\nDon't edit anything/);
});

test("/cortex-resume: a question after it gets an answer with no edits; alone, it asks before editing unless a usage limit cut the last chat", async () => {
  const { skillFiles } = await import("../src/skills.ts");
  const { opencodeCommands } = await import("../src/init.ts");
  const fs = await import("node:fs");
  const texts = [skillFiles("/usr/bin/node", "/x/cli.ts")["cortex-resume"]!, opencodeCommands({ node: "/usr/bin/node", cli: "/x/cli.ts" } as never)["cortex-resume"]!, fs.readFileSync(new URL("../claude-plugin/skills/cortex-resume/SKILL.md", import.meta.url), "utf8")];
  for (const t of texts) {
    assert.doesNotMatch(t, /is the go-ahead/, "running the command is no longer a blanket go-ahead");
    assert.match(t, /only ask(?:s)? something, answer from the packet and don't edit anything/);
    assert.match(t, /HANDOFF READY[^.]*usage limit/);
  }
});
