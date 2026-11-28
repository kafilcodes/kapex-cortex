// What a message says beyond its rules (v4.6, from the 3-arm benchmark's misses): a guardrail meant only for this turn,
// a message that only asks questions, an approach you tried and dropped, and the step you named for next time.

/** "Don't edit anything." / "Don't change anything for now.": a blanket guardrail for this turn (a read-only question),
 * never a standing rule. A rule that names what to leave alone stays one, "yet" or not ("Do NOT touch main yet"). */
const BLANKET = /^(?:please\s+)?(?:don'?t|do not|never)\s+(?:edit|change|touch|modify|write|commit|run)\s+(?:anything|any files?|any code|a thing)(?:\s+(?:yet|for now|right now|this time|here))?\s*[.!]?$/i;
export const turnScoped = (rule: string): boolean => BLANKET.test(rule.trim().replace(/^[“"]|[”"]$/g, ""));

/** A message that only asks (a probe, a status question), after a read-only lead-in: no task in it to become a goal.
 * "Can you add X?" and "Please …?" are requests, so they count as a task. */
const READ_ONLY = /^(?:please\s+)?(?:(?:don'?t|do not)\s+(?:edit|change|touch|modify|write)\s+anything(?:\s+yet)?|just answer|answer\b[^.!?:]{0,60}|tell me\b[^.!?:]{0,60}|explain\b[^.!?:]{0,60})[.:!]?$/i;
export function questionOnly(text: string): boolean {
  if (!text.includes("?")) return false;
  const sentences = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const rest = sentences.filter((s) => !s.trim().endsWith("?") || /^\s*(?:\d+[).]\s*)?(?:can|could|would|will) you\b|^\s*please\b/i.test(s))
    .map((s) => s.trim()).filter((s) => !READ_ONLY.test(s)).join(" ").replace(/\b\d+[).]\s*/g, "").trim();
  return rest.length < 15;
}

/** "We tried throwing before and the callers crashed": what was tried and why it was dropped. A failure word is
 * required, so "we tried the new API and it works" is no rejection. */
const TRIED = /\b(?:we|i)\s+(?:already\s+)?(?:tried|attempted)\s+([^.;!?]{3,120}?)(?:\s+(?:before|earlier|last time|already))?(?:,\s*|\s+)(?:and|but)\s+([^.;!?]*?\b(?:crash(?:ed|es)?|fail(?:ed|s)?|broke|breaks?|didn'?t work|did not work|was too slow|hung|leaked|timed out|blew up|errored)\b[^.;!?]*)/gi;
export function triedAndDropped(text: string): { what: string; why: string }[] {
  return [...text.matchAll(TRIED)].map((m) => ({ what: m[1]!.trim(), why: m[2]!.trim() }));
}

/** The step you named for next time, in your own words ("Next time: add a modulo function the same way."). */
export function nextYouNamed(text: string): string | null {
  const m = /(?:^|[.!?]\s+|\n)\s*(?:next time\s*[:：,]|(?:next(?: step)?|tomorrow)\s*[:：])\s*([^\n]{8,300})/i.exec(text);
  return m ? m[1]!.trim() : null;
}
