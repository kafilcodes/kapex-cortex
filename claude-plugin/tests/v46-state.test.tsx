import { expect, mock, test } from 'claude-code/testing'
import { BAND, engine, healthy, pane, quiet, USAGE } from './qa-fixtures'
import { liveNote, noteTone } from '../hooks/note'
import { stepRing } from '../hooks/contract-card'

// v4.6 live-testing fixes (Kafil, 2026-11-28): state that must move on by itself.
const LONG = { timeout: 30_000 }
const words = async (ui: any) => JSON.stringify(await ui.drawn())
const settle = async (clock: any) => { await clock.settle?.(); await clock.advance(200) }

test('strip: right after a handoff it says where to paste (Copy again), never "Hand off" again; a reply here brings the suggestion back', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls: string[] = []
  const s = quiet()
  s.handoff = { ...s.handoff, preview: { ...s.handoff.preview, flagged: 0 } }
  const o: any = { status: () => s, usage: USAGE.full, calls, turns: 7 }
  engine(on, o)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 } } as any)
  await settle(clock)
  const band: any = await $.ui.mount({ ...BAND, surface: 'desktop', props: { bodyColumns: 140 } } as any)
  expect(await words(band)).toContain('Hand off')
  await band.press({ key: 'kc-do' })
  await settle(clock)
  expect(calls.some(c => /\bhandoff\b/.test(c))).toBe(true)
  await clock.advance(8_000) // the "Handoff saved" chip has gone
  const after = await words(band)
  expect(after).toContain('Handoff saved')
  expect(after).toContain('Copy again')
  expect(after).not.toMatch(/"Hand off"/)
  // you kept working in this chat: a reply here, and the suggestion is back
  o.turns = 8
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 1 } } as any)
  await settle(clock); await clock.advance(3_000)
  expect(await words(band)).toContain('Hand off')
  await band.unmount()
})

test('header chip: says what changed ("Suggest a fresh chat at: 70% full"), then clears itself; a failure says so and stays longer', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  engine(on, { status: () => quiet() })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  if (await ui.find({ key: 'intro-next' })) { await ui.press({ key: 'intro-skip' }).catch(() => undefined) }
  await ui.press({ key: 'tab-settings' })
  await ui.press({ key: 'opt-handoffAt-70' })
  await settle(clock)
  expect(await words(ui)).toContain('Suggest a fresh chat at: 70% full')
  expect(await words(ui)).not.toMatch(/"Saved"/)
  await clock.advance(6_000)
  expect(await words(ui)).not.toContain('Suggest a fresh chat at: 70% full')
  await ui.unmount()
})

test('header chip words: a result shows for its seconds, working words up to 90 s, a stale one never (a reload killed its timer)', () => {
  const t0 = 1_000_000
  expect(noteTone('Saving…')).toBe('working')
  expect(noteTone('Didn\'t work: no answer')).toBe('failed')
  expect(noteTone('Couldn\'t save the handoff: x')).toBe('failed')
  expect(noteTone('Dark mode: AMOLED black')).toBe('done')
  // noteAt holds when the words end (say() sets it: 5 s done, 15 s failed, 90 s working, or the time asked)
  expect(liveNote('Dark mode: AMOLED black', t0 + 5_000, t0 + 3_000)).toBe('Dark mode: AMOLED black')
  expect(liveNote('Dark mode: AMOLED black', t0 + 5_000, t0 + 60_000)).toBe('')
  expect(liveNote('Turned off unused: figma (new chats). Undo in Costs', t0 + 12_000, t0 + 9_000), 'a longer hold asked for is kept').not.toBe('')
  expect(liveNote('Saving…', t0 + 90_000, t0 + 60_000)).toBe('Saving…')
  expect(liveNote('Saving…', t0 + 90_000, t0 + 120_000)).toBe('')
})

test('mission card: open steps first with Done; finished ones folded with their proof; a press ticks it by you', LONG, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls: string[] = []
  const s = quiet()
  s.handoff = { ...s.handoff, preview: { ...s.handoff.preview, contract: { rules: [{ kind: 'never', text: 'Never push without asking.' }], ruleCount: 1, superseded: [], rejected: [], conflicts: 0, goal: 'Ship v2', mission: 'm_1', closed: false,
    steps: [{ n: 1, text: 'Fix the login bug', state: 'done', by: 'claude', proof: { level: 'verified', text: 'npm test passed 2 min ago' } }, { n: 2, text: 'Write the release notes', state: 'open' }, { n: 3, text: 'Old idea', state: 'dropped', by: 'you' }] } } }
  engine(on, { status: () => s, calls })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  if (await ui.find({ key: 'intro-next' })) { await ui.press({ key: 'intro-skip' }).catch(() => undefined) }
  await ui.press({ key: 'tab-handoff' })
  const w = await words(ui)
  expect(w).toContain('Ship v2')
  expect(w).toContain('2. Write the release notes')
  expect(w).not.toContain('Old idea') // dropped: counted, not listed
  expect(w).not.toContain('1. Fix the login bug') // finished: folded until Show
  expect(w).toMatch(/1 done · 1 dropped · .*Show/)
  await ui.press({ key: 'mc-done' })
  const opened = await words(ui)
  expect(opened).toContain('1. Fix the login bug')
  expect(opened).toContain('Verified: npm test passed 2 min ago')
  await ui.press({ key: 'mc-b2' })
  await settle(clock)
  expect(calls.some(c => /mission done 2 --by you --mission m_1/.test(c)), 'the press names its mission').toBe(true)
  expect(await ui.find({ key: 'mc-close-b' })).toBeUndefined() // not every step is done
  await ui.unmount()
})

test('mission ring: one track, one arc with round caps, the number centred; full when every step is done', () => {
  const r = stepRing(3, 8)
  expect((r.match(/<circle /g) ?? []).length).toBe(2)
  expect(r).toContain('stroke-linecap="round"')
  expect(r).toMatch(/>3<\/text>/)
  expect(r).toMatch(/>of 8<\/text>/)
  expect(stepRing(0, 4).match(/<circle /g)?.length, 'nothing done: the track alone').toBe(1)
})
