import { contentWords } from "./words.ts";

/**
 * Who wrote each part of a message (trust), and which older memory a newer one replaces. Sorting text into
 * memory types is a model's job (remember.ts / classify.ts), never a wording pattern's.
 *
 *   you      → typed by the person in this chat: may become active by itself
 *   pasted   → inside a <pasted_content> block: someone else's words, waits for the user's OK
 *   brief    → a task brief written by another AI session: waits for the user's OK
 *   command  → slash-command echoes, hook feedback, status cards: never a memory
 */
export type Source = "you" | "pasted" | "brief" | "command";
export interface Segment { text: string; source: Source }
export interface ActiveRule { id: string; text: string }

const BRIEF = /^\s*Background \(from the session that started this one\)/;
const COMMAND = /^\s*(?:<(?:command-name|command-message|local-command-[a-z]+)>|Stop hook feedback:|###\s*[●◐○]\s*Kapex Cortex|\/[a-z][\w:-]*\s*$)/i;
const PASTED = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content\b[^>]*>/gi;

/** Split one user message into parts by who actually wrote them. */
export function segments(text: string): Segment[] {
  // harness output that arrives inside a user message: reminders, background-task notices, interruption markers
  const clean = text
    .replace(/<(system-reminder|task-notification|side-sessions-event|ci-monitor-event)>[\s\S]*?<\/\1>/g, " ")
    .replace(/\[Request interrupted by user[^\]]*\]/g, " ");
  if (COMMAND.test(clean)) return [{ text: clean, source: "command" }];
  if (BRIEF.test(clean)) return [{ text: clean, source: "brief" }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of clean.matchAll(PASTED)) {
    if (m.index! > last) out.push({ text: clean.slice(last, m.index), source: "you" });
    out.push({ text: m[1] ?? "", source: "pasted" });
    last = m.index! + m[0].length;
  }
  if (last < clean.length) out.push({ text: clean.slice(last), source: "you" });
  return out.filter((s) => s.text.trim());
}

const NEG = /\b(never|don'?t|do not|not|no|avoid|stop|without|nahi|mat)\b/i;
const REPLACE = /\b(instead of|no longer|not anymore|anymore|switch(?:ed)? to|replace[sd]?|raised to|lowered to|changed to|increased to|reduced to|previous(?:ly)?|superseded)\b/i;

/** The older active rule this one contradicts or updates, if any (newest wins). */
export function findReplaced(s: string, active: ActiveRule[]): { id: string; sure: boolean } | null {
  const a = new Set(contentWords(s));
  if (!a.size) return null;
  let best: { id: string; overlap: number; flip: boolean } | null = null;
  for (const r of active) {
    const b = new Set(contentWords(r.text));
    if (!b.size) continue;
    const shared = [...a].filter((w) => b.has(w)).length;
    const overlap = shared / Math.min(a.size, b.size);
    const flip = NEG.test(s) !== NEG.test(r.text) || REPLACE.test(s);
    if (flip && overlap >= 0.35 && (!best || overlap > best.overlap)) best = { id: r.id, overlap, flip };
  }
  return best ? { id: best.id, sure: best.overlap >= 0.5 } : null;
}

