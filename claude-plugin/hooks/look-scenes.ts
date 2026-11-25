// The Kapex backdrops (Settings → Look): five quiet patterns (Crystal facets in look-scenes-2.ts) behind the
// conversation, kept to the edges so the words in the middle and the message box at the foot stay calm. Emerald
// linework reads on both Obsidian and Mist; light mode softens it on paper. Each is one SVG (no script, nothing
// loaded), well under the 131,072-character limit, with `preserveAspectRatio="xMidYMid slice"` so it fills any window.
// How each one moves, and how Motion (on, follow the Mac, still) works, is in look-svg.ts.

import { facets } from './look-scenes-2'
import { beat, breathe, f1, frame, GLOW, GLOW2, H, LINE, LINE2, pulse, rnd, swing, tk, W, type Motion, type Scene } from './look-svg'

export type { Motion } from './look-svg'
export type Backdrop = 'prism' | 'facets' | 'contour' | 'mesh' | 'aurora' | 'none'
export const BACKDROPS: [Backdrop, string][] = [['prism', 'Prism lattice'], ['facets', 'Crystal facets'], ['contour', 'Contour field'], ['mesh', 'Signal mesh'], ['aurora', 'Aurora glow'], ['none', 'None']]

const hex = (cx: number, cy: number, R: number, rot = 0) => Array.from({ length: 6 }, (_, i) => { const a = ((-90 + 60 * i + rot) * Math.PI) / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)] as const })

/** The Cortex prism opened up: six twisted facets around a core, as outlines with a faint fill. */
function prismMark(cx: number, cy: number, R: number, op: number): string {
  const o = hex(cx, cy, R), i = hex(cx, cy, R * 0.34, 24)
  let s = ''
  for (let k = 0; k < 6; k++) {
    const p = [i[k]!, o[k]!, o[(k + 1) % 6]!, i[(k + 1) % 6]!].map(q => `${f1(q[0])},${f1(q[1])}`).join(' ')
    s += `<polygon points="${p}" fill="${GLOW}" fill-opacity="${((0.02 + 0.025 * (k % 3)) * op).toFixed(3)}" stroke="${LINE}" stroke-opacity="${(0.5 * op).toFixed(2)}" stroke-width="1.1"/>`
  }
  return s
}

// Prism: the large prism turns slowly (14° and back over 96 s) while the small one breathes.
const prism: Scene = {
  defs: `<pattern id="kl" width="28" height="48.5" patternUnits="userSpaceOnUse"><path d="M0 0L28 48.5M28 0L0 48.5M0 0H28M0 24.25H28" stroke="${LINE}" stroke-width="0.6" fill="none"/></pattern>`
    + `<radialGradient id="km" cx="0.92" cy="0.08" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="0.6" stop-color="#fff" stop-opacity="0.08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<radialGradient id="kn" cx="0.04" cy="0.98" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`
    + `<mask id="kk"><rect width="${W}" height="${H}" fill="url(#km)"/><rect width="${W}" height="${H}" fill="url(#kn)"/></mask>`
    + `<radialGradient id="kg" cx="0.88" cy="0.1" r="0.45"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.16"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>`,
  body: m => `<g class="k-soft"><rect width="${W}" height="${H}" fill="url(#kg)"/><rect width="${W}" height="${H}" fill="url(#kl)" mask="url(#kk)" opacity="0.5"/>`
    + `<g>${m ? swing('rotate', [0, 1150, 110], [14, 1150, 110], 96) : ''}${prismMark(1150, 110, 150, 1)}</g>`
    + `<g opacity="0.78">${m ? breathe('opacity', 0.55, 1, 18) : ''}${prismMark(70, 700, 90, 0.8)}</g></g>`,
}

// Contour: the two ring sets drift, and a pulse ripples out through the large set (every 12 s at slow speed), like a sonar
// ping from the corner: each ring brightens one step after the one inside it, then the field rests (and redraws nothing).
const ring = (cx: number, cy: number, R: number, ph: number) => {
  let d = ''
  for (let t = 0; t <= 96; t++) {
    const a = (t / 96) * Math.PI * 2
    const k = 1 + 0.07 * Math.sin(3 * a + ph) + 0.045 * Math.sin(5 * a + ph * 1.7) + 0.02 * Math.sin(9 * a + ph * 0.4)
    d += `${t ? 'L' : 'M'}${f1(cx + R * k * Math.cos(a))} ${f1(cy + R * k * 0.82 * Math.sin(a))}`
  }
  return `${d}Z`
}
const BIG = Array.from({ length: 16 }, (_, i) => ({ d: ring(1190, 740, 70 + i * 46, 0.6 + i * 0.22), o: 0.55 - i * 0.026, w: i % 4 === 0 }))
const SMALL = Array.from({ length: 9 }, (_, i) => ({ d: ring(120, 40, 40 + i * 38, 2.1 + i * 0.3), o: 0.3 - i * 0.028 }))
const PING = 12 // seconds between pulses
const contour: Scene = {
  defs: `<radialGradient id="cg" cx="0.93" cy="0.97" r="0.55"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.18"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>`,
  body: m => {
    const big = BIG.map((r, i) => `<path d="${r.d}" stroke-opacity="${r.o.toFixed(3)}"${r.w ? ' stroke-width="1.3"' : ''}>${m ? pulse('stroke-opacity', +r.o.toFixed(3), Math.min(0.95, r.o + 0.4), PING, tk(1) + i / 12, 1.8) : ''}</path>`).join('')
    const small = SMALL.map((r, i) => `<path d="${r.d}" stroke-opacity="${r.o.toFixed(3)}">${m ? pulse('stroke-opacity', +r.o.toFixed(3), Math.min(0.7, r.o + 0.26), PING, tk(7) + i / 12, 1.8) : ''}</path>`).join('')
    return `<g class="k-soft"><rect width="${W}" height="${H}" fill="url(#cg)"/>`
      + `<g fill="none" stroke="${LINE}" stroke-width="0.8">${m ? swing('translate', [0, 0], [-26, -14], 120) : ''}${big}</g>`
      + `<g fill="none" stroke="${LINE}" stroke-width="0.8">${m ? swing('translate', [0, 0], [18, 10], 88) : ''}${small}</g></g>`
  },
}

// The mesh's dot grid, faded out from the top-right corner. It was a pattern under a gradient mask, which the app
// redraws whole on every step of any motion (it cost the mesh ~25% of a core); the same dots drawn directly, their
// fade baked in, look the same and redraw cheaply. One path per fade level, each dot a 1.7 px square (as a dot at this size).
const GRID_DOTS = (() => {
  const levels = new Map<number, string>()
  for (let y = 11; y < H; y += 22) for (let x = 11; x < W; x += 22) {
    const d = Math.hypot((x / W - 0.85) / 0.8, (y / H - 0.15) / 0.8) // the old mask: 0.5 at its centre, 0.04 at 0.7, 0 at 1
    const m = d < 0.7 ? 0.5 + (0.04 - 0.5) * (d / 0.7) : d < 1 ? 0.04 * (1 - (d - 0.7) / 0.3) : 0
    const a = Math.round(m * 0.75 * 40) / 40 // 0.75: the old layer's opacity; 40 levels
    if (a < 0.025) continue
    levels.set(a, (levels.get(a) ?? '') + `M${f1(x - 0.85)} ${f1(y - 0.85)}h1.7v1.7h-1.7z`)
  }
  return [...levels].map(([a, d]) => `<path d="${d}" fill="${LINE}" fill-opacity="${a}"/>`).join('')
})()

// Mesh: a signal runs along a chain of links every 14 s, and three hubs send out a soft ring in turn.
const mesh: Scene = (() => {
  const r = rnd(11), nodes: [number, number][] = []
  for (let i = 0; i < 26; i++) { const x = 760 + r() * 520, y = -10 + r() * 330; if (!(x < 900 && y > 250)) nodes.push([x, y]) }
  for (let i = 0; i < 9; i++) nodes.push([r() * 260, 520 + r() * 260])
  const near: [[number, number], [number, number], number][] = []
  nodes.forEach((a, i) => nodes.forEach((c, j) => { if (j > i) { const d = Math.hypot(a[0] - c[0], a[1] - c[1]); if (d < 125) near.push([a, c, d]) } }))
  const edges = near.map(([a, c, d]) => `<line x1="${f1(a[0])}" y1="${f1(a[1])}" x2="${f1(c[0])}" y2="${f1(c[1])}" stroke-opacity="${(0.42 - d / 400).toFixed(3)}"/>`).join('')
  const chain = near.slice(0, 7).map(([a, c]) => `M${f1(a[0])} ${f1(a[1])}L${f1(c[0])} ${f1(c[1])}`).join('')
  const dots = nodes.map(([x, y], i) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${i % 5 === 0 ? 2.6 : 1.6}" fill="${LINE}" fill-opacity="${i % 5 === 0 ? 0.85 : 0.5}"/>`).join('')
  const hubs = nodes.filter((_, i) => i % 5 === 0).slice(0, 3)
  // a hub's ping: three rings around it light up outward and fade, one hub at a time, each once every 36 s. Opacity
  // only: animating a radius makes the app lay the drawing out again on every frame, even at rest (~14% of a core)
  const ping = ([x, y]: [number, number], i: number) => [6, 11, 16].map((rr, k) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${rr}" fill="none" stroke="${LINE2}" stroke-width="1" stroke-opacity="0">`
    + `${beat('stroke-opacity', u => 0.7 * (1 - k * 0.25) * Math.sin(Math.PI * u), 0, 36, 1.2, tk(4 + i * 12) + k * 0.25)}</circle>`).join('')
  // the signal: a short dash runs the chain in 6 s and fades out at its end, then rests until the next run
  const signal = `<path d="${chain}" fill="none" stroke="${LINE2}" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0" stroke-dasharray="14 900">`
    + `${beat('stroke-dashoffset', u => 914 * (1 - u), 914, 14, 6, 0)}${beat('stroke-opacity', u => 0.9 * Math.min(1, u / 0.08, (1 - u) / 0.12), 0, 14, 6, 0)}</path>`
  return {
    defs: `<radialGradient id="mg" cx="0.82" cy="0.12" r="0.5"><stop offset="0" stop-color="${GLOW2}" stop-opacity="0.16"/><stop offset="1" stop-color="${GLOW2}" stop-opacity="0"/></radialGradient>`,
    body: m => `<g class="k-soft"><rect width="${W}" height="${H}" fill="url(#mg)"/>${GRID_DOTS}`
      + `<g stroke="${LINE}" stroke-width="0.8">${edges}</g>`
      + (m ? `${signal}${hubs.map(ping).join('')}` : '')
      + `<g opacity="0.8">${dots}</g></g>`,
  }
})()

// Aurora: three soft glows drift and swell slowly (36 to 64 s), like light over the corner; the shards stay put.
const aurora: Scene = (() => {
  const r = rnd(5)
  let shards = ''
  for (let i = 0; i < 14; i++) {
    const x = 640 + r() * 640, y = r() * 220, s = 30 + r() * 90, a = r() * Math.PI
    const p = [0, 2.1, 4.2].map(t => `${f1(x + s * Math.cos(a + t))},${f1(y + s * 0.6 * Math.sin(a + t))}`).join(' ')
    shards += `<polygon points="${p}" fill="${i % 2 ? GLOW : GLOW2}" fill-opacity="${(0.04 + r() * 0.06).toFixed(3)}" stroke="${LINE}" stroke-opacity="0.18" stroke-width="0.7"/>`
  }
  // soft glows from radial gradients, not a blur filter: a full-window blur redrawn every frame costs battery
  const glow = (id: string, c: string, o: number) => `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${o}"/><stop offset="0.6" stop-color="${c}" stop-opacity="${(o * 0.35).toFixed(3)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
  return {
    defs: `${glow('ag1', GLOW, 0.34)}${glow('ag2', GLOW2, 0.3)}${glow('ag3', GLOW2, 0.22)}<linearGradient id="av" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${GLOW}" stop-opacity="0"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0.06"/></linearGradient>`,
    body: m => `<g class="k-soft">`
      + `<g>${m ? swing('translate', [0, 0], [-60, 18], 72) : ''}<ellipse cx="1040" cy="40" rx="520" ry="220" fill="url(#ag1)"/></g>`
      + `<g>${m ? swing('translate', [0, 0], [70, -10], 104) : ''}<ellipse cx="760" cy="-10" rx="440" ry="170" fill="url(#ag2)"/></g>`
      + `<g opacity="0.85">${m ? `${swing('translate', [0, 0], [40, -16], 128)}${breathe('opacity', 0.85, 1, 36)}` : ''}<ellipse cx="140" cy="790" rx="420" ry="180" fill="url(#ag3)"/></g>`
      + `<rect y="${H - 160}" width="${W}" height="160" fill="url(#av)"/>${shards}</g>`,
  }
})()

const SCENES: Record<Exclude<Backdrop, 'none'>, Scene> = { prism, facets, contour, mesh, aurora }
const made = new Map<string, string>()
/** A backdrop's SVG text, built once per pattern and motion mode. */
export function backdropSvg(b: Backdrop, motion: Motion): string | null {
  if (b === 'none') return null
  const key = `${b}|${motion}`
  let s = made.get(key)
  if (s === undefined) { s = frame(SCENES[b], motion); made.set(key, s) }
  return s
}
