import assert from "node:assert/strict";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpRepo } from "./helpers.ts";
import { claudeJson, park, parkView, unpark } from "../src/core/park.ts";
import { projectSpend } from "../src/core/spend.ts";

const reply = (id: string, ts: string, u: Record<string, number>) => JSON.stringify({ type: "assistant", timestamp: ts, message: { id, usage: u } });

test("v3.4 spend: each reply counted once (Claude Code logs one line per content block), subagents included, resumed chats found", () => {
  const p = tmpRepo();
  const dir = join(process.env.CORTEX_CLAUDE_HOME!, "projects", p.root.replace(/[^A-Za-z0-9]/g, "-"));
  mkdirSync(join(dir, "s2", "subagents"), { recursive: true });
  const now = new Date();
  const ts = now.toISOString();
  const u = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 1_000 };
  writeFileSync(join(dir, "s1.jsonl"), [JSON.stringify({ type: "user", message: { content: "build it" } }), reply("m1", "2026-01-01T10:00:00Z", u), reply("m1", "2026-01-01T10:00:00Z", u), reply("m2", ts, { ...u, cache_read_input_tokens: 700_000 })].join("\n"));
  writeFileSync(join(dir, "s2.jsonl"), [JSON.stringify({ type: "user", message: { content: "/cortex-resume" } }), reply("m3", new Date(now.getTime() + 1000).toISOString(), { ...u, cache_read_input_tokens: 20_000 })].join("\n"));
  writeFileSync(join(dir, "s2", "subagents", "agent-1.jsonl"), reply("m4", ts, u));
  const s = projectSpend(p, now);
  assert.equal(s.all.replies, 4, "m1 twice in the file is one reply");
  assert.equal(s.all.output, 400);
  assert.equal(s.today.replies, 3);
  assert.equal(s.chats, 2);
  assert.equal(s.resumed, 1);
  assert.equal(s.resumedContext, 701_010 - 21_010, "the chat before had grown to 701k; the resumed one started at 21k");
  assert.deepEqual(projectSpend(p, now), s, "the cached second read agrees");
});

test("v3.4 park: writes Claude Code's own per-project switch, keeps the file's other settings and its permissions; Undo; a server you turn back on isn't auto-parked again", () => {
  const p = tmpRepo();
  const cfg = { oauthAccount: { emailAddress: "x" }, projects: { [p.root]: { allowedTools: ["Bash"], disabledMcpServers: ["claude.ai Slack"] }, "/other": { disabledMcpServers: ["a"] } } };
  writeFileSync(claudeJson(), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  assert.match(park(p, ["plugin:figma:figma"], { auto: true, tokens: { "plugin:figma:figma": 2400 } }), /^Parked plugin:figma:figma/);
  const after = JSON.parse(readFileSync(claudeJson(), "utf8"));
  assert.deepEqual(after.projects[p.root].disabledMcpServers, ["claude.ai Slack", "plugin:figma:figma"]);
  assert.deepEqual(after.projects[p.root].allowedTools, ["Bash"]);
  assert.deepEqual(after.projects["/other"], cfg.projects["/other"]);
  assert.equal(after.oauthAccount.emailAddress, "x");
  assert.equal(statSync(claudeJson()).mode & 0o777, 0o600, "same permissions");
  assert.equal(parkView(p).servers[0]?.tokens, 2400);
  assert.match(unpark(p, ["plugin:figma:figma"]), /^Back on from your next chat/);
  assert.deepEqual(parkView(p).disabled, ["claude.ai Slack"]);
  assert.match(park(p, ["plugin:figma:figma"], { auto: true }), /^Nothing to park/, "you turned it back on: auto-park leaves it");
  assert.match(park(p, ["plugin:figma:figma"]), /^Parked/, "you can still park it yourself");
});
