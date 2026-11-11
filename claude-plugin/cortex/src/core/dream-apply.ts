import { join, resolve } from "node:path";
import type { DreamReport } from "./dream.ts";

/**
 * What each file looks like after a Dream's chosen findings: lines removed or rewritten where the note was,
 * notes moved into path-scoped rule files (created with `paths:` frontmatter when new), missing index lines and
 * verified lessons added to auto memory. Built from the snapshot taken at Dream time, so line numbers still match.
 */
const BULLET = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const asBullet = (text: string) => (BULLET.test(text) ? text : `- ${text}`);
const tidy = (s: string) => `${s.replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "")}\n`;

export function ruleFile(paths: string[], title: string): string {
  return `---\npaths:\n${paths.map((p) => `  - "${p.replace(/"/g, "")}"`).join("\n")}\n---\n\n# ${title}\n\n`;
}

const LESSONS_HEAD = "---\nname: verified-lessons\ndescription: Lessons a Cortex Dream checked against session transcripts, tests and git; each says how we know\nmetadata:\n  type: feedback\n---\n\n# Verified lessons\n\n";
const LESSONS_INDEX = "- [Verified lessons](verified-lessons.md) — lessons checked against real sessions, each with how we know";

export function buildAfter(root: string, r: DreamReport, before: (string | null)[], memDir: string, now: Date): (string | null)[] {
  const at = new Map(r.files.map((f, i) => [resolve(f.path), i]));
  const lines = before.map((t) => (t === null ? null : t.split("\n")));
  const cut: { i: number; from: number; to: number; with: string[] }[] = [];
  const append = new Map<number, string[]>();
  const pushTo = (i: number, s: string) => append.set(i, [...(append.get(i) ?? []), s]);
  const day = now.toISOString().slice(0, 10);

  for (const f of r.findings) {
    if (f.skip || f.action.op === "none") continue;
    const src = f.file ? at.get(resolve(f.file)) : undefined;
    if (f.action.op === "delete" || f.action.op === "replace" || f.action.op === "move") {
      if (src === undefined || !lines[src] || !f.line) continue;
      const from = f.line - 1, to = Math.max(f.end, f.line);
      if (cut.some((c) => c.i === src && from < c.to && c.from < to)) continue; // two findings on one note: the first wins
      const first = lines[src]![from] ?? "";
      const keep = f.action.op === "replace" ? [`${BULLET.exec(first)?.[1] ?? ""}${f.action.text}`] : [];
      cut.push({ i: src, from, to, with: keep });
      if (f.action.op === "move" && f.action.to) {
        const dst = at.get(resolve(root, f.action.to));
        if (dst === undefined) continue;
        if (lines[dst] === null && !append.has(dst)) pushTo(dst, ruleFile(f.action.paths ?? [], f.action.to.split("/").pop()!.replace(/\.md$/, "").replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())).trimEnd() + "\n");
        pushTo(dst, asBullet(f.entry.replace(/\s*\n\s*/g, " ")));
      }
    } else if (f.action.op === "add-index" && src !== undefined && f.action.text) {
      if (!(before[src] ?? "").includes(f.action.text)) pushTo(src, f.action.text);
    } else if (f.action.op === "add-lesson" && f.action.text) {
      const li = at.get(resolve(join(memDir, "verified-lessons.md"))), ii = at.get(resolve(join(memDir, "MEMORY.md")));
      if (li === undefined) continue;
      if (lines[li] === null && !append.has(li)) pushTo(li, LESSONS_HEAD.trimEnd() + "\n");
      pushTo(li, `- ${f.action.text} How we know: ${f.why} (${day})`);
      if (ii !== undefined && !(before[ii] ?? "").includes("(verified-lessons.md)") && !(append.get(ii) ?? []).includes(LESSONS_INDEX)) pushTo(ii, LESSONS_INDEX);
    }
  }

  return lines.map((ls, i) => {
    let out = ls ? [...ls] : null;
    for (const c of cut.filter((x) => x.i === i).sort((a, b) => b.from - a.from)) out!.splice(c.from, c.to - c.from, ...c.with);
    const add = append.get(i);
    if (!add) return out === null ? null : ls && out.join("\n") === ls.join("\n") ? before[i]! : tidy(out.join("\n"));
    const base = out === null ? "" : `${out.join("\n").replace(/\s+$/, "")}\n`;
    return tidy(base + add.join("\n"));
  });
}
