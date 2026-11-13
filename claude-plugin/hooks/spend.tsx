import type { ElementTable } from 'claude-code'

import type { LiveView, StatusView, TokensView } from '../types'
import { k } from './charts'
import { ago, animateFor, minsSince, setParked, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import type { Tiles } from './tiles'
import { stacked } from './viz'

// Costs, part two: what this project's chats used (Claude Code's own counts from its transcripts, 0 tokens to read),
// what Cortex saved (only what can be measured, each with how), and the MCP servers turned off here.
const PARTS: [keyof TokensView, string, string][] = [['cacheRead', 'cache reads', '#9CA3AF'], ['cacheWrite', 'cache writes', '#14B8A6'], ['input', 'new input', '#34D399'], ['output', 'written by Claude', '#10B981']]
const total = (t: TokensView) => t.cacheRead + t.cacheWrite + t.input + t.output

export function spendCard($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, px: number): JSX.Element | null {
  const { Box, Text } = els
  const sp = s.spend
  if (!sp || !sp.all.replies) return null
  const col = (key: string, label: string, x: TokensView) => (
    <Box key={key} width="30%" flexGrow={1} minWidth={18} flexDirection="column" gap={0} backgroundColor={K.pill} {...u.inset()} paddingX={1} paddingY={1}>
      <Text size="caption" color={K.label}>{label}</Text>
      <Text size="heading" weight="semibold" tabular color={K.text}>{k(total(x))}</Text>
      {u.graphic(`${key}-g`, stacked({ items: PARTS.map(([f, l, c]) => ({ value: x[f], color: c, label: `${l}: ${k(x[f])}` })), width: Math.max(80, Math.min(px * 0.27, 300)), animate: animateFor(`sp-${key}`, String(total(x))) }), PARTS.map(([f, l]) => `${l} ${k(x[f])}`).join(', '))}
      <Text size="caption" tabular color={K.muted}>{`${x.replies.toLocaleString()} replies · ${k(x.output)} written`}</Text>
    </Box>
  )
  return u.card('spend', '100%', [
    u.head('sp-h', 'Tokens this project used', `from Claude Code's own counts · kept since ${sp.since ?? '–'}`),
    <Box key="sp-c" flexDirection="row" gap={1} flexWrap="wrap">{col('sp-d', 'Today', sp.today)}{col('sp-w', 'Last 7 days', sp.week)}{total(sp.all) !== total(sp.week) ? col('sp-a', 'All kept', sp.all) : null}</Box>,
    <Box key="sp-l" flexDirection="row" flexWrap="wrap" columnGap={3}>{PARTS.map(([f, l, c]) => <Box key={`spl-${f}`} flexDirection="row" gap={1} alignItems="center">{u.dot(`spd-${f}`, c)}<Text size="caption" color={K.label}>{l}</Text></Box>)}</Box>,
    u.muted('sp-n', 'Cache reads: the chat re-read with each message, at about 1/10 the price. Subagents included.'),
  ])
}

export function savedCard(u: Kit, t: Tiles, s: StatusView): JSX.Element | null {
  const sp = s.spend
  const parkedHere = (s.parked?.servers ?? []).filter(x => s.parked!.disabled.includes(x.name))
  const perMsg = parkedHere.reduce((a, x) => a + x.tokens, 0)
  const scoped = s.memHealth?.scopedTokens ?? 0
  return u.card('saved', '100%', [
    u.head('sv-h', 'What Cortex saved', 'measured, not estimated'),
    t.metric('sv-r', 'link', sp?.resumed ? K.emerald : K.silver, sp?.resumed ? k(sp.resumedContext) : '0', sp?.resumed ? `tokens not re-read: ${sp.resumed} chat${sp.resumed === 1 ? '' : 's'} started from a handoff instead of continuing a big one (first message)` : 'no chat started from a handoff yet', '100%'),
    t.metric('sv-p', 'spark', perMsg ? K.emerald : K.silver, perMsg ? k(perMsg) : '0', perMsg ? `fewer tokens per message in new chats (${parkedHere.length} unused server${parkedHere.length === 1 ? '' : 's'} off)` : 'no unused servers turned off yet', '100%'),
    t.metric('sv-s', 'move', scoped ? K.sage : K.silver, scoped ? k(scoped) : '0', 'tokens of rules that load only for their files (path-scoped)', '100%'),
    // honest both ways: what Cortex itself costs sits beside what it saved (the Costs card above says the same)
    t.metric('sv-z', 'spark', K.silver, s.footprint ? `~${k(s.footprint.tokens)}` : '–', 'tokens Cortex itself adds to each message (its skill descriptions)', '100%'),
  ])
}

/** Park or unpark one MCP server (the Claude app's own servers stay: it needs them). */
const CORE = /^(ccd_|kapex-cortex|plugin_kapex)/
export function parkButton($: Dollar, els: ElementTable, s: StatusView, x: { kind: string; name: string; server?: string }): JSX.Element | null {
  const { Button } = els
  if (x.kind !== 'mcp' || !x.server || CORE.test(x.name) || !s.parked) return null
  const off = s.parked.disabled.includes(x.server)
  return <Button key={`park-${x.name}`} variant="secondary" onPress={() => { void setParked($, [x.server!], !off) }}>{off ? 'Turn on' : 'Turn off'}</Button>
}

/** What Cortex parked here, whether Claude Code's config still has it off, and whether the current chat still loads it. */
export function parkedList($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, l: LiveView | null): JSX.Element | null {
  const { Box, Text, Button } = els
  const list = s.parked?.servers ?? []
  if (!list.length) return null
  return u.card('parked', '100%', [
    u.head('pk-h', 'Turned off here (disabled)', 'applies to new chats'),
    ...list.map(x => {
      const off = s.parked!.disabled.includes(x.name)
      const loads = off && l?.startedAt && l.startedAt > Date.parse(x.at) && (l.loadout ?? []).some(y => y.server === x.name)
      return (
        <Box key={`pk-${x.name}`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
          <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
            {u.tag(`pkt-${x.name}`, 'link', off ? K.silver : K.amber, x.name, K.text)}
            {t.badge(`pkb-${x.name}`, x.auto ? 'by Cortex: unused' : 'by you', K.label)}
            {t.badge(`pks-${x.name}`, loads ? 'still loads (the Claude app keeps it on)' : off ? `off · ${ago(minsSince(x.at))}` : 'back on (changed in /mcp)', loads || !off ? K.amber : K.emerald)}
            {x.tokens ? <Text size="caption" tabular color={K.muted}>{`${k(x.tokens)} tokens a message`}</Text> : null}
          </Box>
          <Button key={`unpark-${x.name}`} variant="secondary" onPress={() => { void setParked($, [x.name], false) }}>{off ? 'Turn on' : 'Forget'}</Button>
        </Box>
      )
    }),
    u.muted('pk-n', 'Same switch as /mcp. Need one right now? Turn it on in /mcp.'),
  ])
}
