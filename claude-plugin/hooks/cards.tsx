import type { ElementTable } from 'claude-code'

import type { EpisodeView, LiveView, StatusView, ViewState } from '../types'
import { k } from './charts'
import { ago, animateFor, handOff, minsSince, setFlow, setTab, toggleExpanded, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { illoHandoff } from './illos'
import { K } from './theme'
import { type Tiles } from './tiles'
import { tidy } from './text'
import { turnDots } from './viz-more'

// Overview's two "where you are" cards, and the handoff's contents for the Handoff page. Each fact has one home:
// the last turn says what happened, the Handoff card is the only place Overview talks about the handoff.

/** A command as you'd say it: no VAR=… or cd "…" && in front, no pipes or redirects after, at most 40 characters. */
export const cmdLabel = (c: string) => c.replace(/^(?:\s*[A-Za-z_]\w*=(?:"[^"]*"|'[^']*'|\S+)\s*;?\s*)+/, '').replace(/^cd\s+(?:"[^"]+"|'[^']+'|\S+)\s*&&\s*/, '').split(/\s*(?:&&|;|\||\d?>)\s*/)[0]!.trim().slice(0, 40) || 'a command'

/** A turn with no message of yours (Claude went on after a background task or a check): said plainly. */
export const NO_ASK = 'Claude continued on its own'

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
function said(els: ElementTable, u: Kit, key: string, icon: string, color: string, label: string, text: string, open: boolean, n = 120, quiet = false): JSX.Element {
  const { Box, Text } = els
  return (
    <Box key={key} flexDirection="row" gap={1} alignItems="flex-start">
      {u.Svg ? u.node(`${key}-n`, icon, color, 18) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={12}>
        <Text size="caption" weight="medium" color={K.muted}>{label}</Text>
        <Text color={quiet ? K.label : K.text} size={quiet ? 'caption' : undefined}>{tidy(text, n, open)}</Text>
      </Box>
    </Box>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The last dozen turns as coloured squares (oldest left, newest right) and a caption that counts them. */
function recentTurns(els: ElementTable, u: Kit, s: StatusView, px: number): JSX.Element | null {
  const { Box, Text } = els
  const eps = (s.episodes ?? []).slice(0, 12)
  if (eps.length < 2 || !u.Svg) return null
  const res = eps.map(outcome)
  const n = (f: (r: { color: string; text: string }) => boolean) => res.filter(f).length
  const parts = ([[n(r => r.color === K.emerald), 'passed'], [n(r => r.color === K.rose), 'failed'], [n(r => r.text === 'Interrupted'), 'interrupted'], [n(r => r.color === K.amber && r.text !== 'Interrupted'), 'with tool errors'], [n(r => r.color === K.silver), 'without checks']] as [number, string][]).filter(([c]) => c).map(([c, w]) => `${c} ${w}`)
  return (
    <Box key="ls-strip" flexDirection="column" gap={0}>
      {u.graphic('g-turns', turnDots({ size: Math.max(13, Math.min(20, Math.floor((px - 5 * 11) / 12))), items: eps.map((e, i) => ({ color: res[i]!.color, title: `${ago(minsSince(e.end))}: ${res[i]!.text}` })).reverse(), animate: animateFor('turns', eps.map(e => e.id).join(',')) }), `Your last ${eps.length} turns: ${parts.join(', ')}`)}
      <Text size="caption" color={K.muted}>{`Last ${eps.length} turns, newest on the right: ${parts.join(', ')}`}</Text>
    </Box>
  )
}

export function lastTurnCard($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, vw: ViewState, width: string, px = 400): JSX.Element {
  const { Box, Text, Button } = els
  const e = s.episodes?.[0]
  if (!e) return u.card('last', width, [u.head('last-h', 'Last turn'), u.tag('last-none', 'turn', K.silver, 'After each reply: what you asked, what changed and how it went.')])
  const open = vw.expanded.includes(`last-${e.id}`)
  const res = outcome(e)
  // attachments (@"path") are file names, not what you asked
  const files = (e.ask.match(/@"[^"]*"|(?:^|\s)@[^\s]+/g) ?? []).length
  const words = tidy(e.ask, 400, true)
  const auto = !words && !files
  const ask = words || (files ? `${plural(files, 'attached file')} (and pasted text)` : NO_ASK)
  const long = [ask, e.done, e.next].some(x => !!x && tidy(x, 120) !== tidy(x, 120, true))
  const side = /^Background|^A side|^CI /.test(ask)
  // what the turn changed, as one quiet line of facts (the four boxes this used to be said no more than this)
  const facts: ([string, string, string] | null)[] = [
    e.files.length ? ['file', K.silver, `${plural(e.files.length, 'file')} changed`] : null,
    // the badge says how the checks went; the facts only count them (one number, one wording)
    e.tests.ran ? ['test', K.silver, `${plural(e.tests.ran, 'check')} run`] : null,
    e.commits ? ['commit', K.silver, plural(e.commits, 'commit')] : null,
  ]
  return u.card('last', width, [
    <Box key="last-h" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center"><Text weight="semibold" color={K.text}>Last turn</Text>{t.badge('last-b', res.text, res.color, res.icon)}</Box>
      <Text size="caption" color={K.muted}>{ago(minsSince(e.end))}</Text>
    </Box>,
    auto ? null : said(els, u, 'ls-ask', side ? 'spark' : 'turn', K.silver, side ? 'Started by' : 'You asked', ask, open),
    e.done ? said(els, u, 'ls-done', 'check', K.emerald, auto ? `${NO_ASK}, and finished with` : 'Claude did', e.done, open) : auto ? u.tag('ls-auto', 'turn', K.silver, NO_ASK, K.label) : null,
    e.next ? said(els, u, 'ls-next', 'pending', K.amber, 'Next', e.next, open) : null,
    // no summary from Claude (an interrupted turn, a limit): what changed is the next most useful thing to show
    !e.done && !e.next && e.files.length ? <Text key="ls-files" size="caption" color={K.muted}>{`Files: ${e.files.slice(0, 6).map(f => f.split(/[\\/]/).slice(-2).join('/')).join(', ')}${e.files.length > 6 ? ` and ${e.files.length - 6} more` : ''}`}</Text> : null,
    // the facts sit at the bottom edge, like the buttons of the card beside it
    <Box key="ls-foot" flexGrow={1} flexDirection="column" justifyContent="flex-end" gap={1}>{recentTurns(els, u, s, px)}<Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
      <Box flexDirection="row" columnGap={2} rowGap={0} flexWrap="wrap" flexShrink={1}>
        {facts.some(Boolean) ? facts.filter((f): f is [string, string, string] => !!f).map(([ic, c, text]) => u.tag(`ls-f-${ic}`, ic, c, text, K.label)) : u.tag('ls-f-none', 'turn', K.silver, 'No files changed', K.muted)}
      </Box>
      {long ? <Box flexGrow={1} flexDirection="row" justifyContent="flex-end"><Button key="ls-more" plain onPress={() => { void toggleExpanded($, `last-${e.id}`) }}><Text size="caption" color={K.label}>{open ? 'Show less' : 'Show all'}</Text></Button></Box> : null}
    </Box></Box>,
  ])
}


/** Overview's Handoff card: is it saved, what a new chat costs to start, what it carries. `offered` = the headline
 * above already asks to hand off, so this card doesn't repeat the button. */
export function handoffCard($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, l: LiveView | null, width: string, offered: boolean, art = false): JSX.Element {
  const { Box, Text, Button } = els
  const pv = s.handoff.preview
  if (!s.handoff.exists || !pv) return u.card('ready', width, [u.illo('or-none', illoHandoff(150), 'No handoff yet', [<Text key="or-none-t" weight="semibold" color={K.text}>Handoff</Text>, u.muted('or-none-d', 'After the first reply here, Cortex saves where you are, so a new chat can pick it up.')])])
  const here = l?.context.tokens ?? 0
  const pinned = (pv.instructions ?? 0) + (pv.decisions ?? 0)
  const flagged = Math.max(pv.flagged ?? 0, toReview(s))
  const carries = [pinned ? plural(pinned, 'instruction or decision', 'instructions and decisions') : '', (pv.exchanges || 1) === 1 ? 'the last exchange word for word' : `the last ${pv.exchanges} exchanges word for word`, pv.files ? `${plural(pv.files, 'file')} in progress` : ''].filter(Boolean)
  const list = carries.length > 1 ? `${carries.slice(0, -1).join(', ')} and ${carries[carries.length - 1]}` : carries[0]
  return u.card('ready', width, [
    <Box key="or-h" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Text weight="semibold" color={K.text}>Handoff</Text>
      {t.badge('or-b', `Saved ${ago(minsSince(s.stateAt))}`, K.emerald, 'check')}
    </Box>,
    // the chat it came from, its goal, the number and what it carries; the hand-over drawing beside them when wide
    <Box key="or-main" flexDirection="row" alignItems="center" columnGap={2} flexWrap="nowrap">
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={20}>
        {s.handoff.chat || pv.goal ? <Box key="or-from" flexDirection="column" gap={0}>
          <Text weight="medium" color={K.text}>{s.handoff.chat ? `From “${tidy(s.handoff.chat, 70)}”` : tidy(pv.goal, 110)}</Text>
          {s.handoff.chat && pv.goal ? <Text size="caption" color={K.label}>{`Goal: ${tidy(pv.goal, 110)}`}</Text> : null}
        </Box> : null}
        <Box key="or-kpi" flexDirection="row" alignItems="center" columnGap={1} rowGap={0} flexWrap="wrap">
          <Text size="heading" weight="semibold" tabular color={K.text}>{`≈${k(pv.tokens)}`}</Text>
          <Box flexShrink={1} minWidth={16}><Text size="caption" color={K.label}>{`tokens to start a new chat${here > 50_000 ? `, instead of re-reading ${k(here)} here` : ''}`}</Text></Box>
        </Box>
        <Text key="or-carry" size="caption" color={K.label}>{`Carries ${list}.`}</Text>
      </Box>
      {art && u.Svg ? <Box key="or-art" flexShrink={0}>{u.graphic('g-handoff', illoHandoff(130), 'A full chat handing a small packet to a fresh one')}</Box> : null}
    </Box>,
    flagged ? u.tag('or-mem', 'alert', K.amber, `${plural(flagged, 'memory note')} flagged: the new chat is told not to rely on ${flagged === 1 ? 'it' : 'them'}`, K.label) : null,
    <Box key="or-t" flexGrow={1} flexDirection="column" justifyContent="flex-end"><Box flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
      <Button key="or-go" variant="secondary" onPress={() => { void setTab($, 'handoff') }}>See what's saved</Button>
      {offered ? null : <Button key="or-hand" variant="secondary" onPress={() => { void (flagged ? setFlow($, 'confirm') : handOff($)) }}>Hand off now</Button>}
    </Box></Box>,
  ])
}

/** The Handoff page: what a new chat will know after /cortex-resume, as counts, the last check, and what starting fresh costs. */
export function readyToSwitch($: Dollar, els: ElementTable, u: Kit, t: Tiles, s: StatusView, l: LiveView | null, key: string): (JSX.Element | null)[] {
  const { Box, Text } = els
  const pv = s.handoff.preview
  if (!s.handoff.exists || !pv) return [u.illo(`${key}-none`, illoHandoff(150), 'No handoff yet', [<Text key={`${key}-none-t`} weight="semibold" color={K.text}>No handoff yet</Text>, u.muted(`${key}-none-d`, 'It appears after the first reply here.')])]
  const here = l?.context.tokens ?? 0
  const failed = /FAILED/.test(pv.lastCheck) // capitals only: "failed earlier and were fixed" is a pass
  const pinned = (pv.instructions ?? 0) + (pv.decisions ?? 0)
  const flagged = Math.max(pv.flagged ?? 0, toReview(s))
  return [
    <Box key={`${key}-h`} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
      <Text weight="semibold" color={K.text}>What a new chat gets</Text>
      {t.badge(`${key}-b`, `Saved ${ago(minsSince(s.stateAt))}`, K.emerald, 'check')}
    </Box>,
    s.handoff.chat ? <Text key={`${key}-from`} weight="medium" color={K.text}>{`From “${tidy(s.handoff.chat, 80)}”`}</Text> : null,
    pv.goal ? said(els, u, `${key}-goal`, 'star', K.emerald, 'Goal', pv.goal, false, 140) : null,
    pv.next && !/^Continue from the last assistant message/.test(pv.next) ? said(els, u, `${key}-next`, 'pending', K.amber, 'Next', pv.next, false, 140) : null,
    <Box key={`${key}-g`} flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric(`${key}-p`, 'star', pinned ? K.emerald : K.silver, String(pinned), pinned === 1 ? 'instruction or decision of yours' : 'of your instructions and decisions', '40%')}
      {t.metric(`${key}-x`, 'turn', K.sage, String(pv.exchanges || 1), (pv.exchanges || 1) === 1 ? 'last exchange, word for word' : 'last exchanges, word for word', '40%')}
      {t.metric(`${key}-tr`, 'commit', pv.trail ? K.sage : K.silver, String(pv.trail ?? 0), `earlier turn${pv.trail === 1 ? '' : 's'}, in short${pv.commits ? ` · ${plural(pv.commits, 'commit')}` : ''}`, '40%')}
      {t.metric(`${key}-o`, 'file', pv.files ? K.sage : K.silver, String(pv.files), `file${pv.files === 1 ? '' : 's'} in this handoff${pv.openItems ? ` · ${plural(pv.openItems, 'open item')}` : ''}`, '40%')}
    </Box>,
    flagged ? u.tag(`${key}-mem`, 'alert', K.amber, `${plural(flagged, 'memory note')} flagged: the new chat is told not to rely on ${flagged === 1 ? 'it' : 'them'}`, K.label) : null,
    pv.lastCheck ? u.tag(`${key}-c`, failed ? 'cross' : 'test', failed ? K.rose : K.emerald, `Last check: ${pv.lastCheck}`, K.label) : null,
    <Box key={`${key}-t`} flexDirection="row" alignItems="center" columnGap={1} rowGap={0} flexWrap="wrap">
      {t.badge(`${key}-tk`, `≈${k(pv.tokens)} tokens to start`, K.emerald)}
      {here > 50_000 ? <Text size="caption" color={K.muted}>{`instead of re-reading ${k(here)} here`}</Text> : null}
    </Box>,
  ]
}
