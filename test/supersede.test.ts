import assert from "node:assert/strict";
import { test } from "node:test";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { computeMission, writeMissionRecord, type MissionInput } from "../src/core/mission.ts";
import { renderMission } from "../src/core/mission-view.ts";
import { places, supersede } from "../src/core/supersede.ts";
import type { Mission } from "../src/core/mission.ts";
import { tmpRepo } from "./helpers.ts";

const ts = (min: number) => new Date(Date.parse("2026-11-25T09:00:00Z") + min * 60_000).toISOString();

/** One chat, run turn by turn the way the Stop hook does: each call reads the record the last one wrote. */
function run(p: ReturnType<typeof tmpRepo>, min: number, extra: Partial<MissionInput> = {}) {
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(min)), parent: null, episodes: [], ...extra });
  writeMissionRecord(p, rec);
  return rec;
}

test("places: branches and worktrees a sentence names, never ordinary words", () => {
  assert.deepEqual([...places("Phase 4 on branch v4.6-stageshow-ui (worktree .claude/worktrees/v46-stageshow-ui, off main at v4.5.1)")], ["v4.6-stageshow-ui", ".claude/worktrees/v46-stageshow-ui"]);
  assert.deepEqual([...places("Work only in ~/proj on main; branch v4.1 is merged")], ["main", "v4.1"]);
  assert.deepEqual([...places("Click on the panel, then on Settings.")], []);
});

test("a newer north star on another branch supersedes an older 'work only on main' decision; nothing vanishes silently", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Harden the core engine and ship the release." });
  run(p, 1, { decisions: ["Work only in ~/Claude Projects/kapex-cortex on main; the ../kapex-cortex-v41 worktree and branch v4.1 are merged.", "Keep v4.10 and v4.11 untouched."] });
  const rec = run(p, 5, { goal: "Phase 4 on branch v4.6-stageshow-ui (worktree .claude/worktrees/v46-stageshow-ui, off main at v4.5.1): redesign the panel." });
  const m = rec.mission;
  assert.ok(!m.pins.some((x) => /Work only in/.test(x.text)), "the stale place rule no longer binds");
  assert.ok(m.pins.some((x) => /v4\.10 and v4\.11 untouched/.test(x.text)), "an unrelated decision is kept");
  assert.equal(m.superseded?.length, 1);
  assert.match(m.superseded![0]!.by, /v4\.6-stageshow-ui/);
  const text = renderMission(rec, { chat: () => "", room: 4_000 });
  assert.match(text, /\*\*Superseded \(no longer binding[^\n]*\n- \[decision\] ~~“Work only in/);
  // idempotent: the next turn's rebuild doesn't bring it back or list it twice
  addTurn(p, { ts: ts(6), harness: "claude-code", session: "s", ref: "u2", text: "ok continue" });
  const again = run(p, 7, { goal: "Phase 4 on branch v4.6-stageshow-ui (worktree .claude/worktrees/v46-stageshow-ui, off main at v4.5.1): redesign the panel." }).mission;
  assert.ok(!again.pins.some((x) => /Work only in/.test(x.text)));
  assert.equal(again.superseded?.length, 1);
});

test("a goal the user names in a message supersedes an older place rule on any later rebuild, with no handoff note", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Tidy the parser." });
  run(p, 1, { decisions: ["Work only on main until the parser ships."] });
  addTurn(p, { ts: ts(3), harness: "claude-code", session: "s", ref: "u2", text: "Goal: build the exporter on branch exporter-v2 in its own worktree." });
  const m = run(p, 4).mission;
  assert.ok(!m.pins.some((x) => /Work only on main/.test(x.text)));
  assert.equal(m.superseded?.[0]?.text, "Work only on main until the parser ships.");
});

test("the user's own rule is never dropped by a machine: a contradicting newer goal flags it for the chat to ask", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Fix the importer. Always work only on main, never on side branches." });
  const rec = run(p, 2, { goal: "Ship the redesign on branch ui-v2 in its own worktree." });
  const rule = rec.mission.pins.find((x) => /work only on main/i.test(x.text));
  assert.ok(rule, "kept");
  assert.match(rule!.conflict ?? "", /ui-v2/);
  assert.match(renderMission(rec, { chat: () => "", room: 4_000 }), /⚠ A newer goal or decision contradicts this:\*\* “Ship the redesign on branch ui-v2/);
});

test("a newer decision that updates an older one replaces it; a goal on the same branch, or one naming no place, changes nothing", () => {
  const p = tmpRepo();
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u1", text: "Tune the cache layer for the API." });
  run(p, 1, { decisions: ["Keep the cache TTL at 5 minutes.", "Work only on main for this task."] });
  const m = run(p, 3, { decisions: ["Raise the cache TTL to 10 minutes instead of 5."], goal: "Finish the cache work on main and write the docs." }).mission;
  assert.ok(!m.pins.some((x) => x.text === "Keep the cache TTL at 5 minutes."), "the older TTL decision is replaced");
  assert.ok(m.pins.some((x) => /Raise the cache TTL to 10/.test(x.text)));
  assert.ok(m.pins.some((x) => /Work only on main/.test(x.text)), "same branch: the place rule stands");
  assert.deepEqual(m.superseded?.map((x) => x.text), ["Keep the cache TTL at 5 minutes."]);
  const plain = run(p, 4, { goal: "Polish the docs and the error messages." }).mission;
  assert.ok(plain.pins.some((x) => /Work only on main/.test(x.text)), "a goal naming no place leaves it alone");
});

test("older means an earlier chat first, then an earlier time: a rebuilt parent's later timestamp doesn't protect a stale pin", () => {
  const pin = (text: string, hop: number, at: string) => ({ text, kind: "decision" as const, at, session: "x", hop });
  const m = { id: "m", goal: "", goalAt: "", goalHop: 3, rejected: [], status: "active", pins: [
    pin("Work only on main.", 1, "2026-11-25T11:51:00Z"), // chat 1, stamped late by a rebuild
    pin("Commit only on branch hotfix-2 tonight.", 3, "2026-11-25T12:00:00Z"), // this chat, after the goal
  ] } as Mission;
  supersede(m, "Ship the UI on branch v4.6-ui.", "2026-11-25T09:26:00Z", 3);
  assert.deepEqual(m.pins.map((x) => x.text), ["Commit only on branch hotfix-2 tonight."]);
  assert.equal(m.superseded?.[0]?.text, "Work only on main.");
});
