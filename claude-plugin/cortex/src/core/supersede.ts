import { findReplaced } from "./judge.ts";
import type { Mission, Pin } from "./mission.ts";

/**
 * A contract carried across many chats collects statements that a newer one overrides: "work only … on main" from
 * chat 1, then a north star in chat 3 that says "on branch v4.6-ui, in its worktree". Carrying both forward hands the
 * next chat a contradiction. Deterministic and conservative:
 *   - a pin that confines work to a place loses to a newer goal or decision that names a different branch or worktree;
 *   - an older decision loses to a newer decision that clearly updates it (findReplaced, sure only).
 * A decision (recorded at handoff) is moved to `superseded`, shown in the packet as no longer binding. The user's own
 * rules (never/must/skill) are never dropped by a machine: they are flagged with the newer statement, for the chat to ask.
 */
export interface Superseded { text: string; kind: Pin["kind"]; by: string; at: string }
const MAX_SUPERSEDED = 6;
/** "work only in X on main", "only commit on main", "work on main only" */
const PLACE_RULE = /\b(?:work|working|stay|commit|build)\s+only\s+(?:in|on|from)\b|\bonly\s+(?:work|commit|build)\s+(?:in|on|from)\b|\b(?:work|commit)\s+(?:in|on)\s+[^.;]{0,80}?\bonly\b/i;
/** a captured word that is a branch, not "on the panel": main and friends, or anything with a digit, "/" or "-" */
const BRANCHISH = /^(?:main|master|develop|trunk)$|[\d/-]/;

/** The branches and worktrees a sentence names: "on branch v4.6-ui", "on main", "worktree .claude/worktrees/x". */
export function places(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/\b(?:on|branch)\s+(?:branch\s+)?`?([A-Za-z0-9][\w./-]*\w)`?/gi)) { const x = m[1]!.toLowerCase(); if (BRANCHISH.test(x)) out.add(x); }
  for (const m of s.matchAll(/\bworktree\s+`?([.\w][\w./-]*\w)`?/gi)) out.add(m[1]!.toLowerCase());
  return out;
}

const clip = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > 200 ? `${t.slice(0, 199)}…` : t; };

/** Apply a newer explicit statement (`s`, made in chat `hop` at `at`) to the older pins. `own` is the pin `s` became.
 *  Older means an earlier chat, or the same chat earlier: times alone mislead across a chain (a rebuilt parent record
 *  stamps its pins with the rebuild's time, an inherited goal keeps its first chat's time). */
export function supersede(m: Mission, s: string, at: string, hop: number, own?: Pin): void {
  const next = places(s);
  for (const p of [...m.pins]) {
    if (p === own || p.hop > hop || (p.hop === hop && p.at > at)) continue;
    let replaced = false;
    if (next.size && PLACE_RULE.test(p.text)) { const old = places(p.text); replaced = old.size > 0 && ![...next].some((x) => old.has(x)); }
    if (!replaced && own?.kind === "decision" && p.kind === "decision") replaced = !!findReplaced(s, [{ id: "p", text: p.text }])?.sure;
    if (!replaced) continue;
    if (p.kind === "decision") {
      m.pins.splice(m.pins.indexOf(p), 1);
      const list = (m.superseded ??= []);
      if (!list.some((x) => x.text === p.text)) list.push({ text: p.text, kind: p.kind, by: clip(s), at });
      list.splice(0, Math.max(0, list.length - MAX_SUPERSEDED));
    } else p.conflict = clip(s);
  }
}
