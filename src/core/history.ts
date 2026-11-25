import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { RepoPaths } from "./paths.ts";
import { readEpisodes, type EpisodeView } from "./episodes.ts";

/** Handoff history: one STATE per session, and the git WIP snapshots taken at handoff moments. */
export interface History {
  states: HandoffState[];
  wips: { session: string; sha: string; at: string }[];
}

/** One handoff: the chat that saved it, what its note carries, and the chats on either side of it. */
export interface HandoffState {
  session: string; at: string; from: string; goal: string;
  /** the chat it came from: its title, else the first words you typed in it */ chat?: string;
  /** how many identical handoffs this one stands for (two chats saving the same goal minutes apart) */ copies?: number;
  /** the note's next step, its last check, and how much of yours it pins */ next?: string; lastCheck?: string; rules?: number; decisions?: number; files?: number;
  /** the chat this one continued (it started with /cortex-resume), and the chats that continued from this one */
  continues?: { session: string; chat: string }; pickedUp?: { session: string; chat: string }[];
  /** what the chat did, from its turns: replies, commits, files changed, checks run and failed, tokens Claude wrote */
  work?: { turns: number; commits: number; files: number; ran: number; failed: number; out: number };
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
        ...noteParts(text),
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

export function computeHistory(p: RepoPaths, journal?: EpisodeView[], read = 12, keep = 8): History {
  const states = collapse(stateSnapshots(p, read)).slice(0, keep);
  linkChats(p, states, journal);
  return { states, wips: wipRefs(p.root, 8) };
}

/** The other chats a merged row stands for (its "×2"), so its links and sums cover them all. */
const twins = new WeakMap<HandoffState, string[]>();

/** Handoffs next to each other with the same goal and chat name within 15 minutes are one row ("×2"), newest kept. */
function collapse(states: History["states"]): History["states"] {
  const out: History["states"] = [];
  for (const s of states) {
    const prev = out[out.length - 1];
    if (prev && prev.goal === s.goal && (prev.chat ?? "") === (s.chat ?? "") && Math.abs(Date.parse(prev.at) - Date.parse(s.at)) < 15 * 60_000) { prev.copies = (prev.copies ?? 1) + 1; (twins.get(prev) ?? twins.set(prev, []).get(prev)!).push(s.session); }
    else out.push({ ...s });
  }
  return out;
}

/** What a STATE note carries, read from its own sections: the next step, the last check, and counts of what it pins. */
function noteParts(text: string): Pick<HandoffState, "next" | "lastCheck" | "rules" | "decisions" | "files"> {
  const cut = text.indexOf("\n## Where we left off"); // the last exchanges, word for word, may quote another note
  text = cut >= 0 ? text.slice(0, cut) : text;
  const items = (title: string) => {
    const i = text.indexOf(`**${title}`);
    if (i < 0) return 0;
    let n = 0;
    for (const line of text.slice(text.indexOf("\n", i) + 1).split("\n")) { if (!/^- /.test(line)) break; if (!/^- \[…\]/.test(line)) n++; }
    return n;
  };
  const line = (h: string) => (new RegExp(`## ${h}[^\\n]*\\n+([^\\n]+)`).exec(text)?.[1] ?? "").replace(/`/g, "").trim();
  const next = line("Next action"), check = line("Last check").replace(/^_+|_+$/g, "").replace(/,?\s*\d+\s*(?:min|h|d|days?|hours?)\s+ago\.?$/, "").trim(), files = (/## Active files[^\n]*\n+([^\n]+)/.exec(text)?.[1] ?? "").match(/`[^`]+`/g)?.length ?? 0;
  return {
    next: next && !/^Continue from the last assistant message/.test(next) ? clip(next, 240) : undefined,
    lastCheck: check && !/^None|^No (?:test|check)/i.test(check) ? clip(check.replace(/^\((?![^)]*\))/, ""), 160) : undefined,
    rules: items("Your standing instructions") + (text.match(/^- \[(?:skill\/workflow|never|must)\] /gm) ?? []).length,
    decisions: items("Decisions recorded at handoff") + (text.match(/^- \[decision\] /gm) ?? []).length, files,
  };
}

/** Joins each handoff to its neighbours (carry.json: chat → the chat it continued) and sums what each chat did. */
function linkChats(p: RepoPaths, states: HandoffState[], journal?: EpisodeView[]): void {
  if (!states.length) return;
  let map: Record<string, string> = {};
  try { map = JSON.parse(readFileSync(join(p.priv, "carry.json"), "utf8")) as Record<string, string>; } catch { /* none yet */ }
  const name = (id: string) => states.find((x) => x.session === id)?.chat || chatTitle(p, id) || "";
  const work = new Map<string, NonNullable<HandoffState["work"]>>();
  const files = new Map<string, Set<string>>();
  try {
    for (const e of journal ?? readEpisodes(p, 400)) {
      const w = work.get(e.session) ?? { turns: 0, commits: 0, files: 0, ran: 0, failed: 0, out: 0 };
      const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
      w.turns++; w.commits += n(e.commits); w.ran += n(e.tests?.ran); w.failed += n(e.tests?.failed); w.out += n(e.outTokens);
      const f = files.get(e.session) ?? new Set<string>(); for (const x of e.files) if (typeof x === "string") f.add(x); files.set(e.session, f);
      work.set(e.session, w);
    }
  } catch { /* no journal: no sums */ }
  for (const s of states) {
    const all = [s.session, ...(twins.get(s) ?? [])];
    const from = all.map((id) => map[id]).find((x) => x && !all.includes(x));
    if (from) s.continues = { session: from, chat: name(from) };
    const next = Object.keys(map).filter((k) => all.includes(map[k]!) && !all.includes(k));
    if (next.length) s.pickedUp = next.slice(-4).map((id) => ({ session: id, chat: name(id) }));
    const ws = all.map((id) => work.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    if (ws.length) {
      const fs = new Set(all.flatMap((id) => [...(files.get(id) ?? [])]));
      s.work = ws.reduce((a, w) => ({ turns: a.turns + w.turns, commits: a.commits + w.commits, files: fs.size, ran: a.ran + w.ran, failed: a.failed + w.failed, out: a.out + w.out }), { turns: 0, commits: 0, files: fs.size, ran: 0, failed: 0, out: 0 });
    }
  }
}
