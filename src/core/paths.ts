import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { gitTop, mainCheckout } from "./worktree.ts";

export interface RepoPaths {
  /** the checkout the work happens in (git, CLAUDE.md, verify commands): a linked worktree's own folder */
  root: string;
  /** the folder that holds `.vault/`: `root`, or for a linked git worktree the main checkout's (one vault per repo) */
  vaultRoot: string;
  vault: string;
  /** .vault/cortex.json: marks a project where Cortex is on */
  marker: string;
  priv: string;
  turns: string;
  cursors: string;
  states: string;
  viewsLock: string;
  viewsDirty: string;
  errors: string;
}

/** A folder has Cortex on when it has .vault/cortex.json (v3), or a v1/v2 ledger not yet migrated. */
export const isCortexProject = (dir: string) => existsSync(join(dir, ".vault", "cortex.json")) || existsSync(join(dir, ".vault", "ledger.jsonl"));

/** Where a project's vault lives: a linked worktree of a repo whose main checkout has Cortex on shares that vault, so
 * every chat of the repo hands off through one STATE.md (worktree.ts says why). CORTEX_VAULT_PER_WORKTREE=1 opts out. */
export function vaultRootFor(root: string): string {
  if (process.env.CORTEX_VAULT_PER_WORKTREE === "1") return root;
  const top = gitTop(root);
  if (!top || resolve(top) !== resolve(root)) return root;
  const main = mainCheckout(top);
  return main && isCortexProject(main) ? main : root;
}

export function repoPaths(root: string): RepoPaths {
  const vaultRoot = vaultRootFor(root);
  const vault = join(vaultRoot, ".vault");
  const priv = join(vault, "private");
  return {
    root,
    vaultRoot,
    vault,
    marker: join(vault, "cortex.json"),
    priv,
    turns: join(priv, "turns.jsonl"),
    cursors: join(priv, "cursors"),
    states: join(priv, "states"),
    viewsLock: join(priv, "locks", "views.lock"),
    viewsDirty: join(priv, "locks", "views.dirty"),
    errors: join(priv, "errors.log"),
  };
}

/** Walk up from `start` to the nearest directory containing `.vault/`. */
export function findRepoRoot(start: string): string | null {
  let dir = resolve(start);
  for (;;) {
    if (isCortexProject(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Child folders (one level down) that have Cortex on. */
export function nearbyProjects(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && isCortexProject(join(dir, d.name)))
      .map((d) => d.name).slice(0, 10);
  } catch { return []; }
}

/**
 * The Cortex project a chat belongs to: this folder or one above it, else the only Cortex project
 * one level down (a chat opened in a parent folder such as "Claude Projects"). Null when ambiguous.
 */
export function resolveProject(start: string): string | null {
  const up = findRepoRoot(start);
  // a linked worktree (often nested, as .claude/worktrees/<name>) without a vault of its own belongs to its repo: the
  // work happens in the worktree, the vault is the main checkout's
  const top = gitTop(start);
  if (top && (!up || (resolve(top) !== resolve(up) && resolve(top).startsWith(resolve(up) + sep)))) {
    const main = mainCheckout(top);
    if (main && isCortexProject(main)) return top;
  }
  if (up) return up;
  const near = nearbyProjects(resolve(start));
  return near.length === 1 ? join(resolve(start), near[0]!) : null;
}
