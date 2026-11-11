// Text helpers for comparing short notes: content words (stop words dropped, light stemming), shared numbers, overlap.
const STOP = new Set("a an the and or of to in on for with is are be this that it as at by from into not no do don't dont never always must use using only every each all any e.g. i.e. e.g i.e etc please don".split(" "));
/** Short forms people type, so "env vars" and "environment variables" are the same words. */
const SHORT: Record<string, string> = { env: "environment", envs: "environment", var: "variable", vars: "variable", repo: "repository", repos: "repository", config: "configuration", deps: "dependency", dep: "dependency", docs: "documentation", prefs: "preference", msg: "message", msgs: "message", dir: "directory", dirs: "directory" };

/** Light stemming so "replies"/"reply", "runs"/"run" match (summaries paraphrase). */
const stem = (w: string) => (w.length <= 4 ? w : w.replace(/ies$/, "y").replace(/(ing|ed|es|s)$/, ""));

export function contentWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[`*_"'()[\]{}<>]/g, " ")
    .split(/[^a-z0-9./+-]+/)
    .map((w) => w.replace(/[.,;:!?]+$/, "")) // "echo." is "echo" (dots inside stay: file.ts, e.g.)
    .map((w) => SHORT[w] ?? w)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map(stem);
}

// words that say a fact changed, not what it is ("Change: the limit is now 120, not 50" ≈ "Limit is 120 (supersedes the old 50)")
const CHANGE_WORDS = new Set(["change", "now", "old", "new", "previous", "previously", "supersed", "instead", "our", "we", "also"]);
// dates say when, not what: "revised on 2026-11-09" doesn't make it a different fact
export const numbers = (s: string) => [...new Set(s.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ").match(/\d+(?:\.\d+)?/g) ?? [])].sort().join(",");

/**
 * Two records that state the same fact in different words (an AI's pin and Cortex's own capture of one message).
 * Same numbers, and 70% of the shorter one's key words in the other. Negation isn't checked here: callers
 * exclude the record a new rule replaces, so "use pnpm, not npm" never counts as the old "use npm".
 */
export function sameFact(a: string, b: string): boolean {
  if (numbers(a) !== numbers(b)) return false;
  const wa = new Set(contentWords(a).filter((w) => !CHANGE_WORDS.has(w)));
  const wb = new Set(contentWords(b).filter((w) => !CHANGE_WORDS.has(w)));
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  if (small.size < 3) return false;
  return [...small].filter((w) => big.has(w)).length / small.size >= 0.7;
}


/** Share of the smaller word set found in the other (1 = one says everything the other does). */
export function overlap(a: string, b: string): number {
  const wa = new Set(contentWords(a)), wb = new Set(contentWords(b));
  const [small, big] = wa.size <= wb.size ? [wa, wb] : [wb, wa];
  return small.size ? [...small].filter((w) => big.has(w)).length / small.size : 0;
}
