import type { ElementTable } from 'claude-code'

import type { LiveView, StatusView, TokensView } from '../types'
import { k } from './charts'
import { ago, animateFor, minsSince, setParked, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { sceneSvg } from './mascot'
import type { Tiles } from './tiles'
import { stacked } from './viz'
import { toolName } from './tips'

// Costs, part two: what this project's chats used (Claude Code's own counts from its transcripts, 0 tokens to read),
// what Cortex saved (only what can be measured, each with how), and the MCP servers turned off here.
// four hues told apart at a glance (grey, teal, slate, emerald), never two greens side by side
const PARTS: [keyof TokensView, string, string][] = [['cacheRead', 'cache reads', '#9CA3AF'], ['cacheWrite', 'cache writes', '#14B8A6'], ['input', 'new input', '#4B5563'], ['output', 'written by Claude', '#10B981']]
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
    u.head('sp-h', 'Tokens this project used', 'counted by Claude Code itself'),
    <Box key="sp-c" flexDirection="row" gap={1} flexWrap="wrap">{col('sp-d', 'Today', sp.today)}{col('sp-w', 'Last 7 days', sp.week)}{total(sp.all) !== total(sp.week) ? col('sp-a', sp.since && /^\d{4}-\d{2}-\d{2}$/.test(sp.since) ? `Since ${new Date(`${sp.since}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'All time', sp.all) : null}</Box>,
    <Box key="sp-l" flexDirection="row" flexWrap="wrap" columnGap={3}>{PARTS.map(([f, l, c]) => <Box key={`spl-${f}`} flexDirection="row" gap={1} alignItems="center">{u.dot(`spd-${f}`, c)}<Text size="caption" color={K.label}>{l}</Text></Box>)}</Box>,
    u.muted('sp-n', 'Cache reads are the chat being re-read with each message, at about a tenth of the price. Subagents are included.'),
  ])
}

export function savedCard(u: Kit, t: Tiles, s: StatusView, px = 900): JSX.Element | null {
  const sp = s.spend
  const parkedHere = (s.parked?.servers ?? []).filter(x => s.parked!.disabled.includes(x.name))
  const perMsg = parkedHere.reduce((a, x) => a + x.tokens, 0)
  const scoped = s.memHealth?.scopedTokens ?? 0
  const { Box, Text } = u.els
  // a number and what it counts on one line: four of these read as a short list, not four more boxes
  const row = (key: string, icon: string, color: string, value: string, label: string) => (
    <Box key={key} flexDirection="row" gap={1} alignItems="center">
      {u.node(`${key}-n`, icon, color, 20)}
      <Box width={8} flexShrink={0}><Text weight="semibold" tabular color={color === K.silver ? K.text : color}>{value}</Text></Box>
      <Box flexGrow={1} flexShrink={1} minWidth={12}><Text size="caption" color={K.label}>{label}</Text></Box>
    </Box>
  )
  return u.card('saved', '100%', [
    u.head('sv-h', 'What Cortex saved you', 'measured, not estimated'),
    // the biggest saving is the card's hero: a large number, what it means, and the mascot beside it
    <Box key="sv-r" flexDirection="row" alignItems="center" columnGap={2} flexWrap="nowrap">
      <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={18}>
        <Text size="heading" weight="semibold" tabular color={K.text}>{sp?.resumed ? `${k(sp.resumedContext)} tokens` : '0 tokens'}</Text>
        <Text size="caption" color={K.label}>{sp?.resumed ? `not re-read, because ${sp.resumed} chat${sp.resumed === 1 ? '' : 's'} started from a handoff instead of carrying on in a big one` : 'saved so far: no chat has started from a handoff yet'}</Text>
      </Box>
      {u.Svg && px >= 560 ? <Box key="sv-art" flexShrink={0}>{u.graphic('sv-m', sceneSvg('saved', 110), 'Cortex beside a growing stack of saved tokens')}</Box> : null}
    </Box>,
    row('sv-p', 'spark', perMsg ? K.emerald : K.silver, perMsg ? k(perMsg) : '0', perMsg ? `fewer tokens in every message of a new chat, with ${parkedHere.length} unused tool${parkedHere.length === 1 ? '' : 's'} turned off` : 'tokens a message: no unused tools turned off yet'),
    row('sv-s', 'move', scoped ? K.sage : K.silver, scoped ? k(scoped) : '0', 'tokens of rules that load only when Claude works on their files'),
    // honest both ways: what Cortex itself costs sits beside what it saved (the Costs card above says the same)
    row('sv-z', 'spark', K.silver, s.footprint ? `~${k(s.footprint.tokens)}` : '–', 'tokens Cortex itself adds to each message'),
  ])
}

/** A server's name as you'd say it: a claude.ai connector is an id, so say what it is; underscores are spaces. */
const nice = (x: { name: string }) => toolName(x).replace(/^a connector$/, 'A connector from your claude.ai account').replace(/_/g, ' ')

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
    u.head('pk-h', 'Tools turned off in this project', 'applies to new chats'),
    ...list.map(x => {
      const off = s.parked!.disabled.includes(x.name)
      const loads = off && l?.startedAt && l.startedAt > Date.parse(x.at) && (l.loadout ?? []).some(y => y.server === x.name)
      return (
        <Box key={`pk-${x.name}`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="nowrap">
          <Box flexDirection="row" columnGap={1} rowGap={0} alignItems="center" flexShrink={1} flexWrap="wrap" minWidth={12}>
            {u.tag(`pkt-${x.name}`, 'link', off ? K.silver : K.amber, nice(x), K.text)}
            {t.badge(`pks-${x.name}`, loads ? 'Still loads (the Claude app keeps it on)' : off ? (x.auto ? 'Off by Cortex · unused' : `Off · ${ago(minsSince(x.at))}`) : 'Back on (changed with /mcp)', loads || !off ? K.amber : K.label)}
            {x.tokens && off ? <Text size="caption" tabular color={K.muted}>{`saves ${k(x.tokens)} a message`}</Text> : null}
          </Box>
          <Box flexShrink={0}><Button key={`unpark-${x.name}`} variant="secondary" onPress={() => { void setParked($, [x.name], false) }}>{off ? 'Turn on' : 'Forget'}</Button></Box>
        </Box>
      )
    }),
    u.muted('pk-n', 'This is the same switch /mcp uses. Need one in this chat? Turn it on with /mcp.'),
  ])
}
