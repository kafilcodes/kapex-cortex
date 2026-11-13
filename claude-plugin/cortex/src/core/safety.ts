import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { claudeHome } from "./home.ts";
import type { RepoPaths } from "./paths.ts";

/**
 * The safety check for autonomous runs (auto mode, long sessions): three things Claude Code's own docs recommend and
 * that are easy to miss. Read-only until you press Apply, and every Apply can be undone.
 *   1. Secrets: Read deny rules for .env files and ~/.ssh, so Claude's file tools never open them (deny rules are
 *      checked before auto mode's own safety check).
 *   2. Sandbox: on or off. Cortex never turns it on for you (it limits network and files for every shell command,
 *      which can break installs); it explains, and points to /sandbox.
 *   3. A check before Claude finishes: a Stop hook that runs the project's check and sends Claude back when it fails.
 *      A hook that just runs `npm test` can't: a failure exits 1, which Claude Code treats as done (only exit 2 or a
 *      `decision: "block"` keeps Claude working).
 */
export type SafetyFinding = { id: "secrets" | "sandbox" | "gate"; level: "ok" | "info" | "warn"; title: string; detail: string; fix?: "secrets" | "gate" }
export type SafetyView = { findings: SafetyFinding[]; command: string; undo: boolean }

type Settings = { permissions?: { deny?: string[] }; sandbox?: { enabled?: boolean; filesystem?: { denyRead?: string[] }; credentials?: { files?: { path: string; mode?: string }[] } }; hooks?: Record<string, { hooks?: { command?: string; args?: string[] }[] }[]> }
const read = (f: string): Settings => { try { return JSON.parse(readFileSync(f, "utf8")) as Settings; } catch { return {}; } };
const files = (root: string) => ({ user: join(claudeHome(), "settings.json"), project: join(root, ".claude", "settings.json"), local: join(root, ".claude", "settings.local.json") });
export const GATE_FILE = join(".claude", "hooks", "cortex-verify-gate.mjs");
export const SECRET_RULES = ["Read(.env)", "Read(.env.*)", "Read(!.env.example)", "Read(~/.ssh/**)", "Read(~/.aws/credentials)"];
const ENV_RULE = /^Read\((\.\/|\*\*\/)?(\.env|\.env\*|\.env\.\*|\*\.env)\)$/;
const SSH_RULE = /^Read\((~\/\.ssh(\/\*\*)?|\/\/.*\/\.ssh(\/\*\*)?)\)$/;
const CHECKISH = /\b(test|tests|check|lint|tsc|typecheck|pytest|vitest|jest|cargo (test|check)|go (test|vet)|ruff|mypy|eslint)\b/i;

/** The command that says "done" for this project: the handoff's Verify line, else package.json's check or test script. */
export function checkCommand(p: RepoPaths): string {
  try {
    const verify = /^## Verify[^\n]*\n- `([^`]+)`/m.exec(readFileSync(join(p.vault, "STATE.md"), "utf8"))?.[1];
    if (verify) return verify;
  } catch { /* no handoff yet */ }
  try {
    const scripts = (JSON.parse(readFileSync(join(p.root, "package.json"), "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
    if (scripts.check) return "npm run check";
    if (scripts.test && !/no test specified/.test(scripts.test)) return "npm test";
  } catch { /* not a Node project */ }
  return "";
}

/** Secret files at the top of the project (where they usually are). */
const secretsHere = (root: string) => { try { return readdirSync(root).filter((f) => /^\.env(\..+)?$/.test(f) && f !== ".env.example"); } catch { return []; } };

export function auditSafety(p: RepoPaths): SafetyView {
  const f = files(p.root);
  const all = [read(f.user), read(f.project), read(f.local)];
  const deny = all.flatMap((s) => s.permissions?.deny ?? []);
  const sandbox = all.reduce<Settings["sandbox"]>((a, s) => (s.sandbox ? { ...a, ...s.sandbox } : a), {});
  const stopHooks = all.flatMap((s) => ["Stop", "SubagentStop", "TaskCompleted"].flatMap((ev) => (s.hooks?.[ev] ?? []).flatMap((m) => m.hooks ?? [])));
  const cmd = (h: { command?: string; args?: string[] }) => [h.command ?? "", ...(h.args ?? [])].join(" ");
  const command = checkCommand(p);
  const findings: SafetyFinding[] = [];

  const env = deny.some((r) => ENV_RULE.test(r)), ssh = deny.some((r) => SSH_RULE.test(r));
  const here = secretsHere(p.root);
  findings.push(env && ssh
    ? { id: "secrets", level: "ok", title: "Secrets are off limits", detail: "Deny rules keep Claude's file tools away from .env files and ~/.ssh. They're checked before auto mode decides anything." }
    : { id: "secrets", level: here.length || !ssh ? "warn" : "info", title: here.length ? `${here.join(", ")} can be read` : "~/.ssh can be read", detail: `Add deny rules for ${[!env ? ".env files" : "", !ssh ? "~/.ssh" : ""].filter(Boolean).join(" and ")} (and ~/.aws/credentials). Deny rules are checked before auto mode's own safety check, so they hold even when it would allow the read.`, fix: "secrets" });

  const sbSsh = (sandbox?.filesystem?.denyRead ?? []).some((x) => /\.ssh|^~\/?$/.test(x)) || (sandbox?.credentials?.files ?? []).some((x) => /\.ssh/.test(x.path) && x.mode !== "allow");
  findings.push(sandbox?.enabled
    ? { id: "sandbox", level: sbSsh ? "ok" : "info", title: sbSsh ? "Sandbox on, ~/.ssh blocked" : "Sandbox on", detail: sbSsh ? "Shell commands and what they start (like npm test) can't read ~/.ssh." : "Shell commands still read most of your computer by default. Add ~/.ssh under sandbox.credentials to block it." }
    : { id: "sandbox", level: "info", title: "Sandbox off", detail: "Deny rules cover Claude's file tools, not shell commands: a script npm test starts can still read .env or ~/.ssh. Type /sandbox to turn it on (it also limits network, so try it on one project first)." });

  const gate = stopHooks.find((h) => cmd(h).includes("cortex-verify-gate"));
  const plain = stopHooks.find((h) => CHECKISH.test(cmd(h)));
  findings.push(gate
    ? { id: "gate", level: "ok", title: "Checks run before Claude finishes", detail: `\`${(gate.args ?? []).slice(1).join(" ") || "your check"}\` runs when Claude stops after changing files; a failure sends Claude back to fix it (up to 3 times).` }
    : plain
      ? { id: "gate", level: "warn", title: "A Stop hook runs checks but can't send Claude back", detail: `\`${cmd(plain).slice(0, 60)}\`: a failure exits 1, which Claude Code treats as done. Cortex's gate turns a failure into "keep working".`, ...(command ? { fix: "gate" as const } : {}) }
      : { id: "gate", level: command ? "warn" : "info", title: "Nothing checks the work before Claude finishes", detail: command ? `Add a gate that runs \`${command}\` when Claude stops after changing files, and sends it back if it fails.` : "No check command found (a Verify line in the handoff, or a check or test script). Add one, then the gate can run it.", ...(command ? { fix: "gate" as const } : {}) });

  return { findings, command, undo: existsSync(undoDir(p)) && readdirSync(undoDir(p)).length > 0 };
}

const undoDir = (p: RepoPaths) => join(p.priv, "safety-undo");

/** Save what an Apply is about to change (or that a file didn't exist), so `undoSafety` can put it back. */
function backup(p: RepoPaths, file: string): void {
  const dir = undoDir(p);
  mkdirSync(dir, { recursive: true });
  const name = file.slice(p.root.length + 1).replace(/[\\/]/g, "__");
  const keep = join(dir, name), gone = `${keep}.absent`;
  if (existsSync(keep) || existsSync(gone)) return; // the first backup since the last Undo is the one to restore
  if (existsSync(file)) copyFileSync(file, keep); else atomicWriteIfChanged(gone, file);
}

export function applySafety(p: RepoPaths, fix: "secrets" | "gate", command = checkCommand(p)): string {
  const f = files(p.root).project;
  backup(p, f);
  const s = read(f) as Settings & Record<string, unknown>;
  if (fix === "secrets") {
    const deny = s.permissions?.deny ?? [];
    s.permissions = { ...(s.permissions ?? {}), deny: [...deny, ...SECRET_RULES.filter((r) => !deny.includes(r))] };
    atomicWriteIfChanged(f, JSON.stringify(s, null, 2) + "\n");
    return `Added deny rules to .claude/settings.json: ${SECRET_RULES.join(", ")}.`;
  }
  if (!command) return "No check command found: add a Verify line to the handoff or a check/test script first.";
  const script = join(p.root, GATE_FILE);
  backup(p, script);
  const template = [join(import.meta.dirname, "..", "..", "templates", "verify-gate.mjs")].find((t) => existsSync(t));
  if (!template) return "The gate script is missing from this install.";
  mkdirSync(dirname(script), { recursive: true });
  atomicWriteIfChanged(script, readFileSync(template, "utf8"));
  const hooks = s.hooks ?? {};
  const stop = (hooks.Stop ?? []).filter((m) => !(m.hooks ?? []).some((h) => [h.command, ...(h.args ?? [])].join(" ").includes("cortex-verify-gate")));
  hooks.Stop = [...stop, { hooks: [{ type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/" + GATE_FILE.replace(/\\/g, "/"), command], timeout: 600 } as never] }];
  s.hooks = hooks;
  atomicWriteIfChanged(f, JSON.stringify(s, null, 2) + "\n");
  return `Added a Stop hook: \`${command}\` runs when Claude finishes after changing files (.claude/hooks/cortex-verify-gate.mjs). New chats pick it up.`;
}

/** Put back every file the Applies since the last Undo changed (or remove the ones they created). */
export function undoSafety(p: RepoPaths): string {
  const dir = undoDir(p);
  if (!existsSync(dir)) return "Nothing to undo.";
  const done: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = name.replace(/\.absent$/, "").replace(/__/g, "/");
    const target = join(p.root, rel);
    if (name.endsWith(".absent")) rmSync(target, { force: true }); else copyFileSync(join(dir, name), target);
    done.push(rel);
  }
  rmSync(dir, { recursive: true, force: true });
  return done.length ? `Undone: ${done.join(", ")} back as they were.` : "Nothing to undo.";
}
