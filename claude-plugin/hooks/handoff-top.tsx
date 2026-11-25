import type { AskView } from '../types'
import { ask, askRow } from './ask'
import { k } from './charts'
import { act, ago, handOff, minsSince, setFlow, setTab, toReview, type Dollar } from './data'
import { egmArt, transferSvg } from './handoff-art'
import { illoHandoff } from './illos'
import { flaggedNotes } from './switch'
import type { Ctx } from './tabs'
import { tidy } from './text'
import { GOLDFISH, K, RESUME } from './theme'

// The Handoff page's top: what a new chat gets (the chat shrinking into the note, drawn to scale, then a short packing
// list), the three ways to use it, and the Elephant–Goldfish check. One big number (the note's size), the rest lines.

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function handoffTop($: Dollar, o: Ctx, asked: AskView | null): (JSX.Element | null)[] {
  const { Box, Text, Button } = o.els
  const { s, u } = o
  const pv = s.handoff.preview
  const here = o.l?.context.tokens ?? 0
  const w = Math.max(260, Math.min(1200, o.px - 72)) // the drawing spans its card
  const fish = (
    <Box key="h-egm" flexDirection="column" gap={1} paddingX={2} paddingY={1} backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge}>
      <Box flexDirection="row" columnGap={3} rowGap={1} alignItems="center" flexWrap={o.px >= 700 ? 'nowrap' : 'wrap'}>
        {u.Svg ? <Box key="h-egm-a" flexShrink={0}>{u.graphic('h-egm-art', egmArt(o.px >= 700 ? 1 : 0.8), 'An elephant, this chat, hands its note to a goldfish, a fresh helper that remembers nothing')}</Box> : null}
        <Box flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={24}>
          <Text weight="semibold" color={K.text}>Elephant–Goldfish check</Text>
          <Text size="caption" color={K.label}>Based on Google's open-source Elephant–Goldfish Model (EGM). A reviewer that knows nothing of this chat often spots what the chat that wrote the handoff can't.</Text>
          <Box flexDirection="column" gap={0} paddingTop={1}>
            {([['1', 'A fresh helper (the goldfish) reads only the handoff and the files it names.'], ['2', 'It lists where a stranger would get stuck, then says Ready or Not ready.'], ['3', 'This chat (the elephant) fixes those gaps with /cortex-handoff.']] as const).map(([n, t]) => (
              <Box key={`h-egm-s${n}`} flexDirection="row" gap={1} alignItems="flex-start"><Text size="caption" weight="semibold" color={K.amber}>{n}</Text><Text size="caption" color={K.text}>{t}</Text></Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
        <Text size="caption" color={K.muted}>About 20–50k tokens of your plan, once. Nothing changes until you fix the gaps.</Text>
        <Button key="kc-fish" variant="secondary" onPress={() => { void ask($, 'fish', 'Elephant–Goldfish check', GOLDFISH) }}>Run the check</Button>
      </Box>
      {askRow($, o.els, asked, 'fish')}
    </Box>
  )
  if (!s.handoff.exists || !pv) return [u.illo('hr-none', illoHandoff(150), 'No handoff yet', [<Text key="hr-none-t" weight="semibold" color={K.text}>No handoff yet</Text>, u.muted('hr-none-d', 'It appears after the first reply here.')]), fish]

  const pinned = (pv.instructions ?? 0) + (pv.decisions ?? 0)
  const flagged = Math.max(pv.flagged ?? 0, toReview(s))
  const failed = /FAILED/.test(pv.lastCheck)
  // the packing list: what the note carries, in words; each a check mark, none a box of its own
  const packed: [string, string, string][] = [
    ['star', pv.goal ? 'The goal' : 'No goal written down yet', pv.goal ? K.emerald : K.silver],
    ['pending', pv.next && !/^Continue from the last assistant message/.test(pv.next) ? `Next: ${tidy(pv.next, 140)}` : 'Next step: carry on from the last reply', K.emerald],
    ['star', pinned ? `${plural(pinned, 'instruction')} and decisions of yours` : 'No instructions pinned yet', pinned ? K.emerald : K.silver],
    ['turn', `${plural(pv.exchanges || 1, 'last exchange')}, word for word`, K.emerald],
    ['commit', `${plural(pv.trail ?? 0, 'earlier turn')} in short${pv.commits ? `, ${plural(pv.commits, 'commit')}` : ''}`, pv.trail ? K.emerald : K.silver],
    ['file', `${plural(pv.files, 'file')} it names${pv.openItems ? `, ${plural(pv.openItems, 'open item')}` : ''}`, pv.files ? K.emerald : K.silver],
    [failed ? 'cross' : 'test', pv.lastCheck ? `Last check: ${tidy(pv.lastCheck, 60)}` : 'No check run yet', failed ? K.rose : pv.lastCheck ? K.emerald : K.silver],
  ]
  const half = o.px >= 640
  return [
    <Box key="h-ready" flexDirection="column" gap={1} paddingX={2} paddingY={1} backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start" columnGap={2} rowGap={0} flexWrap="wrap">
        <Box flexDirection="column" gap={0} flexShrink={1} minWidth={20}>
          <Text weight="semibold" color={K.text}>What a new chat gets</Text>
          <Text size="caption" color={K.muted}>{s.handoff.chat ? `From “${tidy(s.handoff.chat, 70)}”, saved ${ago(minsSince(s.stateAt))}` : `Saved ${ago(minsSince(s.stateAt))}`}</Text>
        </Box>
        {/* right-aligned beside the title; under it (narrow) it keeps the title's left edge */}
        <Box flexDirection="column" gap={0} alignItems={o.px >= 560 ? 'flex-end' : 'flex-start'}>
          <Text size="title" weight="semibold" tabular color={K.emerald}>{`≈${k(pv.tokens)}`}</Text>
          <Text size="caption" color={K.muted}>tokens to start a new chat</Text>
        </Box>
      </Box>
      {here > 20_000 ? u.graphic('h-xfer', transferSvg({ here, start: pv.tokens, width: w }), `This chat re-reads ${k(here)} tokens with each message; a new chat starts with about ${k(pv.tokens)}`) : null}
      {pv.goal ? <Box key="h-goal" flexDirection="row" gap={1} alignItems="flex-start" paddingTop={1}><Box flexShrink={0}><Text size="caption" weight="semibold" color={K.emerald}>Goal</Text></Box><Box flexShrink={1} minWidth={10}><Text size="caption" color={K.text}>{tidy(pv.goal, 220)}</Text></Box></Box> : null}
      <Box key="h-pack" flexDirection="row" flexWrap="wrap" columnGap={2} rowGap={0}>
        {packed.map(([ic, t, c], i) => <Box key={`h-pk-${i}`} {...(half ? { width: '48%' } : {})} flexGrow={1} minWidth={20}>{u.tag(`h-pk-t${i}`, c === K.silver ? 'pending' : ic === 'cross' ? 'cross' : 'check', c, t, c === K.silver ? K.muted : K.text)}</Box>)}
      </Box>
      {flagged ? u.tag('h-mem', 'alert', K.amber, `${plural(flagged, 'memory note')} flagged: the new chat is told not to rely on ${flagged === 1 ? 'it' : 'them'}`, K.label) : null}
    </Box>,
    <Box key="h-act" flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap={1} rowGap={1}>
        <Text size="caption" color={K.label}>Hand off now saves it and copies /cortex-resume to paste in a new chat.</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="kc-resume" variant="secondary" onPress={() => { void ask($, 'resume', 'Load the handoff into this chat', RESUME) }}>← Load into this chat</Button>
          <Button key="kc-hand2" variant="secondary" onPress={() => { void act($, 'Handoff saved', ['h']) }}>↓ Save now</Button>
          <Button key="kc-hand3" variant="primary" onPress={() => { void setTab($, 'overview'); void (flaggedNotes(s) ? setFlow($, 'confirm') : handOff($)) }}>Hand off now →</Button>
        </Box>
      </Box>
      {askRow($, o.els, asked, 'resume')}
    </Box>,
    fish,
  ]
}
