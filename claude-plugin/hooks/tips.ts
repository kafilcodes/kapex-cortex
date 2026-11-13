import type { CacheView, LiveView, StatusView } from '../types'
import { cacheState, clock, k } from './charts'
import { ago, minsSince, toReview } from './data'
import { K } from './theme'

// One tip at a time for the status strip and the Overview, from data already on hand, as a traffic light:
//   act  (rose)   a move worth making now, with what it saves: hand off before a cold re-read or compaction
//   warn (amber)  something to know, and that it's fine to continue: the cache cooling, context or plan filling up,
//                 memory to review, tools you never use, a Dream that's due
//   ok   (emerald) a fresh chat with a handoff from another chat: continue from it
// No tip means all is well (the strip says so). Short words in the strip; the reason on hover and in the panel.
export type TipAction = 'handoff' | 'dream' | 'review' | 'costs' | 'resume'
export type Tip = { level: 'act' | 'warn' | 'ok'; icon: string; text: string; detail: string; color: string; action?: TipAction }

const DAY = 24 * 60
// Model economics (API prices, checked 2026-11-13; see .claude/rules/engineering.md): Fable 5.2 is $8/$40 per M tokens,
// Opus 5.5 $4/$20. The plan is the scarce thing on a subscription, so the tip says it only when the plan runs low.
const onFable = (l: LiveView | null) => /fable|mythos/i.test(l?.model ?? '')
const FABLE_NOTE = ' You are on Fable, about twice the price of Opus 5.5 per token: for routine edits and test loops, /model opus stretches the plan; keep Fable for deep design and audits.'

export function tipFor(s: StatusView, l: LiveView | null, cv: CacheView, limits: LiveView['limits'], sw: { pct: number } | null = null): Tip | null {
  const ctx = l?.context.tokens ?? 0
  const pct = l?.context.percent ?? 0
  const rows = l?.context.rows ?? []
  const win = l?.context.window ?? 1
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const compactAt = buffer ? (win - buffer) / win : 0.9
  const at = (s.prefs?.handoffAt ?? 80) / 100
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const start = (s.handoff.preview?.tokens || 2000) + (s.native?.alwaysTokens ?? 0)
  const save = Math.max(0, ctx - start)
  const fresh = s.handoff.exists ? ` A new chat starts with about ${k(start)} tokens.` : ''
  const five = limits.find(x => x.kind === 'five_hour')?.percentUsed ?? 0

  // red: a move that saves real tokens or work now
  if (cs.state === 'cold' && ctx > 150_000) return { level: 'act', icon: 'alert', color: K.rose, action: 'handoff', text: `Cold cache · hand off, save ~${k(save)}`, detail: `Your next message here re-reads all ${k(ctx)} tokens at full price.${fresh}` }
  if (sw || (ctx > 100_000 && pct / 100 >= Math.min(at, compactAt - 0.05))) return { level: 'act', icon: 'link', color: K.rose, action: 'handoff', text: `${pct}% full · hand off, save ~${k(save)}`, detail: `Every message here carries ${k(ctx)} tokens, and Claude summarizes the chat near ${Math.round(compactAt * 100)}%.${fresh}` }
  if (five >= 90) return { level: 'act', icon: 'alert', color: K.rose, action: 'handoff', text: `5h plan ${five}% · hand off`, detail: `Save the handoff, then continue in OpenCode (free models) with /cortex-resume, or wait for the reset.${onFable(l) ? FABLE_NOTE : ''}` }

  // green, ahead of the amber ones: a fresh chat, and a recent handoff written by another chat. Continuing is the move
  const other = !s.handoff.session || !l?.sessionId || s.handoff.session !== l.sessionId
  if (l && l.turns === 0 && other && s.handoff.exists && s.handoff.ageMinutes !== null && s.handoff.ageMinutes < 3 * DAY) return { level: 'ok', icon: 'link', color: K.emerald, action: 'resume', text: `Continue: /cortex-resume · ${ago(s.handoff.ageMinutes)}`, detail: `A handoff from ${s.handoff.chat ? `“${s.handoff.chat}”` : s.handoff.from || 'your last session'} is saved.${fresh}` }

  // amber: worth knowing, fine to continue
  if (cs.state === 'cold' && ctx > 50_000) return { level: 'warn', icon: 'pending', color: K.amber, action: 'handoff', text: `Cache cold · next reply re-reads ${k(ctx)}`, detail: `The cache expired ${ago(Math.round((Date.now() - cs.until!) / 60_000))}. Your next message here is read again at full price; a new chat with /cortex-resume starts at about ${k(start)}.` }
  if (cs.state === 'cooling' && ctx > 50_000) return { level: 'warn', icon: 'pending', color: K.amber, text: `Cache cools at ${clock(cs.until!)} · reply before`, detail: `After that, your next message re-reads ${k(ctx)} tokens at full price. Fine to continue.` }
  if (ctx > 100_000 && pct / 100 >= Math.min(at, compactAt) - 0.15) return { level: 'warn', icon: 'turn', color: K.amber, text: `${pct}% full · fine to continue`, detail: `Cortex suggests a fresh chat at ${Math.round(at * 100)}%.${fresh}` }
  if (five >= 70) return { level: 'warn', icon: 'pending', color: K.amber, text: `5h plan ${five}% · fine to continue`, detail: `At 90% Cortex suggests handing off, so you can continue in OpenCode or after the reset.${onFable(l) ? FABLE_NOTE : ''}` }
  const waiting = toReview(s)
  if (waiting) return { level: 'warn', icon: 'dream', color: K.amber, action: 'review', text: `${waiting} memory fix${waiting === 1 ? '' : 'es'} to review`, detail: 'A Dream or Quick check found notes that look wrong or stale. Decide before a new chat trusts them.' }
  // the last turn filled this chat with tool output: a subagent would have kept it out (measured from the journal)
  const [e0, e1] = s.episodes ?? []
  if (e0 && e1 && e0.session === e1.session && Date.now() - Date.parse(e0.end) < 30 * 60_000) {
    const grew = e0.contextTokens - e1.contextTokens
    const reads = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'].reduce((a, n) => a + (e0.tools[n] ?? 0), 0)
    if (grew >= 40_000 && reads >= 12) return { level: 'warn', icon: 'spark', color: K.amber, text: `Last turn added ~${k(grew)}`, detail: `Mostly tool output (${reads} reads and commands). For big searches or test runs, ask for a subagent: only its summary lands here (its tokens still count toward your plan).` }
  }
  const unused = unusedTools(s, l, 500)
  const waste = unused.reduce((a, x) => a + x.loaded, 0)
  if (waste >= 5000) return { level: 'warn', icon: 'spark', color: K.amber, action: 'costs', text: `Save ~${k(waste)} tokens a message`, detail: `${[...new Set(unused.map(toolName))].join(', ').replace('a connector', 'claude.ai connectors')} load into every message but weren't used in your recent chats. Turn them off in Costs (new chats only; one press turns them back on).` }
  // a Dream is due: none in 3 days (or ever) and a good few chats since
  const last = s.dream.recent[0]?.ts
  const since = (s.episodes ?? []).filter(e => !last || e.end > last)
  const sessions = new Set(since.map(e => e.session)).size
  if (!s.dream.running && sessions >= 3 && since.length >= 10 && (!last || (minsSince(last) ?? 0) > 3 * DAY)) return { level: 'warn', icon: 'dream', color: K.amber, action: 'dream', text: `Dream due · ${last ? `last ${ago(minsSince(last))}` : 'none yet'}`, detail: `${sessions} chats since${last ? ' the last Dream' : ''}. A Dream checks Claude's memory against them in the background and only proposes changes.` }

  return null
}

/** Servers the Claude app itself provides (the session, the browser pane, the simulator…): you can't turn them off, so never suggest it. */
const BUILT_IN = /^(ccd_|Claude_|claude-in-chrome|mcp-registry|scheduled-tasks|terminal|visualize|kapex-cortex|plugin-authoring)/
/** A claude.ai connector is named by an id; say "a connector" instead of a string of hex. */
export const toolName = (x: { name: string }) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(x.name) ? 'a connector' : x.name.replace(/^plugin_/, ''))
/** MCP servers and plugin skills that load every message but weren't used in recent chats here (built-ins left out). */
export function unusedTools(s: StatusView, l: LiveView | null, min: number): NonNullable<LiveView['loadout']> {
  return (l?.loadout ?? []).filter(x => x.loaded >= min && s.usage && !BUILT_IN.test(x.name)
    && (x.kind === 'mcp' ? !(s.usage.mcp[x.name] ?? 0) : !Object.keys(s.usage.skills).some(n => n.startsWith(`${x.name}:`) || (x.names ?? []).includes(n.split(':').pop()!))))
}
