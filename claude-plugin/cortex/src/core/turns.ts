import { statSync } from "node:fs";
import { appendLine, MAX_LINE_BYTES, readJsonl } from "../util/atomic.ts";
import { ulid } from "../util/ulid.ts";
import type { RepoPaths } from "./paths.ts";
import { scrub } from "./scrub.ts";

/**
 * Your own messages, word for word (private, secrets scrubbed), so a handoff knows what you last asked even when
 * the harness passes only the reply. .vault/private/turns.jsonl, one line per message.
 */
export interface Turn { id: string; ts: string; harness: string; session: string; ref: string; text: string; redacted: number; /** a marker line, not a message: this session's messages in (since, until) were rewound */ rewound?: { since: string; until: string } }
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

/** The whole log, parsed once per file version: the Stop hook asks for it five times (brief, tiers, mission, carry,
 * exchange), and parsing a 400 KB log each time cost ~4 ms of the 150 ms budget. */
let memo: { key: string; items: Turn[] } | null = null;
function allTurns(p: RepoPaths): Turn[] {
  let key = "";
  try { const st = statSync(p.turns); key = `${p.turns}|${st.size}|${st.mtimeMs}`; } catch { return []; }
  if (memo?.key === key) return memo.items;
  const items = readJsonl<Turn>(p.turns).items.filter((t) => t && typeof t === "object" && typeof t.session === "string" && typeof t.ts === "string" && typeof t.text === "string");
  memo = { key, items };
  return items;
}

/** Stored messages, oldest first, one per transcript entry (a re-read never doubles them), without rewound ones. */
export function readTurns(p: RepoPaths, session?: string): Turn[] {
  const items = allTurns(p).filter((t) => (session ? t.session === session : true));
  const cut = items.filter((t) => t.rewound);
  const seen = new Set<string>();
  return items
    .filter((t) => !t.rewound && !cut.some((m) => m.session === t.session && t.ts > m.rewound!.since && t.ts < m.rewound!.until && t.id < m.id))
    .filter((t) => (seen.has(t.ref) ? false : (seen.add(t.ref), true)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Mark this session's messages in (since, until) as rewound: an append-only marker, so nothing is rewritten. */
export function markRewound(p: RepoPaths, harness: string, session: string, r: { since: string; until: string }, now = new Date()): void {
  appendLine(p.turns, JSON.stringify({ id: ulid(now.getTime()), ts: now.toISOString(), harness, session, ref: `rewind:${r.since}:${r.until}`, text: "", redacted: 0, rewound: r } satisfies Turn));
}

/** Store each new message (empty ones skipped). */
export function storeTurns(p: RepoPaths, harness: string, session: string, turns: RawUserTurn[]): void {
  for (const t of turns) if (t.text.trim()) addTurn(p, { ts: t.ts ?? new Date().toISOString(), harness, session, ref: t.ref, text: t.text });
}

/** This session's rewound ranges (the trail leaves out turns inside them). */
export function rewoundRanges(p: RepoPaths, session: string): { since: string; until: string }[] {
  return allTurns(p).filter((t) => t.session === session && t.rewound).map((t) => t.rewound!);
}
