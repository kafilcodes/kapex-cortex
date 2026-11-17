import type { ElementTable } from 'claude-code'

import type { LiveView, StatusView, Tab, ViewState } from '../types'
import { readyToSwitch } from './cards'
import { act, ago, handOff, minsSince, setFlow, setSub, setTab, type Dollar } from './data'
import { tidy } from './text'
import { flaggedNotes } from './switch'
import type { Kit } from './kit'
import { dreamBody } from './dream-tab'
import { filesBody } from './files-tab'
import { illoHandoff } from './illos'
import { sceneSvg } from './mascot'
import { GOLDFISH, K, RESUME } from './theme'
import { tiles } from './tiles'
import { companion } from './blocky'

// The Memory page (two sub-pages: Memory check, where Dreams and quick checks live, and Memory files) and the Handoff page.
export type Ctx = {
  els: ElementTable
  u: Kit
  s: StatusView
  l: LiveView | null
  current: Tab
  wip: { ref: string; sha: string; at: string } | null | undefined
  five: LiveView['limits'][number] | undefined
  px: number
  vw: ViewState
}
export const SUBS = ['dream', 'files'] as const
const FROM: Record<string, string> = { 'claude-code': 'Claude Code', opencode: 'OpenCode', hermes: 'Hermes' }

export function dataPage($: Dollar, o: Ctx): JSX.Element {
  const { s, u, vw } = o
  const { Box } = o.els
  const t = tiles($, o.els, u, vw.expanded, o.px)
  const sub = (SUBS as readonly string[]).includes(vw.sub) ? vw.sub : 'dream'
  // quieter than the top tabs (smaller, in one track), so they read as two views of one page; no counts
  const nav = t.seg('subnav', [['dream', 'Memory check'], ['files', 'Memory files']], sub, x => { void setSub($, x) })
  const body = sub === 'files' ? filesBody($, o.els, u, s, vw, o.px) : dreamBody($, o.els, u, s, vw, o.px)
  return <Box flexDirection="column" gap={1}>{nav}{body}</Box>
}

/** The Handoff page: your place, saved so a new chat can pick it up. */
export function handoffPage($: Dollar, o: Ctx): JSX.Element {
  const { s, wip, u, vw } = o
  const { Box, Text, Button } = o.els
  const t = tiles($, o.els, u, vw.expanded, o.px)
  const hv = s.history
  return (
      <Box flexDirection="column" gap={1}>
        {u.intro('h-in', sceneSvg('handoff', 110), 'Cortex handing its note to Blocky, who picks the work up next', 'Handoff: your place, saved so a new chat can pick it up', 'Cortex saves it after every reply. Type /cortex-resume in a new chat and Claude carries on from here.', companion('happy', o.px))}
        {u.card('h-ready', '100%', readyToSwitch($, o.els, u, t, s, o.l, 'hr'), K.emerald)}
        <Box key="h-act" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={1} rowGap={1}>
          {u.tag('h1', 'link', K.emerald, 'Hand off now saves it and copies /cortex-resume to paste in a new chat', K.label)}
          <Box flexDirection="row" gap={1}>
            <Button key="kc-resume" variant="secondary" onPress={() => { void $.prompt.submit({ text: RESUME }) }}>← Load into this chat</Button>
            <Button key="kc-hand2" variant="secondary" onPress={() => { void act($, 'Handoff saved', ['h']) }}>↓ Save now</Button>
            <Button key="kc-hand3" variant="primary" onPress={() => { void setTab($, 'overview'); void (flaggedNotes(s) ? setFlow($, 'confirm') : handOff($)) }}>Hand off now →</Button>
          </Box>
        </Box>
        {u.card('h-fish', '100%', [
          <Box key="h-fish-r" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1} flexWrap="nowrap">
            <Box flexDirection="row" columnGap={2} alignItems="center" flexGrow={1} flexShrink={1} minWidth={24} flexWrap="nowrap">
              {u.Svg && o.px >= 560 ? <Box key="h-fish-m" flexShrink={0}>{u.graphic('h-fish-n', sceneSvg('fresh', 96), 'Cortex reading the handoff through a magnifying glass')}</Box> : u.node('h-fish-n', 'lesson', K.sage, 22)}
              <Box flexDirection="column" gap={0} flexShrink={1}>
                <Text weight="semibold" color={K.text}>Check with fresh eyes</Text>
                <Text size="caption" color={K.label}>A helper that never saw this chat reads only the handoff and says where it would get stuck. About 20–50k tokens, once.</Text>
              </Box>
            </Box>
            <Box flexShrink={0}><Button key="kc-fish" variant="secondary" onPress={() => { void $.prompt.submit({ text: GOLDFISH }) }}>Check now</Button></Box>
          </Box>,
        ])}
        {u.card('h-git', '100%', [
          u.head('h-git-h', 'Your code right now', s.git ? `on ${s.git.branch}` : undefined),
          s.git ? (
            <Box key="h-git-m" flexDirection="row" gap={1} flexWrap="wrap">
              {t.metric('hg-d', 'file', s.git.dirty ? K.amber : K.silver, String(s.git.dirty), 'changed files in git', '26%')}
              {t.metric('hg-u', 'file', K.silver, String(s.git.untracked), 'new files, not in git yet', '26%')}
              {t.metric('hg-w', 'save', wip ? K.emerald : K.silver, wip ? `Saved ${ago(minsSince(wip.at))}` : 'Not yet', wip ? `snapshot of your changes · commit ${wip.sha.slice(0, 7)}` : 'no snapshot of your changes yet', '26%')}
            </Box>
          ) : u.muted('h-nogit', 'Not a git repo.'),
          u.muted('h3', 'Hit a usage limit? Type /cortex-resume in OpenCode to carry on with a free model.'),
        ])}
        {!hv || (!hv.states.length && !hv.wips.length) ? u.illo('hh-none', illoHandoff(170), 'No handoffs yet', [<Text key="hh-none-t" weight="semibold" color={K.text}>No earlier handoffs yet</Text>, u.muted('hh-none-d', 'Each chat that ends here leaves one.')]) : (
          <Box key="hh" flexDirection="column" gap={1}>
            {t.groupHead('hh-t', 'link', K.emerald, 'Earlier handoffs', String(hv.states.length))}
            {t.stack('hh-l', hv.states.map((x, i) => t.tile({
              id: `hs-${x.session}`, icon: 'link', color: i === 0 ? K.emerald : K.silver, lead: { kind: 'handoff', alt: i === 0 ? 'The latest handoff between chats' : 'An earlier handoff between chats', muted: i > 0 }, title: (x.chat ? tidy(x.chat, 100) : '') || tidy(x.goal, 100, vw.expanded.includes(`hs-${x.session}`)) || 'No goal written down', preview: x.chat && x.goal ? tidy(x.goal, 140, vw.expanded.includes(`hs-${x.session}`)) : undefined, time: ago(minsSince(x.at)), wrap: true,
              badges: [[`from ${FROM[x.from] ?? (x.from || 'another tool')}`], i === 0 ? ['Latest', K.emerald] : null, hv.wips.find(w => w.session === x.session) ? [`snapshot ${hv.wips.find(w => w.session === x.session)!.sha.slice(0, 7)}`] : null],
              body: [<Text key={`hss-${x.session}`} size="caption" color={K.muted}>{`Chat id ${x.session.slice(0, 12)}`}</Text>],
            })))}
          </Box>
        )}
      </Box>
  )
}
