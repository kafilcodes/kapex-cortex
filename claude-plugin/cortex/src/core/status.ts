import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { dreaming, listDreams, type DreamReport } from "./dream.ts";
import { readMemoryCheck } from "./tiers.ts";
import { readEpisodes, type EpisodeView } from "./episodes.ts";
import { computeHistory, type History } from "./history.ts";
import { firstName } from "./identity.ts";
import { nativeSummary, type NativeFile } from "./native.ts";
import type { RepoPaths } from "./paths.ts";
import { readPrefs, type Prefs } from "./prefs.ts";
import { shortCommand, statePath } from "./state.ts";
import { buildTimeline, type TimelineEvent } from "./timeline.ts";
import { toolUsage, type Usage } from "./usage.ts";
import { projectSpend, type Spend } from "./spend.ts";
import { parkView, type ParkView } from "./park.ts";
import { cortexFootprint } from "./plugin.ts";
import { auditSafety, type SafetyView } from "./safety.ts";

/** One snapshot of everything the panel, the strip and `kc s` show. Built from files on disk and a few git calls. */
export interface Status {
  project: string;
  root: string;
  /** your first name for the greeting ('' = no greeting) */
  name: string;
  /** the session journal, newest first */
  episodes: EpisodeView[];
  timeline: TimelineEvent[];
  /** what a new chat will know after /cortex-resume, and what that costs */
  handoff: { exists: boolean; ageMinutes: number | null; ready: boolean; from: string; session?: string; preview?: { exchanges: number; files: number; openItems: number; tokens: number; lastCheck: string; goal: string; next: string; instructions: number; decisions: number; trail: number; commits: number; flagged: number } };
  /** Claude Code's own memory files: what loads into every session, and what each costs */
  native: { files: NativeFile[]; alwaysTokens: number; alwaysLines: number; autoMemory: { dir: string; enabled: boolean } };
  /** Dreams: one running now, and the recent ones (newest first) */
  dream: { running: { since: string } | null; recent: DreamReport[] };
  git: { branch: string; dirty: number; untracked: number; wip: { ref: string; sha: string; at: string } | null } | null;
  hooks: { p95: number | null; samples: number; cap: number; recent?: number[] };
  opencode: { installed: boolean; plugin: boolean };
  footprint: { tokens: number; skills: number; duplicates: number };
  safety: SafetyView;
  history: History;
  /** skills, MCP servers and tools used in the last 20 Claude Code chats here */
  usage: Usage;
  /** tokens this project's chats used (from Claude Code's transcripts), and chats resumed from a handoff */
  spend: Spend;
  /** MCP servers parked for this project: Cortex's record and what Claude Code's config says now */
  parked: ParkView;
  /** measured, each on its own: memory size against Claude Code's limits, scoped rules, open findings, clean checks */
  memHealth: { files: { label: string; lines: number; limit: number }[]; scopedTokens: number; alwaysTokens: number; open: number; checks: number; clean: number };
  prefs: Prefs & { overridden: string[]; tokens: { handoff: number } };
  /** set when this project's v2 memories were archived on the way to v3 */
  migrated?: string;
  stateAt: string | null;
  health: "good" | "attention";
}

function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 1_500 });
  return r.status === 0 ? r.stdout.trim() : null;
}

function gitStatus(root: string): Status["git"] {
  const st = git(root, ["status", "--porcelain=v2", "--branch"]);
  if (st === null) return null;
  const lines = st.split("\n");
  const branch = lines.find((l) => l.startsWith("# branch.head "))?.slice(14) ?? "(detached)";
  const dirty = lines.filter((l) => /^[12u] /.test(l)).length;
  const untracked = lines.filter((l) => l.startsWith("? ")).length;
  const refs = git(root, ["for-each-ref", "--sort=-creatordate", "--count=1", "--format=%(refname) %(objectname:short) %(creatordate:iso-strict)", "refs/cortex/wip/"]);
  const [ref, sha, at] = (refs ?? "").split(" ");
  return { branch, dirty, untracked, wip: ref ? { ref, sha: sha ?? "", at: at ?? "" } : null };
}

/** Real hook timings, written by the hooks themselves (last 50). */
export function hookP95(p: RepoPaths): { p95: number | null; samples: number; recent?: number[] } {
  try {
    const xs = (JSON.parse(readFileSync(join(p.priv, "hook-times.json"), "utf8")) as number[]).slice(-50);
    if (!xs.length) return { p95: null, samples: 0 };
    const sorted = [...xs].sort((a, b) => a - b);
    return { p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]!), samples: xs.length, recent: xs.slice(-30).map((x) => Math.round(x)) };
  } catch {
    return { p95: null, samples: 0 };
  }
}

const minutesSince = (path: string): number | null => { try { return Math.round((Date.now() - statSync(path).mtimeMs) / 60_000); } catch { return null; } };

export function computeStatus(p: RepoPaths): Status {
  const prefs = readPrefs(p);
  const sp = statePath(p);
  const head = existsSync(sp) ? readFileSync(sp, "utf8") : "";
  const recent = listDreams(p, 12);
  const history = computeHistory(p);
  let migrated: string | undefined;
  try { migrated = (JSON.parse(readFileSync(p.marker, "utf8")) as { archive?: string }).archive; } catch { /* new project */ }
  const s: Status = {
    project: basename(p.root),
    root: p.root,
    name: firstName(prefs),
    episodes: readEpisodes(p, 12).map((e) => ({ ...e, commands: e.commands.slice(0, 4), files: e.files.slice(0, 6) })),
    timeline: buildTimeline(p, history, recent),
    handoff: {
      exists: !!head,
      ageMinutes: head ? minutesSince(sp) : null,
      ready: /HANDOFF READY/.test(head),
      session: /· session ([^\s·]+)/.exec(head.split("\n")[0] ?? "")?.[1] ?? "",
      from: /· from ([^ ]+)/.exec(head.split("\n")[0] ?? "")?.[1] ?? "",
      preview: head ? {
        exchanges: (head.match(/^### You /gm) ?? []).length,
        files: (/^Edited in the last turns: (.+)$/m.exec(head)?.[1]?.match(/`/g)?.length ?? 0) / 2,
        openItems: (head.match(/^- \[ \] /gm) ?? []).length,
        tokens: Math.round(head.length / 4),
        lastCheck: (/^## Last check\n(.+)$/m.exec(head)?.[1] ?? "").replace(/^`([^`]*)`/, (_, c: string) => shortCommand(c)).replace(/`/g, "").slice(0, 90),
        goal: (/^## Goal\n(.+)$/m.exec(head)?.[1] ?? "").slice(0, 300),
        next: (/^## Next action\n(.+)$/m.exec(head)?.[1] ?? "").slice(0, 300),
        instructions: (head.match(/ _\(turn \d+\)_$/gm) ?? []).length,
        decisions: (/\*\*Decisions recorded at handoff:\*\*\n((?:- .*\n?)+)/.exec(head)?.[1]?.match(/^- /gm) ?? []).length,
        trail: (head.match(/^- T\d+ /gm) ?? []).length + Number(/^- … (\d+) earlier turn/m.exec(head)?.[1] ?? 0),
        commits: (/^\*\*Commits this session\*\*.*$/m.exec(head)?.[0]?.match(/`[^`]+`/g) ?? []).length,
        flagged: readMemoryCheck(p)?.open.length ?? 0,
      } : undefined,
    },
    native: nativeSummary(p.root),
    dream: { running: dreaming(p), recent },
    git: gitStatus(p.root),
    hooks: { ...hookP95(p), cap: 150 },
    opencode: { installed: existsSync(join(homedir(), ".opencode", "bin", "opencode")), plugin: existsSync(join(p.root, ".opencode", "plugins", "kapex-cortex.ts")) },
    footprint: cortexFootprint(),
    safety: auditSafety(p),
    history,
    usage: toolUsage(p),
    spend: projectSpend(p),
    parked: parkView(p),
    memHealth: memHealth(p, nativeSummary(p.root), recent),
    prefs: { ...prefs, tokens: { handoff: Math.round(head.length / 4) } },
    ...(migrated ? { migrated } : {}),
    stateAt: head ? new Date(statSync(sp).mtimeMs).toISOString() : null,
    health: "good",
  };
  const waiting = recent.find((d) => d.status === "proposed" && d.findings.some((f) => f.action.op !== "none"));
  s.health = waiting || s.handoff.ready || s.native.files.some((f) => f.over && f.loads === "first-200") ? "attention" : "good";
  return s;
}

export const ago = (m: number | null) =>
  m === null ? "never" : m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;

/** The status card (plain Markdown, renders in Claude Code and OpenCode). */
export function statusMarkdown(s: Status): string {
  const last = s.dream.recent[0];
  const over = s.native.files.filter((f) => f.over);
  return [
    `### ${s.health === "good" ? "●" : "◐"} Kapex Cortex · ${s.project}`,
    "",
    "| | |",
    "|---|---|",
    `| **Handoff** | ${s.handoff.exists ? `${ago(s.handoff.ageMinutes)}${s.handoff.from ? ` from ${s.handoff.from}` : ""}${s.handoff.ready ? " · **ready to resume**" : ""} · about ${s.prefs.tokens.handoff.toLocaleString()} tokens to start` : "none yet"} |`,
    `| **Memory in every session** | ${s.native.alwaysLines} lines · about ${s.native.alwaysTokens.toLocaleString()} tokens · auto memory ${s.native.autoMemory.enabled ? "on" : "off"} |`,
    `| **Too long** | ${over.length ? over.map((f) => `${f.label} (${f.over})`).join("; ") : "nothing"} |`,
    `| **Last Dream** | ${s.dream.running ? "running now" : last ? `${last.status} · ${last.findings.length} finding${last.findings.length === 1 ? "" : "s"} · ${ago(Math.round((Date.now() - Date.parse(last.ts)) / 60_000))}` : "none yet (kc dream)"} |`,
  ].join("\n");
}

export function statusText(s: Status): string {
  return statusMarkdown(s).replace(/^### /, "").replace(/\*\*/g, "").replace(/^\|---\|---\|\n?/m, "").replace(/^\| \| \|\n/m, "");
}

/** Memory health as separate measurements, never one made-up score. */
function memHealth(p: RepoPaths, n: ReturnType<typeof nativeSummary>, recent: DreamReport[]): Status["memHealth"] {
  const always = n.files.filter((f) => f.loads !== "on-demand")
  const checks = recent.filter((d) => d.status !== "failed" && !d.model)
  return {
    // Claude Code loads auto memory's first 200 lines; for CLAUDE.md and rules, Anthropic's guidance is under 200 lines
    files: always.map((f) => ({ label: f.label, lines: f.lines, limit: 200 })),
    scopedTokens: n.files.filter((f) => f.loads === "on-demand" && f.paths).reduce((a, f) => a + Math.round(f.bytes / 4), 0),
    alwaysTokens: n.alwaysTokens,
    open: readMemoryCheck(p)?.open.length ?? 0,
    checks: checks.length,
    clean: checks.filter((d) => !d.findings.length).length,
  };
}
