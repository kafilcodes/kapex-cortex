import type { MissionRecord, Pin } from "./mission.ts";

/**
 * The mission contract as the top of STATE.md. It is the one part of the packet that is never cut to fit: when room is
 * short, long pins are shortened (never dropped) and the word-for-word exchanges further down give way instead.
 * A machine-readable lineage comment heads it, so tools (and the 5-hop benchmark) can follow the chain.
 */
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t; };
const day = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "");
const LABEL: Record<Pin["kind"], string> = { skill: "skill/workflow", never: "never", must: "must", decision: "decision" };

export const LINEAGE_RE = /<!-- cortex-lineage: ([^>]*) -->/;
/** The lineage comment's fields, from any STATE packet ({} when it has none: a packet from before v4.5). */
export function lineageOf(text: string): Record<string, string> {
  const m = LINEAGE_RE.exec(text)?.[1] ?? "";
  return Object.fromEntries([...m.matchAll(/(\w+)=(\S+)/g)].map((x) => [x[1]!, x[2]!]));
}

export function renderMission(rec: MissionRecord, o: { chat: (session: string) => string; room: number; head?: string | null; branch?: string; worktree?: string }): string {
  const m = { ...rec.mission }, l = rec.lineage;
  const hops = l.hop;
  const meta = `<!-- cortex-lineage: handoff=${l.handoffId} parent=${l.parentHandoffId ?? "none"} parent_session=${l.parentSession ?? "none"} hop=${hops} origin=${l.originSession} head=${o.head ?? l.gitHead ?? "none"} mission=${m.id} status=${m.status} -->`;
  const origin = hops > 1 ? `chat ${hops} of this task (it began in “${oneLine(o.chat(l.originSession) || l.originSession.slice(0, 8), 60)}”; this chat continues “${oneLine(o.chat(l.parentSession ?? "") || (l.parentSession ?? "").slice(0, 8), 60)}”)` : "chat 1 of this task";
  const where = [o.branch ? `branch \`${o.branch}\`` : "", o.worktree ? `worktree \`${o.worktree}\` (work there; the vault is shared)` : "", o.head ? `head \`${o.head.slice(0, 10)}\`` : ""].filter(Boolean).join(" · ");
  const tag = (x: { session: string; hop: number; at: string }) => `_(chat ${x.hop}${x.session === rec.session ? ", this one" : ""}, ${day(x.at)})_`;
  // binding kinds first (skills and never-rules), each kind oldest first: what chat 1 said stays at the top
  const order: Pin["kind"][] = ["skill", "never", "must", "decision"];
  const pins = [...m.pins].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.at < b.at ? -1 : 1));
  const build = (pinMax: number, rejMax: number, goalMax = 600) => [
    "## Mission contract (binding across chats until the user says it is done or starts a new task)",
    meta,
    m.status === "done" ? `_The user marked this mission done (${day(m.doneAt ?? "")}). Its rules no longer bind; ask what is next._` : "",
    `**North star:** ${m.goal ? oneLine(m.goal, goalMax) : "_not stated yet: ask the user_"} ${m.goalAt ? `_(set in chat ${m.goalHop || 1}, ${day(m.goalAt)})_` : ""}`.trim(),
    `**Chain:** ${origin}.${where ? ` **Where:** ${where}.` : ""}`,
    pins.length ? `**Binding rules (the user's own words; follow them exactly):**\n${pins.map((x) => `- [${LABEL[x.kind]}] “${oneLine(x.text, pinMax)}” ${tag(x)}`).join("\n")}` : "",
    m.rejected.length ? `**Rejected (never propose or repeat these):**\n${m.rejected.map((x) => `- ${oneLine(x.what, rejMax)} → the user: “${oneLine(x.why, rejMax + 60)}” ${tag(x)}`).join("\n")}` : "",
    "",
  ].filter((s, i, a) => s !== "" || i === a.length - 1).join("\n");
  // shorten, never drop a rule: 420 → 240 → 140 → 90 characters a pin. Only rejected approaches past the room are
  // summed up (the newest stay), so the contract never pushes Next action and Verify out of a lean packet
  for (const [pm, rm, gm] of [[420, 220, 600], [240, 160, 600], [140, 100, 400], [90, 70, 240]] as const) {
    const t = build(pm, rm, gm);
    if (t.length <= o.room) return t;
  }
  const all = m.rejected;
  for (let keep = all.length - 1; keep >= 0; keep--) {
    m.rejected = all.slice(all.length - keep);
    const t = keep ? build(90, 70, 240).replace("**Rejected (never propose or repeat these):**", `**Rejected (never propose or repeat these; ${all.length - keep} older in .vault/private/states):**`)
      : `${build(90, 70, 240).trimEnd()}\n**Rejected:** ${all.length} approaches the user turned down are listed in .vault/private/states (no room here).\n`;
    m.rejected = all;
    if (t.length <= o.room || keep === 0) return t;
  }
  return build(90, 70, 240);
}
