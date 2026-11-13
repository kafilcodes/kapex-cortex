import type { ElementTable } from 'claude-code'

import type { CacheView, LiveView, StatusView, ViewState } from '../types'
import { cacheState, clock } from './charts'
import { act, handOff, setFlow, setSub, setTab, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { moodSvg, type Mood } from './mascot'
import { flaggedNotes, switchParts, type Switch } from './switch'
import { K, RESUME } from './theme'
import type { Tip } from './tips'

// The top of Overview: one headline for right now, the action it needs, and the mascot in the matching mood.
// No card behind it. The mood comes only from Cortex's own status, most urgent first:
//   stressed  time to hand off (the question is open), a red tip, the 5-hour plan at 90%+
//   dream     memory notes waiting for your decision, or a Dream running
//   working   a tip worth acting on, or context / plan getting full
//   hi        a fresh chat (no reply yet)
//   calm      everything fine
export function moodOf(s: StatusView, l: LiveView | null, sw: Switch | null, tip: Tip | null, five: number): Mood {
  if (sw || tip?.color === K.rose || five >= 90) return 'stressed'
  if (s.dream.running || toReview(s) > 0) return 'dream'
  if (tip || five >= 70 || (l?.context.percent ?? 0) >= 60) return 'working'
  if (!l || l.turns <= 1) return 'hi'
  return 'calm'
}

const COLOR: Record<Mood, string> = { stressed: K.rose, dream: K.emerald, working: K.amber, hi: K.emerald, calm: K.emerald }

export function heroRow($: Dollar, els: ElementTable, u: Kit, o: { s: StatusView; l: LiveView | null; cv: CacheView; vw: ViewState; tip: Tip | null; sw: Switch | null; five: number; cols: number }): JSX.Element {
  const { Box, Text, Button } = els
  const { s, l, cv, vw, tip, sw } = o
  const mood = moodOf(s, l, sw, tip, o.five)
  const waiting = toReview(s)
  const cs = cacheState(cv.lastAt, cv.ttl === '1h' ? 3_600_000 : 300_000)
  const summary = [l ? `context ${l.context.percent}%` : '', cs.state === 'unknown' ? '' : cs.state === 'cold' ? 'cache cold' : `cache warm till ${clock(cs.until!)}`, `5-hour plan ${o.five}%`, waiting ? `${waiting} to review` : 'memory checked'].filter(Boolean).join(' · ')
  const row = (key: string, kids: (JSX.Element | null)[]) => <Box key={key} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">{kids}</Box>

  let title: string, body: (JSX.Element | null)[]
  if (sw) ({ title, body } = switchParts($, els, u, s, sw, vw))
  else if (tip) {
    title = tip.text
    body = [
      u.line('hero-d', tip.detail, vw.expanded.includes('tip'), K.label, 'caption'),
      row('hero-b', [tip.action === 'resume'
        ? <Button key="tip-go" variant="primary" onPress={() => { void $.prompt.submit({ text: RESUME }) }}>Resume</Button>
        : tip.action === 'handoff' ? <Button key="tip-go" variant="primary" onPress={() => { void (flaggedNotes(s) ? setFlow($, 'confirm') : handOff($)) }}>Hand off now</Button>
        : tip.action === 'dream' ? <Button key="tip-go" variant="primary" onPress={() => { void act($, 'Dream started', ['dream']); void setTab($, 'data'); void setSub($, 'dream') }}>Dream now</Button>
        : tip.action === 'review' ? <Button key="tip-go" variant="primary" onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>Review</Button>
        : <Button key="tip-go" onPress={() => { void setTab($, 'data'); void setSub($, tip.action === 'costs' ? 'details' : 'handoff') }}>{tip.action === 'costs' ? 'See costs' : 'What a new chat knows'}</Button>]),
    ]
  } else if (mood === 'dream') {
    title = s.dream.running ? 'Dream time: checking your memory' : `${waiting} memory note${waiting === 1 ? '' : 's'} to review`
    body = [u.line('hero-d', s.dream.running ? 'It reads your recent chats, tests and git. Results land on the Dream page.' : 'Decide before a new chat trusts them.', false, K.label, 'caption'),
      s.dream.running ? null : row('hero-b', [<Button key="hero-review" variant="primary" onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>Review</Button>])]
  } else {
    title = mood === 'hi' ? 'Ready when you are' : mood === 'working' ? 'Keeping an eye on things' : 'All calm'
    body = [u.line('hero-d', summary, true, K.label, 'caption')]
  }

  // the mascot always sits beside the words (never alone on a line below them, leaving the right side empty)
  const w = o.cols >= 150 ? 170 : o.cols >= 84 ? 150 : 96
  return (
    <Box key="hero-top" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} flexWrap="nowrap" paddingX={1}>
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={20}>
        <Text size="heading" weight="semibold" color={mood === 'calm' || mood === 'hi' ? K.text : COLOR[mood]}>{title}</Text>
        {body}
      </Box>
      {u.Svg ? <Box key="hero-m" flexShrink={0}><u.Svg key="hero-mascot" source={moodSvg(mood, w)} alt={`Cortex: ${mood}`} width={w} height={Math.round(w * 0.7)} /></Box> : null}
    </Box>
  )
}
