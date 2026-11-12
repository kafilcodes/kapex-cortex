import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { repoPaths, type RepoPaths } from "../src/core/paths.ts";

// Isolation: tests (and every hook process they spawn, which inherit this env) must never see the
// user's real ~/.cortex config or vault. Set before anything else runs.
process.env.CORTEX_HOME = mkdtempSync(join(tmpdir(), "cortex-test-home-"));
process.env.CORTEX_CLAUDE_HOME = mkdtempSync(join(tmpdir(), "cortex-test-claude-")); // never the real ~/.claude
process.env.CORTEX_NO_NAME_DETECT = "1"; // tests never read the real account name
process.env.CORTEX_NO_NOTIFY = "1";
process.env.CORTEX_OPENCODE_HOME = mkdtempSync(join(tmpdir(), "cortex-test-opencode-")); // never the real ~/.config/opencode

export const ROOT = resolve(import.meta.dirname, "..");
export const CLI = join(ROOT, "src", "cli.ts");

/** A fresh project with Cortex on. */
export function tmpRepo(): RepoPaths {
  const root = mkdtempSync(join(tmpdir(), "cortex-test-"));
  const p = repoPaths(root);
  mkdirSync(p.priv, { recursive: true });
  writeFileSync(p.marker, JSON.stringify({ version: 3 }));
  return p;
}

export function claudeEntry(o: Record<string, unknown>): string {
  return JSON.stringify(o) + "\n";
}

export function userLine(uuid: string, content: unknown, extra: Record<string, unknown> = {}): string {
  return claudeEntry({ type: "user", uuid, timestamp: "2026-11-07T10:00:00Z", message: { role: "user", content }, ...extra });
}
