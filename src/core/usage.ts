import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RepoPaths } from "./paths.ts";

/**
 * Which skills, MCP servers and tools the user actually used in their recent Claude Code chats in this
 * project, read from Claude Code's own transcripts. Paired in the panel with Claude Code's exact context
 * breakdown (skills / MCP tools tokens), it shows what loads into every message but never gets used.
 * Cached per transcript (size + mtime), so only the chat that changed is re-read.
 */
export interface Usage { chats: number; skills: Record<string, number>; mcp: Record<string, number>; tools: Record<string, number> }
type Counts = Omit<Usage, "chats">;
const RECENT = 20;

function countFile(path: string): Counts {
  const c: Counts = { skills: {}, mcp: {}, tools: {} };
  const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1; };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.includes('"tool_use"')) continue; // most lines carry no tool call: skip the JSON parse
    let e: { type?: string; message?: { content?: unknown } };
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content as { type?: string; name?: string; input?: { skill?: string } }[]) {
      if (b.type !== "tool_use" || !b.name) continue;
      bump(c.tools, b.name);
      if (b.name === "Skill" && b.input?.skill) bump(c.skills, b.input.skill);
      if (b.name.startsWith("mcp__")) bump(c.mcp, b.name.split("__")[1] ?? b.name);
    }
  }
  return c;
}

export function toolUsage(p: RepoPaths, home = homedir()): Usage {
  const dir = join(home, ".claude", "projects", p.root.replace(/[^A-Za-z0-9]/g, "-"));
  const out: Usage = { chats: 0, skills: {}, mcp: {}, tools: {} };
  if (!existsSync(dir)) return out;
  const cacheFile = join(p.priv, "usage-cache.json");
  let cache: Record<string, { sig: string; c: Counts }> = {};
  try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch { /* first run */ }
  const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, st: statSync(join(dir, f)) }))
    .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).slice(0, RECENT);
  const next: typeof cache = {};
  for (const { f, st } of files) {
    const sig = `${st.size}:${st.mtimeMs}`;
    const c = cache[f]?.sig === sig ? cache[f]!.c : countFile(join(dir, f));
    next[f] = { sig, c };
    out.chats++;
    for (const k of ["skills", "mcp", "tools"] as const) for (const [n, v] of Object.entries(c[k])) out[k][n] = (out[k][n] ?? 0) + v;
  }
  atomicWriteIfChanged(cacheFile, JSON.stringify(next));
  return out;
}
