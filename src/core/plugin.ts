import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeHome } from "./home.ts";
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

/** What Kapex Cortex itself adds to every message: the names and descriptions of its skills, which Claude Code lists
 * in each session (the same figure `claude plugin details kapex-cortex` reports, about 250 tokens), counted twice
 * when an older install also left copies in ~/.claude/skills. Hooks and the panel add nothing to the model's context. */
export function cortexFootprint(skillsDir = join(import.meta.dirname, "..", "..", "..", "skills"), userSkills = join(claudeHome(), "skills")): { tokens: number; skills: number; duplicates: number } {
  const dirs = [skillsDir, join(import.meta.dirname, "..", "skills"), join(import.meta.dirname, "..", "..", "claude-plugin", "skills")].filter((d) => existsSync(d));
  const cost = (f: string) => {
    try {
      const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(f, "utf8"))?.[1] ?? "";
      const name = /^name:\s*(.+)$/m.exec(head)?.[1] ?? "", desc = /^description:\s*(.+)$/m.exec(head)?.[1] ?? "";
      return name || desc ? Math.ceil((name.length + desc.length) / 3) + 12 : 0;
    } catch { return 0; }
  };
  let tokens = 0, skills = 0, duplicates = 0;
  for (const name of ["cortex-handoff", "cortex-init", "cortex-resume"]) {
    const own = dirs.map((d) => join(d, name, "SKILL.md")).find((f) => existsSync(f));
    if (own) { tokens += cost(own); skills++; }
    const copy = join(userSkills, name, "SKILL.md");
    if (existsSync(copy)) { tokens += cost(copy); duplicates++; }
  }
  return { tokens, skills, duplicates };
}

/** Is the Kapex Cortex plugin listed in this Claude Code folder's plugin list? (Test-safe: reads claudeHome().) */
export function pluginListed(claudeDir = claudeHome()): boolean {
  try {
    const j = JSON.parse(readFileSync(join(claudeDir, "plugins", "installed_plugins.json"), "utf8")) as { plugins?: Record<string, unknown> };
    return Object.keys(j.plugins ?? {}).some((k) => k.startsWith("kapex-cortex@"));
  } catch { return false; }
}
