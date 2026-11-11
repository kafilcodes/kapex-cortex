import { readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RepoPaths } from "./paths.ts";

/**
 * Parking an MCP server for this project: Claude Code's own switch, the same per-project `disabledMcpServers` list in
 * ~/.claude.json that /mcp writes (code.claude.com/docs/en/mcp), under the name /mcp shows. It takes effect in the next
 * chat (this chat keeps its tools, so its prompt cache stays intact) and is undone the same way. Cortex keeps its own
 * record of what it parked (.vault/private/parked.json), so Undo only touches those, and a server you turn back on
 * is never parked by itself again.
 * Claude Code rewrites ~/.claude.json often: the write is read-modify-rename and checked right after; the panel
 * also says if a parked server was put back or still loads.
 */
export interface Parked { name: string; at: string; auto: boolean; tokens: number }
export interface ParkLedger { servers: Parked[]; keepOn: string[] }
export interface ParkView extends ParkLedger { disabled: string[] }

export const claudeJson = () => process.env.CORTEX_CLAUDE_HOME ? join(process.env.CORTEX_CLAUDE_HOME, ".claude.json") : join(process.env.CLAUDE_CONFIG_DIR ?? homedir(), ".claude.json");
const ledgerPath = (p: RepoPaths) => join(p.priv, "parked.json");

export function readLedger(p: RepoPaths): ParkLedger {
  try { const j = JSON.parse(readFileSync(ledgerPath(p), "utf8")) as ParkLedger; return { servers: j.servers ?? [], keepOn: j.keepOn ?? [] }; } catch { return { servers: [], keepOn: [] }; }
}
const saveLedger = (p: RepoPaths, l: ParkLedger) => writeFileSync(ledgerPath(p), JSON.stringify(l, null, 1));

type Cfg = { projects?: Record<string, { disabledMcpServers?: string[] } & Record<string, unknown>> } & Record<string, unknown>;
function readCfg(): Cfg | null {
  try { return JSON.parse(readFileSync(claudeJson(), "utf8")) as Cfg; } catch { return null; }
}

/** The servers Claude Code skips in this project, as its own config says right now. */
export function disabledHere(p: RepoPaths): string[] {
  return readCfg()?.projects?.[p.root]?.disabledMcpServers ?? [];
}

/** Change this project's disabledMcpServers, then read it back. Returns what the file says afterwards. */
function writeDisabled(p: RepoPaths, change: (cur: string[]) => string[]): string[] | string {
  const cfg = readCfg();
  if (!cfg) return "Couldn't read Claude Code's settings (~/.claude.json).";
  const proj = (cfg.projects ??= {})[p.root] ??= {};
  proj.disabledMcpServers = [...new Set(change(proj.disabledMcpServers ?? []))];
  const file = claudeJson(), tmp = join(dirname(file), `.claude.json.cortex-${process.pid}`);
  let mode = 0o600;
  try { mode = statSync(file).mode & 0o777; } catch { /* keep private */ }
  writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode }); // same permissions: the file holds account details
  renameSync(tmp, file); // atomic: Claude Code never reads half a file
  return disabledHere(p);
}

export function park(p: RepoPaths, names: string[], o: { auto?: boolean; tokens?: Record<string, number> } = {}, now = new Date()): string {
  const led = readLedger(p);
  const pick = names.filter((n) => n && !(o.auto && led.keepOn.includes(n)));
  if (!pick.length) return "Nothing to park.";
  const after = writeDisabled(p, (cur) => [...cur, ...pick]);
  if (typeof after === "string") return after;
  const ok = pick.filter((n) => after.includes(n));
  led.servers = [...led.servers.filter((s) => !ok.includes(s.name)), ...ok.map((name) => ({ name, at: now.toISOString(), auto: !!o.auto, tokens: o.tokens?.[name] ?? 0 }))];
  saveLedger(p, led);
  return ok.length === pick.length ? `Parked ${ok.join(", ")} from your next chat on.` : `Parked ${ok.join(", ") || "nothing"}; Claude Code's settings changed under us for ${pick.filter((n) => !ok.includes(n)).join(", ")}. Try again, or use /mcp.`;
}

export function unpark(p: RepoPaths, names: string[]): string {
  const led = readLedger(p);
  const after = writeDisabled(p, (cur) => cur.filter((n) => !names.includes(n)));
  if (typeof after === "string") return after;
  // turned back on by you: never parked by itself again
  led.keepOn = [...new Set([...led.keepOn, ...names.filter((n) => led.servers.some((s) => s.name === n && s.auto))])];
  led.servers = led.servers.filter((s) => !names.includes(s.name));
  saveLedger(p, led);
  const left = names.filter((n) => after.includes(n));
  return left.length ? `Still off: ${left.join(", ")}. Turn ${left.length === 1 ? "it" : "them"} on in /mcp.` : `Back on from your next chat: ${names.join(", ")}.`;
}

export function parkView(p: RepoPaths): ParkView {
  return { ...readLedger(p), disabled: disabledHere(p) };
}
