import type { ElementTable } from 'claude-code'

import type { CacheView, LiveView, StatusView, ViewState } from '../types'
import { cacheState, k } from './charts'
import { copyResume, handOff, RESUME_COMMAND, setFlow, setSub, setTab, snoozeSwitch, toReview, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'

// Switching to a fresh chat when this one is big: offered at your threshold (80% by default), or 10 points earlier
// when the cache is cold (the next message would re-read everything at full price). You confirm; Cortex checks the
// memory a new chat will load, saves the handoff and copies /cortex-resume. Claude Code opens new chats itself
// (+ New), so the last step, open and paste, is yours. "Later" waits 30 minutes or 5 more points.
export type Switch = { pct: number; tokens: number; cold: boolean }

export function switchDue(s: StatusView, l: LiveView | null, cv: CacheView, vw: ViewState, now = Date.now()): Switch | null {
  if (!l || !s.handoff.exists) return null
  const pct = l.context.percent, tokens = l.context.tokens
  const at = s.prefs?.handoffAt ?? 80
  const cold = cacheState(cv.lastAt, cv.ttl === '1h' ? 3_600_000 : 300_000, now).state === 'cold'
  if (tokens < 60_000 || !(pct >= at || (cold && pct >= at - 10))) return null
  if (vw.flow !== 'copied' && vw.snooze && now < vw.snooze.until && pct < vw.snooze.pct + 5) return null
  return { pct, tokens, cold }
}

/** Memory notes a new chat would load although a check flagged them. */
export const flaggedNotes = (s: StatusView) => Math.max(toReview(s), s.handoff.preview?.flagged ?? 0)

/** The hand-off question's title and its body (the Overview hero draws them beside the mascot). */
export function switchParts($: Dollar, els: ElementTable, u: Kit, s: StatusView, sw: Switch, vw: ViewState): { title: string; body: (JSX.Element | null)[] } {
  const { Box, Text, Button } = els
  const pv = s.handoff.preview
  const flagged = flaggedNotes(s)
  const start = `≈${k((pv?.tokens ?? 0) + s.native.alwaysTokens)}`
  const why = sw.cold
    ? `The cache cooled: your next message re-reads ${k(sw.tokens)} tokens. A new chat starts at ${start} (plus Claude Code's setup).`
    : `Every message here carries ${k(sw.tokens)} tokens. A new chat starts at ${start} (plus Claude Code's setup).`
  const row = (key: string, kids: (JSX.Element | null)[]) => <Box key={key} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">{kids}</Box>
  const body = vw.flow === 'copied'
    ? [
        u.tag('sw-ok', 'check', K.emerald, `Handoff saved and ${RESUME_COMMAND} copied. Open a new chat (+ New), paste it and send. This chat stays as it is.`, K.text),
        row('sw-b', [<Button key="sw-again" onPress={() => { void copyResume($) }}>Copy again</Button>, <Button key="sw-done" onPress={() => { void snoozeSwitch($, sw.pct) }}>Done</Button>]),
      ]
    : vw.flow === 'confirm' && flagged
      ? [
          u.tag('sw-mem', 'alert', K.amber, `${flagged} memory note${flagged === 1 ? ' is' : 's are'} flagged. A new chat loads ${flagged === 1 ? 'it' : 'them'} as-is (and is told not to rely on ${flagged === 1 ? 'it' : 'them'}).`, K.text),
          row('sw-b', [
            <Button key="sw-review" variant="primary" onPress={() => { void setFlow($, ''); void setTab($, 'data'); void setSub($, 'dream') }}>Fix them first</Button>,
            <Button key="sw-anyway" onPress={() => { void handOff($) }}>Hand off anyway</Button>,
          ]),
        ]
      : [
          u.line('sw-why', why, true, K.label, 'caption'),
          row('sw-b', [
            <Button key="sw-yes" variant="primary" onPress={() => { void (flagged ? setFlow($, 'confirm') : handOff($)) }}>Yes, hand off</Button>,
            <Button key="sw-later" onPress={() => { void snoozeSwitch($, sw.pct) }}>Later</Button>,
            flagged ? <Text key="sw-f" size="caption" color={K.amber}>{`${flagged} memory note${flagged === 1 ? '' : 's'} to check first`}</Text> : null,
          ]),
        ]
  return { title: `Context ${sw.pct}% full${sw.cold ? ' and the cache is cold' : ''}: continue in a fresh chat?`, body }
}
