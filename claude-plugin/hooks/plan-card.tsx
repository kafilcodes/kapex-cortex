import { clock, k, prettyModel } from './charts'
import type { Ctx } from './tabs'
import { HEAT, heat, K } from './theme'
import { ink, type Tiles } from './tiles'
import { paceTrack, splitBar, toolBlocks, waffle } from './viz-plan'

// Costs → "Right now": the 5-hour plan, and what used it. The plan is shared by every chat in every project, so the
// split comes from all of Claude Code's transcripts touched in the window (src/core/window.ts), kept to what falls after
// the window's real start (the reset time less 5 hours). Claude does not publish how it counts the plan, so each share
// is an estimate from token counts at API price ratios, and the card says so.

const CHAT_COLORS = ['#10B981', '#14B8A6', '#34D399', '#0E7490', '#6EE7B7']
const OTHERS = '#9CA3AF'
type Sum = { weight: number; tokens: number; replies: number }
const add = (m: Map<string, Sum>, key: string, r: { weight: number; tokens: number; replies: number }) => {
  const x = m.get(key) ?? { weight: 0, tokens: 0, replies: 0 }
  x.weight += r.weight; x.tokens += r.tokens; x.replies += r.replies; m.set(key, x)
}
/** "2 h 10 min", "35 min" */
const dur = (ms: number) => { const m = Math.max(0, Math.round(ms / 60_000)); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min` }
const pct = (n: number) => (n >= 10 ? `${Math.round(n)}%` : n >= 1 ? `${n.toFixed(1).replace(/\.0$/, '')}%` : n > 0 ? '<1%' : '0%')

export function planCard(o: Ctx, t: Tiles, w: number): JSX.Element {
  const { u, s, l, five } = o
  const { Box, Text } = o.els
  const used = five?.percentUsed ?? null
  const r0 = five?.resetsAt ? Date.parse(five.resetsAt) : NaN
  const reset = Number.isFinite(r0) && r0 > Date.now() ? r0 : NaN // a reset time already gone says nothing about this window
  const win = s.window
  // the window's real start when the reset time is known, else the last 5 hours
  const start = Number.isFinite(reset) ? reset - 5 * 3_600_000 : win ? Date.parse(win.since) : 0
  const rows = (win?.rows ?? []).filter(r => r.slot * (win?.slotMs ?? 600_000) >= start) // a slot that began before the window belongs to the last one
  const total = rows.reduce((a, r) => a + r.weight, 0)
  const byChat = new Map<string, Sum>(), byModel = new Map<string, Sum>(), bySub = new Map<string, Sum>()
  for (const r of rows) { add(byChat, r.chat, r); add(byModel, prettyModel(`claude-${r.model}`), r); add(bySub, r.sub ? 'helpers' : 'main', r) }
  const tools = new Map<string, number>()
  for (const x of win?.tools ?? []) if (x.slot * (win?.slotMs ?? 600_000) >= start) tools.set(x.tool, (tools.get(x.tool) ?? 0) + x.n)
  const chatName = (id: string) => { const c = win?.chats.find(x => x.id === id); const here = c?.project && (c.path ? c.path !== s.root && !c.path.startsWith(`${s.root}/`) : c.project !== s.project) ? ` · ${c.project}` : ''; return `${c?.title || (id === l?.sessionId ? 'This chat' : 'A chat')}${id === l?.sessionId && c?.title ? ' (this chat)' : twin(id) && id !== l?.sessionId ? ` · from ${clock((firstSlot.get(id) ?? 0) * (win?.slotMs ?? 600_000))}` : ''}${here}` }
  const chats = [...byChat.entries()].sort((a, b) => b[1].weight - a[1].weight)
  // when two chats carry one title (a resumed chat keeps its name), each says when it started in this window
  const firstSlot = new Map<string, number>()
  for (const r of rows) firstSlot.set(r.chat, Math.min(firstSlot.get(r.chat) ?? Infinity, r.slot))
  const titleOf = (id: string) => win?.chats.find(x => x.id === id)?.title ?? ''
  const twin = (id: string) => !!titleOf(id) && chats.filter(([c]) => titleOf(c) === titleOf(id)).length > 1
  const top = chats.slice(0, 4), rest = chats.slice(4)
  const restSum = rest.reduce((a, [, v]) => ({ weight: a.weight + v.weight, tokens: a.tokens + v.tokens, replies: a.replies + v.replies }), { weight: 0, tokens: 0, replies: 0 })
  const legend: [string, string, Sum][] = [...top.map(([id, v], i) => [chatName(id), CHAT_COLORS[i % CHAT_COLORS.length]!, v] as [string, string, Sum]), ...(rest.length ? [[`${rest.length} other chat${rest.length === 1 ? '' : 's'}`, OTHERS, restSum] as [string, string, Sum]] : [])]
  // a chat's part of the plan, in plan points: its share of the window's weighted tokens × the plan's % used
  const points = (v: Sum) => (used !== null && used > 0 && total > 0 ? (v.weight / total) * used : null)
  const shareText = (v: Sum) => { const p = points(v); return p !== null ? `~${pct(p)} of plan` : `${pct((100 * v.weight) / Math.max(1, total))} of use` }
  const models = [...byModel.entries()].sort((a, b) => b[1].weight - a[1].weight)
  const main = bySub.get('main')?.weight ?? 0, helpers = bySub.get('helpers')?.weight ?? 0
  const toolList = [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)
  const side = w >= 520 // the model bar and the waffle side by side
  const color = used === null ? K.silver : heat(used / 100)

  const now = Date.now()
  const pace = used !== null && Number.isFinite(reset) ? paceTrack({ used, start, reset, now, width: w, parts: legend.map(([label, color, v]) => ({ share: v.weight, color, label: `${label}: ${shareText(v)}, ${k(v.tokens)} tokens` })) }) : null
  // one sentence on where this pace leads: the reason to look at this card at all
  const verdict = !pace || used === null ? null
    : used >= 100 ? { c: HEAT.bad, t: `You have used the whole plan: it resets at ${clock(reset)}, in ${dur(reset - now)}.` }
    : pace.early ? (used > 0 ? { c: K.muted, t: 'Too early in the window to tell the pace.' } : null)
    : pace.out ? { c: HEAT.bad, t: `At this pace you run out at ${clock(pace.out)}, ${dur(reset - pace.out)} before the reset.` }
    : pace.atReset >= 0.8 ? { c: HEAT.high, t: `At this pace about ${Math.round(pace.atReset * 100)}% by the reset: close. A handoff to a fresh chat slows it.` }
    : used > 0 ? { c: K.emerald, t: `At this pace about ${Math.round(pace.atReset * 100)}% by the reset: room to spare.` } : null
  const mPct = (v: number) => pct((100 * v) / Math.max(1, total))
  const blocks = toolList.length ? toolBlocks({ width: w, items: toolList.map(([n, c]) => ({ label: n, n: c })) }) : null

  return u.card('d-now', '100%', [
    <Box key="d-now-h" flexDirection="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" columnGap={2} rowGap={0}>
      <Box flexDirection="column" gap={0} flexShrink={1} minWidth={20}>
        <Text weight="semibold" color={K.text}>Your 5-hour plan</Text>
        <Text size="caption" color={K.muted}>{rows.length ? `What used it since ${clock(start)}, across all your projects` : 'Shared by every chat, in every project'}</Text>
      </Box>
      <Box flexDirection="column" gap={0} alignItems={side ? 'flex-end' : 'flex-start'}>
        <Text size="title" weight="semibold" tabular color={ink(color)}>{used !== null ? `${used}%` : '–'}</Text>
        <Text size="caption" color={K.muted}>{used !== null ? `used${Number.isFinite(reset) ? ` · resets in ${dur(reset - now)}` : ''}` : 'shows after a reply'}</Text>
      </Box>
    </Box>,
    verdict ? <Text key="d-now-v" size="caption" weight="medium" color={ink(verdict.c)}>{verdict.t}</Text> : null,
    pace ? u.graphic('d-plan-pace', pace.svg, `${used}% of the 5-hour plan used. ${verdict?.t ?? ''}`) : null,
    legend.length ? <Box key="d-now-lg" flexDirection="column" gap={0}>
      {legend.map(([name, c, v], i) => (
        <Box key={`d-lg-${i}`} flexDirection="row" alignItems="center" columnGap={1} flexWrap="nowrap">
          {u.dot(`d-lgd-${i}`, c)}
          <Box flexGrow={1} flexShrink={1} minWidth={8}><Text size="caption" color={K.text} wrap="truncate-end">{name}</Text></Box>
          {o.px >= 560 ? <Box flexShrink={0}><Text size="caption" tabular color={K.muted}>{`${k(v.tokens)} tokens`}</Text></Box> : null}
          <Box width={12} flexShrink={0} alignItems="flex-end"><Text size="caption" tabular weight="semibold" color={K.text}>{shareText(v)}</Text></Box>
        </Box>
      ))}
    </Box> : u.muted('d-now-none', 'Nothing used yet in this window.'),
    // side by side where there's room (the model bar takes its column's whole width), stacked where narrow
    rows.length && models.length === 1 && !helpers ? <Text key="d-now-one" size="caption" color={K.label}>{`All on ${models[0]![0]}, no subagents`}</Text> : null,
    rows.length && !(models.length === 1 && !helpers) ? <Box key="d-now-mix" flexDirection={side ? 'row' : 'column'} columnGap={4} rowGap={2} paddingTop={1}>
      <Box key="d-mx-m" flexDirection="column" gap={1} {...(side ? { width: '60%' } : {})} flexShrink={0}>
        <Text size="caption" weight="semibold" color={K.label}>By model</Text>
        {u.graphic('d-mx-mg', splitBar({ width: side ? Math.round(w * 0.6) - 16 : w, items: models.map(([m, v], i) => ({ label: m, value: v.weight, color: /fable/i.test(m) ? K.amber : i ? '#14B8A6' : K.emerald })) }), models.map(([m, v]) => `${m} ${mPct(v.weight)}`).join(', '))}
      </Box>
      <Box key="d-mx-s" flexDirection="column" gap={1} flexGrow={1} minWidth={20}>
        <Text size="caption" weight="semibold" color={K.label}>Your chats and subagents</Text>
        <Box flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">
          {u.graphic('d-mx-sw', waffle({ a: main, b: helpers, colors: [K.emerald, '#5EEAD4'], titles: [`Your chats: ${mPct(main)}`, `Subagents: ${mPct(helpers)}`] }), `Your chats ${mPct(main)}, subagents ${mPct(helpers)}`)}
          <Box flexDirection="column" gap={0}>
            <Text size="caption" color={K.text}><Text color={K.emerald}>● </Text>{`Your chats ${mPct(main)}`}</Text>
            <Text size="caption" color={K.text}><Text color="#5EEAD4">● </Text>{`Subagents ${mPct(helpers)}`}</Text>
          </Box>
        </Box>
      </Box>
    </Box> : null,
    toolList.length ? <Box key="d-now-tools" flexDirection="column" gap={1}>
      <Text size="caption" weight="semibold" color={K.label}>Tools Claude called in this window</Text>
      {u.graphic('d-now-tb', blocks!.svg, toolList.map(([n, c]) => `${n} ${c}`).join(', '))}
      {blocks!.unnamed.length ? <Text size="caption" color={K.muted}>{blocks!.unnamed.map(x => `${x.label} ${x.n}`).join(' · ')}</Text> : null}
    </Box> : null,
    u.muted('d-now-note', `${l ? `This chat: ${l.turns} turns${l.costUsd !== undefined ? `, $${l.costUsd.toFixed(2)} at API prices` : ''}. ` : ''}Shares are estimates from token counts at API price ratios; Claude does not publish how it counts the plan. Run /usage for its own view.`),
  ])
}
