import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildTimeline, olderTimeline } from "../src/core/timeline.ts";
import { readEpisodes } from "../src/core/episodes.ts";
import { tmpRepo } from "./helpers.ts";

const ep = (i: number) => JSON.stringify({ id: `E${i}`, session: "s", start: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(), end: new Date(Date.UTC(2026, 10, 1, 0, i, 30)).toISOString(), ask: `ask ${i}`, tools: { Edit: 1 }, files: Array.from({ length: 9 }, (_, j) => `/r/f${j}.ts`), commands: ["npm test"], tests: { ran: 1, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 10, contextTokens: 1, done: "d".repeat(900), next: "" });

test("v4.4 older timeline: the next events before a time, newest first, each turn with its compact details, and whether more remain", () => {
  const p = tmpRepo();
  writeFileSync(join(p.priv, "episodes.jsonl"), Array.from({ length: 300 }, (_, i) => ep(i)).join("\n") + "\n");
  const before = new Date(Date.UTC(2026, 10, 1, 0, 250)).toISOString(); // turns 0–249 are older
  const r = olderTimeline(p, before, 48);
  assert.equal(r.events.length, 48);
  assert.equal(r.events[0]!.id, "turn-E249");
  assert.equal(r.events[47]!.id, "turn-E202");
  assert.ok(r.events.every((e) => Date.parse(e.ts) < Date.parse(before)));
  assert.equal(r.more, true);
  assert.equal(r.episodes.length, 48);
  assert.deepEqual([r.episodes[0]!.files.length, r.episodes[0]!.commands.length, r.episodes[0]!.done.length], [6, 0, 300], "compact, like the status's older turns");
  const last = olderTimeline(p, r.events[47]!.ts, 500);
  assert.equal(last.events.length, 200, "at most 200 at once");
  const end = olderTimeline(p, new Date(Date.UTC(2026, 10, 1, 0, 3)).toISOString(), 48);
  assert.deepEqual([end.events.length, end.more], [3, false], "the start of history");
  assert.deepEqual(olderTimeline(p, "not a date", 48), { events: [], episodes: [], more: false });
});

test("v4.4 status timeline: stops where a source was cut and says more exists, so Show older leaves no gap; before is inclusive", () => {
  const p = tmpRepo();
  writeFileSync(join(p.priv, "episodes.jsonl"), Array.from({ length: 300 }, (_, i) => ep(i)).join("\n") + "\n");
  const journal = readEpisodes(p, 400), info: { turnsCut?: boolean; more?: boolean } = { turnsCut: true };
  const dreams = Array.from({ length: 12 }, (_, i) => ({ id: `D${i}`, ts: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(), status: "applied", findings: [], transcripts: 1, model: null }));
  const ev = buildTimeline(p, { states: [], wips: [] }, dreams as never, journal.slice(0, 100), undefined, 160, info);
  assert.equal(info.more, true);
  assert.equal(ev.length, 100, "only the turns: the 12 Dreams are a month older than the 100th turn, past where turns were cut");
  assert.equal(ev[99]!.id, "turn-E200");
  const next = olderTimeline(p, ev[99]!.ts, 48);
  assert.equal(next.events[0]!.id, "turn-E200", "inclusive: the panel drops what it has by id");
  assert.equal(next.events[1]!.id, "turn-E199", "no gap");
  const small: { more?: boolean } = {};
  buildTimeline(p, { states: [], wips: [] }, [], journal.slice(0, 5), undefined, 160, small);
  assert.equal(small.more, false, "nothing was cut");
});
