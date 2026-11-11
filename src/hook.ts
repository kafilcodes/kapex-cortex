#!/usr/bin/env node
// The hook entry point. Claude Code waits for every hook, so this file loads only what a hook needs: not the
// CLI's status, Dream, setup or bench code (that alone cost ~50 ms of the 150 ms Stop budget per turn).
// `node cortex/src/hook.ts claude.stop --plugin`; `kc hook …` from an older install still lands here too.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { repoPaths, resolveProject } from "./core/paths.ts";
import { pluginHooksTurn } from "./core/plugin.ts";
import { IS_BINARY } from "./core/self.ts";
import { handleClaude } from "./hooks/claude.ts";
import { handleOpencode } from "./hooks/opencode.ts";

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** Keep the last 50 real hook durations (ms) for the panel's speed gauge. */
function recordHookTime(priv: string, ms: number): void {
  try {
    const f = `${priv}/hook-times.json`;
    let xs: number[] = [];
    try { xs = JSON.parse(readFileSync(f, "utf8")) as number[]; } catch { /* first */ }
    writeFileSync(f, JSON.stringify([...xs, ms].slice(-50)));
  } catch { /* never break a hook */ }
}

/** Hooks must never break the harness: any error is logged and the hook exits 0 with no output. */
export function runHook(name: string, fromPlugin = false): void {
  if (process.env.CORTEX_CLASSIFIER) return; // a model call Cortex started itself: nothing to capture
  const raw = readStdin();
  let input: Record<string, unknown> = {};
  try { input = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { /* keep empty */ }
  const start = String(input.cwd ?? input.directory ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const root = resolveProject(start);
  if (!root) return; // project not initialised: stay silent
  const p = repoPaths(root);
  const [harness, event] = name.toLowerCase().split(".");
  // the plugin's hooks and an older per-project install can both fire: the plugin wins, the copy steps aside
  if (harness === "claude" && !pluginHooksTurn(p, fromPlugin)) return;
  try {
    mkdirSync(p.priv, { recursive: true });
    const out = harness === "claude" ? handleClaude(event ?? "", p, input) : harness === "opencode" ? handleOpencode(event ?? "", p, input) : "";
    if (out) process.stdout.write(out);
    recordHookTime(p.priv, Math.round(process.uptime() * 1000)); // whole process: what the harness waits for
  } catch (err) {
    try { appendFileSync(p.errors, `${new Date().toISOString()} ${name} ${(err as Error).stack ?? err}\n`); } catch { /* nowhere to log */ }
  }
}

if (!IS_BINARY && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  runHook(args[0] ?? "", args.includes("--plugin"));
}
