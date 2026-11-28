import { spawn } from "node:child_process";
import { join } from "node:path";
import { rotateJsonl } from "../util/atomic.ts";
import { tryLock } from "../util/lock.ts";
import { autoDreamDue, cliFromHook, spawnDream, spawnQuick } from "../core/dream-spawn.ts";
import { quickDue } from "../core/quick.ts";
import { readPrefs } from "../core/prefs.ts";
import { notifyMac, prepareNotifier, SOUND } from "../core/notifier.ts";
import { accumulate, finalize, realReply } from "../core/episodes.ts";
import { saveExchange } from "../core/exchanges.ts";
import { migrateV2 } from "../core/migrate.ts";
import { refreshOwnSkills } from "../skills.ts";
import type { RepoPaths } from "../core/paths.ts";
import { previousInput, refreshState, stateAgeNotice } from "../core/state.ts";
import { claudeNewTurns, readCursor, type Rewind } from "../core/transcript.ts";
import { markRewound, readTurns, storeTurns } from "../core/turns.ts";

/**
 * Claude Code hooks. Cortex v3 adds nothing to your messages and keeps no memory store: Claude Code's own
 * CLAUDE.md, rules and auto memory do that. The hooks only keep the handoff and the journal current:
 *   SessionStart  one line pointing at a handoff from another chat, when there is one (and a one-time v2 migration)
 *   Stop          this turn into the journal, the full exchange, a fresh .vault/STATE.md
 *   StopFailure   the same, keeping the last good reply; on a usage limit, the handoff is stamped ready
 *   PreCompact    a handoff snapshot (with a git WIP ref) before Claude summarizes the chat
 *   SessionEnd    a Dream, only if you switched on "Dream by itself" and one is due
 *   (Stop also starts the free Quick check in the background when a memory file or the code changed)
 */
export interface ClaudeHookInput {
  session_id?: string; transcript_path?: string; cwd?: string; hook_event_name?: string; source?: string; trigger?: string;
  model?: string; last_assistant_message?: string; error?: string; error_details?: string; reason?: string; stop_hook_active?: boolean;
}

/** Read this session's new transcript lines once: your messages into turns.jsonl, everything into the journal. */
function capture(p: RepoPaths, input: ClaudeHookInput): void {
  const session = input.session_id ?? "unknown";
  const release = tryLock(join(p.priv, "locks", `capture-claude-${session}.lock`), { waitMs: 80 });
  if (!release) return; // another hook for this session is capturing right now
  try {
    const seen: Record<string, unknown>[] = [];
    const rewinds: Rewind[] = [];
    const turns = claudeNewTurns(p, session, input.transcript_path ?? "", (e) => { seen.push(e); }, rewinds);
    // a rewind first, so the messages that replace the rewound ones are stored after its marker
    for (const r of rewinds) markRewound(p, "claude-code", session, r);
    accumulate(p, session, seen);
    storeTurns(p, "claude-code", session, turns);
  } finally {
    release();
  }
}

function updateState(p: RepoPaths, input: ClaudeHookInput, snapshot = false, quiet = false, stamp?: string) {
  const session = input.session_id ?? "unknown";
  return refreshState(p, {
    harness: "claude-code", session,
    lastUser: readTurns(p, session).at(-1)?.text,
    lastAssistant: input.last_assistant_message,
    lastFailure: readCursor(p, `claude-${session}`).lastFailure,
  }, { snapshot, quiet, stamp });
}

/** A turn that ran no command and edited nothing: git can't have changed through it. */
const QUIET_SAFE = /^(?:Read|Grep|Glob|LS|WebFetch|WebSearch|TodoWrite|ToolSearch|Skill|AskUserQuestion|mcp__ccd_\w+|mcp__visualize__\w+)$/;

/** A macOS notification with Cortex's own icon (core/notifier.ts), else osascript's. */
const notify = notifyMac

/** Returns what the hook prints on stdout (empty string = print nothing). */
export function handleClaude(event: string, p: RepoPaths, input: ClaudeHookInput): string {
  switch (event) {
    case "sessionstart": {
      migrateV2(p); // once, for a project that still has a v2 ledger
      try { prepareNotifier(cliFromHook(), p.root); } catch { /* the Cortex notifier app is built in the background, once */ }
      try { refreshOwnSkills(); } catch { /* never break the hook */ }
      capture(p, input);
      if (input.source === "compact") return ""; // Claude Code re-reads CLAUDE.md and rules after a compaction by itself
      const notice = stateAgeNotice(p).trim();
      return notice ? JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `Kapex Cortex: ${notice}` } }) : "";
    }
    case "stop": {
      const session = input.session_id ?? "unknown";
      capture(p, input);
      const ep = finalize(p, session, input.last_assistant_message ?? "");
      // private logs stay bounded: the journal keeps its newest 3,000 turns, your messages their newest 5,000
      rotateJsonl(join(p.priv, "episodes.jsonl"), 5 * 1024 * 1024, 3_000);
      rotateJsonl(p.turns, 10 * 1024 * 1024, 5_000);
      // a usage-limit or API-error notice is the harness's, not a reply: it never replaces the last real exchange
      const reply = realReply(input.last_assistant_message);
      // stamped with the message's own time, so a rewind (in transcript time) drops its exchange too
      const asked = readTurns(p, session).at(-1);
      if (reply) saveExchange(p, session, asked?.text ?? "", reply, asked && Number.isFinite(Date.parse(asked.ts)) ? new Date(asked.ts) : new Date());
      if (!input.session_id) return ""; // no session to write a handoff for (it would win as "newest" over a real one)
      // no turn seen (nothing new in the transcript), or one that only read: git can't have changed through Claude
      const quiet = !ep || Object.keys(ep.tools).every((t) => QUIET_SAFE.test(t));
      const gi = updateState(p, { ...input, last_assistant_message: reply || previousInput(p, session)?.lastAssistant }, false, quiet);
      // the free Quick check, in the background and only when a memory file or the code changed since the last one
      if (quickDue(p, `${gi?.branch ?? ""}|${gi?.diffStat ?? ""}`)) spawnQuick(p, cliFromHook());
      return "";
    }
    case "stopfailure": {
      capture(p, input);
      finalize(p, input.session_id ?? "unknown", input.last_assistant_message ?? "");
      if (!input.session_id) return "";
      // a limit usually hits mid-turn: keep the last *completed* answer rather than overwrite it, and never let the
      // harness's notice ("You've hit your 5-hour limit") stand in as the reply, the goal or a turn's result
      const prev = previousInput(p, input.session_id)?.lastAssistant?.replace(/\n\n\(the next turn ended with [^\n]*\)$/, "");
      const partial = realReply(input.last_assistant_message);
      const note = `(the next turn ended with ${String(input.error ?? "an error").slice(0, 60)}${input.error_details ? `: ${String(input.error_details).slice(0, 200)}` : ""})`;
      // a usage limit stamps this chat's own packet (never another chat's that happens to be newest)
      updateState(p, { ...input, last_assistant_message: partial ? `${partial}\n\n${note}` : prev ? `${prev}\n\n${note}` : note }, true, false, input.error === "rate_limit" ? "Claude rate limit" : undefined);
      if (input.error === "rate_limit") {
        // once for every chat that hits the limit together (notify-guard), with the alert sound when Sounds is on
        notify("Kapex Cortex", "Claude hit its usage limit. Handoff saved: open OpenCode and run /cortex-resume.", { cwd: p.root, sound: readPrefs(p).sound !== false ? SOUND.alert : null });
      }
      return "";
    }
    case "precompact":
      capture(p, input);
      updateState(p, input, true); // a compaction is a handoff moment: snapshot the working tree
      return "";
    case "sessionend":
      if (autoDreamDue(p)) spawnDream(p, cliFromHook());
      return "";
    default:
      return ""; // v2 events (UserPromptSubmit, PostCompact, PostToolUseFailure) from an older install: nothing to do
  }
}
