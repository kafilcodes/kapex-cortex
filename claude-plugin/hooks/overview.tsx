import type { ElementTable } from 'claude-code'

import type { CacheView, LiveView, StatusView, ViewState } from '../types'
import { cacheState, clock, k } from './charts'
import { act, ago, animateFor, minsSince, setSub, setTab, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { lastTurnCard, readyToSwitch, savingsCard } from './cards'
import { K, levelColor } from './theme'
import { tiles } from './tiles'
import { heroRow } from './hero'
import { switchDue } from './switch'
import { unusedTools, type Tip } from './tips'
import { arcGauge, area, capsules, drain, micro } from './viz'

// The Overview page, most urgent first: the tip that matters now · context and plan/cache/handoff (what runs out) ·
// the last turn and whether a new chat is ready (continuity) · the memory Claude loads (and the last Dream), savings
// and what every message carries (diagnostics). Each width is a starting share and cards grow to fill their row, so no row leaves a gap.
const CATEGORY_COLORS = ['#9CA3AF', '#6B7280', '#14B8A6', '#34D399', '#10B981', '#A7F3D0', '#4B5563']
const shortName = (n: string) => n.replace(/^System /, '').replace('Memory files', 'Memory').replace('Custom agents', 'Agents').replace('System prompt', 'System')

export type Overview = { s: StatusView; l: LiveView | null; cv: CacheView; hist: number[]; ph: { t: number; p: number }[]; vw: ViewState; limits: LiveView['limits']; limitsAt: number | null; tip: Tip | null; cols: number; px: number }

export function overviewPage($: Dollar, els: ElementTable, u: Kit, o: Overview): JSX.Element {
  const { Box, Text, Button } = els
  const { s, l, cv, hist, ph, vw, limits, tip } = o
  const wide = o.cols >= 150, mid = o.cols >= 84
  const t = tiles($, els, u, vw.expanded)
  // '90%' in a row = alone on its line, grown to fill it
  const w3 = wide ? '28%' : mid ? '45%' : '90%', w2 = mid ? '45%' : '90%'
  const wCtx = wide ? '30%' : mid ? '38%' : '90%', wKpi = wide ? '60%' : mid ? '52%' : '90%', wCost = wide ? '28%' : '90%'
  const cardPx = wide ? o.px * 0.3 - 50 : mid ? o.px * 0.42 - 50 : o.px - 60
  const pct = l?.context.percent ?? 0
  const win = l?.context.window ?? 1
  const rows = l?.context.rows ?? []
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const compactAt = buffer ? (win - buffer) / win : undefined
  const grow = hist.length > 2 ? (hist[hist.length - 1]! - hist[Math.max(0, hist.length - 6)]!) / Math.min(5, hist.length - 1) : 0
  const turnsLeft = compactAt && grow > 0.2 && pct < compactAt * 100 ? Math.max(1, Math.round((compactAt * 100 - pct) / grow)) : null
  const five = limits.find(x => x.kind === 'five_hour'), week = limits.find(x => x.kind === 'seven_day')
  const stale = o.limitsAt ? ` · last seen ${ago(minsSince(new Date(o.limitsAt).toISOString()))}` : ''
  const planRate = ph.length > 1 ? (ph[ph.length - 1]!.p - ph[0]!.p) / Math.max(1, (ph[ph.length - 1]!.t - ph[0]!.t) / 60_000) : 0
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const hit = cv.read + cv.write + cv.input ? Math.round((100 * cv.read) / (cv.read + cv.write + cv.input)) : null
  const lastDream = s.dream.recent[0]
  const waiting = toReview(s)
  const wip = s.git?.wip
  // always a 2×2 grid: four across left the cells short and hollow at full width
  const cellW = '42%'
  const cellPx = Math.max(90, Math.min(300, (wide ? (o.px * 0.62) / 2 : mid ? (o.px * 0.54) / 2 : o.px / 2) - 50))
  // one KPI cell: icon and title over the bar on the left, the value large on the right across both lines, then a
  // small caption (and an action, e.g. Save) underneath. Cells grow to fill the card, so no empty strip is left below.
  const barPx = Math.max(60, cellPx - 64)
  const cell = (key: string, icon: string, label: string, value: string, color: string, visual: JSX.Element | null, caption: string, action?: JSX.Element) => (
    <Box key={key} width={cellW} flexGrow={1} minWidth={16} flexDirection="column" justifyContent="space-between" gap={1} backgroundColor={K.pill} {...u.inset()} paddingX={1} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={8}>
          {u.tag(`${key}-l`, icon, color === K.muted ? K.silver : color, label, K.label)}
          {visual}
        </Box>
        <Box flexShrink={0}><Text size="title" weight="semibold" tabular color={color}>{value}</Text></Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={6}>{u.line(`${key}-c`, caption, false, K.muted, 'caption')}</Box>
        {action ?? null}
      </Box>
    </Box>
  )
  const unused = unusedTools(s, l, 200)
  const waste = unused.reduce((a, x) => a + x.loaded, 0)
  const usedRows = rows.filter(r => !/messages|free space|autocompact/i.test(r.name) && r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const sw = switchDue(s, l, cv, vw)
  return (
    <Box flexDirection="column" gap={1}>
      {heroRow($, els, u, { s, l, cv, vw, tip, sw, five: five?.percentUsed ?? 0, cols: o.cols })}

      <Box key="hero" flexDirection="row" flexWrap="wrap" gap={1}>
        {u.card('ctx', wCtx, [
          u.head('ctx-h', 'Context', compactAt ? `compacts at ${Math.round(compactAt * 100)}%` : undefined),
          l ? (
            <Box key="ctx-row" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={2} rowGap={1}>
              {u.graphic('g-gauge', arcGauge({ pct, threshold: compactAt, size: Math.min(200, Math.max(140, cardPx)), label: `${k(l.context.tokens ?? 0)} of ${k(win)}`, animate: animateFor('gauge', `${pct}`) }), `Context ${pct}% full`)}
              <Box flexDirection="column" gap={1} flexGrow={1} minWidth={18}>
                {u.tag('ctx-used', 'turn', K.emerald, `${k(l.context.tokens ?? 0)} used`, K.text)}
                {u.tag('ctx-free', 'spark', K.silver, `${k(Math.max(0, win - (l.context.tokens ?? 0) - buffer))} free before compaction`, K.label)}
                {buffer ? u.tag('ctx-buf', 'compaction', K.amber, `${k(buffer)} kept for the summary`, K.label) : null}
                {turnsLeft ? u.tag('ctx-left', 'pending', K.amber, `about ${turnsLeft} turns left`, K.label) : null}
              </Box>
            </Box>
          ) : u.tag('ctx-wait', 'pending', K.silver, 'Shows after Claude\'s first reply in this chat.'),
          hist.length > 1 ? u.graphic('g-trend', area({ values: hist, width: Math.min(cardPx, 320), height: 36, max: 100, limit: compactAt ? compactAt * 100 : undefined, animate: animateFor('trend', hist.join(',')) }), 'Context over recent turns') : null,
          l ? u.line('ctx-c', 'Claude summarizes the chat at the amber mark.', false, K.muted, 'caption') : null,
        ])}
        {u.card('kpi', wKpi, [
          u.head('kpi-h', 'Plan, cache and handoff', hit !== null ? `${hit}% of the last reply cached` : undefined),
          <Box key="cells" flexDirection="row" flexWrap="wrap" gap={1} flexGrow={1}>
            {cell('c5', 'pending', '5 Hr Plan', five ? `${five.percentUsed}%` : '–', five ? levelColor(five.percentUsed / 100, 0.7, 0.9) : K.muted,
              five ? u.graphic('g5', micro({ share: five.percentUsed / 100, width: barPx, animate: animateFor('p5', `${five.percentUsed}`) }), `${five.percentUsed}% used`) : null,
              five ? (five.rolled ? `new window since ${clock(Date.parse(five.resetsAt!))} · updates after a reply` : `${five.resetsAt ? `resets ${clock(Date.parse(five.resetsAt))}` : ''}${planRate > 0.01 && five.percentUsed < 100 ? ` · limit ≈${clock(Date.now() + ((100 - five.percentUsed) / planRate) * 60_000)}` : ''}${stale}`) : 'appears after a reply')}
            {cell('c7', 'decision', 'This week', week ? `${week.percentUsed}%` : '–', week ? levelColor(week.percentUsed / 100, 0.7, 0.9) : K.muted,
              week ? u.graphic('g7', micro({ share: week.percentUsed / 100, width: barPx, animate: animateFor('p7', `${week.percentUsed}`) }), `${week.percentUsed}% used`) : null, week?.rolled ? 'new week started · updates after a reply' : `7-day window${week?.resetsAt ? ` · resets ${new Date(week.resetsAt).toLocaleDateString(undefined, { weekday: 'short' })} ${clock(Date.parse(week.resetsAt))}` : ''}${stale}`)}
            {cell('cc', 'spark', 'Cache', cs.state === 'unknown' ? 'Idle' : cs.state === 'cold' ? 'Cold' : `${cs.leftMin} min`, { warm: K.sage, cooling: K.amber, cold: K.rose, unknown: K.muted }[cs.state],
              cs.state === 'unknown' ? null : u.graphic('gc', drain({ share: cs.leftMin / (ttlMs / 60_000), seconds: 0, width: barPx }), `${cs.leftMin} minutes of cache left`),
              cs.until ? (cs.state === 'cold' ? 'expired: the next reply re-reads everything' : `warm until ${clock(cs.until)}`) : 'warms up with your next reply')}
            {cell('ch', 'link', 'Handoff', s.handoff.exists ? ago(minsSince(s.stateAt)) : 'none', s.handoff.ready ? K.amber : s.handoff.exists ? K.emerald : K.muted,
              null, s.git ? `${s.git.branch} · ${s.git.dirty} changed${wip ? ` · snapshot ${ago(minsSince(wip.at))}` : ''}` : 'not a git repo',
              <Button key="kc-hand" plain hotkey="s" onPress={() => { void act($, 'Handoff saved', ['h']) }}><Text size="caption" color={K.label}>Save</Text></Button>)}
          </Box>,
        ])}
      </Box>

      <Box key="continuity" flexDirection="row" flexWrap="wrap" gap={1}>
        {lastTurnCard($, els, u, t, s, vw, w2)}
        {u.card('ready', w2, readyToSwitch($, els, u, t, s, l, 'or'))}
      </Box>

      <Box key="diag" flexDirection="row" flexWrap="wrap" gap={1}>
        {u.card('mem', w3, [
          u.head('mem-h', 'Memory Claude loads', `${k(s.native.alwaysTokens)} tokens every session`),
          ...s.native.files.filter(f => f.loads !== 'on-demand').slice(0, 6).map(f => (
            <Box key={`mf-${f.label}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
              {u.tag(`mft-${f.label}`, f.scope === 'auto' ? 'lesson' : f.scope === 'rules' ? 'rule' : f.scope === 'user' ? 'star' : 'file', f.over ? K.amber : K.silver, f.label, f.over ? K.amber : K.label)}
              <Text size="caption" tabular color={K.muted}>{`${f.lines} lines`}</Text>
            </Box>
          )),
          <Box key="mem-d" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
            {u.tag('mem-dl', 'dream', waiting ? K.amber : K.emerald, s.dream.running ? 'Dreaming…' : lastDream ? `Last Dream ${ago(minsSince(lastDream.ts))}${waiting ? ` · ${waiting} to review` : ''}` : 'No Dream yet', K.label)}
            <Button key="ov-dream" variant={waiting ? 'primary' : 'secondary'} onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>{waiting ? `Review ${waiting}` : 'Open'}</Button>
          </Box>,
        ])}
        {savingsCard(u, t, s, hit, waste, w3, l)}
        {u.card('cost', wCost, [
          u.head('cost-h', 'Every message carries', usedRows.length ? `${k(usedRows.reduce((a, r) => a + r.tokens, 0))} tokens` : undefined),
          usedRows.length ? u.graphic('g-caps', capsules({ items: usedRows.slice(0, 6).map((r, i) => ({ label: shortName(r.name), value: r.tokens, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length]!, note: k(r.tokens) })), width: Math.min(wide ? o.px * 0.3 - 50 : o.px - 60, 460), height: 104, animate: animateFor('caps', usedRows.map(r => r.tokens).join(',')) }), usedRows.map(r => `${r.name} ${k(r.tokens)}`).join(', ')) : u.tag('cost-wait', 'pending', K.silver, 'Shows after Claude\'s first reply in this chat.'),
        ])}
      </Box>
    </Box>
  )
}
