import type { ElementTable } from 'claude-code'
import { sceneSvg } from './mascot'

import type { StatusView, TimelineEventView, ViewState } from '../types'
import { k } from './charts'
import { act, ago, minsSince, showMore, type Dollar } from './data'
import { outcome } from './cards'
import type { Kit } from './kit'
import { K } from './theme'
import { tiles } from './tiles'
import { lanes } from './viz'

// The Timeline page: the activity chart (swimlanes over time: turns, code, handoffs, Dreams), then every event
// newest first, grouped by day, as tiles that open for the details (a turn's numbers and files, a commit's tags,
// a handoff's goal, what a Dream found).
const KIND: Record<string, { icon: string; label: string; lane: number }> = {
  turn: { icon: 'turn', label: 'Turn', lane: 0 },
  commit: { icon: 'commit', label: 'Commit', lane: 1 }, merge: { icon: 'merge', label: 'Merge', lane: 1 },
  handoff: { icon: 'link', label: 'Handoff', lane: 2 },
  dream: { icon: 'dream', label: 'Dream', lane: 3 },
}
const LANES: [string, string][] = [['Turns', K.emerald], ['Code', K.silver], ['Handoffs', K.amber], ['Dreams', '#14B8A6']]
const TONE: Record<string, string> = { ok: K.emerald, warn: K.amber, bad: K.rose, info: K.silver }
const dayOf = (iso: string) => {
  const d = new Date(iso), now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, now)) return 'Today'
  if (same(d, new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
const base = (f: string) => f.split(/[\\/]/).slice(-2).join('/')

export function timelinePage($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px: number): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded)
  const all = s.timeline ?? []
  const limit = 24 + (vw.more.timeline ?? 0)
  const events = all.slice(0, limit)
  const eps = new Map((s.episodes ?? []).map(e => [`turn-${e.id}`, e]))
  const days: [string, TimelineEventView[]][] = []
  for (const ev of events) { const d = dayOf(ev.ts); const last = days[days.length - 1]; if (last && last[0] === d) last[1].push(ev); else days.push([d, [ev]]) }
  // the chart covers the events shown, at most the last 7 days
  const now = Date.now()
  const shown = all.filter(e => now - Date.parse(e.ts) <= 7 * 86_400_000)
  const from = shown.length ? Math.min(...shown.map(e => Date.parse(e.ts))) - 600_000 : now - 3_600_000
  const chart = lanes({
    lanes: LANES.map(([label, color], i) => ({ label, color, dots: shown.filter(e => (KIND[e.kind] ?? KIND.turn!).lane === i).map(e => ({ t: Date.parse(e.ts), title: `${time(e.ts)} · ${e.title}`, color: e.tone === 'bad' ? K.rose : e.tone === 'warn' ? K.amber : undefined })) })),
    from, to: now, width: Math.max(260, Math.min(900, px - 60)),
  })

  const tileOf = (ev: TimelineEventView) => {
    const kind = KIND[ev.kind] ?? KIND.turn!
    const ep = eps.get(ev.id)
    const res = ep ? outcome(ep) : null
    return t.tile({
      id: ev.id, icon: kind.icon, color: TONE[ev.tone] ?? K.silver, title: ev.title, time: time(ev.ts),
      badges: [[kind.label, TONE[ev.tone] ?? K.label, kind.icon], res ? [res.text, res.color, res.icon] : null, ...ev.tags.slice(0, ep ? 2 : 4).map(x => [x] as [string])],
      preview: ev.detail,
      body: ep ? [
        <Box key={`tm-${ev.id}`} flexDirection="row" gap={1} flexWrap="wrap">
          {t.metric(`tmf-${ev.id}`, 'file', K.silver, String(ep.files.length), 'files changed', '40%')}
          {t.metric(`tmt-${ev.id}`, 'test', ep.tests.failed ? K.rose : K.silver, ep.tests.ran ? `${ep.tests.ran - ep.tests.failed}/${ep.tests.ran}` : '–', 'checks passed', '40%')}
          {t.metric(`tmc-${ev.id}`, 'commit', K.silver, String(ep.commits), 'commits', '40%')}
          {t.metric(`tmo-${ev.id}`, 'spark', K.silver, k(ep.outTokens), 'tokens written', '40%')}
        </Box>,
        ep.files.length ? <Text key={`tfl-${ev.id}`} size="caption" color={K.muted}>{`Files: ${ep.files.slice(0, 8).map(base).join(', ')}${ep.files.length > 8 ? ` and ${ep.files.length - 8} more` : ''}`}</Text> : null,
        ep.next ? u.tag(`tnx-${ev.id}`, 'pending', K.amber, `Next: ${ep.next}`, K.label) : null,
      ] : ev.tags.length > 4 ? [<Text key={`ttg-${ev.id}`} size="caption" color={K.muted}>{ev.tags.join(' · ')}</Text>] : [],
    })
  }

  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('tl-in', sceneSvg('timeline', 120), 'Cortex at the timeline', 'What happened, newest first', 'Turns, commits, handoffs and Dreams in one place.')}
      {u.card('tl-act', '100%', [
        u.head('tl-act-h', 'Activity', `${shown.length} events · ${now - from > 36 * 3_600_000 ? 'last 7 days' : 'today'}`),
        shown.length ? u.graphic('g-lanes', chart, `${shown.length} events: ${LANES.map(([l], i) => `${shown.filter(e => (KIND[e.kind] ?? KIND.turn!).lane === i).length} ${l.toLowerCase()}`).join(', ')}`, true) : u.tag('tl-none', 'turn', K.silver, 'No events yet. Each reply, commit, compaction and handoff shows up here.'),
      ])}
      {days.map(([day, list]) => (
        <Box key={`day-${day}`} flexDirection="column" gap={1}>
          {t.groupHead(`dh-${day}`, 'pending', K.emerald, day, `${list.length}`)}
          {t.railed(`dl-${day}`, list.map(ev => ({ tile: tileOf(ev), lines: ev.detail ? 3 : 1 })))}
        </Box>
      ))}
      {all.length > limit ? <Button key="tl-more" onPress={() => { void showMore($, 'timeline', 24) }}>{`Show ${Math.min(24, all.length - limit)} older events`}</Button> : null}
    </Box>
  )
}
