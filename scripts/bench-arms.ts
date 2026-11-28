// 3-arm behavioural benchmark: what a NEW chat knows about earlier work, native Claude Code vs Cortex.
//   Arm A  native new chat (auto memory on)          claude -p "<probe>"
//   Arm B  native resume of the same conversation    claude -p --resume <id> "<probe>"
//   Arm C  Cortex: new chat + /cortex-resume          claude -p "/cortex-resume", then --resume that chat "<probe>"
// Isolation: every call runs with --setting-sources project,local (no user plugins, user hooks or ~/.claude/CLAUDE.md);
// Arm C adds this checkout's plugin with --plugin-dir and a throwaway CORTEX_HOME. Session 1 is the same 3 turns for
// both projects (one without Cortex for A and B, one with Cortex for C). Scoring is deterministic: 7 facts, most of
// which the code can't reveal (why a rule exists, why an approach was dropped, the next task).
// Usage: node scripts/bench-arms.ts [trials=2] [model=haiku]   (spends plan usage: about 10 claude -p calls a trial)
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const TRIALS = Number(process.argv[2] ?? 2), MODEL = process.argv[3] ?? "haiku";
const TOOLS = "Read,Edit,Write,Glob,Grep,Bash(node:*),Bash(ls:*),Bash(cat:*)";
const TURNS = [
  "Goal: add a divide(a, b) function to calc.js, with tests in calc.test.js using node:test. Rules: never add npm dependencies, because this project must stay zero-dependency so it runs offline on the CI box. Always run `node --test` before you say you're done.",
  "Change of plan for divide by zero: don't throw an exception. We tried throwing before and the callers crashed, so return null instead. Decision: results are rounded to 2 decimal places.",
  "Good. Stop here for today. Next time: add a modulo function the same way.",
];
const PROBE = "Don't edit anything. Answer in a short numbered list: 1) What is the next task in this project? 2) What rules must you follow here, and why? 3) What approach was tried and dropped, why, and what replaced it? 4) What rounding decision was made? 5) What command must pass before you say you're done?";
const FACTS: [string, RegExp][] = [
  ["next task: modulo", /modulo/i], ["rule: no npm dependencies", /depend/i], ["why: offline CI", /offline|\bCI\b/i],
  ["dropped: throwing", /thr(?:ow|ew|own)|exception/i], ["why dropped: callers crashed", /crash/i], ["rounding: 2 decimals", /2 decimal|two decimal/i],
  ["check: node --test", /node --test/i],
];

type Run = { text: string; session: string; tokens: number; cost: number; ms: number; ok: boolean };
function claude(cwd: string, prompt: string, o: { resume?: string; cortex?: string } = {}): Run {
  const args = ["-p", "--setting-sources", "project,local", "--model", MODEL, "--output-format", "json", "--permission-mode", "acceptEdits", "--allowedTools", TOOLS, "--max-turns", "12"];
  if (o.resume) args.push("--resume", o.resume);
  if (o.cortex) args.push("--plugin-dir", join(ROOT, "claude-plugin"));
  args.push(prompt);
  const t = Date.now();
  const r = spawnSync("claude", args, { cwd, encoding: "utf8", timeout: 300_000, maxBuffer: 32 << 20, env: { ...process.env, CORTEX_NO_NOTIFY: "1", ...(o.cortex ? { CORTEX_HOME: o.cortex } : {}) } }); // a benchmark never notifies
  try {
    const j = JSON.parse(r.stdout);
    const u = j.usage ?? {};
    return { text: String(j.result ?? ""), session: String(j.session_id ?? ""), tokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cost: Number(j.total_cost_usd ?? 0), ms: Date.now() - t, ok: !j.is_error };
  } catch { return { text: `(no JSON) ${r.stderr.slice(0, 300)}`, session: "", tokens: 0, cost: 0, ms: Date.now() - t, ok: false }; }
}
function project(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "calc", type: "commonjs", private: true }, null, 2));
  writeFileSync(join(dir, "calc.js"), "function add(a, b) { return a + b }\nmodule.exports = { add }\n");
  writeFileSync(join(dir, "calc.test.js"), "const test = require('node:test')\nconst assert = require('node:assert')\nconst { add } = require('./calc')\ntest('add', () => assert.equal(add(2, 3), 5))\n");
  const g = (...a: string[]) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main"); g("add", "-A"); g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
}
const score = (text: string) => FACTS.map(([name, re]) => ({ name, hit: re.test(text) }));

const work = realpathSync(mkdtempSync(join(tmpdir(), "cortex-arms-"))); // Claude Code keys its data by the real path (/private/var/…)
const out: Record<string, unknown>[] = [];
try {
  for (let trial = 1; trial <= TRIALS; trial++) {
    const nat = join(work, `t${trial}-native`), cx = join(work, `t${trial}-cortex`), home = join(work, `t${trial}-cortex-home`);
    project(nat); project(cx); mkdirSync(home, { recursive: true });
    spawnSync(process.execPath, [join(ROOT, "src/cli.ts"), "init", cx], { encoding: "utf8", env: { ...process.env, CORTEX_HOME: home, CORTEX_NO_NOTIFY: "1" } });
    // session 1, the same three turns in both projects
    const s1: Record<string, Run[]> = { native: [], cortex: [] };
    for (const [key, dir, cortex] of [["native", nat, undefined], ["cortex", cx, home]] as const) {
      let id = "";
      for (const turn of TURNS) { const r = claude(dir, turn, { resume: id || undefined, cortex }); s1[key]!.push(r); id = r.session || id; }
    }
    const nativeId = s1.native!.at(-1)!.session;
    const A = claude(nat, PROBE);
    const B = claude(nat, PROBE, { resume: nativeId });
    const C0 = claude(cx, "/cortex-resume", { cortex: home });
    const C = claude(cx, PROBE, { resume: C0.session, cortex: home });
    const memA = (() => { try { return spawnSync("ls", ["-1", join(process.env.HOME!, ".claude/projects", nat.replace(/[^A-Za-z0-9]/g, "-"), "memory")], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean); } catch { return []; } })();
    const state = (() => { try { return readFileSync(join(cx, ".vault/STATE.md"), "utf8").length; } catch { return 0; } })();
    for (const [arm, r, extra] of [["A native new chat", A, null], ["B native --resume", B, null], ["C Cortex /cortex-resume", C, C0]] as const) {
      const sc = score(r.text);
      out.push({ trial, arm, facts: sc.filter((x) => x.hit).length, of: FACTS.length, missed: sc.filter((x) => !x.hit).map((x) => x.name), probeTokens: r.tokens, costUsd: +(r.cost + (extra?.cost ?? 0)).toFixed(4), seconds: Math.round((r.ms + (extra?.ms ?? 0)) / 1000), ok: r.ok && (extra?.ok ?? true), answer: r.text.slice(0, 900) });
    }
    out.push({ trial, session1: { nativeCost: +s1.native!.reduce((a, r) => a + r.cost, 0).toFixed(4), cortexCost: +s1.cortex!.reduce((a, r) => a + r.cost, 0).toFixed(4), allOk: [...s1.native!, ...s1.cortex!].every((r) => r.ok) }, autoMemoryFiles: memA, stateMdChars: state, resumeReply: C0.text.slice(0, 400) });
    // what each arm's project folder holds in Claude Code's own data: removed below with `claude purge`
    for (const d of [nat, cx]) out.push({ trial, purge: d });
  }
} finally {
  // the main checkout's .git (in a worktree .git is a file): results survive scratch wipes and never get committed
  const dev = join(resolve(ROOT, spawnSync("git", ["-C", ROOT, "rev-parse", "--git-common-dir"], { encoding: "utf8" }).stdout.trim()), "cortex-dev");
  const res = join(dev, `bench-arms-${new Date().toISOString().slice(0, 16).replace(/:/g, "")}.json`);
  mkdirSync(dev, { recursive: true });
  writeFileSync(res, JSON.stringify(out, null, 2));
  for (const x of out) if (typeof x.purge === "string") spawnSync("claude", ["purge", "-y", x.purge], { encoding: "utf8" });
  rmSync(work, { recursive: true, force: true });
  console.log(`results: ${res}`);
  for (const x of out) if (x.arm) console.log(`trial ${x.trial} · ${x.arm}: ${x.facts}/${x.of} facts · probe ${x.probeTokens} tokens · $${x.costUsd} · ${x.seconds}s${(x.missed as string[]).length ? ` · missed: ${(x.missed as string[]).join(", ")}` : ""}${x.ok ? "" : " · ERROR"}`);
}
