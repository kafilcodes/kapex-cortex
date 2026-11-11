import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { segments } from "./judge.ts";
import type { RepoPaths } from "./paths.ts";
import { scrub } from "./scrub.ts";

/**
 * The last few full exchanges of each session (your message, the AI's whole reply), so a handoff carries the exact
 * working context: if the last reply was a 5-phase plan, the next chat starts holding that plan, not a one-line gist.
 * Private (.vault/private/), secrets scrubbed, the newest KEEP per session.
 */
export interface Exchange { ts: string; user: string; assistant: string }
const KEEP = 6;
const MAX_USER = 6_000;
const MAX_REPLY = 20_000;

const file = (p: RepoPaths, session: string) => join(p.priv, `exchanges-${session.replace(/[^\w.-]/g, "_")}.jsonl`);

export function readExchanges(p: RepoPaths, session: string): Exchange[] {
  const f = file(p, session);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Exchange]; } catch { return []; } });
}

/** Record one turn at Stop: your own words (no pasted blocks, no harness notices) and the reply, both scrubbed. */
export function saveExchange(p: RepoPaths, session: string, userText: string, reply: string, now = new Date()): void {
  const user = segments(userText).map((s) => (s.source === "pasted" ? `[pasted text, ${s.text.length} chars]` : s.source === "command" ? "" : s.text)).join("\n").trim();
  const assistant = reply.trim();
  if (!user && !assistant) return;
  const ex: Exchange = { ts: now.toISOString(), user: scrub(user).text.slice(0, MAX_USER), assistant: scrub(assistant).text.slice(0, MAX_REPLY) };
  const all = [...readExchanges(p, session), ex].slice(-KEEP);
  const f = file(p, session);
  if (all.length === 1) appendFileSync(f, JSON.stringify(ex) + "\n");
  else writeFileSync(f, all.map((x) => JSON.stringify(x)).join("\n") + "\n");
}

/** Unchecked checklist items and "Next:" lines in a reply: what is still open. */
export function openItems(reply: string): string[] {
  const out: string[] = [];
  for (const line of reply.split("\n")) {
    const box = /^\s*[-*]\s*\[ \]\s+(.+)$/.exec(line);
    const next = /^\s*(?:\*\*)?Next(?: action| step)?(?:\*\*)?\s*[:：]\s*(.+)$/i.exec(line);
    const left = /\|\s*([^|]+?)\s*\|\s*(?:❌|🟡|⏳|left|pending|not (?:done|started))(?=\s|\||$)/i.exec(line); // no \b: an emoji has no word edge
    const item = box?.[1] ?? next?.[1] ?? left?.[1];
    if (item && !out.includes(item.trim())) out.push(item.replace(/\*\*/g, "").trim().slice(0, 200));
  }
  return out.slice(0, 12);
}
