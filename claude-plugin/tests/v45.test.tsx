import { expect, test } from 'claude-code/testing'

import { stripLevels, stripWidth, type StripModel } from '../hooks/strip'
import { tipMessage } from '../hooks/band'
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

test('strip: narrower, words leave before facts; the chat number is never cut, and every fact stays in the hover words', () => {
  const m: StripModel = { ctx: 85, ctxColor: '#F43F5E', waiting: 0, failed: false,
    cache: { share: 0.6, sec: 1800, until: '10:28 PM', state: 'warm', color: '#34D399', stepped: true },
    msg: { icon: 'check', mark: '#10B981', ink: 'text', text: 'All good · handoff saved', short: 'All good', alt: 'All good', keep: true } }
  const roomy = stripLevels(m, 2000), mid = stripLevels(m, 560), narrow = stripLevels(m, 300)
  expect(roomy).toEqual({ vitals: 0, msg: 0, narrow: false, refresh: true }) // "85% full · cache till 10:28 PM | All good · handoff saved"
  expect(mid.vitals).toBeGreaterThan(0) // shorter words first ("till 10:28 PM")
  expect(narrow.vitals).toBeGreaterThanOrEqual(3) // the cache leaves before the chat's number does
  for (const l of [roomy, mid, narrow]) expect(stripWidth(m, l) <= 2000).toBe(true)
  expect(stripWidth(m, mid)).toBeLessThanOrEqual(560)
})

test('strip message: with a button the words are the reason, never the verb again, and never a bare number', () => {
  const t = (o: any) => tipMessage({ level: 'act', icon: 'link', color: '#F43F5E', detail: 'd', action: 'handoff', ...o })
  expect(t({ text: 'Handoff suggested · saves ~162k a message', short: 'Handoff suggested · ~162k' })).toMatchObject({ text: 'Saves ~162k a message', short: 'Saves ~162k', ink: 'error', action: { label: 'Hand off', primary: true } })
  expect(t({ text: '5h plan 95% used · Handoff suggested', short: 'Handoff suggested' })).toMatchObject({ text: '5h plan 95% used', short: '5h plan 95% used' })
  const review = tipMessage({ level: 'warn', icon: 'dream', color: '#F59E0B', detail: 'd', action: 'review', text: '1 memory fix to review' })
  expect(review).toMatchObject({ text: '1 memory fix', ink: 'warning', mark: '#D97706', keep: true, action: { label: 'Review', primary: false } })
  const mem = tipMessage({ level: 'warn', icon: 'alert', color: '#F59E0B', detail: 'd', action: 'memory', text: "MEMORY.md too long · Claude can't see the rest", short: 'MEMORY.md too long' })
  expect(mem).toMatchObject({ icon: 'alert', short: 'MEMORY.md too long', action: { label: 'Fix' }, keep: true })
})
