import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { buildAfter } from "./dream-apply.ts";
import type { Finding } from "./dream-checks.ts";
import { dreamSnap, hash, readDream, saveDream, type DreamFile, type DreamReport } from "./dream.ts";
import { autoMemory } from "./home.ts";
import type { RepoPaths } from "./paths.ts";
import { writeMemoryCheck } from "./tiers.ts";

/**
 * Your decision on each finding of a Dream, one at a time or all at once:
 *   apply   write this change (or every change still open, with "all")
 *   remove  for a note that's yours to decide: delete those lines
 *   keep    the note is right: leave it, and don't flag the same text again
 *   undo    take back an apply or a keep (with "all": the whole Dream)
 * The files are always rebuilt from the copy taken at Dream time plus every applied finding, so applying and undoing
 * one by one is as exact as all at once. Refused when a file changed by hand since the Dream (or since the last apply).
 */
export type Decision = "apply" | "remove" | "keep" | "undo";
const read = (f: string): string | null => { try { return readFileSync(f, "utf8"); } catch { return null; } };
const keepPath = (p: RepoPaths) => join(p.priv, "dream-keep.json");
export interface Kept { label: string; h: string; at: string }

/** Notes you said are right: never flagged again while their text stays the same. */
export function readKept(p: RepoPaths): Kept[] {
  try { return JSON.parse(readFileSync(keepPath(p), "utf8")) as Kept[]; } catch { return []; }
}
export const isKept = (kept: Kept[], f: Pick<Finding, "label" | "entry">) => !!f.entry && kept.some((k) => k.label === f.label && k.h === hash(f.entry.trim()));
function setKept(p: RepoPaths, f: Finding, on: boolean, now: Date): void {
  if (!f.entry) return;
  const h = hash(f.entry.trim())!;
  const rest = readKept(p).filter((k) => !(k.label === f.label && k.h === h));
  mkdirSync(p.priv, { recursive: true });
  writeFileSync(keepPath(p), JSON.stringify(on ? [...rest, { label: f.label, h, at: now.toISOString() }] : rest, null, 1));
}

/** What the files must look like right now for a decision to be safe: as Apply last wrote them, else as at Dream time. */
const expected = (r: DreamReport, i: number) => r.applied?.files[i]?.hash ?? r.files[i]!.hash;

export function decide(p: RepoPaths, id: string, fid: string, what: Decision, now = new Date()): string {
  const r = readDream(p, id);
  if (!r) return "No such Dream.";
  if (r.status !== "proposed" && r.status !== "applied") return `This Dream is ${r.status}: run a new one.`;
  const all = fid === "all";
  const f = all ? null : r.findings.find((x) => x.id === fid);
  if (!all && !f) return "No such finding.";
  const changed = r.files.filter((x, i) => hash(read(x.path)) !== expected(r, i));
  if (changed.length && what !== "keep") return `Not ${what === "undo" ? "undone" : "applied"}: ${changed.map((x) => x.label).join(", ")} changed since this Dream${r.applied ? " was applied" : ""}. Run a new Dream (Quick check is free).`;

  let msg = "";
  if (what === "apply") {
    const pick = all ? r.findings.filter((x) => !x.done && !x.skip && x.action.op !== "none") : [f!];
    if (!pick.length) return "Nothing left to apply.";
    if (pick.some((x) => x.action.op === "none")) return "This one has no change to apply: choose Remove line or Keep.";
    for (const x of pick) x.done = "applied";
    msg = `Applied ${pick.length} change${pick.length === 1 ? "" : "s"}`;
  } else if (what === "remove") {
    if (!f || !f.line || !r.files.some((x) => x.path === f.file)) return "This finding isn't about lines in a file, so there's nothing to remove.";
    f.was = f.action.op;
    f.action = { op: "delete" };
    f.done = "applied";
    msg = `Removed ${f.label} line ${f.line}. Undo puts it back.`;
  } else if (what === "keep") {
    const pick = all ? r.findings.filter((x) => !x.done) : [f!];
    for (const x of pick) { x.done = "kept"; setKept(p, x, true, now); }
    msg = pick.length === 1 ? "Kept as it is; it won't be flagged again unless it changes." : `Kept ${pick.length} as they are.`;
  } else {
    const pick = all ? r.findings.filter((x) => x.done) : f!.done ? [f!] : [];
    if (!pick.length) return "Nothing to undo.";
    for (const x of pick) {
      if (x.done === "kept") setKept(p, x, false, now);
      if (x.was) { x.action = { op: x.was }; delete x.was; }
      delete x.done;
    }
    msg = all ? "Undone: every file is back as it was at the Dream." : "Undone.";
  }

  // rebuild every touched file from the Dream-time copy plus all applied findings
  const before = r.files.map((x, i) => (x.hash === null ? null : read(dreamSnap(p, id, "before", i))));
  const applying = r.findings.map((x) => ({ ...x, skip: x.done !== "applied" }));
  const after = buildAfter(p.root, { ...r, findings: applying }, before, autoMemory(p.root).dir, now);
  const files: DreamFile[] = r.files.map((x, i) => {
    const text = after[i] ?? before[i] ?? null;
    if (text === null) { rmSync(x.path, { force: true }); return { ...x, hash: null }; } // a file only this Dream would create
    if (hash(read(x.path)) !== hash(text)) { mkdirSync(dirname(x.path), { recursive: true }); atomicWriteIfChanged(x.path, text); }
    return { ...x, hash: hash(text) };
  });
  const anyApplied = r.findings.some((x) => x.done === "applied");
  const open = r.findings.some((x) => !x.done);
  r.applied = anyApplied ? { at: now.toISOString(), files } : undefined;
  r.status = anyApplied && !open ? "applied" : !anyApplied && !open && r.findings.length ? "discarded" : "proposed";
  if (what === "undo" && all) { r.status = "undone"; r.undone = now.toISOString(); }
  saveDream(p, r);
  writeMemoryCheck(p, r.status === "undone" ? [] : r.findings, now);
  if (what === "apply") msg += ` to ${files.filter((x, i) => x.hash !== r.files[i]!.hash).length} file(s). Undo puts them back.`;
  return msg;
}
