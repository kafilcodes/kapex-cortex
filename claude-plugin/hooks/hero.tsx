import { putInBox } from './ask'
import type { ElementTable } from 'claude-code'

import type { CacheView, LiveView, StatusView, ViewState } from '../types'
import { act, handedOff, handOff, setCostsSub, setFlow, setSub, setTab, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { alive, moodSvg, type Mood } from './mascot'
import { animateFor } from './anim'
import { flaggedNotes, switchParts, type Switch } from './switch'
import { K, RESUME } from './theme'
import type { Tip } from './tips'
import { blocky, type BlockyMood } from './blocky'

/** Blocky's mood for each of the robot's. */
const PAL: Record<string, Exclude<BlockyMood, 'tiny'>> = { calm: 'cool', hi: 'happy', working: 'idle', stressed: 'worried', dream: 'sleepy' }

// The top of Overview: one headline for right now, the action it needs, and the mascot in the matching mood.
// No card behind it. The mood comes only from Cortex's own status, most urgent first:
//   stressed  time to hand off (the question is open), a red tip, the 5-hour plan at 90%+
//   dream     memory notes waiting for your decision, or a full check running
//   working   a tip worth acting on, or context / plan getting full
//   hi        a fresh chat (no reply yet)
//   calm      everything fine
export function moodOf(s: StatusView, l: LiveView | null, sw: Switch | null, tip: Tip | null, five: number, gone = false): Mood {
  if (gone) return 'hi' // just handed off: the place is saved, nothing is urgent here any more
  if (sw || tip?.color === K.rose || five >= 90) return 'stressed'
  if (s.dream.running || toReview(s) > 0) return 'dream'
  if (tip || five >= 70 || (l?.context.percent ?? 0) >= 60) return 'working'
  if (!l || l.turns <= 1) return 'hi'
  return 'calm'
}

const COLOR: Record<Mood, string> = { stressed: K.rose, dream: K.emerald, working: K.amber, hi: K.emerald, calm: K.emerald }

export function heroRow($: Dollar, els: ElementTable, u: Kit, o: { s: StatusView; l: LiveView | null; cv: CacheView; vw: ViewState; tip: Tip | null; sw: Switch | null; five: number; cols: number }): JSX.Element {
  const { Box, Text, Button } = els
  const { s, l, vw, tip, sw } = o
  const gone = handedOff(vw, l)
  const mood = moodOf(s, l, sw, tip, o.five, gone)
  const waiting = toReview(s)
  const row = (key: string, kids: (JSX.Element | null)[]) => <Box key={key} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">{kids}</Box>

  let title: string, body: (JSX.Element | null)[]
  // a hand-off you started yourself (from the Handoff card, at any fullness) gets the same confirmation as one Cortex suggested
  // just handed off, the confirmation stands until a reply here, whatever the tips say (a stale 'copied' after one is ignored)
  const vf: ViewState = vw.flow === 'copied' && !gone ? { ...vw, flow: '' } : vw
  const flow = gone || (vf.flow === 'confirm' && l) ? (sw ?? { pct: l?.context.percent ?? 0, tokens: l?.context.tokens ?? 0, cold: false }) : sw // the real numbers when Cortex suggested it
  if (flow) ({ title, body } = switchParts($, els, u, s, flow, vf))
  else if (tip) {
    title = tip.head ?? tip.text
    body = [
      u.line('hero-d', tip.detail, true, K.label, 'caption'),
      // the one primary button, clear of the reason above it
      tip.action ? <Box key="hero-bw" paddingTop={1}>{row('hero-b', [tip.action === 'resume'
        ? <Button key="tip-go" variant="primary" onPress={() => { void putInBox($, RESUME) }}>Continue from the handoff</Button>
        : tip.action === 'handoff' ? <Button key="tip-go" variant="primary" onPress={() => { void (flaggedNotes(s) ? setFlow($, 'confirm') : handOff($)) }}>Hand off now</Button>
        : tip.action === 'dream' ? <Button key="tip-go" variant="primary" onPress={() => { void act($, 'Full check started', ['dream']); void setTab($, 'data'); void setSub($, 'dream') }}>Run full check</Button>
        : tip.action === 'review' ? <Button key="tip-go" variant="primary" onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>Review</Button>
        : tip.action === 'costs' ? <Button key="tip-go" variant="primary" onPress={() => { void setTab($, 'details'); void setCostsSub($, 'costs') }}>Choose what to turn off</Button> : null])}</Box> : null,
    ]
  } else if (mood === 'dream') {
    title = s.dream.running ? 'Checking Claude\'s memory…' : `${waiting} memory note${waiting === 1 ? '' : 's'} to review`
    body = [u.line('hero-d', s.dream.running ? 'A full check is reading your recent chats, test runs and commits. Results land on the Memory check page.' : 'They look wrong or out of date. Decide before a new chat trusts them.', true, K.label, 'caption'),
      s.dream.running ? null : <Box key="hero-bw" paddingTop={1}>{row('hero-b', [<Button key="hero-review" variant="primary" onPress={() => { void setTab($, 'data'); void setSub($, 'dream') }}>Review</Button>])}</Box>]
  } else {
    const pct = l?.context.percent ?? 0
    title = mood === 'hi' ? 'Ready when you are' : mood === 'working' ? `This chat is ${pct}% full, fine to continue` : 'All good, nothing needs you'
    body = [u.line('hero-d', mood === 'hi' ? 'This chat\'s numbers appear after Claude\'s first reply.' : mood === 'working' ? `Cortex will suggest a fresh chat at ${s.prefs?.handoffAt ?? 80}%. Your place is saved after every reply.` : 'Your place is saved after every reply, so you can switch chats any time.', true, K.label, 'caption')]
  }

  // the mascot always sits beside the words (never alone on a line below them, leaving the right side empty)
  const w = o.cols >= 150 ? 170 : o.cols >= 84 ? 150 : 96
  return (
    <Box key="hero-top" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2} flexWrap="nowrap" paddingX={1}>
      <Box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={20}>
        <Text size="title" weight="semibold" color={(flow && (!sw || gone)) || mood === 'calm' || mood === 'hi' ? K.text : COLOR[mood]}>{title}</Text>
        {body}
      </Box>
      {u.Svg ? <Box key="hero-m" flexShrink={0} flexDirection="row" alignItems="flex-end" columnGap={1}>
        <u.Svg key="hero-mascot" source={animateFor('hero-mascot', mood) ? alive(moodSvg(mood, w)) : moodSvg(mood, w)} alt={`Cortex: ${mood}`} width={w} height={Math.round(w * 0.7)} />
        {/* Blocky, the robot's companion, feels the same: cool in pixel shades when all is well, worried when it's time to act */}
        {o.cols >= 56 ? <u.Svg key="hero-blocky" source={blocky(PAL[mood] ?? 'idle', w >= 150 ? 48 : 40)} alt={`Blocky: ${PAL[mood] ?? 'idle'}`} width={w >= 150 ? 48 : 40} height={Math.round((w >= 150 ? 48 : 40) * 0.9)} /> : null}
      </Box> : null}
    </Box>
  )
}
