import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname } from "node:path";

const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function isStale(lockPath: string, staleMs: number): boolean {
  try {
    const [pidStr, tsStr] = readFileSync(lockPath, "utf8").split(" ");
    const pid = Number(pidStr);
    const ts = Number(tsStr);
    if (!Number.isFinite(pid) || !pidAlive(pid)) return true;
    return Date.now() - ts > staleMs;
  } catch {
    // unreadable or vanished: treat as stale only if it is old
    try { return Date.now() - statSync(lockPath).mtimeMs > staleMs; } catch { return true; }
  }
}

export interface LockOptions { waitMs?: number; staleMs?: number }

/** Try to take an exclusive lock file (O_EXCL). Returns a release function, or null if busy after waitMs. */
export function tryLock(lockPath: string, opts: LockOptions = {}): (() => void) | null {
  const waitMs = opts.waitMs ?? 100;
  const staleMs = opts.staleMs ?? 10_000;
  const token = `${process.pid} ${Date.now()} ${randomBytes(4).toString("hex")}`;
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, "wx", 0o644);
      writeSync(fd, token);
      closeSync(fd);
      return () => {
        try {
          if (readFileSync(lockPath, "utf8") === token) unlinkSync(lockPath);
        } catch { /* already gone */ }
      };
    } catch (err) {
      // Windows reports a lock file that another process is creating or deleting as EPERM/EACCES/EBUSY, not EEXIST:
      // all of them mean "busy, wait your turn"
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && !(process.platform === "win32" && (code === "EPERM" || code === "EACCES" || code === "EBUSY"))) throw err;
      if (isStale(lockPath, staleMs)) {
        try { unlinkSync(lockPath); } catch { /* someone else removed it */ }
        continue;
      }
      if (Date.now() >= deadline) return null;
      sleep(5);
    }
  }
}

export const touch = (path: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(Date.now()));
};
export const clearFlag = (path: string) => { try { unlinkSync(path); } catch { /* absent */ } };
export const flagSet = (path: string) => existsSync(path);

/**
 * Run `work` under the lock, guaranteeing no lost updates (SPEC §6.6):
 * - if the lock is busy past waitMs, set the dirty flag and return false;
 * - the holder clears the flag, works, and repeats while the flag reappears,
 *   including a re-check after release.
 */
export function runSerialized(lockPath: string, dirtyPath: string, work: () => void, opts: LockOptions = {}): boolean {
  let ranAtLeastOnce = false;
  for (let round = 0; round < 20; round++) {
    const release = tryLock(lockPath, opts);
    if (!release) {
      touch(dirtyPath);
      return ranAtLeastOnce;
    }
    try {
      do {
        clearFlag(dirtyPath);
        work();
        ranAtLeastOnce = true;
      } while (flagSet(dirtyPath));
    } finally {
      release();
    }
    if (!flagSet(dirtyPath)) return true;
  }
  return ranAtLeastOnce;
}
