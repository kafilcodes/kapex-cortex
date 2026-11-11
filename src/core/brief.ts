import { segments } from "./judge.ts";
import type { RepoPaths } from "./paths.ts";
import type { HandoffNote } from "./state.ts";
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
  const m = /^\s*(?:[-*]\s*)?(?:\*\*)?next(?: action| step)?(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*(.+)$/im.exec(reply);
  return m ? oneLine(m[1]!.replace(/\*\*/g, ""), 300) : "";
}

export function buildBrief(p: RepoPaths, a: { session: string; lastAssistant?: string; handoff: HandoffNote | null; heading: string; now: Date }): Brief {
  const asks = readTurns(p, a.session).map((t) => ({ ts: t.ts, text: askOf(t) })).filter((t) => t.text.length >= 15);
  const first = asks[0];
  const latest = asks.at(-1);
  // the current goal is the most recent real task statement ("Yes, do it" replies don't count), else the first ask
  const task = [...asks].reverse().find((t) => t.text.length >= 60) ?? first;
  const h = a.handoff;
  const thisSession = !!h && (h.session === a.session || (!!first && h.ts >= first.ts));
  const handoffAge = h ? age(a.now.getTime() - Date.parse(h.ts)) : "";

  let goal: string;
  if (thisSession && h?.goal) goal = h.goal;
  else if (task) goal = oneLine(task.text, 300) + (h?.goal ? `\n\n_Earlier handoff goal (${handoffAge} ago, another session; may be done): ${oneLine(h.goal, 200)}_` : "");
  else if (h?.goal) goal = `${h.goal}\n\n_From an earlier session (${handoffAge} ago). It may be done: check the working tree and git log first._`;
  else goal = a.heading || "_Not set. Run /cortex-handoff to record one._";

  const fromReply = nextFromReply(a.lastAssistant ?? "");
  let next: string;
  if (thisSession && h?.next && (!latest || h.ts >= latest.ts)) next = h.next;
  else if (fromReply) next = fromReply;
  else if (latest && latest !== task) next = `Continue: ${oneLine(latest.text, 300)}`;
  else next = "Continue from the last assistant message below; confirm with the user if it is unclear.";

  return { goal, next };
}
