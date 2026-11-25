import { expect, mock, test } from 'claude-code/testing'

import { dream, engine, episode, event, healthy, HOUR, iso, pane, problems, see } from './qa-fixtures'
import { chainSvg } from '../hooks/handoff-art'
import { cleanLook } from '../hooks/look'
import { lookColors } from '../hooks/look-colors'

// v4.3: older Timeline events open with their details, a numbered pager, the Handoff tab's light code row and the
// chain of chats around each earlier handoff, a mini rail inside Memory's opened fixes, and the AMOLED dark ground.

const LONG = { timeoutMs: 120_000 }
const BAD = /NaN|undefined|Infinity|\[object/
const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
async function start($: any): Promise<void> { await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($) }
const texts = async (ui: any) => see(await ui.drawn()).texts

// ── the Timeline ─────────────────────────────────────────────────────────────────────────────────────────────────
test('timeline: an old turn, loaded by Show older, opens with its numbers like a new one', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const turns = Array.from({ length: 60 }, (_, i) => event(0, (i + 1) * 3 * HOUR, { id: `turn-E${i}`, kind: 'turn', title: `Turn ${i}`, tags: [], tone: 'ok' }))
  const eps = Array.from({ length: 60 }, (_, i) => episode(i, (i + 1) * 3 * HOUR, { files: ['/demo/a.ts'], outTokens: 5000 }))
  engine(on, { status: () => ({ ...healthy(), timeline: turns, episodes: eps }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  // no pages: Show older grows the list (at most 48 drawn), so the oldest turns are reached by loading on
  for (let i = 0; i < 2; i++) await ui.press({ key: 'tl-more' })
  expect((await texts(ui))).toContain('13–60 of 60 · the oldest')
  expect((await texts(ui)).some(t => /^Showing /.test(t))).toBe(true)
  expect(await ui.find({ key: 'tlt-p0' }), 'no pager at the top').toBeUndefined()
  await ui.press({ key: 'tx-turn-E55' })
  const opened = await texts(ui)
  expect(opened, 'an old turn opens with its numbers').toContain('tokens Claude wrote')
  expect(problems(await ui.drawn())).toEqual([])
  await ui.press({ key: 'tl-less' })
  expect(await texts(ui)).toContain('1–24 of 60 · 36 older loaded')
  await ui.unmount()
})

// ── the Handoff tab ──────────────────────────────────────────────────────────────────────────────────────────────
test('handoff: the code row is one light row of figures with a sentence; an earlier handoff opens to its chain of chats', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const states = [
    { session: 's1-aaaaaaaa', at: iso(HOUR), from: 'claude-code', goal: 'Ship the parser', chat: 'Parser work', next: 'Run the benchmark', lastCheck: 'npm run check passed, 2 min ago.', rules: 3, decisions: 2, files: 4,
      continues: { session: 's0-bbbbbbbb', chat: 'Parser design' }, pickedUp: [{ session: 's2-cccccccc', chat: 'Parser release' }], work: { turns: 6, commits: 2, files: 9, ran: 12, failed: 1, out: 88_000 } },
    { session: 's0-bbbbbbbb', at: iso(5 * HOUR), from: 'claude-code', goal: 'Design it', chat: 'Parser design' },
  ]
  engine(on, { status: () => ({ ...healthy(), history: { states, wips: [] } }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-handoff' })
  const t0 = await texts(ui)
  expect(t0).toContain('changed files')
  expect(t0.some(t => /^Uncommitted work: each handoff snapshots it/.test(t))).toBe(true)
  await ui.press({ key: 'tx-hs-s1-aaaaaaaa' })
  const tree = await ui.drawn(), seen = see(tree)
  expect(problems(tree)).toEqual([])
  // (the drawn tree carries a drawing's alt, not its key)
  expect(seen.svgs.map(s => s.alt)).toContain('Continued “Parser design”; picked up by “Parser release”')
  expect(seen.texts).toContain('Next: Run the benchmark')
  expect(seen.texts).toContain('11 of 12')
  expect(seen.texts).toContain('The note pins 3 instructions · 2 decisions · 4 files named')
  // a handoff with nothing known around it still opens cleanly: started fresh, not picked up yet
  await ui.press({ key: 'tx-hs-s0-bbbbbbbb' })
  expect(see(await ui.drawn()).svgs.map(s => s.alt)).toContain('Started fresh; not picked up yet')
  await ui.unmount()
})

test('chain drawing: four stops, long names fit their column, missing stops are dashed, never nonsense', () => {
  const long = 'A very long chat title that would never fit inside one quarter of a narrow drawing at all'
  for (const width of [0, 300, 760]) {
    const s = chainSvg({ prev: { chat: long, id: 'x'.repeat(40) }, here: { chat: long, id: 'abcdef123456', turns: 1 }, note: '3 instructions · 2 decisions', next: [{ chat: '', id: 'zz' }, { chat: 'b', id: 'yy' }], width })
    expect(BAD.test(s), String(width)).toBe(false)
    expect(s).toContain('…')
    expect(s).toContain('1 reply')
    expect(s).toContain('2 chats picked up')
    expect(s.includes('Handoff note'), String(width)).toBe(width >= 440) // narrow: the note is a word on the link
  }
  const none = chainSvg({ here: { chat: '<script>', id: '', turns: 0 }, note: '', width: 400 })
  expect(none).toContain('Started fresh')
  expect(none).toContain('Not picked up yet')
  expect(none).toContain('stroke-dasharray')
  expect(none).not.toContain('<script>')
})

// ── Memory ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('memory: an opened past check joins its fixes with a mini rail, one elbow per fix', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const recent = [dream(0, 0, 'discarded'), dream(1, 3, 'applied')]
  engine(on, { status: () => ({ ...healthy(), dream: { running: null, recent } }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
  const id = recent[1].id
  const connectors = async () => see(await ui.drawn()).svgs.filter(s => s.alt === 'connector').length
  const before = await connectors()
  await ui.press({ key: `tx-dh-${id}` })
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(await connectors() - before, 'one elbow per fix (3 fixes)').toBe(3)
  await ui.unmount()
})

// ── the AMOLED ground ────────────────────────────────────────────────────────────────────────────────────────────
test('look: AMOLED black paints pure black in dark mode only; light mode is the same Mist as Obsidian', () => {
  const a = lookColors('amoled'), o = lookColors('obsidian')
  expect(a.problems.filter(x => x.startsWith("Desktop won't paint"))).toEqual([])
  expect(a.theme.inputs.dark?.['gray-900']).toBe('#000000')
  const differ = Object.keys(o.theme.inputs.light ?? {}).filter(k => a.theme.inputs.light?.[k] !== o.theme.inputs.light?.[k])
  expect(differ, 'only the tooltip, which is dark in both modes').toEqual(['role-tooltip-bg'])
  expect(a.problems.filter(x => /dark mode/.test(x)).length, 'only borders a touch faint on pure black').toBeLessThanOrEqual(18)
  expect(a.theme.inputs.dark?.['gray-830'], 'the app\'s panel surface is black too, so this panel matches').toBe('#000000')
  expect(cleanLook({ ground: 'amoled' }).ground).toBe('amoled')
  expect(cleanLook({ ground: 'neon' }).ground).toBe('obsidian')
})

test('look: Settings offers the dark-mode ground while the theme is on', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => healthy() })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-settings' })
  expect(await ui.find({ key: 'opt-lookGround-amoled' })).toBeDefined()
  await ui.press({ key: 'opt-lookGround-amoled' })
  expect(await texts(ui)).toContain('AMOLED black: the chat, this panel and the strip on pure black, one ground.')
  await ui.press({ key: 'opt-lookOn-off' })
  expect(await ui.find({ key: 'opt-lookGround-amoled' }), 'off: only the switch shows').toBeUndefined()
  await ui.unmount()
})
