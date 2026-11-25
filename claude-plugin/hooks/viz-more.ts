// More chart forms for Overview, each for one kind of data (viz.ts has the rest):
//   hours     → the 5-hour plan as five one-hour blocks, filled left to right
//   week      → the week as one bar of seven day segments, a marker at "now", day initials under it
//   hourglass → cache time left: sand on top is what remains
//   turnDots  → recent turns, one rounded square each, coloured by how it went, newest on the right
//   lineBars  → memory files against Claude's 200-line limit: name, bar with the limit marked, "22 / 200"
// Pure functions: data in, SVG text out. Animation plays only when the caller says the values changed.
import { esc, FONT, K, levelColor, textWidth } from './theme'

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
const ease = 'calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1" fill="freeze"'
const f1 = (n: number) => n.toFixed(1)

/** A meter cut into `n` equal segments, filled left to right to the share used (the current segment partly). With
 * labels, one under each segment (the current one, `today`, in emerald); with `now`, a small marker above the bar at
 * where "now" is in the window, so use reads against time. The 5-hour plan and the week share this one shape, gap,
 * height and corner, so the two meters line up as a pair. Everything is drawn inside the declared height. */
function segBar(o: { n: number; share: number; width: number; now?: number; today?: number; labels?: string[]; animate: boolean; step: number }): string {
  const W = Math.round(o.width), n = o.n, gap = 4, bw = (W - gap * (n - 1)) / n
  const lab = o.labels?.length === n, mark = o.now !== undefined
  // air above the marker (it never touches the value row) and under the labels (they never touch the caption)
  const top = mark ? 11 : 0, BH = 10, H = top + BH + (lab ? 21 : 4)
  const s = Math.max(0, Math.min(1, o.share)), col = levelColor(s, 0.7, 0.9)
  const segs = Array.from({ length: n }, (_, i) => {
    const x = i * (bw + gap), part = Math.max(0, Math.min(1, s * n - i)), w = part * bw
    const fill = part > 0 ? `<rect x="${f1(x)}" y="${top}" width="${f1(Math.max(3, w))}" height="${BH}" rx="3" fill="${col}">${o.animate ? `<animate attributeName="width" from="0" to="${f1(Math.max(3, w))}" begin="${(i * o.step).toFixed(2)}s" dur="0.32s" ${ease}/>` : ''}</rect>` : ''
    const on = o.today === i
    const t = lab ? `<text x="${f1(x + bw / 2)}" y="${top + BH + 14}" text-anchor="middle" ${FONT} font-size="10" font-weight="${on ? 650 : 450}" fill="${on ? K.emerald : K.ink}">${esc(o.labels![i]!)}</text>` : ''
    return `<rect x="${f1(x)}" y="${top}" width="${f1(bw)}" height="${BH}" rx="3" fill="${K.pill}"/>${fill}${t}`
  }).join('')
  const mx = mark ? Math.max(4, Math.min(W - 4, o.now! * W)) : 0
  const marker = mark ? `<path d="M${f1(mx - 4)} 2.5H${f1(mx + 4)}L${f1(mx)} 7.5Z" fill="${K.emerald}" stroke="${K.emerald}" stroke-width="1" stroke-linejoin="round"/>` : ''
  return svg(W, H, segs + marker)
}

/** The 5-hour plan as five one-hour blocks; with the window known, each hour's clock time under it and "now" above. */
export function hours(o: { share: number; width: number; now?: number; today?: number; labels?: string[]; animate: boolean }): string {
  return segBar({ ...o, n: 5, step: 0.12 })
}

/** The week as the 5-hour meter's sibling: seven day segments, day initials under them from the day the week began,
 * today's in emerald, and "now" above. No per-day use is drawn, because none is known. */
export function week(o: { share: number; width: number; now?: number; today?: number; labels?: string[]; animate: boolean }): string {
  return segBar({ ...o, n: 7, step: 0.08 })
}

/** An hourglass: the sand still on top is the cache time left, the rest has run through. Drawn still. */
export function hourglass(o: { share: number; color: string; size?: number }): string {
  const S = o.size ?? 34, s = Math.max(0, Math.min(1, o.share))
  const top = `M7 4 C7 13 14 15 15 18 C16 15 23 13 23 4 Z`, bot = `M7 32 C7 23 14 21 15 18 C16 21 23 23 23 32 Z`
  const yTop = 5 + (1 - s) * 12, yBot = 31 - (1 - s) * 12
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(S * 30 / 36)}" height="${S}" viewBox="0 0 30 36" fill="none">`
    + `<defs><clipPath id="hgt"><path d="${top}"/></clipPath><clipPath id="hgb"><path d="${bot}"/></clipPath></defs>`
    + (s > 0 ? `<rect x="0" y="${f1(yTop)}" width="30" height="${f1(18 - yTop)}" fill="${o.color}" clip-path="url(#hgt)"/>` : '')
    + (s < 1 ? `<rect x="0" y="${f1(yBot)}" width="30" height="${f1(32 - yBot)}" fill="${o.color}" fill-opacity="0.45" clip-path="url(#hgb)"/>` : '')
    + (s > 0 && s < 1 ? `<path d="M15 18V${f1(yBot)}" stroke="${o.color}" stroke-width="1.2" stroke-opacity="0.8"/>` : '')
    + `<path d="${top}M7 32 C7 23 14 21 15 18 C16 21 23 23 23 32" stroke="#9CA3AF" stroke-opacity="0.7" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<path d="M4 3.5H26M4 32.5H26" stroke="#9CA3AF" stroke-width="2.6" stroke-linecap="round"/></svg>`
}

/** Recent turns, oldest left, newest right: one rounded square each in its outcome colour, a hover title each. */
export function turnDots(o: { items: { color: string; title: string }[]; animate: boolean; size?: number }): string {
  const D = o.size ?? 13, gap = 5, n = o.items.length
  const body = o.items.map((it, i) => `<rect x="${i * (D + gap)}" y="1" width="${D}" height="${D}" rx="${Math.round(D / 3.2)}" fill="${it.color}" fill-opacity="${it.color === K.silver ? 0.55 : 0.9}"><title>${esc(it.title)}</title>${o.animate ? `<animate attributeName="opacity" from="0" to="1" begin="${(i * 0.05).toFixed(2)}s" dur="0.3s" fill="freeze"/>` : ''}</rect>`).join('')
  return svg(Math.max(1, n * (D + gap) - gap), D + 2, body)
}

/** Memory files against their line limit: the name on the left, a bar whose end is the limit, the count on the right.
 * Emerald while short, amber past 80%, rose over the limit. */
export function lineBars(o: { items: { label: string; lines: number; limit: number }[]; width: number; animate: boolean }): string {
  const W = Math.round(o.width), ROW = 20, H = o.items.length * ROW
  const counts = o.items.map(f => `${f.lines} / ${f.limit}`)
  const RW = Math.max(...counts.map(c => textWidth(c, 10.5))) + 2
  const fit = (t: string, max: number) => { if (textWidth(t, 11) <= max) return t; let x = t; while (x.length > 4 && textWidth(`…${x}`, 11) > max) x = x.slice(1); return `…${x}` }
  const LW = Math.min(W * 0.46, Math.max(...o.items.map(f => textWidth(f.label, 11))) + 4)
  const bx = LW + 8, bw = Math.max(30, W - bx - RW - 10)
  const body = o.items.map((f, i) => {
    const y = i * ROW + ROW / 2, s = Math.min(1, f.lines / Math.max(1, f.limit)), w = Math.max(3, s * bw)
    const col = f.lines > f.limit ? K.rose : f.lines > f.limit * 0.8 ? K.amber : K.emerald
    return `<text x="0" y="${y + 4}" ${FONT} font-size="11" fill="${K.ink}">${esc(fit(f.label, LW))}<title>${esc(f.label)}</title></text>`
      + `<rect x="${f1(bx)}" y="${y - 3}" width="${f1(bw)}" height="6" rx="3" fill="${K.pill}"/>`
      + `<rect x="${f1(bx)}" y="${y - 3}" width="${f1(w)}" height="6" rx="3" fill="${col}">${o.animate ? `<animate attributeName="width" from="0" to="${f1(w)}" begin="${(i * 0.08).toFixed(2)}s" dur="0.6s" ${ease}/>` : ''}</rect>`
      + `<path d="M${f1(bx + bw)} ${y - 6}V${y + 6}" stroke="#9CA3AF" stroke-opacity="0.7" stroke-width="1.5" stroke-linecap="round"/>`
      + `<text x="${W}" y="${y + 4}" text-anchor="end" ${FONT} font-size="10.5" font-weight="600" fill="${K.ink}">${esc(counts[i]!)}</text>`
  }).join('')
  return svg(W, H, body)
}
