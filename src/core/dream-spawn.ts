import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { readEpisodes } from "./episodes.ts";
import type { RepoPaths } from "./paths.ts";
import { readPrefs } from "./prefs.ts";
import { argv, IS_BINARY } from "./self.ts";

/**
 * Start a Dream in the background and return at once (a Dream takes a minute or two; a hook or a panel button
 * must not wait). Kept apart from dream.ts so hooks never load the Dream code, its prompt or the model backends.
 */
export function spawnDream(p: RepoPaths, cli: string, node = process.execPath, extra: string[] = []): void {
  if (process.env.CORTEX_CLASSIFIER) return; // a model call Cortex started itself: never start another
  try {
    spawn(node, argv(node, IS_BINARY ? "" : cli, "dream", "run", ...extra).slice(1), { cwd: p.root, detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch { /* best effort */ }
}

/** Start the free Quick check in the background (the Stop hook calls this only when something it reads changed). */
export function spawnQuick(p: RepoPaths, cli: string, node = process.execPath): void {
  if (process.env.CORTEX_CLASSIFIER) return;
  try {
    spawn(node, argv(node, IS_BINARY ? "" : cli, "dream", "quick").slice(1), { cwd: p.root, detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch { /* best effort */ }
}

/** The CLI to start from a hook: hooks run from claude-plugin/cortex/hook.mjs (or src/hook.ts), the CLI is cortex/src/cli.ts. */
export function cliFromHook(script = process.argv[1] ?? ""): string {
  if (/hook\.mjs$/.test(script)) return join(dirname(script), "src", "cli.ts");
  if (/hook\.ts$/.test(script)) return join(dirname(script), "cli.ts");
  return script;
}

/** Dream by itself after a session ends: only if you switched it on, at most once a day, and after 3 new chats. */
export function autoDreamDue(p: RepoPaths, now = Date.now()): boolean {
  const prefs = readPrefs(p);
  if (!prefs.autoDream || prefs.dreamBackend === "off") return false;
  const dir = join(p.vault, "dreams");
  const last = existsSync(dir) ? readdirSync(dir).filter((n) => /^[0-9A-Z]{26}$/.test(n)).sort().at(-1) : undefined;
  const lastAt = last ? decodeTime(last) : 0;
  if (now - lastAt < 86_400_000) return false;
  return new Set(readEpisodes(p, 200).filter((e) => Date.parse(e.end) > lastAt).map((e) => e.session)).size >= 3;
}

/** The time inside a ULID (its first 10 characters, Crockford base32). */
function decodeTime(id: string): number {
  const A = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  return [...id.slice(0, 10)].reduce((t, c) => t * 32 + A.indexOf(c), 0);
}
