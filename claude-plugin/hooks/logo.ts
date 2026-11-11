// Kapex Cortex mark: the "Vault Prism". A hexagonal prism cut into six twisted facets, emerald on the left and silver
// on the right (the same faceted family as the Kapex AI star), around an open core. No letters, no gradients:
// flat facets with real gaps stay sharp from 14 px (status strip) to 4K (README; scripts/logo-png.ts draws the PNG
// from these same shapes).
// To use your own logo: replace LOGO_SVG with your SVG's text and keep width/height on the <svg> tag.
// Keep it under ~100 KB (the engine refuses Svg sources over 131,072 characters).
import { K } from './theme.ts'

export const LOGO_SIZE = 22

type Pt = [number, number]
export type Shape = { points: Pt[]; fill: string } | { circle: [number, number, number]; fill: string }

/** The mark as plain shapes on a 64×64 grid, drawn in order. */
export function logoShapes(): Shape[] {
  const c = 32, R = 27, r = 9
  // the core's corners turn 24° ahead of the rim's, so each facet twists: a prism caught mid-turn
  const pt = (i: number, rad: number): Pt => {
    const a = ((-90 + 60 * i + (rad === r ? 24 : 0)) * Math.PI) / 180
    return [c + rad * Math.cos(a), c + rad * Math.sin(a)]
  }
  // facets clockwise from the top: silver light → silver → slate → pine → emerald → sage. The gaps between them are
  // real (each facet is inset 0.8 units from its two radial edges), so the mark works on dark and light backgrounds.
  const fills = ['#E5E7EB', '#9CA3AF', '#4B5563', '#064E3B', K.emerald, K.sage]
  const GAP = 0.8
  /** Where two lines meet, each given as a point and a direction. */
  const meet = (p: Pt, d: Pt, q: Pt, e: Pt): Pt => {
    const den = d[0] * e[1] - d[1] * e[0]
    const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den
    return [p[0] + t * d[0], p[1] + t * d[1]]
  }
  const shift = (a: Pt, b: Pt, toward: Pt): [Pt, Pt] => {
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy)
    let nx = -dy / len, ny = dx / len
    if ((toward[0] - a[0]) * nx + (toward[1] - a[1]) * ny < 0) { nx = -nx; ny = -ny }
    return [[a[0] + nx * GAP, a[1] + ny * GAP], [dx, dy]]
  }
  const out: Shape[] = fills.map((fill, i) => {
    const [i0, o0, o1, i1] = [pt(i, r), pt(i, R), pt(i + 1, R), pt(i + 1, r)]
    const mid: Pt = [(i0[0] + o0[0] + o1[0] + i1[0]) / 4, (i0[1] + o0[1] + o1[1] + i1[1]) / 4]
    const [a0, da] = shift(i0, o0, mid), [b0, db] = shift(i1, o1, mid)
    const rimD: Pt = [o1[0] - o0[0], o1[1] - o0[1]], coreD: Pt = [i1[0] - i0[0], i1[1] - i0[1]]
    return { points: [meet(a0, da, i0, coreD), meet(a0, da, o0, rimD), meet(b0, db, o0, rimD), meet(b0, db, i0, coreD)], fill }
  })
  out.push({ circle: [32, 32, 3.2], fill: K.sage })
  return out
}

/** The mark as SVG text at any pixel size. */
export function logoSvg(size = 64): string {
  const body = logoShapes().map((s) => ('circle' in s
    ? `<circle cx="${s.circle[0]}" cy="${s.circle[1]}" r="${s.circle[2]}" fill="${s.fill}"/>`
    : `<polygon points="${s.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}" fill="${s.fill}"/>`)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`
}

export const LOGO_SVG = logoSvg(64)
