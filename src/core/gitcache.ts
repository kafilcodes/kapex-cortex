import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RepoPaths } from "./paths.ts";
import { gitDirOf, headCommit } from "./worktree.ts";

/**
 * Git answers kept until git's own files say they changed. The panel reads the status after every reply; most of
 * that time went to three `git` processes whose answers had not changed (the log and what is pushed change only
 * when HEAD or the remote ref moves). Keyed on HEAD, the index, the refs and the remote branch, all read as files.
 */
export function gitKey(root: string, extra: string[] = []): string {
  const gd = gitDirOf(root);
  if (!gd) return "";
  const m = (f: string) => { try { return String(statSync(join(gd, f)).mtimeMs); } catch { return "-"; } };
  let common = gd;
  try { const c = readFileSync(join(gd, "commondir"), "utf8").trim(); common = c.startsWith("/") ? c : join(gd, c); } catch { /* main checkout */ }
  const cm = (f: string) => { try { return String(statSync(join(common, f)).mtimeMs); } catch { return "-"; } };
  // a push or fetch rewrites the remote branch's ref file in place (its folder's time doesn't change): that file's own
  let branch = "";
  try { branch = /^ref: refs\/heads\/(.+)$/.exec(readFileSync(join(gd, "HEAD"), "utf8").trim())?.[1] ?? ""; } catch { /* detached */ }
  return [headCommit(root) ?? "-", m("HEAD"), m("index"), cm("packed-refs"), cm("refs/remotes"), branch ? cm(`refs/remotes/origin/${branch}`) : "-", cm("refs/tags"), cm("refs/cortex/wip"), ...extra].join("|");
}

/** `compute()` once per key; `maxAgeMs` bounds what the key can't see (a file edited without touching the index). */
export function cachedGit<T>(p: RepoPaths, name: string, key: string, compute: () => T, maxAgeMs = Infinity, now = Date.now()): T {
  if (!key) return compute();
  const file = join(p.priv, `git-${name}.json`);
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as { key: string; at: number; value: T };
    if (c.key === key && now - c.at >= 0 && now - c.at < maxAgeMs) return c.value;
  } catch { /* none yet, or torn */ }
  const value = compute();
  try { atomicWriteIfChanged(file, JSON.stringify({ key, at: now, value }), { durable: false }); } catch { /* a read-only vault: no cache */ }
  return value;
}
