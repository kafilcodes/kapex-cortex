// Charts for the Kapex Cortex panel, one form per kind of data (never the same bar everywhere):
//   arcGauge  → how full the context is, with the compaction point
//   capsules  → what each message carries, by category (vertical pills)
//   tiles     → memories by type (bento swatches)
//   area      → trends over turns (smooth area sparkline)
//   micro     → a share inside a KPI cell; drain → cache time left, emptying by itself (one-shot, no timers)
//   lanes     → the timeline as swimlanes over time (turns, code, memory, sessions), one dot per event
// Pure functions: data in, SVG text out. Animation plays only when the caller says the values changed.
import { iconPaths } from './icons'
import { esc, FONT, K, levelColor, textWidth } from './theme'


const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
const grow = (on: boolean, attr: string, to: string, dur = '0.7s') => on ? `<animate attributeName="${attr}" from="0" to="${to}" dur="${dur}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>` : ''

/** Semicircle gauge: track, fill to `pct`, a tick at the compaction point, the number in the middle. */
export function arcGauge(o: { pct: number; threshold?: number; size: number; label: string; animate: boolean }): string {
  const W = Math.round(o.size), H = Math.round(o.size * 0.62)
  const cx = W / 2, cy = H - 8, r = W / 2 - 12
  const share = Math.max(0, Math.min(1, o.pct / 100))
  const at = (s: number) => { const a = Math.PI * (1 - s); return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const }
  const [x1, y1] = at(share)
  const len = Math.PI * r
  // coloured by distance to the compaction point, not by a fixed share: 62% is fine when compaction is at 83%
  const th = o.threshold ?? 0.85
  const color = share >= th - 0.05 ? K.rose : share >= th - 0.15 ? K.amber : K.emerald
  const track = `<path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" fill="none" stroke="${K.pill}" stroke-width="12" stroke-linecap="round"/>`
  const fill = share > 0 ? `<path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${x1.toFixed(1)},${y1.toFixed(1)}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${len}" stroke-dashoffset="0">${o.animate ? `<animate attributeName="stroke-dashoffset" from="${len}" to="0" dur="0.9s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>` : ''}</path>` : ''
  let tick = ''
  if (o.threshold) {
    const a = Math.PI * (1 - o.threshold)
    const [ix, iy] = [cx + (r - 11) * Math.cos(a), cy - (r - 11) * Math.sin(a)]
    const [ox, oy] = [cx + (r + 11) * Math.cos(a), cy - (r + 11) * Math.sin(a)]
    tick = `<line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="${K.amber}" stroke-width="2.5" stroke-linecap="round"/>`
  }
  const num = `<text x="${cx}" y="${cy - r * 0.32}" text-anchor="middle" ${FONT} font-size="${Math.round(W / 6.2)}" font-weight="650" fill="${color}">${Math.round(o.pct)}%</text>`
  const cap = `<text x="${cx}" y="${cy - 2}" text-anchor="middle" ${FONT} font-size="11" fill="${K.ink}">${esc(o.label)}</text>`
  return svg(W, H, track + fill + tick + num + cap)
}

/** Vertical capsules: one pill per category, filled to its share of the largest, value above, label below. */
export function capsules(o: { items: { label: string; value: number; color: string; note?: string }[]; width: number; height: number; animate: boolean }): string {
  const items = o.items.filter((i) => i.value > 0).slice(0, 8)
  if (!items.length) return svg(Math.round(o.width), 20, `<text x="0" y="14" ${FONT} font-size="11" fill="${K.ink}">Nothing yet</text>`)
  const W = Math.round(o.width), H = Math.round(o.height)
  const slot = W / items.length, pw = Math.min(22, slot * 0.42)
  const top = 18, bottom = H - 20, span = bottom - top
  const max = Math.max(...items.map((i) => i.value))
  const body = items.map((it, i) => {
    const x = slot * i + slot / 2 - pw / 2
    const h = Math.max(pw, (it.value / max) * span)
    const y = bottom - h
    const short = it.label.length > 9 ? `${it.label.slice(0, 8)}…` : it.label
    return `<rect x="${x.toFixed(1)}" y="${top}" width="${pw.toFixed(1)}" height="${span}" rx="${(pw / 2).toFixed(1)}" fill="${K.pill}"/>`
      + `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${pw.toFixed(1)}" height="${h.toFixed(1)}" rx="${(pw / 2).toFixed(1)}" fill="${it.color}">${grow(o.animate, 'height', h.toFixed(1))}${o.animate ? `<animate attributeName="y" from="${bottom}" to="${y.toFixed(1)}" dur="0.7s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>` : ''}</rect>`
      + `<text x="${(x + pw / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle" ${FONT} font-size="10.5" font-weight="600" fill="${K.ink}">${esc(it.note ?? String(it.value))}</text>`
      + `<text x="${(x + pw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" ${FONT} font-size="10" fill="${K.ink}">${esc(short)}</text>`
  }).join('')
  return svg(W, H, body)
}

/** Bento swatches: a rounded tile per type, tinted by its colour, the count large inside; below it, the icon and name. */
export function tiles(o: { items: { label: string; value: number; color: string; icon?: string }[]; width: number; animate: boolean }): string {
  const n = o.items.length || 1, W = Math.round(o.width)
  const gap = 8, s = Math.min(60, (W - gap * (n - 1)) / n), H = Math.round(s + 22)
  const body = o.items.map((it, i) => {
    const x = i * (s + gap)
    const strong = it.value > 0
    const col = strong ? it.color : K.ink
    const labelW = textWidth(it.label, 10) + (it.icon ? 13 : 0)
    const lx = x + s / 2 - labelW / 2
    const ic = it.icon ? `<g transform="translate(${lx.toFixed(1)} ${(s + 7).toFixed(1)}) scale(0.46)" fill="none" stroke="${col}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${iconPaths(it.icon)}</g>` : ''
    return `<g>${o.animate ? `<animate attributeName="opacity" from="0" to="1" dur="${(0.3 + i * 0.07).toFixed(2)}s" fill="freeze"/>` : ''}`
      + `<rect x="${x.toFixed(1)}" y="0" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="12" fill="${strong ? it.color : K.pill}" fill-opacity="${strong ? 0.14 : 1}" stroke="${strong ? it.color : K.hairline}" stroke-opacity="${strong ? 0.45 : 1}"/>`
      + `<text x="${(x + s / 2).toFixed(1)}" y="${(s / 2 + s / 7).toFixed(1)}" text-anchor="middle" ${FONT} font-size="${Math.round(s / 2.6)}" font-weight="650" fill="${col}">${it.value}</text>`
      + ic + `<text x="${(lx + (it.icon ? 13 : 0)).toFixed(1)}" y="${H - 4}" ${FONT} font-size="10" fill="${K.ink}">${esc(it.label)}</text></g>`
  }).join('')
  return svg(Math.round(n * s + gap * (n - 1)), H, body)
}

/** Smooth area sparkline (emerald stroke, pine fill), latest point marked, optional dashed limit line. */
export function area(o: { values: number[]; width: number; height: number; max?: number; color?: string; limit?: number; animate: boolean }): string {
  const W = Math.round(o.width), H = Math.round(o.height), col = o.color ?? K.emerald
  const v = o.values.length > 1 ? o.values : [o.values[0] ?? 0, o.values[0] ?? 0]
  const max = o.max ?? Math.max(1, ...v, o.limit ?? 0) * 1.1
  const X = (i: number) => (i * W) / (v.length - 1)
  const Y = (x: number) => H - 4 - (Math.max(0, Math.min(max, x)) / max) * (H - 10)
  // a smooth curve through the points (Catmull-Rom → cubic Bézier)
  let d = `M${X(0).toFixed(1)},${Y(v[0]!).toFixed(1)}`
  for (let i = 0; i < v.length - 1; i++) {
    const p0 = v[Math.max(0, i - 1)]!, p1 = v[i]!, p2 = v[i + 1]!, p3 = v[Math.min(v.length - 1, i + 2)]!
    const c1x = X(i) + (X(i + 1) - X(Math.max(0, i - 1))) / 6, c1y = Y(p1) + (Y(p2) - Y(p0)) / 6
    const c2x = X(i + 1) - (X(Math.min(v.length - 1, i + 2)) - X(i)) / 6, c2y = Y(p2) - (Y(p3) - Y(p1)) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${X(i + 1).toFixed(1)},${Y(p2).toFixed(1)}`
  }
  const fillD = `${d} L${W},${H} L0,${H} Z`
  const lim = o.limit !== undefined ? `<line x1="0" x2="${W}" y1="${Y(o.limit).toFixed(1)}" y2="${Y(o.limit).toFixed(1)}" stroke="${K.amber}" stroke-opacity="0.7" stroke-dasharray="3 4"/>` : ''
  const last = v[v.length - 1]!
  return svg(W, H, `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity="0.32"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`
    + `${lim}<g>${o.animate ? `<animate attributeName="opacity" from="0" to="1" dur="0.6s" fill="freeze"/>` : ''}<path d="${fillD}" fill="url(#a)"/><path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`
    + `<circle cx="${W - 3}" cy="${Y(last).toFixed(1)}" r="3.5" fill="${col}" stroke="none"/></g>`)
}

/** A slim pill filled to `share` (KPI cells). */
export function micro(o: { share: number; width: number; color?: string; animate: boolean }): string {
  const W = Math.round(o.width), s = Math.max(0, Math.min(1, o.share)), w = Math.max(s > 0 ? 4 : 0, s * W)
  const col = o.color ?? levelColor(s, 0.7, 0.9)
  return svg(W, 6, `<rect width="${W}" height="6" rx="3" fill="${K.pill}"/><rect width="${w.toFixed(1)}" height="6" rx="3" fill="${col}">${grow(o.animate, 'width', w.toFixed(1))}</rect>`)
}

/** Cache time left as a pill that empties by itself over the seconds left (one animation, then still). */
export function drain(o: { share: number; seconds: number; width: number }): string {
  const W = Math.round(o.width), s = Math.max(0, Math.min(1, o.share)), w = s * W
  const col = s <= 0 ? K.rose : s < 0.2 ? K.amber : K.sage
  const anim = s > 0 && o.seconds > 0 ? `<animate attributeName="width" from="${w.toFixed(1)}" to="0" dur="${Math.round(o.seconds)}s" fill="freeze"/>` : ''
  return svg(W, 6, `<rect width="${W}" height="6" rx="3" fill="${K.pill}"/><rect width="${w.toFixed(1)}" height="6" rx="3" fill="${col}">${anim}</rect>`)
}

/** The timeline as swimlanes: one row per kind of event, one dot per event over the time span, a hover title each. */
export function lanes(o: { lanes: { label: string; color: string; dots: { t: number; title: string; color?: string }[] }[]; from: number; to: number; width: number }): string {
  const W = Math.round(o.width), LW = 64, ROW = 20, H = o.lanes.length * ROW + 18
  const span = Math.max(1, o.to - o.from), X = (t: number) => LW + ((t - o.from) / span) * (W - LW - 8)
  const days = span > 36 * 3_600_000
  const ticks: string[] = []
  const step = days ? 86_400_000 : span > 6 * 3_600_000 ? 3 * 3_600_000 : 3_600_000
  const first = Math.ceil(o.from / step) * step
  for (let t = first; t <= o.to; t += step) {
    const d = new Date(t), x = X(t).toFixed(1)
    const text = days ? d.toLocaleDateString(undefined, { weekday: 'short' }) : d.toLocaleTimeString(undefined, { hour: 'numeric' })
    ticks.push(`<line x1="${x}" y1="2" x2="${x}" y2="${H - 16}" stroke="${K.hairline}" stroke-dasharray="2 3"/><text x="${x}" y="${H - 3}" ${FONT} font-size="10" fill="${K.ink}" text-anchor="middle">${esc(text)}</text>`)
  }
  const rows = o.lanes.map((l, i) => {
    const y = i * ROW + ROW / 2 + 1
    const dots = l.dots.map(d => `<circle cx="${X(d.t).toFixed(1)}" cy="${y}" r="4.5" fill="${d.color ?? l.color}" fill-opacity="0.85" stroke="${d.color ?? l.color}"><title>${esc(d.title)}</title></circle>`).join('')
    return `<text x="0" y="${y + 4}" ${FONT} font-size="11" fill="${K.ink}">${esc(l.label)}</text><line x1="${LW}" y1="${y}" x2="${W - 8}" y2="${y}" stroke="${K.hairline}"/>${dots}`
  })
  return svg(W, H, ticks.join('') + rows.join(''))
}

/** Composition: one bar split into a segment per category (share of the whole), a 2px gap between segments. */
export function stacked(o: { items: { value: number; color: string; label: string }[]; width: number; animate: boolean }): string {
  const items = o.items.filter((i) => i.value > 0)
  const W = Math.round(o.width), H = 14, total = items.reduce((a, i) => a + i.value, 0)
  if (!total) return svg(W, H, `<rect width="${W}" height="${H}" rx="7" fill="${K.pill}"/>`)
  let x = 0
  const segs = items.map((i) => {
    const w = Math.max(3, (i.value / total) * W - 2)
    const r = `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="${H}" rx="3" fill="${i.color}"><title>${esc(i.label)}</title>${o.animate ? `<animate attributeName="opacity" from="0" to="1" dur="0.6s" fill="freeze"/>` : ''}</rect>`
    x += w + 2
    return r
  })
  return svg(W, H, `<clipPath id="sc"><rect width="${W}" height="${H}" rx="7"/></clipPath><g clip-path="url(#sc)">${segs.join('')}</g>`)
}

/** Ranking: a rounded progress bar, filled to the share of the largest. */
export function lollipop(o: { share: number; width: number; color: string; animate: boolean }): string {
  const W = Math.round(o.width), s = Math.max(0, Math.min(1, o.share)), x = Math.max(8, s * W)
  return svg(W, 8, `<rect width="${W}" height="8" rx="4" fill="${K.pill}"/><rect width="${x.toFixed(1)}" height="8" rx="4" fill="${o.color}">${grow(o.animate, 'width', x.toFixed(1))}</rect>`)
}
