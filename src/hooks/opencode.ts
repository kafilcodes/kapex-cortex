import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { tryLock } from "../util/lock.ts";
import type { RepoPaths } from "../core/paths.ts";
import { refreshState } from "../core/state.ts";
import { opencodeDbPath, opencodeLastAssistant, opencodeNewTurns, readCursor, writeCursor } from "../core/transcript.ts";
import { readTurns, storeTurns } from "../core/turns.ts";

/**
 * OpenCode is the fallback when Claude hits a usage limit: /cortex-resume there reads .vault/STATE.md, and when
 * an OpenCode session goes idle Cortex writes the handoff back, so Claude Code can pick up where OpenCode stopped.
 * Cortex adds nothing to OpenCode's context: the v2 entries (rules, your words, approvals) are cleared once.
 */
export interface OpencodeHookInput { sessionID?: string; directory?: string; summary?: string; outcome?: string }

const OLD_KEYS = ["kapex-cortex-invariants", "kapex-cortex-your-messages", "kapex-cortex-pending-approval"];

function capture(p: RepoPaths, session: string): void {
  const release = tryLock(join(p.priv, "locks", `capture-opencode-${session}.lock`), { waitMs: 80 });
  if (!release) return;
  try { storeTurns(p, "opencode", session, opencodeNewTurns(p, session)); } finally { release(); }
}

/** Entries to send: each v2 key once, empty, which tells the plugin to remove it. */
function clearOld(p: RepoPaths, session: string): Record<string, string> {
  const key = `opencode-entries-${session}`;
  const sent = (readCursor(p, key) as { sent?: Record<string, string> }).sent ?? {};
  const empty = createHash("sha256").update("").digest("hex");
  const out: Record<string, string> = {};
  for (const k of OLD_KEYS) if (sent[k] !== empty) { out[k] = ""; sent[k] = empty; }
  if (Object.keys(out).length) writeCursor(p, key, { sent } as never);
  return out;
}

/**
 * The session must belong to this repo according to OpenCode's own database. Unknown or foreign sessions are
 * ignored (one shared OpenCode server serves every project).
 */
export function sessionBelongs(session: string, root: string, dbPath = opencodeDbPath()): boolean {
  if (!existsSync(dbPath)) return false;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db.prepare("SELECT directory FROM session_v2 WHERE id = ?").get(session) as { directory?: string } | undefined;
      if (!row?.directory) return false;
      const real = (d: string) => { try { return realpathSync(d); } catch { return d; } };
      return real(row.directory) === real(root);
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** stdout is read by the OpenCode plugin (templates/opencode-plugin.ts): JSON {entries: {key: value}}. */
export function handleOpencode(event: string, p: RepoPaths, input: OpencodeHookInput): string {
  const session = input.sessionID ?? "";
  if (!session || !sessionBelongs(session, p.root)) return "";
  if (event === "created") return JSON.stringify({ entries: clearOld(p, session) });
  if (event === "idle" || event === "compacted") {
    capture(p, session);
    if (event === "idle") refreshState(p, { harness: "opencode", session, lastUser: readTurns(p, session).at(-1)?.text, lastAssistant: opencodeLastAssistant(session) });
    return JSON.stringify({ entries: clearOld(p, session) });
  }
  return "";
}
