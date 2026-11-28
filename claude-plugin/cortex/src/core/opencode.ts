import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { cortexHome } from "./home.ts";

/**
 * OpenCode as the place to carry on when Claude's usage limit is reached: is it installed, which major version (the
 * plugin that hands the work back is OpenCode 2's format), and is this project set up for it (/cortex-resume there,
 * the plugin). Cheap: file checks, and `opencode --version` only when the program itself changed (cached by its
 * path and modified time in ~/.cortex, never in a hook's hot path).
 */
export interface OpencodeInfo { installed: boolean; version: string | null; major: number | null; plugin: boolean; command: boolean }

// Windows: PATH is ";"-separated and the program is opencode.exe or an npm opencode.cmd shim
const NAMES = () => process.platform === "win32" ? ["opencode.exe", "opencode.cmd", "opencode"] : ["opencode"];
const CANDIDATES = () => [join(homedir(), ".opencode", "bin"), "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin"),
  ...(process.env.PATH ?? "").split(delimiter).filter((d) => isAbsolute(d))] // never a relative PATH entry (".")
  .flatMap((d) => NAMES().map((n) => join(d, n)));

/** The opencode program, if any: the usual install folders first, then PATH. */
export function opencodeBin(): string | null {
  for (const f of CANDIDATES()) { try { if (statSync(f).isFile()) return f; } catch { /* not here */ } }
  return null;
}

/** "opencode v2.2.5" → "2.2.5"; anything without a version number → null. */
export const parseVersion = (out: string): string | null => /\bv?(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? null;

function version(bin: string): string | null {
  const cache = join(cortexHome(), "opencode-version.json");
  let mtime = 0;
  try { mtime = statSync(bin).mtimeMs; } catch { return null; }
  try { const c = JSON.parse(readFileSync(cache, "utf8")) as { bin?: string; mtime?: number; version?: string | null }; if (c.bin === bin && c.mtime === mtime) return c.version ?? null; } catch { /* first look */ }
  const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 2_000, shell: process.platform === "win32" && /\.cmd$/i.test(bin), windowsHide: true });
  const v = r.status === 0 ? parseVersion(`${r.stdout} ${r.stderr}`) : null;
  // only a version read is kept (a cold start that timed out asks again next time, never caches "unknown")
  if (v) try { mkdirSync(cortexHome(), { recursive: true }); writeFileSync(cache, JSON.stringify({ bin, mtime, version: v })); } catch { /* read-only home: ask again next time */ }
  return v;
}

export function opencodeInfo(root: string): OpencodeInfo {
  const bin = opencodeBin();
  const v = bin ? version(bin) : null;
  const major = v ? Number(v.split(".")[0]) : null;
  return {
    installed: !!bin, version: v, major: Number.isFinite(major) ? major : null,
    plugin: existsSync(join(root, ".opencode", "plugins", "kapex-cortex.ts")),
    // OpenCode 2 reads .opencode/commands; 1.x read the singular command/ folder (2 still reads it too)
    command: existsSync(join(root, ".opencode", "commands", "cortex-resume.md")) || existsSync(join(root, ".opencode", "command", "cortex-resume.md")),
  };
}
