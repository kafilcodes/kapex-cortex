import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoPaths } from "./paths.ts";

/**
 * Claude Code runs a plugin's hooks *and* the project's own hooks for the same event. Cortex can be in
 * both (the plugin, plus `.claude/settings.local.json` from an older `kc i`), so each turn would be
 * captured twice. The plugin's hooks stamp a marker; a per-project hook seeing a fresh marker steps aside.
 */
const FRESH_MS = 24 * 3_600_000;
const marker = (p: RepoPaths) => join(p.priv, "plugin-hooks");

/** True when this hook run should do the work. Cheap: one stat, and a write at most once an hour. */
export function pluginHooksTurn(p: RepoPaths, fromPlugin: boolean, now = Date.now()): boolean {
  const m = marker(p);
  let age = Infinity;
  try { age = now - statSync(m).mtimeMs; } catch { /* no marker yet */ }
  if (!fromPlugin) return age > FRESH_MS;
  if (age > 3_600_000) {
    try {
      if (existsSync(m)) utimesSync(m, now / 1000, now / 1000);
      else if (existsSync(p.priv)) writeFileSync(m, "Kapex Cortex plugin hooks are active for this project.\n");
    } catch { /* never break the hook */ }
  }
  return true;
}

/** Is the Kapex Cortex Claude Code plugin installed for this user? (Reads Claude Code's own plugin list.) */
export function pluginInstalled(home = process.env.HOME ?? process.env.USERPROFILE ?? ""): boolean {
  try {
    const j = JSON.parse(readFileSync(join(home, ".claude", "plugins", "installed_plugins.json"), "utf8")) as { plugins?: Record<string, unknown> };
    return Object.keys(j.plugins ?? {}).some((k) => k.startsWith("kapex-cortex@"));
  } catch {
    return false;
  }
}
