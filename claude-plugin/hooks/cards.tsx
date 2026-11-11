import type { ElementTable } from 'claude-code'

import type { EpisodeView, LiveView, StatusView, ViewState } from '../types'
import { k } from './charts'
import { act, ago, minsSince, setSub, setTab, toggleExpanded, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { preview, type Tiles } from './tiles'

// The three Overview cards that used to be sentences, now structured: a status badge, small metrics and short
// labelled lines. Last turn · Savings · Ready to switch.

/** A command as you'd say it: no VAR=… or cd "…" && in front, no pipes or redirects after, at most 40 characters. */
export const cmdLabel = (c: string) => c.replace(/^(?:\s*[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S+)\s*;?\s*)+/, '').replace(/^cd\s+(?:"[^"]+"|'[^']+'|\S+)\s*&&\s*/, '').split(/\s*(?:&&|;|\||\d?>)\s*/)[0]!.trim().slice(0, 40) || 'a command'

/** How a turn went, as one badge: tests failed › interrupted › tests passed › tool errors › done. */
export function outcome(e: EpisodeView): { icon: string; color: string; text: string } {
  if (e.tests.ran && e.tests.failed) return { icon: 'cross', color: K.rose, text: `${e.tests.failed} of ${e.tests.ran} checks failed` }
  if (e.interrupted) return { icon: 'pending', color: K.amber, text: 'Interrupted' }
  if (e.tests.ran) return { icon: 'check', color: K.emerald, text: 'Checks passed' }
  if (e.errors) return { icon: 'alert', color: K.amber, text: `${e.errors} tool error${e.errors === 1 ? '' : 's'}` }
  return { icon: 'check', color: K.silver, text: 'Done' }
}

/** A labelled line: icon, a short label and the text (cut to `n` characters unless open). */
function said(els: ElementTable, u: Kit, key: string, icon: string, color: string, label: string, text: string, open: boolean, n = 120): JSX.Element {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1} alignItems="flex-start">
      {u.Svg ? u.node(`${key}-n`, icon, color, 18) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={12}>
        <Text size="caption" weight="medium" color={K.muted}>{label}</Text>
        <Text color={K.text}>{open ? text : preview(text, n)}</Text>
      </Box>
    </Box>
  )
}

export function lastTurnCard($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, vw: ViewState, width: string): JSX.Element {
  const { Box, Text, Button } = els
  const e = s.episodes?.[0]
  if (!e) return u.card('last', width, [u.head('last-h', 'Last turn'), u.tag('last-none', 'turn', K.silver, 'Each reply adds a turn here: what you asked, what changed, how it went.')])
  const open = vw.expanded.includes(`last-${e.id}`)
  const res = outcome(e)
  const ask = e.ask || 'Follow-up turn (no new message from you)'
  const long = ask.length > 120 || e.done.length > 120 || e.next.length > 120
  return u.card('last', width, [
    <Box key="last-h" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center"><Text size="caption" weight="medium" color={K.label}>Last turn</Text>{t.badge('last-b', res.text, res.color)}</Box>
      <Text size="caption" color={K.muted}>{ago(minsSince(e.end))}</Text>
    </Box>,
    said(els, u, 'ls-ask', /^Background|^A side|^CI /.test(ask) ? 'spark' : 'turn', K.silver, /^Background|^A side|^CI /.test(ask) ? 'Started by' : 'You asked', ask, open),
    <Box key="ls-m" flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric('ls-f', 'file', e.files.length ? K.sage : K.silver, String(e.files.length), e.files.length === 1 ? 'file changed' : 'files changed', '40%')}
      {t.metric('ls-t', 'test', e.tests.ran ? (e.tests.failed ? K.rose : K.emerald) : K.silver, e.tests.ran ? `${e.tests.ran - e.tests.failed}/${e.tests.ran}` : '–', 'checks passed', '40%')}
      {t.metric('ls-c', 'commit', e.commits ? K.sage : K.silver, String(e.commits), e.commits === 1 ? 'commit' : 'commits', '40%')}
      {t.metric('ls-o', 'spark', K.silver, k(e.outTokens), 'tokens written', '40%')}
    </Box>,
    e.done ? said(els, u, 'ls-done', 'check', K.emerald, 'Done', e.done, open) : null,
    e.next ? said(els, u, 'ls-next', 'pending', K.amber, 'Next', e.next, open) : null,
    <Box key="ls-foot" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
      <Text size="caption" color={K.muted}>{e.commands.length ? `Ran ${[...new Set(e.commands.map(cmdLabel))].slice(0, 3).join(' · ')}${e.commands.length > 3 ? ` and ${e.commands.length - 3} more` : ''}` : 'No commands run'}</Text>
      {long ? <Button key="ls-more" plain onPress={() => { void toggleExpanded($, `last-${e.id}`) }}><Text size="caption" color={K.label}>{open ? 'Collapse' : 'Expand'}</Text></Button> : null}
    </Box>,
  ])
}

export function savingsCard(u: Kit, t: Tiles, s: StatusView, hit: number | null, waste: number, width: string): JSX.Element {
  return u.card('save', width, [
    u.head('save-h', 'Savings', 'this chat'),
    t.metric('sv-c', 'spark', K.emerald, '0', 'tokens Cortex adds to each message', '100%'),
    t.metric('sv-h', 'check', hit === null ? K.silver : hit < 50 ? K.amber : K.sage, hit !== null ? `${hit}%` : '–', 'of the last reply read from cache', '100%'),
    t.metric('sv-w', 'alert', waste >= 5000 ? K.amber : K.silver, waste ? k(waste) : '0', waste ? 'tokens per message for unused tools' : 'unused tools loaded', '100%'),
  ])
}

/** What a new chat will know after /cortex-resume, as counts, the last check, and what starting fresh costs. */
export function readyToSwitch($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, l: LiveView | null, key: string): (JSX.Element | null)[] {
  const { Box, Text, Button } = els
  const pv = s.handoff.preview
  if (!s.handoff.exists || !pv) return [u.tag(`${key}-none`, 'link', K.silver, 'The handoff appears after the first reply here.')]
  const cold = l?.context.tokens ?? 0
  const failed = /FAILED/i.test(pv.lastCheck)
  return [
    <Box key={`${key}-h`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center"><Text size="caption" weight="medium" color={K.label}>Ready to switch chats</Text>{t.badge(`${key}-b`, s.handoff.ready ? 'Resume ready' : 'Ready', K.emerald)}</Box>
      <Text size="caption" color={K.muted}>{`saved ${ago(minsSince(s.stateAt))}`}</Text>
    </Box>,
    <Text key={`${key}-ok`} size="caption" color={K.label}>A new chat with /cortex-resume will know:</Text>,
    <Box key={`${key}-g`} flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric(`${key}-m`, 'rule', K.emerald, k(s.native.alwaysTokens), 'memory tokens Claude loads itself', '40%')}
      {t.metric(`${key}-x`, 'turn', K.sage, String(pv.exchanges || 1), 'last exchanges, word for word', '40%')}
      {t.metric(`${key}-f`, 'file', K.silver, String(pv.files), pv.files === 1 ? 'active file' : 'active files', '40%')}
      {t.metric(`${key}-o`, 'pending', pv.openItems ? K.amber : K.silver, String(pv.openItems), pv.openItems === 1 ? 'open item' : 'open items', '40%')}
    </Box>,
    pv.lastCheck ? u.tag(`${key}-c`, failed ? 'cross' : 'test', failed ? K.rose : K.emerald, `Last check: ${pv.lastCheck}`, K.label) : null,
    <Box key={`${key}-t`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
        {t.badge(`${key}-tk`, `≈${k(pv.tokens)} tokens to start`, K.emerald)}
        {cold > 50_000 ? <Text size="caption" color={K.muted}>{`instead of re-reading ${k(cold)}`}</Text> : null}
      </Box>
      {key === 'or' ? <Button key="or-go" plain onPress={() => { void setTab($, 'data'); void setSub($, 'handoff') }}><Text size="caption" color={K.label}>See the handoff</Text></Button> : null}
    </Box>,
  ]
}
