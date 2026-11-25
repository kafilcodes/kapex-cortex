#!/usr/bin/env node
// The hook entry point. Claude Code waits for every hook, so this file loads only what a hook needs: not the
// CLI's status, Dream, setup or bench code (that alone cost ~50 ms of the 150 ms Stop budget per turn).
// `node cortex/src/hook.ts claude.stop --plugin`; `kc hook …` from an older install still lands here too.
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { atomicWriteIfChanged } from "./util/atomic.ts";
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
    try { const j: unknown = JSON.parse(readFileSync(f, "utf8")); if (Array.isArray(j)) xs = j.filter((x): x is number => typeof x === "number" && Number.isFinite(x)); } catch { /* first, or a torn file */ }
    // atomic: two chats ending a turn at once never leave half a file (the panel would read no times at all)
    atomicWriteIfChanged(f, JSON.stringify([...xs, ms].slice(-50)), { durable: false });
  } catch { /* never break a hook */ }
}

/** Hooks must never break the harness: any error is logged and the hook exits 0 with no output. */
export function runHook(name: string, fromPlugin = false): void {
  if (process.env.CORTEX_CLASSIFIER) return; // a model call Cortex started itself: nothing to capture
  const raw = readStdin();
  let input: Record<string, unknown> = {};
  try { const j: unknown = raw.trim() ? JSON.parse(raw) : {}; input = j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {}; } catch { /* keep empty */ }
  const start = String(input.cwd ?? input.directory ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  let p: ReturnType<typeof repoPaths>;
  const [harness, event] = name.toLowerCase().split(".");
  try {
    const root = resolveProject(start);
    if (!root) return; // project not initialised: stay silent
    p = repoPaths(root);
    // the plugin's hooks and an older per-project install can both fire: the plugin wins, the copy steps aside
    if (harness === "claude" && !pluginHooksTurn(p, fromPlugin)) return;
  } catch { return; } // a folder Cortex can't read: no hook output, exit 0
  try {
    mkdirSync(p.priv, { recursive: true });
    const out = harness === "claude" ? handleClaude(event ?? "", p, input) : harness === "opencode" ? handleOpencode(event ?? "", p, input) : "";
    if (out) process.stdout.write(out);
    // whole process, what the harness waits for: the reply-end hook only (Stop; OpenCode's idle), the one the panel's
    // "time after each reply" and its 150 ms target are about. Other events (a compaction's snapshot) are not replies.
    if (event === "stop" || event === "idle" || event === "session.idle") recordHookTime(p.priv, Math.round(process.uptime() * 1000));
  } catch (err) {
    try { appendFileSync(p.errors, `${new Date().toISOString()} ${name} ${(err as Error).stack ?? err}\n`); } catch { /* nowhere to log */ }
  }
}

/** Whether this file is the program being run. Compared as real paths: under a symlinked folder (macOS /var →
 * /private/var, a vault or projects folder linked elsewhere) the two spellings differ, and before v4.5 every hook then
 * silently did nothing, with no handoff and no error anywhere. */
function isEntry(): boolean {
  if (IS_BINARY || !process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  if (here === process.argv[1]) return true;
  try { return realpathSync(here) === realpathSync(process.argv[1]); } catch { return false; }
}

if (isEntry()) {
  // the hard rule: a hook never breaks the harness, so even an error nothing caught exits 0
  process.on("uncaughtException", () => process.exit(0));
  const args = process.argv.slice(2);
  runHook(args[0] ?? "", args.includes("--plugin"));
}
