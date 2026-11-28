// v4.6: what an older reader let into the contract (seen in a real packet, 2026-11-25), and must never again.
import assert from "node:assert/strict";
import { test } from "node:test";
import { segments } from "../src/core/judge.ts";
import { addTurn, readTurns } from "../src/core/turns.ts";
import { computeMission, noiseRule, ownWords, pinKind, pinsOf, type MissionRecord } from "../src/core/mission.ts";
import { instructions } from "../src/core/tiers.ts";
import { tmpRepo } from "./helpers.ts";

const ts = (min: number) => new Date(Date.parse("2026-11-25T09:00:00Z") + min * 60_000).toISOString();

test("v4.6 precision: a `!command` typed in the app is never a rejection or a rule, whatever git printed", () => {
  const p = tmpRepo();
  const cmd = `<bash-input>git -C "/tmp/x" push origin :refs/tags/v4.5.1 && git push origin v4.5.1</bash-input><bash-stdout>remote: fatal error in commit_refs\n ! [remote rejected] v4.5.1 (failure)\nerror: failed to push some refs</bash-stdout><bash-stderr></bash-stderr>`;
  assert.deepEqual(segments(cmd).map((x) => x.source), ["command"]);
  addTurn(p, { ts: ts(0), harness: "claude-code", session: "s", ref: "u0", text: "Ship v4.5.1 and never push to main without CI." });
  addTurn(p, { ts: ts(1), harness: "claude-code", session: "s", ref: "u1", text: cmd });
  const rec = computeMission(p, { session: "s", turns: readTurns(p, "s"), now: new Date(ts(2)), parent: null, episodes: [{ end: ts(0.5), ask: "ship", done: "v4.5.1 is on GitHub, but CI never ran on it." }] });
  assert.equal(rec.mission.rejected.length, 0, "git's [rejected] is not the user turning something down");
  assert.deepEqual(rec.mission.pins.map((x) => x.kind), ["never"], "the real rule stays");
});

test("v4.6 precision: pleas and dictation cut off mid-thought are not rules; real ones next to them still are", () => {
  // each one was a [never] rule in a real contract
  for (const s of [
    "keep separate branches so new changes and.",
    "and read the prompt attached in md as well,, think harder and dont' make mistakes , have full context and in depth understanding first okay",
    "think harder don’t mess up and keep thinking harder and deeper and research deeper , don’t make mistakes Note",
    "Don't make mistakes.",
    "never mess it up okay",
  ]) { assert.equal(pinKind(s), null, s); assert.equal(noiseRule(s) || pinKind(s) === null, true); }
  // a plea next to a real rule, or a "mess up" that names its object, still binds
  assert.equal(pinKind("Don't mess up the database schema."), "never");
  assert.equal(pinKind("don't mess up or downgrade anything current"), "never");
  assert.equal(pinKind("Think harder, and never merge into main before I review."), "never");
  assert.equal(pinKind("Keep v4.10 and v4.11 as separate branches."), "never");
  assert.equal(pinKind("Keep the Stop hook p95 under 60 ms."), "must");
  assert.deepEqual(pinsOf("Don't make mistakes. Never run docker on this machine.").map((x) => x.text), ["Never run docker on this machine."]);
});

test("v4.6 precision: an earlier reply quoted inline as `: { … }` is quoted text, not your standing instructions", () => {
  const reply = [
    "Checking two claims I just made in SECURITY.md before they ship.",
    "",
    "Both claims check out: the only network call is in api-call.ts, and scrubbing covers everything stored.",
    "",
    "Safest scope: add the key **only to the plugin's own skill copies** (written by the bundler).",
    "",
    "| Your pasted briefs count | Directives in a brief you paste become binding rules; pasted assistant replies never do. |",
  ].join("\n");
  const text = `Keep \`v4.10\` and \`v4.11\` untouched. Give me a concise ship report when done. last chat last response for context : {\n\n${reply}\n\n}`;
  const t = { id: "01", ts: ts(0), harness: "claude-code", session: "s", ref: "u0", text, redacted: 0 };
  assert.deepEqual(segments(text).map((x) => x.source), ["you", "pasted"]);
  const own = ownWords(t);
  assert.match(own, /Keep `v4\.10` and `v4\.11` untouched/);
  assert.doesNotMatch(own, /Both claims|Safest scope|never do/);
  const rules = instructions([{ n: 1, text: own }]).map((r) => r.text);
  assert.ok(rules.some((r) => /v4\.10/.test(r)), "your own rule stays");
  assert.ok(!rules.some((r) => /claims check out|Safest scope|never do/.test(r)), rules.join(" | "));
  // a brace that is code, not a quote, leaves your words alone
  assert.deepEqual(segments("Never change this config: {\"a\": 1}").map((x) => x.source), ["you"]);
});

test("v4.6 precision: a contract inherited from an older reader sheds its pleas and `!command` rejections, nothing else", () => {
  const p = tmpRepo();
  const pin = (text: string, kind: "never" | "must" | "skill" | "decision") => ({ text, kind, at: ts(0), session: "old", hop: 1 });
  const parent: MissionRecord = { v: 1, rev: 5, session: "old", at: ts(0), inherited: null,
    lineage: { handoffId: "h_1", parentHandoffId: null, parentSession: null, hop: 1, originSession: "old", gitHead: null },
    mission: { id: "m_1", goal: "Phase 4 on branch v4.6-stageshow-ui", goalAt: ts(0), goalHop: 1, status: "active",
      pins: [pin("keep separate branches so new changes and.", "never"), pin("Keep v4.10 and v4.11 untouched.", "never"),
        pin("use best of stage show skill", "skill"), pin("Gate the worktree with a copy of the tsconfig, and.", "decision")],
      rejected: [{ what: "v4.5.1 is on GitHub", why: "<bash-input>git push origin v4.5.1</bash-input><bash-stdout> ! [rejected]</bash-stdout>", at: ts(0), session: "old", hop: 1 },
        { what: "tinted backgrounds", why: "reject, this is a downgrade", at: ts(0), session: "old", hop: 1 }] } };
  addTurn(p, { ts: ts(5), harness: "claude-code", session: "new", ref: "u0", text: "/cortex-resume" });
  const rec = computeMission(p, { session: "new", turns: readTurns(p, "new"), now: new Date(ts(6)), parent, episodes: [] });
  assert.deepEqual(rec.mission.pins.map((x) => x.text), ["Keep v4.10 and v4.11 untouched.", "use best of stage show skill", "Gate the worktree with a copy of the tsconfig, and."], "decisions are kept as recorded");
  assert.deepEqual(rec.mission.rejected.map((x) => x.what), ["tinted backgrounds"]);
});

test("v4.6 port: init's clean-up removes only a command Cortex wrote, never yours that mentions Cortex or STATE.md", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const { cortexInit } = await import("../src/init.ts");
  const { CLI } = await import("./helpers.ts");
  const root = mkdtempSync(join(tmpdir(), "cortex-oc-own-"));
  spawnSync("git", ["-C", root, "init", "-q"]);
  const old = join(root, ".opencode", "command");
  mkdirSync(old, { recursive: true });
  const mine = "---\ndescription: my notes\n---\nRead .vault/STATE.md, then ask Kapex Cortex's kc for status.\n";
  writeFileSync(join(old, "cortex-resume.md"), mine);
  cortexInit(root, { node: process.execPath, cli: CLI, claudeHooks: false });
  if (existsSync(join(root, ".opencode", "commands", "cortex-resume.md"))) assert.equal(readFileSync(join(old, "cortex-resume.md"), "utf8"), mine);
});

test("v4.6 review: a quoted reply's own code braces don't end the quote; Windows line endings quote too", () => {
  const reply = `Next: ${"x".repeat(130)}\n\`\`\`ts\nfunction f() {\n  return 1\n}\n\`\`\`\nYou must keep the Stop hook under 60 ms. I've also bumped it.`;
  const text = `Keep v4.10 untouched. Here is the last reply for context: {\n${reply}\n}\nNever push to main.`;
  const t = { id: "01", ts: ts(0), harness: "claude-code", session: "s", ref: "u0", text, redacted: 0 };
  assert.deepEqual(pinsOf(ownWords(t)).map((x) => x.text), ["Keep v4.10 untouched.", "Never push to main."]);
  assert.deepEqual(segments(text.replace(/\n/g, "\r\n")).map((x) => x.source), ["you", "pasted", "you"]);
  // an opening with no closing line is not a quote: your words stay yours
  assert.deepEqual(segments(`see: {\n${"y".repeat(130)}\nnever merge before review`).map((x) => x.source), ["you"]);
});

test("v4.6 review: your own key's model saved in one settings file and the switch in another is kept, not reset", async () => {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { readPrefs, forgetPrefs } = await import("../src/core/prefs.ts");
  const p = tmpRepo();
  mkdirSync(process.env.CORTEX_HOME!, { recursive: true });
  writeFileSync(join(process.env.CORTEX_HOME!, "config.json"), JSON.stringify({ prefs: { dreamModel: "nvidia/llama-3.3-nemotron-super" } }));
  writeFileSync(join(p.priv, "prefs.json"), JSON.stringify({ dreamBackend: "api" }));
  forgetPrefs();
  const pr = readPrefs(p);
  writeFileSync(join(process.env.CORTEX_HOME!, "config.json"), "{}"); forgetPrefs();
  assert.equal(pr.dreamBackend, "api");
  assert.equal(pr.dreamApiModel, "nvidia/llama-3.3-nemotron-super");
  assert.equal(pr.dreamModel, "sonnet");
});

test("goal: an approval opener is dropped from your words; a pasted approval or status reply is never the goal", async () => {
  const { taskText } = await import("../src/core/brief.ts");
  // your own words: the task after the opener counts (the blind review's cases)
  for (const [t, want] of [
    ["Sure, now build the billing page with Stripe checkout and invoices.", "now build the billing page with Stripe checkout and invoices."],
    ["Got it. Now add the export button to the reports page and test it.", "Now add the export button to the reports page and test it."],
    ["Perfect. Now port the Settings page with the same stageshow bar.", "Now port the Settings page with the same stageshow bar."],
    ["Awesome, next build the OpenCode card for the handoff page.", "next build the OpenCode card for the handoff page."],
    ["The Strip mockup is a big upgrade. Fix the amber on Mist, then port it.", "Fix the amber on Mist, then port it."],
    ["Approve all pending migrations and then deploy to staging today.", "Approve all pending migrations and then deploy to staging today."],
    ["The goal is a clean rewrite of the auth flow with session tokens.", "The goal is a clean rewrite of the auth flow with session tokens."],
    ["Let me explain the task: build a CSV importer for the admin panel.", "Let me explain the task: build a CSV importer for the admin panel."],
    ["| a | b |\n|---|---|\n| 1 | 2 |\nBuild this table into the page please.", "| a | b |\n|---|---|\n| 1 | 2 |\nBuild this table into the page please."],
  ] as const) assert.equal(taskText(t), want, t);
  assert.equal(taskText("Looks great!"), null); // an approval alone is no task
  // pasted: an approval or an assistant's status reply reacts to work shown, so it never becomes the goal
  assert.equal(taskText("(pasted) The Strip mockup is a big upgrade. Fix the amber on Mist, then port it and start the Overview mock."), null);
  assert.equal(taskText("(pasted) I've ported the strip. Here's what changed. Done: 148 tests pass. Next: Overview."), null);
  assert.equal(taskText("(pasted) Goal: ship the export page"), "Goal: ship the export page");
  assert.equal(taskText("(pasted) Build the export page with a CSV button and keep the gray theme."), "Build the export page with a CSV button and keep the gray theme.");
});

test("handoff page: the contract is read back from STATE.md, newest rules with their why; a command echo is never a rejection", async () => {
  const { contractOf } = await import("../src/core/mission-view.ts");
  const head = "# STATE\n\n## Mission contract (binding across chats until the user says it is done or starts a new task)\n**North star:** x\n**Binding rules (the user's own words; follow them exactly):**\n- [never] “Never push without asking.” _(chat 1, 2026-11-25 11:51)_ — why: “a push once shipped a broken build”\n- [decision] “Use the warning key for amber words.” _(chat 4, this one, 2026-11-27 10:34)_\n**Superseded (no longer binding; a newer goal or decision replaced them):**\n- [decision] ~~“Work only on main.”~~ → replaced by “Phase 4 on its own branch” _(2026-11-25 09:26)_\n**Rejected (never propose or repeat these):**\n- Ship the dense layout → the user: “it was a downgrade” _(chat 2, 2026-11-25)_\n- v4.5.1 is on GitHub → the user: “<bash-input>git push origin v4.5.1</bash-input>” _(chat 3, 2026-11-25)_\n\n## Goal\nx\n";
  const c = contractOf(head)!;
  assert.equal(c.ruleCount, 2);
  // newest first by each rule's stamp, whatever order STATE.md lists the kinds in
  assert.deepEqual(c.rules, [{ kind: "decision", text: "Use the warning key for amber words." }, { kind: "never", text: "Never push without asking.", why: "a push once shipped a broken build" }]);
  assert.deepEqual(c.superseded, [{ text: "Work only on main.", by: "Phase 4 on its own branch" }]);
  assert.deepEqual(c.rejected, [{ what: "Ship the dense layout", why: "it was a downgrade" }]);
  assert.equal(contractOf("# STATE\n\n## Goal\nx\n"), null);
});

test("rules: a capital letter names something, so \"plan A.\" is a rule; a lowercase article at the end is cut-off dictation", async () => {
  const { noiseRule } = await import("../src/core/mission.ts");
  assert.equal(noiseRule("Always use plan A."), false);
  assert.equal(noiseRule("Never deploy to region B or A."), false);
  assert.equal(noiseRule("Never leave it in a"), true);
  assert.equal(noiseRule("keep separate branches so new changes and."), true);
});

test("rule reasons: a verdict after a rule is not its why; what went wrong still is", async () => {
  const { pinsOf } = await import("../src/core/mission.ts");
  assert.equal(pinsOf("Never push without asking. It looks great now.")[0]?.why, undefined);
  assert.equal(pinsOf("Never push without asking. This was a mistake.")[0]?.why, undefined);
  assert.match(pinsOf("Never push without asking. It broke the release last week.")[0]?.why ?? "", /broke the release/);
  assert.match(pinsOf("Never use docker. It made the laptop swap all day.")[0]?.why ?? "", /swap/);
});
