import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { accumulate, finalize, readEpisodes } from "../src/core/episodes.ts";
import { clean } from "../src/core/identity.ts";
import { repoPaths } from "../src/core/paths.ts";
import { shortCommand } from "../src/core/state.ts";
import { computeStatus } from "../src/core/status.ts";
import { cortexInit } from "../src/init.ts";
import { CLI } from "./helpers.ts";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "cortex-v27-"));
  spawnSync("git", ["init", "-q", "-b", "main", root]);
  cortexInit(root, { node: process.execPath, cli: CLI, claudeHooks: false });
  return repoPaths(root);
}

test("v2.3 names: titles and initials before the given name are skipped", () => {
  assert.equal(clean("Mohd. Kafil Khan"), "Kafil");
  assert.equal(clean("Dr. Jane Doe"), "Jane");
  assert.equal(clean("J. Robert Smith"), "Robert");
  assert.equal(clean("Md Rahim"), "Rahim");
  assert.equal(clean("Mohd"), "Mohd", "a title alone is still the only name there is");
});

test("v2.3 last check: the command as you'd type it, without cd and redirects", () => {
  assert.equal(shortCommand(`cd "/Users/x/My Projects/k" && npm run check > /private/tmp/out.txt 2>&1`), "npm run check");
  assert.equal(shortCommand("npm test 2>&1 | tail -5"), "npm test");
  assert.equal(shortCommand("node --test test/a.test.ts"), "node --test test/a.test.ts");
});

test("v2.3 journal: a turn started by a background task is named, not left blank", () => {
  const p = repo();
  const ts = new Date().toISOString();
  accumulate(p, "s", [
    { type: "user", timestamp: ts, message: { role: "user", content: "<task-notification><summary>Tests finished: 86 passed</summary></task-notification>" } },
    { type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id: "a", name: "Bash", input: { command: "git status" } }] } },
  ]);
  finalize(p, "s", "Done: checked");
  assert.equal(readEpisodes(p, 1)[0]!.ask, "Background task finished: Tests finished: 86 passed");
});

test("v2.3 timeline: newest first by real time, whatever the time zone of a git date", () => {
  const p = repo();
  const g = (date: string, ...a: string[]) => spawnSync("git", ["-C", p.root, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } });
  writeFileSync(join(p.root, "a.txt"), "1"); g("2026-11-10T16:35:00+05:30", "add", "-A"); g("2026-11-10T16:35:00+05:30", "commit", "-qm", "earlier commit (11:05 UTC)");
  accumulate(p, "s", [{ type: "user", timestamp: "2026-11-10T11:46:00Z", message: { role: "user", content: "a later turn" } }]);
  finalize(p, "s", "Done: later");
  const tl = computeStatus(p).timeline.filter((e) => e.kind === "turn" || e.kind === "commit");
  assert.deepEqual(tl.map((e) => e.kind), ["turn", "commit"]);
  for (let i = 1; i < tl.length; i++) assert.ok(Date.parse(tl[i - 1]!.ts) >= Date.parse(tl[i]!.ts));
});
