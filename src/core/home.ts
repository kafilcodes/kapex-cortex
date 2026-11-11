import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Where things live outside the project. Tests point both homes at temp folders (CORTEX_HOME, CORTEX_CLAUDE_HOME),
 * so they never read the real ~/.cortex or ~/.claude.
 */
export const cortexHome = () => process.env.CORTEX_HOME ?? join(homedir(), ".cortex");
export const claudeHome = () => process.env.CORTEX_CLAUDE_HOME ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");

/** Claude Code names a project's folder after its path with every other character turned into "-". */
export const projectSlug = (dir: string) => resolve(dir).replace(/[^A-Za-z0-9]/g, "-");

/** The repository a folder belongs to (worktrees share their main repository's folder), else the folder itself. */
export function repoRoot(dir: string): string {
  const r = spawnSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", timeout: 1_500 });
  const common = r.status === 0 ? r.stdout.trim() : "";
  return common && /[\\/]\.git$/.test(common) ? dirname(common) : resolve(dir);
}

/** Claude Code's folder for this project: transcripts (*.jsonl) and, by default, auto memory. */
export const claudeProjectDir = (root: string) => join(claudeHome(), "projects", projectSlug(repoRoot(root)));

const readJson = (f: string): Record<string, unknown> => { try { return JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; } catch { return {}; } };
const expand = (p: string) => (p.startsWith("~/") || p === "~" ? join(homedir(), p.slice(2)) : p);

/** Claude Code settings that matter here, user < project < local (the later one wins). */
export function claudeSettings(root: string): { autoMemoryEnabled: boolean; autoMemoryDirectory: string | null } {
  let enabled: boolean | undefined;
  let directory: string | undefined;
  for (const f of [join(claudeHome(), "settings.json"), join(root, ".claude", "settings.json"), join(root, ".claude", "settings.local.json")]) {
    const s = readJson(f);
    if (typeof s.autoMemoryEnabled === "boolean") enabled = s.autoMemoryEnabled;
    if (typeof s.autoMemoryDirectory === "string" && s.autoMemoryDirectory.trim()) directory = s.autoMemoryDirectory.trim();
  }
  if (process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY === "1") enabled = false;
  return { autoMemoryEnabled: enabled ?? true, autoMemoryDirectory: directory ? expand(directory) : null };
}

/** Claude Code's auto memory folder for this project, and whether auto memory is on. */
export function autoMemory(root: string): { dir: string; enabled: boolean } {
  const s = claudeSettings(root);
  const custom = s.autoMemoryDirectory;
  return { dir: custom ? (isAbsolute(custom) ? custom : resolve(root, custom)) : join(claudeProjectDir(root), "memory"), enabled: s.autoMemoryEnabled };
}
