import { expect, mock, test } from 'claude-code/testing'

import { dream, engine, event, healthy, HOUR, pane, problems, see } from './qa-fixtures'
import { nodeSvg } from '../hooks/icons'
import { lead } from '../hooks/leads'
import { cleanLook, LOOK_DEFAULT } from '../hooks/look'
import { backdropSvg } from '../hooks/look-scenes'

// v4.10: no icon in a disc anywhere; Contour is the default backdrop and its wave is visible; a Dream that fell back
// from your own key to Claude says so; the Handoff page tells you how to carry on in OpenCode; opened commits show
// what they changed.

const LONG = { timeoutMs: 120_000 }
const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
async function start($: any): Promise<void> { await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($) }
const texts = async (ui: any) => see(await ui.drawn()).texts

test('icons: a row\'s icon is the plain outlined glyph, with no disc or ring behind it', () => {
  for (const name of ['check', 'alert', 'minus', 'plus', 'failed', 'next', 'pause', 'calendar', 'commit']) { // (the clock, 'pending', is a clock face: its circle is the clock)
    const svg = nodeSvg(name, '#10B981', 20)
    expect(svg, name).not.toContain('fill-opacity="0.16"')
    expect(svg, name).not.toMatch(/<circle cx="12" cy="12" r="(9|11)"/) // the old disc and the old ringed glyphs
  }
  // the drawings' status marks are drawn straight on: no filled disc under a white tick
  for (const kind of ['commit', 'dream-ok', 'dream-bad', 'f-false', 'f-lesson', 'f-rejected', 'f-orphan', 'f-contradiction'] as const) {
    expect(lead(kind, 40), kind).not.toContain('stroke="#fff"')
  }
})

test('look: Contour is the default; a saved Orbit still shows Prism; Contour moves (a wave and a drift), off is still', () => {
  expect(LOOK_DEFAULT.backdrop).toBe('contour')
  expect(cleanLook({}).backdrop).toBe('contour')
  expect(cleanLook({ backdrop: 'orbit' }).backdrop).toBe('prism')
  expect(cleanLook({ backdrop: 'mesh' }).backdrop).toBe('mesh')
  const med = backdropSvg('contour', 'medium')!, off = backdropSvg('contour', 'off')!
  expect(med).toContain('animateTransform')
  expect((med.match(/attributeName="stroke-opacity"/g) ?? []).length, 'every ring and its glow flares as the wave passes').toBeGreaterThanOrEqual(32)
  expect(off).not.toContain('<animate')
  expect(med.length).toBeLessThan(131_072)
})

test('dream: when your own key failed and Claude judged instead, the Memory check says which and why', LONG, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const d = { ...dream(0, 0, 'applied'), model: 'claude · sonnet', fallback: { from: 'api · nvidia/nemotron', why: 'no answer within 240 s' } }
  engine(on, { status: () => ({ ...healthy(), dream: { running: null, recent: [d] } }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
  const t = await texts(ui)
  expect(t.some(x => /^Your own key's model \(nvidia\/nemotron\) failed: no answer within 240 s\. Sonnet on your plan judged instead\.$/.test(x))).toBe(true)
  expect(problems(await ui.drawn())).toEqual([])
  await ui.unmount()
})

const OC_CASES: [string, any, RegExp, boolean][] = [
  ['not installed', { installed: false, plugin: false }, /^Install OpenCode \(opencode\.ai\)/, false],
  ['installed, project not set up', { installed: true, plugin: false, version: '2.2.5', major: 2, command: false }, /^OpenCode 2\.2\.5 is installed, but this project isn't set up for it yet\.$/, true],
  ['ready', { installed: true, plugin: true, version: '2.2.5', major: 2, command: true }, /^Ready: OpenCode 2\.2\.5 reads this handoff and hands the work back when it stops\.$/, false],
  ['OpenCode 1.x', { installed: true, plugin: false, version: '1.14.0', major: 1, command: true }, /^Before you stop there, type \/cortex-handoff/, false],
  ['an older core (no command field)', { installed: true, plugin: true }, /^Ready: OpenCode reads this handoff/, false],
]
for (const [name, oc, said, setup] of OC_CASES) {
  test(`handoff: Carry on in OpenCode, ${name}: says what works here and offers the one fix`, LONG, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on)
    engine(on, { status: () => ({ ...healthy(), opencode: oc }) })
    await start($)
    const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
    await ui.press({ key: 'tab-handoff' })
    const t = await texts(ui)
    expect(t.some(x => said.test(x)), t.filter(x => /OpenCode/.test(x)).join(' | ')).toBe(true)
    expect(!!(await ui.find({ key: 'oc-setup' })), 'the set-up button').toBe(setup)
    expect(await ui.find({ key: 'oc-copy' })).toBeDefined()
    expect(problems(await ui.drawn())).toEqual([])
    await ui.unmount()
  })
}

