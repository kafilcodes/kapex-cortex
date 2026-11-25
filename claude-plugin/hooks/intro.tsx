import type { ElementTable } from 'claude-code'

import type { StatusView, ViewState } from '../types'
import { settleSoon } from './anim'
import { setIntro, type Dollar } from './data'
import { illoHandoff } from './illos'
import { pointArt, SHIELD, type PointArt } from './intro-art'
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

/** Progress: one dot per step, the current one a wider emerald pill, steps already seen a quiet emerald. Every dot
 * keeps a full gap from its neighbours at every step (the pill used to touch the next dot, and was cut off on the
 * last step). Moving between steps, the pill slides and stretches from where it was to where it is, once. */
const DOT = 8, PILL = 22, GAP = 6
const DOTS_W = PILL + (DOT + GAP) * 2
const EASE = 'calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.1 1"'
function dotsLayout(at: number): { x: number; w: number; fill: string; op: number }[] {
  let x = 0
  return [0, 1, 2].map(i => { const w = i === at ? PILL : DOT, d = { x, w, fill: i <= at ? K.emerald : G, op: i === at ? 1 : i < at ? 0.45 : 0.4 }; x += w + GAP; return d })
}
export function introDots(at: number, from = at): string {
  const now = dotsLayout(at), was = dotsLayout(from), moved = from !== at
  const anim = (attr: string, a: string | number, b: string | number) => moved && a !== b ? `<animate attributeName="${attr}" from="${a}" to="${b}" dur="0.42s" fill="freeze" ${EASE}/>` : ''
  const body = now.map((d, i) => `<rect x="${d.x}" width="${d.w}" height="${DOT}" rx="${DOT / 2}" fill="${d.fill}" fill-opacity="${d.op}">${anim('x', was[i]!.x, d.x)}${anim('width', was[i]!.w, d.w)}${anim('fill-opacity', was[i]!.op, d.op)}${anim('fill', was[i]!.fill, d.fill)}</rect>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DOTS_W}" height="${DOT}" viewBox="0 0 ${DOTS_W} ${DOT}">${body}</svg>`
}
// A step's motion plays once: in the renders within 1.2 s of the step changing (the pill slides, the art rises in),
// then one settle redraw draws the step still, so scrolling, resizing or reopening never replays it. Kept per step,
// so two panels on the same step draw the same picture.
let shown = { at: -1, from: -1, until: 0 }
function stepMotion($: Dollar, at: number): { from: number; live: boolean } {
  const now = Date.now()
  if (shown.at !== at) { shown = { at, from: shown.at < 0 ? at : shown.at, until: now + 1_200 }; settleSoon($) }
  return { from: shown.from, live: now <= shown.until }
}
/** Starting over (replay from Settings) or leaving the intro: no slide from a step left behind. */
const forgetMotion = () => { shown = { at: -1, from: -1, until: 0 } }

/** A step's drawing rises 6 px into place as it fades up from 40% (a soft landing). It starts at 40%, not 0, so a
 * surface that shows only the first frame still shows the drawing. */
const arrive = (art: string) => art.replace(/(<svg[^>]*>)([\s\S]*)(<\/svg>)$/, (_m, a: string, body: string, z: string) =>
  `${a}<g><animate attributeName="opacity" from="0.4" to="1" dur="0.5s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.25 0.8 0.25 1"/><animateTransform attributeName="transform" type="translate" from="0 6" to="0 0" dur="0.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.25 0.8 0.25 1"/>${body}</g>${z}`)

type Point = [art: PointArt, title: string, text: string]
const STEPS: { kicker: string; title: string; text: string; art: (w: number) => string; alt: string; points: Point[] }[] = [
  { kicker: 'Live strip and costs', title: 'See what every message costs', text: 'A strip above your prompt shows the chat, the cache and your plan at a glance. Costs shows what each tool adds to every message.', art: illoStrip, alt: 'A chat with the Cortex strip above the prompt and a small costs chart',
    points: [['context', 'Context', 'How full this chat is, and turns left'], ['cache', 'Cache', 'How long until the next reply re-reads everything'], ['tools', 'Unused tools', 'Turn off tools you never use, in one press']] },
  { kicker: 'Lossless handoff', title: 'Switch chats without losing your place', text: 'After every reply Cortex saves where you are. In a new chat, type /cortex-resume and Claude carries on.', art: (w) => illoHandoff(w), alt: 'A full chat handing a small packet to a fresh one',
    points: [['pinned', 'Pinned', 'The goal and your instructions, word for word'], ['trail', 'Trail', 'One line per turn, and the commits'], ['exchanges', 'Last exchanges', 'Word for word, so a plan survives whole']] },
  { kicker: 'Dream', title: 'Keep Claude\'s memory true', text: 'A Dream checks what Claude remembers against what really happened, and proposes fixes.', art: illoDreamCheck, alt: 'Memory notes checked against test runs and commits',
    points: [['evidence', 'Evidence', 'Test runs, commits and your own words'], ['decide', 'You decide', 'Apply or Keep, one finding at a time'], ['undo', 'Undo', 'Every Apply can be undone, byte for byte']] },
]

/** True once the intro was finished or skipped on this computer, or when this project already has history. */
export async function introSeen($: Dollar, s: StatusView, vw: ViewState): Promise<boolean> {
  if (vw.intro === -1) return true
  if (vw.intro !== undefined && vw.intro >= 0) return false
  if ((s.episodes?.length ?? 0) > 3 || seenStored) return true
  // the stored answer only changes from false to true: once true, kept here instead of read on every redraw
  try { seenStored = (await $.store.get(STORE_INTRO)) === true; return seenStored } catch { return true }
}
let seenStored = false

async function go($: Dollar, step: number): Promise<void> { await setIntro($, step) }
async function done($: Dollar): Promise<void> { seenStored = true; forgetMotion(); await $.store.set(STORE_INTRO, true).catch(() => undefined); await setIntro($, -1) }
/** Settings: show the intro again from its first step. */
export async function replayIntro($: Dollar): Promise<void> { forgetMotion(); await setIntro($, 0) }

/** The intro fills the pane: centered on its height (rows) and width; art beside the words when there's room. */
export function introPage($: Dollar, els: ElementTable, u: Kit, vw: ViewState, px: number, rows = 40): JSX.Element {
  const { Box, Text, Button } = els
  const at = Math.max(0, Math.min(STEPS.length - 1, vw.intro ?? 0))
  const step = STEPS[at]!
  const last = at === STEPS.length - 1
  const { from, live } = stepMotion($, at)
  const wide = px >= 820
  const artW = Math.round(wide ? Math.min(560, px * 0.42) : Math.max(220, Math.min(440, px - 100)))
  // the three points as rows on one surface with hairlines between them (lists are rows, not a box per row)
  // each point leads with a small drawing of the thing itself (intro-art.ts), played once as the step opens
  const point = ([art, title, text]: Point, i: number) => (
    <Box key={`intro-p${i}`} flexDirection="row" gap={2} alignItems="center" paddingY={1}>
      <Box key={`intro-pa${i}`} flexShrink={0}>{u.graphic(`intro-pa${i}-${at}`, pointArt(art, live, i), title)}</Box>
      <Box flexDirection="column" gap={0} flexShrink={1} minWidth={8}>
        <Text weight="semibold" color={K.text}>{title}</Text>
        <Text size="caption" color={K.label}>{text}</Text>
      </Box>
    </Box>
  )
  const rule = (i: number) => u.Svg ? <Box key={`intro-r${i}`} overflow="hidden" flexDirection="row"><u.Svg key={`intro-rs${i}`} source={`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1"><rect width="2400" height="1" fill="${K.hairline}"/></svg>`} alt="divider" width={2400} height={1} /></Box> : null
  const words = (
    <Box key="intro-words" flexDirection="column" gap={2} flexGrow={1} flexShrink={1} minWidth={30} width={wide ? '46%' : '100%'}>
      <Box flexDirection="column" gap={1}>
        <Text size="caption" weight="semibold" color={K.emerald}>{step.kicker}</Text>
        <Text size="title" weight="semibold" color={K.text}>{step.title}</Text>
        <Text color={K.label}>{step.text}</Text>
      </Box>
      <Box key="intro-points" flexDirection="column" backgroundColor={K.pill} {...u.inset()} paddingX={2}>{step.points.flatMap((p, i) => i ? [rule(i), point(p, i)] : [point(p, i)])}</Box>
      {/* what Cortex is, said once and plainly: beside Claude, never inside it, and what it costs */}
      <Box key="intro-trust" flexDirection="row" gap={1} alignItems="flex-start" flexWrap="nowrap">
        <Box key="intro-shield-b" flexShrink={0} paddingTop={0}>{u.graphic('intro-shield', SHIELD, 'Shield')}</Box>
        <Box flexShrink={1} minWidth={10}><Text size="caption" color={K.label}><Text weight="semibold" color={K.text}>Beside Claude, never inside it.</Text>{' Your model, prompts and answers stay as they are; Cortex adds about 250 tokens a message.'}</Text></Box>
      </Box>
      <Box key="intro-nav" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} rowGap={1} flexWrap="wrap">
        <Box key="intro-prog" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          {u.graphic(`intro-dots-${at}`, live ? introDots(at, from) : introDots(at), `Step ${at + 1} of ${STEPS.length}`)}
          <Text size="caption" tabular color={K.muted}>{`${at + 1} of ${STEPS.length}`}</Text>
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          {!last ? <Button key="intro-skip" plain onPress={() => { void done($) }}><Text size="caption" color={K.label}>Skip</Text></Button> : null}
          {at > 0 ? <Button key="intro-back" variant="secondary" onPress={() => { void go($, at - 1) }}>Back</Button> : null}
          <Button key="intro-next" variant="primary" autoFocus onPress={() => { void (last ? done($) : go($, at + 1)) }}>{last ? 'Start using Cortex' : 'Next'}</Button>
        </Box>
      </Box>
    </Box>
  )
  return (
    <Box key="intro" flexDirection="column" justifyContent="center" minHeight={Math.max(16, rows - 8)} backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge} paddingX={3} paddingY={2}>
      <Box key="intro-row" flexDirection={wide ? 'row' : 'column'} alignItems="center" justifyContent="center" gap={4}>
        <Box key="intro-art" flexDirection="column" alignItems="center" flexShrink={0}>{u.graphic(`intro-art-${at}`, live ? arrive(step.art(artW)) : step.art(artW), step.alt)}</Box>
        {words}
      </Box>
    </Box>
  )
}
