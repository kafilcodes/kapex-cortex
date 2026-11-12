#!/usr/bin/env node
// Kapex Cortex verify gate (written by Cortex; safe to edit or delete).
// A Claude Code Stop hook: before Claude finishes a turn that changed files, run this project's check command. If it
// fails, Claude is sent back to fix it (`decision: "block"`), up to 3 times in a row; then it may stop and tell you.
// A plain `npm test` hook can't do this: a failing test exits 1, which Claude Code treats as done.
// Usage (in .claude/settings.json): { "type": "command", "command": "node", "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/cortex-verify-gate.mjs", "npm test"] }
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_BLOCKS = 3;
const command = process.argv.slice(2).join(" ").trim();
let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* no input: run anyway */ }
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
if (!command) process.exit(0);

// What changed, as a fingerprint: tracked and untracked changes with each file's size and time. Same as the last
// passing run (or nothing changed at all): nothing to check, finish at once.
const git = (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 10_000 });
const st = git(["status", "--porcelain=v1", "-uall"]);
if (st.status === 0 && !st.stdout.trim()) process.exit(0);
const lines = (st.stdout || "").split("\n").filter(Boolean);
const stamp = lines.map((l) => { const f = l.slice(3).replace(/^"|"$/g, ""); try { const s = statSync(join(root, f)); return `${l}:${s.size}:${s.mtimeMs}`; } catch { return l; } }).join("\n");
const fp = createHash("sha256").update(`${command}\n${stamp}`).digest("hex");
const dir = join(tmpdir(), "kapex-cortex-gate");
const file = join(dir, `${createHash("sha256").update(root).digest("hex").slice(0, 16)}.json`);
let state = { pass: "", blocks: 0, session: "" };
try { state = { ...state, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { /* first run */ }
const save = () => { try { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(state)); } catch { /* best effort */ } };
if (state.session !== input.session_id) { state.session = input.session_id ?? ""; state.blocks = 0; }
if (state.pass === fp) process.exit(0);

const r = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", timeout: 540_000, maxBuffer: 32 << 20 });
if (r.status === 0) { state.pass = fp; state.blocks = 0; save(); process.exit(0); }
const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
if (state.blocks >= MAX_BLOCKS) {
  state.blocks = 0; save();
  console.log(JSON.stringify({ systemMessage: `Cortex gate: \`${command}\` still fails after ${MAX_BLOCKS} tries; letting Claude stop. Check it yourself.` }));
  process.exit(0);
}
state.blocks += 1; save();
const why = r.error ? `could not run (${r.error.message})` : r.signal ? `was stopped (${r.signal})` : `failed (exit ${r.status})`;
console.log(JSON.stringify({ decision: "block", reason: `The project's check \`${command}\` ${why}. Fix the cause, run it again, and only then finish (try ${state.blocks} of ${MAX_BLOCKS}). Last lines:\n${tail}` }));
process.exit(0);
