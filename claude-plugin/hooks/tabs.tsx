import type { ElementTable } from 'claude-code'

import type { LiveView, StatusView, Tab, ViewState } from '../types'
import { readyToSwitch } from './cards'
import { act, ago, minsSince, setSub, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { dreamBody } from './dream-tab'
import { filesBody } from './files-tab'
import { detailsBody } from './tabs-more'
import { illoHandoff } from './illos'
import { K, RESUME } from './theme'
import { tiles } from './tiles'

// The "Dream & Memory" page: sub-pages Dream · Memory files · Handoff · Costs.
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
export const SUBS = ['dream', 'files', 'handoff', 'details'] as const

export function dataPage($: Dollar, o: Ctx): JSX.Element {
  const { s, wip, u, vw } = o
  const { Box, Text, Button } = o.els
  const t = tiles($, o.els, u, vw.expanded)
  const sub = (SUBS as readonly string[]).includes(vw.sub) ? vw.sub : 'dream'
  const waiting = toReview(s)
  const label: Record<string, string> = { dream: waiting ? `Dream · ${waiting}` : 'Dream', files: `Memory files · ${s.native.files.length}`, handoff: 'Handoff', details: 'Costs' }
  const nav = t.seg('subnav', SUBS.map(x => [x, label[x]!] as [string, string]), sub, x => { void setSub($, x) })
  let body: JSX.Element
  if (sub === 'dream') {
    body = dreamBody($, o.els, u, s, vw)
  } else if (sub === 'handoff') {
    const hv = s.history
    body = (
      <Box flexDirection="column" gap={1}>
        {u.card('h-ready', '100%', readyToSwitch($, o.els, u, t, s, o.l, 'hr'), K.emerald)}
        <Box key="h-act" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={1} rowGap={1}>
          {u.tag('h1', 'link', s.handoff.ready ? K.amber : K.emerald, `Saved after every reply${s.handoff.from ? ` · last from ${s.handoff.from}` : ''}`, K.label)}
          <Box flexDirection="row" gap={1}>
            <Button key="kc-hand2" onPress={() => { void act($, 'Handoff saved', ['h']) }}>Save now</Button>
            <Button key="kc-resume" variant="primary" onPress={() => { void $.prompt.submit({ text: RESUME }) }}>Resume here</Button>
          </Box>
        </Box>
        {u.card('h-git', '100%', [
          u.head('h-git-h', 'Code state', s.git ? s.git.branch : undefined),
          s.git ? (
            <Box key="h-git-m" flexDirection="row" gap={1} flexWrap="wrap">
              {t.metric('hg-d', 'file', s.git.dirty ? K.amber : K.silver, String(s.git.dirty), 'changed files', '26%')}
              {t.metric('hg-u', 'file', K.silver, String(s.git.untracked), 'untracked', '26%')}
              {t.metric('hg-w', 'save', wip ? K.emerald : K.silver, wip ? wip.sha.slice(0, 7) : '–', wip ? `snapshot ${ago(minsSince(wip.at))}` : 'no snapshot yet', '26%')}
            </Box>
          ) : u.muted('h-nogit', 'Not a git repo.'),
          u.muted('h3', 'Usage limit? Type /cortex-resume in OpenCode (free models work).'),
        ])}
        {!hv || (!hv.states.length && !hv.wips.length) ? u.illo('hh-none', illoHandoff(170), 'No handoffs yet', [<Text key="hh-none-t" weight="semibold" color={K.text}>No earlier handoffs yet</Text>, u.muted('hh-none-d', 'Each chat that ends here leaves one.')]) : (
          <Box key="hh" flexDirection="column" gap={1}>
            {t.groupHead('hh-t', 'link', K.emerald, 'Recent handoffs', String(hv.states.length))}
            {t.stack('hh-l', hv.states.map((x, i) => t.tile({
              id: `hs-${x.session}`, icon: 'link', color: i === 0 ? K.emerald : K.silver, title: x.goal || 'No goal written down', time: ago(minsSince(x.at)), wrap: true,
              badges: [[x.from || 'unknown tool'], i === 0 ? ['latest', K.emerald] : null, hv.wips.find(w => w.session === x.session) ? [`snapshot ${hv.wips.find(w => w.session === x.session)!.sha.slice(0, 7)}`] : null],
              body: [<Text key={`hss-${x.session}`} size="caption" color={K.muted}>{`Session ${x.session.slice(0, 12)}`}</Text>],
            })))}
          </Box>
        )}
      </Box>
    )
  } else if (sub === 'details') body = detailsBody($, o, t)
  else body = filesBody($, o.els, u, s, vw, o.px)
  return <Box flexDirection="column" gap={1}>{nav}{body}</Box>
}
