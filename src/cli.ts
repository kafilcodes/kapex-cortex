#!/usr/bin/env node
import { IS_BINARY } from "./core/self.ts";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nearbyProjects, repoPaths, resolveProject } from "./core/paths.ts";
import { pluginHooksTurn, pluginInstalled } from "./core/plugin.ts";
import { MODES, parsePref, readPrefs, setPref } from "./core/prefs.ts";
import { handleClaude } from "./hooks/claude.ts";
import { handleOpencode } from "./hooks/opencode.ts";
import { cortexInit, nodeOnPath } from "./init.ts";
import { installSkills } from "./skills.ts";
import { refreshState, rerenderNewest, statePath, writeHandoff } from "./core/state.ts";
import { setup } from "./setup.ts";
import { expandAlias, KC_HELP } from "./kc.ts";
import { computeStatus, statusMarkdown, statusText } from "./core/status.ts";
import { installShims, isSetUp, rememberInstall } from "./onboard.ts";
import { dreamCommand } from "./dream-cli.ts";
import { nativeSummary } from "./core/native.ts";

function readStdin(): string {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** Keep the last 50 real hook durations (ms) for the panel's speed gauge. */
function recordHookTime(priv: string, ms: number): void {
  try {
    const f = `${priv}/hook-times.json`;
    let xs: number[] = [];
    try { xs = JSON.parse(readFileSync(f, "utf8")) as number[]; } catch { /* first */ }
    writeFileSync(f, JSON.stringify([...xs, ms].slice(-50)));
  } catch { /* never break a hook */ }
}

/** Hooks must never break the harness: any error is logged and the hook exits 0 with no output. */
function runHook(name: string, fromPlugin = false): void {
  const raw = readStdin();
  let input: Record<string, unknown> = {};
  try { input = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}; } catch { /* keep empty */ }
  const start = String(input.cwd ?? input.directory ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
  const root = resolveProject(start);
  if (!root) return; // project not initialised: stay silent
  const p = repoPaths(root);
  const [harness, event] = name.toLowerCase().split(".");
  // the plugin's hooks and an older per-project install can both fire: the plugin wins, the copy steps aside
  if (harness === "claude" && !pluginHooksTurn(p, fromPlugin)) return;
  try {
    mkdirSync(p.priv, { recursive: true });
    const out = harness === "claude" ? handleClaude(event ?? "", p, input) : harness === "opencode" ? handleOpencode(event ?? "", p, input) : "";
    if (out) process.stdout.write(out);
    recordHookTime(p.priv, Math.round(process.uptime() * 1000)); // whole process: what the harness waits for
  } catch (err) {
    try { appendFileSync(p.errors, `${new Date().toISOString()} ${name} ${(err as Error).stack ?? err}\n`); } catch { /* nowhere to log */ }
  }
}

function repoOrDie(): ReturnType<typeof repoPaths> {
  const root = resolveProject(process.cwd());
  if (!root) { console.error("Cortex isn't on here. Run `kc i` in the project first."); process.exit(1); }
  return repoPaths(root);
}

function main(argv: string[]): void {
  const [cmd, ...rest] = expandAlias(argv);
  const self = IS_BINARY ? "" : fileURLToPath(import.meta.url);
  const node = nodeOnPath(process.execPath);
  switch (cmd) {
    case "start": {
      // kc i: machine setup the first time, then this project
      if (!isSetUp()) for (const l of setup({ node, cli: self })) console.log(`  • ${l}`);
      for (const l of installShims(node, self)) console.log(`  • launcher: ${l}`);
      rememberInstall(node, self);
      const dir = resolve(rest.find((r) => !r.startsWith("-")) ?? ".");
      for (const c of cortexInit(dir, { node, cli: self, claudeHooks: !pluginInstalled() })) console.log(`  • ${c}`);
      console.log(`\nKapex Cortex is on for ${dir}. Open a new chat there; type /kc for the panel.`);
      return;
    }
    case "init": {
      const dir = resolve(rest[0] ?? ".");
      const changes = cortexInit(dir, { node, cli: self, claudeHooks: !pluginInstalled() });
      console.log(`Kapex Cortex is on in ${dir}`);
      for (const c of changes) console.log(`  • ${c}`);
      return;
    }
    case "status": {
      if (rest.includes("--json") && !resolveProject(process.cwd())) {
        // not a Cortex project: tell the panel which child folders are, so a chat opened one level up still works
        process.stdout.write(JSON.stringify({ off: true, cwd: process.cwd(), nearby: nearbyProjects(process.cwd()) }));
        process.exit(1);
      }
      const s = computeStatus(repoOrDie());
      process.stdout.write(rest.includes("--json") ? JSON.stringify(s) : rest.includes("--md") ? statusMarkdown(s) + "\n" : statusText(s) + "\n");
      return;
    }
    case "memory": {
      // what Claude Code loads by itself, and what it costs
      const p = repoOrDie();
      const n = nativeSummary(p.root);
      console.log(`Loaded into every session: ${n.alwaysLines} lines, about ${n.alwaysTokens.toLocaleString()} tokens. Auto memory: ${n.autoMemory.enabled ? "on" : "off"} (${n.autoMemory.dir}).\n`);
      for (const f of n.files) console.log(`  ${f.label.padEnd(40)} ${(f.loads === "on-demand" ? (f.paths ? `when ${f.paths.join(", ")}` : "when needed") : f.loads === "first-200" ? "every session (first 200 lines)" : "every session").padEnd(34)} ${String(f.lines).padStart(4)} lines ${String(f.tokens).padStart(6)} tokens${f.over ? `  ⚠ ${f.over}` : ""}`);
      return;
    }
    case "dream":
      void dreamCommand(rest, repoOrDie(), self, node).then((code) => process.exit(code));
      return;
    case "handoff": {
      const p = repoOrDie();
      const arg = (flag: string) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
      const goal = arg("--goal"), next = arg("--next");
      if (goal || next) writeHandoff(p, { goal, next });
      const ok = rerenderNewest(p) || (refreshState(p, { harness: "manual", session: "manual" }, { snapshot: true }), true);
      console.log(ok ? `Handoff saved to ${statePath(p)}` : `Handoff note saved; ${statePath(p)} will include it after the next turn ends.`);
      return;
    }
    case "state": {
      const p = repoOrDie();
      try { process.stdout.write(readFileSync(statePath(p), "utf8")); } catch { console.log("No .vault/STATE.md yet."); }
      return;
    }
    case "prefs": {
      // kc prefs → JSON · kc prefs set <key> <value> [--project]
      const root = resolveProject(process.cwd());
      const p = root ? repoPaths(root) : undefined;
      if (rest[0] === "set") {
        const v = parsePref(rest[1] ?? "", rest[2] ?? "");
        if (typeof v === "string") { console.error(v); process.exit(2); }
        setPref(v.key, v.value, rest.includes("--project") ? "project" : "user", p);
      }
      process.stdout.write(JSON.stringify({ ...readPrefs(p), modes: MODES }) + "\n");
      return;
    }
    case "key": {
      // save the API key for the "api" Dream backend in the macOS keychain: pbpaste | kc key
      const key = readStdin().trim();
      if (!key) { console.error("Pipe the key in: pbpaste | kc key"); process.exit(2); }
      if (process.platform !== "darwin") { console.error("Set CORTEX_CLASSIFIER_KEY in your environment instead (the keychain is macOS only)."); process.exit(2); }
      const r = spawnSync("/usr/bin/security", ["add-generic-password", "-U", "-s", "kapex-cortex-classifier", "-a", "kapex-cortex", "-w", key], { encoding: "utf8" });
      console.log(r.status === 0 ? "Saved in your keychain (kapex-cortex-classifier)." : `Couldn't save it: ${r.stderr.trim()}`);
      return;
    }
    case "setup":
      console.log(setup({ node, cli: self }).map((l) => `  • ${l}`).join("\n"));
      return;
    case "install-skills": {
      const written = installSkills(process.env.HOME ?? "", node, self);
      console.log(written.length ? written.map((w) => `  • ${w}`).join("\n") : "Skills already up to date.");
      return;
    }
    case "bench": {
      const r = spawnSync(node, [resolve(self, "..", "..", "bench", "run.ts"), ...rest], { stdio: "inherit" });
      process.exit(r.status ?? 0);
    }
    case "hook":
      if (process.env.CORTEX_CLASSIFIER) return; // a model call Cortex started itself: nothing to capture
      runHook(rest[0] ?? "", rest.includes("--plugin"));
      return;
    default:
      process.stdout.write(KC_HELP);
  }
}

main(process.argv.slice(2));
