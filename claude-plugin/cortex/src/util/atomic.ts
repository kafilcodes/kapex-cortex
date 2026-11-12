import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  renameSync, statSync, unlinkSync, writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const MAX_LINE_BYTES = 16 * 1024;

const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

/**
 * Write a file atomically: temp file in the same directory (".nosync" so iCloud ignores it),
 * fsync, then rename over the target. Skips the write when content is unchanged. `durable: false` skips the fsync
 * (still atomic: a reader never sees half a file) for working copies rebuilt every turn, where a power cut costs nothing.
 * Returns true if the file was written.
 */
export function atomicWriteIfChanged(path: string, data: string, opts: { durable?: boolean } = {}): boolean {
  if (existsSync(path)) {
    try {
      if (sha(readFileSync(path)) === sha(data)) return false;
    } catch {
      // unreadable (e.g. evicted): fall through and write
    }
  }
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.nosync`);
  const fd = openSync(tmp, "w", 0o644);
  try {
    writeSync(fd, data);
    if (opts.durable !== false) fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
  return true;
}

/**
 * Append exactly one line with a single write() on an O_APPEND descriptor, so concurrent
 * appenders never interleave inside a line. Lines are capped at MAX_LINE_BYTES.
 */
export function appendLine(path: string, line: string): void {
  if (line.includes("\n")) throw new Error("appendLine: line must not contain a newline");
  const buf = Buffer.from(line + "\n", "utf8");
  if (buf.length > MAX_LINE_BYTES) throw new Error(`appendLine: line is ${buf.length} bytes (max ${MAX_LINE_BYTES})`);
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a", 0o644);
  try {
    writeSync(fd, buf);
  } finally {
    closeSync(fd);
  }
}

/** Read complete lines of a JSONL file; a trailing partial line (a write in progress) is ignored. */
export function readJsonl<T>(path: string): { items: T[]; bad: number } {
  if (!existsSync(path)) return { items: [], bad: 0 };
  const raw = readFileSync(path, "utf8");
  const end = raw.lastIndexOf("\n");
  if (end < 0) return { items: [], bad: 0 };
  const items: T[] = [];
  let bad = 0;
  for (const line of raw.slice(0, end).split("\n")) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line) as T);
    } catch {
      bad++;
    }
  }
  return { items, bad };
}

/**
 * Keep an append-only private log from growing without end: past `maxBytes`, keep its newest `keepLines` lines
 * (written atomically). A stat per call; the rewrite happens rarely.
 */
export function rotateJsonl(path: string, maxBytes: number, keepLines: number): boolean {
  let size = 0;
  try { size = statSync(path).size; } catch { return false; }
  if (size <= maxBytes) return false;
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  atomicWriteIfChanged(path, lines.slice(-keepLines).join("\n") + "\n");
  return true;
}
