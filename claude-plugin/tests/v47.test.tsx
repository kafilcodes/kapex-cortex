import { expect, test } from 'claude-code/testing'

import { introDots } from '../hooks/intro'
import { backdropSvg } from '../hooks/look-scenes'
import { alive, moodSvg, sceneSvg } from '../hooks/mascot'

// v4.7: the intro's step dots keep a full gap at every step and never run past their drawing (the pill used to touch
// the next dot, and was cut off on the last step); moving between steps, the pill slides from where it was.

const rects = (svg: string) => [...svg.matchAll(/<rect x="([\d.]+)" width="([\d.]+)"/g)].map(m => [Number(m[1]), Number(m[1]) + Number(m[2])] as const)

test('intro dots: an even gap between every dot, the pill whole inside the drawing, at every step', () => {
  for (const at of [0, 1, 2]) {
    const svg = introDots(at), w = Number(/width="(\d+)"/.exec(svg)![1])
    const r = rects(svg)
    expect(r.length).toBe(3)
    expect(r[0]![0]).toBe(0)
    expect(r[2]![1], `step ${at + 1}: the last dot ends at the drawing's edge, not past it`).toBe(w)
    const gaps = [r[1]![0] - r[0]![1], r[2]![0] - r[1]![1]]
    expect(gaps[0], `step ${at + 1}`).toBe(gaps[1])
    expect(gaps[0]).toBeGreaterThanOrEqual(5)
    // the current step is the one wide pill
    expect(r.map(([a, b]) => b - a).filter(x => x > 8).length).toBe(1)
    expect(r[at]![1] - r[at]![0]).toBeGreaterThan(8)
  }
  expect(new Set([0, 1, 2].map(at => /width="(\d+)"/.exec(introDots(at))![1])).size, 'one width at every step, so the buttons beside it never move').toBe(1)
})

test('intro dots: still on a redraw of one step; slides once when the step changes', () => {
  expect(introDots(1)).not.toContain('<animate')
  const moved = introDots(1, 0)
  expect(moved).toContain('attributeName="x"')
  expect(moved).toContain('attributeName="width"')
  expect(moved).toContain('fill="freeze"')
  expect(moved).not.toContain('repeatCount')
})

test('mascot: alive() lands once and blinks once, never loops; the still drawing has no motion', () => {
  const still = moodSvg('hi', 150), live = alive(still)
  expect(still).not.toContain('<animate')
  expect(live.match(/attributeName="ry"/g)!.length, 'both open eyes blink').toBe(2)
  expect(live).not.toContain('repeatCount')
  expect(live).not.toMatch(/<g opacity="0"/) // the resting drawing is whole without animation
  expect(alive(sceneSvg('dream', 100))).not.toContain('attributeName="ry"') // sleeping eyes don't blink
})

test('backdrops: every motion is stepped (calcMode discrete) and never animates geometry, so a moving backdrop costs about what a still one does', () => {
  // measured in headless Brave (scratch tooling, 2026-11-18): smooth SMIL 13-34% of a core, stepped 1-5%, a still image ~0.1%;
  // animating a radius made the app lay the drawing out every frame even at rest (~14%)
  for (const b of ['prism', 'facets', 'contour', 'mesh', 'aurora'] as const) {
    for (const sp of ['slow', 'medium', 'fast'] as const) {
    const s = backdropSvg(b, sp)!
    const anims = s.match(/<animate(Transform)?\b[^>]*>/g) ?? []
    expect(anims.length, b).toBeGreaterThan(0)
    for (const a of anims) {
      expect(a, `${b}: stepped`).toContain('calcMode="discrete"')
      expect(a, `${b}: no geometry`).toMatch(/attributeName="(transform|opacity|fill-opacity|stroke-opacity|stroke-dashoffset)"/)
      const vals = /values="([^"]*)"/.exec(a)![1]!.split(';').length, dur = Number(/dur="([\d.]+)s"/.exec(a)![1])
      expect(vals / dur, `${b} ${sp}: at most 12 steps a second`).toBeLessThanOrEqual(12.5)
    }
    }
    // the still copy and "off" never animate
    expect(backdropSvg(b, 'off')).not.toContain('<animate')
  }
})
