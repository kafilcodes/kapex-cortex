import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const SF_DATALESS = 0x40000000;

export type EvictionState = "local" | "placeholder" | "dataless" | "missing";

/** Detect whether a file in iCloud Drive is present locally, without triggering a download. */
export function evictionState(path: string): EvictionState {
  const placeholder = join(dirname(path), `.${basename(path)}.icloud`);
  if (!existsSync(path)) return existsSync(placeholder) ? "placeholder" : "missing";
  // iCloud eviction exists only on macOS; elsewhere (Windows reports 0 blocks for every file) a file that exists is local
  if (process.platform !== "darwin") return "local";
  const st = statSync(path);
  if (st.size > 0 && st.blocks === 0) return "dataless"; // heuristic: no local blocks
  {
    const r = spawnSync("/usr/bin/stat", ["-f", "%f", path], { encoding: "utf8", timeout: 500 });
    const flags = Number(r.stdout?.trim());
    if (Number.isFinite(flags) && (flags & SF_DATALESS) !== 0) return "dataless";
  }
  return "local";
}

/** Ask macOS to fetch an evicted file in the background. Never waits. */
export function requestDownload(path: string): void {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/brctl")) return;
  try {
    const child = spawn("/usr/bin/brctl", ["download", path], { detached: true, stdio: "ignore" });
    child.unref();
  } catch { /* best effort */ }
}

export type GuardedRead = { status: "ok"; text: string } | { status: "evicted" | "missing" };

/** Read a vault file only if it is local; otherwise request a download and report, never block. */
export function readVaultFile(path: string): GuardedRead {
  const state = evictionState(path);
  if (state === "missing") return { status: "missing" };
  if (state !== "local") {
    requestDownload(path);
    return { status: "evicted" };
  }
  return { status: "ok", text: readFileSync(path, "utf8") };
}

/** iCloud conflict copies look like "PENDING 2.md" next to "PENDING.md". */
export function findConflictCopies(path: string): string[] {
  const dir = dirname(path);
  if (!existsSync(dir)) return [];
  const ext = extname(path);
  const stem = basename(path, ext).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${stem} \\d+${ext.replace(".", "\\.")}$`);
  return readdirSync(dir).filter((f) => re.test(f)).sort().map((f) => join(dir, f));
}

/** Union of ticked checklist items, keyed by a trailing "^<id>" block reference. */
export function tickedIds(markdown: string): Set<string> {
  const ids = new Set<string>();
  for (const line of markdown.split("\n")) {
    const m = /^\s*- \[[xX]\] .*\^([0-9A-Z]{26})\s*$/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Move conflict copies into <dir>/_conflicts/ (never delete). Returns the ticks they carried. */
export function sweepConflicts(path: string): { moved: string[]; ticks: Set<string> } {
  const ticks = new Set<string>();
  const moved: string[] = [];
  for (const copy of findConflictCopies(path)) {
    const read = readVaultFile(copy);
    if (read.status !== "ok") continue; // try again next export
    for (const id of tickedIds(read.text)) ticks.add(id);
    const dest = join(dirname(path), "_conflicts");
    mkdirSync(dest, { recursive: true });
    const target = join(dest, `${Date.now()}-${basename(copy)}`);
    renameSync(copy, target);
    moved.push(target);
  }
  return { moved, ticks };
}

/** True if a file changed very recently (it may still be syncing from another device). */
export function recentlyModified(path: string, withinMs = 10_000): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs < withinMs;
  } catch {
    return false;
  }
}
