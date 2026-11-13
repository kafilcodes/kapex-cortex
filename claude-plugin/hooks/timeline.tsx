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

/** Lines a tile's text takes, so its connector is as tall as the tile and no taller (measured in the real app: a tile
 * with a one-line preview is about 116 px; the base 74 + 22 per line). The preview is cut to 140 characters. */
const previewLines = (detail: string | undefined, px: number, open = false) => (detail ? 1 + Math.max(1, Math.ceil(((open ? detail.length : Math.min(140, detail.length)) * 6.4) / Math.max(200, px - 140))) : 1)
/** An open turn's extra lines: its four metric cells (two rows when narrow), the files line and the next step. */
const bodyLines = (px: number, files: boolean, next: boolean) => (px < 640 ? 7 : 4) + (files ? 2 : 0) + (next ? 2 : 0)

/** The Activity drawing, reused while nothing it shows has changed: its right edge moves in 10-minute steps, never
 * with every redraw, so the chart's frame isn't reloaded (and doesn't blink) when you open a tile or scroll. */
let chartMemo = { key: '', svg: '' }
function chartOnce(key: string, make: () => string): string {
  if (chartMemo.key !== key) chartMemo = { key, svg: make() }
  return chartMemo.svg
}

export function timelinePage($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px: number): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded)
  const all = s.timeline ?? []
  const limit = 24 + (vw.more.timeline ?? 0)
  const events = all.slice(0, limit)
  const eps = new Map((s.episodes ?? []).map(e => [`turn-${e.id}`, e]))
  const days: [string, TimelineEventView[]][] = []
  for (const ev of events) { const d = dayOf(ev.ts); const last = days[days.length - 1]; if (last && last[0] === d) last[1].push(ev); else days.push([d, [ev]]) }
  // the chart covers the events shown, at most the last 7 days, up to the next 10-minute mark
  const now = Math.ceil(Date.now() / 600_000) * 600_000
  const shown = all.filter(e => now - Date.parse(e.ts) <= 7 * 86_400_000)
  const from = shown.length ? Math.min(...shown.map(e => Date.parse(e.ts))) - 600_000 : now - 3_600_000
  const width = Math.max(260, Math.min(900, px - 60))
  const chart = chartOnce(`${now}|${width}|${shown.map(e => `${e.id}:${e.tone}`).join(',')}`, () => lanes({
    lanes: LANES.map(([label, color], i) => ({ label, color, dots: shown.filter(e => (KIND[e.kind] ?? KIND.turn!).lane === i).map(e => ({ t: Date.parse(e.ts), title: `${time(e.ts)} · ${e.title}`, color: e.tone === 'bad' ? K.rose : e.tone === 'warn' ? K.amber : undefined })) })),
    from, to: now, width,
  }))

  const tileOf = (ev: TimelineEventView) => {
    const kind = KIND[ev.kind] ?? KIND.turn!
    const ep = eps.get(ev.id)
    const res = ep ? outcome(ep) : null
    return t.tile({
      id: ev.id, icon: kind.icon, color: TONE[ev.tone] ?? K.silver, title: ev.title, time: time(ev.ts),
      // the outcome badge already says how the checks went: don't repeat it as a tag
      badges: [[kind.label, TONE[ev.tone] ?? K.label], res ? [res.text, res.color, res.icon] : null, ...ev.tags.filter(x => !(res && /^tests /.test(x))).slice(0, ep ? 2 : 4).map(x => [x] as [string])],
      preview: ev.detail,
      body: ep ? [
        <Box key={`tm-${ev.id}`} flexDirection="row" gap={1} flexWrap="wrap">
          {t.metric(`tmf-${ev.id}`, 'file', K.silver, String(ep.files.length), 'files changed', '40%')}
          {t.metric(`tmt-${ev.id}`, 'test', ep.tests.failed && !ep.tests.lastOk ? K.rose : ep.tests.ran ? K.emerald : K.silver, ep.tests.ran ? `${ep.tests.ran - ep.tests.failed}/${ep.tests.ran}` : '–', 'check runs passed', '40%')}
          {t.metric(`tmc-${ev.id}`, 'commit', K.silver, String(ep.commits), 'commits', '40%')}
          {t.metric(`tmo-${ev.id}`, 'spark', K.silver, k(ep.outTokens), 'tokens Claude wrote', '40%')}
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
          {t.railed(`dl-${day}`, list.map(ev => {
            const open = vw.expanded.includes(ev.id), ep = open ? eps.get(ev.id) : undefined
            return { tile: tileOf(ev), lines: previewLines(ev.detail, px, open) + (ep ? bodyLines(px, !!ep.files.length, !!ep.next) : open && ev.tags.length > 4 ? 1 : 0) }
          }))}
        </Box>
      ))}
      {all.length > limit ? <Button key="tl-more" onPress={() => { void showMore($, 'timeline', 24) }}>{`Show ${Math.min(24, all.length - limit)} older events`}</Button> : null}
    </Box>
  )
}
