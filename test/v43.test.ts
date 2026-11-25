import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { computeHistory } from "../src/core/history.ts";
import { tmpRepo } from "./helpers.ts";

const note = (session: string, extra = "") => `# STATE — demo · main · updated x · from claude-code · session ${session}

## Goal
Ship the parser

## Next action
Run the benchmark, then tag it

## Pinned for this session (kept whatever the last turns were about)
**Your standing instructions** (your words):
- keep tests green _(turn 2)_
- no new deps

**Decisions recorded at handoff:**
- use node:sqlite

## Active files
Edited in the last turns: \`src/a.ts\`, \`src/b.ts\`, \`README.md\`

## Last check
\`npm run check\` passed, 2 min ago.
${extra}`;

const ep = (id: string, session: string, over: object = {}) => JSON.stringify({ id, session, start: "2026-11-17T10:00:00Z", end: "2026-11-17T10:05:00Z", ask: "do it", tools: {}, files: ["/r/a.ts"], commands: [], tests: { ran: 3, failed: 1 }, commits: 1, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 1000, contextTokens: 9000, done: "", next: "", ...over });

test("v4.3 handoff history: each note's next step, last check and pins; the chats on either side; what each chat did", () => {
  const p = tmpRepo();
  mkdirSync(p.states, { recursive: true });
  writeFileSync(join(p.states, "chat-a.md"), note("chat-a"));
  writeFileSync(join(p.states, "chat-b.md"), note("chat-b").replace("Ship the parser", "Tag the parser").replace("Run the benchmark, then tag it", "Continue from the last assistant message below."));
  writeFileSync(join(p.priv, "carry.json"), JSON.stringify({ "chat-a": "", "chat-b": "chat-a", "chat-c": "chat-b" }));
  writeFileSync(join(p.priv, "episodes.jsonl"), [ep("1", "chat-a"), ep("2", "chat-a", { files: ["/r/a.ts", "/r/c.ts"] }), ep("3", "chat-b"), "{not json", "{}"].join("\n") + "\n");
  const h = computeHistory(p);
  const a = h.states.find((s) => s.session === "chat-a")!, b = h.states.find((s) => s.session === "chat-b")!;
  assert.equal(a.next, "Run the benchmark, then tag it");
  assert.equal(b.next, undefined, "the stock 'continue from the last message' is not a next step");
  assert.equal(a.lastCheck, "npm run check passed", "the note's own age froze when it was written: dropped");
  assert.deepEqual([a.rules, a.decisions, a.files], [2, 1, 3]);
  assert.equal(a.continues, undefined, "started fresh");
  assert.deepEqual(a.pickedUp?.map((x) => x.session), ["chat-b"]);
  assert.equal(b.continues?.session, "chat-a");
  assert.deepEqual(b.pickedUp?.map((x) => x.session), ["chat-c"]);
  assert.deepEqual(a.work, { turns: 2, commits: 2, files: 2, ran: 6, failed: 2, out: 2000 }, "files changed are counted once across turns");
  assert.equal(b.work?.turns, 1);
});

test("v4.3 handoff history: no carry map, no journal and a bare note never break it", () => {
  const p = tmpRepo();
  mkdirSync(p.states, { recursive: true });
  writeFileSync(join(p.states, "solo.md"), "# STATE — demo · main · updated x · from opencode · session solo\n");
  const [s] = computeHistory(p).states;
  assert.equal(s?.session, "solo");
  assert.deepEqual([s?.next, s?.lastCheck, s?.continues, s?.pickedUp, s?.work], [undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual([s?.rules, s?.decisions, s?.files], [0, 0, 0]);
});

test("v4.3 review fixes: no check run is not a check; quoted notes and the cut marker don't count; odd journal lines never NaN; merged rows link all their chats", () => {
  const p = tmpRepo();
  mkdirSync(p.states, { recursive: true });
  const quoted = "\n## Where we left off (the last exchanges)\n### You\n**Your standing instructions**\n- quoted one\n- quoted two\n- quoted three\n";
  writeFileSync(join(p.states, "x.md"), note("x").replace("`npm run check` passed, 2 min ago.", "_No test or check run in the last turns._").replace("- no new deps", "- no new deps\n- […]") + quoted);
  writeFileSync(join(p.states, "y.md"), note("y").replace("Ship the parser", "Other goal"));
  writeFileSync(join(p.states, "y2.md"), note("y2").replace("Ship the parser", "Other goal"));
  writeFileSync(join(p.priv, "carry.json"), JSON.stringify({ y2: "x", z: "y" }));
  writeFileSync(join(p.priv, "episodes.jsonl"), [
    JSON.stringify({ id: "1", session: "x", end: "2026-11-17T10:05:00Z", ask: "a", tools: {}, files: ["/a", 5], commands: [], tests: {} }),
    ep("2", "y"), ep("3", "y2"),
  ].join("\n") + "\n");
  const h = computeHistory(p);
  const x = h.states.find((s) => s.session === "x")!;
  assert.equal(x.lastCheck, undefined, "no check run");
  assert.equal(x.rules, 2, "the cut marker and the quoted note are not instructions");
  assert.deepEqual(x.work, { turns: 1, commits: 0, files: 1, ran: 0, failed: 0, out: 0 }, "missing numbers count as 0, never NaN");
  const merged = h.states.find((s) => s.copies === 2)!;
  assert.ok(merged, "y and y2 are one row");
  assert.equal(merged.continues?.session, "x", "the twin's link is kept");
  assert.deepEqual(merged.pickedUp?.map((c) => c.session), ["z"]);
  assert.equal(merged.work?.turns, 2, "both chats' turns");
});
