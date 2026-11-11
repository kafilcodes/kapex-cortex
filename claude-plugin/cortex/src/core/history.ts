import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { RepoPaths } from "./paths.ts";

/** Handoff history: one STATE per session, and the git WIP snapshots taken at handoff moments. */
export interface History {
  states: { session: string; at: string; from: string; goal: string }[];
  wips: { session: string; sha: string; at: string }[];
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

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
  return { states: stateSnapshots(p, 8), wips: wipRefs(p.root, 8) };
}
