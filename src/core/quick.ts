import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepoPaths } from "./paths.ts";
import { readPrefs } from "./prefs.ts";

/**
 * The free Quick check after every turn, without slowing the turn. The check itself (~100 ms: it greps the repo
 * for every colour and path a note names) runs in the background; the Stop hook only decides whether it's due,
 * from a fingerprint that costs ~1 ms: the memory files' sizes and times (the list the last check found, plus their
 * folders, so a new file counts), the branch, HEAD and the working tree's status. Nothing changed: nothing runs.
 */
const sigPath = (p: RepoPaths) => join(p.priv, "quick-sig.json");
interface Sig { sig: string; files: string[]; at: string }

const stamp = (f: string) => { try { const s = statSync(f); return `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return "-"; } };
const head = (root: string) => { try { const h = readFileSync(join(root, ".git", "HEAD"), "utf8").trim(); const ref = /^ref: (.+)$/.exec(h)?.[1]; return ref ? `${h}@${stamp(join(root, ".git", ref))}` : h; } catch { return ""; } };

export function fingerprint(p: RepoPaths, files: string[], tree: string): string {
  const dirs = [...new Set(files.map((f) => f.slice(0, Math.max(f.lastIndexOf("/"), f.lastIndexOf("\\")))))];
  const parts = [...files.map((f) => `${f}=${stamp(f)}`), ...dirs.map((d) => `${d}/=${stamp(d)}`), head(p.root), tree];
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 20);
}

function readSig(p: RepoPaths): Sig | null {
  try { return JSON.parse(readFileSync(sigPath(p), "utf8")) as Sig; } catch { return null; }
}

/** At Stop: is a Quick check due? True when you have it on and anything it reads changed since the last one. */
export function quickDue(p: RepoPaths, tree: string): boolean {
  if (readPrefs(p).quickCheck === false) return false;
  const last = readSig(p);
  if (!last) return true;
  return fingerprint(p, last.files, tree) !== last.sig;
}

/** After a check: remember what it looked at, so the next Stop can tell whether anything changed. */
export function rememberCheck(p: RepoPaths, files: string[], tree: string, now = new Date()): void {
  try { writeFileSync(sigPath(p), JSON.stringify({ sig: fingerprint(p, files, tree), files, at: now.toISOString() } satisfies Sig)); } catch { /* best effort */ }
}
