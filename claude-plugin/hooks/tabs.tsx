import type { ElementTable } from 'claude-code'

import type { AskView, LiveView, StatusView, Tab, ViewState } from '../types'
import { handoffTop } from './handoff-top'
import { ago, minsSince, setSub, type Dollar } from './data'
import { tidy } from './text'
import type { Kit } from './kit'
import { dreamBody } from './dream-tab'
import { filesBody } from './files-tab'
import { illoHandoff } from './illos'
import { chainSvg } from './handoff-art'
import { k } from './charts'
import { pageScene } from './mascot'
import { K } from './theme'
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
  /** a panel prompt waiting for your choice (ask.tsx) */
  asked?: AskView | null
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
  const body = sub === 'files' ? filesBody($, o.els, u, s, vw, o.px) : dreamBody($, o.els, u, s, vw, o.px, o.asked ?? null)
  return <Box flexDirection="column" gap={1}>{nav}{body}</Box>
}

/** The Handoff page: your place, saved so a new chat can pick it up. */
export function handoffPage($: Dollar, o: Ctx): JSX.Element {
  const { s, wip, u, vw } = o
  const { Box, Text } = o.els
  const t = tiles($, o.els, u, vw.expanded, o.px)
  const hv = s.history
  // an earlier handoff, opened: the chain of chats around it, what that chat did, and what its note carries
  const earlier = (x: NonNullable<typeof hv>['states'][number]) => {
    const id = x.session, w = x.work, pinned = [x.rules ? `${x.rules} instruction${x.rules === 1 ? '' : 's'}` : '', x.decisions ? `${x.decisions} decision${x.decisions === 1 ? '' : 's'}` : '', x.files ? `${x.files} file${x.files === 1 ? '' : 's'} named` : ''].filter(Boolean)
    return [
      u.graphic(`hsc-${id}`, chainSvg({ prev: x.continues ? { chat: x.continues.chat, id: x.continues.session } : undefined, here: { chat: x.chat ?? '', id, turns: w?.turns ?? 0 }, note: pinned.slice(0, 2).join(' · ') || 'goal and last replies', next: x.pickedUp?.map(c => ({ chat: c.chat, id: c.session })), width: Math.max(300, Math.min(760, o.px - 110)) }),
        `${x.continues ? `Continued “${x.continues.chat || x.continues.session.slice(0, 8)}”` : 'Started fresh'}; ${x.pickedUp?.length ? `picked up by ${x.pickedUp.map(c => `“${c.chat || c.session.slice(0, 8)}”`).join(', ')}` : 'not picked up yet'}`),
      w ? t.stats(`hsw-${id}`, [
        { icon: 'turn', value: String(w.turns), label: w.turns === 1 ? 'reply' : 'replies' },
        { icon: 'commit', value: String(w.commits), label: w.commits === 1 ? 'commit' : 'commits' },
        { icon: 'file', value: String(w.files), label: w.files === 1 ? 'file changed' : 'files changed' },
        w.ran ? { icon: 'test', value: `${w.ran - w.failed} of ${w.ran}`, label: 'checks passed', color: w.failed ? K.amber : K.emerald } : { icon: 'test', value: 'none', label: 'checks run' },
        { icon: 'spark', value: k(w.out), label: 'tokens Claude wrote' },
      ]) : null,
      x.next ? u.tag(`hsn-${id}`, 'pending', K.amber, `Next: ${tidy(x.next, 200)}`, K.label) : null,
      x.lastCheck ? u.tag(`hsk-${id}`, /FAILED/.test(x.lastCheck) ? 'cross' : 'test', /FAILED/.test(x.lastCheck) ? K.rose : K.emerald, `Last check: ${x.lastCheck}`, K.label) : null,
      pinned.length ? u.tag(`hsp-${id}`, 'star', K.emerald, `The note pins ${pinned.join(' · ')}`, K.label) : null,
      <Text key={`hss-${id}`} size="caption" color={K.muted}>{`Chat id ${id}${x.continues ? ` · continued ${x.continues.session.slice(0, 8)}` : ''}`}</Text>,
    ]
  }
  const froms = new Set((hv?.states ?? []).map(x => FROM[x.from] ?? (x.from || 'another tool')))
  const oneFrom = (hv?.states.length ?? 0) > 1 && froms.size === 1 ? [...froms][0]! : null
  return (
      <Box flexDirection="column" gap={1}>
        {u.intro('h-in', pageScene('handoff', 110), 'Cortex handing its note to Blocky, who picks the work up next', 'Handoff: your place, saved so a new chat can pick it up', 'Cortex saves it after every reply. Type /cortex-resume in a new chat and Claude carries on from here.', companion('happy', o.px))}
        {handoffTop($, o, o.asked ?? null)}
        {u.card('h-git', '100%', [
          u.head('h-git-h', 'Your code right now', s.git ? `on ${s.git.branch}` : undefined),
          // one light row of figures (no boxes: the card is the container), then one sentence on what it means
          s.git ? t.stats('h-git-m', [
            { icon: 'file', value: String(s.git.dirty), label: s.git.dirty === 1 ? 'changed file' : 'changed files', color: s.git.dirty ? K.amber : undefined },
            { icon: 'file', value: String(s.git.untracked), label: s.git.untracked === 1 ? 'new file, not in git' : 'new files, not in git' },
            { icon: 'save', value: wip ? ago(minsSince(wip.at)) : 'none', label: wip ? `last snapshot · ${wip.sha.slice(0, 7)}` : 'snapshot of your changes', color: wip ? K.emerald : undefined },
          ]) : u.muted('h-nogit', 'Not a git repo.'),
          s.git ? u.tag('h-git-say', s.git.dirty + s.git.untracked ? 'pending' : 'check', s.git.dirty + s.git.untracked ? K.amber : K.emerald,
            s.git.dirty + s.git.untracked ? 'Uncommitted work: each handoff snapshots it (refs/cortex/wip), so a new chat can see exactly what changed.' : 'Everything is committed: a new chat starts from a clean tree.', K.label) : null,
          u.muted('h3', 'Hit a usage limit? Type /cortex-resume in OpenCode to carry on with a free model.'),
        ])}
        {!hv || (!hv.states.length && !hv.wips.length) ? u.illo('hh-none', illoHandoff(170), 'No handoffs yet', [<Text key="hh-none-t" weight="semibold" color={K.text}>No earlier handoffs yet</Text>, u.muted('hh-none-d', 'Each chat that ends here leaves one.')]) : (
          <Box key="hh" flexDirection="column" gap={1}>
            {/* say it once: when every handoff came from one tool, the head names it and the rows don't repeat it */}
            {t.groupHead('hh-t', 'link', K.emerald, 'Earlier handoffs', String(hv.states.length), oneFrom ? <Text key="hh-from" size="caption" color={K.muted}>{`all from ${oneFrom}`}</Text> : null)}
            {t.rows('hh-l', hv.states.map((x, i) => t.tile({
              flat: true, id: `hs-${x.session}`, icon: 'link', color: i === 0 ? K.emerald : K.silver, lead: { kind: 'handoff', alt: i === 0 ? 'The latest handoff between chats' : 'An earlier handoff between chats', muted: i > 0 }, title: (x.chat ? tidy(x.chat, 100) : '') || tidy(x.goal, 100, vw.expanded.includes(`hs-${x.session}`)) || 'No goal written down', preview: x.chat && x.goal ? tidy(x.goal, 140, vw.expanded.includes(`hs-${x.session}`)) : undefined, time: ago(minsSince(x.at)), wrap: true,
              badges: [oneFrom ? null : [`from ${FROM[x.from] ?? (x.from || 'another tool')}`], i === 0 ? ['Latest', K.emerald] : null, hv.wips.find(w => w.session === x.session) ? [`snapshot ${hv.wips.find(w => w.session === x.session)!.sha.slice(0, 7)}`] : null],
              body: earlier(x),
            })))}
          </Box>
        )}
      </Box>
  )
}
