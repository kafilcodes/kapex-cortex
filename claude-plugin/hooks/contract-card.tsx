import type { ElementTable } from 'claude-code'

import type { ContractView, StepView, ViewState } from '../types'
import { act, toggleGroup, type Dollar } from './data'
import type { Kit } from './kit'
import { blocky } from './blocky'
import { iconPaths } from './icons'
import { tidy } from './text'
import { esc, FONT, K, textWidth } from './theme'

// The mission on the Handoff page (v4.6, the Stageshow pass): what you asked for, item by item, and how far it got.
//   hero      one ring with one number (steps done), the north star as the title, one plain line on how it works
//   left      the open steps first, in your order, each with Done (you need no proof)
//   done      folded into "5 done", newest first, each with what its tick rests on (verified, check failing, not
//             verified, ticked by you) and Undo
//   rules     your binding rules, one line folded: "16 of your rules carry over · Show"
//   close     only when every step is done: one press closes the mission (its rules stop binding)
// Steps come from the mission's own record (status → handoff.preview.contract), so a tick shows at once.

const KIND: Record<string, string> = { never: 'Never', must: 'Always', 'skill/workflow': 'Workflow', decision: 'Decided' }
const PROOF: Record<string, { color: string; ink: string; word: string; icon: string }> = {
  verified: { color: K.emerald, ink: 'success', word: 'Verified', icon: 'check' },
  failing: { color: K.rose, ink: 'error', word: 'Check failing', icon: 'cross' },
  unverified: { color: '#D97706', ink: 'warning', word: 'Not verified', icon: 'pending' },
  you: { color: K.silver, ink: K.label, word: 'Ticked by you', icon: 'check' },
}

/** One track and one arc, round caps; the number of steps done in the middle, centred on its digits, "of 8" under it.
 * Drawn in emerald: a drawing can't follow the theme's text colour, and emerald reads on light and dark alike. */
export function stepRing(done: number, total: number, size = 64, closed = false): string {
  const r = size / 2 - 5, c = 2 * Math.PI * r, share = total ? done / total : 0, n = String(done), sub = `of ${total}`
  const col = closed || (total && done === total) ? K.emerald : K.sage
  const nw = textWidth(n, 20, 650), sw = textWidth(sub, 10)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><title>${esc(`${done} of ${total} steps done`)}</title>`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(127,127,127,0.22)" stroke-width="5"/>`
    + (share > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(Math.max(0.02, share) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>` : '')
    + `<text x="${((size - nw) / 2).toFixed(1)}" y="${size / 2 + 3}" ${FONT} font-size="20" font-weight="650" fill="${col}">${n}</text>`
    + `<text x="${((size - sw) / 2).toFixed(1)}" y="${size / 2 + 16}" ${FONT} font-size="10" fill="${K.ink}">${sub}</text></svg>`
}
/** A step's mark: plain glyphs from the panel's one icon set (no icon in a circle), filled weight at 14 px. */
const mark = (name: string, color: string, s = 14) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${iconPaths(name)}</svg>`
const OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.2" fill="none" stroke="rgba(127,127,127,0.6)" stroke-width="1.6"/></svg>`

export function contractCard($: Dollar, els: ElementTable, u: Kit, c: ContractView | null | undefined, vw: ViewState, px: number): JSX.Element | null {
  const { Box, Text, Button } = els
  const steps = Array.isArray(c?.steps) ? c!.steps! : []
  if (!c || (!steps.length && !c.ruleCount && !c.goal && !c.superseded.length && !c.rejected.length)) return null
  const live = steps.filter(x => x.state !== 'dropped'), left = live.filter(x => x.state === 'open')
  const done = live.filter(x => x.state === 'done').reverse() // newest first: the last ticked is the one you look for
  const dropped = steps.length - live.length
  const allDone = live.length > 0 && !left.length
  const failing = done.filter(x => x.proof?.level === 'failing').length
  const open = (g: string) => vw.collapsed.includes(g) // these two groups start folded: in the list means opened
  // every press names the mission it was drawn from, so it never ticks another chat's
  const cmd = (label: string, ...a: string[]) => () => { void act($, label, ['mission', ...a, '--by', 'you', ...(c.mission ? ['--mission', c.mission] : [])], false, 'Saving…') }
  const icon = (key: string, svg: string, alt: string) => (u.Svg ? <Box key={key} flexShrink={0}><u.Svg key={`${key}-s`} source={svg} alt={alt} width={14} height={14} /></Box> : null)
  const row = (x: StepView) => {
    const pr = x.state === 'done' ? PROOF[x.proof?.level ?? (x.by === 'you' ? 'you' : 'unverified')]! : null
    return (
      <Box key={`mc-s${x.n}`} flexDirection="row" alignItems="center" columnGap={1} paddingY={0.5} hover={{ scope: `mc-h${x.n}` }}>
        {icon(`mc-si${x.n}`, pr ? mark(pr.icon, pr.color) : OPEN, pr ? pr.word : 'Not done yet')}
        <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={12}>
          <Text size="caption" color={pr ? K.label : K.text} weight={pr ? undefined : 'medium'}>{`${x.n}. ${tidy(x.text, 160)}`}</Text>
          {pr ? <Text size="caption" color={pr.ink}>{x.proof && x.proof.level !== 'you' ? `${pr.word}: ${x.proof.text}` : pr.word}</Text> : null}
        </Box>
        {/* Drop shows on hover only: a step that no longer applies is rare, and two buttons a row is noise */}
        {x.state === 'open' && u.Svg ? <Box key={`mc-dw${x.n}`} display="none" hover={{ scope: `mc-h${x.n}`, display: 'flex' }}><Button key={`mc-d${x.n}`} plain onPress={cmd(`Step ${x.n} dropped`, 'drop', String(x.n))}><Text size="caption" color={K.muted}>Drop</Text></Button></Box> : null}
        <Button key={`mc-b${x.n}`} plain onPress={x.state === 'open' ? cmd(`Step ${x.n} done`, 'done', String(x.n)) : cmd(`Step ${x.n} reopened`, 'open', String(x.n))}>
          <Text size="caption" weight="medium" color={x.state === 'open' ? K.emerald : K.label}>{x.state === 'open' ? 'Done' : 'Undo'}</Text>
        </Button>
      </Box>
    )
  }
  const fold = (key: string, label: string, on: boolean) => (
    <Button key={key} plain onPress={() => { void toggleGroup($, key) }}><Text size="caption" color={K.label}>{`${label} · `}<Text weight="semibold" color={K.emerald}>{on ? 'Hide' : 'Show'}</Text></Text></Button>
  )
  const sub = c.closed ? 'Closed: its rules no longer bind. Your next brief starts a new mission.'
    : steps.length ? 'Claude ticks a step when it is finished; Cortex checks each tick against your tests.'
    : 'Carries over to every new chat until it is done. A numbered list in your message becomes its steps.'
  const rulesOpen = open('mc-rules'), doneOpen = open('mc-done')
  const say = failing ? `${failing} finished step${failing === 1 ? '' : 's'} now fail${failing === 1 ? 's' : ''} a check` : ''
  return (
    <Box key="h-contract" flexDirection="column" gap={1} paddingX={2} paddingY={1} backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge}>
      {/* the hero: the ring is the one big number; the north star is the title */}
      <Box key="mc-top" flexDirection="row" alignItems="center" columnGap={2} flexWrap="nowrap">
        {u.Svg && live.length ? <Box key="mc-ring" flexShrink={0}><u.Svg key="mc-ring-s" source={stepRing(done.length, live.length, 64, c.closed)} alt={`${done.length} of ${live.length} steps done`} width={64} height={64} /></Box> : null}
        <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={20}>
          <Text size="caption" weight="semibold" color={c.closed ? K.muted : K.emerald}>{c.closed ? 'Mission · closed' : 'Mission'}</Text>
          <Text weight="semibold" color={K.text}>{tidy(c.goal || 'No goal stated yet: the next chat will ask you', px >= 700 ? 220 : 140)}</Text>
          <Text size="caption" color={K.muted}>{sub}</Text>
        </Box>
        {u.Svg && px >= 520 ? <Box key="mc-bk" flexShrink={0}><u.Svg key="mc-bk-s" source={blocky(failing ? 'worried' : allDone || c.closed ? 'happy' : 'idle', 40)} alt={failing ? 'Blocky, worried: a finished step fails a check' : allDone ? 'Blocky, happy: every step is done' : 'Blocky, keeping count'} width={40} height={36} /></Box> : null}
      </Box>
      {say ? u.tag('mc-fail', 'alert', K.amber, `${say}: Claude is told in the next chat.`, 'warning') : null}
      {c.conflicts ? u.tag('mc-cf', 'alert', K.amber, `${c.conflicts} rule${c.conflicts === 1 ? '' : 's'} clash with a newer goal: the new chat will ask you which holds.`, 'warning') : null}
      {/* what's left first, in your order; then the finished ones, folded */}
      {left.length ? <Box key="mc-left" flexDirection="column" gap={0}>{left.map(row)}</Box> : null}
      {done.length ? <Box key="mc-done" flexDirection="column" gap={0}>
        {allDone ? null : fold('mc-done', `${done.length} done${dropped ? ` · ${dropped} dropped` : ''}`, doneOpen)}
        {doneOpen || allDone ? done.map(row) : null}
      </Box> : null}
      {allDone && !c.closed ? (
        <Box key="mc-close" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} rowGap={1} flexWrap="wrap" backgroundColor={`${K.emerald}14`} paddingX={1} paddingY={0.5}>
          <Text size="caption" color={K.text}>Every step is done. Close the mission when you agree; its rules stop binding.</Text>
          <Button key="mc-close-b" variant="primary" onPress={cmd('Mission closed', 'close')}>Close the mission</Button>
        </Box>
      ) : c.closed ? <Box key="mc-reopen" flexDirection="row" justifyContent="flex-end"><Button key="mc-reopen-b" variant="secondary" onPress={cmd('Mission reopened', 'reopen')}>Reopen</Button></Box> : null}
      {/* your rules: one line, folded; opened, short lines by kind, then what was replaced and what you turned down */}
      {c.ruleCount || c.superseded.length || c.rejected.length ? <Box key="mc-rules" flexDirection="column" gap={0}>
        {fold('mc-rules', c.ruleCount ? `${c.ruleCount} of your rules carry over to every new chat` : 'Replaced and turned down', rulesOpen)}
        {rulesOpen ? [
          ...c.rules.slice(0, px >= 640 ? 6 : 4).map((r, i) => (
            <Box key={`mc-r${i}`} flexDirection="row" columnGap={1} alignItems="flex-start" paddingY={0.25}>
              <Box flexShrink={0} width={9}><Text size="caption" weight="semibold" color={K.label}>{KIND[r.kind] ?? r.kind}</Text></Box>
              <Box flexDirection="column" flexShrink={1} minWidth={12}>
                <Text size="caption" color={K.text}>{tidy(r.text, 150)}</Text>
                {r.why ? <Text size="caption" color={K.muted}>{`because ${tidy(r.why, 120)}`}</Text> : null}
              </Box>
            </Box>
          )),
          c.ruleCount > Math.min(c.rules.length, px >= 640 ? 6 : 4) ? u.muted('mc-more', `${c.ruleCount - Math.min(c.rules.length, px >= 640 ? 6 : 4)} more in .vault/STATE.md`) : null,
          ...[...c.superseded].reverse().map((x, i) => <Text key={`mc-sp${i}`} size="caption" color={K.muted}>{`No longer binding: ${tidy(x.text, 100)} (replaced by ${tidy(x.by, 80)})`}</Text>),
          ...[...c.rejected].reverse().map((x, i) => <Text key={`mc-rj${i}`} size="caption" color={K.muted}>{`Turned down, never proposed again: ${tidy(x.what, 120)}`}</Text>),
        ] : null}
      </Box> : null}
    </Box>
  )
}
