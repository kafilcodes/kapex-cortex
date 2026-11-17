import type { ElementTable } from 'claude-code'

import type { StatusView } from '../types'
import { k } from './charts'
import { animateFor } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { heatmap, hourGrid, radar } from './viz-pro'

// Costs' activity cards, from numbers Cortex already keeps (0 tokens): the token burn per day as a contribution grid
// since this project began, when in the week you work with Claude (weekday × hour), and how Claude works here (its
// tool calls by kind, as a radar). The person reads them; nothing here acts.

const DAY = 86_400_000
const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** A real calendar day as YYYY-MM-DD ("2026-02-31" is not one). */
const realDay = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); if (!m) return false; const x = new Date(+m[1]!, +m[2]! - 1, +m[3]!); return x.getFullYear() === +m[1]! && x.getMonth() === +m[2]! - 1 && x.getDate() === +m[3]! }
const dayName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
/** Tool calls grouped by what they do, for the radar (MCP servers and skills together: what plugins add). */
const KINDS: [string, (n: string) => boolean][] = [
  ['Read & search', n => /^(Read|Glob|Grep|LS|NotebookRead)$/.test(n)],
  ['Edit', n => /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)],
  ['Run', n => n === 'Bash' || n === 'BashOutput' || n === 'KillShell'],
  ['Agents', n => /^(Task|Agent|SendMessage)$/.test(n)],
  ['Web', n => /^Web(Fetch|Search)$/.test(n)],
  ['Plugins', n => n.startsWith('mcp__') || n === 'Skill'],
]

/** The token burn grid with the few numbers that say what it shows. */
export function burnCard(els: ElementTable, u: Kit, s: StatusView, px: number): JSX.Element | null {
  const { Box, Text } = els
  const days = s.spend?.days
  const entries = Object.entries(days ?? {}).filter(([d, v]) => realDay(d) && Number.isFinite(v) && v > 0) // real calendar days only.sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return null
  const today = localDay(Date.now())
  const first = entries[0]![0]
  const span = Math.round((Date.parse(`${today}T12:00:00`) - Date.parse(`${first}T12:00:00`)) / DAY) + 1 // round: a daylight-saving day is 23 or 25 h
  const weeks = Math.max(8, Math.min(26, Math.ceil(span / 7) + 1))
  const inner = Math.max(200, px - 52)
  const wide = inner >= 620
  const gridW = wide ? Math.min(Math.round(inner * 0.62), 36 + weeks * 25) : inner
  const total = entries.reduce((a, [, v]) => a + v, 0)
  const [bestDay, best] = entries.reduce((a, x) => (x[1] > a[1] ? x : a))
  // a streak: days in a row with use, ending today or yesterday
  let streak = 0
  // calendar days, not 24 h steps (a daylight-saving change would skip or repeat a day near midnight)
  for (let d = new Date(), i = 0; i < 400; i++, d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12)) { if ((days![localDay(d.getTime())] ?? 0) > 0) streak++; else if (localDay(d.getTime()) !== today) break }
  // four facts: one row beside the grid where wide, a 2 × 2 block where narrow (never three and a lonely one)
  const stat = (key: string, value: string, label: string, color: string = K.text) => (
    <Box key={key} flexDirection="column" gap={0} {...(wide ? {} : { width: '44%', flexGrow: 1 })}>
      <Text size="heading" weight="semibold" tabular color={color}>{value}</Text>
      <Text size="caption" color={K.muted}>{label}</Text>
    </Box>
  )
  const grid = u.graphic('burn-g', heatmap({ days: entries.map(([date, value]) => ({ date, value })), end: today, weeks, width: gridW, animate: animateFor('burn', `${entries.length}:${total}`) }),
    `Tokens each day since ${dayName(first)}: ${entries.length} active days, busiest ${dayName(bestDay)} with ${k(best)}`)
  return u.card('burn', '100%', [
    u.head('burn-h', 'Your token burn, day by day', `since ${dayName(first)} · this project`),
    <Box key="burn-r" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={4} rowGap={1}>
      <Box key="burn-gw" flexShrink={0}>{grid}</Box>
      <Box key="burn-s" flexDirection="row" flexWrap="wrap" columnGap={4} rowGap={1} flexGrow={1} flexShrink={1} minWidth={24}>
        {stat('burn-t', k(total), 'tokens in all')}
        {stat('burn-b', k(best), `busiest: ${dayName(bestDay)}`)}
        {stat('burn-a', `${entries.length} of ${span}`, 'days with Claude at work')}
        {stat('burn-k', `${streak} day${streak === 1 ? '' : 's'}`, streak > 1 ? 'in a row, up to today' : 'streak', streak > 2 ? K.emerald : K.text)}
      </Box>
    </Box>,
    u.muted('burn-n', 'Every token a day\'s replies used, cache reads included (those cost about a tenth). Brighter is busier.'),
  ])
}

/** When you work with Claude (weekday × hour) and what Claude does here (its tool calls by kind; the radar's shape is
 * drawn on a square-root scale so a dominant kind doesn't flatten the rest into a spike, its labels give the real shares). */
export function workCard(els: ElementTable, u: Kit, s: StatusView, px: number): JSX.Element | null {
  const { Box, Text } = els
  const hours = s.spend?.hours
  const replies = hours ? hours.flat().reduce((a, x) => a + x, 0) : 0
  const tools = s.usage?.tools ?? {}
  const counts = KINDS.map(([label, is]) => ({ label, n: Object.entries(tools).filter(([name]) => is(name)).reduce((a, [, v]) => a + v, 0) }))
  const calls = counts.reduce((a, x) => a + x.n, 0)
  if (replies < 10 && calls < 10) return null
  const inner = Math.max(200, px - 52)
  const side = inner >= 760
  const radarPx = Math.max(200, Math.min(260, side ? Math.round(inner * 0.32) : inner))
  const gridW = side ? inner - radarPx - 40 : inner
  const max = Math.max(1, ...counts.map(x => x.n))
  const peak = hours ? hours.flatMap((r, d) => r.map((n, h) => ({ n, d, h }))).reduce((a, x) => (x.n > a.n ? x : a), { n: 0, d: 0, h: 0 }) : null
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const hourName = (h: number) => `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`
  return u.card('work', '100%', [
    u.head('work-h', 'When and how you work with Claude', `${replies.toLocaleString()} replies${calls ? ` · ${calls.toLocaleString()} tool calls` : ''}`),
    <Box key="work-r" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={4} rowGap={2}>
      {replies >= 10 && hours ? <Box key="work-t" flexDirection="column" gap={1} flexShrink={0}>
        <Text size="caption" weight="medium" color={K.label}>Replies by weekday and hour</Text>
        {u.graphic('work-g', hourGrid({ counts: hours, width: gridW, animate: animateFor('hours', String(replies)) }), `Replies by weekday and hour; busiest ${peak ? `${DAYS[peak.d]} around ${hourName(peak.h)}` : 'unknown'}`)}
        {peak?.n ? <Text size="caption" color={K.muted}>{`Busiest: ${DAYS[peak.d]}s around ${hourName(peak.h)}`}</Text> : null}
      </Box> : null}
      {calls >= 10 ? <Box key="work-x" flexDirection="column" gap={1} flexShrink={0}>
        <Text size="caption" weight="medium" color={K.label}>{`What Claude does here, your last ${s.usage?.chats ?? 0} chats`}</Text>
        {u.graphic('work-rd', radar({ axes: counts.map(x => ({ label: x.label, value: Math.sqrt(x.n / max), note: `${Math.round((100 * x.n) / calls)}%` })), size: radarPx, animate: animateFor('radar', String(calls)) }),
          counts.map(x => `${x.label} ${Math.round((100 * x.n) / calls)}%`).join(', '))}
      </Box> : null}
    </Box>,
  ])
}
