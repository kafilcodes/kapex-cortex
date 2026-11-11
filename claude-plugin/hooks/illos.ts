// Small flat illustrations drawn for Cortex (no third-party art, so no licence questions), in Kapex Emerald. Neutral
// parts are grey at part opacity, so they read on Claude Code's light and dark canvas alike; nothing loops.
import { K } from './theme'

const G = '#9CA3AF' // neutral
const svg = (w: number, h: number, vw: number, vh: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(h)}" viewBox="0 0 ${vw} ${vh}" fill="none">${body}</svg>`
const bar = (x: number, y: number, w: number, c = G, o = 0.45) => `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${c}" fill-opacity="${o}"/>`
const win = (x: number, y: number, w: number, h: number, o = 0.5) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="${G}" fill-opacity="0.08" stroke="${G}" stroke-opacity="${o}" stroke-width="2"/><circle cx="${x + 11}" cy="${y + 10}" r="2.2" fill="${G}" fill-opacity="0.6"/><circle cx="${x + 18}" cy="${y + 10}" r="2.2" fill="${G}" fill-opacity="0.6"/>`
const spark = (x: number, y: number, s: number, c: string = K.sage) => `<path d="M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}Z" fill="${c}"/>`

/** A full chat handing a small packet to a fresh one: the hand-off question, an empty handoff list. */
export function illoHandoff(width = 220): string {
  const full = [0, 1, 2, 3, 4, 5, 6, 7].map(i => bar(14, 26 + i * 9, [52, 40, 58, 34, 50, 44, 56, 38][i]!, i > 5 ? K.amber : G, i > 5 ? 0.7 : 0.4)).join('')
  const doc = `<g transform="translate(96 30)"><rect width="30" height="38" rx="5" fill="${K.emerald}" fill-opacity="0.16" stroke="${K.emerald}" stroke-width="2"/>${bar(6, 9, 18, K.emerald, 0.8)}${bar(6, 18, 13, K.emerald, 0.6)}${bar(6, 27, 16, K.emerald, 0.6)}</g>`
  const arrow = `<path d="M76 84 C 100 104, 130 104, 150 84" stroke="${K.emerald}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 6"/><path d="M143 80 L151 83 L147 91" stroke="${K.emerald}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
  const fresh = `${win(150, 12, 62, 92, 0.55)}${bar(158, 30, 30, K.emerald, 0.75)}${bar(158, 39, 40, G, 0.4)}<circle cx="181" cy="78" r="11" fill="${K.emerald}" fill-opacity="0.18"/><path d="M175.5 78l4 4 7-8" stroke="${K.emerald}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
  return svg(width, width * 0.5, 220, 110, `${win(6, 6, 72, 100)}${full}${arrow}${doc}${fresh}${spark(140, 22, 5)}${spark(206, 6, 3.5, K.emerald)}`)
}

/** A quiet night over a stack of notes with a check: a Dream that found nothing, or every finding decided. */
export function illoDreamClean(width = 180): string {
  const moon = `<path d="M44 18a20 20 0 1 0 22 26A16 16 0 0 1 44 18z" fill="${K.emerald}" fill-opacity="0.85"/>`
  const stars = `${spark(86, 16, 4)}${spark(104, 34, 2.6, K.emerald)}${spark(20, 54, 3)}`
  const notes = `<g transform="translate(88 44)"><rect x="10" y="-6" width="64" height="50" rx="7" fill="${G}" fill-opacity="0.08" stroke="${G}" stroke-opacity="0.35" stroke-width="2"/><rect width="64" height="50" rx="7" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.55" stroke-width="2"/>${bar(10, 12, 34)}${bar(10, 22, 44)}${bar(10, 32, 26)}</g>`
  const check = `<circle cx="150" cy="92" r="13" fill="${K.emerald}"/><path d="M143.5 92l4.5 4.5 8-9" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
  return svg(width, width * 0.61, 180, 110, `${moon}${stars}<path d="M8 104 H172" stroke="${G}" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round"/>${notes}${check}`)
}

/** Notes being sorted: Dream not run yet, or a Dream running. */
export function illoDreamStart(width = 180): string {
  const moon = `<path d="M40 20a18 18 0 1 0 20 24A14 14 0 0 1 40 20z" fill="${K.emerald}" fill-opacity="0.5"/>`
  const lens = `<circle cx="128" cy="52" r="20" fill="${K.emerald}" fill-opacity="0.12" stroke="${K.emerald}" stroke-width="2.6"/><path d="M142 66l14 14" stroke="${K.emerald}" stroke-width="3" stroke-linecap="round"/>`
  const notes = `<g transform="translate(70 30)"><rect width="56" height="62" rx="7" fill="${G}" fill-opacity="0.1" stroke="${G}" stroke-opacity="0.5" stroke-width="2"/>${bar(9, 12, 30)}${bar(9, 22, 38)}${bar(9, 32, 24, K.amber, 0.7)}${bar(9, 42, 34)}</g>`
  return svg(width, width * 0.61, 180, 110, `${moon}${spark(82, 14, 3.5)}${notes}${lens}<path d="M8 104 H172" stroke="${G}" stroke-opacity="0.35" stroke-width="2" stroke-linecap="round"/>`)
}
