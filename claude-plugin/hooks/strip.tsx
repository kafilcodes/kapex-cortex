import type { ElementTable } from 'claude-code'

import { iconPaths } from './icons'
import { LOGO_SVG } from './logo'
import { drainHeat, esc, K, textWidth } from './theme'

// The status strip's drawing (v4.6, from the Stageshow mock approved 2026-11-27). Words are the engine's own Text, so
// they take the app's theme colours and one type size; Svg draws only the marks (the chat ring, the cache bar that
// empties by itself, the message's icon). The 5-hour and weekly plan left the strip in v4.6: Claude Code's own prompt
// box shows both (its usage ring), so the strip says only what Claude Code doesn't. When the message has a button, the button is the verb and
// the words are only the reason ("Saves ~162k a message [Hand off]"): the verb is never said twice. Narrower, the least
// useful thing leaves first: words, then the cache, then the number; a number or word is never cut.

const S = 16 // one mark size across the strip
const TRACK = 'rgba(127,127,127,0.34)' // the panel hairline is too faint at 4-6 px
/** Amber marks: the engine tells a plugin no light or dark, so an SVG mark takes the one amber that keeps 3:1 on both
 * grounds; amber words use the theme's own `warning` (Kapex: #F59E0B on Obsidian, #B45309 on Mist). */
export const MARK_AMBER = '#D97706'
const svg = (w: number, body: string, title = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${S}" viewBox="0 0 ${w} ${S}">${title ? `<title>${esc(title)}</title>` : ''}${body}</svg>`

/** While the cache bar empties by itself, its colour steps with it (healthy, warning, high, critical), in the drawing:
 * no timer and no redraw. Each step starts when the share left crosses 50%, 25% and 10%. */
export function drainSteps(s0: number, sec: number): string {
  const times = [0], values = [drainHeat(s0)]
  for (const L of [0.5, 0.25, 0.1]) if (s0 > L) { times.push(1 - L / s0); values.push(drainHeat(L - 1e-6)) }
  return times.length < 2 ? '' : `<animate attributeName="fill" calcMode="discrete" values="${values.join(';')}" keyTimes="${times.map(t => t.toFixed(4)).join(';')}" dur="${Math.round(sec)}s" fill="freeze"/>`
}

/** The chat: one track, one arc, round caps. */
export const ringMark = (share: number, color: string) => {
  const r = 5.6, c = 2 * Math.PI * r, f = Math.max(0.04, Math.min(1, share)) * c
  return svg(16, `<circle cx="8" cy="8" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.4"/><circle cx="8" cy="8" r="${r}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${f.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 8 8)"/>`)
}
/** The prompt cache: a short capsule that empties by itself over the time left, its colour stepping down as it goes. */
export const cacheMark = (share: number, sec: number, stepped: boolean, color: string) => {
  const w = 18, s0 = Math.max(0, Math.min(1, share)), f = s0 * w
  const anim = f > 0 && sec > 0 ? `<animate attributeName="width" from="${f.toFixed(1)}" to="0" dur="${Math.round(sec)}s" fill="freeze"/>${stepped ? drainSteps(s0, sec) : ''}` : ''
  return svg(w, `<rect x="0" y="6" width="${w}" height="4" rx="2" fill="${TRACK}"/>${f > 0 ? `<rect x="0" y="6" width="${f.toFixed(1)}" height="4" rx="2" fill="${stepped ? drainHeat(s0) : color}">${anim}</rect>` : ''}`)
}
export const glyphMark = (name: string, color: string, title = '') => svg(16, `<g transform="translate(1 1) scale(0.583)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconPaths(name)}</g>`, title)
const RULE = svg(1, `<rect x="0" y="2" width="1" height="12" fill="${TRACK}"/>`)

export type StripMsg = {
  icon: string; mark: string; text: string; short: string
  /** the words' colour: the app's 'text', or its 'warning' / 'error' for amber and red (accessible in light and dark) */
  ink: string
  /** hover and screen readers: everything, in a sentence */ alt: string
  action?: { label: string; primary: boolean }
  /** its button doesn't explain itself ("Fix", "Review"): the words stay longest, and the button goes last */
  keep?: boolean
  /** a notification for a few seconds: its own tint, so it reads as new */
  flash?: string
}
export type StripModel = {
  ctx: number | null; ctxColor: string
  cache: { share: number; sec: number; until: string | null; state: 'warm' | 'cold' | 'unknown'; color: string; stepped: boolean }
  msg: StripMsg
  /** fixes waiting: on Open Cortex unless the message already says it */ waiting: number
  failed: boolean
  /** every fact in one sentence, on the ring's hover (and for screen readers): what narrower arrangements leave out */
  words?: string
}
export type Levels = { vitals: 0 | 1 | 2 | 3 | 4; msg: 0 | 1 | 2 | 3; narrow: boolean; refresh: boolean }

const tw = (t: string, weight = 400) => textWidth(t, 12, weight)
const bw = (t: string) => textWidth(t, 14, 400) + 26
const cacheWords = (m: StripModel, short: boolean) => m.cache.state === 'unknown' ? (short ? 'cache' : 'cache starts on reply') : m.cache.state === 'cold' ? (short ? 'cold' : 'cache cold') : short ? `till ${m.cache.until}` : `cache till ${m.cache.until}`
const ctxWords = (m: StripModel, v: number) => m.ctx === null || v === 4 ? '' : `${Math.round(m.ctx)}%`
const msgWords = (m: StripModel, g: number) => {
  const act = g === 3 && m.msg.keep ? undefined : m.msg.action
  return { act, words: g === 0 ? m.msg.text : g === 1 || !act || m.msg.keep ? m.msg.short : '' }
}
const openLabel = (m: StripModel, narrow: boolean) => `${narrow ? 'Cortex' : 'Open Cortex'}${m.waiting && !m.msg.keep ? ` · ${m.waiting}` : ''}`

/** Pixels each arrangement takes, as the engine lays it out (caption 12 px; a button 14 px plus 26 px of padding). */
export function stripWidth(m: StripModel, l: Levels): number {
  const item = (mark: number, words: string, weight = 400) => mark + (words ? 4 + tw(words, weight) : 0) + 12
  let v = m.ctx === null ? 0 : item(16, ctxWords(m, l.vitals), 600) + (l.vitals === 0 ? 4 + tw('full') : 0)
  if (l.vitals <= 2) v += item(18, cacheWords(m, l.vitals > 0), m.cache.state === 'cold' ? 600 : 400)
  const { act, words } = msgWords(m, l.msg)
  const msg = 16 + (words ? 6 + tw(words, 600) : 0) + (act ? 8 + bw(act.label) : 0) + (m.msg.flash ? 16 : 0)
  const right = (l.refresh ? 38 : 0) + bw(openLabel(m, l.narrow))
  return 22 + 12 + v + 1 + 12 + msg + 12 + right
}
const PLANS: Levels[] = ([[0, 0, false, true], [1, 0, false, true], [1, 1, false, true], [2, 1, false, true], [2, 1, false, false], [3, 1, false, false], [3, 2, false, false], [3, 2, true, false], [4, 2, true, false], [4, 3, true, false]] as const)
  .map(([vitals, msg, narrow, refresh]) => ({ vitals, msg, narrow, refresh }))
/** The richest arrangement that fits `room` px; the last one always (it is what fits a half-width pane). */
export function stripLevels(m: StripModel, room: number): Levels {
  return PLANS.find(l => stripWidth(m, l) <= room) ?? PLANS[PLANS.length - 1]!
}

export function stripView(els: ElementTable, m: StripModel, l: Levels, on: { act: () => void; refresh: () => void; open: () => void }): JSX.Element {
  const { Box, Text, Button } = els
  const Svg = (els as unknown as { Svg: (p: Record<string, unknown>) => JSX.Element }).Svg
  const draw = (key: string, source: string, alt: string) => <Svg key={key} source={source} alt={alt} width={Number(/width="([\d.]+)"/.exec(source)?.[1] ?? 16)} height={S} isInteractive />
  const item = (key: string, ...kids: (JSX.Element | null)[]) => <Box key={key} flexDirection="row" alignItems="center" columnGap={0.5} flexShrink={0}>{kids}</Box>
  const cold = m.cache.state === 'cold'
  const v = l.vitals
  const vitals: JSX.Element[] = []
  if (m.ctx !== null) vitals.push(item('v-ctx', draw('v-ring', ringMark(m.ctx / 100, m.ctxColor), m.words || `Chat ${Math.round(m.ctx)}% full`),
    v < 4 ? <Text key="v-ctx-n" size="caption" weight="semibold" tabular>{ctxWords(m, v)}</Text> : null,
    v === 0 ? <Text key="v-ctx-l" size="caption" color={K.label}>full</Text> : null))
  if (v <= 2) vitals.push(item('v-cache', draw('v-cache-m', cacheMark(m.cache.share, m.cache.sec, m.cache.stepped, cold ? K.rose : m.cache.color), cold ? 'Prompt cache cold' : m.cache.until ? `Prompt cache warm till ${m.cache.until}` : 'The prompt cache starts on your next reply'),
    <Text key="v-cache-t" size="caption" color={cold ? 'error' : K.label} weight={cold ? 'semibold' : undefined}>{cacheWords(m, v > 0)}</Text>))
  const { act, words } = msgWords(m, l.msg)
  const msg = (
    <Box key={m.msg.flash ? 'kc-flash' : 'kc-msg'} flexDirection="row" alignItems="center" columnGap={0.75} flexShrink={0} {...(m.msg.flash ? { backgroundColor: m.msg.flash, paddingX: 1 } : {})}>
      {draw('kc-msg-i', glyphMark(m.msg.icon, m.msg.mark, m.msg.alt), m.msg.alt)}
      {words ? <Text key="kc-msg-t" size="caption" weight="semibold" color={m.msg.ink}>{words}</Text> : null}
      {act ? <Button key="kc-do" variant={act.primary ? 'primary' : 'secondary'} onPress={on.act}>{act.label}</Button> : null}
    </Box>
  )
  const label = openLabel(m, l.narrow)
  return (
    <Box key="kc-band" flexDirection="row" alignItems="center" justifyContent="space-between" flexWrap="nowrap" width="100%">
      <Box key="kc-left" flexDirection="row" alignItems="center" columnGap={1.5} flexShrink={1} overflow="hidden">
        <Svg key="kc-mark" source={LOGO_SVG} alt="Kapex Cortex" width={22} height={22} />
        <Box key="kc-vitals" flexDirection="row" alignItems="center" columnGap={1.5} flexShrink={0}>{vitals}</Box>
        {draw('kc-rule', RULE, ' ')}
        {msg}
      </Box>
      <Box key="kc-right" flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
        {l.refresh || m.failed ? <Button key="kc-refresh" plain onPress={on.refresh}>{m.failed ? 'Retry' : '↻'}</Button> : null}
        <Button key="kc-open" variant="secondary" onPress={on.open}>{label.includes(' · ') ? <Text>{label.replace(/ · \d+$/, '')}<Text color="warning" weight="semibold">{` · ${m.waiting}`}</Text></Text> : label}</Button>
      </Box>
    </Box>
  )
}
