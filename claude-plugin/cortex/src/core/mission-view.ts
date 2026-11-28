import type { MissionRecord, Pin } from "./mission.ts";
import { stepTicker, type Proof, type Step } from "./mission-steps.ts";
import type { RepoPaths } from "./paths.ts";

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

export function renderMission(rec: MissionRecord, o: { chat: (session: string) => string; room: number; head?: string | null; branch?: string; worktree?: string; proof?: (s: Step) => Proof | null; run?: string }): string {
  const m = { ...rec.mission }, l = rec.lineage;
  const hops = l.hop;
  const meta = `<!-- cortex-lineage: handoff=${l.handoffId} parent=${l.parentHandoffId ?? "none"} parent_session=${l.parentSession ?? "none"} hop=${hops} origin=${l.originSession} head=${o.head ?? l.gitHead ?? "none"} mission=${m.id} status=${m.status} -->`;
  const origin = hops > 1 ? `chat ${hops} of this task (it began in “${oneLine(o.chat(l.originSession) || l.originSession.slice(0, 8), 60)}”; this chat continues “${oneLine(o.chat(l.parentSession ?? "") || (l.parentSession ?? "").slice(0, 8), 60)}”)` : "chat 1 of this task";
  const where = [o.branch ? `branch \`${o.branch}\`` : "", o.worktree ? `worktree \`${o.worktree}\` (work there; the vault is shared)` : "", o.head ? `head \`${o.head.slice(0, 10)}\`` : ""].filter(Boolean).join(" · ");
  const tag = (x: { session: string; hop: number; at: string }) => `_(chat ${x.hop}${x.session === rec.session ? ", this one" : ""}, ${day(x.at)})_`;
  // binding kinds first (skills and never-rules), each kind oldest first: what chat 1 said stays at the top
  const order: Pin["kind"][] = ["skill", "never", "must", "decision"];
  const pins = [...m.pins].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || (a.at < b.at ? -1 : 1));
  // a command you ran (`!git push` echoed back) is never a reason you gave: older records from before v4.6 drop out here
  const echo = (x: { why: string }) => /^<bash-(?:input|stdout|stderr)>/.test(x.why);
  // the steps: what you asked for, item by item, with what each tick rests on; open ones whole, done ones shortened first
  const steps = (m.steps ?? []).filter((x) => x.state !== "dropped"), dropped = (m.steps ?? []).length - steps.length;
  const PROOF: Record<Proof["level"], string> = { verified: "verified", failing: "CHECK FAILING", unverified: "not verified", you: "" };
  const stepLine = (x: Step, max: number, proofs: boolean) => { const pr = proofs ? o.proof?.(x) : null; return `- [${x.state === "done" ? "x" : " "}] ${x.n}. ${oneLine(x.text, max)}${pr ? ` _(${PROOF[pr.level] ? `${PROOF[pr.level]}: ` : ""}${pr.text})_` : ""}`; };
  const run = o.run ?? "kc";
  const stepBlock = (doneMax: number, proofs: boolean) => !steps.length ? "" : `**Steps (${steps.filter((x) => x.state === "done").length} of ${steps.length} done${dropped ? `, ${dropped} dropped` : ""}). When one is finished and its check passes, tick it: \`${run} mission done <n> --mission ${m.id}\` (\`mission add "…"\` for a step the list missed, \`mission drop <n>\` for one that no longer applies). Never tick what isn't finished, and never edit this file: it is written again after every turn.**\n${steps.map((x) => stepLine(x, x.state === "done" ? doneMax : 140, proofs)).join("\n")}`;
  const build = (pinMax: number, rejMax: number, goalMax = 600, whys = true, doneMax = 140, proofs = true) => [
    "## Mission contract (binding across chats until the user says it is done or starts a new task)",
    meta,
    m.status === "done" ? `_The user marked this mission done (${day(m.doneAt ?? "")}). Its rules no longer bind; ask what is next._` : "",
    `**North star:** ${m.goal ? oneLine(m.goal, goalMax) : "_not stated yet: ask the user_"} ${m.goalAt ? `_(set in chat ${m.goalHop || 1}, ${day(m.goalAt)})_` : ""}`.trim(),
    `**Chain:** ${origin}.${where ? ` **Where:** ${where}.` : ""}`,
    m.status === "done" ? "" : stepBlock(doneMax, proofs),
    pins.length ? `**Binding rules (the user's own words; follow them exactly):**\n${pins.map((x) => `- [${LABEL[x.kind]}] “${oneLine(x.text, pinMax)}” ${tag(x)}${whys && x.why ? ` — why: “${oneLine(x.why, 160)}”` : ""}${x.conflict ? ` **⚠ A newer goal or decision contradicts this:** “${oneLine(x.conflict, 160)}”. Ask the user which holds.` : ""}`).join("\n")}` : "",
    m.superseded?.length ? `**Superseded (no longer binding; a newer goal or decision replaced them):**\n${m.superseded.slice(-3).map((x) => `- [${LABEL[x.kind]}] ~~“${oneLine(x.text, Math.min(pinMax, 160))}”~~ → replaced by “${oneLine(x.by, 120)}” _(${day(x.at)})_`).join("\n")}` : "",
    m.rejected.some((x) => !echo(x)) ? `**Rejected (never propose or repeat these):**\n${m.rejected.filter((x) => !echo(x)).map((x) => `- ${oneLine(x.what, rejMax)} → the user: “${oneLine(x.why, rejMax + 60)}” ${tag(x)}`).join("\n")}` : "",
    "",
  ].filter((s, i, a) => s !== "" || i === a.length - 1).join("\n");
  // shorten, never drop a rule: 420 → 240 → 140 → 90 characters a pin. Only rejected approaches past the room are
  // summed up (the newest stay), so the contract never pushes Next action and Verify out of a lean packet
  // the reasons go first (the rules stay whole a step longer), then each rule is shortened
  for (const [pm, rm, gm, wy, dm, pf] of [[420, 220, 600, true, 140, true], [420, 220, 600, false, 140, true], [240, 160, 600, false, 60, true], [140, 100, 400, false, 60, false], [90, 70, 240, false, 40, false]] as const) {
    const t = build(pm, rm, gm, wy, dm, pf);
    if (t.length <= o.room) return t;
  }
  const all = m.rejected, real = all.filter((x) => !echo(x)); // the counts leave out command echoes too
  for (let keep = real.length - 1; keep >= 0; keep--) {
    m.rejected = real.slice(real.length - keep);
    const t = keep ? build(90, 70, 240, false, 40, false).replace("**Rejected (never propose or repeat these):**", `**Rejected (never propose or repeat these; ${real.length - keep} older in .vault/private/states):**`)
      : `${build(90, 70, 240, false, 40, false).trimEnd()}\n**Rejected:** ${real.length} approaches the user turned down are listed in .vault/private/states (no room here).\n`;
    m.rejected = all;
    if (t.length <= o.room || keep === 0) return t;
  }
  return build(90, 70, 240, false, 40, false);
}

export interface StepView { n: number; text: string; state: Step["state"]; by?: "claude" | "you"; proof?: Proof | null }
export interface ContractView { rules: { kind: string; text: string; why?: string }[]; ruleCount: number; superseded: { text: string; by: string }[]; rejected: { what: string; why: string }[]; conflicts: number;
  /** v4.6: the mission's north star, its steps with what each tick rests on, and whether it was closed */ goal?: string; steps?: StepView[]; closed?: boolean; mission?: string }
/** The panel's contract with the mission's own steps and goal (read from its record, so a tick shows at once). */
export function withSteps(c: ContractView | null, rec: MissionRecord | null, proof: (s: Step) => Proof | null, p?: RepoPaths): ContractView | null {
  if (!rec) return c;
  // the ticks made since that chat's record was written (a press in the panel, Claude's kc mission) count at once
  const m = { ...rec.mission, steps: rec.mission.steps?.map((x) => ({ ...x })) };
  if (p) stepTicker(p, rec.lineage.hop, () => false).settle(m);
  const base = c ?? { rules: [], ruleCount: 0, superseded: [], rejected: [], conflicts: 0 };
  return { ...base, goal: m.goal.slice(0, 300), mission: m.id, closed: m.status === "done", steps: (m.steps ?? []).map((x) => ({ n: x.n, text: x.text, state: x.state, ...(x.by ? { by: x.by } : {}), proof: proof(x) })) };
}
const unq = (s: string) => s.replace(/^“|”$/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
/** The mission contract as the panel shows it, read back from STATE.md (what a new chat really gets): the newest rules
 * with their reasons, what was superseded, what was turned down. Null when the note has no contract. */
export function contractOf(head: string): ContractView | null {
  const sec = /^## Mission contract[^\n]*\n([\s\S]*?)(?=^## )/m.exec(head)?.[1];
  if (!sec) return null;
  const part = (title: string) => new RegExp(`^\\*\\*${title}[^\\n]*\\n((?:- .*\\n?)+)`, "m").exec(sec)?.[1]?.split("\n").filter((l) => l.startsWith("- ")) ?? [];
  // STATE.md lists rules by kind (skill, never, must, decision); the panel wants them newest first, by each rule's stamp
  const rules = part("Binding rules").map((l, i) => {
    const m = /^- \[([^\]]+)\] (“.*?”) _\(([^)]*)\)_(?: — why: (“.*?”))?/.exec(l);
    return m ? { kind: m[1]!, text: unq(m[2]!), ...(m[4] ? { why: unq(m[4]) } : {}), at: /\d{4}-\d\d-\d\d \d\d:\d\d/.exec(m[3]!)?.[0] ?? "", i } : null;
  }).filter((x): x is { kind: string; text: string; why?: string; at: string; i: number } => !!x)
    .sort((a, b) => (a.at === b.at ? b.i - a.i : a.at < b.at ? 1 : -1)).map(({ at: _at, i: _i, ...r }) => r);
  const superseded = part("Superseded").map((l) => /~~(“.*?”)~~ → replaced by (“.*?”)/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ text: unq(m[1]!), by: unq(m[2]!) }));
  const rejected = part("Rejected").map((l) => /^- (.*?) → the user: (“.*?”)/.exec(l)).filter((m): m is RegExpExecArray => !!m).filter((m) => !/^“<bash-/.test(m[2]!)).map((m) => ({ what: unq(m[1]!), why: unq(m[2]!) }));
  return { rules: rules.slice(0, 6), ruleCount: rules.length, superseded: superseded.slice(-3), rejected: rejected.slice(-3), conflicts: (sec.match(/⚠ A newer goal or decision contradicts this/g) ?? []).length };
}
