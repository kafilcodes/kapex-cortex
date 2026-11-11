import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpRepo } from "./helpers.ts";
import { askOf } from "../src/core/brief.ts";
import { setPref } from "../src/core/prefs.ts";
import { fingerprint, quickDue, rememberCheck } from "../src/core/quick.ts";
import { renderState } from "../src/core/state.ts";
import { buildTiers, instructions, writeMemoryCheck } from "../src/core/tiers.ts";
import { storeTurns } from "../src/core/turns.ts";
import { refreshOwnSkills } from "../src/skills.ts";

const turn = (text: string) => ({ id: "T1", ts: "2026-11-11T10:00:00Z", harness: "claude-code", session: "s", ref: "r", text, redacted: 0 });

test("v3.3 tier 1: the request is your words without @file paths, else the start of what you pasted", () => {
  assert.equal(askOf(turn('@"/Users/you/a b.md" @x.md please fix the refresh button in the panel')), "please fix the refresh button in the panel");
  assert.equal(askOf(turn('@"/Users/you/a.md"\n<pasted_content id="1">\nWe are continuing from the last session; fix the Dream buttons.\n</pasted_content id="1">')), "(pasted) We are continuing from the last session; fix the Dream buttons.");
  const rules = instructions([{ n: 1, text: "Build it. Never push to the public repo without asking me. What do you think?" }, { n: 4, text: "dev first, tests last; don't build against Anthropic's preferences" }]);
  assert.deepEqual(rules.map((r) => r.n), [1, 4]);
  assert.match(rules[0]!.text, /^Never push to the public repo/);
  assert.ok(!rules.some((r) => /\?$/.test(r.text)), "questions aren't instructions");
});

test("v3.3 tiers: pinned items and the trail survive a run of small recent turns; flagged memory is listed", () => {
  const p = tmpRepo();
  storeTurns(p, "claude-code", "s", [
    { text: "Rebuild the handoff into three tiers. Never drop the user's decisions when the last turns are small.", ref: "a", ts: "2026-11-11T09:00:00Z" },
    { text: "ok run the tests", ref: "b", ts: "2026-11-11T09:30:00Z" },
  ]);
  const eps = Array.from({ length: 6 }, (_, i) => ({ id: `E${i}`, session: "s", start: `2026-11-11T09:0${i}:00Z`, end: `2026-11-11T09:0${i}:30Z`, ask: i === 0 ? "Rebuild the handoff into three tiers" : `small step ${i}`, tools: {}, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 0, contextTokens: 0, done: `did ${i}`, next: "" }));
  appendFileSync(join(p.priv, "episodes.jsonl"), eps.map((e) => JSON.stringify(e)).join("\n") + "\n");
  writeMemoryCheck(p, [{ label: "memory/x.md", line: 3, kind: "stale", why: "#123456 isn't used any more." }, { label: "CLAUDE.md", line: 1, kind: "duplicate", why: "kept", done: "kept" }]);
  const t = buildTiers(p, { session: "s", recentTurns: 3, git: false, room: { pinned: 3_000, trail: 3_000 }, handoff: { session: "s", ts: "2026-11-11T09:40:00Z", decisions: ["Keep STATE under the token budget"] } });
  assert.match(t.pinned, /Never drop the user's decisions when the last turns are small\. _\(turn 1\)_/);
  assert.match(t.pinned, /Keep STATE under the token budget/);
  assert.match(t.pinned, /`memory\/x\.md:3` stale: #123456/);
  assert.doesNotMatch(t.pinned, /CLAUDE\.md:1/, "a note you kept isn't flagged");
  assert.deepEqual(t.trail.match(/^- T\d+/gm), ["- T1", "- T2", "- T3"], "the 3 newest turns are word for word below, not in the trail");
  assert.match(t.trail, /T1 09:00 · Rebuild the handoff into three tiers → did 0/);
  const state = renderState(p, { harness: "claude-code", session: "s", lastAssistant: "Done." }, null);
  assert.ok(state.indexOf("## Pinned for this session") < state.indexOf("## Session trail") && state.indexOf("## Session trail") < state.indexOf("## Where we left off"), "three tiers, in order");
});

test("v3.3 every-turn Quick check: due when nothing was checked yet or anything it reads changed, not otherwise", () => {
  const p = tmpRepo();
  const note = join(p.root, "CLAUDE.md");
  writeFileSync(note, "# Rules\n- one\n");
  assert.equal(quickDue(p, "main|"), true, "never checked");
  rememberCheck(p, [note], "main|");
  assert.equal(quickDue(p, "main|"), false, "nothing changed: nothing runs");
  assert.equal(quickDue(p, "main|M  app.ts"), true, "the code changed");
  const before = fingerprint(p, [note], "main|");
  writeFileSync(note, "# Rules\n- one\n- two\n");
  assert.notEqual(fingerprint(p, [note], "main|"), before, "a memory file changed");
  setPref("quickCheck", false, "project", p);
  assert.equal(quickDue(p, "main|M  other.ts"), false, "off in Settings");
});

test("v3.3 Cortex refreshes only its own old skill copies in ~/.claude/skills and retires cortex-approve", () => {
  const home = process.env.CORTEX_CLAUDE_HOME!;
  const put = (name: string, body: string) => { mkdirSync(join(home, "skills", name), { recursive: true }); writeFileSync(join(home, "skills", name, "SKILL.md"), body); };
  put("cortex-resume", "---\nname: cortex-resume\ndescription: Kapex Cortex resume\n---\nread INVARIANTS.md and GRAVEYARD.md\n");
  put("cortex-approve", "---\nname: cortex-approve\ndescription: Approve Kapex Cortex rules\n---\n");
  put("cortex-init", "---\nname: cortex-init\n---\nmy own skill, not Cortex's\n");
  mkdirSync(process.env.CORTEX_HOME!, { recursive: true });
  writeFileSync(join(process.env.CORTEX_HOME!, "config.json"), JSON.stringify({ install: { node: "/usr/bin/node", cli: "/opt/cortex/src/cli.ts" } }));
  const changed = refreshOwnSkills();
  assert.equal(changed.length, 2);
  assert.match(readFileSync(join(home, "skills", "cortex-resume", "SKILL.md"), "utf8"), /Pinned for this session/);
  assert.equal(existsSync(join(home, "skills", "cortex-approve")), false);
  assert.match(readFileSync(join(home, "skills", "cortex-init", "SKILL.md"), "utf8"), /my own skill/, "a file Cortex didn't write is left alone");
});
