import { expect, test } from 'claude-code/testing'

import { stripParts } from '../hooks/band'
import { measure, withinBudget } from '../hooks/guard'
import { textWidth } from '../hooks/theme'
import { paceTrack } from '../hooks/viz-plan'

// v4.5 (the Stageshow revamp): no alt words leak where the drawing budget runs out, the pace axis never lets two labels
// touch, and the narrowest strip drops the cache's words before it cuts them.

test('guard: past the budget a small drawing becomes a spacer of its width, a big one its words', () => {
  const svg = (k: number, width: number) => ({ type: 'Svg', props: { key: `s${k}`, source: 'x'.repeat(10_000), alt: `drawing ${k}`, width, height: 20 } })
  const tree = { type: 'Box', props: {}, children: [svg(0, 300), svg(1, 22), svg(2, 300)] }
  const out = withinBudget(tree, (key, alt) => ({ type: 'Text', props: { key }, children: [alt] }), { svgChars: 10_000, svgs: 140 }, (key, cols) => ({ type: 'Box', props: { key, width: cols } })) as { children: { type: string; props: Record<string, unknown>; children?: unknown[] }[] }
  expect(measure(out).svgs).toBe(1)
  expect(out.children[1]).toEqual({ type: 'Box', props: { key: 's1', width: 4 } }) // 22 px → 4 cells, no words
  expect(out.children[2]!.type).toBe('Text') // a chart keeps its words
  expect(JSON.stringify(out)).not.toContain('drawing 1')
})

test('pace track: the axis labels never come within 8 px of each other, at any width', () => {
  const start = Date.parse('2026-11-17T18:56:00'), reset = start + 5 * 3_600_000
  for (const width of [240, 300, 380, 420, 470, 600, 900]) {
    const { svg } = paceTrack({ used: 41, start, reset, now: start + 2 * 3_600_000, parts: [{ share: 1, color: '#10B981', label: 'a' }], width })
    const labs = [...svg.matchAll(/<text x="([\d.]+)" y="52" text-anchor="(start|middle|end)"[^>]*>([^<]+)<\/text>/g)].map(m => {
      const x = Number(m[1]), w = textWidth(m[3]!, 10)
      return m[2] === 'start' ? [x, x + w] : m[2] === 'end' ? [x - w, x] : [x - w / 2, x + w / 2]
    }).sort((a, b) => a[0]! - b[0]!)
    expect(labs.length).toBeGreaterThanOrEqual(2) // the start and the reset always show
    for (let i = 1; i < labs.length; i++) expect(labs[i]![0]! - labs[i - 1]![1]!).toBeGreaterThanOrEqual(8)
  }
})

test('strip: on the narrowest band the cache keeps its bar and drops its words, never "cache till" cut short', () => {
  const o = { ctx: 85, compactAt: 0.84, cacheShare: 0.6, cacheSec: 1800, cacheText: 'cache warm till 10:28 PM', cacheColor: '#34D399', plan: 41, week: 41, handoff: 'saved' as const, waiting: 0 }
  const roomy = stripParts(o, null, 2000)
  expect(roomy.main).toContain('cache warm till 10:28 PM')
  const narrow = stripParts(o, null, 120)
  expect(narrow.main).not.toContain('cache till')
  expect(narrow.main).toContain('85%')
  expect(narrow.words).toContain('cache warm till 10:28 PM') // still said, for hover and screen readers
})
