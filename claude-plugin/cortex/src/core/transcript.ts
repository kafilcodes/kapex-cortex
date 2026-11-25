import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RawUserTurn } from "./turns.ts";
import type { RepoPaths } from "./paths.ts";

export interface Cursor { offset?: number; seq?: number; path?: string; lastFailure?: string; lastFailureTs?: string; sent?: Record<string, string>; /** the chat's title as Claude Code names it (its latest custom-title line) */ title?: string;
  /** the session whose handoff packet this chat read (a "# STATE — … · session X" header in a tool result), first one */
  packet?: string;
  /** the newest entry time read, so a transcript that shrank (a rewind) is read again without counting turns twice */
  lastTs?: string;
  /** the last main-chain entry read: a typed message whose parent is another, earlier one was a rewind or an edit */
  lastUuid?: string;
  /** a shrunk transcript still being re-read: lines up to this time were read before; the newest such line kept so far */
  rereadUntil?: string; keptMax?: string }

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

/** A line past this size is mostly an image or a pasted file: its base64 is dropped before parsing (the words stay). */
const BIG_LINE = 256 * 1024;
/** Read at most this much per pass and this much per hook, so a 50 MB transcript never needs 50 MB at once. */
export const SLICE = 8 * 1024 * 1024;
const MAX_READ = 96 * 1024 * 1024, BUDGET_MS = 2_500;
/** Tests shrink the per-hook budget to reach the "re-read cut short" path without a 96 MB file. */
const maxRead = () => Number(process.env.CORTEX_TEST_READ_MAX) || MAX_READ;
const BASE64 = /"(data|base64)":"[A-Za-z0-9+/=\\]{512,}"/g;

/** One transcript line as an object, or null (a partial, corrupt or non-object line). Huge base64 never gets parsed. */
export function parseLine(line: string): Record<string, unknown> | null {
  if (!line) return null;
  const text = line.length > BIG_LINE ? line.replace(BASE64, '"$1":""') : line;
  try { const e: unknown = JSON.parse(text); return e && typeof e === "object" && !Array.isArray(e) ? (e as Record<string, unknown>) : null; } catch { return null; }
}

/** The text of a tool result (string or text blocks). */
function resultText(entry: Record<string, unknown>): string {
  const content = (entry.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return "";
  return (content as { type?: string; content?: unknown }[]).filter((b) => b?.type === "tool_result").map((b) =>
    typeof b.content === "string" ? b.content : Array.isArray(b.content) ? (b.content as { text?: string }[]).map((c) => c?.text ?? "").join("\n") : "").join("\n");
}

/**
 * Read new complete lines of a Claude Code transcript since the saved byte offset. `observe` sees every parsed line
 * once (the session journal builds episodes from them in the same read). Hardened for what real transcripts do:
 *   - a partial last line (being written) waits for the next read; a corrupt line is skipped
 *   - huge lines (images as base64) are parsed without their base64; reads go in 8 MB slices, bounded per hook
 *   - a transcript that shrank (a rewind, a rewrite) is read again from the start, but lines already read
 *     (by time) are neither stored nor observed twice, and your messages that vanished are reported in `rewound`
 *   - a message that branches from an earlier point (an edit or rewind that appends) reports the abandoned turns too
 */
/** Turns abandoned by a rewind: your messages stored with a time in (since, until) no longer stand. */
export interface Rewind { since: string; until: string }

export function claudeNewTurns(p: RepoPaths, session: string, transcriptPath: string, observe?: (entry: Record<string, unknown>) => void, rewinds?: Rewind[]): RawUserTurn[] {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const key = `claude-${session}`;
  const cur = readCursor(p, key);
  let fd: number;
  try { fd = openSync(transcriptPath, "r"); } catch { return []; } // locked or vanished: try again next time
  const t0 = Date.now();
  try {
    const size = fstatSync(fd).size;
    const same = cur.path === transcriptPath;
    const shrunk = same && (cur.offset ?? 0) > size;
    let offset = same && !shrunk ? (cur.offset ?? 0) : 0;
    if (size === offset) return [];
    const out: RawUserTurn[] = [];
    let { lastFailure, lastFailureTs, title, packet, lastTs, lastUuid } = cur;
    // a shrink is re-read until the end of the file, across hooks if the budget runs out (rereadUntil carries it on);
    // a cursor from before v4.5 has no time to compare with, so it skips to the end rather than count turns twice
    if (shrunk && !cur.lastTs && !cur.rereadUntil) { writeCursor(p, key, { ...cur, offset: size }); return []; }
    const seenBefore = shrunk ? cur.lastTs ?? "" : cur.rereadUntil ?? "";
    let keptMax = "";
    const found: Rewind[] = [];
    const uuidTs = new Map<string, string>();
    let read = 0;
    while (offset < size && read < maxRead() && Date.now() - t0 < BUDGET_MS) {
      const len = Math.min(size - offset, SLICE, Math.max(1, maxRead() - read));
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      let lastNl = buf.lastIndexOf(0x0a);
      if (lastNl < 0) {
        if (len < SLICE) break; // a line still being written
        // one line longer than a slice: skip to its end, unparsed
        let skip = offset + len;
        const probe = Buffer.alloc(64 * 1024);
        for (;;) { const n = readSync(fd, probe, 0, probe.length, skip); if (!n) break; const i = probe.subarray(0, n).indexOf(0x0a); if (i >= 0) { skip += i + 1; break; } skip += n; }
        read += skip - offset; offset = skip; continue;
      }
      for (const line of buf.subarray(0, lastNl + 1).toString("utf8").split("\n")) {
        const entry = parseLine(line);
        if (!entry) continue;
        const ts = typeof entry.timestamp === "string" ? entry.timestamp : "";
        if (seenBefore && ts && ts <= seenBefore) { if (ts > keptMax) keptMax = ts; if (typeof entry.uuid === "string") lastUuid = entry.uuid; continue; } // read before the shrink
        if (typeof entry.uuid === "string" && ts && !entry.isSidechain) uuidTs.set(entry.uuid, ts);
        const text = claudeUserText(entry);
        // a typed message whose parent is an earlier entry, not the last one: the chat was rewound or edited there
        if (text && !entry.isSidechain && lastUuid && typeof entry.parentUuid === "string" && entry.parentUuid !== lastUuid) {
          const at = uuidTs.get(entry.parentUuid) ?? tsOfUuid(transcriptPath, entry.parentUuid);
          if (at && ts && at < ts) found.push({ since: at, until: ts });
        }
        observe?.(entry);
        if (ts && (!lastTs || ts > lastTs)) lastTs = ts;
        if (typeof entry.uuid === "string" && !entry.isSidechain) lastUuid = entry.uuid;
        if (entry.type === "custom-title" && typeof entry.customTitle === "string" && entry.customTitle.trim()) title = entry.customTitle.trim().slice(0, 120);
        if (text) out.push({ text, ref: String(entry.uuid ?? `${transcriptPath}@${offset}`), ts: ts || undefined });
        const fail = claudeToolError(entry);
        if (fail) { lastFailure = fail; lastFailureTs = ts || undefined; }
        if (!packet && entry.type === "user") { const from = /# STATE — [^\n]*?· session ([A-Za-z0-9_-]+)/.exec(resultText(entry))?.[1]; if (from && from !== session) packet = from; }
      }
      read += lastNl + 1; offset += lastNl + 1;
    }
    // a shrink, read to the end: what was read before and is no longer in the file (later than the newest line kept)
    // was rewound. Not at the end yet: nothing is marked, and the next hook goes on from here
    const done = offset >= size;
    const keptBefore = done ? "" : seenBefore;
    if (done && seenBefore) found.push({ since: (keptMax > (cur.keptMax ?? "") ? keptMax : cur.keptMax) || "0", until: `${seenBefore}~` });
    rewinds?.push(...found);
    writeCursor(p, key, { ...cur, path: transcriptPath, offset, lastFailure, lastFailureTs, lastTs: keptBefore && lastTs && lastTs < keptBefore ? keptBefore : lastTs, lastUuid, rereadUntil: keptBefore || undefined, keptMax: keptBefore ? (keptMax > (cur.keptMax ?? "") ? keptMax : cur.keptMax) : undefined, ...(title ? { title } : {}), ...(packet ? { packet } : {}) });
    // a message of this very read that a later one in it rewound past is dropped here (stored ones by the caller)
    return out.filter((t) => !found.some((r) => t.ts && t.ts > r.since && t.ts < r.until));
  } finally {
    closeSync(fd);
  }
}

/** The time of one entry, found by scanning the file (only after a rewind is seen: rare). */
function tsOfUuid(path: string, uuid: string): string {
  try {
    const needle = `"uuid":"${uuid}"`;
    for (const line of readFileSync(path, "utf8").split("\n")) if (line.includes(needle)) return (/"timestamp":"([^"]+)"/.exec(line)?.[1]) ?? "";
  } catch { /* unreadable */ }
  return "";
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
