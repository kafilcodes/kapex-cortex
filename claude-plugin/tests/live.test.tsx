import { expect, mock, test } from 'claude-code/testing'

import { signal } from '../hooks/pulse'
import { tipFor } from '../hooks/tips'

// v3.8.2: the strip stays true between turns (a heartbeat, no turn needed), the Timeline is an accordion whose
// Activity chart never reloads on a click, and handoff tiles name the chat they came from.

const PANE = { plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as const
const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const ep = (i: number, session = 's1', msAgo = 2 * HOUR) => ({ id: `E${i}`, session, start: iso(msAgo + 60_000), end: iso(msAgo), ask: `Request number ${i}`, tools: { Edit: 1 }, files: ['/demo/src/a.ts'], commands: ['npm test'], tests: { ran: 1, failed: 0 }, commits: 1, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 1200, contextTokens: 9000, done: `did thing ${i}`, next: '' })
const STATUS = {
  project: 'demo', root: '/demo',
  handoff: { exists: true, ageMinutes: 780, ready: false, from: 'claude-code', session: 'old-chat', chat: 'Cortex resume design and UI refinements', preview: { exchanges: 3, files: 2, openItems: 1, tokens: 1800, lastCheck: 'npm run check passed' } },
  native: { files: [], alwaysTokens: 875, alwaysLines: 70, autoMemory: { dir: '/mem', enabled: true } },
  dream: { running: null, recent: [] },
  hooks: { p95: 50, samples: 40, cap: 150 }, opencode: { installed: false, plugin: false },
  history: { states: [], wips: [] },
  prefs: { tokenMode: 'balanced', greeting: false, name: '', dreamBackend: 'claude', dreamModel: 'sonnet', dreamApi: 'anthropic', dreamUrl: '', dreamTranscripts: 10, autoDream: false, introDone: true, overridden: [], tokens: { handoff: 1800 } },
  episodes: [ep(1), ep(2), ep(3)],
  timeline: [
    { id: 'turn-E1', ts: iso(2 * HOUR), kind: 'turn', title: 'Request number 1', detail: 'did thing 1', tags: ['1 file'], tone: 'ok' },
    { id: 'turn-E2', ts: iso(3 * HOUR), kind: 'turn', title: 'Request number 2', detail: 'did thing 2', tags: ['1 file'], tone: 'ok' },
    { id: 'hand-old-chat-1', ts: iso(4 * HOUR), kind: 'handoff', title: 'Handoff from “Cortex resume design and UI refinements”', detail: 'Ship v3.8.2', tags: ['claude-code', 'chat old-chat'], tone: 'info' },
  ],
  stateAt: iso(HOUR), health: 'good',
}

function engine(on: any, o: { status?: object; turns?: number; session?: string; calls?: string[]; usage?: { n: number }; mtime?: { v: number } } = {}) {
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: o.turns ?? 7 }))
  on('session.id', () => ({ value: o.session ?? 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: o.mtime?.v ?? 1, isLink: false } }))
  on('process.run', (_: unknown, e: any) => { o.calls?.push((e?.argv ?? []).slice(2).join(' ')); return { value: { exitCode: 0, stdout: JSON.stringify(o.status ?? STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.usage', () => {
    if (o.usage) o.usage.n++
    return { value: { startedAt: 0, version: 'x', context: { tokens: 120_000, window: 1_000_000, percent: 12, breakdown: { categories: [], maxTokens: 1_000_000 } }, rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: new Date(Date.now() + HOUR).toISOString() }] } }
  })
}

test('timeline: one tile open at a time; the Activity chart is the same drawing before and after a click', async ($, on) => {
  mock.clock(on, { now: Date.now() })
  engine(on)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-timeline' })
  const chart = async () => String(((await ui.findAll({ type: 'Svg' })) as any[]).find(x => /events:/.test(String(x.props?.alt)))?.props.source)
  const before = await chart()
  expect(before).toMatch(/^<svg/)
  await ui.press({ key: 'tx-turn-E1' })
  expect(await ui.find({ type: 'Text', text: 'Collapse' })).toBeDefined()
  expect(await chart()).toBe(before) // no new frame: nothing blinks
  await ui.press({ key: 'tx-turn-E2' }) // opening another closes the first
  expect(((await ui.findAll({ type: 'Text', text: 'Collapse' })) as any[]).length).toBe(1)
  expect(await ui.find({ type: 'Text', text: /^Files: src\/a\.ts$/ })).toBeDefined()
  await ui.press({ key: 'tx-turn-E2' }) // and pressing the open one closes it
  expect(await ui.find({ type: 'Text', text: 'Collapse' })).toBeUndefined()
  expect(await chart()).toBe(before)
  // the handoff tile names the chat it came from
  expect(await ui.find({ type: 'Text', text: 'Handoff from “Cortex resume design and UI refinements”' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'chat old-chat' })).toBeDefined()
  await ui.unmount()
})

test('heartbeat: live numbers every 4 s while a turn runs (no Node); idle, a full read only when another chat wrote here', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const calls: string[] = [], usage = { n: 0 }, mtime = { v: 1 }
  engine(on, { calls, usage, mtime })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await clock.advance(2_000) // first beat: learns the files' times, reads nothing new
  const node = () => calls.filter(c => c.startsWith('status')).length
  const n0 = node()
  await $.turn.start({ turnId: 't1' } as any)
  const u0 = usage.n
  await clock.advance(12_500)
  expect(usage.n - u0).toBeGreaterThanOrEqual(3) // ~every 4 s
  expect(node()).toBe(n0) // and no Node process during the turn
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 100 } } as any)
  await clock.advance(3_000)
  const n1 = node()
  await clock.advance(60_000) // idle, nothing written: no Node
  expect(node()).toBe(n1)
  mtime.v = 2 // another chat (or OpenCode) saved a handoff here
  await clock.advance(31_000)
  expect(node()).toBe(n1 + 1)
  await clock.advance(31_000)
  expect(node()).toBe(n1 + 1) // once, not on every beat
})

test('heartbeat signal changes only when the strip\'s answer would: warm → cooling → cold, a plan reset, a new day', () => {
  const t0 = Date.parse('2026-11-13T10:00:00Z')
  const at = (min: number) => signal({ lastAt: t0, ttlMs: HOUR, resets: [new Date(t0 + 2 * HOUR).toISOString()] }, t0 + min * 60_000)
  expect(at(1)).toBe(at(40)) // still warm: no redraw
  expect(at(52)).not.toBe(at(40)) // cooling
  expect(at(61)).not.toBe(at(52)) // cold
  expect(at(61)).toBe(at(100))
  expect(at(121)).not.toBe(at(100)) // the plan window reset
})

test('a fresh chat suggests continuing from the last chat by name, ahead of tool-saving tips; an idle big chat says the cache went cold', () => {
  const warm = { lastAt: Date.now(), read: 0, write: 0, input: 0, ttl: '1h', ttlSource: 'x' } as const
  const live = (tokens: number, turns: number, sessionId = 'new-chat') => ({ model: 'm', turns, sessionId, context: { tokens, window: 1_000_000, percent: Math.round(tokens / 10_000), rows: [] }, limits: [], loadout: [{ kind: 'mcp', name: 'figma', tokens: 9000, loaded: 9000, items: 4, server: 'figma' }] })
  const s = { ...(STATUS as any), usage: { chats: 20, skills: {}, mcp: {}, tools: {} } }
  const fresh = tipFor(s, live(20_000, 0) as any, warm, [])
  expect([fresh?.level, fresh?.action, fresh?.text]).toEqual(['ok', 'resume', 'Continue: /cortex-resume · 13 h ago'])
  expect(fresh?.detail).toMatch(/^A handoff from “Cortex resume design and UI refinements” is saved\./)
  expect(tipFor(s, live(20_000, 3) as any, warm, [])?.action).toBe('costs') // not fresh: the tool tip again
  const cold = { ...warm, lastAt: Date.now() - 13 * HOUR }
  const c = tipFor(s, live(120_000, 9, 'old-chat') as any, cold, [])
  expect([c?.level, c?.text]).toEqual(['warn', 'Cache cold · next reply re-reads 120k'])
  expect(tipFor(s, live(480_000, 9, 'old-chat') as any, cold, [])?.level).toBe('act') // big: hand off
})

test('after an app restart the chat\'s last reply time comes from the journal, so the strip knows the cache went cold', async ($, on) => {
  mock.clock(on, { now: Date.now() })
  engine(on, { status: { ...STATUS, episodes: [ep(9, 's1', 13 * HOUR)] }, turns: 9, session: 's1' })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const band: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: {} } as any)
  const main = ((await band.findAll({ type: 'Svg' })) as any[]).find(x => /cache/.test(String(x.props?.alt)))
  expect(String(main.props.alt)).toMatch(/cache cold/)
  expect(((await band.findAll({ type: 'Svg' })) as any[]).some(x => /^Cache cold · next reply re-reads 120k/.test(String(x.props?.alt)))).toBe(true)
  await band.unmount()
})
