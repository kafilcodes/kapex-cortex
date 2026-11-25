import { spawnSync } from "node:child_process";
import { cachedGit, gitKey } from "./gitcache.ts";
import { compactEpisode, readEpisodes, type EpisodeView } from "./episodes.ts";
import { computeHistory, type History } from "./history.ts";
import type { RepoPaths } from "./paths.ts";
import { listDreams, type DreamReport } from "./dream.ts";

/**
 * One timeline for the panel, newest first: turns (with tests, files, commits), git commits, merges and pushes,
 * handoffs and Dreams. Built from data already on disk plus two cheap git calls; nothing is stored twice.
 */
export interface TimelineEvent {
  id: string; ts: string;
  kind: "turn" | "commit" | "merge" | "handoff" | "dream";
  title: string; detail?: string; tags: string[]; tone: "ok" | "warn" | "bad" | "info";
}
const MAX = 160; // the status carries the newest 160; the panel loads older ones on demand (olderTimeline)
/** The tool a handoff came from, as people say it. */
const TOOL: Record<string, string> = { "claude-code": "Claude Code", opencode: "OpenCode", hermes: "Hermes" };

function git(root: string, args: string[]): string {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 1_500 });
  return r.status === 0 ? r.stdout : "";
}

/** Recent commits, with merges marked and whether each is already on the remote (pushed). */
export function gitEvents(root: string, limit = 25, before?: string): TimelineEvent[] {
  const out = git(root, ["log", `-n${limit}`, ...(before ? [`--before=${before}`] : []), "--format=%h%x09%cI%x09%P%x09%D%x09%s"]);
  if (!out) return [];
  const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const remote = new Set(git(root, ["rev-list", "--abbrev-commit", `--max-count=${limit * 2}`, ...(before ? [`--before=${before}`] : []), `origin/${branch}`]).split("\n").map((x) => x.trim()).filter(Boolean));
  return out.trim().split("\n").filter(Boolean).map((line) => {
    const [sha = "", ts = "", parents = "", refs = "", subject = ""] = line.split("\t");
    const merge = parents.trim().split(" ").length > 1;
    const tags = [sha, ...refs.split(",").map((r) => r.trim().replace(/^HEAD -> /, "").replace(/^tag: /, "tag ")).filter((r) => r.startsWith("tag "))]; // branch names say little here; the short id and any release tag do
    if (remote.size) tags.push([...remote].some((r) => r.startsWith(sha) || sha.startsWith(r)) ? "pushed" : "not pushed yet");
    return { id: `git-${sha}`, ts: iso(ts), kind: merge ? "merge" : "commit", title: subject.slice(0, 140), tags, tone: "info" } as TimelineEvent;
  });
}

/** A chat named in a few words: its title, or the first words you typed in it (cut on a word, with …). */
export function chatLabel(t: string, n = 48): string {
  const one = t.replace(/\s+/g, " ").replace(/^\(pasted\)\s*/i, "").trim();
  return one.length <= n ? one : `${one.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

/** What you typed, without the attached files (@"path" and @path are file names, not what you asked). */
const said = (ask: string) => ask.replace(/@"[^"]*"/g, " ").replace(/(^|\s)@[^\s]+/g, " ").replace(/\s+/g, " ").trim();

/** Any date string as UTC ISO ("" when it isn't a date). */
const iso = (ts: string) => { const t = Date.parse(ts); return Number.isNaN(t) ? "" : new Date(t).toISOString(); };

/** `info.turnsCut` in: the journal holds turns older than `journal`; `info.more` out: older events exist than those returned. */
export function buildTimeline(p: RepoPaths, history: History, dreams: DreamReport[], journal?: EpisodeView[], before?: string, max = MAX, info: { turnsCut?: boolean; more?: boolean } = {}): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const eps = journal ?? readEpisodes(p, 100);
  // the first thing you typed in each chat (episodes are newest first, so the last one seen is the oldest)
  const firstAsk = new Map<string, string>();
  for (const e of eps) if (e.ask) firstAsk.set(e.session, e.ask);
  for (const e of eps) {
    const tags: string[] = [];
    if (e.files.length) tags.push(`${e.files.length} file${e.files.length === 1 ? "" : "s"}`);
    const red = e.tests.failed > 0 && e.tests.lastOk !== true; // a failure fixed later in the turn is a pass
    if (e.tests.ran) tags.push(red ? "tests failed" : e.tests.failed ? `tests passed · ${e.tests.failed} fixed` : "tests passed");
    if (e.commits) tags.push(`${e.commits} commit${e.commits === 1 ? "" : "s"}`);
    if (e.errors) tags.push(`${e.errors} error${e.errors === 1 ? "" : "s"}`);
    if (e.interrupted) tags.push("interrupted");
    const tone = red ? "bad" : e.interrupted || e.errors > 2 ? "warn" : "ok";
    ev.push({ id: `turn-${e.id}`, ts: e.end, kind: "turn", title: said(e.ask) || (e.ask ? "Attached files" : "Claude continued on its own"), detail: e.done || undefined, tags, tone });
  }
  // the log and what is pushed change only when HEAD, a tag or the remote branch moves: asked of git once per change
  const n = before ? max : 50;
  const commits = cachedGit(p, before ? "events-older" : "events", gitKey(p.root, [String(n), before ?? ""]), () => gitEvents(p.root, n, before));
  ev.push(...commits);
  for (const h of history.states) {
    const chat = chatLabel(h.chat || firstAsk.get(h.session) || "");
    ev.push({ id: `hand-${h.session}-${h.at}`, ts: h.at, kind: "handoff", title: chat ? `Handoff from “${chat}”` : "Handoff saved", detail: h.goal || undefined, tags: [`from ${TOOL[h.from] ?? (h.from || "another tool")}`, ...(h.copies ? [`same in ${h.copies} chats`] : [])], tone: "info" });
  }
  for (const d of dreams.filter((x) => x.status !== "replaced")) { // a replaced Dream is noise: the newer one says it all
    const n = d.findings.filter((f) => f.action.op !== "none").length;
    const title = d.status === "failed" ? "Dream failed" : d.status === "applied" ? `Dream applied: ${n} change${n === 1 ? "" : "s"}` : d.status === "undone" ? "Dream undone" : d.status === "discarded" ? "Dream discarded" : d.status === "replaced" ? "Dream (replaced by a newer one)" : n ? `Dream: ${n} change${n === 1 ? "" : "s"} to review` : d.findings.length ? `Dream: ${d.findings.length} note${d.findings.length === 1 ? "" : "s"} for you to check` : "Dream: memory matches what happened";
    ev.push({ id: `dream-${d.id}`, ts: d.ts, kind: "dream", title, detail: d.error ?? d.modelError, tags: [d.model ? `judged by ${d.model.replace(/^claude · /, "")}` : "Quick check", `${d.transcripts} chat${d.transcripts === 1 ? "" : "s"} read`], tone: d.status === "failed" ? "bad" : d.status === "proposed" && d.findings.some((f) => !f.done && !f.skip) ? "warn" : "ok" });
  }
  // newest first by real time: every source is turned into UTC ISO first, so "+05:30" git dates sort right
  // each source is read only so far back (100 turns, 50 commits, 8 handoffs, 12 Dreams): the list stops where the first
  // of them was cut, so nothing newer than its last event is missing, and Show older fetches from there with no gap
  const t = (x: string) => Date.parse(x);
  let floor = -Infinity;
  if (!before) {
    if (info.turnsCut && eps.length) floor = Math.max(floor, t(eps[eps.length - 1]!.end));
    if (commits.length >= 50) floor = Math.max(floor, t(commits[commits.length - 1]!.ts));
    if (history.states.length >= 8) floor = Math.max(floor, ...history.states.map((h) => t(h.at)).filter(Number.isFinite).slice(-1));
    if (dreams.length >= 12) floor = Math.max(floor, ...dreams.map((d) => t(d.ts)).filter(Number.isFinite).sort((a, b) => b - a).slice(-1));
  }
  // `before` is inclusive (two events can share a second); the panel drops the ones it already has by id
  const cut = before ? t(before) : Infinity;
  const all = ev.filter((e) => e.ts && Number.isFinite(t(e.ts)) && t(e.ts) <= cut && t(e.ts) >= floor).map((e) => ({ ...e, ts: iso(e.ts) })).sort((a, b) => t(b.ts) - t(a.ts));
  info.more = floor > -Infinity || all.length > max;
  return all.slice(0, max);
}

/** The next `limit` events older than `before`, for the panel's Show older past what the status carries: every turn in
 * the journal, git history, handoffs and Dreams, with each turn's details. `more`: older events still exist. */
export function olderTimeline(p: RepoPaths, before: string, limit = 48): { events: TimelineEvent[]; episodes: EpisodeView[]; more: boolean } {
  const cut = Date.parse(before);
  if (Number.isNaN(cut)) return { events: [], episodes: [], more: false };
  const n = Math.max(1, Math.min(200, limit));
  const eps = readEpisodes(p, 100_000).filter((e) => Date.parse(e.end) <= cut).slice(0, n + 1);
  const all = buildTimeline(p, computeHistory(p, eps, 400, 400), listDreams(p, 200), eps, before, n + 1);
  const events = all.slice(0, n);
  const ids = new Set(events.map((e) => e.id));
  return { events, episodes: eps.filter((e) => ids.has(`turn-${e.id}`)).map(compactEpisode), more: all.length > n };
}
