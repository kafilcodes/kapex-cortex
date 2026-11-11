import { getAsset } from "node:sea";
import { cmdline, IS_BINARY } from "./core/self.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    "cortex-resume":
      "---\ndescription: Continue from the Kapex Cortex handoff packet (.vault/STATE.md)\n---\n" +
      "You are resuming work handed off from another session or tool. The packet below is authoritative.\n\n" +
      "!`cat .vault/STATE.md 2>/dev/null || echo 'No .vault/STATE.md yet.'`\n\n" +
      "Continue from **Next action** (or, if it only says to continue, from the plan in the last assistant message). " +
      "The verbatim last user message is context: a turn-specific instruction in it such as \"don't edit yet\" applied to that turn, and running this command is the go-ahead. " +
      "Follow the project's own rules (AGENTS.md or CLAUDE.md). You are done only when the Verify commands pass; report their output. $ARGUMENTS\n",
    kc:
      "---\ndescription: Kapex Cortex status card (handoff, memory loaded every session, last Dream)\n---\n" +
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
  for (const [name, body] of Object.entries(opencodeCommands(opts))) {
    note(atomicWriteIfChanged(join(root, ".opencode", "commands", `${name}.md`), body), `.opencode/commands/${name}.md`);
  }

  return changes;
}
