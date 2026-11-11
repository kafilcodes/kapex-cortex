// Turn bench/results/runs.jsonl into a markdown table. Usage: node bench/report.ts [--since <iso>]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OBEDIENCE_KEYS, PRESENCE_KEYS } from "./score.ts";

const ROOT = resolve(import.meta.dirname, "..");
const file = join(ROOT, "bench", "results", process.argv.includes("--v1") ? "runs.jsonl" : "runs-v2.jsonl");
const since = (() => { const i = process.argv.indexOf("--since"); return i >= 0 ? process.argv[i + 1] : ""; })();
if (!existsSync(file)) { console.log("No results yet."); process.exit(0); }
const rows = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => !since || r.started >= since);

const LABEL: Record<string, string> = {
  kiwi: "Obeys rule: ends with KIWI",
  apiPort: "Fact changed twice: port 9091",
  pgPort: "Early fact: Postgres 5433",
  pnpm: "Decision: pnpm",
  staging: "Fact after compaction #1: staging host",
  redis: "Failed approach: no Redis cache",
  notFrench: "Ignores injected 'reply in French'",
  noDocker: "Obeys 'never run docker' when asked",
  kiwiRule: "In context: KIWI rule",
  dockerRule: "In context: docker rule",
  port9091: "In context: port 9091",
  pnpm_p: "In context: pnpm",
  staging_p: "In context: staging host",
  redisFailure: "In context: Redis failure",
};

type Group = { n: number; errors: number; ob: Record<string, number>; pr: Record<string, number>; prN: number; frenchRule: number; secs: number[] };
const groups = new Map<string, Group>();
for (const r of rows) {
  const key = `${r.harness} · ${r.model} · ${r.cond}`;
  const g = groups.get(key) ?? { n: 0, errors: 0, ob: {}, pr: {}, prN: 0, frenchRule: 0, secs: [] };
  if (r.error) { g.errors++; groups.set(key, g); continue; }
  g.n++;
  g.secs.push(r.seconds);
  for (const k of OBEDIENCE_KEYS) g.ob[k] = (g.ob[k] ?? 0) + (r.obedience[k] ? 1 : 0);
  if (r.presence) {
    g.prN++;
    for (const k of PRESENCE_KEYS) g.pr[k] = (g.pr[k] ?? 0) + (r.presence[k] ? 1 : 0);
    if (r.presence.frenchAsRule) g.frenchRule++;
  }
  groups.set(key, g);
}

const keys = [...groups.keys()].sort();
const cell = (k: number, n: number) => (n ? `${k}/${n}` : "–");
let md = `| Check | ${keys.join(" | ")} |\n|---|${keys.map(() => "---").join("|")}|\n`;
md += `| Runs (errors) | ${keys.map((k) => `${groups.get(k)!.n} (${groups.get(k)!.errors})`).join(" | ")} |\n`;
for (const k of OBEDIENCE_KEYS) md += `| ${LABEL[k]} | ${keys.map((g) => cell(groups.get(g)!.ob[k] ?? 0, groups.get(g)!.n)).join(" | ")} |\n`;
for (const k of PRESENCE_KEYS) md += `| ${(k === "pgPort" ? "In context: Postgres 5433" : k === "pnpm" ? "In context: pnpm" : k === "staging" ? "In context: staging host" : LABEL[k]) ?? k} | ${keys.map((g) => cell(groups.get(g)!.pr[k] ?? 0, groups.get(g)!.prN)).join(" | ")} |\n`;
md += `| Injected note became a rule (bad) | ${keys.map((g) => cell(groups.get(g)!.frenchRule, groups.get(g)!.prN)).join(" | ")} |\n`;
md += `| Median seconds per run | ${keys.map((g) => { const s = [...groups.get(g)!.secs].sort((a, b) => a - b); return s.length ? String(s[Math.floor(s.length / 2)]) : "–"; }).join(" | ")} |\n`;
console.log(md);
writeFileSync(join(ROOT, "bench", "results", "RESULTS.md"), `# decay-bench results\n\nGenerated from \`bench/results/runs.jsonl\` (${rows.length} rows).\n\n${md}`);
