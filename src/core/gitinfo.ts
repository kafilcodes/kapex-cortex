import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import type { RepoPaths } from "./paths.ts";
import { gitDirOf, gitOperation, headCommit } from "./worktree.ts";

export function git(root: string, args: string[]): string | null {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 1_500 });
  return r.status === 0 ? r.stdout.trim() : null;
}

export interface GitInfo {
  branch: string; diffStat: string; untracked: number; wipRef: string | null;
  /** the commit HEAD points at (null in a repo with no commits yet) */
  head?: string | null;
  /** a merge, rebase, cherry-pick… in progress, in words */
  op?: string;
  /** the checkout the work happens in, relative to the vault's folder, when it is a linked worktree ("" otherwise) */
  worktree?: string;
}

/** Porcelain v2 `git status --branch` → what the handoff shows. Pure, so the odd cases are tested directly. */
export function parseStatus(status: string): { branch: string; head: string | null; changed: string[]; untracked: number } {
  let branch = "(detached)", head: string | null = null, untracked = 0;
  const changed: string[] = [];
  for (const line of status.split("\n")) {
    if (line.startsWith("# branch.head ")) branch = line.slice(14);
    else if (line.startsWith("# branch.oid ")) { const o = line.slice(13).trim(); head = /^[0-9a-f]{7,}$/.test(o) ? o : null; } // "(initial)": no commit yet
    else if (line.startsWith("? ")) untracked++;
    else if (/^[12u] /.test(line)) {
      const parts = line.split(" ");
      const xy = parts[1]!.replace(/\./g, " ").trim() || "M";
      const path = line.startsWith("2 ") ? line.split("\t")[0]!.split(" ").slice(9).join(" ") : parts.slice(line.startsWith("u ") ? 10 : 8).join(" ");
      changed.push(`${xy.padEnd(2)} ${path}`);
    }
  }
  if (branch === "(detached)" && head) branch = `(detached at ${head.slice(0, 7)})`;
  return { branch, head, changed, untracked };
}

const cacheFile = (p: RepoPaths) => join(p.priv, "git-cache.json");
/** What git's own files say changed: HEAD, the index and the branch's ref (no process). */
function fingerprint(root: string): string {
  const gd = gitDirOf(root);
  if (!gd) return "";
  const m = (f: string) => { try { return String(statSync(join(gd, f)).mtimeMs); } catch { return "-"; } };
  return [headCommit(root) ?? "-", m("index"), m("HEAD"), m("MERGE_HEAD"), m("rebase-merge")].join("|");
}

/**
 * One `git status` per turn (about 15 ms in a big repo, the largest part of the Stop hook). A turn that ran no
 * command and edited nothing (`quiet`), with git's own files unchanged and the last answer under 2 minutes old (an editor's
 * changes outside Claude show within 2 minutes),
 * reuses that answer. With `snapshot`, also a diff stat and a WIP ref made with `git stash create` + `update-ref`,
 * which never touches the branch, index or working tree (only at handoff moments, never every turn).
 */
export function gitInfo(p: RepoPaths, session: string, opts: { snapshot?: boolean; quiet?: boolean; now?: number } = {}): GitInfo | null {
  const root = p.root, now = opts.now ?? Date.now();
  // the same folder can be spelled two ways (macOS: /var and /private/var): compare real paths
  const real = (x: string) => { try { return realpathSync.native(x); } catch { return x; } }; // .native: Windows 8.3 short paths expand
  const rel = p.vaultRoot !== root ? relative(real(p.vaultRoot), real(root)) : "";
  // shown with "/" on every OS (Windows gives "\\")
  const worktree = p.vaultRoot !== root ? (rel && !rel.startsWith("..") ? rel : root).replace(/\\/g, "/") : "";
  const fp = fingerprint(root);
  if (opts.quiet && !opts.snapshot && fp) {
    try {
      const c = JSON.parse(readFileSync(cacheFile(p), "utf8")) as { root: string; fp: string; at: number; info: GitInfo };
      if (c.root === root && c.fp === fp && now - c.at >= 0 && now - c.at < 2 * 60_000) return { ...c.info, op: gitOperation(root), worktree };
    } catch { /* no cache yet */ }
  }
  const status = git(root, ["status", "--porcelain=v2", "--branch"]);
  if (status === null) return null;
  const s = parseStatus(status);
  let diffStat = s.changed.slice(0, 15).join("\n") + (s.changed.length > 15 ? `\n… ${s.changed.length - 15} more` : "");
  let wipRef: string | null = null;
  if (opts.snapshot && s.changed.length) {
    diffStat = git(root, ["diff", "--stat", "HEAD"]) ?? diffStat;
    const sha = git(root, ["stash", "create", `cortex wip ${session}`]);
    if (sha) {
      const ref = `refs/cortex/wip/${session.replace(/[^A-Za-z0-9_-]/g, "_")}`;
      if (git(root, ["update-ref", ref, sha]) !== null) wipRef = `${ref} (${sha.slice(0, 10)})`;
    }
  }
  const info: GitInfo = { branch: s.branch, diffStat, untracked: s.untracked, wipRef, head: s.head, op: gitOperation(root), worktree };
  if (fp && !opts.snapshot) { try { atomicWriteIfChanged(cacheFile(p), JSON.stringify({ root, fp, at: now, info: { ...info, wipRef: null } }), { durable: false }); } catch { /* best effort */ } }
  return info;
}

/** Commands that define "done": .vault/verify.txt (this checkout's, else the shared vault's), else common project scripts. */
export function verifyCommands(root: string, vaultRoot = root): string[] {
  const file = [join(root, ".vault", "verify.txt"), join(vaultRoot, ".vault", "verify.txt")].find((f) => existsSync(f));
  if (file) {
    try { return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")); } catch { /* unreadable: fall through */ }
  }
  const out: string[] = [];
  const pkg = join(root, "package.json");
  if (existsSync(pkg)) {
    try {
      const scripts = (JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts ?? {};
      for (const s of ["check", "typecheck", "lint", "test"]) if (scripts[s]) out.push(`npm run ${s}`);
      if (out.includes("npm run check")) return ["npm run check"];
    } catch { /* ignore */ }
  }
  if (existsSync(join(root, "go.mod"))) out.push("go build ./... && go test ./...");
  if (existsSync(join(root, "Cargo.toml"))) out.push("cargo test");
  if (existsSync(join(root, "pyproject.toml"))) out.push("pytest -q");
  return out;
}

/** The Stop hook's own `git status`, if it is under `maxAgeMs` old and git's files haven't changed since: the panel's
 * status read right after a reply reuses it instead of starting git again. Null when there is none to trust. */
export function recentGitInfo(p: RepoPaths, maxAgeMs = 30_000, now = Date.now()): { branch: string; dirty: number; untracked: number } | null {
  try {
    const c = JSON.parse(readFileSync(cacheFile(p), "utf8")) as { root: string; fp: string; at: number; info: GitInfo };
    if (c.root !== p.root || !c.fp || c.fp !== fingerprint(p.root) || now - c.at < 0 || now - c.at >= maxAgeMs) return null;
    const lines = c.info.diffStat ? c.info.diffStat.split("\n") : [];
    const more = Number(/^… (\d+) more$/.exec(lines.at(-1) ?? "")?.[1] ?? 0);
    return { branch: c.info.branch, dirty: lines.length - (more ? 1 : 0) + more, untracked: c.info.untracked };
  } catch { return null; }
}
