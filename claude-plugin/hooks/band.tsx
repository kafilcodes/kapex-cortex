import type { Hook } from 'claude-code'

import { cacheState, clock } from './charts'
import { act, handOff, openPane, planLimits, readFail, refresh, refreshNow, refreshSoon, setCostsSub, setFlow, setSub, setTab, snapshot, statusOrSaved, toReview, type Dollar } from './data'
import type { Tip } from './tips'
import { switchDue } from './switch'
import { tipFor } from './tips'
import { iconPaths } from './icons'
import { kit } from './kit'
import { LOGO_SVG } from './logo'
import { esc, FONT, K, levelColor, RESUME, textWidth } from './theme'
import { flaggedNotes } from './switch'
import { readPulse } from './pulse'
import { readFlash, type FlashKind } from './notify'
import { icon } from './icons'

/** How each kind of notification looks in the strip. */
const FLASH: Record<FlashKind, { icon: string; color: string; alt: string }> = { done: { icon: 'check', color: K.emerald, alt: 'Done' }, dream: { icon: 'dream', color: K.sage, alt: 'Dream finished' }, alert: { icon: 'alert', color: K.amber, alt: 'Needs a look' } }

// The status strip above the prompt, like a phone's status bar: what Claude Code doesn't show you at a glance.
// One line, never wrapping: the logo, one pill (context · cache · 5-hour plan), one more pill (the tip that matters
// now, else the handoff state), and Open Cortex pinned to the far right with the review count on it. About 620 px
// at most, so it fits the chat column; the week and the full reason show on hover. Transparent, so it sits on
// Claude Code's own background in light and dark mode. No timers: the cache bar empties through one SVG animation.
type BandEvent = Parameters<Hook<'ui.render'>>[1]

const H = 22
type Part = (x: number) => [string, number]

/** One group as a small pill drawing: parts laid out left to right with a dot between them. */
function pill(parts: Part[]): string {
  let x = 9
  const out: string[] = []
  parts.forEach((p, i) => {
    if (i) { out.push(`<circle cx="${x + 6}" cy="11" r="1.2" fill="${K.ink}" fill-opacity="0.6"/>`); x += 12 }
    const [svg, w] = p(x)
    out.push(svg)
    x += w
  })
  const W = Math.ceil(x + 9)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${H / 2 - 0.5}" fill="${K.pill}" stroke="${K.hairline}"/>${out.join('')}</svg>`
}
const label = (t: string, color: string = K.ink, weight = 400): Part => (x) => [`<text x="${x}" y="15" ${FONT} font-size="11" font-weight="${weight}" fill="${color}">${esc(t)}</text>`, textWidth(t, 11, weight)]
const ring = (share: number, color: string): Part => (x) => {
  const r = 6, len = 2 * Math.PI * r
  return [`<circle cx="${x + r}" cy="11" r="${r}" fill="none" stroke="${K.hairline}" stroke-width="2.6"/><circle cx="${x + r}" cy="11" r="${r}" fill="none" stroke="${color}" stroke-width="2.6" stroke-dasharray="${(Math.max(0, Math.min(1, share)) * len).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${x + r} 11)" stroke-linecap="round"/>`, 2 * r + 5]
}
const bar = (share: number, color: string, drainSec = 0, w = 28): Part => (x) => {
  const f = Math.max(0, Math.min(1, share)) * w
  const anim = f > 0 && drainSec > 0 ? `<animate attributeName="width" from="${f.toFixed(1)}" to="0" dur="${Math.round(drainSec)}s" fill="freeze"/>` : ''
  return [`<rect x="${x}" y="8" width="${w}" height="6" rx="3" fill="${K.hairline}"/><rect x="${x}" y="8" width="${f.toFixed(1)}" height="6" rx="3" fill="${color}">${anim}</rect>`, w + 5]
}
const glyph = (name: string, color: string): Part => (x) => [`<g transform="translate(${x} 4) scale(0.58)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconPaths(name)}</g>`, 18]
/** An icon on its own: its drawn width, without the gap kept for words after it (so it sits centred in its pill). */
const alone = (part: Part): Part => (x) => [part(x)[0], 14]
/** Two parts drawn as one (an indicator and its words). */
const both = (a: Part, b: Part): Part => (x) => { const [s1, w1] = a(x); const [s2, w2] = b(x + w1); return [s1 + s2, w1 + w2] }

/** The tip as a pill: its icon and words; the full reason shows on hover (an SVG title). */
export function tipPill(t: Tip, compact = false): string {
  const svg = pill([compact ? alone(glyph(t.icon, t.color)) : both(glyph(t.icon, t.color), label(t.text, t.color === K.rose ? K.rose : K.ink, 600))])
  return svg.replace(/(<svg[^>]*>)/, `$1<title>${esc(t.detail)}</title>`)
}

export type Strip = { ctx: number | null; compactAt?: number; cacheShare: number; cacheSec: number; cacheText: string; cacheColor: string; plan: number | null; week: number | null; handoff: 'ready' | 'saved' | 'none'; waiting: number }

/** The two pill drawings, and the same in words (for screen readers and the terminal). With a tip, the plan moves
 * out of the main pill (the tip says when the plan matters), so the line keeps its width. */
export function stripParts(o: Strip, tip: Tip | null = null, room = Infinity, reserve = 0): { main: string; side: string; words: string } {
  const near = (gap: number) => o.compactAt !== undefined && o.ctx !== null && o.ctx / 100 >= o.compactAt - gap
  const ctxColor = near(0.05) ? K.rose : near(0.15) ? K.amber : K.emerald
  // words a first-time reader gets in one pass: "Chat 42% full · cache warm till 9:03 PM · 5h plan 0%"
  const mainOf = (withPlan: boolean) => {
    const parts: Part[] = []
    if (o.ctx !== null) parts.push(both(ring(o.ctx / 100, ctxColor), label(`Chat ${Math.round(o.ctx)}% full`)))
    parts.push(both(bar(o.cacheShare, o.cacheColor, o.cacheSec, 22), label(o.cacheText, o.cacheColor === K.rose ? K.rose : K.ink)))
    if (o.plan !== null && withPlan) parts.push(both(bar(o.plan / 100, levelColor(o.plan / 100, 0.7, 0.9), 0, 22), label(`5h plan ${o.plan}%`)))
    return pill(parts)
  }
  const words = [o.ctx !== null ? `chat ${o.ctx}% full` : '', o.cacheText, o.plan !== null ? `5h plan ${o.plan}%` : '', o.week !== null ? `week ${o.week}%` : '', o.handoff === 'ready' ? 'handoff ready' : '', o.waiting ? `${o.waiting} to review` : ''].filter(Boolean).join(' · ')
  const titled = (svg: string) => svg.replace(/(<svg[^>]*>)/, `$1<title>${esc(words)}</title>`)
  const hc = o.handoff === 'ready' ? K.amber : o.handoff === 'saved' ? K.emerald : K.ink
  // no tip: all is well. Say so (and that the handoff is kept), so the strip never looks like it wants something
  const full = tip ? tipPill(tip) : o.handoff === 'ready' ? pill([both(glyph('link', K.emerald), label('handoff ready', K.ink, 600))]) : pill([both(glyph('check', K.emerald), label(o.handoff === 'saved' ? 'All good · handoff saved' : 'All good', K.ink, 600))])
  // narrower and narrower: the full side pill; then "All good" without the handoff words; then the plan leaves the main
  // pill (it shows on hover); last, a tip keeps only its icon. All is well always says "All good", never a lone tick.
  const w = (svg: string) => Number(/width="(\d+)"/.exec(svg)?.[1] ?? 0)
  const short = tip ? tipPill(tip, true).replace(/(<svg[^>]*>)(?!<title>)/, `$1<title>${esc(tip.text)}</title>`) : pill([both(glyph(o.handoff === 'ready' ? 'link' : 'check', K.emerald), label(o.handoff === 'ready' ? 'handoff ready' : 'All good', K.ink, 600))])
  const withPlan = mainOf(!tip), noPlan = mainOf(false)
  const fits = (a: string, b: string) => w(a) + w(b) + 8 <= room
  // a notification chip takes the side pill's place for a few seconds: the main pill makes room for it the same way
  if (reserve > 0) return { main: titled(w(withPlan) + reserve + 8 <= room ? withPlan : noPlan), side: full, words }
  const [main, side] = fits(withPlan, full) ? [withPlan, full] : fits(withPlan, short) ? [withPlan, short] : fits(noPlan, short) ? [noPlan, short] : [noPlan, short]
  return { main: titled(main), side, words }
}

/** Pixels left for the two pills: the band's width (Claude Code passes it in cells) less the logo, the buttons and gaps. */
function room(e: BandEvent, tip: Tip | null, waiting: number): number {
  const cols = (e as { props?: { bodyColumns?: number } }).props?.bodyColumns
  if (!cols) return Infinity
  const buttons = 44 + textWidth(`Open Cortex${waiting ? ` · ${waiting}` : ''}`, 13) + 28 + (tip?.action ? textWidth(ACTION_LABEL[tip.action] ?? '', 13) + 28 : 0)
  return cols * 7.2 - 16 - buttons - 5 * 8
}

const ACTION_LABEL: Record<string, string> = { handoff: 'Hand off', dream: 'Dream', review: 'Review', costs: 'Costs', resume: 'Resume' }

/** One press from the strip. Hand off saves the handoff and copies /cortex-resume (memory flagged by a check is shown
 * first); Dream starts one in the background (it only proposes); the others open the panel where the decision is. */
async function doTip($: Dollar, action: string, s: NonNullable<Awaited<ReturnType<typeof statusOrSaved>>>): Promise<void> {
  if (action === 'resume') { await $.prompt.submit({ text: RESUME }); return }
  if (action === 'handoff') {
    await setTab($, 'overview')
    if (flaggedNotes(s)) await setFlow($, 'confirm'); else await handOff($)
  } else if (action === 'dream') { await setTab($, 'data'); await setSub($, 'dream'); void act($, 'Dream started', ['dream']) }
  else if (action === 'review') { await setTab($, 'data'); await setSub($, 'dream') }
  else if (action === 'costs') { await setTab($, 'details'); await setCostsSub($, 'costs') }
  await openPane($)
}

/** A folder without Cortex, as last found (60 s): the strip steps aside at once, without reading state or files. */
let notHere = 0
/** The strip's two drawings, kept while what they show is the same: the strip is drawn again often (each heartbeat,
 * each state write), and rebuilding the SVG text each time is work for nothing. */
let partsMemo: { key: string; parts: ReturnType<typeof stripParts> | null } = { key: '', parts: null }

export async function renderBand($: Dollar, e: BandEvent, next: (e: BandEvent) => unknown): Promise<unknown> {
  if (Date.now() - notHere < 60_000) return next(e)
  const fl = await readFlash($) // a notification chip, while it shows (notify.ts)
  await readPulse($) // read so the heartbeat's changes (cache cooling, a plan reset) redraw the strip without a turn
  const { l, cv, vw } = await snapshot($)
  const s = await statusOrSaved($) // after a restart or an app update: the last good status at once, refreshed behind it
  const failed = await readFail($)
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const u = kit(els, e.surface)
  const waiting = toReview(s)
  const open = () => { if (waiting) { void setTab($, 'data'); void setSub($, 'dream') } void openPane($) }
  if (!s) {
    // nothing loaded yet: if this folder uses Cortex, say so and load, never an empty strip
    const here = (await $.fs.exists('.vault/cortex.json').catch(() => false)) || (await $.fs.exists('.vault/ledger.jsonl').catch(() => false))
    if (!here) { notHere = Date.now(); return next(e) }
    refreshSoon($)
    return (
      <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between" width="100%">
        <Text size="caption" color={failed ? K.amber : K.muted}>{failed ? `Cortex couldn't load: ${failed}` : 'Cortex is loading…'}</Text>
        <Box flexDirection="row" gap={1}>
          {failed ? <Button key="kc-retry" plain onPress={() => { void refresh($) }}>Retry</Button> : null}
          <Button key="kc-open" plain onPress={open}>Open Cortex</Button>
        </Box>
      </Box>
    )
  }
  if (!l) refreshSoon($)
  const rows = l?.context.rows ?? []
  const win = l?.context.window ?? 1
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const { limits } = await planLimits($, l)
  const sw = switchDue(s, l, cv, vw)
  const tip = tipFor(s, l, cv, limits, sw)
  const stripIn: Parameters<typeof stripParts>[0] = {
    ctx: l?.context.percent ?? null, compactAt: buffer ? (win - buffer) / win : undefined,
    cacheShare: cs.leftMin / (ttlMs / 60_000), cacheSec: cs.leftMin * 60,
    cacheText: cs.state === 'unknown' ? 'cache starts on reply' : cs.state === 'cold' ? 'cache cold' : `cache warm till ${clock(cs.until!)}`,
    cacheColor: { warm: K.sage, cooling: K.amber, cold: K.rose, unknown: K.ink }[cs.state],
    plan: limits.find(x => x.kind === 'five_hour')?.percentUsed ?? null, week: limits.find(x => x.kind === 'seven_day')?.percentUsed ?? null,
    handoff: s.handoff.ready ? 'ready' : s.handoff.exists ? 'saved' : 'none', waiting,
  }
  const width = room(e, tip, waiting)
  const reserve = fl ? Math.ceil(12 + 8 + 16 + textWidth(fl.text, 12, 600)) : 0 // the chip: icon, gap, padding, its words
  const pk = JSON.stringify([stripIn, tip, width, reserve])
  if (partsMemo.key !== pk || !partsMemo.parts) partsMemo = { key: pk, parts: stripParts(stripIn, tip, width, reserve) }
  const parts = partsMemo.parts!
  // the chip steps down to fit: its full words, then the first part ("Handoff saved"), and only where even that won't
  // fit beside the main pill does it take the main pill's place, for its few seconds
  const chipW = (t: string) => Math.ceil(12 + 8 + 16 + textWidth(t, 12, 600))
  const mainW = Number(/width="(\d+)"/.exec(parts.main)?.[1] ?? 0)
  const shortText = fl ? fl.text.split(' · ')[0]! : ''
  const showMain = !fl || mainW + chipW(shortText) + 8 <= width
  const chipText = !fl ? '' : (showMain ? mainW + chipW(fl.text) + 8 : chipW(fl.text)) <= width ? fl.text : shortText
  const openLabel = <Text>{'Open Cortex'}{waiting ? <Text color={K.amber} weight="semibold">{` · ${waiting}`}</Text> : null}</Text>
  if (!u.Svg) return <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between"><Text size="caption" color={waiting || (tip && tip.level !== 'ok') || fl?.kind === 'alert' ? K.amber : undefined}>{`Cortex · ${fl ? `${fl.text} · ` : ''}${tip ? `${tip.text} · ` : ''}${parts.words}`}</Text><Box flexDirection="row" gap={1}><Button key="kc-refresh" plain onPress={() => { void refreshNow($) }}>↻</Button><Button key="kc-open" plain onPress={open}>Open Cortex</Button></Box></Box>
  const Svg = u.Svg
  const draw = (key: string, svg: string, alt: string) => <Svg key={key} source={svg} alt={alt} width={Number(/width="(\d+)"/.exec(svg)?.[1] ?? 100)} height={H} isInteractive />
  return (
    <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between" flexWrap="nowrap" width="100%">
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1} overflow="hidden">
        <Svg key="kc-mark" source={LOGO_SVG} alt="Kapex Cortex" width={16} height={16} />
        {showMain ? draw('kc-main', parts.main, parts.words) : null}
        {/* a notification takes the tip's place for a few seconds: an icon and a few words on a tinted chip */}
        {fl ? (
          <Box key="kc-flash" flexDirection="row" gap={1} alignItems="center" backgroundColor={`${FLASH[fl.kind].color}24`} paddingX={1} flexShrink={1}>
            <Svg key="kc-flash-i" source={icon(FLASH[fl.kind].icon, FLASH[fl.kind].color, 12)} alt={FLASH[fl.kind].alt} width={12} height={12} />
            <Text size="caption" weight="semibold" color={fl.kind === 'alert' ? K.amber : K.text} wrap="truncate-end">{chipText}</Text>
          </Box>
        ) : draw('kc-side', parts.side, tip ? `${tip.text}. ${tip.detail}` : parts.words)}
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center" flexShrink={0}>
        {tip?.action ? <Button key="kc-do" variant={tip.level === 'act' ? 'primary' : 'secondary'} onPress={() => { void doTip($, tip.action!, s) }}>{ACTION_LABEL[tip.action]}</Button> : null}
        <Button key="kc-refresh" variant="secondary" onPress={() => { void refreshNow($) }}>{failed ? 'Retry' : '↻'}</Button>
        <Button key="kc-open" variant="secondary" onPress={open}>{openLabel}</Button>
      </Box>
    </Box>
  )
}
