import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { cortexHome } from "./home.ts";
import type { Prefs } from "./prefs.ts";

/**
 * The first name for the panel's greeting. Your own setting wins; otherwise the computer account's full name:
 *   macOS   `id -F`
 *   Windows the local account's FullName (PowerShell, once)
 *   Linux   the GECOS field of /etc/passwd
 * Only a real-looking first word is used (letters, 1–24 chars); a login name like "kafilcodes" is never shown as a
 * name. The result is cached in ~/.cortex/name.json (outside every project), never in a tracked file or a test.
 */
export function firstName(prefs: Pick<Prefs, "name" | "greeting">): string {
  if (!prefs.greeting) return "";
  if (prefs.name.trim()) return clean(prefs.name);
  if (process.env.CORTEX_NO_NAME_DETECT) return "";
  const cache = join(cortexHome(), "name.json");
  // a cached empty result is retried (an older version could miss "Mohd. Kafil Khan"-style names)
  try { const c = JSON.parse(readFileSync(cache, "utf8")) as { name: string; v?: number }; if (c.name || c.v === NAME_V) return c.name; } catch { /* first time */ }
  const name = clean(detect());
  try { mkdirSync(cortexHome(), { recursive: true }); writeFileSync(cache, JSON.stringify({ name, v: NAME_V, at: new Date().toISOString() })); } catch { /* best effort */ }
  return name;
}

const NAME_V = 2;
/** Titles and short forms that come before a given name ("Dr.", "Mohd.", "Md", "Sri"): skipped, not used as the name. */
const PREFIX = /^(mr|mrs|ms|miss|mx|dr|prof|sir|mohd|md|muhammad|mohammad|mohammed|muhammed|syed|sri|shri|smt|st)\.?$/i;
/** The first real word: titles and abbreviations ("Dr.", "Mohd.", "J.") are skipped; letters (any script), hyphen
 * and apostrophe only; empty when nothing looks like a name. */
export function clean(full: string): string {
  const words = full.trim().split(/[\s,]+/).filter(Boolean);
  const w = words.find((x, i) => !(PREFIX.test(x) && i < words.length - 1) && !/^\p{L}\.$/u.test(x)) ?? "";
  return /^[\p{L}][\p{L}'-]{0,23}$/u.test(w) ? w : "";
}

function detect(): string {
  const run = (cmd: string, args: string[]) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 3_000, windowsHide: true }); return r.status === 0 ? r.stdout.trim() : ""; };
  try {
    if (process.platform === "darwin") return run("/usr/bin/id", ["-F"]);
    if (process.platform === "win32") return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", '([adsi]"WinNT://$env:USERDOMAIN/$env:USERNAME,user").FullName']);
    const user = userInfo().username;
    const line = readFileSync("/etc/passwd", "utf8").split("\n").find((l) => l.startsWith(`${user}:`));
    return line?.split(":")[4]?.split(",")[0] ?? "";
  } catch { return ""; }
}
