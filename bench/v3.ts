// decay-bench v3: the case v2 couldn't separate. v2 planted 9 loudly labelled facts and both runs kept all of
// them. Real chats lose the small things: rules said once, casually, mid-paragraph, then buried under tool
// output and several compactions. v3 plants 12 such rules (one superseded), compacts three times, then asks
// the model to *produce* things that must obey them. Scored with fixed patterns, no model judge.
// Runs on OpenCode's free models only (no Claude plan usage).
// Usage: node bench/v3.ts --model opencode/deepseek-v4.1-flash-free --runs 2 [--lines 200] [--only cortex|vanilla] [--fresh: ask in a new chat]
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { runSteps } from "./opencode.ts";
import { makeFixture } from "./scenario.ts";

const read = (a: number, b: number) => `Read logs/app-${String(a).padStart(2, "0")}.log through logs/app-${String(b).padStart(2, "0")}.log and give me one line per file on anything unusual.`;

export const STEPS: ({ kind: "prompt"; text: string } | { kind: "compact" })[] = [
  { kind: "prompt", text: "We're picking up the link shortener (Go). I'd like a quick health check of the logs first. " + read(1, 4) + " Oh, and when you write commits for this repo they start with `lnk:`, that's how our changelog tool picks them up." },
  { kind: "prompt", text: "Thanks. Some context while you work: the team keeps PR titles all lowercase, and please don't mention Jira anywhere, we moved off it and it confuses people. " + read(5, 8) },
  { kind: "prompt", text: read(9, 12) + " For context on errors: our JSON error responses use the field `err_code`, never `error`. Timestamps in responses are always UTC with a trailing Z." },
  { kind: "compact" },
  { kind: "prompt", text: "Next batch. " + read(13, 16) + " Side note: tests live next to the code in `internal/<pkg>/..._test.go`, we don't have a top-level tests folder. Also logs are logfmt (key=value pairs), not JSON." },
  { kind: "prompt", text: "Our env vars all use the `LNKY_` prefix, e.g. `LNKY_PORT`. " + read(17, 20) + " The rate limit is 50 requests per minute per IP." },
  { kind: "compact" },
  { kind: "prompt", text: read(21, 24) + " We use chi for routing; please don't suggest gin or echo. Short codes are exactly 7 characters, base62." },
  { kind: "prompt", text: "Change: the rate limit is now 120 requests per minute per IP, not 50. And redirects default to 302, not 301, because links can be edited. " + read(25, 27) },
  { kind: "compact" },
];

const MEMORY = "From memory only: don't open, read or search files and don't use tools. ";
export const PROBES = [
  MEMORY + "Write the git commit message and the PR title for adding a POST /api/links/:id/expire endpoint. It was tracked in ticket LNK-42.",
  MEMORY + "Show a short Go snippet: the handler's 404 response body as JSON (include a timestamp field), the log line we emit for it, and the env var name that holds the public base URL.",
  MEMORY + "One short line each: (1) which HTTP router do we use? (2) how long are short codes? (3) which status code do redirects use by default? (4) where do tests go? (5) what is the rate limit now?",
];

export type Score = Record<string, boolean>;

/** An old/wrong value given as the *current* one, not merely mentioned as replaced ("302, not 301", "raised from 50", "no gin"). */
function statedAsCurrent(text: string, wrong: RegExp): boolean {
  const before = /(?:\bnot|\bno|\bold|\bfrom|instead of|replaces?|raised from|was|never|don'?t)\W{0,3}(?:\w+\W+){0,2}$/i;
  const after = /^[^.\n]*(?:\bnot\b|instead|no longer|any ?more|before|previous|was\b|old|obsolete|outdated|replaced|superseded)/i;
  for (const m of text.matchAll(new RegExp(wrong.source, wrong.flags.includes("g") ? wrong.flags : wrong.flags + "g"))) {
    const pre = text.slice(Math.max(0, m.index! - 30), m.index);
    const post = text.slice(m.index! + m[0].length, m.index! + m[0].length + 60);
    if (!before.test(pre) && !after.test(post)) return true;
  }
  return false;
}
export function score(r: string[]): Score {
  const [a = "", b = "", c = ""] = r;
  const lines = a.split("\n").map((l) => l.replace(/^[\s>*`#-]+|[`*]+$/g, "").trim()).filter(Boolean);
  const ti = lines.findIndex((l) => /pr title|title:/i.test(l));
  const inline = ti >= 0 ? lines[ti]!.replace(/^.*?(pr title|title)\s*[:：-]\s*/i, "").trim() : "";
  // the title is either after "PR title:" on the same line, or on the next line (often in a code block)
  const title = inline && !/^(pr title|title)$/i.test(inline) ? inline : (lines[ti + 1] ?? "");
  return {
    commitPrefix: /(^|\n)[\s>*`#-]*lnk:/i.test(a),
    lowercaseTitle: !!title && title === title.toLowerCase(),
    noJira: !/jira/i.test(a + b + c),
    errCode: /err_code/.test(b) && !/"error"\s*:/.test(b),
    utcZ: /\d{2}:\d{2}:\d{2}(\.\d+)?Z|time\.RFC3339|UTC\(\)/.test(b),
    logfmt: /\w+=("[^"]*"|\S+)\s+\w+=/.test(b),
    envPrefix: /LNKY_\w+/.test(b),
    chi: /\bchi\b/i.test(c) && !statedAsCurrent(c, /\b(gin|echo)\b/i),
    sevenChars: /\b7\b|seven/i.test(c),
    redirect302: /302/.test(c) && !statedAsCurrent(c, /\b301\b/),
    testsInternal: /internal\//.test(c),
    rateLimit120: /120/.test(c) && !statedAsCurrent(c, /\b50\b/),
  };
}
export const KEYS = ["commitPrefix", "lowercaseTitle", "noJira", "errCode", "utcZ", "logfmt", "envPrefix", "chi", "sevenChars", "redirect302", "testsInternal", "rateLimit120"];

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1]! : d; };
  const model = arg("--model", "opencode/deepseek-v4.1-flash-free");
  const runs = Number(arg("--runs", "1"));
  const lines = Number(arg("--lines", "200"));
  const only = arg("--only", "");
  const fresh = process.argv.includes("--fresh"); // ask the questions in a brand-new chat
  const steps = fresh ? STEPS.filter((s) => s.kind !== "compact") : STEPS; // a new chat doesn't need compactions first
  const ROOT = resolve(import.meta.dirname, "..");
  const out = join(ROOT, "bench", "results", "runs-v3.jsonl");
  mkdirSync(join(ROOT, "bench", "results"), { recursive: true });
  const [providerID, id] = model.split("/") as [string, string];
  for (let n = 1; n <= runs; n++) {
    for (const cond of (only ? [only] : ["vanilla", "cortex"]) as ("vanilla" | "cortex")[]) {
      const fx = makeFixture({ cortex: cond === "cortex", linesPerFile: lines, cortexBin: join(ROOT, "bin", "cortex") });
      const started = new Date().toISOString();
      try {
        const r = runSteps(fx, { providerID, id }, steps, PROBES, fresh);
        const s = score(r.replies);
        appendFileSync(out, JSON.stringify({ started, version: 3, variant: fresh ? "new-chat" : "compaction", model, cond, run: n, lines, seconds: r.seconds, score: s, replies: r.replies.map((x) => x.slice(0, 1500)), fixture: fx.root }) + "\n");
        console.log(`${fresh ? "new-chat" : "compaction"} ${model} ${cond} #${n} (${r.seconds}s) kept ${KEYS.filter((k) => s[k]).length}/${KEYS.length}: missed ${KEYS.filter((k) => !s[k]).join(", ") || "none"}`);
      } catch (e) {
        appendFileSync(out, JSON.stringify({ started, version: 3, variant: fresh ? "new-chat" : "compaction", model, cond, run: n, lines, error: String((e as Error).message ?? e), fixture: fx.root }) + "\n");
        console.log(`${model} ${cond} #${n} ERROR ${(e as Error).message}`);
      }
    }
  }
}
