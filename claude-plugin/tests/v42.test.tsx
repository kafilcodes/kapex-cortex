import { expect, mock, test } from 'claude-code/testing'

import { engine, healthy, pane, problems, see } from './qa-fixtures'
import { paceTrack, splitBar, toolBlocks, waffle } from '../hooks/viz-plan'
import { checkDots, noteStrip } from '../hooks/viz-notes'
import { egmArt, transferSvg } from '../hooks/handoff-art'

// v4.2: panel buttons never send a prompt by themselves (the ask chooser), and the new drawings (the 5-hour pace
// track, model split, chats-vs-subagents waffle, tool blocks, the Memory note strip and check dots, the handoff art).

const LONG = { timeoutMs: 120_000 }
const BAD = /NaN|undefined|Infinity|\[object/
const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)

// ── the ask chooser ──────────────────────────────────────────────────────────────────────────────────────────────
test('ask: Load into this chat only asks; message box (after what you typed), copy and cancel each send nothing', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const prompts: string[] = [], toasts: string[] = [], filled: { text: string; mode: string }[] = []
  engine(on, { status: () => healthy(), prompts, toasts })
  let box = 'half a thought'
  on('prompt.read', () => ({ value: { text: box } }))
  on('prompt.fill', (_: unknown, e: any) => { filled.push({ text: String(e?.text), mode: String(e?.mode) }); box += String(e?.text); return { isFilled: true } })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-handoff' })
  expect(problems(await ui.drawn())).toEqual([])

  // the button opens the choice; pressing it again closes it
  await ui.press({ key: 'kc-resume' })
  expect(prompts, 'nothing is sent by the button').toEqual([])
  expect(see(await ui.drawn()).texts.some(t => /Nothing is sent until you choose/.test(t))).toBe(true)
  await ui.press({ key: 'kc-resume' })
  expect(await ui.find({ key: 'ask-resume-box' })).toBeUndefined()

  // message box: appended after what you already typed, never over it, and not sent
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'ask-resume-box' })
  expect(filled.length).toBe(1)
  expect(filled[0]!.mode).toBe('append')
  expect(filled[0]!.text.startsWith('\n\n')).toBe(true)
  expect(box.startsWith('half a thought')).toBe(true)
  expect(prompts).toEqual([])
  expect(await ui.find({ key: 'ask-resume-box' }), 'the choice closes once made').toBeUndefined()

  // copy for a new chat: copied, not sent
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'ask-resume-copy' })
  expect(toasts.filter(t => /^Copied/.test(t)).length).toBe(1) // the engine's ui.copy says it copied
  expect(prompts).toEqual([])

  // cancel: nothing at all
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'ask-resume-no' })
  expect([prompts.length, toasts.filter(t => /^Copied/.test(t)).length, filled.length]).toEqual([0, 1, 1])
  expect(await ui.find({ key: 'ask-resume-no' })).toBeUndefined()

  // only one choice is open at a time: opening the check closes the resume choice
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'kc-fish' })
  expect(await ui.find({ key: 'ask-resume-box' })).toBeUndefined()
  expect(await ui.find({ key: 'ask-fish-box' })).toBeDefined()
  await ui.unmount()
})

test('ask: an empty message box is filled, not appended to; a box that cannot be reached says to use Copy', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const prompts: string[] = [], toasts: string[] = [], filled: string[] = []
  engine(on, { status: () => healthy(), prompts, toasts })
  let reachable = true
  on('prompt.read', () => { if (!reachable) throw new Error('no box'); return { value: { text: '  ' } } })
  on('prompt.fill', (_: unknown, e: any) => { filled.push(String(e?.mode)); return { isFilled: true } })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-handoff' })
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'ask-resume-box' })
  expect(filled).toEqual(['replace'])
  reachable = false
  await ui.press({ key: 'kc-resume' }); await ui.press({ key: 'ask-resume-box' })
  expect(toasts.some(t => /use Copy/.test(t))).toBe(true)
  expect(prompts).toEqual([])
  await ui.unmount()
})

// ── the drawings ─────────────────────────────────────────────────────────────────────────────────────────────────
test('pace track: the verdict follows the pace (out before the reset, or room to spare), at any width', () => {
  const start = Date.UTC(2026, 10, 17, 5), reset = start + 5 * 3_600_000
  const parts = [{ share: 3, color: '#10B981', label: 'chat a' }, { share: 1, color: '#14B8A6', label: 'chat b' }]
  // 60% used with 40% of the window gone: 150% by the reset, out at 3h20m in
  const hot = paceTrack({ used: 60, start, reset, now: start + 2 * 3_600_000, parts, width: 500 })
  expect(Math.abs(hot.atReset - 1.5)).toBeLessThan(1e-9)
  expect(hot.out).toBe(start + Math.round(5 * 3_600_000 / 1.5))
  expect(hot.svg).toContain('out at')
  // 10% used at half time: 20% by the reset, never out
  const calm = paceTrack({ used: 10, start, reset, now: start + 2.5 * 3_600_000, parts, width: 500 })
  expect(calm.out).toBeNull()
  expect(Math.abs(calm.atReset - 0.2)).toBeLessThan(1e-9)
  // the very start of the window has no pace yet; odd inputs never draw nonsense
  expect(paceTrack({ used: 0, start, reset, now: start, parts: [], width: 10 }).atReset).toBe(0)
  // 15% used 4 minutes in: too early for a pace, and the projection never drops below what is used
  const early = paceTrack({ used: 15, start, reset, now: start + 4 * 60_000, parts, width: 500 })
  expect([early.early, early.atReset, early.out]).toEqual([true, 0.15, null])
  expect(paceTrack({ used: 15, start, reset, now: start + 2 * 3_600_000, parts, width: 500 }).early).toBe(false)
  for (const w of [0, 240, 1200]) for (const used of [0, 100, 140]) {
    const s = paceTrack({ used, start, reset, now: start + 3_600_000, parts, width: w }).svg
    expect(BAD.test(s), `${w} ${used}`).toBe(false)
  }
})

test('split bar, waffle and tool blocks: shares add up, names show where they fit, the rest is listed under', () => {
  const bar = splitBar({ width: 400, items: [{ label: 'Opus 5.5', value: 3, color: '#10B981' }, { label: 'Fable 5.2', value: 1, color: '#F59E0B' }, { label: 'Haiku', value: 0, color: '#fff' }] })
  expect(bar).toContain('Opus 5.5 75%')
  expect(bar).toContain('Fable 5.2 25%')
  expect(bar).not.toContain('Haiku')
  expect(BAD.test(splitBar({ width: 0, items: [] }))).toBe(false)

  const wf = waffle({ a: 9, b: 1, colors: ['#10B981', '#5EEAD4'], titles: ['Your chats: 90%', 'Subagents: 10%'] })
  expect((wf.match(/<rect/g) ?? []).length).toBe(20)
  expect((wf.match(/#5EEAD4/g) ?? []).length).toBe(2) // 10% of 20 squares
  expect(BAD.test(waffle({ a: 0, b: 0, colors: ['#10B981', '#5EEAD4'], titles: ['a', 'b'] }))).toBe(false)

  const tb = toolBlocks({ width: 300, items: [{ label: 'Shell', n: 40 }, { label: 'Files', n: 12 }, { label: 'WebSearch', n: 1 }, { label: 'None', n: 0 }] })
  expect(tb.svg).toContain('Shell 40')
  expect(tb.unnamed.map(x => x.label)).toContain('WebSearch')
  expect(tb.svg).not.toContain('None')
  expect(BAD.test(tb.svg)).toBe(false)
  // seven tools in the narrowest drawing: every block stays inside it
  const narrow = toolBlocks({ width: 100, items: Array.from({ length: 7 }, (_, i) => ({ label: `T${i}`, n: 7 - i })) })
  const ends = [...narrow.svg.matchAll(/<rect x="([\d.]+)" y="0" width="([\d.]+)"/g)].map(m => Number(m[1]) + Number(m[2]))
  expect(ends.length).toBe(7)
  expect(Math.max(...ends)).toBeLessThanOrEqual(160.5)
})

test('memory note strip and check dots: one segment per kind of note, one dot per check, never nonsense', () => {
  const strip = noteStrip({ total: 10, open: 2, fixed: 3, kept: 1, width: 300 })
  expect(BAD.test(strip)).toBe(false)
  expect(BAD.test(noteStrip({ total: 0, open: 0, fixed: 0, kept: 0, width: 0 }))).toBe(false)
  const checks = (['clean', 'waiting', 'fixed', 'dropped', 'failed'] as const).map((status, i) => ({ found: i, status, title: `check ${i}`, when: `${i} d ago` }))
  const dots = checkDots({ checks, width: 400 })
  for (const c of checks) expect(dots).toContain(c.title)
  expect(BAD.test(dots)).toBe(false)
  expect(BAD.test(checkDots({ checks: [], width: 0 }))).toBe(false)
})

test('handoff art: the chat-to-note drawing is to scale and labelled; the Elephant–Goldfish art is our own', () => {
  const t = transferSvg({ here: 700_000, start: 5_000, width: 520 })
  expect(BAD.test(t)).toBe(false)
  expect(t).toContain('700k')
  for (const [here, start] of [[0, 0], [1, 1e9], [1e9, 1]]) expect(BAD.test(transferSvg({ here, start, width: 0 })), `${here} ${start}`).toBe(false)
  const egm = egmArt()
  expect(BAD.test(egm)).toBe(false)
  expect(/google/i.test(egm), "never Google's marks in the drawing").toBe(false)
})

test('plan card: a used-up plan says so, never "about 200% by the reset"', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const window = { since: new Date(Date.now() - 150 * 60_000).toISOString(), slotMs: 600_000, rows: [], tools: [], chats: [] }
  const reset = new Date(Date.now() + 150 * 60_000).toISOString()
  engine(on, { status: () => ({ ...healthy(), project: 'demo', window }), usage: () => ({ startedAt: 0, version: 'x', context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [{ kind: 'five_hour', percentUsed: 100, resetsAt: reset }] }) })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-details' }); await ui.press({ key: 'sub-costs' })
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  const texts = see(tree).texts
  expect(texts.some(t => /^You have used the whole plan: it resets at .+, in /.test(t))).toBe(true)
  expect(texts.some(t => /by the reset/.test(t))).toBe(false)
  await ui.unmount()
})

test('plan card: 3 minutes into the window the pace is too new to read', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const window = { since: new Date(Date.now() - 3 * 60_000).toISOString(), slotMs: 600_000, rows: [], tools: [], chats: [] }
  const reset = new Date(Date.now() + 297 * 60_000).toISOString()
  engine(on, { status: () => ({ ...healthy(), project: 'demo', window }), usage: () => ({ startedAt: 0, version: 'x', context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [{ kind: 'five_hour', percentUsed: 15, resetsAt: reset }] }) })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-details' }); await ui.press({ key: 'sub-costs' })
  const texts = see(await ui.drawn()).texts
  expect(texts).toContain('Too early in the window to tell the pace.')
  expect(texts.some(t => /room to spare/.test(t))).toBe(false)
  await ui.unmount()
})

test('handoff page draws clean at narrow and wide sizes, with the chat-to-note drawing and the EGM credit', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => healthy() })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($)
  for (const cols of [48, 90, 200]) {
    const ui: any = await $.ui.mount({ ...pane(cols), surface: 'desktop' } as any)
    await ui.press({ key: 'tab-handoff' })
    const tree = await ui.drawn()
    expect(problems(tree), String(cols)).toEqual([])
    expect(see(tree).texts.some(t => /Elephant.Goldfish Model/.test(t)), String(cols)).toBe(true)
    await ui.unmount()
  }
})
