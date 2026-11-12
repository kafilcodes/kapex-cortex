import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteIfChanged } from "./util/atomic.ts";
import { installSkills } from "./skills.ts";
import { pluginInstalled } from "./core/plugin.ts";

/**
 * One-time, machine-level setup: the /cortex-* skills (in ~/.claude/skills without the plugin; with it, only OpenCode's
 * own copy), and removal of the MCP server older versions registered (v3 has none: no tool definitions
 * in every message).
 */
export function setup(opts: { node: string; cli: string }): string[] {
  const out: string[] = [];
  const home = process.env.HOME ?? homedir();
  const plugin = pluginInstalled(home);
  const opencode = existsSync(join(home, ".opencode", "bin", "opencode"));
  for (const f of installSkills(home, opts.node, opts.cli, { plugin, opencode })) out.push(`skill: ${f}`);
  if (plugin) out.push(`skills: provided by the Kapex Cortex plugin${opencode ? " (OpenCode gets its own copy in ~/.config/opencode/skills)" : ""}`);
  const claude = [join(home, ".local", "bin", "claude"), "claude"].find((c) => c === "claude" || existsSync(c))!;
  const rm = spawnSync(claude, ["mcp", "remove", "-s", "user", "kapex-cortex"], { encoding: "utf8", timeout: 20_000 });
  if (rm.status === 0) out.push("mcp: removed the old per-user kapex-cortex server");
  const ocFile = join(home, ".config", "opencode", "opencode.json");
  try {
    const cfg = JSON.parse(readFileSync(ocFile, "utf8")) as { mcp?: { servers?: Record<string, unknown> } };
    if (cfg.mcp?.servers?.["kapex-cortex"]) {
      delete cfg.mcp.servers["kapex-cortex"];
      atomicWriteIfChanged(ocFile, JSON.stringify(cfg, null, 2) + "\n");
      out.push(`mcp: removed kapex-cortex from ${ocFile}`);
    }
  } catch { /* no OpenCode config, or not plain JSON: leave it */ }
  return out;
}
