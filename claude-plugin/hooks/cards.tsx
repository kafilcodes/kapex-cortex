import type { ElementTable } from 'claude-code'

import type { EpisodeView, LiveView, StatusView, ViewState } from '../types'
import { k } from './charts'
import { act, ago, handOff, minsSince, setFlow, setSub, setTab, toggleExpanded, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { illoHandoff } from './illos'
import { K } from './theme'
import { preview, type Tiles } from './tiles'

// The three Overview cards that used to be sentences, now structured: a status badge, small metrics and short
// labelled lines. Last turn · Savings · Ready to switch.

/** A command as you'd say it: no VAR=… or cd "…" && in front, no pipes or redirects after, at most 40 characters. */
export const cmdLabel = (c: string) => c.replace(/^(?:\s*[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S+)\s*;?\s*)+/, '').replace(/^cd\s+(?:"[^"]+"|'[^']+'|\S+)\s*&&\s*/, '').split(/\s*(?:&&|;|\||\d?>)\s*/)[0]!.trim().slice(0, 40) || 'a command'

/** How a turn went, as one badge: tests failed › interrupted › tests passed › tool errors › done. */
export function outcome(e: EpisodeView): { icon: string; color: string; text: string } {
  if (e.tests.ran && e.tests.failed && e.tests.lastOk) return { icon: 'check', color: K.emerald, text: `Checks passed · ${e.tests.failed} fixed` }
  if (e.tests.ran && e.tests.failed) return { icon: 'cross', color: K.rose, text: e.tests.lastOk === false ? 'Last check failed' : `${e.tests.failed} of ${e.tests.ran} checks failed` }
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
  // attachments (@"path") are file names, not what you asked
  const files = (e.ask.match(/@"[^"]*"|(?:^|\s)@[^\s]+/g) ?? []).length
  const words = e.ask.replace(/@"[^"]*"/g, ' ').replace(/(^|\s)@[^\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  const ask = words || (files ? `${files} attached file${files === 1 ? '' : 's'} (and pasted text)` : 'Follow-up turn (no new message from you)')
  const long = ask.length > 120 || e.done.length > 120 || e.next.length > 120
  return u.card('last', width, [
    <Box key="last-h" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center"><Text size="caption" weight="medium" color={K.label}>Last turn</Text>{t.badge('last-b', res.text, res.color)}</Box>
      <Text size="caption" color={K.muted}>{ago(minsSince(e.end))}</Text>
    </Box>,
    said(els, u, 'ls-ask', /^Background|^A side|^CI /.test(ask) ? 'spark' : 'turn', K.silver, /^Background|^A side|^CI /.test(ask) ? 'Started by' : 'You asked', ask, open),
    <Box key="ls-m" flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric('ls-f', 'file', e.files.length ? K.sage : K.silver, String(e.files.length), e.files.length === 1 ? 'file changed' : 'files changed', '40%')}
      {t.metric('ls-t', 'test', e.tests.ran ? (e.tests.failed && !e.tests.lastOk ? K.rose : K.emerald) : K.silver, e.tests.ran ? `${e.tests.ran - e.tests.failed}/${e.tests.ran}` : '–', 'check runs passed', '40%')}
      {t.metric('ls-c', 'commit', e.commits ? K.sage : K.silver, String(e.commits), e.commits === 1 ? 'commit' : 'commits', '40%')}
      {t.metric('ls-o', 'spark', K.silver, k(e.outTokens), 'tokens Claude wrote', '40%')}
    </Box>,
    e.done ? said(els, u, 'ls-done', 'check', K.emerald, 'Done', e.done, open) : null,
    e.next ? said(els, u, 'ls-next', 'pending', K.amber, 'Next', e.next, open) : null,
    // no summary from Claude (an interrupted turn, a limit): what changed is the next most useful thing to show
    !e.done && !e.next && e.files.length ? <Text key="ls-files" size="caption" color={K.muted}>{`Files: ${e.files.slice(0, 6).map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', ')}${e.files.length > 6 ? ` and ${e.files.length - 6} more` : ''}`}</Text> : null,
    // the footer follows the content: pinned to the bottom it left an empty band mid-card beside a taller card
    <Box key="ls-foot" flexDirection="column"><Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap">
      <Text size="caption" color={K.muted}>{e.commands.length ? `Ran ${e.commands.length} command${e.commands.length === 1 ? '' : 's'}${e.commands.length <= 2 ? `: ${[...new Set(e.commands.map(cmdLabel))].join(' · ')}` : ''}` : 'No commands run'}</Text>
      {long ? <Button key="ls-more" plain onPress={() => { void toggleExpanded($, `last-${e.id}`) }}><Text size="caption" color={K.label}>{open ? 'Collapse' : 'Expand'}</Text></Button> : null}
    </Box></Box>,
  ])
}

export function savingsCard(u: Kit, t: Tiles, s: StatusView, hit: number | null, waste: number, width: string, l?: LiveView | null): JSX.Element {
  // the same counts the Costs page shows: this chat's total from Claude Code's transcript, and what Cortex measurably saved
  const used = l?.sessionId ? s.spend?.sessions?.[l.sessionId] : undefined
  const saved = s.spend?.resumedContext ?? 0
  // compact rows (like Memory Claude loads), so the card stays as tall as its neighbours
  const { Box, Text } = u.els
  const row = (key: string, icon: string, color: string, label: string, value: string) => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>
      <Box flexShrink={1} minWidth={10}>{u.tag(`${key}-t`, icon, color, label, K.label)}</Box>
      <Text size="caption" weight="semibold" tabular color={color === K.silver ? K.text : color}>{value}</Text>
    </Box>
  )
  return u.card('save', width, [
    u.head('save-h', 'Savings', 'this chat'),
    row('sv-c', 'spark', (s.footprint?.duplicates ?? 0) ? K.amber : K.emerald, 'Cortex adds to each message', s.footprint ? `~${k(s.footprint.tokens)} tokens` : '–'),
    row('sv-h', 'check', hit === null ? K.silver : hit < 50 ? K.amber : K.sage, 'Last reply read from cache', hit !== null ? `${hit}%` : '–'),
    row('sv-w', 'alert', waste >= 5000 ? K.amber : K.silver, waste ? 'Unused tools, per message' : 'Unused tools loaded', waste ? k(waste) : '0'),
    row('sv-u', 'turn', K.silver, 'This chat used so far', used !== undefined ? k(used) : '–'),
    row('sv-s', 'save', saved ? K.emerald : K.silver, 'Saved by Cortex so far', k(saved)),
  ])
}

/** What a new chat will know after /cortex-resume, as counts, the last check, and what starting fresh costs. */
export function readyToSwitch($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, l: LiveView | null, key: string): (JSX.Element | null)[] {
  const { Box, Text, Button } = els
  const pv = s.handoff.preview
  if (!s.handoff.exists || !pv) return [u.illo(`${key}-none`, illoHandoff(150), 'No handoff yet', [<Text key={`${key}-none-t`} weight="semibold" color={K.text}>Ready to switch chats</Text>, u.muted(`${key}-none-d`, 'The handoff appears after the first reply here.')])]
  const cold = l?.context.tokens ?? 0
  const failed = /FAILED/.test(pv.lastCheck) // capitals only: "failed earlier and were fixed" is a pass
  const pinned = (pv.instructions ?? 0) + (pv.decisions ?? 0)
  const flagged = Math.max(pv.flagged ?? 0, toReview(s))
  const clean = (x?: string) => (x ?? '').replace(/^\(pasted\) /, '').replace(/^_|_$/g, '')
  return [
    <Box key={`${key}-h`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center"><Text size="caption" weight="medium" color={K.label}>Ready to switch chats</Text>{t.badge(`${key}-b`, s.handoff.ready ? 'Handoff ready' : 'Ready', K.emerald)}</Box>
      <Text size="caption" color={K.muted}>{`saved ${ago(minsSince(s.stateAt))}`}</Text>
    </Box>,
    pv.goal ? said(els, u, `${key}-goal`, 'star', K.emerald, 'Goal', clean(pv.goal), false, 110) : null,
    pv.next && !/^Continue from the last assistant message/.test(pv.next) ? said(els, u, `${key}-next`, 'pending', K.amber, 'Next', clean(pv.next), false, 110) : null,
    <Text key={`${key}-ok`} size="caption" color={K.label}>A new chat with /cortex-resume gets, in three parts:</Text>,
    <Box key={`${key}-g`} flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric(`${key}-p`, 'star', pinned ? K.emerald : K.silver, String(pinned), pinned === 1 ? 'instruction or decision' : 'instructions and decisions', '40%')}
      {t.metric(`${key}-tr`, 'commit', pv.trail ? K.sage : K.silver, String(pv.trail ?? 0), `earlier turn${pv.trail === 1 ? '' : 's'}${pv.commits ? ` · ${pv.commits} commit${pv.commits === 1 ? '' : 's'}` : ''}`, '40%')}
      {t.metric(`${key}-x`, 'turn', K.sage, String(pv.exchanges || 1), (pv.exchanges || 1) === 1 ? 'last exchange, word for word' : 'last exchanges, word for word', '40%')}
      {t.metric(`${key}-o`, 'pending', pv.openItems ? K.amber : K.silver, String(pv.openItems), `open item${pv.openItems === 1 ? '' : 's'} · ${pv.files} active file${pv.files === 1 ? '' : 's'}`, '40%')}
    </Box>,
    flagged ? u.tag(`${key}-mem`, 'alert', K.amber, `${flagged} memory note${flagged === 1 ? '' : 's'} flagged: the handoff tells the new chat not to rely on ${flagged === 1 ? 'it' : 'them'}`, K.label) : null,
    pv.lastCheck ? u.tag(`${key}-c`, failed ? 'cross' : 'test', failed ? K.rose : K.emerald, `Last check: ${pv.lastCheck}`, K.label) : null,
    <Box key={`${key}-t`} flexGrow={1} flexDirection="column" justifyContent="flex-end"><Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
        {t.badge(`${key}-tk`, `≈${k(pv.tokens)} tokens to start`, K.emerald)}
        {cold > 50_000 ? <Text size="caption" color={K.muted}>{`instead of re-reading ${k(cold)}`}</Text> : null}
      </Box>
      {key === 'or' ? <Box flexDirection="row" gap={1}>
        <Button key="or-go" variant="secondary" onPress={() => { void setTab($, 'data'); void setSub($, 'handoff') }}>See the handoff</Button>
        <Button key="or-hand" variant="secondary" onPress={() => { void (flagged ? setFlow($, 'confirm') : handOff($)) }}>Hand off now</Button>
      </Box> : null}
    </Box></Box>,
  ]
}
