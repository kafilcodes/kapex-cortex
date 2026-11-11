import { appendLine, MAX_LINE_BYTES, readJsonl } from "../util/atomic.ts";
import { ulid } from "../util/ulid.ts";
import type { RepoPaths } from "./paths.ts";
import { scrub } from "./scrub.ts";

/**
 * Your own messages, word for word (private, secrets scrubbed), so a handoff knows what you last asked even when
 * the harness passes only the reply. .vault/private/turns.jsonl, one line per message.
 */
export interface Turn { id: string; ts: string; harness: string; session: string; ref: string; text: string; redacted: number }
/** A message read from a transcript, before it is stored. */
export interface RawUserTurn { text: string; ref: string; ts?: string }

function fit(t: Turn): string {
  let line = JSON.stringify(t);
  while (Buffer.byteLength(line) + 1 > MAX_LINE_BYTES) {
    const over = Buffer.byteLength(line) + 1 - MAX_LINE_BYTES;
    t = { ...t, text: t.text.slice(0, Math.max(0, t.text.length - over - 64)) + " […truncated]" };
    line = JSON.stringify(t);
  }
  return line;
}

export function addTurn(p: RepoPaths, t: Omit<Turn, "id" | "redacted">, now = new Date()): Turn {
  const s = scrub(t.text);
  const turn: Turn = { ...t, id: ulid(now.getTime()), text: s.text, redacted: s.count };
  appendLine(p.turns, fit(turn));
  return turn;
}

/** Stored messages, oldest first, one per transcript entry (a re-read never doubles them). */
export function readTurns(p: RepoPaths, session?: string): Turn[] {
  const { items } = readJsonl<Turn>(p.turns);
  const seen = new Set<string>();
  return items
    .filter((t) => (session ? t.session === session : true))
    .filter((t) => (seen.has(t.ref) ? false : (seen.add(t.ref), true)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Store each new message (empty ones skipped). */
export function storeTurns(p: RepoPaths, harness: string, session: string, turns: RawUserTurn[]): void {
  for (const t of turns) if (t.text.trim()) addTurn(p, { ts: t.ts ?? new Date().toISOString(), harness, session, ref: t.ref, text: t.text });
}
