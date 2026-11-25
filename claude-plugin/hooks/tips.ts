import type { CacheView, LiveView, StatusView } from '../types'
import { cacheState, clock, k } from './charts'
import { ago, minsSince, toReview } from './data'
import { HEAT, K } from './theme'

// One tip at a time for the status strip and the Overview, from data already on hand, as a traffic light:
//   act  (rose)   a move worth making now, with what it saves: hand off before a cold re-read or compaction
//   warn (amber)  something to know, and that it's fine to continue: the cache cooling, context or plan filling up,
//                 memory to review, tools you never use, a Dream that's due
//   ok   (emerald) a fresh chat with a handoff from another chat: continue from it
// No tip means all is well (the strip says so). Short words in the strip (`text`); in the panel a headline (`head`) and
// the reason (`detail`), also on hover. A tip with an action is Cortex's recommendation: its head starts "Cortex suggests:"
// and says the move first; a tip without one says what Cortex noticed. No em dashes.
export type TipAction = 'handoff' | 'dream' | 'review' | 'costs' | 'resume'
export type Tip = { level: 'act' | 'warn' | 'ok'; icon: string; text: string; /** fewer words for a narrow strip */ short?: string; /** the same as a plain sentence, for the panel's headline */ head?: string; detail: string; color: string; action?: TipAction }

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
  if (cs.state === 'cold' && ctx > 150_000) return { level: 'act', icon: 'alert', color: HEAT.bad, action: 'handoff', text: `Handoff suggested · saves ~${k(save)} tokens of re-reading`, short: `Handoff suggested · ~${k(save)}`, head: 'Cortex suggests: hand off now', detail: `The cache went cold. A new chat saves about ${k(save)} tokens (this one re-reads ${k(ctx)} at full price).` }
  if (sw || (ctx > 100_000 && pct / 100 >= Math.min(at, compactAt - 0.05))) return { level: 'act', icon: 'link', color: pct >= 90 || pct / 100 >= compactAt - 0.05 ? HEAT.bad : HEAT.high, action: 'handoff', text: `Handoff suggested · saves ~${k(save)} a message`, short: `Handoff suggested · ~${k(save)}`, head: 'Cortex suggests: hand off now', detail: `This chat is ${pct}% full. A new chat saves about ${k(save)} tokens a message, before Claude summarizes this one near ${Math.round(compactAt * 100)}%.` }
  if (five >= 90) return { level: 'act', icon: 'alert', color: HEAT.bad, action: 'handoff', text: `5h plan ${five}% used · Handoff suggested`, short: 'Handoff suggested', head: 'Cortex suggests: save your place now', detail: `Your 5-hour plan is ${five}% used. Save the handoff, then continue in OpenCode (free models) with /cortex-resume, or wait for the reset.${onFable(l) ? FABLE_NOTE : ''}` }

  // green, ahead of the amber ones: a fresh chat, and a recent handoff written by another chat. Continuing is the move
  const other = !s.handoff.session || !l?.sessionId || s.handoff.session !== l.sessionId
  if (l && l.turns === 0 && other && s.handoff.exists && s.handoff.ageMinutes !== null && s.handoff.ageMinutes < 3 * DAY) return { level: 'ok', icon: 'link', color: K.emerald, action: 'resume', text: `Continue: /cortex-resume · ${ago(s.handoff.ageMinutes)}`, head: 'Cortex suggests: pick up where your last chat left off', detail: `A handoff from ${s.handoff.chat ? `“${s.handoff.chat}”` : s.handoff.from || 'your last session'} is saved.${fresh}` }

  // amber: worth knowing, fine to continue
  if (cs.state === 'cold' && ctx > 50_000) return { level: 'warn', icon: 'pending', color: HEAT.warn, action: 'handoff', text: `Cache cold · next reply re-reads ${k(ctx)}`, head: 'Cortex suggests: hand off before your next message', detail: `The cache went cold ${ago(Math.round((Date.now() - cs.until!) / 60_000))}, so your next message re-reads ${k(ctx)} tokens at full price. A new chat starts at about ${k(start)}.` }
  if (cs.state === 'cooling' && ctx > 50_000) return { level: 'warn', icon: 'pending', color: HEAT.warn, text: `Cache cools at ${clock(cs.until!)} · reply before`, head: `The cache cools at ${clock(cs.until!)}: reply before then to keep it cheap`, detail: `After that, your next message re-reads ${k(ctx)} tokens at full price. Fine to continue.` }
  if (ctx > 100_000 && pct / 100 >= Math.min(at, compactAt) - 0.15) return { level: 'warn', icon: 'turn', color: HEAT.warn, text: `${pct}% full · fine to continue`, head: `This chat is ${pct}% full, fine to continue`, detail: `Cortex suggests a fresh chat at ${Math.round(at * 100)}%.${fresh}` }
  if (five >= 70) return { level: 'warn', icon: 'pending', color: HEAT.warn, text: `5h plan ${five}% · fine to continue`, head: `Your 5-hour plan is ${five}% used, fine to continue`, detail: `At 90% Cortex suggests handing off, so you can continue in OpenCode or after the reset.${onFable(l) ? FABLE_NOTE : ''}` }
  const waiting = toReview(s)
  if (waiting) return { level: 'warn', icon: 'dream', color: HEAT.warn, action: 'review', text: `${waiting} memory fix${waiting === 1 ? '' : 'es'} to review`, head: `Cortex suggests: review ${waiting} memory note${waiting === 1 ? '' : 's'}`, detail: `A check found ${waiting === 1 ? 'a note that looks' : 'notes that look'} wrong or out of date. Decide before a new chat trusts ${waiting === 1 ? 'it' : 'them'}.` }
  // the last turn filled this chat with tool output: a subagent would have kept it out (measured from the journal)
  const [e0, e1] = s.episodes ?? []
  // this chat's own last turn only: a fresh chat never inherits the last chat's "the last turn added…"
  if (e0 && e1 && e0.session === e1.session && !!l?.sessionId && e0.session === l.sessionId && l.turns > 0 && Date.now() - Date.parse(e0.end) < 30 * 60_000) {
    const grew = e0.contextTokens - e1.contextTokens
    const reads = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'].reduce((a, n) => a + (e0.tools[n] ?? 0), 0)
    if (grew >= 40_000 && reads >= 12) return { level: 'warn', icon: 'spark', color: HEAT.warn, text: `Last turn added ~${k(grew)}`, head: `The last turn added about ${k(grew)} tokens to this chat`, detail: `Mostly tool output (${reads} reads and commands). For big searches or test runs, ask for a subagent: only its summary lands here (its tokens still count toward your plan).` }
  }
  const unused = unusedTools(s, l, 500)
  const waste = unused.reduce((a, x) => a + x.loaded, 0)
  if (waste >= 5000) return { level: 'warn', icon: 'spark', color: HEAT.warn, action: 'costs', text: `Save ~${k(waste)} tokens a message`, head: 'Cortex suggests: turn off tools you never use', detail: `${[...new Set(unused.map(toolName))].join(', ').replace('a connector', 'claude.ai connectors')} add ${k(waste)} tokens to every message and went unused in your recent chats. Turning them off applies to new chats, and one press brings them back.` }
  // a Dream is due: none in 3 days (or ever) and a good few chats since
  const last = s.dream.recent[0]?.ts
  const since = (s.episodes ?? []).filter(e => !last || e.end > last)
  const sessions = new Set(since.map(e => e.session)).size
  if (!s.dream.running && sessions >= 3 && since.length >= 10 && (!last || (minsSince(last) ?? 0) > 3 * DAY)) return { level: 'warn', icon: 'dream', color: HEAT.warn, action: 'dream', text: `Dream due · ${last ? `last ${ago(minsSince(last))}` : 'none yet'}`, head: 'Cortex suggests: check Claude\'s memory', detail: `${last ? `Last checked ${ago(minsSince(last))}` : 'Never checked yet'}, ${sessions} chats since. A Dream checks Claude's notes against what really happened, in the background, and only suggests changes.` }

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
