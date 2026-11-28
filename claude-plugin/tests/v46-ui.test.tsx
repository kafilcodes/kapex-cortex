// v4.6 Stageshow page ports: the promises each redesigned page keeps, tested as pure functions.
import { expect, mock, test } from 'claude-code/testing'
import { engine, healthy, pane, quiet } from './qa-fixtures'
import { noticeOutcome } from '../hooks/notify'
import { heldBy, suggestFor } from '../hooks/dream-tab'
import { ink } from '../hooks/tiles'
import { K } from '../hooks/theme'
import { lookColors } from '../hooks/look-colors'
import { triggerOf } from '../hooks/timeline'
import { ownCost } from '../hooks/intro'
import { testSays } from '../hooks/settings'

const finding = (o: any) => ({ id: 'F1', kind: 'stale', severity: 'medium', by: 'check', file: '/m/testing.md', label: 'memory/testing.md', line: 9, evidence: [], action: { op: 'none' }, entry: '- Never mock the database', why: 'x', ...o })
const check = (fs: any[]) => ({ id: 'D', ts: '2026-11-27T10:00:00Z', status: 'proposed', findings: fs, evidence: [], files: [{ path: '/m/testing.md', label: 'memory/testing.md', hash: 'h' }], kept: 0 }) as any

test('memory check: a load-bearing note is never offered for removal, in either wording the guard uses', () => {
  for (const why of ["Load-bearing (a rule), so Cortex won't offer to remove it. `tests/db/` moved.", "Load-bearing (your task's own rule), so Cortex won't offer to remove or rewrite it.", 'A rule, not a fact: the code may have drifted from it. It names a folder that moved.']) {
    const f = finding({ kind: 'false', why })
    expect(heldBy(f)).toBeTruthy()
    const s = suggestFor(check([f]), f)
    expect(s.pick).toBe('ask') // never 'remove', even for a "Not true" note
    expect(s.text).toMatch(/never removes a load-bearing note/)
  }
  expect(heldBy(finding({ why: '`ab.mjs` no longer exists in the project.' }))).toBeNull()
  expect(suggestFor(check([finding({ kind: 'false', why: 'gone' })]), finding({ kind: 'false', why: 'gone' })).pick).toBe('remove') // an ordinary wrong note still can go
})

test('badges: status words use the theme keys (readable on Mist), the tint keeps the hex', () => {
  expect(ink(K.amber)).toBe('warning')
  expect(ink(K.rose)).toBe('error')
  expect(ink(K.emerald)).toBe('success')
  expect(ink(K.silver)).toBe(K.label)
  expect(ink('#14B8A6')).toBe('#14B8A6')
})

const lum = (h: string) => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05) }
test('Kapex look: the success / warning / error words a badge uses are AA on Obsidian and Mist (the derived text colours, not the role hexes)', () => {
  const t = (lookColors('obsidian').theme as any).inputs
  for (const [r, step] of [['danger', 300], ['warning', 300], ['success', 400]] as const) {
    expect(ratio(t.dark[`role-${r}-${step}`], '#151E1A')).toBeGreaterThanOrEqual(4.5) // on a dark card (surface-3, the lightest step)
    expect(ratio(t.light[`role-${r}-600`], '#EDF2EF')).toBeGreaterThanOrEqual(4.5) // on Mist's darkest ground
  }
  expect(t.dark['role-danger-300']).toBe('#f37689') // Obsidian's error words: a light rose, already crisp on dark cards
})

test('timeline: a reply nobody typed leads with what Claude did; what set it off is a quiet badge', () => {
  expect(triggerOf('Claude continued on its own')).toBe('On its own')
  expect(triggerOf('A background task finished')).toBe('Background task')
  expect(triggerOf('Carried on where it stopped')).toBe('Picked up again')
  expect(triggerOf('Fix the login redirect')).toBeNull() // what you typed stays the title
})

test('costs: the plan heat colours read as theme keys when they are words (AA on Mist)', () => {
  expect(ink('#EAB308')).toBe('warning') // HEAT.warn
  expect(ink('#F97316')).toBe('warning') // HEAT.high
  expect(ink('#10B981')).toBe('success') // HEAT.ok = emerald
  expect(ink('#F43F5E')).toBe('error') // HEAT.bad = rose
})

test('settings and sub-tabs: a chosen option says so by its tint and weight; its words stay the text colour (AA on both)', { timeoutMs: 120_000 }, async ($, on) => {
  engine(on, { status: () => healthy() })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...pane(140), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-settings' })
  const texts = (await ui.findAll({ type: 'Text' })) as any[]
  const chosen = texts.filter(x => x.props?.weight === 'semibold' && x.props?.size === 'caption' && /^(On|Off|Balanced|Sonnet|Medium|Contour|Obsidian|Claude)$/.test(String(x.props?.children ?? x.text ?? '')))
  expect(chosen.length).toBeGreaterThan(0)
  for (const x of chosen) expect(x.props.color).toBe('text')
  await ui.press({ key: 'tab-data' })
  const sub = ((await ui.findAll({ type: 'Text' })) as any[]).find(x => /^Memory check$/.test(String(x.props?.children ?? x.text ?? '')) && x.props?.weight === 'semibold')
  expect(sub).toBeDefined() // the Memory tab opens on its Memory check sub-tab
  expect(sub.props.color).toBe('text')
  await ui.unmount()
})

test('intro: Cortex\'s own cost per message is the figure the Overview and Costs pages show (measured, never rounded apart)', () => {
  expect(ownCost(85)).toBe('about 85 tokens a message')
  expect(ownCost(366)).toBe('about 366 tokens a message') // a skill copy the model can see adds to it
  expect(ownCost(undefined)).toBe('about 85 tokens a message') // an older core sends no figure: the measured listing
})

test('settings: Test the model says what it proves for the judge you chose (no key or address on your plan)', () => {
  expect(testSays('claude', 'Sonnet')).toBe('One small question to Sonnet on your plan: proves Claude Code can run it and answers the way a full check needs.')
  expect(testSays('claude', 'Sonnet')).not.toMatch(/key|address/)
  expect(testSays('api', 'Sonnet')).toMatch(/proves the key, the address and the model/)
  expect(ink(K.sage)).toBe('success') // "985 tokens of rules…" on What Cortex saved you
})

test('notify: kc notify\'s answer decides what the panel adds (a sent banner carries its own sound)', () => {
  expect(noticeOutcome(true, 'notified\n')).toBe('sent')
  expect(noticeOutcome(true, 'skipped (said in the last 10 minutes, or a burst)')).toBe('held')
  expect(noticeOutcome(false, 'not sent (not macOS)')).toBe('fallback')
  expect(noticeOutcome(true, '{"project":"demo"}')).toBe('fallback') // an older core that answers with something else
})

/** Hand off from the Handoff page with `kc notify` answering `answer`; returns its args, the toasts and the in-app sounds. */
async function notice($: any, on: any, sound: boolean, answer: string) {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const calls: string[] = [], toasts: string[] = [], sounds: string[] = []
  const st = () => { const s = quiet(); s.prefs = { ...s.prefs, sound }; return s }
  engine(on, { status: st, calls, toasts, sounds, run: (args: string) => ({ value: { exitCode: 0, stdout: args.startsWith('notify') ? answer : JSON.stringify(st()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-handoff' }); await ui.press({ key: 'kc-hand3' })
  await ui.unmount()
  return { notify: calls.filter(c => c.startsWith('notify')), toasts, sounds }
}
test('notify: Sounds on, a macOS banner went out: it carries the done sound; no toast and no second chime', { timeoutMs: 120_000 }, async ($, on) => {
  const r = await notice($, on, true, 'notified')
  expect(r.notify.length).toBe(1)
  expect(r.notify[0]).toMatch(/^notify --sound done Kapex Cortex Handoff saved/)
  expect(r.toasts).toEqual([]); expect(r.sounds).toEqual([])
})
test('notify: Sounds off: the banner goes out silent', { timeoutMs: 120_000 }, async ($, on) => {
  const r = await notice($, on, false, 'notified')
  expect(r.notify[0]).toMatch(/^notify Kapex Cortex Handoff saved/)
  expect(r.sounds).toEqual([])
})
test('notify: a repeat the core held back adds nothing (no toast, no chime): the strip chip already says it', { timeoutMs: 120_000 }, async ($, on) => {
  const r = await notice($, on, true, 'skipped (said in the last 10 minutes, or a burst)')
  expect(r.toasts).toEqual([]); expect(r.sounds).toEqual([])
})
test('notify: no macOS banner (not a Mac, a throwaway run): the app\'s toast and Cortex\'s own chime instead', { timeoutMs: 120_000 }, async ($, on) => {
  const r = await notice($, on, true, 'not sent (not macOS)')
  expect(r.toasts.length).toBe(1); expect(r.sounds).toEqual(['sounds/done.wav'])
})
