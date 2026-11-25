import { expect, mock, test } from 'claude-code/testing'

import { BAND, dream, engine, events, healthy, pane, problems, see } from './qa-fixtures'
import { BUDGET, measure, safely, withinBudget } from '../hooks/guard'
import { cleanLook, LOOK_DEFAULT } from '../hooks/look'
import { BACKDROPS, backdropSvg } from '../hooks/look-scenes'
import { lookColors } from '../hooks/look-colors'
import { drainHeat, HEAT, heat } from '../hooks/theme'
import { drainSteps } from '../hooks/band'
import { memRing } from '../hooks/viz-mem'
import { outcomeText, suggestFor } from '../hooks/dream-tab'

// v4.1: the panel's safety net, the Kapex look, the strip's graded colours, the Memory check's decided list and the
// 5-hour plan breakdown.

const LONG = { timeoutMs: 120_000 }
const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
async function start($: any): Promise<void> { await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($) }

// ── the safety net ───────────────────────────────────────────────────────────────────────────────────────────────
test('guard: a page that throws becomes a reason, and a drawing over budget keeps its first drawings and words for the rest', () => {
  expect(safely(() => 1)).toEqual({ ok: true, tree: 1 })
  const bad = safely(() => { throw new Error('boom\nline two') })
  expect(bad.ok).toBe(false)
  expect(!bad.ok && bad.why).toBe('boom line two')
  const svg = (k: number) => ({ type: 'Svg', props: { key: `s${k}`, source: 'x'.repeat(10_000), alt: `drawing ${k}` } })
  const tree = { type: 'Box', props: {}, children: Array.from({ length: 40 }, (_, i) => svg(i)) }
  const out = withinBudget(tree, (key, alt) => ({ type: 'Text', props: { key }, children: [alt] }), { svgChars: 100_000, svgs: 140, nodes: 9999 })
  const m = measure(out)
  expect(m.svgs).toBe(10)
  expect(m.svgChars).toBeLessThanOrEqual(100_000)
  expect(see(out).texts).toContain('drawing 39')
  expect(withinBudget({ type: 'Box', props: {}, children: [svg(1)] }, () => null)).toEqual({ type: 'Box', props: {}, children: [svg(1)] }) // within: the same tree
  expect(BUDGET.svgs).toBeGreaterThan(60) // a full Timeline page (~60 drawings) is never cut
  // one drawing past the engine's hard limit would blank the pane on its own: it becomes words even under budget
  const big = { type: 'Box', props: {}, children: [{ type: 'Svg', props: { key: 'b', source: 'x'.repeat(140_000), alt: 'too big' } }] }
  expect(measure(withinBudget(big, (key, alt) => ({ type: 'Text', props: { key }, children: [alt] }))).svgs).toBe(0)
})

// ── the Kapex look ───────────────────────────────────────────────────────────────────────────────────────────────
test('look: the Obsidian ground builds a palette the desktop app paints, for light and dark', () => {
  for (const g of ['obsidian'] as const) {
    const { theme, problems: p } = lookColors(g)
    expect(p.filter(x => x.startsWith("Desktop won't paint")), g).toEqual([])
    expect(Object.keys(theme.inputs.dark ?? {}).length).toBeGreaterThan(80)
    expect(Object.keys(theme.inputs.light ?? {}).length).toBeGreaterThan(80)
  }
})

test('look: every backdrop is one small SVG that fills any window, at each motion speed; "none" draws nothing', () => {
  for (const b of ['prism', 'facets', 'contour', 'mesh', 'aurora'] as const) for (const m of ['off', 'slow', 'medium', 'fast'] as const) {
    const s = backdropSvg(b, m)!
    expect(s.length, `${b} ${m}`).toBeLessThan(131_072)
    expect(s).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(/NaN|undefined|Infinity/.test(s)).toBe(false)
    expect(s).not.toContain('@keyframes')
    if (m === 'off') expect(s, `${b} off: nothing animates`).not.toMatch(/<animate/)
    else expect(s, `${b} ${m}: it moves`).toMatch(/<animate/)
    // Cortex's own setting: the Mac's Reduce Motion never stops it (v4.8)
    expect(s, `${b} ${m}`).not.toContain('prefers-reduced-motion')
  }
  expect(backdropSvg('contour', 'medium')!.match(/attributeName="stroke-opacity"/g)!.length, 'contour pulses through its rings').toBeGreaterThanOrEqual(20)
  // faster is faster: the contour drift's cycle shortens with each speed
  const cycle = (m: 'slow' | 'medium' | 'fast') => Number(/attributeName="transform" type="translate"[^>]*dur="([\d.]+)s"/.exec(backdropSvg('contour', m)!)![1])
  expect(cycle('slow')).toBeGreaterThan(cycle('medium'))
  expect(cycle('medium')).toBeGreaterThan(cycle('fast'))
  expect(backdropSvg('none', 'fast')).toBeNull()
})

test('look: a saved choice is made safe (an unknown ground or backdrop falls back), and it starts unchosen', () => {
  expect(cleanLook(undefined)).toEqual(LOOK_DEFAULT)
  expect(cleanLook({ on: false, ground: 'neon', backdrop: 'stars', motion: 'yes' })).toEqual({ ...LOOK_DEFAULT, on: false })
  expect(cleanLook({ ground: 'graphite', backdrop: 'none', chosen: true }), 'Graphite was dropped in v4.2: it shows Obsidian').toMatchObject({ ground: 'obsidian', backdrop: 'none', chosen: true })
  expect(cleanLook({ backdrop: 'orbit' }).backdrop, 'Orbit was dropped in v4.4: it shows Prism').toBe('prism')
  expect(BACKDROPS.map(b => b[0])).not.toContain('orbit')
  for (const old of [true, 'on', 'auto']) expect(cleanLook({ motion: old }).motion, `older save ${old}`).toBe('medium')
  for (const old of [false, 'off']) expect(cleanLook({ motion: old }).motion).toBe('off')
  expect(cleanLook({ motion: 'fast' }).motion).toBe('fast')
  expect(cleanLook({}).motion, 'nothing saved: medium').toBe('medium')
  expect(cleanLook({ backdrop: 'facets' }).backdrop).toBe('facets')
})

test('look: Settings turns it off and back on, and changes the backdrop and motion (the test engine draws no theme)', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => healthy() })
  await start($) // $.theme is missing here, as on a surface without themes: the session still starts
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-settings' })
  expect(problems(await ui.drawn())).toEqual([])
  expect(await ui.find({ key: 'opt-lookGround-graphite' }), 'no ground choice: Obsidian only').toBeUndefined()
  for (const k of ['opt-lookDrop-mesh', 'opt-lookMotion-off']) await ui.press({ key: k })
  const chosen = async (key: string) => see(await ui.drawn()).texts.includes(key)
  expect(await chosen('Signal mesh: a dot grid with a few linked nodes.')).toBe(true)
  expect(await chosen('Off: the pattern never moves.')).toBe(true)
  await ui.press({ key: 'opt-lookOn-off' })
  expect(await ui.find({ key: 'opt-lookDrop-mesh' }), 'off: only the switch shows').toBeUndefined()
  await ui.press({ key: 'opt-lookOn-on' })
  expect(await ui.find({ key: 'opt-lookDrop-mesh' }), 'on again: the choices are kept').toBeDefined()
  expect(await chosen('Signal mesh: a dot grid with a few linked nodes.')).toBe(true)
  expect(await ui.find({ key: 'opt-lookDrop-orbit' }), 'no Orbit choice').toBeUndefined()
  await ui.press({ key: 'opt-lookDrop-facets' })
  expect(await chosen('Crystal facets: a low-poly field glowing out of two corners.')).toBe(true)
  await ui.unmount()
})

test('look: the terminal has no Look card (it draws no theme)', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => healthy() })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'terminal' } as any)
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'opt-lookOn-on' })).toBeUndefined()
  await ui.unmount()
})

// ── the strip's colours ──────────────────────────────────────────────────────────────────────────────────────────
test('strip colours: the context ring and plan turn yellow at 60%, orange at 80%, red at 90%; the cache bar steps down as it empties', () => {
  expect([0.3, 0.6, 0.79, 0.8, 0.89, 0.9, 1].map(heat)).toEqual([HEAT.ok, HEAT.warn, HEAT.warn, HEAT.high, HEAT.high, HEAT.bad, HEAT.bad])
  expect([1, 0.6, 0.5, 0.3, 0.25, 0.15, 0.1, 0].map(drainHeat)).toEqual([HEAT.ok, HEAT.ok, HEAT.warn, HEAT.warn, HEAT.high, HEAT.high, HEAT.bad, HEAT.bad])
  const full = drainSteps(1, 300)
  expect(full).toContain(`values="${HEAT.ok};${HEAT.warn};${HEAT.high};${HEAT.bad}"`)
  expect(full).toContain('keyTimes="0.0000;0.5000;0.7500;0.9000"')
  expect(drainSteps(0.2, 60)).toContain(`values="${HEAT.high};${HEAT.bad}"`) // already past two steps: only the rest
  expect(drainSteps(0.05, 15)).toBe('') // already in the last step: nothing to change
})

test('strip: a suggestion shows the Cortex mark in its colour, never the warning triangle, and the logo is 22 px', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => healthy(), usage: () => ({ startedAt: 0, version: 'x', context: { tokens: 170_000, window: 200_000, percent: 85, breakdown: { categories: [{ name: 'Autocompact buffer', tokens: 33_000, isDeferred: false }], maxTokens: 200_000 } }, rateLimits: [] }) })
  await start($)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  const band: any = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 130 } } as any)
  const s = see(await band.drawn())
  const tip = s.svgs.find(g => /Handoff suggested/.test(g.alt))
  expect(tip, 'the suggestion pill').toBeDefined()
  expect(tip!.source).toContain('M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z') // the Cortex mark
  expect(tip!.source).not.toContain('M12 4l9 16H3z') // not the warning triangle
  const logo = (await band.find({ key: 'kc-mark' })) as any
  expect(logo?.props?.width ?? 22).toBe(22)
  await band.unmount()
})

// ── the Memory check ─────────────────────────────────────────────────────────────────────────────────────────────
test('memory check: Cortex\'s pick shows before you choose, and a decided finding says what it did', () => {
  const d: any = dream(0, 3, 'proposed')
  const f = (over: any) => ({ id: 'X', kind: 'stale', severity: 'medium', by: 'check', file: d.files[0].path, label: d.files[0].label, line: 9, end: 9, entry: 'a note', why: 'gone', evidence: [], action: { op: 'none' }, ...over })
  expect(suggestFor(d, f({})).pick).toBe('ask') // stale but part of it may still hold: a rewrite keeps what does
  expect(suggestFor(d, f({ kind: 'duplicate' })).pick).toBe('remove')
  expect(suggestFor(d, f({ action: { op: 'replace', text: 'Shorter.' } })).text).toBe('rewrite it as “Shorter.”')
  expect(suggestFor(d, f({ entry: '', line: 0, kind: 'orphan' })).pick).toBe('keep')
  expect(outcomeText(f({ done: 'applied', action: { op: 'delete' } }))).toBe(`Removed line 9 from ${d.files[0].label}`)
  expect(outcomeText(f({ done: 'kept' }))).toMatch(/^Kept as it is: /)
})

test('memory check: a decided finding leaves "Waiting for you" for "Fixes you can undo", with its Undo', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const d: any = dream(0, 3, 'proposed')
  d.findings[0].done = 'applied'
  engine(on, { status: () => ({ ...healthy(), dream: { running: null, recent: [d] } }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  const keys = see(tree).keys
  expect(keys).toContain(`tile-${d.id}-${d.findings[0].id}-done`)
  expect(keys).not.toContain(`tile-${d.id}-${d.findings[0].id}`)
  expect(await ui.find({ key: `fu-${d.findings[0].id}` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Waiting for you$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Fixes you can undo$/ })).toBeDefined()
  await ui.unmount()
})

test('memory ring: findings about whole files can outnumber the notes read, and the ring never passes 100%', () => {
  const s = memRing({ total: 3, open: 5, fixed: 2, kept: 1 })
  expect(s).toContain('>0%<')
  expect(/>\d{3,}%</.test(s)).toBe(false)
  expect(memRing({ total: 0, open: 0, fixed: 0, kept: 0 })).toContain('>–<')
})

// ── the 5-hour plan ──────────────────────────────────────────────────────────────────────────────────────────────
test('plan card: what used the plan, by chat (titles, other projects named), model and helpers, kept to the window', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const slot = (minsAgo: number) => Math.floor((Date.now() - minsAgo * 60_000) / 600_000)
  const window = {
    since: new Date(Date.now() - 5 * 3_600_000).toISOString(), slotMs: 600_000,
    rows: [
      { slot: slot(20), chat: 's1', model: 'opus-5-5', sub: false, tokens: 3_000_000, weight: 600_000, replies: 30 },
      { slot: slot(40), chat: 's1', model: 'opus-5-5', sub: true, tokens: 400_000, weight: 100_000, replies: 8 },
      { slot: slot(60), chat: 's2', model: 'fable-5-2', sub: false, tokens: 500_000, weight: 300_000, replies: 5 },
      { slot: slot(400), chat: 's3', model: 'opus-5-5', sub: false, tokens: 9_000_000, weight: 9_000_000, replies: 90 }, // before the window
    ],
    tools: [{ slot: slot(20), tool: 'Shell', n: 12 }, { slot: slot(30), tool: 'Files', n: 5 }],
    chats: [{ id: 's1', title: 'Fix the strip', project: 'demo' }, { id: 's2', title: 'Landing page', project: 'kapex-site' }, { id: 's3', title: 'Old', project: 'demo' }],
  }
  const reset = new Date(Date.now() + 3 * 3_600_000).toISOString()
  engine(on, { status: () => ({ ...healthy(), project: 'demo', window }), usage: () => ({ startedAt: 0, version: 'x', context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: reset }] }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-details' }); await ui.press({ key: 'sub-costs' })
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  const texts = see(tree).texts
  expect(texts).toContain('Fix the strip (this chat)')
  expect(texts).toContain('Landing page · kapex-site')
  expect(texts.some(t => /^Old/.test(t)), 'a chat from before the window is left out').toBe(false)
  expect(texts).toContain('~28% of plan') // 700k of 1,000k weighted, of the 40% used
  expect(texts).toContain('~12% of plan')
  const alts = see(tree).svgs.map(s => s.alt).join(' | ')
  expect(alts).toContain('Fable 5.2') // the model split is a drawing now; its alt names each model
  expect(alts).toContain('Shell 12') // so are the tool blocks
  await ui.unmount()
})

test('timeline at a huge size keeps every tab working: switch tabs from the last page and back', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => ({ ...healthy(), timeline: events(160, 20, 300) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(260), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let i = 0; i < 6; i++) await ui.press({ key: 'tl-more' })
  for (const t of ['overview', 'data', 'handoff', 'details', 'settings', 'timeline']) {
    await ui.press({ key: `tab-${t}` })
    const tree = await ui.drawn()
    expect(problems(tree), t).toEqual([])
    expect(see(tree).chars, t).toBeLessThan(400_000)
  }
  await ui.unmount()
})
