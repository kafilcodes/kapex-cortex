import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

// When a macOS notification may be sent. Notifications are for a person at their desk, so three things stop one:
//   1. a run that isn't a person's: CORTEX_NO_NOTIFY (tests, benchmarks, CI), or a project in the temp folder (every
//      test repo, benchmark fixture and throwaway `claude -p` run lives there; nobody keeps real work in it);
//   2. a repeat: the same words again within 10 minutes (a usage limit hits every open chat at once; a refresh that
//      keeps failing; two panels in two windows reporting one finished check);
//   3. a burst: anything within 2 seconds of the last one sent, so a run of events shows one banner, not a stack.
// The record is one small file shared by every process (hooks, the CLI the panel runs), written atomically.

export const REPEAT_MS = 10 * 60_000, BURST_MS = 2_000;
const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
const TEMPS = () => [...new Set([tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"].map(real))];

/** Why no notification may come from here, or null when one may: a run that isn't a person's at their desk. */
export function quietReason(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CORTEX_NO_NOTIFY) return "CORTEX_NO_NOTIFY is set";
  const here = real(cwd);
  if (TEMPS().some((t) => here === t || here.startsWith(t.endsWith(sep) ? t : t + sep))) return "the project is in the temp folder (a test, benchmark or throwaway run)";
  return null;
}

type Sent = { k: string; at: number };
/** True (and recorded) when these words may go out now; false for a repeat within 10 minutes or a burst within 2 s. */
export function mayNotify(dir: string, title: string, message: string, now = Date.now()): boolean {
  const file = join(dir, "sent.json"), k = `${title}\n${message}`.slice(0, 400);
  let sent: Sent[] = [];
  try { sent = (JSON.parse(readFileSync(file, "utf8")) as Sent[]).filter((x) => x && typeof x.at === "number" && now - x.at < REPEAT_MS && x.at <= now); } catch { /* none yet, or unreadable: start over */ }
  if (sent.some((x) => x.k === k) || sent.some((x) => now - x.at < BURST_MS)) return false;
  sent.push({ k, at: now });
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(sent.slice(-30)));
    renameSync(tmp, file);
  } catch { /* the notification still goes; only the record is lost */ }
  return true;
}
