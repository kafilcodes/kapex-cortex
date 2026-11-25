// Charts for Costs → your 5-hour plan, each a different form for a different kind of data:
//   paceTrack   the window as a timeline: usage split by chat, the now marker, and where this pace lands at reset
//   splitBar    a share of 100% (the models), names inside the segments where they fit
//   waffle      a part of a whole as 20 squares (your chats vs subagents)
//   toolBlocks  counts as blocks sized by count, names inside (the tools called)
// Plain SVG with measured system-font text, legible on light and dark, nothing animated while idle.
import { clock } from './charts'
import { esc, FONT, HEAT, K, textWidth } from './theme'

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const svg = (w: number, h: number, body: string, title = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${title ? `<title>${esc(title)}</title>` : ''}${body}</svg>`

/** The 5-hour window from its start to its reset. The track fills to the % used, split by chat (each its colour);
 * a needle marks now; a dashed line runs on from the fill at today's pace to where it would be at the reset (rose
 * past 100%, with the time it would run out). Hour ticks carry clock times. */
export function paceTrack(o: { used: number; start: number; reset: number; now: number; parts: { share: number; color: string; label: string }[]; width: number }): { svg: string; out: number | null; atReset: number; early: boolean } {
  const W = Math.max(240, Math.round(o.width)), H = 58, x0 = 2, x1 = W - 2, tw = x1 - x0, ty = 14, th = 14
  const span = Math.max(1, o.reset - o.start), el = clamp((o.now - o.start) / span, 0, 1)
  const used = clamp(o.used / 100, 0, 1)
  // today's pace: % per share of the window so far; where it lands at the reset, and when it would reach 100%
  // in the first ~6 minutes there is no pace yet: the projection stays at what is used (never below it)
  const early = el <= 0.02
  const pace = early ? 0 : used / el
  const atReset = early ? used : clamp(pace, used, 9)
  const outAt = pace > 1 && used < 1 ? o.start + span * (1 / pace) : null
  const total = o.parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1
  let x = x0
  const fill = o.parts.filter(p => p.share > 0).map((p, i, all) => {
    const w = (p.share / total) * used * tw, gap = i < all.length - 1 ? 1.5 : 0
    const r = `<rect x="${f1(x)}" y="${ty}" width="${f1(Math.max(1, w - gap))}" height="${th}" fill="${p.color}"><title>${esc(p.label)}</title></rect>`
    x += w
    return r
  }).join('')
  const fillEnd = x0 + used * tw, nowX = x0 + el * tw
  const projEnd = x0 + clamp(atReset, 0, 1) * tw
  const over = atReset > 1
  const proj = pace > 0 && projEnd > fillEnd + 2 ? `<path d="M${f1(fillEnd)} ${ty + th / 2}H${f1(projEnd)}" stroke="${over ? HEAT.bad : K.ink}" stroke-width="2" stroke-dasharray="3 4" stroke-linecap="round"/>${over ? `<circle cx="${f1(x1 - 4)}" cy="${ty + th / 2}" r="3" fill="${HEAT.bad}"/>` : ''}` : ''
  const ticks: string[] = []
  // the first label starts at the left edge, the last ends at the right one, the rest sit centred on their tick; a
  // middle label that would come within 8 px of a label already placed (measured) is left out, so none ever touch
  const labs = Array.from({ length: 6 }, (_, h) => {
    const tx = x0 + (h / 5) * tw, t = h === 5 ? `reset ${clock(o.reset)}` : clock(o.start + h * 3_600_000), w = textWidth(t, 10)
    return { h, tx, t, l: h === 0 ? tx : h === 5 ? tx - w : tx - w / 2, r: h === 0 ? tx + w : h === 5 ? tx : tx + w / 2 }
  })
  const placed = [labs[0]!, labs[5]!]
  for (const b of labs.slice(1, 5)) if (placed.every(p => b.r + 8 <= p.l || b.l >= p.r + 8)) placed.push(b)
  for (let h = 0; h <= 5; h++) {
    const tx = x0 + (h / 5) * tw
    ticks.push(`<line x1="${f1(tx)}" y1="${ty + th + 3}" x2="${f1(tx)}" y2="${ty + th + 7}" stroke="${K.hairline}"/>`)
    const b = placed.find(p => p.h === h)
    if (b) ticks.push(`<text x="${f1(tx)}" y="${H - 6}" text-anchor="${h === 0 ? 'start' : h === 5 ? 'end' : 'middle'}" ${FONT} font-size="10" fill="${K.ink}">${esc(b.t)}</text>`)
  }
  const nowLab = 'now'
  const needle = `<line x1="${f1(nowX)}" y1="${ty - 4}" x2="${f1(nowX)}" y2="${ty + th + 4}" stroke="${K.ink}" stroke-width="2" stroke-linecap="round"/><text x="${f1(clamp(nowX, x0 + 12, x1 - 12))}" y="9" text-anchor="middle" ${FONT} font-size="10" font-weight="600" fill="${K.ink}">${nowLab}</text>`
  const title = `${Math.round(o.used)}% of the 5-hour plan used, ${Math.round(el * 100)}% of the window gone. At this pace: ${outAt ? `out at ${clock(outAt)}` : `about ${Math.round(atReset * 100)}% at the reset`}.`
  const body = `<defs><clipPath id="pt${W}"><rect x="${x0}" y="${ty}" width="${tw}" height="${th}" rx="${th / 2}"/></clipPath></defs>`
    + `<g clip-path="url(#pt${W})"><rect x="${x0}" y="${ty}" width="${tw}" height="${th}" fill="${K.pill}"/>${fill}</g>${proj}${ticks.join('')}${needle}`
  return { svg: svg(W, H, body, title), out: outAt, atReset, early }
}

/** Shares of 100% in one rounded bar, the name and share inside each segment where they fit (else on hover). */
export function splitBar(o: { items: { label: string; value: number; color: string }[]; width: number }): string {
  const W = Math.max(160, Math.round(o.width)), H = 24
  const total = o.items.reduce((a, it) => a + Math.max(0, it.value), 0) || 1
  let x = 0
  const segs = o.items.filter(it => it.value > 0).map((it, i, all) => {
    const w = (it.value / total) * W, gap = i < all.length - 1 ? 2 : 0
    const words = `${it.label} ${Math.round((100 * it.value) / total)}%`
    const fits = textWidth(words, 11, 600) + 14 <= w - gap
    const seg = `<rect x="${f1(x)}" y="0" width="${f1(Math.max(1, w - gap))}" height="${H}" fill="${it.color}" fill-opacity="0.85"><title>${esc(words)}</title></rect>`
      + (fits ? `<text x="${f1(x + 8)}" y="16" ${FONT} font-size="11" font-weight="600" fill="#05130D">${esc(words)}</text>` : '')
    x += w
    return seg
  }).join('')
  return svg(W, H, `<defs><clipPath id="sb${W}"><rect width="${W}" height="${H}" rx="7"/></clipPath></defs><g clip-path="url(#sb${W})">${segs}</g>`)
}

/** A part of a whole as 20 squares in two rows: the first share's squares in its colour, the rest in the second's. */
export function waffle(o: { a: number; b: number; colors: [string, string]; titles: [string, string] }): string {
  const n = 20, total = Math.max(1e-9, o.a + o.b)
  const on = o.a + o.b > 0 ? clamp(Math.round((o.a / total) * n), o.a > 0 ? 1 : 0, o.b > 0 ? n - 1 : n) : 0
  const D = 11, g = 3
  const cells = Array.from({ length: n }, (_, i) => {
    const col = Math.floor(i / 2), row = i % 2, mine = i < on
    return `<rect x="${col * (D + g)}" y="${row * (D + g)}" width="${D}" height="${D}" rx="3" fill="${o.a + o.b > 0 ? (mine ? o.colors[0] : o.colors[1]) : K.pill}" fill-opacity="${mine ? 0.9 : 0.7}"><title>${esc(mine ? o.titles[0] : o.titles[1])}</title></rect>`
  }).join('')
  return svg(10 * (D + g) - g, 2 * (D + g) - g, cells)
}

/** Counts as blocks in one row, each as wide as its share (with a floor), the name and count inside where they fit. */
export function toolBlocks(o: { items: { label: string; n: number }[]; width: number }): { svg: string; unnamed: { label: string; n: number }[] } {
  const W = Math.max(160, Math.round(o.width)), H = 30, gap = 3
  const items = o.items.filter(it => it.n > 0)
  const floor = Math.min(26, (W - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length)) // a narrow drawing shrinks the floor, never spills
  const total = items.reduce((a, it) => a + it.n, 0) || 1
  const room = W - gap * Math.max(0, items.length - 1) - floor * items.length
  let x = 0
  const unnamed: { label: string; n: number }[] = []
  const shades = ['#10B981', '#14B8A6', '#0E9F6E', '#34D399', '#0D9488', '#6EE7B7', '#5EEAD4']
  const body = items.map((it, i) => {
    const w = floor + Math.max(0, room) * (it.n / total)
    const words = `${it.label} ${it.n}`, short = String(it.n)
    const t = textWidth(words, 11, 600) + 12 <= w ? words : textWidth(short, 11, 600) + 10 <= w ? short : ''
    if (t !== words) unnamed.push(it) // too narrow for its name: the card lists it under the blocks
    const b = `<rect x="${f1(x)}" y="0" width="${f1(w)}" height="${H}" rx="6" fill="${shades[i % shades.length]}" fill-opacity="${(0.85 - i * 0.08).toFixed(2)}"><title>${esc(`${it.label}: called ${it.n} time${it.n === 1 ? '' : 's'}`)}</title></rect>`
      + (t ? `<text x="${f1(x + 7)}" y="19" ${FONT} font-size="11" font-weight="600" fill="#05130D">${esc(t)}</text>` : '')
    x += w + gap
    return b
  }).join('')
  return { svg: svg(W, H, body), unnamed }
}
