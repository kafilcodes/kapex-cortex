import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { tmpRepo } from "./helpers.ts";
import { applySafety, auditSafety, checkCommand, undoSafety } from "../src/core/safety.ts";

const GATE = join(import.meta.dirname, "..", "templates", "verify-gate.mjs");
const settings = (root: string) => JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
const gitRepo = (root: string) => {
  spawnSync("git", ["init", "-q", "-b", "main", root]);
  writeFileSync(join(root, "a.txt"), "1\n");
  spawnSync("git", ["-C", root, "add", "."]);
  spawnSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"]);
};
const gate = (root: string, command: string, ok = false) => {
  const r = spawnSync(process.execPath, [GATE, command], { input: JSON.stringify({ session_id: "s1", cwd: root, hook_event_name: "Stop" }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: root, ...(ok ? { GATE_OK: "1" } : {}) } });
  return { status: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) as { decision?: string; reason?: string; systemMessage?: string } : null };
};

test("v3.7 safety audit: flags readable secrets and a Stop hook that can't send Claude back, and finds the check command", () => {
  const p = tmpRepo();
  writeFileSync(join(p.root, ".env"), "KEY=1\n");
  writeFileSync(join(p.root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  mkdirSync(join(p.root, ".claude"), { recursive: true });
  writeFileSync(join(p.root, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "npm test" }] }] } }));
  const v = auditSafety(p);
  const by = (id: string) => v.findings.find(f => f.id === id)!;
  assert.equal(by("secrets").level, "warn");
  assert.match(by("secrets").title, /\.env can be read/);
  assert.equal(by("sandbox").title, "Sandbox off");
  assert.equal(by("gate").level, "warn");
  assert.match(by("gate").detail, /exits 1/);
  assert.equal(checkCommand(p), "npm test");
  assert.equal(v.undo, false);
});

test("v3.7 Apply adds deny rules and the gate to .claude/settings.json without losing what was there; Undo puts it back", () => {
  const p = tmpRepo();
  writeFileSync(join(p.root, "package.json"), JSON.stringify({ scripts: { check: "tsc && node --test" } }));
  mkdirSync(join(p.root, ".claude"), { recursive: true });
  const before = JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"], deny: ["Bash(rm -rf *)"] } }, null, 2) + "\n";
  writeFileSync(join(p.root, ".claude", "settings.json"), before);
  applySafety(p, "secrets");
  applySafety(p, "secrets"); // twice: no duplicate rules
  applySafety(p, "gate");
  const s = settings(p.root);
  assert.equal(s.model, "opus");
  assert.deepEqual(s.permissions.allow, ["Bash(ls)"]);
  assert.ok(s.permissions.deny.includes("Bash(rm -rf *)") && s.permissions.deny.includes("Read(.env)") && s.permissions.deny.includes("Read(~/.ssh/**)"));
  assert.equal(s.permissions.deny.filter((r: string) => r === "Read(.env)").length, 1);
  const h = s.hooks.Stop[0].hooks[0];
  assert.deepEqual([h.command, h.args[1]], ["node", "npm run check"]);
  assert.equal(h.args[0], "${CLAUDE_PROJECT_DIR}/.claude/hooks/cortex-verify-gate.mjs");
  assert.ok(existsSync(join(p.root, ".claude", "hooks", "cortex-verify-gate.mjs")));
  const v = auditSafety(p);
  assert.ok(v.findings.filter(f => f.id !== "sandbox").every(f => f.level === "ok"), JSON.stringify(v.findings));
  assert.equal(v.undo, true);
  assert.match(undoSafety(p), /Undone/);
  assert.equal(readFileSync(join(p.root, ".claude", "settings.json"), "utf8"), before, "settings back exactly as they were");
  assert.equal(existsSync(join(p.root, ".claude", "hooks", "cortex-verify-gate.mjs")), false, "the script it created is gone");
  assert.equal(auditSafety(p).undo, false);
});

test("v3.7 the gate: skips when nothing changed, blocks on a failing check (3 times at most), passes on green", () => {
  const p = tmpRepo();
  gitRepo(p.root);
  assert.deepEqual(gate(p.root, "exit 1"), { status: 0, out: null }, "clean tree: nothing to check");
  writeFileSync(join(p.root, "a.txt"), "2\n");
  const fail = `node -e "if (!process.env.GATE_OK) { console.log('1 test failed'); process.exit(1) }"`; // one command, its result set from outside
  for (let i = 1; i <= 3; i++) {
    const r = gate(p.root, fail);
    assert.equal(r.status, 0);
    assert.equal(r.out?.decision, "block", `try ${i} sends Claude back`);
    assert.match(r.out!.reason!, new RegExp(`try ${i} of 3[\\s\\S]*1 test failed`));
  }
  const giveUp = gate(p.root, fail);
  assert.equal(giveUp.out?.decision, undefined, "after 3 tries Claude may stop");
  assert.match(giveUp.out!.systemMessage!, /still fails after 3 tries/);
  assert.deepEqual(gate(p.root, fail, true), { status: 0, out: null }, "green: finish");
  assert.deepEqual(gate(p.root, fail), { status: 0, out: null }, "same changes as the last green run: not run again");
});

test("v3.8.1 a check that failed and was fixed in the same turn counts as passed; one that ends red stays red", async () => {
  const { accumulate, finalize, readEpisodes } = await import("../src/core/episodes.ts");
  const p = tmpRepo();
  const run = (id: string, err: boolean) => [
    { type: "assistant", uuid: `a${id}`, timestamp: "2026-11-12T10:00:00Z", message: { role: "assistant", content: [{ type: "tool_use", id, name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", uuid: `u${id}`, timestamp: "2026-11-12T10:00:01Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: err, content: err ? "1 failing" : "ok" }] } },
  ];
  accumulate(p, "s1", [...run("t1", true), ...run("t2", false)]);
  finalize(p, "s1", "done");
  accumulate(p, "s2", [...run("t3", false), ...run("t4", true)]);
  finalize(p, "s2", "done");
  const [red, fixed] = readEpisodes(p);
  assert.deepEqual(fixed!.tests, { ran: 2, failed: 1, lastOk: true });
  assert.deepEqual(red!.tests, { ran: 2, failed: 1, lastOk: false });
  const { buildTimeline } = await import("../src/core/timeline.ts");
  const tags = buildTimeline(p, { states: [], wips: [] } as never, []).filter((e: { kind: string }) => e.kind === "turn").map((e: { tags: string[] }) => e.tags.find(t => /tests/.test(t)));
  assert.deepEqual(tags.sort(), ["tests failed", "tests passed · 1 fixed"]);
});
