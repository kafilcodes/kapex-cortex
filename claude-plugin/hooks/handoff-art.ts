// Drawings for the Handoff page's top: the whole chat shrinking into the handoff note (to scale), and the
// Elephant–Goldfish check (Google's open-source EGM method: the elephant is the chat that remembers everything, the
// goldfish a fresh helper that remembers nothing and reads only the note). Cortex's own line art in the Kapex palette,
// never Google's or EGM's marks. Plain SVG, legible on light and dark.
import { k } from './charts'
import { esc, FONT, K, textWidth } from './theme'

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

/** The chat on the left as many lines of transcript, a funnel, and the small handoff note on the right. The two areas
 * are drawn to scale in height (square-root, so a 140× drop still shows both), with each one's size under it. */
export function transferSvg(o: { here: number; start: number; width: number }): string {
  const W = Math.max(260, Math.round(o.width)), H = 112
  const big = Math.max(1, o.here), small = Math.max(1, o.start)
  const hBig = 72, hSmall = Math.max(14, Math.min(hBig, hBig * Math.sqrt(small / big)))
  const xL = 0, wL = Math.min(170, W * 0.36), xR = W - Math.min(150, W * 0.32), wR = Math.min(150, W * 0.32), mid = 40
  const lines: string[] = []
  for (let i = 0; i < 12; i++) {
    const y = mid - hBig / 2 + 6 + i * ((hBig - 12) / 11)
    const w = wL - 24 - ((i * 37) % 5) * 9
    lines.push(`<rect x="${f1(xL + 12)}" y="${f1(y - 1.2)}" width="${f1(w)}" height="2.4" rx="1.2" fill="${K.silver}" fill-opacity="${(0.55 - i * 0.025).toFixed(2)}"/>`)
  }
  const top = mid - hSmall / 2, bot = mid + hSmall / 2
  const funnel = `<path d="M${f1(xL + wL)} ${f1(mid - hBig / 2)}C${f1(xL + wL + 60)} ${f1(mid - hBig / 2)} ${f1(xR - 60)} ${f1(top)} ${f1(xR)} ${f1(top)}L${f1(xR)} ${f1(bot)}C${f1(xR - 60)} ${f1(bot)} ${f1(xL + wL + 60)} ${f1(mid + hBig / 2)} ${f1(xL + wL)} ${f1(mid + hBig / 2)}Z" fill="url(#hf)"/>`
  const note = `<rect x="${f1(xR)}" y="${f1(top)}" width="${f1(wR)}" height="${f1(hSmall)}" rx="${f1(Math.min(8, hSmall / 2))}" fill="${K.emerald}" fill-opacity="0.16" stroke="${K.emerald}" stroke-opacity="0.7"/>`
    + (hSmall >= 18 ? `<rect x="${f1(xR + 10)}" y="${f1(mid - 1.2)}" width="${f1(wR * 0.45)}" height="2.4" rx="1.2" fill="${K.emerald}"/>` : '')
  const less = big > small ? Math.max(1, Math.round((1 - small / big) * 100)) : 0
  const lab = (x: number, anchor: string, t1: string, t2: string, c: string) => `<text x="${f1(x)}" y="96" text-anchor="${anchor}" ${FONT} font-size="12" font-weight="600" fill="${c}">${esc(t1)}</text><text x="${f1(x)}" y="110" text-anchor="${anchor}" ${FONT} font-size="10.5" fill="${K.ink}">${esc(t2)}</text>`
  const title = `This chat: ${k(big)} tokens re-read with each message. The handoff: about ${k(small)}${less ? `, ${less}% less` : ''}.`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${esc(title)}</title>`
    + `<defs><linearGradient id="hf" x1="0" x2="1"><stop offset="0" stop-color="${K.silver}" stop-opacity="0.16"/><stop offset="1" stop-color="${K.emerald}" stop-opacity="0.22"/></linearGradient></defs>`
    + `<rect x="${xL}" y="${f1(mid - hBig / 2)}" width="${f1(wL)}" height="${hBig}" rx="10" fill="${K.silver}" fill-opacity="0.08" stroke="${K.silver}" stroke-opacity="0.35"/>${lines.join('')}${funnel}${note}`
    + lab(xL, 'start', `${k(big)} tokens`, 'this chat, re-read each message', K.ink)
    + lab(xR + wR, 'end', `≈${k(small)} tokens`, less ? `the handoff · ${less}% less` : 'the handoff', K.emerald)
    + `</svg>`
}


/** The elephant (this chat, which remembers everything) hands its note to the goldfish (a fresh helper that remembers
 * nothing): the picture beside the Elephant–Goldfish check. */
export function egmArt(size = 1): string {
  const W = Math.round(250 * size), H = Math.round(96 * size)
  // the elephant in profile, facing the note: body, four legs, a tail, head, a big ear, a curled trunk, a tusk, an eye
  const E = K.emerald
  const el = `<g transform="translate(4 12)">`
    + `<ellipse cx="40" cy="42" rx="30" ry="21" fill="${E}" fill-opacity="0.24" stroke="${E}" stroke-width="2"/>`
    + [18, 30, 46, 56].map(x => `<rect x="${x}" y="54" width="9" height="20" rx="4" fill="${E}" fill-opacity="0.34" stroke="${E}" stroke-width="1.8"/>`).join('')
    + `<path d="M10 40C4 42 2 48 4 52" fill="none" stroke="${E}" stroke-width="1.8" stroke-linecap="round"/>`
    + `<circle cx="74" cy="30" r="17" fill="${E}" fill-opacity="0.3" stroke="${E}" stroke-width="2"/>`
    + `<path d="M64 22C54 20 50 30 52 40C54 48 62 50 68 44" fill="${E}" fill-opacity="0.5" stroke="${E}" stroke-width="1.8" stroke-linejoin="round"/>`
    + `<path d="M88 34C96 42 96 56 92 64C90 68 85 68 85 63" fill="none" stroke="${E}" stroke-width="6" stroke-linecap="round"/>`
    + `<path d="M84 44C88 48 92 48 94 45" fill="none" stroke="#E5E7EB" stroke-width="2.6" stroke-linecap="round"/>`
    + `<circle cx="80" cy="26" r="2.6" fill="#0B1912"/><circle cx="80.9" cy="25.2" r="0.9" fill="#fff"/>`
    + `</g>`
  // the note, passed along a dashed line
  const note = `<g transform="translate(110 30)"><path d="M-8 18H40" stroke="${K.ink}" stroke-width="1.4" stroke-dasharray="3 4"/><rect x="6" y="2" width="26" height="32" rx="5" fill="${E}" fill-opacity="0.16" stroke="${E}" stroke-width="1.6"/>`
    + `<path d="M12 12H26M12 18H24M12 24H20" stroke="${E}" stroke-width="1.8" stroke-linecap="round"/><path d="M40 18l-6-4v8z" fill="${K.ink}"/></g>`
  // the goldfish: tail, body, fin, a smile line, a big eye, two bubbles
  const A = K.amber
  const fish = `<g transform="translate(160 22)">`
    + `<path d="M8 30L-6 16L-4 30L-6 44Z" fill="${A}" fill-opacity="0.75" stroke="${A}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<ellipse cx="34" cy="30" rx="28" ry="18" fill="${A}" fill-opacity="0.3" stroke="${A}" stroke-width="2"/>`
    + `<path d="M28 13C34 4 44 6 46 14" fill="${A}" fill-opacity="0.5" stroke="${A}" stroke-width="1.6" stroke-linejoin="round"/>`
    + `<path d="M24 38C30 44 36 44 40 40" fill="none" stroke="${A}" stroke-width="1.4" stroke-linecap="round" opacity="0.8"/>`
    + `<circle cx="48" cy="26" r="5" fill="#fff"/><circle cx="49.4" cy="26.4" r="2.6" fill="#0B1912"/>`
    + `<circle cx="70" cy="12" r="3" fill="none" stroke="${K.sage}" stroke-width="1.3"/><circle cx="78" cy="2" r="2" fill="none" stroke="${K.sage}" stroke-width="1.2"/>`
    + `</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 250 96"><title>An elephant, the chat that remembers everything, hands its note to a goldfish, a fresh helper that remembers nothing</title>${el}${note}${fish}</svg>`
}

/** Cuts a label to fit a column, by measured width, with an ellipsis. */
function fit(t: string, max: number, size: number, weight = 400): string {
  if (textWidth(t, size, weight) <= max) return t
  let s = t
  while (s.length > 1 && textWidth(`${s}…`, size, weight) > max) s = s.slice(0, -1)
  return `${s.trimEnd()}…`
}

/** One handoff as a chain of four stops: the chat it continued (or a fresh start), this chat, its note, and the chat
 * that picked it up (or not yet). Solid emerald links are real; a dashed grey link leads to a stop that isn't there. */
export function chainSvg(o: { prev?: { chat: string; id: string }; here: { chat: string; id: string; turns: number }; note: string; next?: { chat: string; id: string }[]; width: number }): string {
  const W = Math.max(300, Math.round(o.width)), H = 84, y = 20, r = 11
  const nx = o.next?.[0]
  const stops: { title: string; sub: string; id: string; kind: 'chat' | 'here' | 'note' | 'none' }[] = [
    o.prev ? { title: o.prev.chat || 'An earlier chat', sub: 'came from', id: o.prev.id.slice(0, 8), kind: 'chat' } : { title: 'Started fresh', sub: 'no handoff before it', id: '', kind: 'none' },
    { title: o.here.chat || 'This chat', sub: `${o.here.turns} repl${o.here.turns === 1 ? 'y' : 'ies'}`, id: o.here.id.slice(0, 8), kind: 'here' },
    { title: 'Handoff note', sub: o.note, id: '', kind: 'note' },
    nx ? { title: nx.chat || 'A new chat', sub: (o.next!.length > 1 ? `${o.next!.length} chats picked up` : 'picked up by'), id: nx.id.slice(0, 8), kind: 'chat' } : { title: 'Not picked up yet', sub: 'type /cortex-resume', id: '', kind: 'none' },
  ]
  // narrow: the note becomes a word on the last link, so three columns keep the chat names readable
  const wide = W >= 440
  if (!wide) stops.splice(2, 1)
  const col = W / stops.length, xs = stops.map((_, i) => col * (i + 0.5))
  const glyph = (k: string, x: number) => k === 'note'
    ? `<path d="M${f1(x - 4)} ${y - 5.5}h5.5l3 3v8h-8.5z" fill="none" stroke="${K.emerald}" stroke-width="1.4" stroke-linejoin="round"/><path d="M${f1(x - 2)} ${y + 0.5}h4.5M${f1(x - 2)} ${y + 3}h3" stroke="${K.emerald}" stroke-width="1.2" stroke-linecap="round"/>`
    : k === 'none' ? `<path d="M${f1(x - 3.5)} ${y}h7" stroke="${K.ink}" stroke-width="1.4" stroke-linecap="round"/>`
    : `<path d="M${f1(x - 5)} ${y - 4}h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5h-5l-3 2.5v-2.5h-2a1.5 1.5 0 0 1-1.5-1.5v-5a1.5 1.5 0 0 1 1.5-1.5z" fill="none" stroke="${k === 'here' ? '#05130D' : K.emerald}" stroke-width="1.3" stroke-linejoin="round"/>`
  const node = (k: string, x: number) => k === 'here'
    ? `<circle cx="${f1(x)}" cy="${y}" r="${r}" fill="${K.emerald}"/>`
    : k === 'none' ? `<circle cx="${f1(x)}" cy="${y}" r="${r}" fill="none" stroke="${K.ink}" stroke-width="1.2" stroke-dasharray="2.5 2.5"/>`
    : `<circle cx="${f1(x)}" cy="${y}" r="${r}" fill="${K.emerald}" fill-opacity="0.12" stroke="${K.emerald}" stroke-width="1.2"/>`
  const link = (i: number) => {
    const real = stops[i]!.kind !== 'none' && stops[i + 1]!.kind !== 'none'
    const a = xs[i]! + r + 4, b = xs[i + 1]! - r - 5, c = real ? K.emerald : K.ink
    const word = !wide && i === stops.length - 2 ? `<text x="${f1((a + b) / 2)}" y="${y - 7}" text-anchor="middle" ${FONT} font-size="9" fill="${K.ink}">handoff</text>` : ''
    return `${word}<path d="M${f1(a)} ${y}H${f1(b)}" stroke="${c}" stroke-width="1.4" ${real ? '' : 'stroke-dasharray="3 4"'} stroke-linecap="round"/><path d="M${f1(b - 4)} ${y - 3.5}L${f1(b)} ${y}L${f1(b - 4)} ${y + 3.5}" fill="none" stroke="${c}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  const max = col - 10
  const labels = stops.map((s, i) => `<text x="${f1(xs[i]!)}" y="${y + r + 16}" text-anchor="middle" ${FONT} font-size="11" font-weight="600" fill="${s.kind === 'none' ? K.ink : K.emerald}">${esc(fit(s.title, max, 11, 600))}</text>`
    + `<text x="${f1(xs[i]!)}" y="${y + r + 30}" text-anchor="middle" ${FONT} font-size="10" fill="${K.ink}">${esc(fit(s.sub, max, 10))}</text>`
    + (s.id ? `<text x="${f1(xs[i]!)}" y="${y + r + 43}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace" font-size="9" fill="${K.ink}" fill-opacity="0.8">${esc(s.id)}</text>` : '')).join('')
  const title = `${stops[0]!.title} → ${stops[1]!.title} → handoff note → ${stops[stops.length - 1]!.title}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${esc(title)}</title>${stops.slice(1).map((_, i) => link(i)).join('')}${stops.map((s, i) => node(s.kind, xs[i]!) + glyph(s.kind, xs[i]!)).join('')}${labels}</svg>`
}
