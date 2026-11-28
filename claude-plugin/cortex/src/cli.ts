#!/usr/bin/env node
import { IS_BINARY } from "./core/self.ts";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nearbyProjects, repoPaths, resolveProject } from "./core/paths.ts";
import { pluginHooksTurn, pluginInstalled, pluginListed } from "./core/plugin.ts";
import { opencodeHome } from "./core/home.ts";
import { MODES, parsePref, readPrefs, setPref } from "./core/prefs.ts";
import { runHook } from "./hook.ts";
import { cortexInit, nodeOnPath } from "./init.ts";
import { installSkills } from "./skills.ts";
import { DECISION_CHARS, MAX_DECISIONS, newestSession, refreshState, rerenderNewest, statePath, writeHandoff } from "./core/state.ts";
import { GOAL_CHARS } from "./core/mission.ts";
import { setup } from "./setup.ts";
import { expandAlias, KC_HELP } from "./kc.ts";
import { computeStatus, statusMarkdown, statusText } from "./core/status.ts";
import { olderTimeline } from "./core/timeline.ts";
import { buildNotifier, notifierReady, notifyMac, SOUND } from "./core/notifier.ts";
import { quietReason } from "./core/notify-guard.ts";
import { installShims, isSetUp, rememberInstall } from "./onboard.ts";
import { dreamCommand } from "./dream-cli.ts";
import { missionCommand } from "./mission-cli.ts";
import { nativeSummary } from "./core/native.ts";
import { park, parkView, unpark } from "./core/park.ts";
import { applySafety, auditSafety, undoSafety } from "./core/safety.ts";

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
    case "safety": {
      // kc safety [--json] · apply secrets|gate [--cmd "<check>"] · undo
      const p = repoOrDie();
      const [sub = "", what = ""] = rest;
      if (sub === "apply" && (what === "secrets" || what === "gate")) { const i = rest.indexOf("--cmd"); console.log(applySafety(p, what, i > 0 ? rest[i + 1] : undefined)); return; }
      if (sub === "undo") { console.log(undoSafety(p)); return; }
      const v = auditSafety(p);
      console.log(rest.includes("--json") ? JSON.stringify(v) : v.findings.map((x) => `${x.level === "ok" ? "✓" : x.level === "warn" ? "!" : "·"} ${x.title}: ${x.detail}${x.fix ? `  (fix: kc safety apply ${x.fix})` : ""}`).join("\n"));
      return;
    }
    case "park": {
      // kc park [list] · add <server…> [--auto] [--tokens <server>=<n>…] · remove <server…>
      const p = repoOrDie();
      const [sub = "list", ...names] = rest;
      const tokens: Record<string, number> = {};
      const plain = names.filter((n, i) => !n.startsWith("--") && names[i - 1] !== "--tokens");
      names.forEach((n, i) => { if (names[i - 1] === "--tokens") { const m = /^(.+)=(\d+)$/.exec(n); if (m) tokens[m[1]!] = Number(m[2]); } });
      const said = sub === "add" ? park(p, plain, { auto: names.includes("--auto"), tokens }) : sub === "remove" ? unpark(p, plain) : "";
      if (said) { console.log(said); if (/^Couldn't/.test(said)) process.exitCode = 1; return; } // the panel shows a failure as one
      else { const v = parkView(p); console.log(v.servers.length ? v.servers.map((s) => `${s.name}  ${s.auto ? "auto" : "you"}  ${s.at.slice(0, 16)}  ${v.disabled.includes(s.name) ? "off in Claude Code" : "back on (changed elsewhere)"}`).join("\n") : "Nothing parked by Cortex here."); }
      return;
    }
    case "handoff": {
      const p = repoOrDie();
      const arg = (flag: string) => { const i = rest.indexOf(flag); return i >= 0 ? rest[i + 1] : undefined; };
      const goal = arg("--goal"), next = arg("--next");
      const decisions = rest.flatMap((x, i) => (x === "--decision" && rest[i + 1] ? [rest[i + 1]!] : []));
      // never cut silently: say what won't survive, so a long goal can be shortened or moved to --next / --decision
      for (const w of handoffLimits(goal, decisions)) console.error(`Note: ${w}`);
      // the note belongs to the chat it is saved for (the newest real one here): its decisions bind that chat only
      if (goal || next || decisions.length) writeHandoff(p, { goal, next, decisions, session: newestSession(p, p.root)?.session });
      const ok = rerenderNewest(p) || (refreshState(p, { harness: "manual", session: "manual" }, { snapshot: true }), true);
      console.log(ok ? `Handoff saved to ${statePath(p)}` : `Handoff note saved; ${statePath(p)} will include it after the next turn ends.`);
      return;
    }
    case "mission": { missionCommand(repoOrDie(), rest); return; }
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
      const key = (() => { try { return readFileSync(0, "utf8"); } catch { return ""; } })().trim();
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
      const home = process.env.HOME ?? "";
      const written = installSkills(home, node, self, { plugin: pluginListed(), opencode: existsSync(opencodeHome()) });
      console.log(written.length ? written.map((w) => `  • ${w}`).join("\n") : "Skills already up to date.");
      return;
    }
    case "bench": {
      const r = spawnSync(node, [resolve(self, "..", "..", "bench", "run.ts"), ...rest], { stdio: "inherit" });
      process.exit(r.status ?? 0);
    }
    case "timeline": {
      // kc timeline --before <ISO> [--limit 48]: older events for the panel's Show older, as JSON
      const at = rest.indexOf("--before"), lim = rest.indexOf("--limit");
      process.stdout.write(JSON.stringify(olderTimeline(repoOrDie(), rest[at + 1] ?? "", lim >= 0 ? Number(rest[lim + 1]) || 48 : 48)));
      return;
    }
    case "notify": {
      // kc notify [--sound done|alert] <title> <words>: one macOS notification from the panel (top right, Cortex's icon,
      // the sound only when the panel passes it: Sounds on). "notified" when one was sent; "skipped" when notify-guard
      // held it back (a repeat or a burst: the panel then does nothing more); "not sent" (exit 2) where macOS
      // notifications can't go (Linux, Windows, a test or throwaway run), so the panel uses the app's own toast
      const si = rest.indexOf("--sound"), kind = si >= 0 ? rest[si + 1] : undefined, args = si >= 0 ? rest.filter((_, i) => i !== si && i !== si + 1) : rest;
      const why = process.platform !== "darwin" ? "not macOS" : quietReason();
      if (why || !args[1]) { console.log(`not sent${why ? ` (${why})` : ""}`); process.exitCode = 2; return; }
      console.log(notifyMac(args[0] || "Kapex Cortex", args.slice(1).join(" "), { sound: kind === "alert" ? SOUND.alert : kind === "done" ? SOUND.done : null }) ? "notified" : "skipped (said in the last 10 minutes, or a burst)"); return;
    }
    case "notifier": {
      // the macOS notifier app with Cortex's icon (core/notifier.ts): built once in the background at session start
      if (rest[0] === "build") { const ok = buildNotifier(); console.log(ok ? "ready" : "not built (macOS only)"); return; }
      if (rest[0] === "test") {
        // the way a real one looks and sounds (Sounds in Settings, on by default), timestamped so the repeat guard lets it through
        let on = true; try { on = readPrefs(repoOrDie()).sound !== false; } catch { /* no project here: the default */ }
        const sent = notifyMac("Kapex Cortex", `Notifications look like this (${new Date().toLocaleTimeString()})${on ? ", with a sound" : ", silent: Sounds is off"}.`, { sound: on ? SOUND.done : null });
        console.log(!sent ? `not sent: ${quietReason() ?? "a notification went out under 2 s ago"}` : notifierReady() ? `sent with the Cortex app${on ? ` (sound: ${SOUND.done})` : " (silent)"}` : "sent with osascript (run: kc notifier build)"); return;
      }
      console.log("kc notifier build|test"); return;
    }
    case "hook":
      runHook(rest[0] ?? "", rest.includes("--plugin"));
      return;
    default:
      process.stdout.write(KC_HELP);
  }
}

main(process.argv.slice(2));

/** What `kc handoff` would cut: the north star past GOAL_CHARS, a decision past DECISION_CHARS, decisions past MAX_DECISIONS. */
export function handoffLimits(goal: string | undefined, decisions: string[]): string[] {
  const out: string[] = [];
  if (goal && goal.length > GOAL_CHARS) out.push(`the goal is ${goal.length} characters; the north star keeps the first ${GOAL_CHARS}, so it ends at "…${goal.slice(GOAL_CHARS - 40, GOAL_CHARS)}". Shorten it, or move details to --next or --decision.`);
  decisions.forEach((d, i) => { if (d.length > DECISION_CHARS) out.push(`decision ${i + 1} is ${d.length} characters; it keeps the first ${DECISION_CHARS}.`); });
  if (decisions.length > MAX_DECISIONS) out.push(`${decisions.length} decisions given; a handoff keeps the newest ${MAX_DECISIONS}.`);
  return out;
}
