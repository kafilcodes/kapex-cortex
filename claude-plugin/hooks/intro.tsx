import type { ElementTable } from 'claude-code'

import type { StatusView, ViewState } from '../types'
import { setIntro, type Dollar } from './data'
import { illoHandoff } from './illos'
import type { Kit } from './kit'
import { K } from './theme'

// First run: three short steps, each a drawing and two sentences, then the panel. Shown once per computer (kept in the
// plugin's store), skipped for people who already have history here, and replayable from Settings.
const STORE_INTRO = 'intro-seen-1'
const G = '#9CA3AF'
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.round(w * h / 260)}" viewBox="0 0 260 ${h}" fill="none">${body}</svg>`
const bar = (x: number, y: number, w: number, c = G, o = 0.45, h = 5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}" fill-opacity="${o}"/>`

/** Step 1: a chat with Cortex's strip above the prompt (a context ring, the cache, the plan) and a costs chart beside it. */
export function illoStrip(width = 260): string {
  const chat = `<rect x="8" y="8" width="150" height="112" rx="10" fill="${G}" fill-opacity="0.07" stroke="${G}" stroke-opacity="0.45" stroke-width="2"/>${bar(20, 22, 70)}${bar(64, 34, 82, G, 0.3)}${bar(20, 46, 56)}${bar(64, 58, 70, G, 0.3)}`
  const ring = `<circle cx="30" cy="88" r="7" stroke="${G}" stroke-opacity="0.3" stroke-width="3"/><path d="M30 81a7 7 0 0 1 6.6 9.3" stroke="${K.emerald}" stroke-width="3" stroke-linecap="round"/>`
  const strip = `<rect x="16" y="78" width="134" height="20" rx="10" fill="${K.emerald}" fill-opacity="0.1" stroke="${K.emerald}" stroke-opacity="0.55" stroke-width="1.5"/>${ring}${bar(44, 85.5, 34, K.sage, 0.85)}${bar(84, 85.5, 26, G, 0.5)}${bar(116, 85.5, 26, K.emerald, 0.7)}`
  const prompt = `<rect x="16" y="102" width="134" height="12" rx="6" fill="${G}" fill-opacity="0.12"/>`
  const caps = [44, 30, 22, 14, 8].map((h, i) => `<rect x="${182 + i * 14}" y="${104 - h}" width="9" height="${h}" rx="4.5" fill="${[G, G, '#14B8A6', K.sage, K.emerald][i]}" fill-opacity="${i < 2 ? 0.55 : 0.9}"/>`).join('')
  const costs = `<rect x="170" y="30" width="82" height="90" rx="10" fill="${G}" fill-opacity="0.07" stroke="${G}" stroke-opacity="0.45" stroke-width="2"/>${bar(180, 42, 40, K.emerald, 0.8)}${caps}`
  return svg(width, 128, `${chat}${strip}${prompt}${costs}`)
}

/** Step 3: memory notes checked against what happened (a test run, a commit): two confirmed, one flagged for you. */
export function illoDreamCheck(width = 260): string {
  const note = (y: number, ok: boolean) => `<g transform="translate(14 ${y})"><rect width="104" height="28" rx="8" fill="${ok ? G : K.amber}" fill-opacity="${ok ? 0.1 : 0.12}" stroke="${ok ? G : K.amber}" stroke-opacity="${ok ? 0.45 : 0.8}" stroke-width="1.5"/>${bar(10, 9, 52, ok ? G : K.amber, ok ? 0.5 : 0.75)}${bar(10, 17, 34, G, 0.3)}<circle cx="90" cy="14" r="7" fill="${ok ? K.emerald : K.amber}"/>${ok ? '<path d="M86.8 14l2.3 2.3 4-4.4" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M90 10.5v4.2M90 17.2v.4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>'}</g>`
  const evidence = `<rect x="156" y="14" width="92" height="100" rx="10" fill="${G}" fill-opacity="0.07" stroke="${G}" stroke-opacity="0.45" stroke-width="2"/><path d="M168 32h10M168 46h10M168 60h10" stroke="${K.emerald}" stroke-width="2.4" stroke-linecap="round"/>${bar(184, 29.5, 50)}${bar(184, 43.5, 40)}${bar(184, 57.5, 46, K.rose, 0.6)}<circle cx="172" cy="86" r="4" fill="${K.sage}"/><path d="M172 90v14" stroke="${K.sage}" stroke-width="2"/><circle cx="172" cy="104" r="4" fill="${K.sage}"/>${bar(182, 83.5, 44)}${bar(182, 101.5, 32)}`
  const links = `<path d="M122 28 C 138 28, 140 32, 154 32" stroke="${K.emerald}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/><path d="M122 64 C 138 64, 140 60, 154 60" stroke="${K.amber}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/><path d="M122 100 C 138 100, 140 92, 154 88" stroke="${K.emerald}" stroke-width="1.6" stroke-dasharray="2 4" stroke-linecap="round"/>`
  return svg(width, 128, `${note(14, true)}${note(50, false)}${note(86, true)}${links}${evidence}`)
}

/** Progress as three dots, the current one a wider emerald pill. */
const dots = (at: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="8" viewBox="0 0 44 8">${[0, 1, 2].map(i => i === at ? `<rect x="${i * 14}" width="18" height="8" rx="4" fill="${K.emerald}"/>` : `<circle cx="${i * 14 + (i > at ? 8 : 4)}" cy="4" r="4" fill="${G}" fill-opacity="0.45"/>`).join('')}</svg>`

type Point = [icon: string, title: string, text: string]
const STEPS: { kicker: string; title: string; text: string; art: (w: number) => string; alt: string; points: Point[] }[] = [
  { kicker: 'Live strip and costs', title: 'See what every message costs', text: 'A strip above your prompt shows the chat, the cache and your plan at a glance. Costs shows what each tool adds to every message.', art: illoStrip, alt: 'A chat with the Cortex strip above the prompt and a small costs chart',
    points: [['turn', 'Context', 'How full this chat is, and turns left'], ['pending', 'Cache', 'How long until the next reply re-reads everything'], ['spark', 'Costs', 'Tools you never use, off in one press']] },
  { kicker: 'Lossless handoff', title: 'Switch chats without losing your place', text: 'After every reply Cortex saves where you are. In a new chat, type /cortex-resume and Claude carries on.', art: (w) => illoHandoff(w), alt: 'A full chat handing a small packet to a fresh one',
    points: [['star', 'Pinned', 'The goal and your instructions, word for word'], ['commit', 'Trail', 'One line per turn, and the commits'], ['link', 'Last exchanges', 'Word for word, so a plan survives whole']] },
  { kicker: 'Dream', title: 'Keep Claude\'s memory true', text: 'A Dream checks what Claude remembers against what really happened, and proposes fixes.', art: illoDreamCheck, alt: 'Memory notes checked against test runs and commits',
    points: [['test', 'Evidence', 'Test runs, commits and your own words'], ['check', 'You decide', 'Apply or Keep, one finding at a time'], ['merge', 'Undo', 'Every Apply can be undone, byte for byte']] },
]

/** True once the intro was finished or skipped on this computer, or when this project already has history. */
export async function introSeen($: Dollar, s: StatusView, vw: ViewState): Promise<boolean> {
  if (vw.intro === -1) return true
  if (vw.intro !== undefined && vw.intro >= 0) return false
  if ((s.episodes?.length ?? 0) > 3) return true
  try { return (await $.store.get(STORE_INTRO)) === true } catch { return true }
}

async function go($: Dollar, step: number): Promise<void> { await setIntro($, step) }
async function done($: Dollar): Promise<void> { await $.store.set(STORE_INTRO, true).catch(() => undefined); await setIntro($, -1) }
/** Settings: show the intro again from its first step. */
export async function replayIntro($: Dollar): Promise<void> { await setIntro($, 0) }

/** The intro fills the pane: centered on its height (rows) and width; art beside the words when there's room. */
export function introPage($: Dollar, els: ElementTable, u: Kit, vw: ViewState, px: number, rows = 40): JSX.Element {
  const { Box, Text, Button } = els
  const at = Math.max(0, Math.min(STEPS.length - 1, vw.intro ?? 0))
  const step = STEPS[at]!
  const last = at === STEPS.length - 1
  const wide = px >= 820
  const artW = Math.round(wide ? Math.min(560, px * 0.42) : Math.max(220, Math.min(440, px - 100)))
  const point = ([icon, title, text]: Point, i: number) => (
    <Box key={`intro-p${i}`} width={wide ? '100%' : '30%'} flexGrow={1} minWidth={18} flexDirection="row" gap={1} alignItems="flex-start" backgroundColor={K.pill} {...u.inset()} paddingX={1} paddingY={1}>
      {u.node(`intro-pn${i}`, icon, K.emerald, 22)}
      <Box flexDirection="column" gap={0} flexShrink={1} minWidth={8}>
        <Text weight="semibold" color={K.text}>{title}</Text>
        <Text size="caption" color={K.label}>{text}</Text>
      </Box>
    </Box>
  )
  const words = (
    <Box key="intro-words" flexDirection="column" gap={2} flexGrow={1} flexShrink={1} minWidth={30} width={wide ? '46%' : '100%'}>
      <Box flexDirection="column" gap={1}>
        <Text size="caption" weight="semibold" color={K.emerald}>{`${at + 1} of ${STEPS.length} · ${step.kicker}`}</Text>
        <Text size="title" weight="semibold" color={K.text}>{step.title}</Text>
        <Text color={K.label}>{step.text}</Text>
      </Box>
      <Box key="intro-points" flexDirection={wide ? 'column' : 'row'} flexWrap="wrap" gap={1}>{step.points.map(point)}</Box>
      <Box key="intro-nav" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
        {u.graphic(`intro-dots-${at}`, dots(at), `Step ${at + 1} of ${STEPS.length}`)}
        <Box flexDirection="row" gap={1} alignItems="center">
          {!last ? <Button key="intro-skip" plain onPress={() => { void done($) }}><Text size="caption" color={K.label}>Skip</Text></Button> : null}
          {at > 0 ? <Button key="intro-back" variant="secondary" onPress={() => { void go($, at - 1) }}>Back</Button> : null}
          <Button key="intro-next" variant="primary" autoFocus onPress={() => { void (last ? done($) : go($, at + 1)) }}>{last ? 'Start using Cortex' : 'Next'}</Button>
        </Box>
      </Box>
    </Box>
  )
  return (
    <Box key="intro" flexDirection="column" justifyContent="center" minHeight={Math.max(16, rows - 8)} backgroundColor={K.card} borderStyle="round" borderColor={K.hairline} paddingX={3} paddingY={2}>
      <Box key="intro-row" flexDirection={wide ? 'row' : 'column'} alignItems="center" justifyContent="center" gap={4}>
        <Box key="intro-art" flexDirection="column" alignItems="center" flexShrink={0}>{u.graphic(`intro-art-${at}`, step.art(artW), step.alt)}</Box>
        {words}
      </Box>
    </Box>
  )
}
