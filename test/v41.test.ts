import "./helpers.ts";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { toolGroup, usageWindow } from "../src/core/window.ts";
import { notifierReady, notifyMac } from "../src/core/notifier.ts";

// v4.1: what used the 5-hour plan (every project's transcripts, in 10-minute slots) and the Cortex notifier.

const reply = (at: number, id: string, model: string, u: Record<string, number>, tools: string[] = [], cwd = "/work/demo") =>
  JSON.stringify({ type: "assistant", timestamp: new Date(at).toISOString(), cwd, message: { id, model, usage: u, content: tools.map((name) => ({ type: "tool_use", name })) } }) + "\n";

test("5-hour window: every project's chats and subagents, one reply counted once, older replies left out, read incrementally", () => {
  const home = mkdtempSync(join(tmpdir(), "cortex-win-"));
  const now = Date.parse("2026-11-17T12:00:00Z");
  const a = join(home, "projects", "-work-demo"), b = join(home, "projects", "-work-site");
  mkdirSync(join(a, "s1", "subagents"), { recursive: true }); mkdirSync(b, { recursive: true });
  const u = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
  writeFileSync(join(a, "s1.jsonl"), JSON.stringify({ type: "custom-title", customTitle: "Fix the strip" }) + "\n"
    + reply(now - 6 * 3_600_000, "m0", "claude-opus-5-5", u) // before the window
    + reply(now - 30 * 60_000, "m1", "claude-opus-5-5", u, ["Bash"])
    + reply(now - 30 * 60_000, "m1", "claude-opus-5-5", u, ["Read"]) // the same reply's second block
    + reply(now - 20 * 60_000, "m2", "claude-fable-5-2", u, ["mcp__ccd_turn__update_plan", "mcp__Claude_Browser__navigate"]));
  writeFileSync(join(a, "s1", "subagents", "agent-1.jsonl"), reply(now - 25 * 60_000, "x1", "claude-opus-5-5", u, ["Grep"]));
  writeFileSync(join(b, "s2.jsonl"), reply(now - 10 * 60_000, "y1", "claude-sonnet-5-5", u, ["WebFetch"], "/work/site"));
  const cache = join(home, "cache.json");
  const w = usageWindow(cache, now, home);
  const sum = (f: (r: (typeof w.rows)[0]) => boolean) => w.rows.filter(f).reduce((s, r) => s + r.replies, 0);
  assert.equal(sum(() => true), 4, "m1 once, m2, the subagent's reply and the other project's; m0 is too old");
  assert.equal(sum((r) => r.sub), 1);
  assert.equal(sum((r) => r.chat === "s1"), 3, "a subagent's reply belongs to its chat");
  assert.deepEqual(w.chats.map((c) => `${c.title}@${c.project}`).sort(), ["@site", "Fix the strip@demo"]);
  const fable = w.rows.find((r) => r.model === "fable-5-2")!, opus = w.rows.find((r) => r.model === "opus-5-5" && !r.sub)!;
  assert.equal(fable.weight, opus.weight * 2, "Fable weighs twice Opus for the same tokens");
  assert.equal(opus.tokens, 1110);
  const tools: Record<string, number> = {};
  for (const t of w.tools) tools[t.tool] = (tools[t.tool] ?? 0) + t.n;
  assert.deepEqual(tools, { Shell: 1, Files: 2, "Claude app": 1, "MCP · Claude Browser": 1, Web: 1 });
  // a new line in one chat: only it is read next time, and nothing is counted twice
  appendFileSync(join(b, "s2.jsonl"), reply(now - 5 * 60_000, "y2", "claude-sonnet-5-5", u));
  const w2 = usageWindow(cache, now, home);
  assert.equal(w2.rows.reduce((s, r) => s + r.replies, 0), 5);
  // later: the old slots fall out of the window
  const w3 = usageWindow(cache, now + 5 * 3_600_000, home);
  assert.equal(w3.rows.length, 0);
});

test("5-hour window: no transcripts, unreadable lines and a line still being written never break it", () => {
  const home = mkdtempSync(join(tmpdir(), "cortex-win2-"));
  assert.deepEqual(usageWindow(join(home, "c.json"), Date.now(), home).rows, []);
  const d = join(home, "projects", "-x");
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "s.jsonl"), '{"type":"assistant", broken\n' + reply(Date.now() - 60_000, "a", "claude-opus-5-5", { input_tokens: 1 }) + '{"type":"assistant","usage"');
  const w = usageWindow(join(home, "c.json"), Date.now(), home);
  assert.equal(w.rows.length, 1);
});

test("5-hour window: a bad byte never shifts the offset, and a chat a fork copied into a new file is counted once", () => {
  const home = mkdtempSync(join(tmpdir(), "cortex-win3-"));
  const now = Date.now(), d = join(home, "projects", "-x");
  mkdirSync(d, { recursive: true });
  const u = { input_tokens: 1, output_tokens: 1 };
  const f = join(d, "s.jsonl");
  writeFileSync(f, Buffer.concat([Buffer.from('{"type":"user","bad":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}\n'), Buffer.from(reply(now - 60_000, "a", "claude-opus-5-5", u))]));
  const cache = join(home, "c.json");
  assert.equal(usageWindow(cache, now, home).rows.reduce((n, r) => n + r.replies, 0), 1);
  appendFileSync(f, reply(now - 30_000, "b", "claude-opus-5-5", u));
  assert.equal(usageWindow(cache, now, home).rows.reduce((n, r) => n + r.replies, 0), 2, "the reply after the bad byte is read");
  writeFileSync(join(d, "fork.jsonl"), reply(now - 60_000, "a", "claude-opus-5-5", u) + reply(now - 30_000, "b", "claude-opus-5-5", u) + reply(now - 10_000, "c", "claude-opus-5-5", u));
  assert.equal(usageWindow(cache, now, home).rows.reduce((n, r) => n + r.replies, 0), 3, "a and b once, c new");
});

test("tool groups: the shell, files, the web, subagents, skills, the app's own tools and each MCP server by name", () => {
  assert.equal(toolGroup("Bash"), "Shell");
  assert.equal(toolGroup("MultiEdit"), "Files");
  assert.equal(toolGroup("WebSearch"), "Web");
  assert.equal(toolGroup("Task"), "Subagents");
  assert.equal(toolGroup("Skill"), "Skills");
  assert.equal(toolGroup("mcp__ccd_session__start"), "Claude app");
  assert.equal(toolGroup("mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__read"), "MCP · connector");
  assert.equal(toolGroup("mcp__plugin_figma_figma__get"), "MCP · figma figma");
  assert.equal(toolGroup("TodoWrite"), "Other");
});

test("notifier: tests never notify or build anything", () => {
  assert.equal(process.env.CORTEX_NO_NOTIFY, "1");
  notifyMac("Kapex Cortex", "a test"); // a no-op under CORTEX_NO_NOTIFY
  assert.equal(notifierReady(), false, "the test home has no notifier app");
});
