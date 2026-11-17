import { segments } from "./judge.ts";
import type { RepoPaths } from "./paths.ts";
import type { HandoffNote } from "./state.ts";
import type { Carry } from "./carry.ts";
import { readTurns, type Turn } from "./turns.ts";

/**
 * The brief (layer 1 of the context pack): what a fresh chat needs to continue, and nothing more.
 * Deterministic, no model calls. It fixes the stale-handoff problem: a goal written by /cortex-handoff in
 * an earlier session is no longer shown as today's goal; this session's own requests win.
 */
export interface Brief {
  goal: string;
  next: string;
}

const oneLine = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const age = (ms: number) => { const m = Math.round(ms / 60_000); return m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`; };

/** The part of a message that is the person's request: briefs → their Task, pasted blocks and harness output left out. */
export function requestText(t: Turn): string {
  const segs = segments(t.text);
  if (segs.some((s) => s.source === "command")) return "";
  const brief = segs.find((s) => s.source === "brief");
  if (brief) return /\nTask:\s*\n([\s\S]+)/.exec(brief.text)?.[1]?.trim() ?? "";
  return segs.filter((s) => s.source === "you").map((s) => s.text).join(" ").trim();
}

/** `@"path"` and `@path` attachments are file names, not the request. */
export const noRefs = (s: string) => s.replace(/@"[^"]*"/g, " ").replace(/(^|\s)@[^\s]+/g, " ").replace(/\s+/g, " ").trim();

/** The request in a message: your own words without attachments; if that leaves nothing, the start of what you pasted. */
export function askOf(t: Turn): string {
  const own = noRefs(requestText(t).replace(/^\/[\w:-]+\s*/, ""));
  if (own.length >= 15) return own;
  const pasted = segments(t.text).find((s) => s.source === "pasted")?.text.trim() ?? "";
  const body = noRefs(pasted.replace(/^\/[\w:-]+\s*/, ""));
  return body.length >= 15 ? `(pasted) ${body}` : own;
}

/** A "Next:" / "Next step:" / "Next action:" line in the assistant's last reply, if it wrote one. */
export function nextFromReply(reply: string): string {
  const m = /^\s*(?:[-*]\s*)?(?:\*\*)?next(?: action| step)?(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+)$/im.exec(reply)
    // also mid-paragraph, after a sentence ends: "Docs done. Next: add CSV export." (the last such one wins)
    ?? [...reply.matchAll(/[.!?)]\s+(?:\*\*)?Next(?: action| step)?(?:\*\*)?\s*[:：]\s*(.+)/g)].at(-1) ?? null;
  return m ? oneLine(m[1]!.replace(/\*\*/g, ""), 300) : "";
}

/** Sentences that carry on with the work rather than state it ("Continue", "The 5-hour limit has reset", "Read
 * .vault/STATE.md first", "we are continuing from yesterday"). */
export const CONTINUES = /^(?:(?:hey|hi|ok(?:ay)?|yes|so|now|alright)\b[\s,.!:-]*)*(?:please\s+)?(?:continue|resume|proceed|carry on|go on|keep going|pick (?:it )?up|let'?s continue|we(?:'re| are) continuing|(?:the )?(?:5|five)[- ]hour limit (?:has |is )?reset|(?:the |my |our )?(?:usage |rate )?limits? (?:has |have |is |are )?(?:been )?reset|(?:first,?\s*)?read [`"]?\.vault\/STATE\.md|\/cortex-resume|resume from the kapex cortex handoff)\b/i;
/** What may follow a lead-in for its sentence to be only a continuation: punctuation, a bracket, the end, or filler
 * ("Continue: …", "continue (we are back…", "we are continuing from…", "Read .vault/STATE.md first…"). Anything else
 * ("Continue building the export", "Resume work on the webhook") is the task itself and is kept whole. */
const FILLER = /^\s*[`"']?\s*(?:[.!?;:,(\-–—]|$|(?:from|where|after|again|first|now|and|so|please|then)\b)/i;
/** A message without its lead-in continuation sentences: "Continue: the limit reset. Now add CSV export" → "Now add
 * CSV export"; "Read STATE.md first, then fix the login test" → "fix the login test"; only a continuation → "". */
export function withoutLeadIn(text: string): string {
  let t = text.trim();
  for (let i = 0; i < 6; i++) {
    const m = CONTINUES.exec(t);
    if (!m) break;
    const rest = t.slice(m[0].length);
    if (!FILLER.test(rest)) break;
    const end = /[.!?;:](?=\s|$)|\n/.exec(rest);
    const sentence = end ? rest.slice(0, end.index) : rest;
    // "…first, then fix the login test" / "…and now add the heatmap": what follows then/now in it is the task
    const turn = /(?:^|[\s,;(])(?:and\s+)?(?:then|now)\s+(?!(?:continue|carry on|go on|proceed|resume)\b)/i.exec(sentence);
    if (turn) { t = (sentence.slice(turn.index + turn[0].length) + (end ? rest.slice(end.index) : "")).trim(); continue; }
    t = end ? rest.slice(end.index + 1).trim() : "";
  }
  return t;
}

export function buildBrief(p: RepoPaths, a: { session: string; lastAssistant?: string; handoff: HandoffNote | null; heading: string; now: Date; carry?: Carry | null }): Brief {
  const all = readTurns(p, a.session).map((t) => ({ ts: t.ts, text: askOf(t) })).filter((t) => t.text.length >= 15);
  // a continuation keeps the goal it continues: what a message says after its lead-in ("Continue: the limit reset.")
  // is what can become the goal, and a message that is only a continuation never does
  const asks = all.map((t) => ({ ts: t.ts, text: withoutLeadIn(t.text.replace(/^\(pasted\)\s*/, "")) })).filter((t) => t.text.length >= 15);
  const first = asks[0];
  const latest = all.at(-1);
  // the current goal is the most recent real task statement ("Yes, do it" replies don't count), else the first ask
  // …unless you named it: an explicit "Goal: …" wins over the longest recent message
  const named = [...asks].reverse().find((t) => /^(?:the )?goal\s*[:：-]/i.test(t.text));
  const task = named ?? [...asks].reverse().find((t) => t.text.length >= 60) ?? first;
  const h = a.handoff;
  // no turns recorded yet (kc handoff run on its own): the handoff you just wrote is this session's goal and next step
  const thisSession = !!h && (h.session === a.session || !all[0] || h.ts >= all[0].ts);
  const handoffAge = h ? age(a.now.getTime() - Date.parse(h.ts)) : "";

  let goal: string;
  const stated = asks.some((t) => t.text.length >= 60); // a real task said in this chat, not just "docs pass 2"
  if (thisSession && h?.goal) goal = h.goal;
  else if (a.carry?.goal && !stated) goal = `${a.carry.goal}\n\n_Carried from the chat this one continues (“${a.carry.chat}”)._`;
  else if (task) goal = oneLine(task.text, 300) + (h?.goal ? `\n\n_Earlier handoff goal (${handoffAge} ago, another session; may be done): ${oneLine(h.goal, 200)}_` : "");
  else if (h?.goal) goal = `${h.goal}\n\n_From an earlier session (${handoffAge} ago). It may be done: check the working tree and git log first._`;
  else goal = a.heading || "_Not set. Run /cortex-handoff to record one._";

  const fromReply = nextFromReply(a.lastAssistant ?? "");
  let next: string;
  if (thisSession && h?.next && (!latest || h.ts >= latest.ts)) next = h.next;
  else if (fromReply) next = fromReply;
  else if (latest && latest.ts !== task?.ts) next = `Continue: ${oneLine(latest.text, 300)}`; // by time: asks are copies of all
  else next = "Continue from the last assistant message below; confirm with the user if it is unclear.";

  return { goal, next };
}
