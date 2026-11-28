import type { ElementTable } from 'claude-code'

import type { CacheView, LiveView, StatusView, ViewState } from '../types'
import { cacheState, clock, k } from './charts'
import { ago, animateFor, minsSince, setCostsSub, setSub, setTab, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { handoffCard, lastTurnCard } from './cards'
import { K } from './theme'
import { MARK_AMBER } from './strip'
import { tiles } from './tiles'
import { heroRow } from './hero'
import { flaggedNotes, switchDue } from './switch'
import { unusedTools, type Tip } from './tips'
import { area, capsules } from './viz'
import { gauge } from './viz-pro'
import { hourglass, hours, lineBars, week as weekBar } from './viz-more'
import { sceneSvg } from './mascot'

// The Overview page, as four jobs in reading order, each fact in one place only:
//   1. the headline: how things stand and the one action worth taking (hero.tsx)
//   2. what runs out: this chat's context, then your plan, your week and the cache as three meters
//   3. where you are: the last turn, and the handoff a new chat would start from
//   4. what it costs: the memory Claude loads, what Cortex saved you, and what every message carries
// One hero number on the page: the "This chat" gauge. Every other card's number is heading size in plain text colour,
// amber or rose only when it needs you. Widths are starting shares; cards grow to fill their row, so no row leaves a gap.
const CATEGORY_COLORS = ['#9CA3AF', '#6B7280', '#14B8A6', '#34D399', '#10B981', '#A7F3D0', '#4B5563']
/** Claude Code's context categories in plain words (the capsule labels). */
const PLAIN: Record<string, string> = { 'System prompt': 'System prompt', 'System tools': 'Built-in tools', 'MCP tools': 'MCP tools', 'Custom agents': 'Agents', 'Memory files': 'Memory files', Skills: 'Skills' }
const plain = (n: string) => PLAIN[n] ?? n.replace(/^System /, '')
/** One short word under each capsule, so none is cut with …; the legend beside it gives the full name. */
const SHORT: Record<string, string> = { 'System prompt': 'Prompt', 'System tools': 'Built-in', 'MCP tools': 'MCP', 'Custom agents': 'Agents', 'Memory files': 'Memory', Skills: 'Skills' }
const short = (n: string) => SHORT[n] ?? plain(n).split(' ')[0]!
/** Amber or rose only when a share needs attention; plain text colour otherwise. */
const attn = (share: number) => (share >= 0.9 ? K.rose : share >= 0.7 ? K.amber : K.text)
const DAY = 86_400_000

export type Overview = { s: StatusView; l: LiveView | null; cv: CacheView; hist: number[]; ph: { t: number; p: number }[]; vw: ViewState; limits: LiveView['limits']; limitsAt: number | null; tip: Tip | null; cols: number; px: number }

export function overviewPage($: Dollar, els: ElementTable, u: Kit, o: Overview): JSX.Element {
  const { Box, Text, Button } = els
  const { s, l, cv, hist, ph, vw, limits, tip } = o
  const wide = o.cols >= 150, mid = o.cols >= 84
  const t = tiles($, els, u, vw.expanded)
  // Shares leave room for padding even where a width excludes it, so a row never wraps early.
  // A card's inner width in px, from flex arithmetic: each card starts at its share of the row and the row's free
  // space is split evenly between its cards (8 px gaps, 16 px padding and a border on each side).
  const W = o.px - 16
  const inner = (shares: number[], i: number) => Math.round(shares[i]! * W + (W - shares.reduce((a, x) => a + x, 0) * W - 8 * (shares.length - 1)) / shares.length - 34)
  // wide: 3 + 2 + 2 cards. mid: 2 + 2, the memory card alone (laid out across), then 2. narrow: one per row.
  const row1 = wide ? [0.28, 0.28, 0.28] : mid ? [0.34, 0.46] : [0.9]
  const ctxPx = inner(row1, 0), limPx = inner(row1, mid ? 1 : 0)
  const memPx = wide ? inner(row1, 2) : inner([0.9], 0)
  const pairPx = mid ? inner([0.4, 0.4], 0) : inner([0.9], 0)
  // last turn and handoff: the handoff holds more text, so it gets the wider share (less so in a medium pane)
  const pl = o.cols >= 120 ? [0.3, 0.5] : [0.36, 0.46], wl = pl.map(x => `${Math.round(x * 100)}%`)
  const pct = l?.context.percent ?? 0
  const win = l?.context.window ?? 1
  const rows = l?.context.rows ?? []
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const compactAt = buffer ? (win - buffer) / win : undefined
  const grow = hist.length > 2 ? (hist[hist.length - 1]! - hist[Math.max(0, hist.length - 6)]!) / Math.min(5, hist.length - 1) : 0
  const turnsLeft = compactAt && grow > 0.2 && pct < compactAt * 100 ? Math.max(1, Math.round((compactAt * 100 - pct) / grow)) : null
  const five = limits.find(x => x.kind === 'five_hour'), wk = limits.find(x => x.kind === 'seven_day')
  const stale = o.limitsAt ? `last seen ${ago(minsSince(new Date(o.limitsAt).toISOString()))}` : undefined
  const planRate = ph.length > 1 ? (ph[ph.length - 1]!.p - ph[0]!.p) / Math.max(1, (ph[ph.length - 1]!.t - ph[0]!.t) / 60_000) : 0
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const lastDream = s.dream.recent[0]
  const waiting = toReview(s)

  // one meter: its name and value on a line, the drawing under them, one caption. Stacked; the card is the box.
  const barPx = Math.max(80, limPx)
  const meter = (key: string, icon: string, label: string, value: string, color: string, visual: JSX.Element | null, caption: string, lead = true) => (
    <Box key={key} flexDirection="column" gap={0}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        {u.tag(`${key}-l`, icon, color === K.text ? K.silver : color, label, K.label)}
        {lead ? <Text size="heading" weight="semibold" tabular color={color}>{value}</Text> : <Text size="body" tabular color={color === K.text ? K.label : color}>{value}</Text>}
      </Box>
      {visual}
      <Text size="caption" color={K.muted}>{caption}</Text>
    </Box>
  )
  const unused = unusedTools(s, l, 200)
  const waste = unused.reduce((a, x) => a + x.loaded, 0)
  const usedRows = rows.filter(r => !/messages|free space|autocompact/i.test(r.name) && r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const carried = usedRows.reduce((a, r) => a + r.tokens, 0)
  const sw = switchDue(s, l, cv, vw)
  // say it once: when the headline is about the flagged notes, the cards below neither repeat them nor their button
  const heroMem = (vw.flow === 'confirm' && flaggedNotes(s) > 0) || tip?.action === 'review'
  const always = s.native.files.filter(f => f.loads !== 'on-demand')
  const over = always.filter(f => f.over)
  const left = Math.max(0, win - (l?.context.tokens ?? 0) - buffer)
  const row = (key: string, icon: string, color: string, label: string, value: string, strong = false) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
      <Box flexShrink={1} minWidth={10}>{u.tag(`${key}-t`, icon, color, label, K.label)}</Box>
      <Text size="caption" weight="semibold" tabular color={strong ? color : K.text}>{value}</Text>
    </Box>
  )
  // the gauge beside its three facts where the card has room for both (the facts need ~150 px), else centred alone
  // above them as the card's hero; either way a little larger than the old arc (168–236 px)
  const beside = ctxPx - 150 >= 168
  const gaugePx = Math.round(beside ? Math.min(236, ctxPx - 150) : Math.min(236, Math.max(168, ctxPx * 0.72)))
  const ctxCard = u.card('ctx', wide ? '28%' : mid ? '34%' : '90%', [
      u.head('ctx-h', 'This chat', l ? `${k(l.context.tokens ?? 0)} of ${k(win)} tokens` : undefined),
      l ? (
        <Box key="ctx-row" flexGrow={1} flexDirection="row" flexWrap="wrap" alignItems="center" justifyContent={beside ? 'flex-start' : 'center'} columnGap={2} rowGap={1}>
          {u.graphic('g-gauge', gauge({ pct, threshold: compactAt, size: gaugePx, label: 'full', animate: animateFor('gauge', `${pct}`) }), `This chat is ${pct}% full`)}
          <Box flexDirection="column" gap={1} width="34%" flexGrow={1} flexShrink={1} minWidth={18}>
            {u.tag('ctx-free', 'spark', K.emerald, `${k(left)} tokens left`, K.text)}
            {turnsLeft ? u.tag('ctx-left', 'pending', K.amber, `about ${turnsLeft} more turn${turnsLeft === 1 ? '' : 's'} at this pace`, K.label) : null}
            {compactAt ? u.tag('ctx-buf', 'compaction', K.amber, `At ${Math.round(compactAt * 100)}% Claude summarizes the chat`, K.label) : null}
          </Box>
        </Box>
      ) : u.tag('ctx-wait', 'pending', K.silver, 'Shows after Claude\'s first reply in this chat.'),
      hist.length > 1 ? <Box key="ctx-trend" flexDirection="column" gap={0}>
        {u.graphic('g-trend', area({ values: hist, width: Math.min(ctxPx, 640), height: 36, max: 100, limit: compactAt ? compactAt * 100 : undefined, animate: animateFor('trend', hist.join(',')) }), 'How full this chat got over recent turns')}
        <Text size="caption" color={K.muted}>{`How it filled up over the last ${hist.length} turns`}</Text>
      </Box> : null,
  ])
  // the week: where "now" is in it (hour steps, so the drawing doesn't change on every redraw) and its day initials
  const weekEnd = wk?.resetsAt ? Date.parse(wk.resetsAt) : NaN
  const known = Number.isFinite(weekEnd) && !wk?.rolled
  const weekStart = weekEnd - 7 * DAY
  const nowShare = known ? Math.max(0, Math.min(1, Math.round(((Date.now() - weekStart) / (7 * DAY)) * 168) / 168)) : undefined
  const today = nowShare === undefined ? undefined : Math.min(6, Math.floor(nowShare * 7))
  const dayLabels = known ? Array.from({ length: 7 }, (_, i) => new Date(weekStart + i * DAY + DAY / 2).toLocaleDateString(undefined, { weekday: 'narrow' })) : undefined
  // the 5-hour window the same way: where "now" is in it (10-minute steps), and the clock time at each hour's boundary
  // (start … reset), never a block's start time in emerald, which read as "the time now" (Kafil, 2026-11-28)
  const fiveEnd = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
  const fiveKnown = Number.isFinite(fiveEnd) && !five?.rolled
  const fiveNow = fiveKnown ? Math.max(0, Math.min(1, Math.round(((Date.now() - (fiveEnd - 5 * 3_600_000)) / (5 * 3_600_000)) * 30) / 30)) : undefined
  const hm = (t: number) => { const d = new Date(t); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}` }
  const hourLabels = fiveKnown && barPx >= 160 ? Array.from({ length: 6 }, (_, i) => hm(fiveEnd - (5 - i) * 3_600_000)) : undefined
  const cacheColor = { warm: K.sage, cooling: K.amber, cold: K.rose, unknown: K.muted }[cs.state]
  const cacheShare = cs.state === 'unknown' ? 0 : cs.leftMin / (ttlMs / 60_000)
  const planCard = u.card('kpi', wide ? '28%' : mid ? '46%' : '90%', [
      u.head('kpi-h', 'Plan and cache', stale),
      <Box key="cells" flexDirection="column" justifyContent="space-between" rowGap={1} flexGrow={1}>
        {meter('c5', 'pending', '5-hour plan', five ? `${five.percentUsed}%` : '–', five ? attn(five.percentUsed / 100) : K.muted,
          five ? u.graphic('g5', hours({ share: five.percentUsed / 100, width: barPx, now: fiveNow, edges: hourLabels, animate: animateFor('p5', `${five.percentUsed}`) }), `${five.percentUsed}% of this 5-hour window used${fiveNow !== undefined ? `; the marker is now, ${Math.round(fiveNow * 300)} minutes into the window` : ''}`) : null,
          five ? (five.rolled ? `a new 5 hours started at ${clock(Date.parse(five.resetsAt!))}` : `of this 5-hour window used${five.resetsAt ? ` · resets ${clock(Date.parse(five.resetsAt))}` : ''}${planRate > 0.01 && five.percentUsed < 100 ? ` · runs out about ${clock(Date.now() + ((100 - five.percentUsed) / planRate) * 60_000)}` : ''}`) : 'shows after a reply')}
        {meter('c7', 'decision', 'This week', wk ? `${wk.percentUsed}%` : '–', wk ? attn(wk.percentUsed / 100) : K.muted,
          wk ? u.graphic('g7', weekBar({ share: wk.percentUsed / 100, width: barPx, now: nowShare, today, labels: dayLabels, animate: animateFor('p7', `${wk.percentUsed}`) }), `${wk.percentUsed}% of this week's limit used${today !== undefined ? `, on day ${today + 1} of 7` : ''}`) : null,
          wk ? (wk.rolled ? 'a new week just started' : `of your weekly limit used${today !== undefined ? `, day ${today + 1} of 7` : ''}${known ? ` · resets ${new Date(weekEnd).toLocaleDateString(undefined, { weekday: 'short' })} ${clock(weekEnd)}` : ''}`) : 'shows after a reply', false)}
        <Box key="cc" flexDirection="row" alignItems="center" columnGap={1} flexWrap="nowrap">
          {u.Svg && cs.state !== 'unknown' ? <Box key="cc-g" flexShrink={0}>{u.graphic('gc', hourglass({ share: cacheShare, color: cacheColor, size: 38 }), cs.state === 'cold' ? 'The cache has run out' : `${cs.leftMin} minutes of cache left`)}</Box> : null}
          <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={16}>
            <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
              {u.Svg && cs.state !== 'unknown' ? <Text key="cc-l" size="caption" color={K.label}>Cache</Text> : u.tag('cc-l', 'spark', K.silver, 'Cache', K.label)}
              <Text size="body" weight={cs.state === 'warm' ? undefined : 'semibold'} tabular color={cs.state === 'warm' ? K.label : cs.state === 'cold' ? 'error' : 'warning'}>{cs.state === 'unknown' ? '–' : cs.state === 'cold' ? 'Cold' : `${cs.leftMin} min`}</Text>
            </Box>
            <Text size="caption" color={K.muted}>{cs.until ? (cs.state === 'cold' ? 'expired: your next message re-reads the whole chat at full price' : `warm until ${clock(cs.until)}: Claude re-reads this chat at a tenth of the price until then`) : 'starts with Claude\'s next reply'}</Text>
          </Box>
        </Box>
      </Box>,
  ])
  // the files that load in every chat, fullest first, against Claude's 200-line limit
  const fullest = (s.memHealth?.files ?? always.map(f => ({ label: f.label, lines: f.lines, limit: 200 }))).slice().sort((a, b) => b.lines / b.limit - a.lines / a.limit).slice(0, 4)
  const memAlone = mid && !wide // a row of its own: words left, bars in the middle, the drawing right
  const memArt = u.Svg && (wide ? o.cols >= 150 : memAlone)
  const onDemand = s.native.files.length - always.length
  const memWords = [
    <Box key="mem-top" flexDirection="row" alignItems="center" columnGap={1} rowGap={0} flexWrap="wrap">
      <Text size="heading" weight="semibold" tabular color={over.length ? K.amber : K.text}>{k(s.native.alwaysTokens)}</Text>
      <Box flexShrink={1} minWidth={14}><Text size="caption" color={K.label}>tokens of notes in every chat</Text></Box>
    </Box>,
    <Text key="mem-n" size="caption" color={K.muted}>{`${always.length} file${always.length === 1 ? '' : 's'} load in every chat${onDemand ? ` · ${onDemand} only when needed` : ''}`}</Text>,
    over.length ? u.tag('mem-over', 'alert', K.amber, over.length === 1 ? `${over[0]!.label} is too long: ${over[0]!.over}${over[0]!.loads === 'first-200' ? ' (Claude Code cuts it silently)' : ''}` : `${over.length} files are too long${over.some(f => f.loads === 'first-200') ? ': auto memory past 200 lines or 25 KB is cut silently' : ''} (Memory files has each one)`, K.label) : u.tag('mem-ok', 'check', K.emerald, 'Every file is short enough to load in full', K.label),
    u.tag('mem-dl', 'dream', waiting && !heroMem ? MARK_AMBER : K.emerald, s.dream.running ? 'Checking your notes now…' : lastDream ? `Checked ${ago(minsSince(lastDream.ts))}${heroMem ? '' : `: ${waiting ? `${waiting} note${waiting === 1 ? '' : 's'} to review` : 'nothing to fix'}`}` : 'Not checked yet', K.label),
  ]
  const memBtn = heroMem ? null : <Button key="ov-dream" variant={waiting && tip?.action !== 'review' ? 'primary' : 'secondary'} onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>{waiting ? `Review ${waiting}` : 'Open memory'}</Button>
  const barsW = memAlone ? Math.min(520, Math.round(memPx * 0.46)) : Math.min(memPx, 560)
  const bars = fullest.length ? u.graphic('g-mem', lineBars({ items: fullest, width: barsW, animate: animateFor('mem', fullest.map(f => f.lines).join(',')) }), `Fullest files: ${fullest.map(f => `${f.label} ${f.lines} of ${f.limit} lines`).join(', ')}`) : null
  const memCard = u.card('mem', wide ? '28%' : '90%', memAlone ? [
      u.head('mem-h', 'Claude\'s memory'),
      <Box key="mem-row" flexDirection="row" alignItems="center" columnGap={3} rowGap={1} flexWrap="wrap">
        <Box flexDirection="column" gap={1} width="30%" flexGrow={1} minWidth={22}>{memWords}</Box>
        {bars ? <Box key="mem-b" flexShrink={0}>{bars}</Box> : null}
        <Box key="mem-d" flexDirection="column" alignItems="flex-end" gap={1} flexGrow={1}>
          {memArt && o.cols >= 110 ? u.graphic('g-mem-m', sceneSvg('memory', 76), 'Cortex with your memory files') : null}
          {memBtn}
        </Box>
      </Box>,
    ] : [
      <Box key="mem-hd" flexDirection="row" justifyContent="space-between" alignItems="flex-start" columnGap={1}>
        <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={16}><Text weight="semibold" color={K.text}>Claude's memory</Text>{memWords.slice(0, 2)}</Box>
        {memArt ? <Box key="mem-m" flexShrink={0}>{u.graphic('g-mem-m', sceneSvg('memory', 76), 'Cortex with your memory files')}</Box> : null}
      </Box>,
      bars,
      ...memWords.slice(2),
      <Box key="mem-d" flexGrow={1} flexDirection="column" justifyContent="flex-end"><Box flexDirection="row" justifyContent="flex-end">{memBtn}</Box></Box>,
    ])
  // what Cortex saved you: the measured total as the card's number, then what tools you never use and Cortex itself add
  const sp = s.spend
  const saved = sp?.resumedContext ?? 0
  const savedCard = u.card('saved-ov', mid ? '40%' : '90%', [
      u.head('sv-h', 'What Cortex saved you'),
      <Box key="sv-r" flexDirection="row" alignItems="center" columnGap={2} flexWrap="nowrap">
        <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={18}>
          <Text key="sv-s" size="heading" weight="bold" tabular color={saved ? K.emerald : K.text}>{`${k(saved)} tokens`}</Text>
          <Text size="caption" color={K.label}>{sp?.resumed ? `not re-read, because ${sp.resumed} chat${sp.resumed === 1 ? '' : 's'} started from a handoff instead of a big old one` : 'saved so far: no chat has started from a handoff yet'}</Text>
        </Box>
        {u.Svg && pairPx >= 300 ? <Box key="sv-art" flexShrink={0}>{u.graphic('sv-m', sceneSvg('saved', 140), 'Cortex beside a stack of saved tokens')}</Box> : null}
      </Box>,
      row('sv-w', waste ? 'alert' : 'check', waste >= 5000 ? K.amber : waste ? K.silver : K.emerald, waste ? 'Tools you never use add' : 'Tools you never use', waste ? `${k(waste)} a message` : 'none loaded', waste >= 5000),
      row('sv-c', 'spark', K.silver, 'Cortex itself adds', s.footprint ? `~${k(s.footprint.tokens)} a message` : '–'),
      <Box key="sv-f" flexGrow={1} flexDirection="column" justifyContent="flex-end"><Box flexDirection="row" justifyContent="flex-end">
        <Button key="ov-costs" plain onPress={() => { void setTab($, 'details'); void setCostsSub($, 'costs') }}><Text size="caption" color={waste >= 5000 ? K.amber : K.label}>{waste >= 5000 ? 'Turn them off in Costs' : 'See all costs'}</Text></Button>
      </Box></Box>,
  ])
  const capsW = pairPx >= 560 ? Math.min(420, Math.round(pairPx * 0.55)) : Math.min(pairPx, 520)
  const keyBeside = pairPx - capsW >= 150
  const costCard = u.card('cost', mid ? '40%' : '90%', [
      u.head('cost-h', 'What every message carries'),
      carried ? <Text key="cost-s" size="caption" color={K.label}>{`Every message starts with ${k(carried)} tokens of setup.`}</Text> : null,
      usedRows.length ? <Box key="cost-row" flexGrow={1} flexDirection="row" flexWrap="wrap" alignItems="flex-end" columnGap={3} rowGap={1}>
        {u.graphic('g-caps', capsules({ items: usedRows.slice(0, 6).map((r, i) => ({ label: short(r.name), value: r.tokens, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!, note: k(r.tokens) })), width: capsW, height: 104, animate: animateFor('caps', usedRows.map(r => r.tokens).join(',')) }), usedRows.map(r => `${plain(r.name)} ${k(r.tokens)}`).join(', '))}
        {/* each part's colour, name and share at every width (the capsules' colours mean nothing without it): beside the
            chart where there's room, else one wrapping line under it */}
        <Box key="cost-lg" flexDirection={keyBeside ? 'column' : 'row'} flexWrap="wrap" columnGap={3} rowGap={0} flexGrow={1} minWidth={20} paddingBottom={keyBeside ? 1 : 0}>
          {usedRows.slice(0, 6).map((r, i) => (
            <Box key={`cl-${r.name}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
              <Box flexDirection="row" gap={1} alignItems="center">{u.dot(`cld-${r.name}`, CATEGORY_COLORS[i % CATEGORY_COLORS.length]!)}<Text size="caption" color={K.label}>{plain(r.name)}</Text></Box>
              <Text size="caption" tabular color={K.muted}>{`${Math.round((100 * r.tokens) / Math.max(1, carried))}%`}</Text>
            </Box>
          ))}
        </Box>
      </Box> : u.tag('cost-wait', 'pending', K.silver, 'Shows after Claude\'s first reply in this chat.'),
      carried ? u.muted('cost-n', 'Cached after the first reply, so re-reading it costs about a tenth.') : null,
  ])
  return (
    <Box flexDirection="column" gap={1}>
      {heroRow($, els, u, { s, l, cv, vw, tip, sw, five: five?.percentUsed ?? 0, cols: o.cols })}

      <Box key="hero" flexDirection="row" flexWrap="wrap" gap={1}>{ctxCard}{planCard}{wide ? memCard : null}</Box>
      <Box key="continuity" flexDirection="row" flexWrap="wrap" gap={1}>
        {/* the handoff card holds more text: the wider share keeps both cards about the same height */}
        {lastTurnCard($, els, u, t, s, vw, mid ? wl[0]! : '90%', mid ? inner(pl, 0) : inner([0.9], 0))}
        {handoffCard($, els, u, t, s, l, mid ? wl[1]! : '90%', !!sw || tip?.action === 'handoff', o.cols >= 110, heroMem)}
      </Box>
      {wide ? null : <Box key="mem-row-o" flexDirection="row">{memCard}</Box>}
      <Box key="diag" flexDirection="row" flexWrap="wrap" gap={1}>{savedCard}{costCard}</Box>
    </Box>
  )
}
