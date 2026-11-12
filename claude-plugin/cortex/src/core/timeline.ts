import { spawnSync } from "node:child_process";
import { readEpisodes } from "./episodes.ts";
import type { History } from "./history.ts";
import type { RepoPaths } from "./paths.ts";
import type { DreamReport } from "./dream.ts";

/**
 * One timeline for the panel, newest first: turns (with tests, files, commits), git commits, merges and pushes,
 * handoffs and Dreams. Built from data already on disk plus two cheap git calls; nothing is stored twice.
 */
export interface TimelineEvent {
  id: string; ts: string;
  kind: "turn" | "commit" | "merge" | "handoff" | "dream";
  title: string; detail?: string; tags: string[]; tone: "ok" | "warn" | "bad" | "info";
}
const MAX = 80;

function git(root: string, args: string[]): string {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 1_500 });
  return r.status === 0 ? r.stdout : "";
}

/** Recent commits, with merges marked and whether each is already on the remote (pushed). */
export function gitEvents(root: string, limit = 25): TimelineEvent[] {
  const out = git(root, ["log", `-n${limit}`, "--format=%h%x09%cI%x09%P%x09%D%x09%s"]);
  if (!out) return [];
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const remote = new Set(git(root, ["rev-list", "--abbrev-commit", `--max-count=${limit * 2}`, `origin/${branch}`]).split("\n").map((x) => x.trim()).filter(Boolean));
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [sha = "", ts = "", parents = "", refs = "", subject = ""] = line.split("\t");
    const merge = parents.trim().split(" ").length > 1;
    const tags = [sha, ...refs.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "tag ")).filter((r) => r && !r.startsWith("origin/") && r !== "HEAD")];
    if (remote.size) tags.push([...remote].some((r) => r.startsWith(sha) || sha.startsWith(r)) ? "pushed" : "not pushed");
    return { id: `git-${sha}`, ts: iso(ts), kind: merge ? "merge" : "commit", title: subject.slice(0, 140), tags, tone: "info" } as TimelineEvent;
  });
}

/** Any date string as UTC ISO ("" when it isn't a date). */
const iso = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };

export function buildTimeline(p: RepoPaths, history: History, dreams: DreamReport[]): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  for (const e of readEpisodes(p, 40)) {
    const tags: string[] = [];
    if (e.files.length) tags.push(`${e.files.length} file${e.files.length === 1 ? "" : "s"}`);
    const red = e.tests.failed > 0 && e.tests.lastOk !== true; // a failure fixed later in the turn is a pass
    if (e.tests.ran) tags.push(red ? "tests failed" : e.tests.failed ? `tests passed · ${e.tests.failed} fixed` : "tests passed");
    if (e.commits) tags.push(`${e.commits} commit${e.commits === 1 ? "" : "s"}`);
    if (e.errors) tags.push(`${e.errors} error${e.errors === 1 ? "" : "s"}`);
    if (e.interrupted) tags.push("interrupted");
    const tone = red ? "bad" : e.interrupted || e.errors > 2 ? "warn" : "ok";
    ev.push({ id: `turn-${e.id}`, ts: e.end, kind: "turn", title: e.ask || "Follow-up turn (no new message from you)", detail: e.done || undefined, tags, tone });
  }
  ev.push(...gitEvents(p.root));
  for (const h of history.states) ev.push({ id: `hand-${h.session}-${h.at}`, ts: h.at, kind: "handoff", title: "Handoff saved", detail: h.goal || undefined, tags: [h.from || "unknown tool"], tone: "info" });
  for (const d of dreams.filter((x) => x.status !== "replaced")) { // a replaced Dream is noise: the newer one says it all
    const n = d.findings.filter((f) => f.action.op !== "none").length;
    const title = d.status === "failed" ? "Dream failed" : d.status === "applied" ? `Dream applied: ${n} change${n === 1 ? "" : "s"}` : d.status === "undone" ? "Dream undone" : d.status === "discarded" ? "Dream discarded" : d.status === "replaced" ? "Dream (replaced by a newer one)" : n ? `Dream: ${n} change${n === 1 ? "" : "s"} to review` : d.findings.length ? `Dream: ${d.findings.length} note${d.findings.length === 1 ? "" : "s"} for you to check` : "Dream: memory matches what happened";
    ev.push({ id: `dream-${d.id}`, ts: d.ts, kind: "dream", title, detail: d.error ?? d.modelError, tags: [d.model ?? "checks only", `${d.transcripts} chats read`], tone: d.status === "failed" ? "bad" : d.status === "proposed" && n ? "warn" : "ok" });
  }
  // newest first by real time: every source is turned into UTC ISO first, so "+05:30" git dates sort right
  return ev.filter((e) => e.ts && !Number.isNaN(Date.parse(e.ts))).map((e) => ({ ...e, ts: iso(e.ts) })).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts)).slice(0, MAX);
}
