import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { commandsIn, inRepo, sameCommand, type Evidence } from "./evidence.ts";
import type { Entry, NativeFile } from "./native.ts";
import { contentWords, overlap } from "./words.ts";

/**
 * The checks a Dream runs without any model: facts a program can verify. A model only adds judgment on top
 * (what's visible in the repo, what belongs in a path-scoped rule, closed-loop lessons), and every model claim
 * must cite evidence ids that these same sources produced.
 */
export type FindingKind = "false" | "stale" | "duplicate" | "visible" | "contradiction" | "scope" | "replace" | "over-cap" | "broken-link" | "orphan" | "lesson";
export interface Op { op: "delete" | "replace" | "move" | "add-index" | "add-lesson" | "none"; text?: string; to?: string; paths?: string[] }
export interface Finding {
  id: string; kind: FindingKind; severity: "high" | "medium" | "low"; by: "check" | "model";
  /** the file and lines it's about ("" and 0 for a new lesson) */
  file: string; label: string; line: number; end: number; entry: string;
  why: string; evidence: string[]; action: Op;
  /** you chose to leave this one out of Apply (older Dreams) */
  skip?: boolean;
  /** your decision: applied, or kept as it is */
  done?: "applied" | "kept";
  /** the proposed op before you chose "Remove line" instead */
  was?: Op["op"];
}

const NEG = /\b(broken|fails?|failing|doesn'?t work|does not work|not working|skip(?:ped)?|never run|don'?t run|do not run|hangs?|flaky)\b/i;
const POS = /\b(passes|passing|works|is green|succeeds)\b/i;
const LINK = /\]\(([^)\s]+\.md)\)/g;
const SOURCE = /\.(?:md|ts|tsx|js|jsx|mjs|py|go|rs|toml|ya?ml|sh|css|html)$/;
const RANK: Record<string, number> = { user: 0, parent: 0, project: 1, rules: 2, auto: 3 };
const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Backticked tokens that name a file or folder (not commands, globs, links or placeholders). */
export function pathRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([^`\s]{3,160})`/g)) {
    const t = m[1]!.replace(/[.,:;]+$/, "");
    if (/[*?<>{}|$]|^https?:|^@|^--?\w|^#/.test(t)) continue;
    if (t.includes("/") || /^[\w.-]+\.(?:md|ts|tsx|js|jsx|mjs|json|jsonl|py|go|rs|toml|ya?ml|sh|css|html|txt)$/.test(t)) out.add(t);
  }
  return [...out];
}

/** File names git tracks in this project (a note saying `theme.ts` means the one in whatever folder it lives). */
let names: { root: string; set: Set<string> } | null = null;
function tracked(root: string): Set<string> {
  if (names?.root === root) return names.set;
  const r = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8", timeout: 5_000, maxBuffer: 64 << 20 });
  names = { root, set: new Set(r.status === 0 ? r.stdout.split("\0").filter(Boolean).map((f) => f.split("/").pop()!) : []) };
  return names.set;
}

const resolveRef = (root: string, ref: string) => (ref.startsWith("~/") ? join(homedir(), ref.slice(2)) : isAbsolute(ref) ? ref : resolve(root, ref));

/** Two notes say the same thing: one holds all of the other's words, or they share 80% of all their words. Sharing
 * 80% of the shorter one's words was too loose: "Log parsers before merging" is not "Prefer parsers before merging". */
export function isCopy(a: string, b: string): boolean {
  const wa = new Set(contentWords(a)), wb = new Set(contentWords(b));
  const shared = [...wa].filter((w) => wb.has(w)).length;
  const small = Math.min(wa.size, wb.size), union = wa.size + wb.size - shared;
  return small > 0 && (shared === small || shared / union >= 0.8);
}

export function mechanicalChecks(root: string, files: NativeFile[], ents: Entry[], ev: Evidence[]): Finding[] {
  const out: Omit<Finding, "id">[] = [];
  const fileOf = new Map(files.map((f) => [f.path, f]));
  const editable = (e: Entry) => !!fileOf.get(e.file)?.editable;
  const add = (f: Omit<Finding, "id">) => out.push(f);

  // 1. caps: what Claude Code cuts off, or follows less well
  for (const f of files) if (f.over && f.editable) add({ kind: "over-cap", severity: f.loads === "first-200" ? "high" : "medium", by: "check", file: f.path, label: f.label, line: 0, end: 0, entry: "", why: f.over, evidence: [], action: { op: "none" } });

  // 2. the auto memory index: links to missing topic files, topic files nothing links to
  const index = files.find((f) => f.scope === "auto" && basename(f.path) === "MEMORY.md");
  if (index) {
    const dir = dirname(index.path);
    const linked = new Set<string>();
    for (const e of ents.filter((x) => x.file === index.path)) {
      for (const m of e.text.matchAll(LINK)) {
        linked.add(resolve(dir, m[1]!));
        if (!existsSync(resolve(dir, m[1]!))) add({ kind: "broken-link", severity: "high", by: "check", file: e.file, label: e.label, line: e.line, end: e.end, entry: e.text, why: `It points to ${m[1]}, which doesn't exist.`, evidence: [], action: { op: "delete" } });
      }
    }
    for (const f of files.filter((x) => x.scope === "auto" && x.path !== index.path && !linked.has(resolve(x.path)))) {
      const fm = /^---[\s\S]*?\ndescription:\s*(.+)\n[\s\S]*?---/.exec(readFileSync(f.path, "utf8"));
      const name = basename(f.path, ".md").replace(/[-_]+/g, " ");
      add({ kind: "orphan", severity: "low", by: "check", file: index.path, label: index.label, line: 0, end: 0, entry: "", why: `${f.label} isn't listed in MEMORY.md, so Claude never knows to read it.`, evidence: [], action: { op: "add-index", text: `- [${name}](${basename(f.path)}) — ${(fm?.[1] ?? name).trim()}` } });
    }
  }

  for (const e of ents.filter(editable)) {
    // 3. stale references: a file or colour the note names is gone from the project. Only when everything it names
    //    is gone is deleting it the proposal; when some of it still exists, it's yours to decide.
    // a missing source file is stale; a missing log or output file only when its folder is gone too (made on demand)
    const refs = pathRefs(e.text);
    const gone = refs.filter((r) => { const f = resolveRef(root, r); return !existsSync(f) && !tracked(root).has(r.split("/").pop()!) && (SOURCE.test(r) || !existsSync(dirname(f))); });
    const hexes = [...new Set((e.text.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((c) => c.toUpperCase()))];
    const colours = hexes.filter((c) => !inRepo(root, c));
    if (gone.length || colours.length) {
      const all = gone.length === refs.length && colours.length === hexes.length;
      add({ kind: "stale", severity: "medium", by: "check", file: e.file, label: e.label, line: e.line, end: e.end, entry: e.text,
        why: [gone.length ? `${gone.map((g) => `\`${g}\``).join(", ")} no longer exist${gone.length === 1 ? "s" : ""} in the project.` : "", colours.length ? `${colours.join(", ")} ${colours.length === 1 ? "isn't" : "aren't"} used anywhere in the project any more${colours.length < hexes.length ? ` (${hexes.length - colours.length} other colour${hexes.length - colours.length === 1 ? " is" : "s are"})` : ""}.` : ""].filter(Boolean).join(" "),
        evidence: [], action: { op: all ? "delete" : "none" } });
      continue;
    }
    // 4. claims that real runs contradict: "`npm test` is broken" while it passed after the note was written
    const named = commandsIn(e.text);
    if (named.length && (NEG.test(e.text) || POS.test(e.text))) {
      const written = ev.filter((x) => x.kind === "note" && overlap(x.text, e.text) >= 0.6).map((x) => x.ts).sort().at(-1) ?? "";
      for (const cmd of named) {
        const runs = ev.filter((x) => x.kind === "run" && x.cmd && sameCommand(x.cmd, cmd) && x.ts >= written);
        const ok = runs.filter((r) => r.ok), bad = runs.filter((r) => !r.ok);
        if (NEG.test(e.text) && ok.length) {
          add({ kind: "false", severity: "high", by: "check", file: e.file, label: e.label, line: e.line, end: e.end, entry: e.text, why: `It says \`${cmd}\` doesn't work, but it ran successfully ${ok.length === 1 ? "once" : `${ok.length} times`}${written ? " after this note was written" : ""}.`, evidence: ok.slice(0, 2).map((r) => r.id), action: { op: "delete" } });
          break;
        }
        if (POS.test(e.text) && !NEG.test(e.text) && bad.length && !ok.some((r) => r.ts > bad[0]!.ts)) {
          add({ kind: "stale", severity: "medium", by: "check", file: e.file, label: e.label, line: e.line, end: e.end, entry: e.text, why: `It says \`${cmd}\` works, but its latest run failed.`, evidence: [bad[0]!.id], action: { op: "none" } });
          break;
        }
      }
    }
  }

  // 5. duplicates: the same note twice; the copy in the weaker place goes (yours and CLAUDE.md win over auto memory)
  // a note an earlier check already flagged is reported once, not again as a copy
  const flaggedAt = new Set(out.filter((f) => f.line).map((f) => `${f.file}:${f.line}`));
  const pool = ents.filter((e) => contentWords(e.text).length >= 4 && !/\]\([^)\s]+\.md\)/.test(e.text) && !flaggedAt.has(`${e.file}:${e.line}`));
  const dropped = new Set<Entry>();
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!, b = pool[j]!;
      // "X is broken" and "run X" share words but say opposite things: a contradiction is not a copy
      if (dropped.has(a) || dropped.has(b) || !isCopy(a.text, b.text) || NEG.test(a.text) !== NEG.test(b.text)) continue;
      const ra = RANK[fileOf.get(a.file)?.scope ?? "auto"] ?? 3, rb = RANK[fileOf.get(b.file)?.scope ?? "auto"] ?? 3;
      const [keep, lose] = rb < ra ? [b, a] : [a, b];
      if (!editable(lose)) continue;
      dropped.add(lose);
      add({ kind: "duplicate", severity: "medium", by: "check", file: lose.file, label: lose.label, line: lose.line, end: lose.end, entry: lose.text, why: `It repeats ${keep.label} line ${keep.line}: "${short(keep.text.replace(/^[-*+]\s+/, ""))}".`, evidence: [], action: { op: "delete" } });
    }
  }
  return out.map((f, i) => ({ ...f, id: `C${i + 1}` }));
}

/** Notes in always-loaded files whose every file reference sits under one folder: candidates for a path-scoped rule. */
export function scopeHints(root: string, files: NativeFile[], ents: Entry[]): { entry: Entry; dir: string }[] {
  const always = new Set(files.filter((f) => f.editable && f.loads !== "on-demand").map((f) => f.path));
  const out: { entry: Entry; dir: string }[] = [];
  for (const e of ents.filter((x) => always.has(x.file))) {
    const refs = pathRefs(e.text).filter((r) => !r.startsWith("~") && !isAbsolute(r) && existsSync(resolve(root, r)));
    const tops = [...new Set(refs.map((r) => r.replace(/^\.\//, "").split("/")[0]!))];
    if (refs.length && tops.length === 1 && refs.every((r) => r.includes("/")) && !tops[0]!.startsWith(".")) out.push({ entry: e, dir: tops[0]! });
  }
  return out;
}
