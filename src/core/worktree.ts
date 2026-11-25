import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Git worktrees, read from the files git keeps (no `git` process, a few microseconds).
 *
 * Why it matters: `.vault/cortex.json` is committed, so every linked worktree of a Cortex repo has a `.vault/` of its
 * own. Before v4.5 a chat that worked in a worktree (or `cd`ed into one: Claude Code's hook `cwd` follows the
 * agent) wrote its handoff there, and a new chat in the main checkout resumed a packet days old. Now one repo has
 * one vault, the main checkout's; the worktree is still where git and the work happen, and the packet says so.
 */

/** The nearest folder at or above `start` that holds a `.git` entry (a directory, or a linked worktree's file). */
export function gitTop(start: string): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

/** The git directory of a checkout: `<top>/.git`, or what a linked worktree's `.git` file points at. */
export function gitDirOf(top: string): string | null {
  const dotgit = join(top, ".git");
  try {
    if (statSync(dotgit).isDirectory()) return dotgit;
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit, "utf8"));
    if (!m) return null;
    const dir = m[1]!.trim();
    return isAbsolute(dir) ? dir : resolve(top, dir);
  } catch { return null; }
}

/** The main checkout of a linked worktree (null when `top` is the main checkout, a bare repo's, or unreadable). */
export function mainCheckout(top: string): string | null {
  const gd = gitDirOf(top);
  if (!gd || resolve(gd) === resolve(join(top, ".git"))) return null;
  try {
    const common = readFileSync(join(gd, "commondir"), "utf8").trim();
    const commonDir = isAbsolute(common) ? common : resolve(gd, common);
    if (basename(commonDir) !== ".git") return null; // a bare repository has no main checkout
    const main = dirname(commonDir);
    return existsSync(join(main, ".git")) && resolve(main) !== resolve(top) ? main : null;
  } catch { return null; }
}

/** Every checkout of the repo whose main checkout is `main`: itself first, then its linked worktrees that exist. */
export function checkouts(main: string): string[] {
  const out = [main];
  const dir = join(main, ".git", "worktrees");
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names.slice(0, 50)) {
    try {
      const gitFile = readFileSync(join(dir, n, "gitdir"), "utf8").trim(); // <worktree>/.git
      const top = dirname(gitFile);
      if (existsSync(gitFile) && !out.includes(top)) out.push(top);
    } catch { /* a pruned or half-made worktree */ }
  }
  return out;
}

/** The commit HEAD points at, from the files (packed refs and linked worktrees included); null when unborn or unreadable. */
export function headCommit(top: string): string | null {
  const gd = gitDirOf(top);
  if (!gd) return null;
  try {
    const head = readFileSync(join(gd, "HEAD"), "utf8").trim();
    if (/^[0-9a-f]{40,64}$/.test(head)) return head; // detached
    const ref = /^ref: (refs\/.+)$/.exec(head)?.[1];
    if (!ref) return null;
    let common = gd;
    try { const c = readFileSync(join(gd, "commondir"), "utf8").trim(); common = isAbsolute(c) ? c : resolve(gd, c); } catch { /* the main checkout */ }
    for (const base of [gd, common]) {
      try { const sha = readFileSync(join(base, ref), "utf8").trim(); if (sha) return sha; } catch { /* packed or unborn */ }
    }
    const packed = readFileSync(join(common, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(` ${ref}`));
    return packed?.split(" ")[0] ?? null;
  } catch { return null; }
}

/** A merge, rebase, cherry-pick, revert or bisect in progress in this checkout, in words ("" when none). */
export function gitOperation(top: string): string {
  const gd = gitDirOf(top);
  if (!gd) return "";
  const has = (f: string) => existsSync(join(gd, f));
  if (has("rebase-merge") || has("rebase-apply")) return "a rebase is in progress";
  if (has("MERGE_HEAD")) return "a merge is in progress (conflicts may be unresolved)";
  if (has("CHERRY_PICK_HEAD")) return "a cherry-pick is in progress";
  if (has("REVERT_HEAD")) return "a revert is in progress";
  if (has("BISECT_LOG")) return "a bisect is in progress";
  return "";
}
