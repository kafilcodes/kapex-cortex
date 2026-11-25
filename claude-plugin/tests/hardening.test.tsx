import { expect, mock, test } from 'claude-code/testing'

// v4.5 core hardening: the strip's per-chat numbers belong to one session id, a /clear or resume (session.end with
// no session.start after it) starts them over at once and keeps the heartbeat alive, and 500 heartbeat and redraw
// cycles leave no extra timers or growing work behind.

const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
const STATUS = {
  project: 'demo', root: '/demo',
  handoff: { exists: true, ageMinutes: 20, ready: false, from: 'claude-code', session: 'chat-a', chat: 'Build the export page', preview: { exchanges: 3, files: 2, openItems: 1, tokens: 1800, lastCheck: 'npm test passed' } },
  native: { files: [], alwaysTokens: 875, alwaysLines: 70, autoMemory: { dir: '/mem', enabled: true } },
  dream: { running: null, recent: [] },
  hooks: { p95: 50, samples: 40, cap: 150 }, opencode: { installed: false, plugin: false },
  history: { states: [], wips: [] },
  prefs: { tokenMode: 'balanced', greeting: false, name: '', dreamBackend: 'claude', dreamModel: 'sonnet', dreamApi: 'anthropic', dreamUrl: '', dreamTranscripts: 10, autoDream: false, introDone: true, overridden: [], tokens: { handoff: 1800 } },
  // the last chat's big last turn: a fresh chat must not be told "the last turn added ~60k"
  episodes: [
    { id: 'E2', session: 'chat-a', start: iso(120_000), end: iso(60_000), ask: 'Read everything', tools: { Read: 20 }, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 100, contextTokens: 160_000, done: 'read it all', next: '' },
    { id: 'E1', session: 'chat-a', start: iso(300_000), end: iso(240_000), ask: 'Start', tools: { Edit: 1 }, files: [], commands: [], tests: { ran: 0, failed: 0 }, commits: 0, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 100, contextTokens: 100_000, done: 'started', next: '' },
  ],
  timeline: [], stateAt: iso(HOUR), health: 'good',
}

type World = { session: string; pct: number; turns: number; usageCalls: number; kcCalls: number }
function engine(on: any, w: World) {
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: unknown, e: any) => ({ sessionId: e.sessionId }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: w.turns }))
  on('session.id', () => ({ value: w.session }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', () => { w.kcCalls++; return { value: { exitCode: 0, stdout: JSON.stringify(STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.usage', () => {
    w.usageCalls++
    return { value: { startedAt: 0, version: 'x', context: { tokens: w.pct * 10_000, window: 1_000_000, percent: w.pct, breakdown: { categories: [], maxTokens: 1_000_000 } }, rateLimits: [{ kind: 'five_hour', percentUsed: 40, resetsAt: new Date(Date.now() + HOUR).toISOString() }] } }
  })
}
const BAND = { plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 140 } } as const
/** The strip's words: the main pill's alt text says context, cache and plan in words. */
async function strip(band: any): Promise<string> {
  const svgs = (await band.findAll({ type: 'Svg' })) as any[]
  return svgs.map(x => String(x.props?.alt ?? '')).join(' | ')
}
const USAGE = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 }

test('a /clear starts the strip over at once: the new chat shows its own context and a cold cache, not the last chat\'s', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w: World = { session: 'chat-a', pct: 61, turns: 12, usageCalls: 0, kcCalls: 0 }
  engine(on, w)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.turn.start({ turnId: 't1' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: USAGE } as any)
  await clock.settle()
  const band: any = await $.ui.mount(BAND as any)
  expect(await strip(band)).toMatch(/chat 61% full/)
  expect(await strip(band)).toMatch(/cache warm till/)
  // /clear: the conversation ends, the process goes on under a new id, and no session.start fires
  w.session = 'chat-b'; w.pct = 3; w.turns = 0
  await $.session.end({ reason: 'clear', sessionId: 'chat-a', resume: { id: 'chat-a' } } as any)
  await clock.settle()
  const now = await strip(band)
  expect(now).toMatch(/chat 3% full/)
  expect(now).not.toMatch(/61%/)
  expect(now).toMatch(/cache starts on reply/)
  expect(now).not.toMatch(/last turn added/i)
  // a fresh chat with a recent handoff from another chat is offered the resume, before its first reply
  expect(now).toMatch(/Continue: \/cortex-resume/)
  // the heartbeat lives on after a /clear: while a turn runs, the ring keeps climbing without a reply
  await $.turn.start({ turnId: 't2' } as any)
  w.pct = 9
  await clock.advance(5_000)
  expect(await strip(band)).toMatch(/chat 9% full/)
  await band.unmount()
})

test('a /clear where the engine still names the ended chat at session.end: the strip resets anyway, and learns the new id on the next beat', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w: World = { session: 'chat-a', pct: 58, turns: 9, usageCalls: 0, kcCalls: 0 }
  engine(on, w)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: USAGE } as any)
  await clock.settle()
  const band: any = await $.ui.mount(BAND as any)
  expect(await strip(band)).toMatch(/chat 58% full/)
  w.pct = 4; w.turns = 0 // the new chat's numbers, while $.session.id() still answers 'chat-a'
  await $.session.end({ reason: 'clear', sessionId: 'chat-a', resume: { id: 'chat-a' } } as any)
  await clock.settle()
  expect(await strip(band)).toMatch(/chat 4% full/)
  expect(await strip(band)).toMatch(/cache starts on reply/)
  w.session = 'chat-b'
  await clock.advance(31_000) // an idle beat: the new id is noticed, nothing goes back to the old chat
  expect(await strip(band)).toMatch(/chat 4% full/)
  expect(await strip(band)).toMatch(/cache starts on reply/)
  await band.unmount()
})

test('a new chat that inherits the last one\'s saved state (same process, new id) shows its own numbers before its first reply', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w: World = { session: 'chat-a', pct: 74, turns: 30, usageCalls: 0, kcCalls: 0 }
  engine(on, w)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: USAGE } as any)
  await clock.settle()
  // the engine starts the plugin again for a chat with another id (a reload, a respawned worker)
  w.session = 'chat-c'; w.pct = 2; w.turns = 0
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const band: any = await $.ui.mount(BAND as any)
  const now = await strip(band)
  expect(now).toMatch(/chat 2% full/)
  expect(now).toMatch(/cache starts on reply/)
  await band.unmount()
})

test('a real exit stops the heartbeat for good: no beat, no engine call, after the session ends', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w: World = { session: 'chat-a', pct: 10, turns: 1, usageCalls: 0, kcCalls: 0 }
  engine(on, w)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await clock.advance(10_000)
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 'chat-a', resume: { id: 'chat-a' } } as any)
  await clock.settle()
  const u = w.usageCalls, k = w.kcCalls
  await clock.advance(2 * HOUR)
  expect([w.usageCalls - u, w.kcCalls - k]).toEqual([0, 0])
})

test('leak check: 500 heartbeat and redraw cycles keep one timer (calls grow linearly) and the kept state bounded', { timeoutMs: 120_000 }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  const w: World = { session: 'chat-a', pct: 10, turns: 5, usageCalls: 0, kcCalls: 0 }
  engine(on, w)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  const band: any = await $.ui.mount(BAND as any)
  await $.turn.start({ turnId: 't0' } as any)
  await clock.advance(4_000)
  const calls0 = w.usageCalls
  // memory, measured from outside (the sandbox has no heap meter): everything the open panel draws, in characters.
  // The sparkline and plan history are capped, so it is the same size after 100 beats and after 500
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const pane: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', surface: 'desktop', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as any)
  const drawn = async () => ((await pane.findAll({ type: 'Svg' })) as any[]).reduce((n, x) => n + String(x.props?.source ?? '').length, 0)
  let at100 = 0
  // a turn runs: one live read every 4 s. 500 beats with the context moving each time (a redraw each beat)
  for (let i = 0; i < 500; i++) { w.pct = 10 + (i % 50); await clock.advance(4_000); if (i === 99) at100 = await drawn() }
  const at500 = await drawn()
  expect(at100).toBeGreaterThan(0)
  expect(at500 / at100).toBeLessThan(1.1)
  const perBeat = (w.usageCalls - calls0) / 500
  // one timer: one usage read a beat (a leaked or stacked timer would make it 2, 3, …)
  expect(perBeat).toBeGreaterThan(0.9)
  expect(perBeat).toBeLessThan(1.1)
  expect(await strip(band)).toMatch(/chat \d+% full/)
  // the turn ends: back to idle beats every 30 s; 100 idle beats start no full refresh (nothing on disk changed)
  // beyond the one the turn's end asks for and the 15-minute fallback
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't0', usage: USAGE } as any)
  await clock.advance(5_000)
  const k0 = w.kcCalls
  await clock.advance(100 * 30_000)
  expect(w.kcCalls - k0).toBeLessThanOrEqual(5)
  // repeated /clears never stack heartbeats either
  for (let i = 0; i < 20; i++) { w.session = `chat-${i}`; await $.session.end({ reason: 'clear', sessionId: `chat-${i - 1}`, resume: { id: 'x' } } as any) }
  await $.turn.start({ turnId: 't9' } as any)
  await clock.advance(4_000)
  const c1 = w.usageCalls
  await clock.advance(40 * 4_000)
  expect((w.usageCalls - c1) / 40).toBeLessThan(1.1)
  await pane.unmount()
  await band.unmount()
})
