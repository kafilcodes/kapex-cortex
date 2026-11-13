// The Cortex benchmark: a dummy project lived through 25 turns in two chats, then measured. Token-free (no model is
// called), isolated (temp HOME for Cortex and Claude, never the real ~/.claude), repeatable.
//   1. Dream: planted false / stale / duplicate / broken / over-cap notes among valid ones → precision and recall;
//      Apply then Undo → every memory file byte-identical
//   2. Handoff: the STATE.md the real Stop hook wrote, checked for the answers to 10 fixed questions (deterministic);
//      the same 10 questions go to a zero-memory Goldfish agent (bench/goldfish.md says how)
//   3. Speed: Stop and SessionStart hooks (full process spawn), Quick check gate, Quick check run, spend counter,
//      status read, peak memory of one Stop hook
// Usage: node scripts/benchmark.ts [--runs 50] [--keep]   Writes bench/results/scorecard.json and prints the scorecard.
import { CLI } from "../test/helpers.ts"; // first: points CORTEX_HOME / CORTEX_CLAUDE_HOME at temp folders
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { applyDream, dreaming, runDream, undoDream } from "../src/core/dream.ts";
import { autoMemory, claudeProjectDir } from "../src/core/home.ts";
import { repoPaths } from "../src/core/paths.ts";
import { quickDue, rememberCheck } from "../src/core/quick.ts";
import { projectSpend } from "../src/core/spend.ts";
import { cortexInit } from "../src/init.ts";

const ROOT = resolve(import.meta.dirname, "..");
const HOOK = join(ROOT, "claude-plugin", "cortex", "hook.mjs");
const arg = (n: string, d: number) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const RUNS = arg("--runs", 50);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * q) - 1)]!; };
const stats = (xs: number[]) => ({ p50: +pct(xs, 0.5).toFixed(1), p95: +pct(xs, 0.95).toFixed(1), n: xs.length });
const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };

// ── the dummy project ───────────────────────────────────────────────────────────────────────────────────────────
const parent = mkdtempSync(join(tmpdir(), "cortex-bench-"));
const root = join(parent, "invoices"); // a plain project name: the README shots are drawn from this project
mkdirSync(root);
const git = (...a: string[]) => spawnSync("git", ["-C", root, "-c", "user.name=bench", "-c", "user.email=bench@example.com", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
mkdirSync(join(root, "src"));
const write = (f: string, t: string) => { mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), t); };
write("package.json", JSON.stringify({ name: "invoices", scripts: { test: "node --test" } }, null, 1));
write("src/parse.ts", "export const ACCENT = '#0EA5A4'\nexport function parse(s: string) { return s.split(',') }\n");
write("src/totals.ts", "export const total = (c: number[]) => c.reduce((a, b) => a + b, 0)\n");
git("add", "-A"); git("commit", "-qm", "scaffold the invoice CLI");
cortexInit(root, { node: process.execPath, cli: CLI, claudeHooks: false });
const p = repoPaths(root);

// 200 distinct, valid style rules (a real bloated CLAUDE.md repeats a theme, not a sentence)
const A = ["Prefer", "Avoid", "Name", "Document", "Test", "Log", "Validate", "Cache", "Split", "Review"];
const B = ["parsers", "currency tables", "CLI flags", "error messages", "fixtures", "exports", "rounding helpers", "date formats", "config loading", "stdin readers"];
const C = ["before merging", "with examples", "in plain English", "per module", "at the boundary", "once per release", "behind a flag", "in the changelog", "near the code", "with a benchmark"];
const FILLER = Array.from({ length: 200 }, (_, i) => `- ${A[i % 10]} ${B[Math.floor(i / 10) % 10]} ${C[Math.floor(i / 100) * 5 + (i % 5)]}.`);
// CLAUDE.md: valid rules, a stale colour, a stale path, and filler that pushes it past Claude Code's 200-line cap
const valid = ["- Money is integer cents, never floats.", "- Parsing lives in `src/parse.ts`.", "- The accent colour is `#0EA5A4`.", "- Run `npm test` before every commit."];
const claudeMd = ["# Invoices", ...valid, "- Cards use `#111315` for the surface.", "- Old reports are built by `src/legacy/report.ts`.",
  ...FILLER].join("\n") + "\n";
write("CLAUDE.md", claudeMd);
const mem = autoMemory(root).dir;
mkdirSync(mem, { recursive: true });
const memoryMd = ["- [Testing notes](testing.md) — how we run tests", "- `npm test` is broken, skip it before commits.", "- Money is integer cents, never floats, always.", "- The CLI reads invoices from stdin."].join("\n") + "\n";
writeFileSync(join(mem, "MEMORY.md"), memoryMd);
// planted: [file label, line, kind] — everything else is a valid note that must not be flagged
const PLANTED: [string, number, string][] = [["CLAUDE.md", 6, "stale"], ["CLAUDE.md", 7, "stale"], ["CLAUDE.md", 0, "over-cap"],
  ["memory/MEMORY.md", 1, "broken-link"], ["memory/MEMORY.md", 2, "false"], ["memory/MEMORY.md", 3, "duplicate"]];

// ── 25 turns in two chats, each followed by the real Stop hook ─────────────────────────────────────────────────
const tdir = claudeProjectDir(root);
mkdirSync(tdir, { recursive: true });
const T0 = Date.now() - 4 * 3_600_000; // the chats happened over the last four hours
let clock = T0, uid = 0;
const ts = (min: number) => new Date((clock += min * 60_000)).toISOString();
const line = (f: string, o: object) => appendFileSync(f, JSON.stringify(o) + "\n");
type Turn = { ask: string; reply: string; edits?: [string, string][]; cmds?: [string, boolean][]; commit?: string; gapMin?: number }
const turns: Turn[] = [
  { ask: "Goal: build the invoice parser CLI with currency support. Read the repo first.", reply: "Read the repo: a parser in src/parse.ts and totals in src/totals.ts. Plan: currency codes, then totals, then CSV export." },
  { ask: "Add currency codes to the parser.", reply: "Added ISO currency codes to parse().", edits: [["src/parse.ts", "export const ACCENT = '#0EA5A4'\nexport function parse(s: string) { const [cur, ...rest] = s.split(','); return { cur, rest } }\n"]] },
  { ask: "Decision: we store money as integer cents, never floats. Always run npm test before committing.", reply: "Noted: integer cents everywhere, and npm test before each commit.", cmds: [["npm test", true]] },
  { ask: "Write tests for parse().", reply: "Added tests for parse(): 6 cases, all pass.", edits: [["test/parse.test.ts", "// parse tests\n"]], cmds: [["npm test", true]] },
  { ask: "Commit that.", reply: "Committed: parse with currency codes.", commit: "parse: currency codes" },
  ...Array.from({ length: 8 }, (_, i): Turn => ({ ask: `Small cleanup ${i + 1} in the parser.`, reply: `Cleanup ${i + 1} done; tests pass.`, edits: [["src/parse.ts", `export const ACCENT = '#0EA5A4'\n// cleanup ${i + 1}\nexport function parse(s: string) { const [cur, ...rest] = s.split(','); return { cur, rest } }\n`]], cmds: [["npm test", true]], ...(i === 4 ? { commit: "parse: cleanups" } : {}) })),
  { ask: "Totals are off by one cent on 3-line invoices. Fix it.", reply: "Fixed the rounding bug in totals: src/totals.ts summed floats; it now sums integer cents. npm test failed first, then passed.", edits: [["src/totals.ts", "export const total = (cents: number[]) => cents.reduce((a, b) => a + Math.round(b), 0)\n"]], cmds: [["npm test", false], ["npm test", true]], commit: "totals: fix the rounding bug (integer cents)" },
  { ask: "<command-message>kapex-cortex:cortex-resume</command-message>\n<command-name>/kapex-cortex:cortex-resume</command-name>", reply: "Picking up the handoff: the invoice CLI, integer cents; next is the docs pass.", gapMin: 75 },
  ...Array.from({ length: 10 }, (_, i): Turn => ({ ask: `Docs pass ${i + 1}: explain the totals in README.`, reply: `Docs pass ${i + 1} done.${i === 9 ? " Next: add CSV export in src/export.ts with a test." : ""}`, edits: [["README.md", `# Invoices\nDocs pass ${i + 1}.\n`]], gapMin: 3, ...(i === 5 ? { commit: "docs: totals" } : {}) })),
];
const hook = (name: string, input: object) => spawnSync(process.execPath, [HOOK, name, "--plugin"], { input: JSON.stringify(input), encoding: "utf8" });
const sessions = ["bench-chat-a", "bench-chat-b"];
turns.forEach((t, i) => {
  const session = i < 14 ? sessions[0]! : sessions[1]!;
  const file = join(tdir, `${session}.jsonl`);
  if (i === 0 || i === 14) line(file, { type: "custom-title", customTitle: i === 0 ? "Invoice parser" : "Invoice parser, part 2", sessionId: session });
  line(file, { type: "user", uuid: `u${++uid}`, sessionId: session, timestamp: ts(t.gapMin ?? 2), message: { role: "user", content: t.ask } });
  for (const [f, text] of t.edits ?? []) { write(f, text); line(file, { type: "assistant", uuid: `a${++uid}`, sessionId: session, timestamp: ts(1), message: { content: [{ type: "tool_use", id: `e${uid}`, name: "Write", input: { file_path: join(root, f), content: text } }] } }); }
  for (const [cmd, ok] of t.cmds ?? []) {
    const id = `b${++uid}`;
    line(file, { type: "assistant", uuid: `a${uid}`, sessionId: session, timestamp: ts(1), message: { content: [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }] } });
    line(file, { type: "user", uuid: `r${uid}`, sessionId: session, timestamp: ts(1), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: !ok, content: ok ? "# pass 6\n# fail 0" : "# pass 5\n# fail 1" }] } });
  }
  if (t.commit) { git("add", "-A"); git("commit", "-qm", t.commit); }
  line(file, { type: "assistant", uuid: `a${++uid}`, sessionId: session, timestamp: ts(1), message: { content: [{ type: "text", text: t.reply }] } });
  if (i === 14) hook("claude.sessionstart", { session_id: session, transcript_path: file, cwd: root, source: "startup" });
  const r = hook("claude.stop", { session_id: session, transcript_path: file, cwd: root, last_assistant_message: t.reply });
  if (r.status !== 0) throw new Error(`Stop hook failed on turn ${i + 1}: ${r.stderr}`);
});
spawnSync(process.execPath, [CLI, "handoff", "--decision", "Keep zero runtime dependencies"], { cwd: root, encoding: "utf8" });

// ── 1. Dream: precision, recall, Apply + Undo ──────────────────────────────────────────────────────────────────
const memFiles = [join(root, "CLAUDE.md"), join(mem, "MEMORY.md")];
const hash = () => memFiles.map((f) => createHash("sha256").update(readFileSync(f)).digest("hex")).join(",");
// the Stop hook starts a Quick check in the background when memory changed: let it finish first
const settle = async () => { for (let i = 0; i < 300 && dreaming(p); i++) await new Promise((r) => setTimeout(r, 100)); };
await settle();
const before = hash();
const dream = await runDream(p, { model: false });
const ADVICE = new Set(["scope", "orphan"]); // "this could be path-scoped" is a suggestion, not a claim the note is wrong
const advice = dream.findings.filter((f) => ADVICE.has(f.kind)).map((f) => `${f.label}:${f.line}:${f.kind}`);
const found = dream.findings.filter((f) => !ADVICE.has(f.kind)).map((f) => [f.label, f.line, f.kind] as [string, number, string]);
const key = ([l, n, k]: [string, number, string]) => `${l}:${n}:${k}`;
const plantedKeys = new Set(PLANTED.map(key));
const tp = found.filter((f) => plantedKeys.has(key(f))).length;
const fp = found.filter((f) => !plantedKeys.has(key(f)));
const applied = applyDream(p, dream.id);
const afterApply = hash();
const undone = undoDream(p, dream.id);
const restored = hash() === before;

// ── 2. Handoff: can the STATE.md answer the 10 questions? (deterministic: each answer's key words are in it) ────
const state = readFileSync(join(root, ".vault", "STATE.md"), "utf8");
const QUESTIONS: [string, RegExp][] = [
  ["What is the project's goal?", /invoice parser CLI with currency support/i],
  ["How must money be stored (decided in turn 3)?", /integer cents/i],
  ["What must run before every commit?", /npm test/],
  ["What bug was fixed in turn 14?", /rounding bug in totals/i],
  ["Which file held that bug?", /src\/totals\.ts/],
  ["What is the immediate next step?", /CSV export/i],
  ["Which file will the next step create?", /src\/export\.ts/],
  ["Which branch is the work on?", /· main ·/],
  ["Did the last check pass?", /passed/i],
  ["Which decision was recorded at handoff?", /zero runtime dependencies/i],
];
const answered = QUESTIONS.map(([q, re]) => ({ q, ok: re.test(state) }));
writeFileSync(join(ROOT, "bench", "results", "goldfish-state.md"), state.replace(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "<project>"));

// ── 3. Speed ────────────────────────────────────────────────────────────────────────────────────────────────────
const fileB = join(tdir, `${sessions[1]}.jsonl`);
// the timing runs replay the real last reply, so the dummy project keeps a true handoff (the README shots are drawn from it)
const stopIn = { session_id: sessions[1], transcript_path: fileB, cwd: root, last_assistant_message: turns[turns.length - 1]!.reply };
const stop: number[] = [], start: number[] = [], gateSame: number[] = [], gateChanged: number[] = [], quickRun: number[] = [], spend: number[] = [], status: number[] = [];
for (let i = 0; i < RUNS; i++) {
  stop.push(time(() => hook("claude.stop", stopIn)));
  start.push(time(() => hook("claude.sessionstart", { ...stopIn, source: "compact" })));
}
const tree = "bench";
rememberCheck(p, memFiles, tree);
for (let i = 0; i < RUNS; i++) gateSame.push(time(() => quickDue(p, tree)));
for (let i = 0; i < Math.min(RUNS, 20); i++) {
  appendFileSync(join(mem, "MEMORY.md"), "");
  writeFileSync(join(root, "src", "touch.ts"), `// ${i}\n`);
  gateChanged.push(time(() => quickDue(p, `${tree}-${i}`)));
  await settle(); const t = performance.now(); await runDream(p, { model: false }); quickRun.push(performance.now() - t);
}
projectSpend(p); // first read fills the cache
for (let i = 0; i < RUNS; i++) spend.push(time(() => projectSpend(p)));
for (let i = 0; i < Math.min(RUNS, 20); i++) status.push(time(() => spawnSync(process.execPath, [CLI, "status", "--json"], { cwd: root })));
const rss = (() => {
  const r = spawnSync("/usr/bin/time", ["-l", process.execPath, HOOK, "claude.stop", "--plugin"], { input: JSON.stringify(stopIn), encoding: "utf8" });
  const m = /(\d+)\s+maximum resident set size/.exec(r.stderr ?? "");
  return m ? Math.round(Number(m[1]) / 1024 / 1024) : null; // macOS reports bytes
})();

// ── scorecard ─────────────────────────────────────────────────────────────────────────────────────────────────
const card = {
  at: new Date().toISOString(), node: process.version, runs: RUNS, turns: turns.length, chats: sessions.length,
  dream: { planted: PLANTED.length, found: found.length, advice, truePositives: tp, falsePositives: fp.map(key), precision: found.length ? tp / found.length : 0, recall: tp / PLANTED.length, applied, changedOnApply: afterApply !== before, undone, byteIdenticalAfterUndo: restored },
  handoff: { stateTokens: Math.round(state.length / 4), answerable: answered.filter((a) => a.ok).length, of: QUESTIONS.length, missed: answered.filter((a) => !a.ok).map((a) => a.q) },
  speedMs: { stopHook: stats(stop), sessionStartHook: stats(start), quickGateUnchanged: stats(gateSame), quickGateChanged: stats(gateChanged), quickCheckRun: stats(quickRun), spendCached: stats(spend), statusRead: stats(status) },
  stopHookPeakMemoryMB: rss,
  bars: { stopP95: 150, quickGateUnchanged: 1, quickCheckRun: 350, spendCached: 10 },
};
writeFileSync(join(ROOT, "bench", "results", "scorecard.json"), JSON.stringify(card, null, 1) + "\n");
const s = card.speedMs;
const ok = (b: boolean) => (b ? "pass" : "FAIL");
console.log(`Cortex benchmark · ${card.turns} turns in ${card.chats} chats · ${RUNS} runs per timing · Node ${process.version}
Dream (Quick check):  precision ${(card.dream.precision * 100).toFixed(0)}%  recall ${(card.dream.recall * 100).toFixed(0)}%  (${tp}/${PLANTED.length} planted, ${fp.length} false positives${fp.length ? `: ${fp.map(key).slice(0, 8).join(", ")}` : ""}; ${advice.length} suggestion${advice.length === 1 ? "" : "s"}${advice.length ? `: ${advice.join(", ")}` : ""})
Apply + Undo:         ${applied} · ${undone} · byte-identical: ${restored ? "yes" : "NO"}
Handoff answerable:   ${card.handoff.answerable}/${card.handoff.of}${card.handoff.missed.length ? ` (missing: ${card.handoff.missed.join(" | ")})` : ""} · ~${card.handoff.stateTokens} tokens
Stop hook:            p50 ${s.stopHook.p50} ms  p95 ${s.stopHook.p95} ms  (bar 150)  ${ok(s.stopHook.p95 < 150)}
SessionStart hook:    p50 ${s.sessionStartHook.p50} ms  p95 ${s.sessionStartHook.p95} ms
Quick gate unchanged: p50 ${s.quickGateUnchanged.p50} ms  p95 ${s.quickGateUnchanged.p95} ms  (bar ~1)  ${ok(s.quickGateUnchanged.p95 < 1.5)}
Quick gate changed:   p50 ${s.quickGateChanged.p50} ms  p95 ${s.quickGateChanged.p95} ms
Quick check run:      p50 ${s.quickCheckRun.p50} ms  p95 ${s.quickCheckRun.p95} ms  (bar 350)  ${ok(s.quickCheckRun.p95 < 350)}
Spend counter cached: p50 ${s.spendCached.p50} ms  p95 ${s.spendCached.p95} ms  (bar 10)  ${ok(s.spendCached.p95 < 10)}
Status read (panel):  p50 ${s.statusRead.p50} ms  p95 ${s.statusRead.p95} ms
Stop hook peak RSS:   ${rss ?? "not measured"} MB`);
if (!process.argv.includes("--keep")) rmSync(parent, { recursive: true, force: true });
else console.log(`Kept the dummy project at ${root}\nCORTEX_HOME=${process.env.CORTEX_HOME} CORTEX_CLAUDE_HOME=${process.env.CORTEX_CLAUDE_HOME}`);
