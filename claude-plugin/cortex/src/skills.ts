import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { claudeHome, cortexHome } from "./core/home.ts";
import { cmdline } from "./core/self.ts";
import { atomicWriteIfChanged } from "./util/atomic.ts";

const quote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

/** Global Claude Code skills (~/.claude/skills/<name>/SKILL.md). OpenCode reads the same folder. */
export function skillFiles(node: string, cli: string, runOverride?: string): Record<string, string> {
  // runOverride: the plugin's skills use `node "${CLAUDE_PLUGIN_ROOT}/…"`, which Claude Code fills in (no shell quoting)
  const run = runOverride ?? cmdline(node, cli);
  return {
    "cortex-resume": `---
name: cortex-resume
description: Continue work that Kapex Cortex handed off from another session, tool or model. Use when the user says resume, continue where I left off, pick up the handoff, or after hitting a usage limit in another tool.
---

1. In the current project, read \`.vault/STATE.md\`. If it doesn't exist, say so and ask what to continue. (The project's rules are already loaded: CLAUDE.md, .claude/rules and auto memory.)
2. Tell the user in two or three lines what you are picking up: the goal, the next action, the open items, and how old the packet is (its header has the time).
3. **Pinned for this session** holds what the session set out to do, the user's standing instructions in their own words and the decisions recorded at handoff: treat them as binding unless the user changes them. If it lists **memory notes flagged, not fixed yet**, those notes were loaded with your memory but may be wrong: don't rely on them, and tell the user in one line. **Session trail** is what earlier turns did, so don't redo finished work. **Where we left off** holds the last exchanges word for word, oldest first. Treat the newest reply as your own previous message: if it was a plan, a table or a list of findings, you already have it, so don't redo the work. **Active files**, **Last check** and **Open items** say what is in progress. Continue from **Next action** (or the open items). A turn-specific instruction in an earlier user message, such as "don't edit yet", applied to that turn; the user running /cortex-resume is the go-ahead.
4. If the goal is marked as from an earlier session, check \`git log -5 --oneline\` and the working tree first: it may already be done. Then ask what to continue.
5. Don't read old transcripts or \`.vault/private/\` files: the packet is what carries over.
6. You are done only when the commands under **Verify** pass. Run them and report the output.
`,
    "cortex-handoff": `---
name: cortex-handoff
description: Record a handoff so another tool or model can continue this work (Kapex Cortex). Use when the user says hand off, save state, I'm about to switch tools, or before a usage limit.
---

1. Decide, in one sentence each: the overall **goal** of the current work, and the concrete **next action** (which file, function or command comes next).
2. List the **decisions** of this session a new chat must not undo: choices made, approaches rejected and why, workarounds that were verified. One short sentence each, at most 6, most important first; skip any already written in CLAUDE.md or the rules. Cortex already pins the user's own instructions and the turn-by-turn trail, so don't repeat those.
3. Run exactly (one --decision per decision; leave them out if there are none):

   ${run} handoff --goal "<goal>" --next "<next action>" --decision "<decision 1>" --decision "<decision 2>"

4. Reply with the goal, the next action and the decisions, and tell the user: "Handoff saved to .vault/STATE.md. In a new chat (or OpenCode), run /cortex-resume."
`,
    "cortex-init": `---
name: cortex-init
description: Turn on Kapex Cortex in the current project (status strip and panel, lossless handoffs between chats and to OpenCode, Dreams that check Claude's memory against real sessions). Use when the user asks to enable Cortex.
---

1. Run, from the project root:

   ${run} init .

2. Show the user the list of changes it printed.
3. Explain in two lines: after every reply Cortex saves a handoff, so a new chat (or OpenCode, after a usage limit) continues with /cortex-resume; /kc opens the panel, where Dream checks CLAUDE.md, .claude/rules and auto memory against what really happened. Hooks take effect in new sessions.
`,
  };
}

/** Short aliases: /kc-i, /kc-r, /kc-h, /kc-a point at the full skills. */
export function shortSkills(full: Record<string, string>): Record<string, string> {
  const map: Record<string, [string, string]> = {
    "kc-i": ["cortex-init", "Turn on Kapex Cortex here (short for /cortex-init)."],
    "kc-r": ["cortex-resume", "Resume the handoff from another tool (short for /cortex-resume)."],
    "kc-h": ["cortex-handoff", "Save a handoff now (short for /cortex-handoff)."],
  };
  const out: Record<string, string> = {};
  for (const [name, [target, desc]] of Object.entries(map)) {
    const body = (full[target] ?? "").replace(/^---[\s\S]*?---\n/, "");
    out[name] = `---\nname: ${name}\ndescription: ${desc}\n---\n${body}`;
  }
  return out;
}

export function installSkills(home: string, node: string, cli: string): string[] {
  const written: string[] = [];
  const full = skillFiles(node, cli);
  // no short /kc-* aliases: they shadowed the panel's /kc in autocomplete
  for (const [name, body] of Object.entries(full)) {
    const path = join(home, ".claude", "skills", name, "SKILL.md");
    if (atomicWriteIfChanged(path, body)) written.push(path);
  }
  return written;
}

/** Skills older Cortex versions wrote that v3 has no command for. */
const RETIRED = ["cortex-approve"];

/**
 * Keep the copies of Cortex's skills in ~/.claude/skills (written by `kc setup` for OpenCode, which reads that folder)
 * as current as the plugin's. Claude Code prefers a personal skill over a plugin's of the same name, so an old copy
 * would answer /cortex-resume with an older version's steps. Only files Cortex wrote are touched (they say
 * "Kapex Cortex"); runs at session start, a few small reads when nothing changed.
 */
export function refreshOwnSkills(home = claudeHome()): string[] {
  const dir = join(home, "skills");
  const own = (f: string) => { try { return /Kapex Cortex/.test(readFileSync(f, "utf8")); } catch { return false; } };
  if (!existsSync(join(dir, "cortex-resume", "SKILL.md")) && !RETIRED.some((n) => existsSync(join(dir, n, "SKILL.md")))) return [];
  let install: { node?: string; cli?: string } = {};
  try { install = (JSON.parse(readFileSync(join(cortexHome(), "config.json"), "utf8")) as { install?: typeof install }).install ?? {}; } catch { /* no install recorded */ }
  if (!install.node) return [];
  const changed: string[] = [];
  for (const [name, body] of Object.entries(skillFiles(install.node, install.cli ?? ""))) {
    const f = join(dir, name, "SKILL.md");
    if (existsSync(f) && own(f) && atomicWriteIfChanged(f, body)) changed.push(f);
  }
  for (const name of RETIRED) {
    const f = join(dir, name, "SKILL.md");
    if (existsSync(f) && own(f)) { rmSync(join(dir, name), { recursive: true, force: true }); changed.push(f); }
  }
  return changed;
}
