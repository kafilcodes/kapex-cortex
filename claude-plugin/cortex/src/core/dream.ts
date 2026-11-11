import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { tryLock } from "../util/lock.ts";
import { ulid } from "../util/ulid.ts";
import { askModel } from "./backends.ts";
import { mechanicalChecks, scopeHints, type Finding } from "./dream-checks.ts";
import { DREAM_SCHEMA, DREAM_SYSTEM, dreamPrompt, parseJudgment } from "./dream-model.ts";
import { commandsIn, gatherEvidence, renderEvidence, transcripts, type Evidence } from "./evidence.ts";
import { autoMemory } from "./home.ts";
import { entries, nativeFiles, type Entry } from "./native.ts";
import type { RepoPaths } from "./paths.ts";
import { readPrefs } from "./prefs.ts";
import { decide, isKept, readKept } from "./dream-decide.ts";
import { writeMemoryCheck } from "./tiers.ts";

/**
 * A Dream (after Anthropic's "dreaming"): read Claude Code's own memory files next to what really happened
 * (transcripts, test runs, git), and propose fixes. Nothing changes until you Apply; every Dream keeps the files
 * as they were (before/) and as Apply wrote them (after/) in .vault/dreams/<id>/, so Apply and Undo are exact
 * and refuse to run if a file changed in between.
 */
export type DreamStatus = "proposed" | "applied" | "discarded" | "undone" | "failed" | "replaced";
export interface DreamFile { path: string; label: string; hash: string | null }
export interface DreamReport {
  id: string; ts: string; status: DreamStatus; ms: number;
  model: string | null; modelError?: string; dropped?: number;
  /** what the model claimed that Cortex's checks refused, and why */
  rejected?: string[];
  transcripts: number; evidenceCount: number; entryCount: number;
  findings: Finding[];
  /** the evidence the findings cite, as Cortex read it (never a model's wording) */
  evidence: Evidence[];
  files: DreamFile[];
  applied?: { at: string; files: DreamFile[] };
  undone?: string;
  error?: string;
  /** findings left out because you kept those notes before */
  kept?: number;
}

const dir = (p: RepoPaths) => join(p.vault, "dreams");
const reportPath = (p: RepoPaths, id: string) => join(dir(p), id, "report.json");
export const runningPath = (p: RepoPaths) => join(dir(p), "running.json");
export const hash = (s: string | null) => (s === null ? null : createHash("sha256").update(s).digest("hex").slice(0, 16));
const read = (f: string): string | null => { try { return readFileSync(f, "utf8"); } catch { return null; } };
export const dreamSnap = (p: RepoPaths, id: string, which: "before" | "after", i: number) => join(dir(p), id, which, `${i}.md`);

export function readDream(p: RepoPaths, id: string): DreamReport | null {
  if (!/^[0-9A-Z]{26}$/.test(id)) return null;
  try { return JSON.parse(readFileSync(reportPath(p, id), "utf8")) as DreamReport; } catch { return null; }
}
export function saveDream(p: RepoPaths, r: DreamReport): void { mkdirSync(join(dir(p), r.id), { recursive: true }); atomicWriteIfChanged(reportPath(p, r.id), JSON.stringify(r, null, 1)); }

/** Every Dream, newest first. */
export function listDreams(p: RepoPaths, max = 20): DreamReport[] {
  if (!existsSync(dir(p))) return [];
  return readdirSync(dir(p)).filter((n) => /^[0-9A-Z]{26}$/.test(n)).sort().reverse().slice(0, max).map((n) => readDream(p, n)).filter((r): r is DreamReport => !!r);
}

/** Is a Dream running right now (started less than 10 minutes ago)? */
export function dreaming(p: RepoPaths): { since: string } | null {
  try { const r = JSON.parse(readFileSync(runningPath(p), "utf8")) as { since: string }; return Date.now() - Date.parse(r.since) < 600_000 ? r : null; } catch { return null; }
}

export async function runDream(p: RepoPaths, o: { model?: boolean; now?: Date } = {}): Promise<DreamReport> {
  const release = tryLock(join(dir(p), "dream.lock"), { waitMs: 0, staleMs: 600_000 });
  if (!release) throw new Error("A Dream is already running.");
  const t0 = Date.now(), now = o.now ?? new Date();
  const prefs = readPrefs(p);
  mkdirSync(dir(p), { recursive: true });
  writeFileSync(runningPath(p), JSON.stringify({ since: now.toISOString() }));
  const r: DreamReport = { id: ulid(now.getTime()), ts: now.toISOString(), status: "proposed", ms: 0, model: null, transcripts: prefs.dreamTranscripts, evidenceCount: 0, entryCount: 0, findings: [], evidence: [], files: [] };
  try {
    const files = nativeFiles(p.root);
    const ents: Entry[] = files.flatMap((f) => { const t = read(f.path); return t === null ? [] : entries(f.path, f.label, t); });
    const ev = gatherEvidence(p.root, { transcripts: prefs.dreamTranscripts, mentioned: [...new Set(ents.flatMap((e) => commandsIn(e.text)))] });
    const found = mechanicalChecks(p.root, files, ents, ev);
    const hints = scopeHints(p.root, files, ents);
    let judged: Omit<Finding, "id">[] = [];
    if (o.model !== false && prefs.dreamBackend !== "off") {
      r.model = `${prefs.dreamBackend}${prefs.dreamModel ? ` · ${prefs.dreamModel}` : ""}`;
      try {
        const raw = await askModel({ backend: prefs.dreamBackend, model: prefs.dreamModel, api: prefs.dreamApi, url: prefs.dreamUrl }, DREAM_SYSTEM, dreamPrompt(files, ents, renderEvidence(ev), found, hints), DREAM_SCHEMA, { timeoutMs: 240_000, effort: "medium", maxTokens: 4_000 });
        const parsed = parseJudgment(raw, files, ents, ev, found);
        judged = parsed.findings;
        r.dropped = parsed.dropped;
        r.rejected = parsed.rejected;
      } catch (err) { r.modelError = String((err as Error).message ?? err).slice(0, 300); }
    } else {
      // without a model, the folder hints become low-key proposals of their own
      judged = hints.map(({ entry: e, dir: d }) => ({ kind: "scope" as const, severity: "low" as const, by: "check" as const, file: e.file, label: e.label, line: e.line, end: e.end, entry: e.text, why: `It only names files under ${d}/, so it could load only when Claude works there.`, evidence: [], action: { op: "move" as const, to: `.claude/rules/${d.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.md`, paths: [`${d}/**`] } }));
    }
    // notes you already said are right stay quiet until their text changes
    const kept = readKept(p);
    const all = [...found, ...judged.map((f, i) => ({ ...f, id: `M${i + 1}` }))];
    r.findings = all.filter((f) => !isKept(kept, f));
    r.kept = all.length - r.findings.length;
    const cited = new Set(r.findings.flatMap((f) => f.evidence));
    r.evidence = ev.filter((e) => cited.has(e.id));
    r.evidenceCount = ev.length;
    r.entryCount = ents.length;
    r.transcripts = transcripts(p.root, prefs.dreamTranscripts).length;
    // the files as they are now: what Apply starts from, and what Undo returns to
    const touched = targets(p, r.findings);
    r.files = touched.map((path, i) => {
      const text = read(path);
      if (text !== null) { mkdirSync(join(dir(p), r.id, "before"), { recursive: true }); writeFileSync(dreamSnap(p, r.id, "before", i), text); }
      return { path, label: files.find((f) => f.path === path)?.label ?? labelOf(p, path), hash: hash(text) };
    });
  } catch (err) {
    r.status = "failed";
    r.error = String((err as Error).message ?? err).slice(0, 300);
  } finally {
    r.ms = Date.now() - t0;
    // a newer Dream replaces any older one still waiting: its line numbers would no longer match anyway
    if (r.status === "proposed") for (const old of listDreams(p, 50)) if (old.status === "proposed" && old.id !== r.id) { old.status = old.applied ? "applied" : "replaced"; saveDream(p, old); }
    saveDream(p, r);
    if (r.status === "proposed") writeMemoryCheck(p, r.findings, now);
    rmSync(runningPath(p), { force: true });
    release();
  }
  return r;
}

/** Every file a Dream's findings would write: the notes' own files, rule files they move to, the lesson file and index. */
function targets(p: RepoPaths, fs: Finding[]): string[] {
  const out = new Set<string>();
  const mem = autoMemory(p.root).dir;
  for (const f of fs) {
    if (f.action.op === "none") { if (f.file && f.line) out.add(f.file); continue; } // "Remove line" stays possible
    if (f.file) out.add(f.file);
    if (f.action.op === "move" && f.action.to) out.add(resolve(p.root, f.action.to));
    if (f.action.op === "add-lesson") { out.add(join(mem, "verified-lessons.md")); out.add(join(mem, "MEMORY.md")); }
  }
  return [...out];
}
const labelOf = (p: RepoPaths, path: string) => (path.startsWith(resolve(p.root)) ? path.slice(resolve(p.root).length + 1).replace(/\\/g, "/").replace(/^\.claude\//, "") : `memory/${basename(path)}`);

/** Leave a finding out of Apply (or put it back). */
export function skipFinding(p: RepoPaths, id: string, fid: string, skip: boolean): boolean {
  const r = readDream(p, id);
  const f = r?.findings.find((x) => x.id === fid);
  if (!r || !f || r.status !== "proposed") return false;
  f.skip = skip;
  saveDream(p, r);
  return true;
}

export function discardDream(p: RepoPaths, id: string): string {
  const r = readDream(p, id);
  if (!r) return "No such Dream.";
  if (r.status !== "proposed") return `This Dream is ${r.status}; only a proposed one can be discarded.`;
  r.status = "discarded";
  saveDream(p, r);
  writeMemoryCheck(p, []);
  return "Discarded. Nothing changed.";
}

/** Apply every open change of a Dream. Refused if a file changed since the Dream. */
export function applyDream(p: RepoPaths, id: string, now = new Date()): string {
  return decide(p, id, "all", "apply", now);
}

/** Put every file back as it was before Apply. All or nothing: refused if a file changed after Apply. */
export function undoDream(p: RepoPaths, id: string, now = new Date()): string {
  const r = readDream(p, id);
  if (r?.findings.some((f) => f.done)) return decide(p, id, "all", "undo", now); // decided one by one
  if (!r || r.status !== "applied" || !r.applied) return "Only an applied Dream can be undone.";
  const changed = r.applied.files.filter((f) => hash(read(f.path)) !== f.hash);
  if (changed.length) return `Not undone: ${changed.map((f) => f.label).join(", ")} changed after Apply. Edit it by hand, or run a new Dream.`;
  r.files.forEach((f, i) => {
    if (f.hash === null) rmSync(f.path, { force: true }); // the Dream created it
    else { const t = read(dreamSnap(p, id, "before", i)); if (t !== null) atomicWriteIfChanged(f.path, t); }
  });
  r.status = "undone";
  r.undone = now.toISOString();
  saveDream(p, r);
  return "Undone: every file is back as it was.";
}
