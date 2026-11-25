import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readMissionRecord, type MissionRecord } from "../src/core/mission.ts";
import { renderMission } from "../src/core/mission-view.ts";
import { repoPaths } from "../src/core/paths.ts";
import { statePath } from "../src/core/state.ts";
import { readTurns } from "../src/core/turns.ts";
import { telephoneRepo } from "../scripts/telephone.ts";
import { isRule, parseJudgment } from "../src/core/dream-model.ts";
import type { NativeFile } from "../src/core/native.ts";
import { CLI, ROOT, tmpRepo } from "./helpers.ts";

// v4.5 review fixes: which packet a chat sees, whose decisions bind whom, and the contract's size, each tested
// where the fresh-eyes review found it could go wrong.
const HOOK = join(ROOT, "claude-plugin", "cortex", "hook.mjs");
const hook = (event: string, input: object, env: NodeJS.ProcessEnv = process.env) => spawnSync(process.execPath, [HOOK, event, "--plugin"], { input: JSON.stringify(input), encoding: "utf8", env });
const ts = (min: number) => new Date(Date.parse("2026-11-20T09:00:00Z") + min * 60_000).toISOString();
const user = (file: string, uuid: string, min: number, content: unknown) => appendFileSync(file, JSON.stringify({ type: "user", uuid, timestamp: ts(min), message: { role: "user", content } }) + "\n");
const readPacket = (file: string, uuid: string, min: number, packet: string) => appendFileSync(file, JSON.stringify({ type: "user", uuid, timestamp: ts(min), message: { role: "user", content: [{ type: "tool_result", tool_use_id: uuid, content: packet }] } }) + "\n");

test("a 'hi' (or a side question) never takes over STATE.md, so a resume after it still continues the real task", () => {
  const p = tmpRepo();
  const t = (s: string) => join(p.root, `${s}.jsonl`);
  user(t("a"), "a1", 0, "Build the importer. Never buffer the whole file.");
  hook("claude.stop", { session_id: "a", transcript_path: t("a"), cwd: p.root, last_assistant_message: "Importer streaming. Next: add retries." });
  // chat b says hi, asks a side question, then resumes
  user(t("b"), "b1", 5, "hi");
  hook("claude.stop", { session_id: "b", transcript_path: t("b"), cwd: p.root, last_assistant_message: "Hi! What are we working on?" });
  user(t("b"), "b2", 6, "what time zone does the server use?");
  hook("claude.stop", { session_id: "b", transcript_path: t("b"), cwd: p.root, last_assistant_message: "UTC." });
  assert.match(readFileSync(statePath(p), "utf8"), /· session a\n/, "the real task's packet stays the handoff");
  user(t("b"), "b3", 7, "/cortex-resume");
  readPacket(t("b"), "b3r", 7.5, readFileSync(statePath(p), "utf8"));
  hook("claude.stop", { session_id: "b", transcript_path: t("b"), cwd: p.root, last_assistant_message: "Picking up the importer." });
  const rec = readMissionRecord(p, "b")!;
  assert.equal(rec.lineage.parentSession, "a");
  assert.ok(rec.mission.pins.some((x) => x.text === "Never buffer the whole file."));
});

test("/cortex-handoff decisions bind the chat they were saved for, never every chat open at the time", () => {
  const p = tmpRepo();
  const t = (s: string) => join(p.root, `${s}.jsonl`);
  user(t("x"), "x1", 0, "Write the billing docs for the new plans.");
  hook("claude.stop", { session_id: "x", transcript_path: t("x"), cwd: p.root, last_assistant_message: "Docs drafted." });
  user(t("y"), "y1", 1, "Refactor the cache layer to use one map.");
  hook("claude.stop", { session_id: "y", transcript_path: t("y"), cwd: p.root, last_assistant_message: "Refactored." });
  // the panel's Hand off in chat y (the newest real one here)
  assert.equal(spawnSync(process.execPath, [CLI, "handoff", "--decision", "Keep the cache TTL at 5 minutes"], { cwd: p.root, encoding: "utf8" }).status, 0);
  hook("claude.stop", { session_id: "x", transcript_path: t("x"), cwd: p.root, last_assistant_message: "Docs polished." });
  assert.ok(readMissionRecord(p, "y")!.mission.pins.some((x) => x.kind === "decision" && /cache TTL/.test(x.text)));
  assert.ok(!readMissionRecord(p, "x")!.mission.pins.some((x) => /cache TTL/.test(x.text)), "chat x never adopted chat y's decision");
});

test("two worktrees on two tasks: each worktree's STATE.md is its own chat's; the main checkout shows the newest", () => {
  const main = mkdtempSync(join(tmpdir(), "cortex-2wt-"));
  telephoneRepo(main);
  const wa = join(main, ".claude", "worktrees", "a"), wb = join(main, ".claude", "worktrees", "b");
  for (const [w, b] of [[wa, "task-a"], [wb, "task-b"]]) spawnSync("git", ["-C", main, "worktree", "add", "-q", "-b", b!, w!]);
  const t = (s: string) => join(main, `${s}.jsonl`);
  user(t("ca"), "ca1", 0, "Task A: speed up the parser. Never change its output.");
  hook("claude.stop", { session_id: "ca", transcript_path: t("ca"), cwd: wa, last_assistant_message: "Parser faster." });
  user(t("cb"), "cb1", 1, "Task B: add dark mode to settings. Always follow the theme tokens.");
  hook("claude.stop", { session_id: "cb", transcript_path: t("cb"), cwd: wb, last_assistant_message: "Dark mode added." });
  assert.match(readFileSync(join(wa, ".vault", "STATE.md"), "utf8"), /· session ca\n/);
  assert.match(readFileSync(join(wb, ".vault", "STATE.md"), "utf8"), /· session cb\n/);
  assert.match(readFileSync(join(main, ".vault", "STATE.md"), "utf8"), /· session cb\n/, "the repo's newest work");
  // /cortex-handoff run from worktree a re-renders a's chat against a's own checkout, never b's
  assert.equal(spawnSync(process.execPath, [CLI, "handoff", "--next", "profile the tokenizer"], { cwd: wa, encoding: "utf8" }).status, 0);
  const pa = readFileSync(join(repoPaths(main).states, "ca.md"), "utf8");
  assert.match(pa, /· task-a · /);
  assert.match(pa, /## Next action\nprofile the tokenizer/);
});

test("a lean packet: even a full contract (16 long rules, 10 rejections) fits its room, so Next action and Verify stay", () => {
  const long = (i: number) => `Never do thing number ${i} ${"in a very particular and long-winded way ".repeat(8)}`;
  const rec: MissionRecord = { v: 1, session: "s", at: ts(0), inherited: null, lineage: { handoffId: "h", parentHandoffId: null, parentSession: null, hop: 1, originSession: "s", gitHead: null },
    mission: { id: "m", goal: "g".repeat(600), goalAt: ts(0), goalHop: 1, status: "active",
      pins: Array.from({ length: 16 }, (_, i) => ({ text: long(i), kind: "never" as const, at: ts(i), session: "s", hop: 1 })),
      rejected: Array.from({ length: 10 }, (_, i) => ({ what: `approach ${i} `.repeat(30), why: `reject ${i} `.repeat(40), at: ts(i), session: "s", hop: 1 })) } };
  const text = renderMission(rec, { chat: () => "", room: 3_200 });
  assert.ok(text.length <= 3_200, `${text.length} > 3200`);
  assert.equal((text.match(/^- \[never\]/gm) ?? []).length, 16, "no rule is dropped, only shortened");
  assert.match(text, /older in \.vault\/private\/states|no room here/);
  // and the whole lean packet keeps Next action and Verify
  const p = tmpRepo();
  writeFileSync(join(p.priv, "prefs.json"), JSON.stringify({ tokenMode: "lean" }));
  const tp = join(p.root, "t.jsonl");
  user(tp, "u0", 0, "Build the thing. " + Array.from({ length: 16 }, (_, i) => long(i).trim() + ".").join(" "));
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "Next: write the tests." });
  const packet = readFileSync(statePath(p), "utf8");
  assert.ok(packet.length <= 8_000);
  assert.match(packet, /## Next action\nwrite the tests\./);
  assert.match(packet, /## Verify/);
});

test("a shrunk transcript re-read cut short by the budget marks nothing rewound until it reaches the end", () => {
  const p = tmpRepo();
  const tp = join(p.root, "t.jsonl");
  const words = ["Build the export page.", "Add CSV output.", "Add a PDF button.", "Write the docs page.", "Ship it to staging."];
  words.forEach((w, i) => user(tp, `u${i}`, i, w));
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "ok" });
  // the last message is rewound away (the file shrinks), then the re-read runs with a tiny budget
  writeFileSync(tp, readFileSync(tp, "utf8").split("\n").slice(0, 4).join("\n") + "\n");
  const small = { ...process.env, CORTEX_TEST_READ_MAX: "250" };
  hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "ok" }, small);
  assert.deepEqual(readTurns(p, "s").map((x) => x.text), words, "cut short: nothing marked yet");
  for (let i = 0; i < 6; i++) hook("claude.stop", { session_id: "s", transcript_path: tp, cwd: p.root, last_assistant_message: "ok" }, small);
  assert.deepEqual(readTurns(p, "s").map((x) => x.text), words.slice(0, 4), "at the end: only the vanished one is rewound");
});

test("Dream: a rule the code drifted from is shown as drift, never offered for deletion; a fact a run disproves still is", () => {
  const file = "/p/CLAUDE.md";
  const files = [{ path: file, label: "CLAUDE.md", scope: "project", loads: "always", lines: 3, tokens: 30, editable: true }] as unknown as NativeFile[];
  const ents = [
    { file, label: "CLAUDE.md", line: 1, end: 1, text: "- Keep every source file under 300 lines.", heading: "" },
    { file, label: "CLAUDE.md", line: 2, end: 2, text: "- `npm test` hangs on this machine.", heading: "" },
  ];
  const ev = [
    { id: "E1", kind: "commit" as const, ts: ts(0), session: "", text: "Commit abc: split source file into 340 lines of state" },
    { id: "E2", kind: "run" as const, ts: ts(1), session: "s", cmd: "npm test", ok: true, text: "`npm test` succeeded" },
  ];
  const raw = JSON.stringify({ findings: [
    { entry: "N1", kind: "stale", why: "A source file now has 340 lines.", evidence: ["E1"], action: "delete", confidence: 0.95 },
    { entry: "N2", kind: "false", why: "npm test ran and passed.", evidence: ["E2"], action: "delete", confidence: 0.95 },
  ] });
  const out = parseJudgment(raw, files, ents, ev, []).findings;
  const rule = out.find((f) => f.line === 1)!, fact = out.find((f) => f.line === 2)!;
  assert.equal(rule.action.op, "none", "the rule is never offered for deletion");
  assert.match(rule.why, /^A rule, not a fact/);
  assert.equal(fact.action.op, "delete", "a claim a run disproves is still fixed");
});

test("Dream guard: a rule stays a rule even when a run disagrees, bold and terse rules count, unknown kinds are rejected", () => {
  const file = "/p/CLAUDE.md";
  const files = [{ path: file, label: "CLAUDE.md", scope: "project", loads: "always", lines: 3, tokens: 30, editable: true }] as unknown as NativeFile[];
  const ents = [
    { file, label: "CLAUDE.md", line: 1, end: 1, text: "- Run `npm test` before every commit.", heading: "" },
    { file, label: "CLAUDE.md", line: 2, end: 2, text: "* **Hooks**: always exit 0.", heading: "" },
    { file, label: "CLAUDE.md", line: 3, end: 3, text: "- The npm test suite is slow here.", heading: "" },
  ];
  const ev = [{ id: "E1", kind: "run" as const, ts: ts(1), session: "s", cmd: "npm test", ok: false, text: "`npm test` hooks exit failed" }];
  const raw = JSON.stringify({ findings: [
    { entry: "N1", kind: "stale", why: "npm test failed.", evidence: ["E1"], action: "delete", confidence: 0.95 },
    { entry: "N2", kind: "false", why: "a hook exit failed.", evidence: ["E1"], action: "delete", confidence: 0.95 },
    { entry: "N3", kind: "obsolete", why: "npm test changed.", evidence: ["E1"], action: "delete", confidence: 0.95 },
  ] });
  const j = parseJudgment(raw, files, ents, ev, []);
  assert.equal(j.findings.find((f) => f.line === 1)?.action.op, "none", "a run can't unlock deleting a rule");
  assert.equal(j.findings.find((f) => f.line === 2)?.action.op, "none", "a bold, terse rule is still a rule");
  assert.equal(j.findings.find((f) => f.line === 3), undefined, "a kind outside the schema is rejected");
  assert.ok(isRule("1. **Never** push to main.") && isRule("Only edit files under src/.") && !isRule("The npm test suite is slow here."));
  for (const fact of ["The API only accepts JSON.", "`npm test` only runs the unit tests.", "CI always runs on Ubuntu 22.04.", "We never got the Windows build working.", "Node 18 is the only supported runtime."]) assert.ok(!isRule(fact), fact);
});

test("the panel counts the mission contract's rules and decisions (they no longer sit under 'standing instructions')", () => {
  const p = tmpRepo();
  const t = join(p.root, "t.jsonl");
  user(t, "u1", 0, "Build the export page. Use the stageshow skill for the mockup. Never merge before review.");
  hook("claude.stop", { session_id: "s", transcript_path: t, cwd: p.root, last_assistant_message: "Built." });
  const st = spawnSync(process.execPath, [join(ROOT, "src", "status-cli.ts")], { cwd: p.root, encoding: "utf8" });
  const pv = (JSON.parse(st.stdout) as { handoff: { preview: { instructions: number } } }).handoff.preview;
  assert.equal(pv.instructions, 2);
});

