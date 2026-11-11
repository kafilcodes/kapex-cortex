import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface RepoPaths {
  root: string;
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

export function repoPaths(root: string): RepoPaths {
  const vault = join(root, ".vault");
  const priv = join(vault, "private");
  return {
    root,
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
  if (up) return up;
  const near = nearbyProjects(resolve(start));
  return near.length === 1 ? join(resolve(start), near[0]!) : null;
}
