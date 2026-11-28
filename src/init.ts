import { opencodeInfo } from "./core/opencode.ts";
import { getAsset } from "node:sea";
import { cmdline, IS_BINARY } from "./core/self.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteIfChanged } from "./util/atomic.ts";
import { repoPaths } from "./core/paths.ts";
import { migrateV2 } from "./core/migrate.ts";

export interface InitOptions {
  node: string; // absolute path of the Node binary (hooks may run without the user's PATH)
  cli: string; // absolute path of src/cli.ts
  /** false when the Kapex Cortex plugin is installed: its own hooks run in every chat, so per-project copies are removed */
  claudeHooks?: boolean;
}

const quote = (s: string) => `"${s.replace(/(["\\$`])/g, "\\$1")}"`;

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} is not valid JSON (comments aren't supported yet). Fix or remove it, then re-run cortex init.`);
  }
}

function ensureLine(path: string, line: string): boolean {
  const cur = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (cur.split("\n").some((l) => l.trim() === line)) return false;
  writeFileSync(path, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + line + "\n");
  return true;
}

type HookEntry = { matcher?: string; hooks: { type: string; command: string; timeout?: number }[] };

/** Merge Cortex's hooks into .claude/settings.local.json without touching anyone else's entries. */
function mergeClaudeHooks(path: string, opts: InitOptions): boolean {
  if (opts.claudeHooks === false && !existsSync(path)) return false;
  const settings = readJson(path);
  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>;
  const mine = (cmd: string) => cmd.includes(" hook claude.") && cmd.includes("cortex");
  // v3 hooks; the v2-only ones (UserPromptSubmit, PostCompact, PostToolUseFailure) are removed if present
  const ours: Record<string, string | null> = {
    SessionStart: "sessionstart", Stop: "stop", StopFailure: "stopfailure", PreCompact: "precompact", SessionEnd: "sessionend",
    UserPromptSubmit: null, PostCompact: null, PostToolUseFailure: null,
  };
  for (const [event, name] of Object.entries(ours)) {
    const kept = (hooks[event] ?? [])
      .map((e) => ({ ...e, hooks: e.hooks.filter((h) => !mine(h.command)) }))
      .filter((e) => e.hooks.length > 0);
    if (opts.claudeHooks !== false && name) kept.push({ hooks: [{ type: "command", command: `${cmdline(opts.node, opts.cli)} hook claude.${name}`, timeout: 10 }] });
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  settings.hooks = hooks;
  return atomicWriteIfChanged(path, JSON.stringify(settings, null, 2) + "\n");
}

/** v2 added .vault/INVARIANTS.md to OpenCode's instructions; v3 has no such file, so it comes out again. */
function cleanOpencodeConfig(path: string): boolean {
  if (!existsSync(path)) return false;
  const cfg = readJson(path);
  if (!Array.isArray(cfg.instructions) || !cfg.instructions.includes(".vault/INVARIANTS.md")) return false;
  cfg.instructions = (cfg.instructions as string[]).filter((x) => x !== ".vault/INVARIANTS.md");
  return atomicWriteIfChanged(path, JSON.stringify(cfg, null, 2) + "\n");
}

/** The OpenCode plugin template: a file next to src/, or embedded in the single-file binary. */
function template(): string {
  if (IS_BINARY) return getAsset("opencode-plugin.ts", "utf8");
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "templates", "opencode-plugin.ts"), "utf8");
}

/** OpenCode 2.x plugin, from templates/opencode-plugin.ts with this machine's paths filled in. */
export function opencodePluginSource(opts: InitOptions): string {
  return template()
    .replace('"__NODE__"', JSON.stringify(opts.node))
    .replace('"__CLI__"', JSON.stringify(opts.cli));
}

export function opencodeCommands(opts: InitOptions): Record<string, string> {
  const cli = cmdline(opts.node, opts.cli);
  return {
    // what a user who hit Claude's limit types in OpenCode: the packet with its age, or a plain "no handoff here";
    // the shell include works in sh, dash, bash and zsh: GNU stat (-c) first, then BSD (-f); only digits count as a
    // time, and the packet prints whatever the age line did
    "cortex-resume":
      "---\ndescription: Continue from the Kapex Cortex handoff (.vault/STATE.md), e.g. after Claude's usage limit\n---\n" +
      "You are picking up work another session handed off (often Claude Code, after its usage limit). The packet below is authoritative.\n\n" +
      "!`f=.vault/STATE.md; if [ -s \"$f\" ]; then m=$(stat -c %Y \"$f\" 2>/dev/null) || m=$(stat -f %m \"$f\" 2>/dev/null); case \"$m\" in ''|*[!0-9]*) m= ;; esac; if [ -n \"$m\" ]; then echo \"(packet saved $(( ($(date +%s) - m) / 60 )) minutes ago)\"; fi; cat \"$f\"; else echo 'NO_HANDOFF: there is no .vault/STATE.md in this folder.'; fi`\n\n" +
      "1. If it says NO_HANDOFF: tell the user there is no handoff here (open OpenCode in the project folder Claude Code worked in, or save one there with /cortex-handoff), ask what to continue, and stop.\n" +
      "2. Tell the user in two or three lines: the goal, the next action, the open items, and how old the packet is. Older than a day: run `git log -5 --oneline` and `git status` first, the work may be done.\n" +
      "3. The **Mission contract**'s binding rules are the user's own words: follow them. Its **Steps** are what the user asked for, item by item: when you finish one and its check passes, tick it with the command its Steps line gives (`" + cli + " mission done <n> --mission <id>`; never one that isn't finished, and never edit STATE.md by hand), and name the steps you ticked in your reply. **Pinned for this session** holds the user's standing instructions and decisions: binding. In **Where we left off**, treat the newest reply as your own previous message: don't redo it. Notes listed as flagged may be wrong: don't rely on them.\n" +
      "4. If the words after this command only ask something, answer from the packet and don't edit anything. Otherwise, if the packet says **HANDOFF READY** (a usage limit stopped the other tool mid-task), continue from **Next action** (or the open items) at once; if it doesn't, end with the next action as one short question and wait for the user's go before you edit any file. A turn-specific instruction in an earlier message, such as \"don't edit yet\", applied to that turn only.\n" +
      "5. Don't read old transcripts or .vault/private/. Follow the project's own rules (AGENTS.md or CLAUDE.md).\n" +
      "6. You are done only when the commands under **Verify** pass; report their output. When you stop, Cortex saves the handoff back by itself (OpenCode 2), so Claude Code continues with /cortex-resume; on OpenCode 1.x, run /cortex-handoff before you stop. $ARGUMENTS\n",
    kc:
      "---\ndescription: Kapex Cortex status card (handoff, memory loaded every session, last memory check)\n---\n" +
      "!`\"$HOME/.local/bin/kc\" status --md 2>/dev/null || echo 'Kapex Cortex is not on here. Run kc i.'`\n\n" +
      "Show the card above to the user exactly as written, with nothing added.\n",
    "cortex-handoff":
      "---\ndescription: Record the goal and next action so another tool or model can continue (Kapex Cortex)\n---\n" +
      "Write a handoff for whoever continues this work. In one short sentence each, decide the overall **goal** and the concrete **next action** (file, function, command). " +
      `Then run exactly this command with your two sentences filled in:\n\n${cli} handoff --goal "<goal>" --next "<next action>"\n\n` +
      "Then reply with the two sentences and the path .vault/STATE.md. $ARGUMENTS\n",
  };
}

/**
 * Prefer the `node` found on PATH (unresolved, so a symlink keeps tracking upgrades) over
 * process.execPath, which may point inside another tool's private runtime.
 */
export function nodeOnPath(fallback: string): string {
  if (IS_BINARY) return fallback; // the single-file binary runs itself, not a Node found on PATH
  const exe = process.platform === "win32" ? "node.exe" : "node";
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (existsSync(candidate)) return candidate;
  }
  return fallback;
}

export function cortexInit(dir: string, opts: InitOptions): string[] {
  const root = resolve(dir);
  const p = repoPaths(root);
  const changes: string[] = [];
  const note = (did: boolean, what: string) => { if (did) changes.push(what); };

  for (const d of [p.vault, p.priv, p.cursors, p.states, join(p.priv, "locks"), join(root, ".opencode", "plugins")]) {
    mkdirSync(d, { recursive: true });
  }
  for (const n of migrateV2(p)) changes.push(n);
  if (!existsSync(p.marker)) { writeFileSync(p.marker, JSON.stringify({ version: 3 }, null, 2) + "\n"); changes.push(".vault/cortex.json created"); }

  note(ensureLine(join(root, ".gitignore"), ".vault/private/"), ".gitignore: .vault/private/");
  note(ensureLine(join(root, ".gitignore"), ".claude/settings.local.json"), ".gitignore: .claude/settings.local.json");
  note(ensureLine(join(root, ".gitignore"), ".opencode/plugins/kapex-cortex.ts"), ".gitignore: .opencode/plugins/kapex-cortex.ts");
  note(ensureLine(join(root, ".gitignore"), ".vault/STATE.md"), ".gitignore: .vault/STATE.md (changes every turn)");
  note(ensureLine(join(root, ".gitignore"), ".vault/dreams/"), ".gitignore: .vault/dreams/ (copies of your memory files)");

  note(mergeClaudeHooks(join(root, ".claude", "settings.local.json"), opts), opts.claudeHooks === false
    ? ".claude/settings.local.json: per-project Cortex hooks removed (the plugin runs them in every chat)"
    : ".claude/settings.local.json: SessionStart, Stop, StopFailure, PreCompact, SessionEnd hooks");
  note(cleanOpencodeConfig(join(root, "opencode.json")), "opencode.json: removed the old .vault/INVARIANTS.md instruction");
  note(atomicWriteIfChanged(join(root, ".opencode", "plugins", "kapex-cortex.ts"), opencodePluginSource(opts)), ".opencode/plugins/kapex-cortex.ts");
  // OpenCode 2 reads .opencode/commands (and still the old command/ folder); 1.x reads only command/
  const cmdDir = opencodeInfo(root).major === 1 ? "command" : "commands", other = cmdDir === "command" ? "commands" : "command";
  for (const [name, body] of Object.entries(opencodeCommands(opts))) {
    note(atomicWriteIfChanged(join(root, ".opencode", cmdDir, `${name}.md`), body), `.opencode/${cmdDir}/${name}.md`);
    // OpenCode 2 reads both folders: an older copy of Cortex's own command in the other one would shadow or repeat it
    const old = join(root, ".opencode", other, `${name}.md`);
    // only a file Cortex wrote (its front matter names it), never a command of yours that mentions Cortex
    try { if (/^---\r?\ndescription: [^\n]*Kapex Cortex/.test(readFileSync(old, "utf8"))) { rmSync(old); changes.push(`.opencode/${other}/${name}.md removed (an older copy)`); } } catch { /* none there */ }
  }

  return changes;
}
