import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cortexHome } from "./core/home.ts";

/**
 * Zero-friction onboarding: put `kc` and `cortex` on PATH, and remember where this install lives so panels
 * and plugins can call it.
 */

/** Small launchers in ~/.local/bin (already on PATH for Claude Code installs). Never overwrites a foreign file. */
export function installShims(node: string, cli: string, home = homedir(), platform = process.platform): string[] {
  const bin = join(home, ".local", "bin");
  mkdirSync(bin, { recursive: true });
  const out: string[] = [];
  const win = platform === "win32"; // Windows: a .cmd launcher (cmd and PowerShell both run it)
  for (const name of ["kc", "cortex"]) {
    const path = join(bin, win ? `${name}.cmd` : name);
    const body = win
      ? `@echo off\r\nrem Kapex Cortex launcher (written by kc setup)\r\n"${node}"${cli ? ` "${cli}"` : ""} %*\r\n`
      : `#!/bin/sh\n# Kapex Cortex launcher (written by kc setup)\nexec "${node}"${cli ? ` "${cli}"` : ""} "$@"\n`;
    if (existsSync(path) && !readFileSync(path, "utf8").includes("Kapex Cortex launcher")) { out.push(`skipped ${path} (another program owns it)`); continue; }
    if (existsSync(path) && readFileSync(path, "utf8") === body) continue;
    writeFileSync(path, body);
    if (!win) chmodSync(path, 0o755);
    out.push(path);
  }
  return out;
}

export function rememberInstall(node: string, cli: string): void {
  const file = join(cortexHome(), "config.json");
  let cfg: Record<string, unknown> = {};
  try { cfg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { /* new */ }
  cfg.install = { node, cli };
  mkdirSync(cortexHome(), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
}

export const isSetUp = () => { try { return !!(JSON.parse(readFileSync(join(cortexHome(), "config.json"), "utf8")) as { install?: unknown }).install; } catch { return false; } };
