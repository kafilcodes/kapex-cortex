import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { cliFromHook } from "../src/core/dream-spawn.ts";
import { cortexInit } from "../src/init.ts";
import { CLI, userLine } from "./helpers.ts";

const HOOK = join(import.meta.dirname, "..", "claude-plugin", "cortex", "hook.mjs");

const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1];

test("A8: hook latency on this machine (p95 of 50 runs, full process spawn)", () => {
  const root = mkdtempSync(join(tmpdir(), "cortex-lat-"));
  // realistic: a git repo with a dirty tracked file, so Stop also builds STATE and a WIP ref
  spawnSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(join(root, "app.ts"), "export const a = 1;\n");
  spawnSync("git", ["-C", root, "add", "."]);
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
  writeFileSync(join(root, "app.ts"), "export const a = 2;\n");
  cortexInit(root, { node: process.execPath, cli: CLI });
  const transcript = join(root, "t.jsonl");
  writeFileSync(transcript, Array.from({ length: 200 }, (_, i) => userLine(`u${i}`, `message ${i}: don't break the build`)).join(""));
  const time = (name: string, input: object) => {
    const t0 = performance.now();
    // what the plugin runs: the pre-built hook file, not the TypeScript CLI
    const r = spawnSync(process.execPath, [HOOK, name, "--plugin"], { input: JSON.stringify(input) });
    assert.equal(r.status, 0);
    return performance.now() - t0;
  };
  const stop: number[] = [];
  const start: number[] = [];
  for (let i = 0; i < 50; i++) {
    stop.push(time("claude.stop", { session_id: "s", transcript_path: transcript, cwd: root, last_assistant_message: "done" }));
    start.push(time("claude.sessionstart", { session_id: "s", transcript_path: transcript, cwd: root, source: "compact" }));
  }
  const s = p95(stop);
  const ss = p95(start);
  console.log(`Stop p95 ${s.toFixed(1)} ms · SessionStart(compact) p95 ${ss.toFixed(1)} ms (v3 has no per-message hook)`);
  // The budgets are for a developer machine. Shared CI runners are 2-3x slower and noisy, so there the
  // test only catches big regressions (3x); on this Mac the real limits apply.
  if (process.env.CI) return; // shared CI runners are 3-5x slower and noisy: report there, enforce on a dev machine
  assert.ok(s < 150, `Stop p95 ${s.toFixed(1)} ms ≥ 150`);
  assert.ok(ss < 150, `SessionStart p95 ${ss.toFixed(1)} ms ≥ 150`);
});

test("hooks start the CLI, not themselves: the auto-Dream launched from hook.mjs runs cortex/src/cli.ts", () => {
  assert.equal(cliFromHook("/p/claude-plugin/cortex/hook.mjs"), join("/p/claude-plugin/cortex", "src", "cli.ts"));
  assert.equal(cliFromHook("/p/src/hook.ts"), join("/p/src", "cli.ts"));
  assert.equal(cliFromHook("/p/src/cli.ts"), "/p/src/cli.ts");
});
