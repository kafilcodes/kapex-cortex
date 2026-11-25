// Another Kapex backdrop (Settings → Look), in the same rules as look-scenes.ts: kept to the corners, emerald on
// Obsidian and Mist, slow motion (look-svg.ts), one small SVG with no script.
//   Crystal facets: a low-poly field of facets (the prism's own geometry) glowing out of two corners; a few lit
//   facets catch the light in turn, each on its own slow cycle

import { f1, GLOW, GLOW2, H, LINE, pulse, rnd, tk, W, type Scene } from './look-svg'

type Tri = { pts: string; fill: string; op: number; edge: number; lit: number } // lit: -1, or the order it catches the light

function field(r: () => number, ox: number, oy: number, cols: number, rows: number, step: number, dirX: number, dirY: number, out: Tri[]): void {
  // a jittered grid, every cell split in two triangles; each facet's light falls off from its corner
  const pts: [number, number][][] = []
  for (let j = 0; j <= rows; j++) {
    const row: [number, number][] = []
    for (let i = 0; i <= cols; i++) row.push([ox + dirX * i * step + (i && i < cols ? (r() - 0.5) * step * 0.55 : 0), oy + dirY * j * step + (j && j < rows ? (r() - 0.5) * step * 0.55 : 0)])
    pts.push(row)
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const p = pts[j]![i]!, q = pts[j]![i + 1]!, s = pts[j + 1]![i]!, t = pts[j + 1]![i + 1]!
    // brightest at the corner, fading to nothing along a curve (never a straight cut at the grid's edge)
    const d = Math.hypot((i + 0.5) / cols, (j + 0.5) / rows), fall = d >= 1 ? 0 : (1 - d) * (1 - d) * (3 - 2 * (1 - d)) * 1.15
    if (fall < 0.08) continue
    for (const [k, tri] of ([[0, [p, q, t]], [1, [p, t, s]]] as const)) {
      const op = fall * fall * (0.06 + r() * 0.16)
      const lit = r() < 0.07 && fall > 0.45
      out.push({ pts: tri.map(v => `${f1(v[0])},${f1(v[1])}`).join(' '), fill: k ? GLOW : GLOW2, op, edge: fall * 0.32, lit: lit ? out.filter(x => x.lit >= 0).length : -1 })
    }
  }
}

const tris: Tri[] = []
{ const r = rnd(29); field(r, W + 20, -20, 12, 8, 64, -1, 1, tris); field(r, -20, H + 20, 8, 5, 60, 1, -1, tris) }
const LIT = tris.filter(t => t.lit >= 0).length, GLINT = 5

export const facets: Scene = {
  defs: `<radialGradient id="fg" cx="1" cy="0" r="0.6"><stop offset="0" stop-color="${GLOW}" stop-opacity="0.14"/><stop offset="1" stop-color="${GLOW}" stop-opacity="0"/></radialGradient>`,
  body: m => `<g class="k-soft"><rect width="${W}" height="${H}" fill="url(#fg)"/>` + tris.map(t => {
    const op = t.op.toFixed(3)
    // one lit facet catches the light every 5 s, in turn, so only one glints at a time (and most of the time none:
    // the field rests and redraws nothing)
    const glint = m && t.lit >= 0 ? pulse('fill-opacity', +op, 0.3, GLINT * Math.max(1, LIT), tk(t.lit * GLINT), 2.4) : ''
    return `<polygon points="${t.pts}" fill="${t.fill}" fill-opacity="${op}" stroke="${LINE}" stroke-opacity="${t.edge.toFixed(3)}" stroke-width="0.6"${glint ? `>${glint}</polygon>` : '/>'}`
  }).join('') + '</g>',
}
