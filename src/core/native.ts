import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { autoMemory, claudeHome } from "./home.ts";

/**
 * Claude Code's own memory, as it loads it (code.claude.com/docs/en/memory):
 *   CLAUDE.md files (yours, every folder above, the project's), unscoped .claude/rules/*.md → every session
 *   .claude/rules/*.md with `paths:` frontmatter → only when Claude touches a matching file
 *   auto memory MEMORY.md → its first 200 lines or 25 KB, every session; topic files → read when needed
 * Cortex reads these to show what each costs and to check them in a Dream. It writes to them only on Apply.
 */
export type Loads = "always" | "on-demand" | "first-200";
export interface NativeFile {
  path: string;
  /** short name for the panel: "CLAUDE.md", "rules/panel-design.md", "memory/MEMORY.md", "~/.claude/CLAUDE.md" */
  label: string;
  scope: "user" | "parent" | "project" | "rules" | "auto";
  loads: Loads;
  paths?: string[];
  lines: number;
  bytes: number;
  /** tokens this file puts in every session (0 for on-demand files) */
  tokens: number;
  /** a Dream may propose edits (project files and auto memory; your own ~/.claude files are only reported) */
  editable: boolean;
  over?: string;
}

export const MEMORY_LINES = 200;
export const MEMORY_BYTES = 25 * 1024;
export const CLAUDE_MD_LINES = 200;
const tok = (bytes: number) => Math.round(bytes / 4);

/** The `paths:` globs in a rule file's frontmatter (list or inline array), or undefined when it has none. */
export function frontmatterPaths(text: string): string[] | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return undefined;
  const fm = m[1]!;
  const inline = /^paths:[ \t]*\[(.*)\][ \t]*$/m.exec(fm);
  if (inline) return inline[1]!.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  const one = /^paths:[ \t]*(\S.*)$/m.exec(fm);
  if (one) return [one[1]!.trim().replace(/^["']|["']$/g, "")];
  const block = /^paths:\s*\n((?:[ \t]+-.*\n?)+)/m.exec(fm);
  return block ? block[1]!.split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "")).filter(Boolean) : undefined;
}

function walkMd(dir: string, depth = 3): string[] {
  if (depth < 0 || !existsSync(dir)) return [];
  const out: string[] = [];
  for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const f = join(dir, d.name);
    if (d.isDirectory()) out.push(...walkMd(f, depth - 1));
    else if (d.name.endsWith(".md")) out.push(f);
  }
  return out;
}

function file(path: string, label: string, scope: NativeFile["scope"], editable: boolean, loads?: Loads): NativeFile | null {
  let text: string;
  try { if (!statSync(path).isFile()) return null; text = readFileSync(path, "utf8"); } catch { return null; }
  const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
  const bytes = Buffer.byteLength(text);
  const paths = scope === "rules" ? frontmatterPaths(text) : undefined;
  const how: Loads = loads ?? (paths?.length ? "on-demand" : "always");
  const loaded = how === "always" ? bytes : how === "first-200" ? Math.min(bytes, MEMORY_BYTES, Buffer.byteLength(text.split("\n").slice(0, MEMORY_LINES).join("\n"))) : 0;
  const over = how === "first-200"
    ? (lines > MEMORY_LINES ? `${lines} lines: only the first ${MEMORY_LINES} load` : bytes > MEMORY_BYTES ? `${Math.round(bytes / 1024)} KB: only the first 25 KB load` : undefined)
    : how === "always" && lines > CLAUDE_MD_LINES ? `${lines} lines: Claude follows files under ${CLAUDE_MD_LINES} lines better` : undefined;
  return { path, label, scope, loads: how, ...(paths ? { paths } : {}), lines, bytes, tokens: tok(loaded), editable, ...(over ? { over } : {}) };
}

/** Every memory file Claude Code would load for a chat in `root`, in its own order: yours, the folders above, the project, auto memory. */
export function nativeFiles(root: string): NativeFile[] {
  const out: (NativeFile | null)[] = [];
  const ch = claudeHome();
  out.push(file(join(ch, "CLAUDE.md"), "~/.claude/CLAUDE.md", "user", false));
  for (const f of walkMd(join(ch, "rules"))) out.push(file(f, `~/.claude/rules/${relative(join(ch, "rules"), f).replace(/\\/g, "/")}`, "rules", false));
  // folders above the project, up to (and including) your home folder
  const home = resolve(homedir());
  const parents: string[] = [];
  for (let d = dirname(resolve(root)); d !== dirname(d) && (d + "/").startsWith(home + "/"); d = dirname(d)) parents.unshift(d);
  for (const d of parents) for (const n of ["CLAUDE.md", "CLAUDE.local.md"]) out.push(file(join(d, n), `${relative(home, d) || "~"}/${n}`.replace(/\\/g, "/"), "parent", false));
  out.push(file(join(root, "CLAUDE.md"), "CLAUDE.md", "project", true));
  out.push(file(join(root, ".claude", "CLAUDE.md"), ".claude/CLAUDE.md", "project", true));
  out.push(file(join(root, "CLAUDE.local.md"), "CLAUDE.local.md", "project", true));
  // AGENTS.md is read when the project has no CLAUDE.md (Claude Code 2.1.277+)
  if (!existsSync(join(root, "CLAUDE.md"))) out.push(file(join(root, "AGENTS.md"), "AGENTS.md", "project", true));
  const rules = join(root, ".claude", "rules");
  for (const f of walkMd(rules)) out.push(file(f, `rules/${relative(rules, f).replace(/\\/g, "/")}`, "rules", true));
  const am = autoMemory(root);
  if (am.enabled || existsSync(am.dir)) {
    out.push(file(join(am.dir, "MEMORY.md"), "memory/MEMORY.md", "auto", true, am.enabled ? "first-200" : "on-demand"));
    for (const f of walkMd(am.dir, 0)) if (!f.endsWith(`${"/"}MEMORY.md`) && !f.endsWith("\\MEMORY.md")) out.push(file(f, `memory/${relative(am.dir, f).replace(/\\/g, "/")}`, "auto", true, "on-demand"));
  }
  return out.filter((x): x is NativeFile => !!x);
}

/** What loads into every session, in tokens, and the auto memory state. */
export function nativeSummary(root: string): { files: NativeFile[]; alwaysTokens: number; alwaysLines: number; autoMemory: { dir: string; enabled: boolean } } {
  const files = nativeFiles(root);
  const on = files.filter((f) => f.loads !== "on-demand");
  return { files, alwaysTokens: on.reduce((a, f) => a + f.tokens, 0), alwaysLines: on.reduce((a, f) => a + Math.min(f.lines, f.loads === "first-200" ? MEMORY_LINES : f.lines), 0), autoMemory: autoMemory(root) };
}

export interface Entry { file: string; label: string; line: number; end: number; text: string; heading: string }

/** A memory file as entries: each list item (with its continuation lines) or paragraph; headings, code, frontmatter and comments skipped. */
export function entries(path: string, label: string, text: string): Entry[] {
  const out: Entry[] = [];
  const lines = text.split("\n");
  let i = 0, heading = "", fence = false;
  const fm = /^---\r?$/.test(lines[0] ?? "") ? lines.indexOf("---", 1) : -1;
  if (fm > 0) i = fm + 1;
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence || !l.trim() || /^\s*<!--.*-->\s*$/.test(l)) continue;
    if (/^#{1,6}\s/.test(l)) { heading = l.replace(/^#+\s*/, "").trim(); continue; }
    const start = i;
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
    let j = i + 1;
    while (j < lines.length && lines[j]!.trim() && !/^#{1,6}\s/.test(lines[j]!) && !/^\s*(```|~~~)/.test(lines[j]!)
      && (bullet ? /^\s{2,}\S/.test(lines[j]!) && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j]!) : !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j]!))) j++;
    out.push({ file: path, label, line: start + 1, end: j, text: lines.slice(start, j).join("\n").trim(), heading });
    i = j - 1;
  }
  return out;
}
