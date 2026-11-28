// v4.6 notifications: never from a test, benchmark or throwaway run; never the same words twice in 10 minutes or a
// burst; the macOS sound follows the Sounds setting. (Tests run with CORTEX_NO_NOTIFY; the checks that need it unset
// run the CLI and hook in a child process, always from a temp folder, so nothing can reach the desktop.)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CLI, ROOT } from "./helpers.ts";
import { BURST_MS, mayNotify, quietReason, REPEAT_MS } from "../src/core/notify-guard.ts";
import { notifyMac } from "../src/core/notifier.ts";

const noFlag = () => { const e = { ...process.env }; delete e.CORTEX_NO_NOTIFY; return e; };

test("notify guard: a test run, or any project in the temp folder, is quiet; a real project isn't", () => {
  assert.match(quietReason(homedir(), { CORTEX_NO_NOTIFY: "1" }) ?? "", /CORTEX_NO_NOTIFY/);
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "nq-")));
  // the fixed temp folders of this OS only: /private/tmp exists only on macOS (Linux refuses to create it), /tmp not on Windows
  const fixed = process.platform === "darwin" ? ["/tmp", "/private/tmp/x"] : process.platform === "linux" ? ["/tmp"] : [];
  for (const d of [tmp, join(tmp, "deep", "repo"), ...fixed]) { mkdirSync(d, { recursive: true }); assert.match(quietReason(d, {}) ?? "", /temp folder/, d); }
  assert.equal(quietReason(join(homedir(), "Projects", "real"), {}), null);
  assert.equal(notifyMac("Kapex Cortex", "a test"), false, "CORTEX_NO_NOTIFY: nothing sent");
});

test("notify guard: the same words once in 10 minutes; a burst inside 2 s shows only its first", () => {
  const dir = mkdtempSync(join(tmpdir(), "ng-")), t0 = 1_800_000_000_000;
  assert.equal(mayNotify(dir, "Kapex Cortex", "usage limit", t0), true);
  assert.equal(mayNotify(dir, "Kapex Cortex", "usage limit", t0 + 60_000), false, "a second chat hitting the same limit");
  assert.equal(mayNotify(dir, "Kapex Cortex", "Handoff saved", t0 + BURST_MS - 1), false, "a burst");
  assert.equal(mayNotify(dir, "Kapex Cortex", "Handoff saved", t0 + BURST_MS + 1), true, "other words after the burst window");
  assert.equal(mayNotify(dir, "Kapex Cortex", "usage limit", t0 + REPEAT_MS + 1), true, "the same words again after 10 minutes");
  writeFileSync(join(dir, "sent.json"), "{not json");
  assert.equal(mayNotify(dir, "Kapex Cortex", "after a corrupt record", t0 + 2 * REPEAT_MS), true, "an unreadable record starts over");
});

test("kc notify from a throwaway project never sends, even with CORTEX_NO_NOTIFY unset", () => {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "nproj-")));
  const r = spawnSync(process.execPath, [CLI, "notify", "--sound", "done", "Kapex Cortex", "Handoff saved"], { cwd: proj, env: noFlag(), encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stdout, process.platform === "darwin" ? /^not sent \(the project is in the temp folder/ : /^not sent \(not macOS\)/);
});

test("a usage limit in a throwaway project: the real hook stays quiet and never starts a notifier build", () => {
  const proj = realpathSync(mkdtempSync(join(tmpdir(), "nlim-"))), home = mkdtempSync(join(tmpdir(), "nhome-"));
  spawnSync("git", ["init", "-q", proj]);
  spawnSync(process.execPath, [CLI, "init", proj], { env: { ...process.env, CORTEX_HOME: home }, encoding: "utf8" });
  const hook = join(ROOT, "claude-plugin", "cortex", "hook.mjs"), env = { ...noFlag(), CORTEX_HOME: home };
  const run = (ev: string, input: object) => spawnSync(process.execPath, [hook, ev, "--plugin"], { cwd: proj, env, input: JSON.stringify(input), encoding: "utf8" });
  run("claude.sessionstart", { session_id: "s1", cwd: proj, source: "startup" });
  run("claude.stopfailure", { session_id: "s1", cwd: proj, error: "rate_limit", last_assistant_message: "You've hit your limit" });
  assert.equal(existsSync(join(home, "notifier", "sent.json")), false, "no notification was even considered");
  assert.equal(existsSync(join(home, "notifier", "v3")), false, "no notifier app was built");
});
