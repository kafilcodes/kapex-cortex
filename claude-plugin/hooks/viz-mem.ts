// Charts for the Memory check page: how much of Claude's memory holds up (a ring), and what each recent check found
// (a row of bars, oldest on the left). Plain SVG with system-font text, legible on light and dark, no animation loops.
import { esc, FONT, K, textWidth } from './theme'

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

/** A ring split by what became of the notes a check read: holding up, waiting for you, fixed, kept as they are. The
 * share that holds up is the big number in the middle. */
export function memRing(o: { total: number; open: number; fixed: number; kept: number; size?: number }): string {
  const S = o.size ?? 104, c = S / 2, r = S / 2 - 8, sw = 9, L = 2 * Math.PI * r
  // findings about whole files (too long, a lesson to add) can outnumber the notes read: never past the whole ring
  const total = Math.max(0, o.total), open = Math.min(total, Math.max(0, o.open)), fixed = Math.min(total - open, Math.max(0, o.fixed)), kept = Math.min(total - open - fixed, Math.max(0, o.kept))
  const ok = Math.max(0, total - open - fixed - kept)
  const parts = total > 0 ? [[ok, K.emerald], [fixed, '#14B8A6'], [kept, K.silver], [open, K.amber]] as [number, string][] : []
  const shown = parts.filter(([v]) => v > 0)
  const gap = shown.length > 1 ? 3 : 0 // a little air between the parts, so a small one still reads as its own
  let at = 0
  const arcs = shown.map(([v, col]) => {
    const len = Math.max(1.5, (v / total) * L - gap)
    const a = `<circle cx="${c}" cy="${c}" r="${f1(r)}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="butt" stroke-dasharray="${f1(len)} ${f1(L)}" stroke-dashoffset="${f1(-at)}" transform="rotate(-90 ${c} ${c})"/>`
    at += (v / total) * L
    return a
  }).join('')
  const pct = total > 0 ? Math.floor(((ok + fixed + kept) / total) * 100) : null
  const big = pct === null ? '–' : `${pct}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><title>${esc(pct === null ? 'Not checked yet' : `${pct}% of ${total} notes hold up`)}</title>`
    + `<circle cx="${c}" cy="${c}" r="${f1(r)}" fill="none" stroke="${K.pill}" stroke-width="${sw}"/>${arcs}`
    + `<text x="${c}" y="${f1(c + 4)}" text-anchor="middle" ${FONT} font-size="${S >= 96 ? 20 : 16}" font-weight="600" fill="${pct === null ? K.ink : open ? K.amber : K.emerald}">${big}</text>`
    + `<text x="${c}" y="${f1(c + 19)}" text-anchor="middle" ${FONT} font-size="10" fill="${K.ink}">hold up</text></svg>`
}

export type CheckBar = { found: number; status: 'clean' | 'waiting' | 'fixed' | 'dropped' | 'failed'; title: string }
const BAR_COLOR: Record<CheckBar['status'], string> = { clean: K.emerald, waiting: K.amber, fixed: '#14B8A6', dropped: K.silver, failed: K.rose }

/** The last checks, oldest on the left: each bar's height is what it found (a clean check is a short emerald stub),
 * its colour what became of it. A scale line names the biggest count. */
export function checkBars(o: { bars: CheckBar[]; width: number; height?: number }): string {
  const H = o.height ?? 64, base = H - 16, n = o.bars.length
  const W = Math.max(120, Math.round(o.width))
  if (!n) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><text x="0" y="${H / 2}" ${FONT} font-size="11" fill="${K.ink}">No checks yet</text></svg>`
  const max = Math.max(1, ...o.bars.map(b => b.found))
  const scaleW = textWidth(String(max), 10) + 8
  const slot = Math.min(26, (W - scaleW) / n), bw = Math.max(5, Math.min(14, slot * 0.6))
  const top = 6, room = base - top
  const bars = o.bars.map((b, i) => {
    const h = b.found > 0 ? Math.max(4, (b.found / max) * room) : 3
    const x = scaleW + i * slot + (slot - bw) / 2
    return `<rect x="${f1(x)}" y="${f1(base - h)}" width="${f1(bw)}" height="${f1(h)}" rx="${f1(Math.min(3, bw / 2))}" fill="${BAR_COLOR[b.status]}" fill-opacity="${b.status === 'dropped' ? 0.55 : 0.9}"><title>${esc(b.title)}</title></rect>`
  }).join('')
  const guide = `<line x1="${scaleW}" y1="${top}" x2="${W}" y2="${top}" stroke="${K.hairline}" stroke-dasharray="2 3"/><line x1="${scaleW}" y1="${base}" x2="${W}" y2="${base}" stroke="${K.hairline}"/>`
  const labels = `<text x="0" y="${top + 4}" ${FONT} font-size="10" fill="${K.ink}">${max}</text><text x="0" y="${base}" ${FONT} font-size="10" fill="${K.ink}">0</text>`
    + `<text x="${scaleW}" y="${H - 2}" ${FONT} font-size="10" fill="${K.ink}">older</text><text x="${W}" y="${H - 2}" text-anchor="end" ${FONT} font-size="10" fill="${K.ink}">latest</text>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${guide}${bars}${labels}</svg>`
}

/** The 5-hour plan as one bar: the part used, split by what used it (each chat its colour), then the part left. */
export function planSplit(o: { used: number; parts: { share: number; color: string; label: string }[]; width: number }): string {
  const W = Math.max(120, Math.round(o.width)), H = 12, used = Math.max(0, Math.min(1, o.used))
  const total = o.parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1
  let x = 0
  const segs = o.parts.filter(p => p.share > 0).map((p, i, all) => {
    const w = (p.share / total) * used * W, gap = i < all.length - 1 ? 1.5 : 0
    const r = `<rect x="${f1(x)}" y="0" width="${f1(Math.max(1, w - gap))}" height="${H}" fill="${p.color}"><title>${esc(p.label)}</title></rect>`
    x += w
    return r
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><clipPath id="ps${W}"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath></defs><g clip-path="url(#ps${W})"><rect width="${W}" height="${H}" fill="${K.pill}"/>${segs}</g></svg>`
}
