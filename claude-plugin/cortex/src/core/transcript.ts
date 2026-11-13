import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RawUserTurn } from "./turns.ts";
import type { RepoPaths } from "./paths.ts";

export interface Cursor { offset?: number; seq?: number; path?: string; lastFailure?: string; lastFailureTs?: string; sent?: Record<string, string>; /** the chat's title as Claude Code names it (its latest custom-title line) */ title?: string }

function cursorFile(p: RepoPaths, key: string) {
  return join(p.cursors, `${key.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`);
}
export function readCursor(p: RepoPaths, key: string): Cursor {
  try { return JSON.parse(readFileSync(cursorFile(p, key), "utf8")) as Cursor; } catch { return {}; }
}
export function writeCursor(p: RepoPaths, key: string, c: Cursor) {
  atomicWriteIfChanged(cursorFile(p, key), JSON.stringify(c));
}

/** Pull the user's own typed text out of one Claude Code transcript entry, or null. */
export function claudeUserText(entry: Record<string, unknown>): string | null {
  if (entry.type !== "user" || entry.isMeta || entry.isCompactSummary || entry.isVisibleInTranscriptOnly) return null;
  const msg = entry.message as { role?: string; content?: unknown } | undefined;
  if (!msg || msg.role !== "user") return null;
  let text = "";
  if (typeof msg.content === "string") text = msg.content;
  else if (Array.isArray(msg.content)) {
    if (msg.content.some((b) => (b as { type?: string })?.type === "tool_result")) return null;
    text = msg.content
      .filter((b) => (b as { type?: string })?.type === "text")
      .map((b) => (b as { text?: string }).text ?? "")
      .join("\n");
  }
  text = text.trim();
  if (!text) return null;
  // Local command output is harness chatter. A slash command is chatter too, unless you wrote something after it
  // (its arguments are your words: "/cortex-resume <a long brief>") or it is /cortex-resume (a chat continuing another).
  if (/^<local-command-[a-z]+>/.test(text)) return null;
  if (/^<command-(?:name|message)>/.test(text)) {
    const name = (/<command-name>\/?([^<]+)<\/command-name>/.exec(text)?.[1] ?? "").trim();
    const args = (/<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1] ?? "").trim();
    if (args.length >= 15) return `/${name} ${args}`;
    return /cortex-resume$/.test(name) ? `/${name}` : null;
  }
  // Hook feedback ("Stop hook feedback: …") is stored as a user message but the harness wrote it.
  if (/^(Stop|PreToolUse|PostToolUse|UserPromptSubmit) hook (feedback|error)/.test(text)) return null;
  return text;
}

/** The text of a failed tool call (tool_result with is_error), first 20 lines, or null. */
export function claudeToolError(entry: Record<string, unknown>): string | null {
  if (entry.type !== "user") return null;
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return null;
  for (const b of content as { type?: string; is_error?: boolean; content?: unknown }[]) {
    if (b?.type !== "tool_result" || !b.is_error) continue;
    const raw = typeof b.content === "string" ? b.content
      : Array.isArray(b.content) ? (b.content as { text?: string }[]).map((c) => c.text ?? "").join("\n") : "";
    const text = raw.split("\n").slice(0, 20).join("\n").trim();
    if (text) return text.slice(0, 1_500);
  }
  return null;
}

/** Read new complete lines of a Claude Code transcript since the saved byte offset. */
/** `observe` sees every parsed line once (the session journal builds episodes from them in the same read). */
export function claudeNewTurns(p: RepoPaths, session: string, transcriptPath: string, observe?: (entry: Record<string, unknown>) => void): RawUserTurn[] {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const key = `claude-${session}`;
  const cur = readCursor(p, key);
  const fd = openSync(transcriptPath, "r");
  try {
    const size = fstatSync(fd).size;
    let offset = cur.path === transcriptPath && (cur.offset ?? 0) <= size ? (cur.offset ?? 0) : 0;
    if (size === offset) return [];
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return [];
    const chunk = buf.subarray(0, lastNl + 1).toString("utf8");
    const out: RawUserTurn[] = [];
    let lastFailure = cur.lastFailure;
    let lastFailureTs = cur.lastFailureTs;
    let title = cur.title;
    for (const line of chunk.split("\n")) {
      if (!line) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
      observe?.(entry);
      if (entry.type === "custom-title" && typeof entry.customTitle === "string" && entry.customTitle.trim()) title = entry.customTitle.trim().slice(0, 120);
      const text = claudeUserText(entry);
      if (text) out.push({ text, ref: String(entry.uuid ?? `${transcriptPath}@${offset}`), ts: entry.timestamp as string | undefined });
      const fail = claudeToolError(entry);
      if (fail) { lastFailure = fail; lastFailureTs = entry.timestamp as string | undefined; }
    }
    offset += lastNl + 1;
    writeCursor(p, key, { ...cur, path: transcriptPath, offset, lastFailure, lastFailureTs, ...(title ? { title } : {}) });
    return out;
  } finally {
    closeSync(fd);
  }
}

export function opencodeDbPath(): string {
  const home = process.env.HOME ?? "";
  const xdg = process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
  return process.env.CORTEX_OPENCODE_DB ?? join(xdg, "opencode", "opencode.db");
}

/** Read new user messages of one OpenCode session (read-only SQLite) since the saved seq. */
export function opencodeNewTurns(p: RepoPaths, session: string, dbPath = opencodeDbPath()): RawUserTurn[] {
  if (!session || !existsSync(dbPath)) return [];
  const key = `opencode-${session}`;
  const cur = readCursor(p, key);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare("SELECT id, seq, time_created, data FROM session_message WHERE session_id = ? AND type = 'user' AND seq > ? ORDER BY seq")
      .all(session, cur.seq ?? -1) as { id: string; seq: number; time_created: number; data: string }[];
    const out: RawUserTurn[] = [];
    let maxSeq = cur.seq ?? -1;
    for (const r of rows) {
      maxSeq = Math.max(maxSeq, r.seq);
      let text = "";
      try { text = String((JSON.parse(r.data) as { text?: string }).text ?? ""); } catch { continue; }
      if (text.trim()) out.push({ text: text.trim(), ref: r.id, ts: new Date(r.time_created).toISOString() });
    }
    if (maxSeq !== (cur.seq ?? -1)) writeCursor(p, key, { seq: maxSeq });
    return out;
  } finally {
    db.close();
  }
}

/** Last assistant text of an OpenCode session (for STATE), read-only. */
export function opencodeLastAssistant(session: string, dbPath = opencodeDbPath()): string {
  if (!session || !existsSync(dbPath)) return "";
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT data FROM session_message WHERE session_id = ? AND type = 'assistant' ORDER BY seq DESC LIMIT 1")
      .get(session) as { data: string } | undefined;
    if (!row) return "";
    const d = JSON.parse(row.data) as { content?: { type?: string; text?: string }[] };
    return (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
  } catch {
    return "";
  } finally {
    db.close();
  }
}
