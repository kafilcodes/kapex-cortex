import { atom, read, update, type ElementTable } from 'claude-code'
import { pageScene } from './mascot'

import type { OlderView, StatusView, TimelineEventView, ViewState } from '../types'
import { k } from './charts'
import { act, ago, kc, minsSince, setMore, type Dollar } from './data'
import { PANE } from './data'
import { outcome } from './cards'
import type { Kit } from './kit'
import { K } from './theme'
import { tiles } from './tiles'
import type { Lead } from './leads'
import { lanes } from './viz'
import { tidy } from './text'
import { companion } from './blocky'

// The Timeline page: the activity chart (swimlanes over time: replies, commits, handoffs, Dreams), then every event
// newest first, grouped by day, as tiles joined by a connector on the left, that open for the details (a turn's numbers and files, a commit's tags,
// a handoff's goal, what a full check found).
const KIND: Record<string, { icon: string; label: string; lane: number }> = {
  turn: { icon: 'turn', label: 'Reply', lane: 0 },
  commit: { icon: 'commit', label: 'Commit', lane: 1 }, merge: { icon: 'merge', label: 'Merge', lane: 1 },
  handoff: { icon: 'link', label: 'Handoff', lane: 2 },
  dream: { icon: 'dream', label: 'Memory check', lane: 3 },
}
// one colour per row (failures in rose); amber is kept for warnings, so handoffs get the deep emerald
const LANES: [string, string][] = [['Replies', K.emerald], ['Commits', K.silver], ['Handoffs', K.pine], ['Memory checks', '#14B8A6']]
/** Events per page. The list shows one page at a time (Older / Newer move it), never a list that keeps growing: the
 * desktop app drops a pane whose drawing gets too big (~150 KB a page; 160 events at once were ~750 KB and blanked it). */
export const PAGE = 24
const TONE: Record<string, string> = { ok: K.emerald, warn: K.amber, bad: K.rose, info: K.silver }
const dayOf = (iso: string) => {
  if (!Number.isFinite(Date.parse(iso))) return 'Earlier' // an unreadable time: grouped last, never "Invalid Date"
  const d = new Date(iso), now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, now)) return 'Today'
  if (same(d, new Date(now.getTime() - 86_400_000))) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}
/** The drawing that leads an event's tile, and its words. A reply's face says how its checks went. */
function leadOf(ev: TimelineEventView, res: { color: string; text: string } | null): { kind: Lead; alt: string; tint?: string } {
  const tint = ev.tone === 'bad' ? K.rose : ev.tone === 'warn' ? K.amber : undefined
  if (ev.kind === 'commit') return ev.tags.some(x => /^tag /.test(x)) ? { kind: 'commit-tag', alt: 'A commit with a release tag', tint } : { kind: 'commit', alt: 'A commit', tint }
  if (ev.kind === 'merge') return { kind: 'merge', alt: 'Two branches merging', tint }
  if (ev.kind === 'handoff') return { kind: 'handoff', alt: 'A note passing from one chat to another' }
  if (ev.kind === 'dream') return ev.tone === 'bad' ? { kind: 'dream-bad', alt: 'A memory check that failed' } : ev.tone === 'ok' ? { kind: 'dream-ok', alt: 'A memory check that found nothing wrong' } : { kind: 'dream', alt: 'A memory check reading notes' }
  const c = res?.color ?? TONE[ev.tone] ?? K.silver
  if (c === K.rose) return { kind: 'reply-bad', alt: 'A reply whose checks failed' }
  if (c === K.amber) return { kind: 'reply-warn', alt: res?.text === 'Interrupted' ? 'A reply that was interrupted' : 'A reply with tool errors' }
  if (c === K.emerald) return { kind: 'reply-ok', alt: 'A reply whose checks passed' }
  return { kind: 'reply-none', alt: 'A reply with no checks run' }
}
/** A reply's title when you didn't type one: what set it off, said as a quiet badge, while what Claude did leads */
const TRIGGER: [RegExp, string][] = [[/^Claude continued on its own$/, 'On its own'], [/^A background task finished$/, 'Background task'], [/^Carried on where it stopped$/, 'Picked up again']]
export const triggerOf = (title: string): string | null => TRIGGER.find(([re]) => re.test(title.trim()))?.[1] ?? null
const time = (iso: string) => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')
const base = (f: string) => f.split(/[\\/]/).slice(-2).join('/')

/** Lines a tile's text takes: the connector's estimate of each tile's height (the rail's halves reach about 0.8 of
 * the distance between two tiles' middles, so the estimate only has to be roughly right). The preview is cut to 140 characters. */
const previewLines = (detail: string | undefined, px: number, open = false) => (detail ? 1 + Math.max(1, Math.ceil(((open ? detail.length : Math.min(140, detail.length)) * 6.4) / Math.max(200, px - 140))) : 1)
/** An open turn's extra lines: its row of figures (two rows when narrow), the files line and the next step. */
const bodyLines = (px: number, files: boolean, next: boolean) => (px < 640 ? 4 : 2) + (files ? 1 : 0) + (next ? 1 : 0)
/** A turn with nothing to open (no files, checks, commits or written text, like a background task's notice). */
const busy = (ep: { files: string[]; tests: { ran: number }; commits: number; outTokens: number; next?: string }) => !!(ep.files.length || ep.tests.ran || ep.commits || ep.outTokens || ep.next)

/** The Activity drawing, reused while nothing it shows has changed: its right edge moves in 10-minute steps, never
 * with every redraw. Drawn as a plain image, not an interactive frame: a frame inside the scrolling pane takes the
 * mouse wheel while the pointer is over it, and scrolling sticks there. Each dot's details are in the list below. */
let chartMemo = { key: '', svg: '' }
function chartOnce(key: string, make: () => string): string {
  if (chartMemo.key !== key) chartMemo = { key, svg: make() }
  return chartMemo.svg
}

// The list loads as you go, newest first: 24 to start, Show older adds 24 below and scrolls to the first of them. At
// most WINDOW tiles are drawn at once (a pane full of drawings is what once blanked it): past that, the newest drop
// off the top and Show newer brings them back. The status carries the newest 160 events; past them, Show older asks
// the core for the next ones (kc timeline --before), so the list reaches back as far as the history goes.
export const WINDOW = 48
export type Older = OlderView
export const olderTl = atom({ plugin: 'kapex-cortex', key: 'tl-older' } as const, { events: [], episodes: [], more: true, loading: false, from: '' } as Older, { shape: 'tl-older-1' })
export async function readOlder($: Dollar): Promise<Older> { try { return await read($, olderTl) } catch { return { events: [], episodes: [], more: true, loading: false, from: '' } } }

/** Shows the list down to event `end` (one past the last), then scrolls to `key` (a tile) or the very top. */
async function go($: Dollar, end: number, key?: string): Promise<void> {
  await setMore($, 'timeline', end)
  try { await $.ui.scroll(key ? { in: PANE, to: { key }, block: 'start' } : { in: PANE, to: 'start' }) } catch { /* a surface that can't scroll: the list still changed */ }
}
/** Show older: from what is loaded, else from the core first (the next 48 before the oldest event loaded). */
async function older($: Dollar, all: TimelineEventView[], end: number, newest: string): Promise<void> {
  if (end >= all.length) {
    const o = await readOlder($)
    if (o.loading) return
    const last = all[all.length - 1]
    if (!last || (!o.more && o.from === newest)) return
    await update($, olderTl, x => ({ ...x, loading: true }))
    // a fetch that fails (a timeout, a crash, words instead of JSON) keeps Show older for another try, never "the oldest"
    let got: Omit<Older, 'loading' | 'from'> | null = null
    try {
      const r = await kc($, ['timeline', '--before', last.ts, '--limit', '48'])
      const j = JSON.parse(r.out) as Omit<Older, 'loading' | 'from'>
      if (r.ok && Array.isArray(j.events)) got = { events: j.events, episodes: Array.isArray(j.episodes) ? j.episodes : [], more: !!j.more }
    } catch { /* kept as a failure below */ }
    const ids = new Set(all.map(e => e.id)), fresh = got ? got.events.filter(e => !ids.has(e.id)) : [] // `before` is inclusive: drop what shows already
    try {
      await update($, olderTl, x => {
        const keep = x.from === newest ? x : { events: [], episodes: [], more: true, loading: false, from: newest }
        if (!got) return { ...keep, loading: false, from: newest }
        return { events: [...keep.events, ...fresh], episodes: [...keep.episodes, ...got.episodes], more: got.more, loading: false, from: newest }
      })
    } finally { await update($, olderTl, x => (x.loading ? { ...x, loading: false } : x)).catch(() => undefined) }
    if (!got) { try { $.ui.toast('Couldn\'t load older events: try again', { timeoutMs: 4_000 }) } catch { /* no toasts here */ } return }
    if (!fresh.length) return
    await go($, end + PAGE, `tile-${fresh[0]!.id}`)
    return
  }
  await go($, Math.min(all.length, end + PAGE), `tile-${all[end]!.id}`)
}

export function timelinePage($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px: number, more: Older | null = null): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded, px)
  // what the status carries, then what Show older fetched before its oldest (kept while the newest event is the same)
  const loaded = s.timeline ?? [], newest = loaded[0]?.id ?? ''
  const extra = more && more.from === newest ? more : null
  const seen = new Set(loaded.map(e => e.id))
  const all = [...loaded, ...(extra?.events ?? []).filter(e => !seen.has(e.id))]
  const end = Math.min(all.length, Math.max(PAGE, Math.floor(vw.more.timeline ?? 0)))
  const begin = Math.max(0, end - WINDOW)
  const events = all.slice(begin, end)
  // the core has more when the status says it was cut (timelineMore) and the last fetch didn't reach the start
  const hidden = Math.max(0, all.length - end), canFetch = (s.timelineMore ?? loaded.length >= 160) && (!extra || extra.more)
  const eps = new Map([...(s.episodes ?? []), ...(extra?.episodes ?? [])].map(e => [`turn-${e.id}`, e]))
  const days: [string, TimelineEventView[]][] = []
  // one group per day even if events arrive out of order (each day's key is unique, so the list never has twins)
  const byDay = new Map<string, TimelineEventView[]>()
  for (const ev of events) { const d = dayOf(ev.ts); const g = byDay.get(d); if (g) g.push(ev); else { const n: TimelineEventView[] = [ev]; byDay.set(d, n); days.push([d, n]) } }
  // the chart covers the events shown, at most the last 7 days, up to the next 10-minute mark
  const now = Math.ceil(Date.now() / 600_000) * 600_000
  const shown = all.filter(e => now - Date.parse(e.ts) <= 7 * 86_400_000)
  const from = shown.length ? Math.min(...shown.map(e => Date.parse(e.ts))) - 600_000 : now - 3_600_000
  const width = Math.max(260, Math.min(1400, px - 52)) // the chart spans its card
  const chart = chartOnce(`${now}|${width}|${shown.map(e => `${e.id}:${e.tone}`).join(',')}`, () => lanes({
    lanes: LANES.map(([label, color], i) => ({ label, color, dots: shown.filter(e => (KIND[e.kind] ?? KIND.turn!).lane === i).map(e => ({ t: Date.parse(e.ts), title: `${time(e.ts)} · ${e.title}`, color: e.tone === 'bad' ? K.rose : undefined })) })),
    from, to: now, width,
  }))

  const tileOf = (ev: TimelineEventView) => {
    const kind = KIND[ev.kind] ?? KIND.turn!
    const ep = eps.get(ev.id)
    const res = ep ? outcome(ep) : null
    // what people typed is tidied for the closed tile (no prompt marks, one sentence); the open tile shows it all
    const open = vw.expanded.includes(ev.id), typed = ev.kind === 'turn' || ev.kind === 'handoff'
    // a reply nobody typed leads with what Claude did; what set it off is a quiet badge. The kind is said by the
    // drawing (and its alt) and the title, so no "Reply" / "Commit" / "Handoff" badge repeats it.
    const trig = ev.kind === 'turn' && ev.detail ? triggerOf(ev.title) : null
    return t.tile({
      id: ev.id, icon: kind.icon, color: TONE[ev.tone] ?? K.silver, lead: leadOf(ev, res), title: trig ? tidy(ev.detail!, 90, open) || ev.detail! : typed ? tidy(ev.title, 90, open) || ev.title : ev.title, time: time(ev.ts),
      // the outcome badge already says how the checks went: don't repeat it as a tag
      badges: [trig ? [trig] : null, res ? [res.text, res.color, res.icon] : null, ...ev.tags.filter(x => !(res && (/^tests /.test(x) || x.toLowerCase() === res.text.toLowerCase()))) /* say it once: no tag repeating the outcome badge */.slice(0, ep ? 2 : 4).map(x => [x] as [string])],
      preview: trig ? undefined : ev.detail && typed ? tidy(ev.detail, 140, open) : ev.detail,
      body: ep && busy(ep) ? [
        t.stats(`tm-${ev.id}`, [
          { icon: 'file', value: String(ep.files.length), label: ep.files.length === 1 ? 'file changed' : 'files changed' },
          ep.tests.ran ? { icon: 'test', value: `${ep.tests.ran - ep.tests.failed} of ${ep.tests.ran}`, label: 'checks passed', color: ep.tests.failed && !ep.tests.lastOk ? K.rose : K.emerald } : { icon: 'test', value: 'none', label: 'checks run' },
          { icon: 'commit', value: String(ep.commits), label: ep.commits === 1 ? 'commit' : 'commits' },
          { icon: 'spark', value: k(ep.outTokens), label: 'tokens Claude wrote' },
        ]),
        ep.files.length ? u.tag(`tfl-${ev.id}`, 'file', K.silver, `${ep.files.slice(0, 8).map(base).join('  ·  ')}${ep.files.length > 8 ? `  ·  ${ep.files.length - 8} more` : ''}`, K.muted) : null,
        ep.next ? u.tag(`tnx-${ev.id}`, 'next', K.amber, `Next: ${ep.next}`, K.label) : null,
      ] : ev.tags.length > 4 ? [<Text key={`ttg-${ev.id}`} size="caption" color={K.muted}>{ev.tags.join(' · ')}</Text>] : [],
    })
  }

  // the list's ends: Show newer once the newest dropped off the top; Show older while anything older is loaded or the
  // core may have more; Back to newest from anywhere past the first 24; one line says what shows and how far back
  const span = events.length ? (() => { const a = dayOf(events[events.length - 1]!.ts), b = dayOf(events[0]!.ts); return a === b ? a : `${a} – ${b}` })() : ''
  const top = begin > 0 ? (
    <Box key="tl-top" flexDirection="row" justifyContent="center" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
      <Button key="tl-newer" variant="secondary" onPress={() => { void go($, Math.max(PAGE, end - PAGE)) }}>Show newer</Button>
      <Text key="tl-top-n" size="caption" tabular color={K.muted}>{`${begin} newer event${begin === 1 ? '' : 's'} above`}</Text>
    </Box>
  ) : null
  const foot = all.length > PAGE || canFetch ? (
    <Box key="tl-page" flexDirection="column" gap={0} alignItems="center">
      <Box flexDirection="row" justifyContent="center" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
        {hidden > 0 || canFetch ? <Button key="tl-more" variant="secondary" onPress={() => { void older($, all, end, newest) }}>{more?.loading ? 'Loading…' : 'Show older'}</Button> : null}
        {end > PAGE ? <Button key="tl-less" plain onPress={() => { void go($, PAGE) }}><Text size="caption" color={K.label}>Back to newest</Text></Button> : null}
      </Box>
      <Text key="tl-left" size="caption" tabular color={K.muted}>{`${begin + 1}–${end} of ${all.length}${hidden > 0 ? ` · ${hidden} older loaded` : canFetch ? ' · more in history' : ' · the oldest'}`}</Text>
      {span ? <Text key="tl-days" size="caption" color={K.label}>{`Showing ${span}`}</Text> : null}
    </Box>
  ) : null

  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('tl-in', pageScene('timeline', 100), 'Cortex at the timeline', 'What happened, newest first', 'Every reply, commit, handoff and memory check in this project.', companion('idle', px))}
      {u.card('tl-act', '100%', [
        u.head('tl-act-h', now - from > 36 * 3_600_000 ? 'The last 7 days' : 'Today', shown.length ? `${shown.length} event${shown.length === 1 ? '' : 's'}` : undefined),
        shown.length ? u.graphic('g-lanes', chart, `${shown.length} events: ${LANES.map(([l], i) => `${shown.filter(e => (KIND[e.kind] ?? KIND.turn!).lane === i).length} ${l.toLowerCase()}`).join(', ')}`) : u.tag('tl-none', 'turn', K.silver, all.length ? 'Nothing in the last 7 days: older events are below.' : 'Nothing yet: your first reply in this project starts it.'),
      ])}
      {top}
      {days.map(([day, list]) => (
        <Box key={`day-${day}`} flexDirection="column" gap={1}>
          {t.groupHead(`dh-${day}`, 'calendar', K.emerald, day, `${list.length} event${list.length === 1 ? '' : 's'}`)}
          {t.railed(`dl-${day}`, list.map(ev => {
            const open = vw.expanded.includes(ev.id), ep = open ? eps.get(ev.id) : undefined
            return { tile: tileOf(ev), lines: previewLines(ev.detail, px, open) + (ep && busy(ep) ? bodyLines(px, !!ep.files.length, !!ep.next) : open && ev.tags.length > 4 ? 1 : 0) }
          }), day === 'Today' ? K.emerald : K.ink)}
        </Box>
      ))}
      {foot}
    </Box>
  )
}
