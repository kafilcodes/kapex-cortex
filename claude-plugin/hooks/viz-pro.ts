// Showcase chart forms for the Kapex Cortex panel, each for one kind of data (viz.ts and viz-more.ts have the rest):
//   gauge   → how full this chat is: segmented half-ring, a tip that glows, the compaction zone marked in amber
//   heatmap → token burn per day as a contribution grid (weeks across, Mon..Sun down)
//   hourGrid→ replies by weekday and hour (7 × 24 matrix)
//   radar   → a profile over 5–6 axes (0..1 each)
//   slant   → a share as slanted stripes after a flat lead line
// Pure functions: data in, SVG text out, same input → same bytes. Drawn as still images: nothing relies on hover.
// Animation plays only when the caller says the values changed.
import { esc, FONT, K, textWidth } from './theme'

const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const ease = 'calcMode="spline" keySplines="0 0 1 1;0.2 0.8 0.2 1"'
/** Fade in after `delay` seconds: starts hidden at once (no flash before begin), then eases to `to`. */
const fadeIn = (on: boolean, delay: number, to = 1, dur = 0.35) => on
  ? `<animate attributeName="opacity" values="0;0;${to}" keyTimes="0;${(delay / (delay + dur)).toFixed(3)};1" dur="${(delay + dur).toFixed(2)}s" fill="freeze" ${ease}/>`
  : ''
const txt = (x: number, y: number, s: string, size: number, extra = '') => `<text x="${f1(x)}" y="${f1(y)}" ${FONT} font-size="${size}" fill="${K.ink}"${extra ? ` ${extra}` : ''}>${esc(s)}</text>`
/** Cut text with … until it fits `max` px. */
const fit = (t: string, size: number, max: number, weight = 400) => {
  if (textWidth(t, size, weight) <= max) return t
  let x = t
  while (x.length > 1 && textWidth(`${x}…`, size, weight) > max) x = x.slice(0, -1)
  return `${x.trimEnd()}…`
}

/** The hero context gauge. A half ring of capsule segments (one per 1/N of the window, so the amber compaction tick
 * falls exactly between two segments), empty ones a quiet track, the compaction zone tinted amber, the newest filled
 * segment glowing. A hairline guide ring sits outside, "0" and "100" under the two ends, the number in the middle with
 * a lighter % sign and a small caption under it.
 * Height = round(size/2 + 3 + w/2 + 15) where w = segment thickness (≈ 0.085 × size): about 0.6 × size. */
export function gauge(o: { pct: number; threshold?: number; size: number; label: string; animate: boolean }): string {
  const S = Math.round(o.size), cx = S / 2
  const rRing = S / 2 - 4, rOut = rRing - 7, len = rOut * 0.24, rIn = rOut - len, rm = (rOut + rIn) / 2
  const N = clamp(Math.round((Math.PI * rm) / 13.5), 15, 25)
  const w = Math.min(len * 0.5, ((Math.PI * rIn) / N) * 0.64)
  const cy = rRing + 3, H = Math.round(cy + w / 2 + 15)
  const share = clamp(o.pct / 100, 0, 1), th = o.threshold ?? 0.85
  const color = share >= th - 0.05 ? K.rose : share >= th - 0.15 ? K.amber : K.emerald
  const k = share > 0 ? Math.max(1, Math.round(share * N)) : 0
  const pt = (f: number, r: number) => { const a = Math.PI * (1 - f); return `${f1(cx + r * Math.cos(a))},${f1(cy - r * Math.sin(a))}` }
  const seg = (i: number, stroke: string, extra = '', inner = '') => `<path d="M${pt((i + 0.5) / N, rIn)}L${pt((i + 0.5) / N, rOut)}" stroke="${stroke}"${extra ? ` ${extra}` : ''}${inner ? `>${inner}</path>` : '/>'}`
  const parts: string[] = []
  // guide ring, then the compaction tick crossing it
  parts.push(`<path d="M${f1(cx - rRing)},${f1(cy)}A${f1(rRing)},${f1(rRing)} 0 0 1 ${f1(cx + rRing)},${f1(cy)}" fill="none" stroke="${K.hairline}" stroke-width="1"/>`)
  // the compaction zone: the guide ring turns amber from the threshold to the end, a tick where it starts
  parts.push(`<path d="M${pt(th, rRing)}A${f1(rRing)},${f1(rRing)} 0 0 1 ${f1(cx + rRing)},${f1(cy)}" fill="none" stroke="${K.amber}" stroke-width="1.5" stroke-opacity="0.8"/>`)
  parts.push(`<path d="M${pt(th, rRing - 3.5)}L${pt(th, rRing + 3)}" stroke="${K.amber}" stroke-width="2" stroke-linecap="round"/>`)
  const segs: string[] = []
  for (let i = 0; i < N; i++) {
    if (i < k) {
      const op = k === 1 ? 1 : 0.72 + 0.28 * (i / (k - 1))
      segs.push(seg(i, color, `stroke-opacity="${op.toFixed(2)}"`, fadeIn(o.animate, i * 0.03)))
    } else segs.push(seg(i, K.pill))
  }
  // the tip: a soft blurred copy under the newest segment
  const glow = k > 0 ? `<g filter="url(#gg${S})" opacity="0.75">${fadeIn(o.animate, k * 0.03, 0.75)}${seg(k - 1, color, `stroke-width="${f1(w + 2)}"`)}</g>` : ''
  const defs = `<defs><filter id="gg${S}" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="${f1(w * 0.55)}"/></filter></defs>`
  parts.push(glow, `<g stroke-width="${f1(w)}" stroke-linecap="round" fill="none">${segs.join('')}</g>`)
  // number, lighter % sign, caption, end labels
  const F = Math.round(S * 0.195), yc = cy - 1, yn = yc - Math.round(S * 0.07) - 4
  parts.push(`<text x="${f1(cx)}" y="${yn}" text-anchor="middle" ${FONT} font-size="${F}" font-weight="600" letter-spacing="-0.02em" fill="${color}">${Math.round(o.pct)}<tspan font-size="${Math.round(F * 0.5)}" font-weight="500" fill="${K.ink}" dx="1">%</tspan></text>`)
  const capMax = 2 * rIn - w - 12
  const cs = textWidth(o.label, 11) <= capMax ? 11 : 10
  parts.push(txt(cx, yc, fit(o.label, cs, capMax), cs, 'text-anchor="middle"'))
  parts.push(txt(cx - rm, H - 3, '0', 10, 'text-anchor="middle"'), txt(cx + rm, H - 3, '100', 10, 'text-anchor="middle"'))
  return svg(S, H, defs + parts.join(''))
}

/** Quartile levels of the non-zero values: 0 = none, 1..4 rising; the largest value is always level 4. */
function levels(vals: number[]): (v: number) => number {
  const nz = vals.filter((v) => v > 0).sort((a, b) => a - b)
  if (!nz.length) return () => 0
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))]!
  const q1 = q(0.25), q2 = q(0.5), q3 = q(0.75), max = nz[nz.length - 1]!
  return (v) => (v <= 0 ? 0 : v >= max ? 4 : v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4)
}
/** The emerald ramp as CSS classes, shared by heatmap and hourGrid (reads on light and dark). */
const RAMP = [`fill:${K.pill}`, `fill:${K.emerald};fill-opacity:.3`, `fill:${K.emerald};fill-opacity:.48`, `fill:${K.emerald};fill-opacity:.74`, `fill:${K.emerald}`]
const rampStyle = `<style>${RAMP.map((r, i) => `.l${i}{${r}}`).join('')}</style>`
/** Cell class: level 0 has none (the cells' group carries the track fill), which keeps a year of cells under 20 KB. */
const cls = (l: number) => (l ? ` class="l${l}"` : '')
/** The cells group, revealed once left to right by a soft-edged mask when animating (one animation for every cell). */
function sweep(on: boolean, id: string, w: number, h: number, cells: string): string {
  if (!on) return `<g fill="${K.pill}">${cells}</g>`
  return `<defs><linearGradient id="${id}g"><stop offset="0.5" stop-color="#fff"/><stop offset="0.62" stop-color="#000"/></linearGradient>`
    + `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}"><rect x="${-2 * w}" width="${2 * w}" height="${h}" fill="url(#${id}g)">`
    + `<animate attributeName="x" from="${-2 * w}" to="0" dur="0.9s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0.6 0.3 1"/></rect></mask></defs>`
    + `<g fill="${K.pill}" mask="url(#${id})">${cells}</g>`
}
/** "Less ▢▢▢▢▢ More", right-aligned at x = right, cells centred on y. */
function legend(right: number, y: number, c: number, r: number, id: string): string {
  const gap = 3, moreW = textWidth('More', 10), cellsW = 5 * c + 4 * gap
  const x0 = right - moreW - 6 - cellsW
  const cells = Array.from({ length: 5 }, (_, i) => `<use href="#${id}" x="${f1(x0 + i * (c + gap))}" y="${f1(y - c / 2)}" class="l${i}"/>`).join('')
  return `<defs><rect id="${id}" width="${c}" height="${c}" rx="${r}"/></defs>${cells}`
    + txt(x0 - 6, y + 3.5, 'Less', 10, 'text-anchor="end"') + txt(right, y + 3.5, 'More', 10, 'text-anchor="end"')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayNum = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000) }
const ymd = (n: number) => { const t = new Date(n * 86_400_000); return { m: t.getUTCMonth(), d: t.getUTCDate() } }

/** Daily token burn as a contribution grid: `weeks` columns ending with the week holding `end`, rows Mon..Sun,
 * quartile levels, today ringed in sage, month labels under, "Less ▢▢▢▢▢ More" bottom right.
 * c = clamp(floor((width − 33 − 3·(weeks−1)) / weeks), 8, 16 (22 for 12 weeks or fewer)), gap 3; when even 8 px cells don't fit, the oldest
 * weeks are dropped. Width = 30 + weeks·c + 3·(weeks−1) (≤ width). Height = 7·c + 51 + min(c, 10). */
export function heatmap(o: { days: { date: string; value: number }[]; end: string; weeks: number; width: number; animate: boolean }): string {
  const gap = 3, pad = 3, LW = Math.ceil(textWidth('Mon', 10)) + 6
  const weeks = clamp(Math.round(o.weeks), 1, Math.max(1, Math.floor((o.width - LW - 2 * pad + gap) / (8 + gap))))
  // few weeks (a young project) get bigger cells, up to 22 px, so the grid keeps its presence in a wide card
  const c = clamp(Math.floor((o.width - LW - 2 * pad - gap * (weeks - 1)) / weeks), 8, weeks <= 12 ? 22 : 16)
  const r = Math.round(c * 0.28), pitch = c + gap
  const gridW = weeks * c + (weeks - 1) * gap, gridH = 7 * c + 6 * gap
  const W = LW + gridW + pad, x0 = LW, y0 = pad
  const endN = dayNum(o.end), endDow = (endN + 3) % 7 // 1970-01-01 was a Thursday → Mon = 0
  const start = endN - endDow - (weeks - 1) * 7
  const byDay = new Map<number, number>()
  for (const d of o.days) { const n = dayNum(d.date); if (n >= start && n <= endN) byDay.set(n, (byDay.get(n) ?? 0) + Math.max(0, d.value)) }
  const lv = levels([...byDay.values()])
  const id = `hc${c}`
  const cols: string[] = []
  const months: { x: number; t: string; guess?: boolean }[] = []
  for (let j = 0; j < weeks; j++) {
    const x = x0 + j * pitch
    let cells = ''
    for (let i = 0; i < 7; i++) {
      const n = start + j * 7 + i
      if (n > endN) break
      cells += `<use href="#${id}" y="${y0 + i * pitch}"${cls(lv(byDay.get(n) ?? 0))}/>`
      if (ymd(n).d === 1) months.push({ x, t: MONTHS[ymd(n).m]! })
    }
    if (j === 0 && !months.length) months.push({ x, t: MONTHS[ymd(start).m]!, guess: true })
    cols.push(`<g transform="translate(${x})">${cells}</g>`)
  }
  // a label that would collide with the next one is dropped (the first column's guess gives way to a real month start)
  const keep = months.filter((m, i) => { const nx = months[i + 1]; return !nx || (m.x + textWidth(m.t, 10) + 8 <= nx.x && (!m.guess || nx.x - m.x >= 3 * pitch)) })
  const mY = y0 + gridH + 14
  const monthTxt = keep.filter((m) => m.x + textWidth(m.t, 10) <= W).map((m) => txt(m.x, mY, m.t, 10)).join('')
  const dayTxt = (['Mon', '', 'Wed', '', 'Fri', '', ''] as const).map((t, i) => t ? txt(LW - 6, y0 + i * pitch + c / 2 + 3.5, t, 10, 'text-anchor="end"') : '').join('')
  const tN = endN - start, tx = x0 + Math.floor(tN / 7) * pitch, ty = y0 + (tN % 7) * pitch
  const today = `<rect x="${tx - 1.75}" y="${ty - 1.75}" width="${c + 3.5}" height="${c + 3.5}" rx="${r + 1.5}" fill="none" stroke="${K.sage}" stroke-width="1.25"/>`
  const lc = Math.min(c, 10), H = y0 + gridH + 18 + 12 + lc
  const leg = legend(W - pad, H - lc / 2 - 2, lc, Math.round(lc * 0.28), `hl${lc}`)
  return svg(W, Math.ceil(H), `${rampStyle}<defs><rect id="${id}" width="${c}" height="${c}" rx="${r}"/></defs>${dayTxt}${sweep(o.animate, 'hm', W, Math.ceil(H), cols.join('') + today)}${monthTxt}${leg}`)
}

/** Replies by weekday and hour: 7 rows (Mon..Sun), 24 columns, hour labels 12a / 6a / 12p / 6p under, same ramp.
 * cw = floor((width − 98) / 24), ch = clamp(round(cw·0.72), 10, 18), gap 3. Width = 98 + 24·cw (≤ width).
 * Height = 7·ch + 58. */
export function hourGrid(o: { counts: number[][]; width: number; animate: boolean }): string {
  const gap = 3, LW = Math.ceil(textWidth('Mon', 10)) + 8
  const cw = Math.max(6, Math.floor((o.width - LW - 23 * gap) / 24)), ch = clamp(Math.round(cw * 0.72), 10, 18)
  const r = Math.round(Math.min(cw, ch) * 0.28)
  const W = LW + 24 * cw + 23 * gap, gridH = 7 * ch + 6 * gap
  const all: number[] = []
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) all.push(o.counts[d]?.[h] ?? 0)
  const lv = levels(all), id = `gc${cw}x${ch}`
  const rows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, d) => {
    const y = d * (ch + gap)
    let cells = ''
    for (let h = 0; h < 24; h++) cells += `<use href="#${id}" x="${LW + h * (cw + gap)}" y="${y}"${cls(lv(o.counts[d]?.[h] ?? 0))}/>`
    return [txt(LW - 8, y + ch / 2 + 3.5, day, 10, 'text-anchor="end"'), cells]
  })
  const hy = gridH + 14
  const hrs = [[0, '12a'], [6, '6a'], [12, '12p'], [18, '6p']] as const
  const hourTxt = hrs.map(([h, t]) => txt(LW + h * (cw + gap) + cw / 2, hy, t, 10, 'text-anchor="middle"')).join('')
  const lc = 10, H = gridH + 18 + 12 + lc
  return svg(W, H, `${rampStyle}<defs><rect id="${id}" width="${cw}" height="${ch}" rx="${r}"/></defs>${rows.map((r) => r[0]).join('')}${sweep(o.animate, 'hg', W, H, rows.map((r) => r[1]).join(''))}${hourTxt}${legend(W, H - lc / 2 - 2, lc, 3, 'gl10')}`)
}

/** A profile over 5–6 axes (values 0..1): hairline guide polygons and spokes, the data polygon in emerald with a soft
 * fill and small vertex dots, each axis label with its note outside. Square: width = height = size; the polygon
 * shrinks until every label fits. */
export function radar(o: { axes: { label: string; value: number; note?: string }[]; size: number; animate: boolean }): string {
  const S = Math.round(o.size), n = Math.max(3, o.axes.length), axes = o.axes.slice(0, Math.max(3, n))
  // GAP: a full tip (dot and stroke) keeps ≥ 8 px from its label even on a slanted axis (9 left ~5 px on Run at 76%)
  const LS = 10.5, NS = 12, GAP = 15, LINE = 15
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const blocks = axes.map((a) => ({ w: Math.max(textWidth(a.label, LS), a.note ? textWidth(a.note, NS, 600) : 0), h: a.note ? 28 : 13 }))
  // where each label block sits for radius R, relative to the centre: [left, top, right, bottom]
  const box = (i: number, R: number) => {
    const c = Math.cos(ang(i)), s = Math.sin(ang(i)), b = blocks[i]!
    const ax = (R + GAP) * c, ay = (R + GAP) * s
    const left = Math.abs(c) < 0.3 ? ax - b.w / 2 : c > 0 ? ax : ax - b.w
    const top = s < -0.7 ? ay - b.h : s > 0.7 ? ay : ay - b.h / 2
    return [left, top, left + b.w, top + b.h] as const
  }
  const bounds = (R: number) => {
    let l = -R, t = -R, rr = R, bb = R
    axes.forEach((_, i) => { const [a, b, c, d] = box(i, R); l = Math.min(l, a); t = Math.min(t, b); rr = Math.max(rr, c); bb = Math.max(bb, d) })
    return [l, t, rr, bb] as const
  }
  let R = S / 2
  while (R > 20) { const [l, t, rr, bb] = bounds(R); if (rr - l <= S - 4 && bb - t <= S - 4) break; R -= 1 }
  const [l, t, rr, bb] = bounds(R)
  const cx = (S - (rr - l)) / 2 - l, cy = (S - (bb - t)) / 2 - t
  const P = (i: number, r: number) => `${f1(r * Math.cos(ang(i)))},${f1(r * Math.sin(ang(i)))}`
  const ring = (f: number) => axes.map((_, i) => P(i, R * f)).join(' ')
  const guides = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="${K.hairline}" stroke-width="1" stroke-opacity="${f === 1 ? 1 : 0.7}"/>`).join('')
  const spokes = axes.map((_, i) => `<path d="M0,0L${P(i, R)}" stroke="${K.hairline}" stroke-width="1" stroke-opacity="0.7"/>`).join('')
  const vals = axes.map((a) => clamp(a.value, 0, 1))
  const pts = vals.map((v, i) => P(i, R * Math.max(v, 0.02))).join(' ')
  const dots = vals.map((v, i) => { const p = P(i, R * Math.max(v, 0.02)).split(','); return `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${K.emerald}"/>` }).join('')
  const grow = o.animate ? `<animateTransform attributeName="transform" type="scale" from="0.001" to="1" dur="0.8s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.8 0.2 1"/>` : ''
  const shape = `<g>${grow}<polygon points="${pts}" fill="url(#rf${S})" stroke="${K.emerald}" stroke-width="1.75" stroke-linejoin="round"/>${dots}</g>`
  const labels = axes.map((a, i) => {
    const [x0, y0, x1] = box(i, R), c = Math.cos(ang(i))
    const anchor = Math.abs(c) < 0.3 ? 'middle' : c > 0 ? 'start' : 'end'
    const x = anchor === 'middle' ? (x0 + x1) / 2 : anchor === 'start' ? x0 : x1
    return txt(x, y0 + 10, a.label, LS, `text-anchor="${anchor}"`)
      + (a.note ? `<text x="${f1(x)}" y="${f1(y0 + 10 + LINE)}" text-anchor="${anchor}" ${FONT} font-size="${NS}" font-weight="600" fill="${K.emerald}">${esc(a.note)}</text>` : '')
  }).join('')
  const defs = `<defs><linearGradient id="rf${S}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${K.emerald}" stop-opacity="0.30"/><stop offset="1" stop-color="${K.emerald}" stop-opacity="0.10"/></linearGradient></defs>`
  return svg(S, S, `${defs}<g transform="translate(${f1(cx)} ${f1(cy)})">${guides}${spokes}${shape}${labels}</g>`)
}

/** A share as slanted stripes: a flat lead line along the bottom rises into a wide ramp, then thin parallelograms.
 * Filled stripes emerald, the leading one sage, the rest a quiet track. Height = height ?? 14. */
export function slant(o: { share: number; width: number; height?: number; animate: boolean }): string {
  const W = Math.round(o.width), H = Math.round(o.height ?? 14), s = clamp(o.share, 0, 1)
  const sk = H * 0.62, sw = Math.max(3, H * 0.3), gap = Math.max(2.5, H * 0.22)
  const lead = Math.max(12, Math.round(W * 0.16)), lh = Math.max(2, Math.round(H * 0.18))
  const rw = sw * 2.6, x0 = lead + rw + gap
  const span = W - 0.5 - x0 - sk - sw
  const n = Math.max(2, Math.floor(span / (sw + gap)) + 1), pitch = span / (n - 1)
  const k = s > 0 ? Math.max(1, Math.round(s * n)) : 0
  const para = (x: number, w: number) => `M${f1(x)},${H}H${f1(x + w)}L${f1(x + w + sk)},0H${f1(x + sk)}Z`
  const on = s > 0 ? K.emerald : K.pill
  // the lead line flows straight into the wide ramp: one shape
  const base = `<path d="M0,${H}V${H - lh}H${f1(lead + sk * (lh / H))}L${f1(lead + sk)},0H${f1(lead + rw + sk)}L${f1(lead + rw)},${H}Z" fill="${on}"/>`
  const stripes = Array.from({ length: n }, (_, i) => {
    const fill = i < k - 1 ? K.emerald : i === k - 1 ? K.sage : K.pill
    return `<path d="${para(x0 + i * pitch, sw)}" fill="${fill}">${i < k ? fadeIn(o.animate, 0.1 + i * 0.03, 1, 0.25) : ''}</path>`
  }).join('')
  return svg(W, H, `<g stroke-linejoin="round">${base}${stripes}</g>`)
}
