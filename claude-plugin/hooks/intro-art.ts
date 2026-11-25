// The intro's small drawings: one per point, in place of an icon, each showing the thing itself (a ring filling, a
// cache draining, a switch turning off). 44 × 32 px, Kapex Emerald on a neutral grey that reads on light and dark.
// When a step opens they play once (about a second, staggered down the list); the resting picture is the final one,
// and every fade starts at 40%, so a surface that ignores animation, or shows only a first frame, still shows it.
import { K } from './theme'

export type PointArt = 'context' | 'cache' | 'tools' | 'pinned' | 'trail' | 'exchanges' | 'evidence' | 'decide' | 'undo'
const G = '#9CA3AF', E = K.emerald, S = K.sage
const LAND = 'calcMode="spline" keyTimes="0;1" keySplines="0.25 0.8 0.25 1"'
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="32" viewBox="0 0 44 32" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

/** One attribute easing from `from` to its resting value, once, `at` seconds in. */
const once = (live: boolean, attr: string, from: string | number, to: string | number, at: number, dur = 0.6) =>
  live ? `<animate attributeName="${attr}" from="${from}" to="${to}" begin="${at.toFixed(2)}s" dur="${dur}s" fill="freeze" ${LAND}/>` : ''
/** A whole group rising 3 px into place as it fades up from 40%. */
const rise = (live: boolean, at: number, body: string) => live
  ? `<g opacity="1">${once(live, 'opacity', 0.4, 1, at, 0.45)}<animateTransform attributeName="transform" type="translate" from="0 3" to="0 0" begin="${at.toFixed(2)}s" dur="0.5s" fill="freeze" ${LAND}/>${body}</g>`
  : `<g>${body}</g>`
const bar = (x: number, y: number, w: number, c = G, o = 0.5, h = 3) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${c}" fill-opacity="${o}"/>`

const ART: Record<PointArt, (live: boolean, t: number) => string> = {
  // a context ring filling to about 60%
  context: (l, t) => { const c = 2 * Math.PI * 11, v = c * 0.4
    return `<circle cx="22" cy="16" r="11" stroke="${G}" stroke-opacity="0.3" stroke-width="4"/><circle cx="22" cy="16" r="11" stroke="${E}" stroke-width="4" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${v.toFixed(1)}" transform="rotate(-90 22 16)">${once(l, 'stroke-dashoffset', c.toFixed(1), v.toFixed(1), t, 0.9)}</circle>` },
  // the cache: a bar that drains as its time runs out, a small clock beside it
  cache: (l, t) => `<circle cx="9" cy="16" r="6" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/><path d="M9 12.5V16l2.4 1.6" stroke="${G}" stroke-width="1.6"/>${bar(19, 14.5, 22, G, 0.25, 4)}<rect x="19" y="14.5" width="13" height="4" rx="2" fill="${S}">${once(l, 'width', 22, 13, t, 1)}</rect>`,
  // a tool switching off
  tools: (l, t) => `<rect x="8" y="9" width="28" height="14" rx="7" fill="${G}" fill-opacity="0.3">${once(l, 'fill-opacity', 0.9, 0.3, t, 0.5)}</rect><circle cx="15" cy="16" r="5" fill="#fff" fill-opacity="0.95" stroke="${G}" stroke-opacity="0.55" stroke-width="1">${once(l, 'cx', 29, 15, t, 0.5)}</circle>`,
  // a note with a pin settling on it
  pinned: (l, t) => `<rect x="11" y="6" width="22" height="22" rx="4" fill="${G}" fill-opacity="0.1" stroke="${G}" stroke-opacity="0.5" stroke-width="1.5"/>${bar(15, 15, 13)}${bar(15, 21, 9)}`
    + rise(l, t, `<circle cx="28" cy="8" r="3.4" fill="${E}"/><path d="M28 11.4v4" stroke="${E}" stroke-width="1.6"/>`),
  // one line per turn: three marks arriving on a line
  trail: (l, t) => `<path d="M6 16H38" stroke="${G}" stroke-opacity="0.4" stroke-width="1.5"/>` + [10, 22, 34].map((x, i) => rise(l, t + i * 0.15, `<circle cx="${x}" cy="16" r="3.6" fill="${i === 2 ? E : S}"/>`)).join(''),
  // the last exchanges kept word for word: two bubbles
  exchanges: (l, t) => rise(l, t, `<rect x="4" y="5" width="24" height="10" rx="5" fill="${G}" fill-opacity="0.35"/>`) + rise(l, t + 0.2, `<rect x="16" y="18" width="24" height="10" rx="5" fill="${E}" fill-opacity="0.85"/>`),
  // evidence: lines ticked off one by one
  evidence: (l, t) => [7, 16, 25].map((y, i) => `${bar(17, y - 1.5, 20)}${rise(l, t + i * 0.15, `<path d="M7 ${y}l2.5 2.5 4.5-5" stroke="${E}" stroke-width="2"/>`)}`).join(''),
  // you decide: Apply and Keep, the choice lighting up
  decide: (l, t) => `<rect x="3" y="10" width="18" height="12" rx="4" fill="${E}">${once(l, 'fill-opacity', 0.3, 1, t + 0.2, 0.4)}</rect><rect x="24" y="10" width="17" height="12" rx="4" stroke="${G}" stroke-opacity="0.6" stroke-width="1.4"/>${bar(7, 14.5, 10, '#fff', 0.9)}${bar(28, 14.5, 9)}`,
  // undo: a note with an arrow curling back
  undo: (l, t) => `<rect x="5" y="7" width="18" height="20" rx="3" fill="${G}" fill-opacity="0.1" stroke="${G}" stroke-opacity="0.5" stroke-width="1.5"/>${bar(9, 13, 10)}${bar(9, 19, 7)}`
    + `<path d="M38 22a8 8 0 1 0-8 -10" stroke="${E}" stroke-width="2" stroke-dasharray="40" stroke-dashoffset="0">${once(l, 'stroke-dashoffset', 40, 0, t, 0.8)}</path><path d="M26.5 9.5L30 12l2-4" stroke="${E}" stroke-width="2"/>`,
}

const made = new Map<string, string>()
/** A point's drawing; `live` plays it once, `i` is its place in the list (each starts a little after the one above). */
export function pointArt(kind: PointArt, live: boolean, i = 0): string {
  const key = `${kind}|${live}|${i}`
  let s = made.get(key)
  if (!s) { s = svg(ART[kind](live, 0.25 + i * 0.18)); if (made.size < 64) made.set(key, s) }
  return s
}

/** The trust line's mark: a small shield with a tick, filled, as icons at this size are. */
export const SHIELD = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14"><path d="M7 1l5 2v3.6c0 3-2.1 5.1-5 6.4-2.9-1.3-5-3.4-5-6.4V3z" fill="${K.emerald}"/><path d="M4.6 7.1l1.7 1.7 3.2-3.4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
