import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { RepoPaths } from "./paths.ts";

/** Handoff history: one STATE per session, and the git WIP snapshots taken at handoff moments. */
export interface History {
  states: { session: string; at: string; from: string; goal: string; /** the chat it came from: its title, else the first words you typed in it */ chat?: string; /** how many identical handoffs this one stands for (two chats saving the same goal minutes apart) */ copies?: number }[];
  wips: { session: string; sha: string; at: string }[];
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** A chat's title as Claude Code named it, saved by the Stop hook while it reads the transcript ("" when unknown). */
export function chatTitle(p: RepoPaths, session: string): string {
  if (!session) return "";
  let c: { title?: string; path?: string } = {};
  try { c = JSON.parse(readFileSync(join(p.cursors, `claude-${session}.json`.replace(/[^A-Za-z0-9_.-]/g, "_")), "utf8")) as typeof c; } catch { return ""; }
  if (c.title) return c.title;
  // a chat from before titles were saved: Claude Code repeats the title line often, so the transcript's last 64 KB has it
  if (!c.path) return "";
  let fd = -1;
  try {
    fd = openSync(c.path, "r");
    const size = fstatSync(fd).size, n = Math.min(size, 65_536), buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, size - n);
    const all = [...buf.toString("utf8").matchAll(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g)];
    const last = all[all.length - 1]?.[1];
    return last ? (JSON.parse(`"${last}"`) as string).trim().slice(0, 120) : "";
  } catch { return ""; } finally { if (fd >= 0) closeSync(fd); }
}

/** Per-session STATE snapshots in .vault/private/states (newest first). */
function stateSnapshots(p: RepoPaths, max: number): History["states"] {
  if (!existsSync(p.states)) return [];
  const out: (History["states"][number] & { t: number })[] = [];
  for (const f of readdirSync(p.states)) {
    if (!f.endsWith(".md")) continue;
    try {
      const path = join(p.states, f);
      const text = readFileSync(path, "utf8");
      const head = text.split("\n")[0] ?? "";
      const t = statSync(path).mtimeMs;
      out.push({
        session: /· session (\S+)/.exec(head)?.[1] ?? f.replace(/\.md$/, ""),
        at: new Date(t).toISOString(),
        from: /· from ([^ ]+)/.exec(head)?.[1] ?? "",
        goal: clip((/## Goal\n([^\n]+)/.exec(text)?.[1] ?? "").trim(), 140),
        chat: chatTitle(p, /· session (\S+)/.exec(head)?.[1] ?? f.replace(/\.md$/, "")) || clip((/\*\*Started with\*\* \([^)]*\): ([^\n]+)/.exec(text)?.[1] ?? "").trim(), 60) || undefined,
        t,
      });
    } catch { /* unreadable snapshot: skip */ }
  }
  return out.sort((a, b) => b.t - a.t).slice(0, max).map(({ t: _t, ...rest }) => rest);
}

/** Git WIP snapshot refs (refs/cortex/wip/<session>), newest first. */
function wipRefs(root: string, max: number): History["wips"] {
  const r = spawnSync("git", ["-C", root, "for-each-ref", "--sort=-creatordate", `--count=${max}`, "--format=%(refname) %(objectname:short) %(creatordate:iso-strict)", "refs/cortex/wip/"], { encoding: "utf8", timeout: 1_500 });
  if (r.status !== 0) return [];
  return r.stdout.trim().split("\n").filter(Boolean).map((l) => {
    const [ref, sha, at] = l.split(" ");
    return { session: (ref ?? "").replace("refs/cortex/wip/", ""), sha: sha ?? "", at: at ?? "" };
  });
}

export function computeHistory(p: RepoPaths): History {
  return { states: collapse(stateSnapshots(p, 12)).slice(0, 8), wips: wipRefs(p.root, 8) };
}

/** Handoffs next to each other with the same goal and chat name within 15 minutes are one row ("×2"), newest kept. */
function collapse(states: History["states"]): History["states"] {
  const out: History["states"] = [];
  for (const s of states) {
    const prev = out[out.length - 1];
    if (prev && prev.goal === s.goal && (prev.chat ?? "") === (s.chat ?? "") && Math.abs(Date.parse(prev.at) - Date.parse(s.at)) < 15 * 60_000) prev.copies = (prev.copies ?? 1) + 1;
    else out.push({ ...s });
  }
  return out;
}
