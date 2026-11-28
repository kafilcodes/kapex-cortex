// v4.6: a guardrail travels with its reason, and a full memory check never offers to remove one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseJudgment, loadBearing } from "../src/core/dream-model.ts";
import { computeMission, pinsOf } from "../src/core/mission.ts";
import { renderMission } from "../src/core/mission-view.ts";
import type { NativeFile } from "../src/core/native.ts";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { tmpRepo } from "./helpers.ts";

const ts = (min: number) => new Date(Date.parse("2026-11-27T09:00:00Z") + min * 60_000).toISOString();

test("v4.6 why: the sentence right after a rule that says why is kept with it, and shown in the contract", () => {
  const [pin] = pinsOf("Never run docker on this machine. It eats the 16 GB of RAM and froze the Mac twice.");
  assert.deepEqual(pin, { text: "Never run docker on this machine.", kind: "never", why: "It eats the 16 GB of RAM and froze the Mac twice." });
  assert.equal(pinsOf("Always keep Stop work synchronous. Because headless claude -p kills async hooks when it exits.")[0]!.why, "Because headless claude -p kills async hooks when it exits.");
  // the next sentence is not a reason: another rule, or the next task
  assert.deepEqual(pinsOf("Never push to main. Never skip the gate.").map((x) => x.why), [undefined, undefined]);
  assert.equal(pinsOf("Never push to main. Now build the export page.")[0]!.why, undefined);
  // through a chain: the reason rides with the rule into the packet
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u0", text: "Redesign the panel. Never use a tinted card background. It looked cheap in v4.10 and you reverted it." });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  const out = renderMission(rec, { chat: () => "", room: 8000 });
  assert.match(out, /\[never\] “Never use a tinted card background\.” _\(chat 1, this one, [^)]*\)_ — why: “It looked cheap in v4\.10 and you reverted it\.”/);
});

test("v4.6 load-bearing: a full check shows a guardrail but never offers to delete or rewrite it; a plain fact is still fixed", () => {
  const file = "/p/CLAUDE.md";
  const files = [{ path: file, label: "CLAUDE.md", scope: "project", loads: "always", lines: 5, tokens: 50, editable: true }] as unknown as NativeFile[];
  const ents = [
    { file, label: "CLAUDE.md", line: 3, end: 3, text: "- `async: true` Stop hooks are killed when headless claude -p exits: keep Stop work synchronous.", heading: "Tried and failed (do this instead)" },
    { file, label: "CLAUDE.md", line: 4, end: 4, text: "- The panel loads from the repo folder of the plugin.", heading: "Facts" },
    { file, label: "CLAUDE.md", line: 5, end: 5, text: "- Mockups come from the stageshow skill invoked properly.", heading: "Facts" },
  ];
  const ev = [{ id: "E1", kind: "commit" as const, ts: ts(0), session: "", text: "Commit abc: Stop hooks async again; the panel loads from the plugin cache; stageshow mockups skipped" }];
  const raw = JSON.stringify({ findings: [
    { entry: "N1", kind: "stale", why: "Stop hooks were made async.", evidence: ["E1"], action: "delete", confidence: 0.9 },
    { entry: "N2", kind: "false", why: "It loads from the plugin cache now.", evidence: ["E1"], action: "replace", text: "The panel loads from the plugin cache.", confidence: 0.9 },
    { entry: "N3", kind: "stale", why: "Mockups were skipped.", evidence: ["E1"], action: "delete", confidence: 0.9 },
  ] });
  const out = parseJudgment(raw, files, ents, ev, [], ["Mockups come from the stageshow skill invoked properly, every page."]).findings;
  const at = (n: number) => out.find((f) => f.line === n)!;
  assert.equal(at(3).action.op, "none", "a dead end on record stays");
  assert.match(at(3).why, /^Load-bearing \(kept under “Tried and failed/);
  assert.equal(at(4).action.op, "replace", "a plain fact a commit disproves is still fixed");
  assert.equal(at(5).action.op, "none", "the task's own words in the contract stay");
  assert.match(at(5).why, /mission contract/);
  assert.equal(loadBearing({ ...ents[1]!, heading: "Notes" }), null);
});

test("v4.6 why: a closing remark or a question after a rule is not its reason", () => {
  assert.equal(pinsOf("Never push to main. That's all for now.")[0]!.why, undefined);
  assert.equal(pinsOf("Never push to main. Is that clear?")[0]!.why, undefined);
});

test("v4.6 review: rules that end on so / to / that / for stay rules; only a sentence cut at and/or/the is noise", async () => {
  const { pinKind, noiseRule } = await import("../src/core/mission.ts");
  for (const s of ["Never merge to main unless I say so.", "Don't push anything until I tell you to.", "Do not touch files I didn't ask you to.", "Don't add anything you don't need to."]) {
    assert.equal(noiseRule(s), false, s); assert.equal(pinKind(s), "never", s);
  }
  assert.equal(pinKind("keep separate branches so new changes and."), null);
});

test("v4.6 review: a pronoun sentence is a reason only with a reason word", () => {
  assert.equal(pinsOf("Always run npm run check before a commit. This is the new task: build the panel.")[0]!.why, undefined);
  assert.equal(pinsOf("Never use docker here. It eats the 16 GB of RAM.")[0]!.why, "It eats the 16 GB of RAM.");
});

test("v4.6 review: reasons give way first when the contract is short of room; every rule stays", () => {
  const p = tmpRepo();
  const many = Array.from({ length: 12 }, (_, i) => `Never touch module number ${i} of the old billing service. It broke production billing for three days in March ${i}.`).join(" ");
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u0", text: `Fix the billing export. ${many}` });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(1)), parent: null, episodes: [] });
  assert.equal(rec.mission.pins.length, 12);
  const roomy = renderMission(rec, { chat: () => "", room: 9000 }), tight = renderMission(rec, { chat: () => "", room: 2600 });
  assert.match(roomy, /— why: “It broke production billing/);
  assert.doesNotMatch(tight, /— why:/);
  assert.equal((tight.match(/^- \[never\]/gm) ?? []).length, 12, "every rule still listed");
});

test("v4.6 review: a short contract rule doesn't shield a long note that only shares its words; program checks are guarded too", async () => {
  const { guardChecks } = await import("../src/core/dream-model.ts");
  const file = "/p/CLAUDE.md";
  const note = { file, label: "CLAUDE.md", line: 7, end: 7, text: "- `scripts/push.sh` pushes release tags to main after every tagged build of the CLI.", heading: "Facts" };
  assert.equal(loadBearing(note, ["Never push to main."]), null);
  const dead = { file, label: "CLAUDE.md", line: 9, end: 9, text: "- Async Stop hooks in `src/stop-async.ts` are killed by headless runs: keep Stop work synchronous.", heading: "Tried and failed (do this instead)" };
  const found = [
    { kind: "stale", file, line: 9, why: "`src/stop-async.ts` no longer exists.", action: { op: "delete" } },
    { kind: "duplicate", file, line: 9, why: "It repeats line 3.", action: { op: "delete" } },
    { kind: "stale", file, line: 7, why: "`scripts/push.sh` no longer exists.", action: { op: "delete" } },
  ];
  const out = guardChecks(found, [note, dead], ["Never push to main."]);
  assert.equal(out[0]!.action.op, "none"); assert.match(out[0]!.why, /^Load-bearing \(kept under “Tried and failed/);
  assert.equal(out[1]!.action.op, "delete", "a duplicate still goes: the other copy keeps the guardrail");
  assert.equal(out[2]!.action.op, "delete", "a plain stale fact is still fixed");
});
