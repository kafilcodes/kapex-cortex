import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cortexHome } from "./home.ts";
import { mayNotify, quietReason } from "./notify-guard.ts";

/**
 * macOS notifications with Cortex's own icon. A notification sent with `osascript` belongs to Script Editor, so macOS
 * shows Script Editor's icon whatever Cortex asks. So Cortex builds a tiny app once, ~/.cortex/notifier/Kapex Cortex.app:
 * an AppleScript applet (osacompile, built into macOS) with the Cortex logo as its icon and its own bundle id, that
 * shows the notifications waiting in ~/.cortex/notifier/queue and quits. macOS then names and draws it as "Kapex
 * Cortex", and asks once whether it may notify. Built with the system's own tools (osacompile, sips, iconutil,
 * codesign): no download, no dependency. Building takes about a second, so it runs in the background at session start;
 * until the app exists, a notification falls back to osascript.
 */
const VERSION = "3"; // bump when the applet's script or Info.plist changes, so old copies are rebuilt
const NAME = "Kapex Cortex";
export const notifierDir = () => join(cortexHome(), "notifier");
// each applet version lives in its own folder with its own queue (v3 adds a sound line): an older Cortex on the same
// Mac (main's plugin, say) keeps its own copy instead of rebuilding over this one, and announcing it, again and again
const vdir = () => join(notifierDir(), `v${VERSION}`);
const appPath = () => join(vdir(), `${NAME}.app`);
const stamp = () => join(vdir(), "version");
/** The macOS sound a notification plays when Sounds is on (Settings): a bright one for done, a low one for alerts. */
export const SOUND = { done: "Glass", alert: "Sosumi" } as const;

/** The Cortex logo to use as the app's icon: the plugin's own icon.png, wherever this code runs from. */
function iconPng(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // the plugin's hook.mjs (cortex/), its copy of the CLI (cortex/src/core/), and this repository (src/core/)
  for (const p of [join(here, "..", ".claude-plugin", "icon.png"), join(here, "..", "..", "..", ".claude-plugin", "icon.png"), join(here, "..", "..", "claude-plugin", ".claude-plugin", "icon.png")]) if (existsSync(p)) return p;
  return null;
}

export const notifierReady = () => process.platform === "darwin" && existsSync(join(appPath(), "Contents", "Info.plist")) && readSafe(stamp()) === VERSION;
function readSafe(p: string): string { try { return readFileSync(p, "utf8").trim(); } catch { return ""; } }

/** Builds the app (synchronously; call from a background process). True when it is ready. */
export function buildNotifier(): boolean {
  if (process.platform !== "darwin") return false;
  if (notifierReady()) return true;
  const dir = vdir(), tmp = join(dir, `build-${process.pid}`), app = join(tmp, `${NAME}.app`), queue = join(dir, "queue");
  try {
    mkdirSync(queue, { recursive: true });
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    const q = queue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    // show every waiting notification (title on line 1, words on line 2, a macOS sound's name on line 3 or none), oldest
    // first, then remove it. A notification's sound follows Focus and the app's own Notifications settings.
    const script = [
      // run and reopen (a second `open` while it runs) both drain the queue, and it keeps going until it is empty
      "on run",
      "  drain()",
      "end run",
      "on reopen",
      "  drain()",
      "end reopen",
      "on drain()",
      `  set d to "${q}/"`,
      "  repeat 20 times",
      `    set fs to paragraphs of (do shell script "ls -1 " & quoted form of d & " 2>/dev/null | grep '\\\\.txt$' || true")`,
      "    if (count of fs) is 0 or (fs is {\"\"}) then exit repeat",
      "    repeat with f in fs",
      "      if (length of f) > 0 then",
      "        set p to d & f",
      `        set c to paragraphs of (do shell script "cat " & quoted form of p)`,
      `        do shell script "rm -f " & quoted form of p`,
      "        if (count of c) > 2 and (length of (item 3 of c)) > 0 then",
      "          display notification (item 2 of c) with title (item 1 of c) sound name (item 3 of c)",
      "        else if (count of c) > 1 then",
      "          display notification (item 2 of c) with title (item 1 of c)",
      "        end if",
      "      end if",
      "    end repeat",
      "    delay 0.3",
      "  end repeat",
      "end drain",
    ].join("\n");
    const ok = (cmd: string, args: string[]) => spawnSync(cmd, args, { stdio: "ignore", timeout: 20_000 }).status === 0;
    const src = join(tmp, "n.applescript");
    writeFileSync(src, script);
    if (!ok("/usr/bin/osacompile", ["-o", app, src])) return false;
    const res = join(app, "Contents", "Resources"), plist = join(app, "Contents", "Info.plist");
    const png = iconPng();
    if (png) {
      const set = join(tmp, "icon.iconset");
      mkdirSync(set);
      for (const s of [16, 32, 128, 256, 512]) {
        ok("/usr/bin/sips", ["-z", String(s), String(s), png, "--out", join(set, `icon_${s}x${s}.png`)]);
        ok("/usr/bin/sips", ["-z", String(s * 2), String(s * 2), png, "--out", join(set, `icon_${s}x${s}@2x.png`)]);
      }
      // the applet's own icon lives in Assets.car on recent macOS, which wins over applet.icns: remove it
      if (ok("/usr/bin/iconutil", ["-c", "icns", set, "-o", join(res, "applet.icns")])) { rmSync(join(res, "Assets.car"), { force: true }); ok("/usr/bin/plutil", ["-remove", "CFBundleIconName", plist]); }
    }
    ok("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "ai.kapex.cortex.notifier", plist]);
    ok("/usr/bin/plutil", ["-replace", "CFBundleName", "-string", NAME, plist]);
    ok("/usr/bin/plutil", ["-replace", "LSUIElement", "-bool", "true", plist]); // no Dock icon while it runs
    ok("/usr/bin/codesign", ["--force", "--deep", "-s", "-", app]); // re-sign after the edits (ad hoc, local only)
    rmSync(appPath(), { recursive: true, force: true });
    renameSync(app, appPath());
    writeFileSync(stamp(), VERSION);
    // once, right after it is built: macOS asks whether "Kapex Cortex" may notify now, at a calm moment, not with the
    // first real alert (a usage limit), which would otherwise wait behind the question
    notifyMac("Kapex Cortex", "Cortex notifications now show the Cortex icon.", { sound: null });
    return true;
  } catch { return false; } finally { rmSync(tmp, { recursive: true, force: true }); }
}

/** Starts a background build when the app is missing or old (never waits for it). */
export function prepareNotifier(cli: string, cwd = process.cwd()): void {
  if (process.platform !== "darwin" || quietReason(cwd) || notifierReady()) return; // never for a test or throwaway run
  try { spawn(process.execPath, [cli, "notifier", "build"], { detached: true, stdio: "ignore" }).unref(); } catch { /* best effort */ }
}

/** One notification: through the Cortex app when it is ready (its icon), else osascript (Script Editor's icon). It
 * plays `sound` (a macOS sound name, or none) and is sent only when notify-guard allows: never from a test or a
 * throwaway run, never the same words twice in 10 minutes, never a burst. Returns whether it was sent. */
export function notifyMac(title: string, message: string, o: { sound?: string | null; cwd?: string } = {}): boolean {
  if (process.platform !== "darwin" || quietReason(o.cwd)) return false;
  if (!mayNotify(notifierDir(), title, message)) return false;
  const one = (s: string) => s.replace(/[\r\n]+/g, " ").slice(0, 300);
  const sound = o.sound ? one(o.sound).replace(/[^A-Za-z0-9 ]/g, "") : "";
  try {
    if (notifierReady()) {
      const q = join(vdir(), "queue");
      mkdirSync(q, { recursive: true });
      const f = join(q, `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
      writeFileSync(`${f}.tmp`, `${one(title)}\n${one(message)}\n${sound}\n`);
      renameSync(`${f}.tmp`, `${f}.txt`); // whole, or not there: the app never reads half a file
      spawn("/usr/bin/open", ["-g", appPath()], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch { /* fall back below */ }
  const esc = (s: string) => one(s).replace(/["\\]/g, "\\$&");
  try { spawn("/usr/bin/osascript", ["-e", `display notification "${esc(message)}" with title "${esc(title)}"${sound ? ` sound name "${sound}"` : ""}`], { detached: true, stdio: "ignore" }).unref(); return true; } catch { return false; }
}
