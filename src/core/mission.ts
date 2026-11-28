import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteIfChanged } from "../util/atomic.ts";
import { ulid } from "../util/ulid.ts";
import { noRefs, requestText, withoutLeadIn } from "./brief.ts";
import { questionOnly, triedAndDropped, turnScoped } from "./mission-signals.ts";
import { segments } from "./judge.ts";
import type { RepoPaths } from "./paths.ts";
import { scrub } from "./scrub.ts";
import type { Turn } from "./turns.ts";
import { supersede, type Superseded } from "./supersede.ts";
import { stepsOf, stepTicker, type Step } from "./mission-steps.ts";

/**
 * The mission contract: what a chain of chats on one task must never lose, however many handoffs it goes through.
 *
 * Before v4.5 each chat re-read the chat before it from its rendered STATE.md: clipped lines, a pinned section cut to
 * fit ("- […]"), and an instruction filter that needed "must"/"never". A mandate said once in chat 1 ("use the
 * stageshow skill fully") lived only in chat 1's "Started with" line, which no later chat carried, and was gone by
 * chat 3. Now the contract is structured data, copied whole from hop to hop (states/<session>.mission.json):
 *   goal       the north star, set once per mission; never replaced by "continue" or "the limit reset"
 *   pins       the user's binding words, verbatim: mandatory skills, never/don't rules, must/only rules, decisions
 *   rejected   what the user turned down and why, so no later chat proposes it again
 *   lineage    hop count, origin session, parent handoff, git head: which chain this chat is in
 * A mission ends when the user says it is done or starts a new task; it is archived (missions-archive.jsonl), and its
 * pins stop applying, so old constraints never send a new task on a side quest.
 */
export type PinKind = "skill" | "never" | "must" | "decision";
export interface Pin { text: string; kind: PinKind; at: string; session: string; hop: number;
  /** the reason given in the sentence right after the rule ("Never use docker. It eats the 16 GB.") */ why?: string;
  /** a newer goal or decision that contradicts this rule of the user's (supersede.ts): shown, for the chat to ask */
  conflict?: string }
export interface Rejected { what: string; why: string; at: string; session: string; hop: number }
export interface Mission { id: string; goal: string; goalAt: string; goalHop: number; pins: Pin[]; rejected: Rejected[]; status: "active" | "done"; doneAt?: string;
  /** the goal came from a pre-v4.5 packet's rolling "## Goal" line (often a step long finished): the first real task
   * this chain states replaces it */
  goalLegacy?: boolean;
  /** older decisions a newer goal or decision replaced (supersede.ts): shown as no longer binding */
  superseded?: Superseded[]; /** what you asked for, item by item, ticked as it gets done (mission-steps.ts); the newest close/reopen applied */ steps?: Step[]; marksAt?: string }
export interface Lineage { handoffId: string; parentHandoffId: string | null; parentSession: string | null; hop: number; originSession: string; gitHead: string | null; branch?: string; worktree?: string }
export interface MissionRecord { v: 1; session: string; at: string; inherited: Mission | null; mission: Mission; lineage: Lineage; /** missions this chat closed or replaced, already archived */ archivedIds?: string[];
  /** the last of this chat's messages read into `mission`, and how many there were up to it: the next turn reads only
   * newer ones (a rewind that removed one makes the count differ, and the contract is read again from the start) */
  upTo?: string; seen?: number;
  rev?: number /* the reader that built it (MISSION_REV) */ }
/** What a parent written before v4.5 had: its STATE.md lists, read back once. */
export interface LegacyParent { session: string; goal: string; started: string; rules: string[]; decisions: string[] }

/** The north star keeps this many characters (kc handoff --goal warns past it). */
export const GOAL_CHARS = 600;
export const MISSION_REV = 7; // bumped when the reading rules change, so older contracts are rebuilt once. 7: steps from your numbered lists, and their ticks. 6: pleas, cut-off fragments, quoted replies and `!command` output never bind (5: paste-only directives count)
export const MAX_PINS = 16, MAX_REJECTED = 10, PIN_CHARS = 420;
const recordFile = (p: RepoPaths, s: string) => join(p.states, `${s.replace(/[^A-Za-z0-9_-]/g, "_")}.mission.json`);
const archiveFile = (p: RepoPaths) => join(p.priv, "missions-archive.jsonl");
const oneLine = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t; };
export const pinKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);

// ---- reading the user's own words --------------------------------------------------------------------------------

// A rule is a directive to the assistant, not any sentence with a trigger word: "I don't see the button", "It always
// crashes when I click save" and "Don't worry about lint" are reports, and stay out of the contract (a false rule
// costs twice: it misleads the next chat, and it can push a real one out over the cap).
/** Lead-in words before a directive: "and use…", "also, never…", "note - keep…", "Second: never…". */
const LEAD = /^(?:(?:and|also|but|so|plus|then|note|ps|please|pls|ok(?:ay)?|important|remember|rule|first|second|third|next|finally|again)\b[\s,:.!-]*)+|^[A-Za-z][\w ]{0,20}:\s+/i;
/** About what the user sees or what the code does, not addressed to the assistant. */
const REPORT = /^(?:i|i'm|im|i've|i'd|it|it's|its|this|that|there|these|those|he|she|they|my|our|your|the \w+ (?:is|was|are|were|has|had|does|did|crashes|fails|shows|looks|works))\b/i;
const NOT_RULE = /^(?:don'?t|do not) (?:worry|mind|bother|know|think|see|understand|care|get|forget to (?:tell|let))\b/i;
const SKILL = /\b(?:use|using|invoke|invoking|load|apply|follow)\b[^.\n]{0,70}?\bskill\b(?!s?\s+(?:page|tab|section|list|card|panel|file|folder))|\bvia the skill tool\b/i;
const NEVER_START = /^(?:never|don'?t|do ?not|must ?n[o']t|avoid|no more|stop (?:using|doing|adding|changing|touching)|leave\b[^\n]{0,60}?\b(?:alone|untouched|as (?:it )?is)\b|keep\b[^\n]{0,110}?\b(?:intact|untouched|separate|as (?:it )?is|unmerged|private|unchanged)\b)/i;
const MUST_START = /^(?:always|must|make sure|ensure|only (?:use|touch|change|edit|work|commit)|stick to|use only|keep\b[^\n]{0,60}?\b(?:under|below|within|at least|at most)\b)/i;
/** A modal aimed at the work anywhere: "you must…", "it must stay under 60 ms", "we should never…". */
const MODAL = /\b(?:you|we|it|this|everything|each \w+|every \w+)\s+(?:must|should|have to|has to|needs? to)(\s+(?:not|never))?\b|\bmust (not |never )?(?:be|stay|keep|use|run|pass|have|follow)\b|\bis (?:mandatory|required)\b/i;
/** "Switch to XML and never use CSV again": an imperative with a never/always clause. */
const CLAUSE = /(?:\band|\bbut|,|\bthen)\s+(never|don'?t|do not|always|must)\b/gi;
/** "don't make mistakes": a plea naming nothing to keep or avoid; as a never-rule it would outrank real decisions. */
const PLEA = /^['’\s]*(?:make (?:any )?mistakes?|mess (?:it |this |that |things |anything )?up)\s*(?:(?:okay|ok|note|please|pls)\b\s*)*$/i;
/** Dictation cut off mid-thought: "keep separate branches so new changes and." */
const DANGLING = /\b(?:and|or|but|because|the|a|an|of)\s*[.!,]*\s*$/; // lowercase only: "plan A." names something; never so/to/that/for: "unless I say so" is whole
/** A sentence that only looks like a rule: a plea, or a fragment. */
export function noiseRule(raw: string): boolean {
  const t = plain(raw).replace(LEAD, "").trim();
  if (DANGLING.test(t)) return true;
  const m = /^(?:never|don'?t|do not)\b(.*)$/i.exec(t);
  return !!m && PLEA.test(m[1]!.replace(/[.!,]+\s*$/, ""));
}
/** About this turn only, not a standing rule. */
const TRANSIENT = /\b(?:yet|right now|this (?:turn|reply|message|time)|for a (?:sec|second|moment)|just now)\b/i;
const NEW_TASK = /^(?:(?:ok(?:ay)?|now|so|alright)[\s,.!-]+)?(?:(?:let'?s |please )?(?:start|begin|switch to|move on to|moving on to) (?:a |on a |to a )?(?:new|different|another|fresh) (?:task|mission|project|topic|thing)|new (?:task|mission)\s*[:：-]|forget (?:the |about the )?(?:previous|old|last|earlier) (?:task|mission|plan|work)|different task\s*[:：-])/i;
/** Closing a mission takes a short sentence that says so ("Great, the task is done."), never a passing "work done". */
const DONE = /^(?:(?:great|perfect|nice|ok(?:ay)?|good|thanks|cool|awesome|yes)[\s,.!-]+)*(?:(?:the |this |our )?(?:task|mission|project|goal|feature|release)\s+is\s+(?:now\s+)?(?:done|complete|completed|finished|shipped|merged)|mission (?:complete|accomplished)|we'?re (?:all )?done|all done)\b[\s.!]*(?:thanks?\b[^?]*|thank you\b[^?]*)?$/i;
const GOAL = /(?:^|\n)\s*(?:north[- ]?star|goal|mission)\s*[:：-]\s*(.{15,})/i;
/** Turning something down, in so many words: never "No problem", "Nope, all good" or "Undo works now". */
const REJECT = /^(?:reject(?:ed)?\b|revert (?:it|this|that)\b|undo (?:it|this|that)\b|roll ?back\b|not good\b|i don'?t like (?:it|this|that)\b|that'?s (?:wrong|not (?:it|right|good|what i))|this (?:is|looks) (?:not good|wrong|worse|bad|ugly)|no[,.!]+\s+(?:that|this|it'?s|it is|don'?t|not|wrong|stop)\b)|\breject(?:ed|ing)?\b|\b(?:is|was|looks like) a downgrade\b|\b(?:revert|undo|roll back) (?:it|this|that|the (?:change|commit))\b|\bdead end\b|\bnot what i (?:asked|wanted)\b|\bdon'?t merge\b/i;
/** Curly quotes (dictation, macOS) read as straight ones. */
const plain = (s: string) => s.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');

/** The words the person typed in one message: no pasted blocks, no harness notices, no attachments or leading command. */
export function ownWords(t: Turn): string {
  // attachments first: `@"brief.md" /cortex-resume and …` is a command followed by your words
  return requestText(t).split("\n").map(noRefs).filter(Boolean).join("\n").replace(/^\/[\w:-]+\s*/, "").trim(); // line breaks kept: a quote between two parts is a break
}

/** A sentence's kind as a standing rule, or null when it is not one. */
export function pinKind(raw: string): PinKind | null {
  const s = plain(raw);
  // "don't edit yet" is about this turn; "do NOT merge or publish yet until I review your report" is a standing rule
  if (s.length < 12 || /\?\s*$/.test(s) || (s.length < 50 && TRANSIENT.test(s))) return null;
  const t = s.replace(LEAD, "").trim();
  if (NOT_RULE.test(t) || noiseRule(t)) return null;
  const report = REPORT.test(t);
  if (SKILL.test(t) && !report) return "skill";
  if (NEVER_START.test(t)) return "never";
  if (MUST_START.test(t)) return "must";
  const modal = MODAL.exec(t);
  if (modal) return modal[1] || modal[2] ? "never" : "must";
  if (report) return null;
  // the first clause that names something: "think harder, don't make mistakes" binds nothing
  for (const c of t.matchAll(CLAUSE)) {
    const rest = t.slice(c.index! + c[0].length).split(/[,;]|\band\b/i)[0] ?? "";
    if (!PLEA.test(rest)) return /always|must/i.test(c[1]!) ? "must" : "never";
  }
  return null;
}

export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(*`])|\n+|\s+-\s+(?=[A-Za-z])|\s*;\s+/)
    .map((s) => s.replace(/^[-*>\d.)\s]+/, "").replace(/\*\*/g, "").trim()).filter(Boolean);
}

/** The reason for the sentence before it: a chat that knows why a guardrail exists won't remove it as clutter. */
const REASON = /^(?:because|since|otherwise|so that|the reason|reason\s*:|why\s*:|that'?s why|kyunki|warna|(?:it|this|that|they) (?:breaks?|broke|caused?|causes|costs?|kills?|killed|wipes?|wiped|leaks?|leaked|eats|ate|crashe[sd]|corrupt\w*|look(?:s|ed) (?:cheap|bad|broken|wrong|off|ugly|awful|messy|cluttered|muddy|terrible|worse)|made (?:it|us|me|the|every)|makes (?:it|us|me|the|every)|slow(?:s|ed)?|took|takes|wasted?|fail(?:s|ed)|blocks?|blocked|los(?:es|t)|delet(?:es|ed)|hurts?|hit|was (?:too|the reason|why)|is (?:too|why)))\b/i;
/** The binding sentences of one message, verbatim (scrubbed of secrets), each with the reason that follows it. */
export function pinsOf(text: string): { text: string; kind: PinKind; why?: string }[] {
  const out: { text: string; kind: PinKind; why?: string }[] = [], ss = sentences(text);
  ss.forEach((s, i) => {
    const kind = pinKind(s), next = ss[i + 1];
    const why = next && REASON.test(plain(next)) && !pinKind(next) && !/\?\s*$/.test(next) ? oneLine(scrub(next).text, 200) : "";
    if (kind) out.push({ text: oneLine(scrub(s).text, PIN_CHARS), kind, ...(why ? { why } : {}) });
  });
  return out;
}

/** A pasted block that reads like an assistant's reply (first person, "Done", tables of results): never yours to keep. */
export function looksLikeReply(text: string): boolean {
  const ss = sentences(plain(text));
  // how a reply talks, not how a person does ("I verified…", "I want…" are yours): I've, I'll, Done, Stopped, Here's…
  const said = ss.filter((x) => /^(?:I've|I'll|I'd|We've|We'll|Done|Here's|Here is|Let me|Sure|Got it|Stopped|Saved|Picking up|Next:)\b/.test(x)).length;
  return /### Assistant|^\|.*\|\s*$/m.test(text) || said >= 3 || (ss.length > 0 && said / ss.length >= 0.25);
}
/** Rules in text you pasted (a brief written elsewhere, as people often do): only sentences that open as a directive
 * (never/don't/always/must/use the … skill), and never from a pasted reply. */
export function pastedPins(t: Turn): { text: string; kind: PinKind }[] {
  const out: { text: string; kind: PinKind }[] = [];
  for (const seg of segments(t.text).filter((x) => x.source === "pasted")) {
    if (looksLikeReply(seg.text)) continue;
    for (const raw of sentences(seg.text)) {
      const s = plain(raw), lead = s.replace(LEAD, "").trim();
      if (s.length < 12 || /\?\s*$/.test(s) || NOT_RULE.test(lead) || REPORT.test(lead) || noiseRule(lead)) continue;
      const kind: PinKind | null = SKILL.test(lead) ? "skill" : NEVER_START.test(lead) ? "never" : MUST_START.test(lead) ? "must" : null;
      if (kind) out.push({ text: oneLine(scrub(raw).text, PIN_CHARS), kind });
    }
  }
  return out;
}
// ---- merging --------------------------------------------------------------------------------------------------------

/** A new mission; one begun by a message has an id made from it, so a contract rebuilt from scratch keeps it (and its ticks). */
const fresh = (seed?: string): Mission => ({ id: `m_${seed ? createHash("sha256").update(seed).digest("hex").slice(0, 26).toUpperCase() : ulid()}`, goal: "", goalAt: "", goalHop: 0, pins: [], rejected: [], status: "active" });
const clone = (m: Mission): Mission => ({ ...m, pins: m.pins.map((x) => ({ ...x })), rejected: m.rejected.map((x) => ({ ...x })), ...(m.steps ? { steps: m.steps.map((x) => ({ ...x })) } : {}) });
/** An inherited contract without what an older reader let in: pleas and fragments as rules, a `!command`'s output as a
 * rejection. Only those are dropped; every other pin and rejection is carried as it was. */
const cleaned = (m: Mission): Mission => ({ ...m, pins: m.pins.filter((x) => x.kind === "decision" || !noiseRule(x.text)), rejected: m.rejected.filter((x) => !/<bash-(?:input|stdout|stderr)>/.test(x.why)) });
const RANK: Record<PinKind, number> = { skill: 4, never: 3, decision: 2, must: 1 };

export function addPin(m: Mission, pin: Pin): void {
  const k = pinKey(pin.text);
  if (!k || m.pins.some((x) => pinKey(x.text) === k)) return;
  m.pins.push(pin);
  // over the cap, the weakest kind goes first, oldest first: a skill mandate or a never-rule outlives any "must"
  while (m.pins.length > MAX_PINS) {
    let drop = 0;
    m.pins.forEach((x, i) => { const d = m.pins[drop]!; if (RANK[x.kind] < RANK[d.kind] || (RANK[x.kind] === RANK[d.kind] && x.at < d.at)) drop = i; });
    m.pins.splice(drop, 1);
  }
}
function addRejected(m: Mission, r: Rejected): void {
  if (m.rejected.some((x) => pinKey(x.why) === pinKey(r.why))) return;
  m.rejected.push(r);
  m.rejected.splice(0, Math.max(0, m.rejected.length - MAX_REJECTED));
}

/** A parent from before v4.5, as a mission: its goal, its first message's rules, its standing instructions and decisions. */
export function legacyMission(lp: LegacyParent, at: string): Mission {
  const m = fresh(`legacy:${lp.session}`);
  m.goal = oneLine(lp.goal || lp.started, GOAL_CHARS); m.goalAt = at; m.goalHop = 1; m.goalLegacy = true;
  // an old packet's "standing instructions" came from a looser reader (pasted replies, cut sentences): only the ones
  // that read as directives today are kept, never a fallback "must"
  const rules = lp.rules.flatMap((r) => { const kind = pinKind(r); return kind ? [{ text: oneLine(r, PIN_CHARS), kind }] : []; });
  for (const s of [...pinsOf(lp.started), ...rules]) addPin(m, { ...s, at, session: lp.session, hop: 1 });
  for (const d of lp.decisions) addPin(m, { text: oneLine(d, PIN_CHARS), kind: "decision", at, session: lp.session, hop: 1 });
  return m;
}

export interface MissionInput {
  session: string; turns: Turn[]; now: Date;
  parent: MissionRecord | null; legacy?: LegacyParent | null;
  /** this session's turns, oldest first (what each rejection turned down) */
  episodes: { end: string; ask: string; done: string }[];
  decisions?: string[];
  /** a north star recorded on purpose (/cortex-handoff --goal): it wins over anything read from the messages */
  goal?: string;
  git?: { head: string | null; branch?: string; worktree?: string };
}

/** This session's contract: the one it inherited, plus what its own messages added. Deterministic and idempotent. */
export function computeMission(p: RepoPaths, a: MissionInput): MissionRecord {
  // a record built by an older reader (no `rev`, or a lower one) is rebuilt once from the turns: what it inherited and
  // pinned may hold what that reader got wrong
  const stored = readMissionRecord(p, a.session);
  const prev = stored && stored.rev === MISSION_REV ? stored : null;
  const parentSession = a.parent?.session ?? a.legacy?.session ?? null;
  const nowIso = a.now.toISOString();
  // the inherited contract is fixed when this chat first continues its parent: a parent that goes on to other work
  // later never changes what this chat was handed
  const inherited = prev && prev.lineage.parentSession === parentSession && prev.inherited ? prev.inherited
    : a.parent ? cleaned(clone(a.parent.mission)) : a.legacy ? legacyMission(a.legacy, nowIso) : null;
  const hop = a.parent ? a.parent.lineage.hop + 1 : a.legacy ? 2 : 1;
  const lineage: Lineage = {
    handoffId: stored?.lineage.handoffId ?? `h_${ulid(a.now.getTime())}`,
    parentHandoffId: a.parent?.lineage.handoffId ?? null, parentSession, hop,
    originSession: a.parent?.lineage.originSession ?? a.legacy?.session ?? a.session,
    gitHead: a.git?.head ?? null, branch: a.git?.branch, worktree: a.git?.worktree || undefined,
  };
  const archived: Mission[] = [];
  const upTo = prev?.upTo ?? "";
  const resume = !!prev && prev.inherited === inherited && !!upTo && a.turns.filter((t) => t.id <= upTo).length === prev.seen;
  let m = resume ? clone(prev!.mission) : inherited && inherited.status === "active" ? clone(inherited) : fresh(`${a.session}:start`);
  const ticks = stepTicker(p, hop, looksLikeReply);
  if (!resume && inherited && inherited.status !== "active") archived.push(inherited);
  const eps = a.episodes;
  for (const t of resume ? a.turns.filter((x) => x.id > upTo) : a.turns) {
    const words = ownWords(t), pasted = pastedPins(t), ts = t.ts;
    const listed = segments(t.text).map((x) => x.text).join("\n"); // your numbered lists become the mission's steps
    ticks.message(m, "", ts); // ticks made before this message (an add, a close from the panel) land first
    // a message that is only a paste (a brief written elsewhere) has no typed words, but its directives still bind
    if (!words) {
      if (!pasted.length && !stepsOf(listed, looksLikeReply).length) continue;
      if (m.status === "done") { archived.push({ ...m, doneAt: m.doneAt ?? ts }); m = fresh(`${a.session}:${t.id}`); } // a brief after "done" is the next task
      ticks.message(m, listed, ts);
      for (const pin of pasted) addPin(m, { ...pin, at: ts, session: a.session, hop });
      continue;
    }
    const lead = withoutLeadIn(words), said = plain(words);
    if (NEW_TASK.test(said) || (m.status === "done" && lead.length >= 60)) {
      if (m.goal || m.pins.length) { archived.push({ ...m, status: m.status, doneAt: m.doneAt ?? ts }); }
      m = fresh(`${a.session}:${t.id}`);
    }
    ticks.message(m, listed, ts);
    if (said.length <= 120 && DONE.test(said)) { m.status = "done"; m.doneAt = ts; continue; }
    const named = GOAL.exec(words)?.[1];
    if (named) { m.goal = oneLine(scrub(named).text, GOAL_CHARS); m.goalAt = ts; m.goalHop = hop; supersede(m, m.goal, ts, hop); }
    else if ((!m.goal && lead.replace(NEW_TASK, "").trim().length >= 15 && !questionOnly(lead)) || (m.goalLegacy && lead.length >= 60 && !/^\/?cortex-resume\b/i.test(lead))) { m.goal = oneLine(scrub(lead.replace(NEW_TASK, "").trim()).text, GOAL_CHARS); m.goalAt = ts; m.goalHop = hop; m.goalLegacy = undefined; }
    for (const pin of [...pinsOf(words), ...pasted].filter((x) => !turnScoped(x.text))) addPin(m, { ...pin, at: ts, session: a.session, hop }); // "Don't edit anything." holds for one turn
    if (REJECT.test(said.slice(0, 400))) {
      const before = [...eps].reverse().find((e) => e.end <= ts);
      const what = /\breject(?:ed)?\s*[:：-]\s*(.{8,})/i.exec(words)?.[1] ?? (before ? before.done || before.ask : "");
      addRejected(m, { what: oneLine(scrub(what || "(the approach in the reply before)").text, 220), why: oneLine(scrub(words).text, 320), at: ts, session: a.session, hop });
    }
    for (const d of triedAndDropped(words)) addRejected(m, { what: oneLine(scrub(d.what).text, 220), why: oneLine(scrub(d.why).text, 320), at: ts, session: a.session, hop }); // "we tried X and it crashed"
  }
  if (a.goal && m.status === "active") {
    const g = oneLine(scrub(a.goal).text, GOAL_CHARS);
    if (g !== m.goal) m.goalAt = nowIso; // a new north star is dated now, not by the goal it replaced
    m.goal = g; m.goalLegacy = undefined; m.goalHop = hop; m.goalAt = m.goalAt || nowIso; supersede(m, m.goal, nowIso, hop);
  }
  else if (m.goal && m.goalAt && !m.goalLegacy && m.status === "active") supersede(m, m.goal, m.goalAt, m.goalHop || 1); // every rebuild: pins older than the north star
  for (const d of a.decisions ?? []) {
    addPin(m, { text: oneLine(d, PIN_CHARS), kind: "decision", at: nowIso, session: a.session, hop });
    const own = m.pins.find((x) => pinKey(x.text) === pinKey(oneLine(d, PIN_CHARS)));
    if (own) supersede(m, own.text, own.at, own.hop, own); // a newer decision replaces the older one it updates
  }
  ticks.settle(m) // the ticks: Claude's (kc mission), yours (the panel)
  // a mission this chat closed or replaced is kept, once, for the record (never read back into a contract)
  const seen = new Set(stored?.archivedIds ?? []);
  const gone = archived.filter((x) => !seen.has(x.id));
  if (gone.length) { try { const had = existsSync(archiveFile(p)) ? readFileSync(archiveFile(p), "utf8").slice(-200_000) : ""; for (const x of gone) if (!had.includes(`"goalAt":${JSON.stringify(x.goalAt)},"goalHop"`) || !x.goalAt) appendFileSync(archiveFile(p), JSON.stringify({ ...x, archivedAt: nowIso, by: a.session }) + "\n"); } catch { /* best effort */ } } // once each, even when a rebuild gave it a new id
  const last = a.turns.at(-1)?.id ?? "";
  return { v: 1, rev: MISSION_REV, session: a.session, at: nowIso, inherited, mission: m, lineage, archivedIds: [...seen, ...gone.map((x) => x.id)].slice(-20), upTo: last, seen: last ? a.turns.filter((t) => t.id <= last).length : 0 };
}

export function readMissionRecord(p: RepoPaths, session: string): MissionRecord | null {
  try {
    const r = JSON.parse(readFileSync(recordFile(p, session), "utf8")) as MissionRecord;
    return r && r.v === 1 && r.mission && Array.isArray(r.mission.pins) && Array.isArray(r.mission.rejected) && r.lineage ? r : null;
  } catch { return null; }
}
export function writeMissionRecord(p: RepoPaths, rec: MissionRecord): void {
  atomicWriteIfChanged(recordFile(p, rec.session), JSON.stringify(rec), { durable: false });
}
