// Regression tests for the v4.10 fresh code review's findings (commit 546a1bb): each one failed before that fix.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLI, tmpRepo } from "./helpers.ts";
import { forgetPrefs, migrateRaw, readPrefs, setPref } from "../src/core/prefs.ts";
import { cortexHome } from "../src/core/home.ts";
import { cortexInit, opencodeCommands } from "../src/init.ts";

const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd: string, ...a: string[]) => spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env });
const userCfg = () => join(cortexHome(), "config.json");
const writePrefs = (prefs: Record<string, unknown>) => { mkdirSync(cortexHome(), { recursive: true }); writeFileSync(userCfg(), JSON.stringify({ prefs })); forgetPrefs(); };
const onDisk = () => (JSON.parse(readFileSync(userCfg(), "utf8")) as { prefs: Record<string, unknown> }).prefs;

test("review: a v4.9 own-key model moves to dreamApiModel on disk at the first save, an Anthropic claude-* name included", () => {
  // the bug: saving any other key wrote the old layer back without the move, so readPrefs lost the key's model
  writePrefs({ dreamBackend: "api", dreamApi: "anthropic", dreamModel: "claude-sonnet-4-5" });
  setPref("greeting", false, "user");
  assert.deepEqual([onDisk().dreamApiModel, onDisk().dreamModel, onDisk().greeting], ["claude-sonnet-4-5", "sonnet", false]);
  forgetPrefs();
  assert.deepEqual([readPrefs().dreamApiModel, readPrefs().dreamModel], ["claude-sonnet-4-5", "sonnet"]);
  // a second save keeps it (nothing to move twice)
  setPref("greeting", true, "user");
  assert.equal(onDisk().dreamApiModel, "claude-sonnet-4-5");
  // a Claude Code short name was never a key's model: it stays Claude's, and the key's model is empty
  assert.deepEqual(migrateRaw({ dreamBackend: "api", dreamModel: "Opus" }), { dreamBackend: "api", dreamModel: "Opus", dreamApiModel: "" });
  // not an own-key layer, or already moved: unchanged
  const claude = { dreamBackend: "claude", dreamModel: "haiku" };
  assert.equal(migrateRaw(claude), claude);
  const moved = { dreamBackend: "api", dreamModel: "sonnet", dreamApiModel: "x/y" };
  assert.equal(migrateRaw(moved), moved);
  writePrefs({});
});

test("review: the project layer migrates before a save too", () => {
  const p = tmpRepo();
  writeFileSync(join(p.priv, "prefs.json"), JSON.stringify({ dreamBackend: "api", dreamModel: "nvidia/nemotron-3-ultra" }));
  setPref("tokenMode", "lean", "project", p);
  const saved = JSON.parse(readFileSync(join(p.priv, "prefs.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual([saved.dreamApiModel, saved.dreamModel, saved.tokenMode], ["nvidia/nemotron-3-ultra", "sonnet", "lean"]);
});

test("review: OpenCode's /cortex-resume include reads GNU stat first, ignores a non-number, and always prints the packet", () => {
  const sh = /!`([^`]+)`/.exec(opencodeCommands({ node: "node", cli: "cli" } as never)["cortex-resume"]!)![1]!;
  const root = mkdtempSync(join(tmpdir(), "cortex-oc-stat-"));
  mkdirSync(join(root, ".vault"), { recursive: true });
  writeFileSync(join(root, ".vault", "STATE.md"), "# STATE — demo\n");
  const withStat = (body: string) => {
    const bin = mkdtempSync(join(tmpdir(), "cortex-fakestat-"));
    writeFileSync(join(bin, "stat"), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, "stat"), 0o755);
    return spawnSync("sh", ["-c", sh], { cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }).stdout;
  };
  // GNU (Linux): -c %Y answers with seconds
  const now = Math.floor(Date.now() / 1000);
  assert.match(withStat(`[ "$1" = "-c" ] && { echo ${now - 600}; exit 0; }; exit 1`), /^\(packet saved 1\d minutes ago\)\n# STATE — demo/);
  // BSD (macOS): -c fails, -f %m answers
  assert.match(withStat(`[ "$1" = "-f" ] && { echo ${now - 120}; exit 0; }; exit 1`), /^\(packet saved 2 minutes ago\)\n# STATE — demo/);
  // a stat that prints something else (BSD -c is "format" on some systems): no age line, the packet still prints
  assert.equal(withStat(`echo "  File: STATE.md"; exit 0`), "# STATE — demo\n");
  // no stat at all: the packet still prints
  assert.equal(withStat("exit 1"), "# STATE — demo\n");
});

test("review: init removes an older copy of Cortex's command from OpenCode's other folder, and leaves the user's own files", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-oc-init-"));
  git(root, "init", "-q");
  const old = join(root, ".opencode", "command");
  mkdirSync(old, { recursive: true });
  writeFileSync(join(old, "cortex-resume.md"), "---\ndescription: Continue from the Kapex Cortex handoff\n---\nold\n");
  writeFileSync(join(old, "cortex-handoff.md"), "my own command, nothing to do with it\n");
  writeFileSync(join(old, "deploy.md"), "the user's own\n");
  const changes = cortexInit(root, { node: process.execPath, cli: CLI, claudeHooks: false });
  // OpenCode 2 (or none installed) gets commands/; 1.x would keep command/ and clean commands/
  const two = existsSync(join(root, ".opencode", "commands", "cortex-resume.md"));
  if (two) {
    assert.equal(existsSync(join(old, "cortex-resume.md")), false);
    assert.ok(changes.some((c) => /\.opencode\/command\/cortex-resume\.md removed/.test(c)));
    assert.equal(readFileSync(join(old, "cortex-handoff.md"), "utf8"), "my own command, nothing to do with it\n");
  }
  assert.equal(readFileSync(join(old, "deploy.md"), "utf8"), "the user's own\n");
});
