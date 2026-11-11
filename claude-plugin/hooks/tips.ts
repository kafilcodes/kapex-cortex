import type { CacheView, LiveView, StatusView } from '../types'
import { cacheState, clock, k } from './charts'
import { K } from './theme'

// One proactive tip at a time for the status strip (and the panel), from data already on hand. Highest value first:
// the moments where a decision saves the most tokens or the most work. Short words in the strip, the reason on hover.
export type Tip = { level: 'warn' | 'info' | 'ok'; icon: string; text: string; detail: string; color: string }

export function tipFor(s: StatusView, l: LiveView | null, cv: CacheView, limits: LiveView['limits']): Tip | null {
  const ctx = l?.context.tokens ?? 0
  const pct = l?.context.percent ?? 0
  const rows = l?.context.rows ?? []
  const win = l?.context.window ?? 1
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const compactAt = buffer ? (win - buffer) / win : 0.9
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const switchTokens = s.handoff.preview?.tokens ?? 0
  const ready = s.handoff.exists ? ` Handoff saved: a new chat starts with about ${k(switchTokens || 2000)} tokens.` : ''

  // 1. a cold cache on a big chat: the next message re-reads everything at full price
  if (cs.state === 'cold' && ctx > 150_000) {
    return { level: 'warn', icon: 'alert', color: K.rose, text: `Cold cache: next message re-reads ${k(ctx)}`, detail: `Your next message re-reads all ${k(ctx)} tokens at full price.${ready}` }
  }
  // 2. the cache is about to cool: reply now or wrap up
  if (cs.state === 'cooling' && ctx > 50_000) {
    return { level: 'warn', icon: 'pending', color: K.amber, text: `Cache cools at ${clock(cs.until!)}`, detail: `Reply before then, or hand off, to avoid re-reading ${k(ctx)} tokens.` }
  }
  // 3. close to compaction
  if (pct / 100 >= compactAt - 0.2 && ctx > 100_000) {
    return { level: 'info', icon: 'link', color: K.amber, text: `${pct}% full: a new chat is ready`, detail: `Claude summarizes this chat near ${Math.round(compactAt * 100)}%.${ready}` }
  }
  // 4. the 5-hour plan is nearly used
  const five = limits.find(x => x.kind === 'five_hour')?.percentUsed ?? 0
  if (five >= 85) {
    return { level: 'warn', icon: 'alert', color: K.amber, text: `5-hour plan at ${five}%`, detail: `Continue in OpenCode (free models) with /cortex-resume, or wait for the reset.` }
  }
  // 5. a brand-new chat with a recent handoff from another session
  if ((l?.turns ?? 0) <= 1 && s.handoff.exists && s.handoff.ageMinutes !== null && s.handoff.ageMinutes < 3 * 24 * 60) {
    return { level: 'ok', icon: 'link', color: K.emerald, text: 'Continue: type /cortex-resume', detail: `A handoff from ${s.handoff.from || 'your last session'} is saved.${ready}` }
  }
  // 6. the last turn filled this chat with tool output: a subagent would have kept it out (measured from the journal)
  const [e0, e1] = s.episodes ?? []
  if (e0 && e1 && e0.session === e1.session && Date.now() - Date.parse(e0.end) < 30 * 60_000) {
    const grew = e0.contextTokens - e1.contextTokens
    const reads = ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'].reduce((a, n) => a + (e0.tools[n] ?? 0), 0)
    if (grew >= 40_000 && reads >= 12) {
      return { level: 'info', icon: 'spark', color: K.sage, text: `Last turn added ~${k(grew)} to this chat`, detail: `Mostly tool output (${reads} reads and commands). For big searches or test runs, ask for a subagent: only its summary lands here (its tokens still count toward your plan).` }
    }
  }
  // 7. paying every message for tools nobody uses
  const unused = unusedTools(s, l, 500)
  const waste = unused.reduce((a, x) => a + x.loaded, 0)
  if (waste >= 5000) {
    return { level: 'info', icon: 'spark', color: K.sage, text: `Save ~${k(waste)} tokens a message`, detail: `${[...new Set(unused.map(toolName))].join(', ').replace('a connector', 'claude.ai connectors')} load into every message but weren't used in your recent chats. Turn them off in Costs (new chats only; one press turns them back on). Plugin skills: /plugin or Desktop → Customize.` }
  }
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
