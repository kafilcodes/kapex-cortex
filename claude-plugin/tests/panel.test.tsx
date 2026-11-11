import { expect, test } from 'claude-code/testing'

import { freshLimits } from '../hooks/data'
import { moodOf } from '../hooks/hero'
import { cachedDrawings, moodSvg } from '../hooks/mascot'
import { tipFor } from '../hooks/tips'

const PANE = {
  plugin: 'kapex-cortex',
  component: 'Pane',
  requestId: 'kapex-cortex',
  props: { title: 'Kapex Cortex', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

const FINDINGS = [
  { id: 'C1', kind: 'false', severity: 'high', by: 'check', file: '/mem/MEMORY.md', label: 'memory/MEMORY.md', line: 2, end: 2, entry: '- `npm test` is broken, skip it.', why: 'It says `npm test` doesn\'t work, but it ran successfully once after this note was written.', evidence: ['E1'], action: { op: 'delete' } },
  { id: 'C2', kind: 'stale', severity: 'medium', by: 'check', file: '/demo/CLAUDE.md', label: 'CLAUDE.md', line: 4, end: 4, entry: '- Cards use #111315.', why: '#111315 isn\'t used anywhere in the project any more.', evidence: [], action: { op: 'none' } },
]
const DREAM = { id: '01JD0000000000000000000001', ts: '2026-11-10T10:00:00Z', status: 'proposed', ms: 900, model: 'claude · sonnet', transcripts: 10, evidenceCount: 63, entryCount: 40, findings: FINDINGS, evidence: [{ id: 'E1', kind: 'run', ts: '2026-11-10T09:55:00Z', session: 's1', text: '`npm test` succeeded', cmd: 'npm test', ok: true }], files: [{ path: '/mem/MEMORY.md', label: 'memory/MEMORY.md', hash: 'a' }, { path: '/demo/CLAUDE.md', label: 'CLAUDE.md', hash: 'b' }] }
const STATUS = {
  project: 'demo', root: '/demo',
  handoff: { exists: true, ageMinutes: 5, ready: false, from: 'claude-code', preview: { exchanges: 3, files: 2, openItems: 1, tokens: 1800, lastCheck: 'npm run check passed, 5 min ago' } },
  native: { files: [
    { path: '/demo/CLAUDE.md', label: 'CLAUDE.md', scope: 'project', loads: 'always', lines: 40, bytes: 2000, tokens: 500, editable: true },
    { path: '/demo/.claude/rules/api.md', label: 'rules/api.md', scope: 'rules', loads: 'on-demand', paths: ['src/api/**'], lines: 12, bytes: 600, tokens: 0, editable: true },
    { path: '/mem/MEMORY.md', label: 'memory/MEMORY.md', scope: 'auto', loads: 'first-200', lines: 30, bytes: 1500, tokens: 375, editable: true },
  ], alwaysTokens: 875, alwaysLines: 70, autoMemory: { dir: '/mem', enabled: true } },
  dream: { running: null, recent: [DREAM] },
  git: { branch: 'main', dirty: 2, untracked: 1, wip: { ref: 'refs/cortex/wip/s1', sha: 'abc1234', at: '2026-11-08T10:00:00Z' } },
  hooks: { p95: 92, samples: 40, cap: 150 },
  opencode: { installed: true, plugin: true },
  history: { states: [{ session: 's1', at: '2026-11-08T10:00:00Z', from: 'claude-code', goal: 'Ship the parser refactor' }], wips: [{ session: 's1', sha: 'abc1234', at: '2026-11-08T10:00:00Z' }] },
  usage: { chats: 20, skills: { 'cortex-resume': 2 }, mcp: { cortex: 5 }, tools: { Bash: 90 } },
  prefs: { tokenMode: 'balanced', greeting: true, name: '', dreamBackend: 'claude', dreamModel: 'sonnet', dreamApi: 'anthropic', dreamUrl: '', dreamTranscripts: 10, autoDream: false, overridden: [], tokens: { handoff: 1800 } },
  memHealth: { files: [{ label: 'CLAUDE.md', lines: 40, limit: 200 }, { label: 'memory/MEMORY.md', lines: 170, limit: 200 }], scopedTokens: 150, alwaysTokens: 875, open: 2, checks: 4, clean: 3 },
  stateAt: '2026-11-08T10:00:00Z',
  health: 'attention',
}

function engine(on: any, status: object = STATUS, extra: object = {}, calls?: string[], size = { tokens: 84_000, percent: 42 }) {
  on('settings.read', () => ({ value: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e?.name === 'HOME' ? '/home/test' : undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: any) => { calls?.push((e?.argv ?? []).slice(2).join(' ')); return { value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: 7 }))
  on('session.usage', () => ({
    value: {
      startedAt: 0, version: 'x',
      context: { tokens: size.tokens, window: 200_000, percent: size.percent, breakdown: { categories: [
        { name: 'System prompt', tokens: 20_000, isDeferred: false }, { name: 'Skills', tokens: 6_400, isDeferred: false }, { name: 'Messages', tokens: 64_000, isDeferred: false },
        { name: 'Free space', tokens: 83_000, isDeferred: false }, { name: 'Autocompact buffer', tokens: 33_000, isDeferred: false },
      ], maxTokens: 200_000, ...extra } },
      rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }, { kind: 'seven_day', percentUsed: 41 }],
    },
  }))
}

test('dashboard: four key cards from real data, cache clock, tabs and 0-token buttons', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kc' } as any)
  let ui: any = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const t of ['Opus 5.5', 'main', /^875 memory tokens$/, 'OpenCode ready']) expect(await ui.find({ type: 'Text', text: t })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 to review' })).toBeDefined() // the Dream's change and the note that's yours to decide
  expect(await ui.find({ type: 'Text', text: /^A new chat with \/cortex-resume gets, in three parts:$/ })).toBeDefined()
  expect(await ui.find({ key: 'sw-yes' })).toBeUndefined() // 42% full: no hand-off question
  expect(await ui.find({ type: 'Text', text: /^last exchanges, word for word$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^≈1\.8k tokens to start$/ })).toBeDefined()
  expect(await ui.find({ key: 'kc-refresh' })).toBeDefined()
  // one chart form per kind of data: a gauge, bento tiles, capsules (found by what they say to a screen reader)
  const alts = ((await ui.findAll({ type: 'Svg' })) as any[]).map(x => String(x.props?.alt ?? ''))
  for (const alt of [/^Context 42% full$/, /^System prompt 20k/]) expect(alts.some(a => alt.test(a))).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Memory Claude loads$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Cortex adds to each message$/ })).toBeDefined()
  // anti-slop: words, not glyph icons, in labels and buttons
  expect(await ui.find({ text: /[≡⇪◷◔⚙⇅◫↻◆⎇✓]/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /compacts at 84%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /warms up with your next reply/ })).toBeDefined()
  await ui.unmount()

  // a reply finishes: the cache clock starts, with the real cache share of that reply
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  for (const surface of ['desktop', 'terminal'] as const) {
    ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /warm until/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /97% of the last reply cached/ })).toBeDefined()
    await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
    expect(await ui.find({ type: 'Text', text: /^Not true$/ })).toBeDefined()
    expect(await ui.find({ key: 'kc-dream-apply' })).toBeDefined()
    expect((await ui.find({ key: 'kc-dream-apply' }))?.text).toBe('Apply all 1')
    expect(await ui.find({ key: 'fr-C2' })).toBeDefined() // yours to decide: Remove line, Ask Claude, Keep
    expect(await ui.find({ key: 'fc-C2' })).toBeDefined()
    expect(await ui.find({ key: 'fk-C2' })).toBeDefined()
    await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-files' })
    expect(await ui.find({ type: 'Text', text: /^only for src\/api\/\*\*$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^every session \(first 200 lines\)$/ })).toBeDefined()
    await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-handoff' })
    expect(await ui.find({ type: 'Text', text: /^abc1234$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^changed files$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ship the parser refactor/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^snapshot abc1234$/ })).toBeDefined()
    await ui.press({ key: 'tab-settings' })
    expect(await ui.find({ type: 'Text', text: /The current handoff is about 1,800 tokens/ })).toBeDefined()
    expect(await ui.find({ key: 'sel-dreamBackend' })).toBeDefined()
    expect(await ui.find({ key: 'sel-dreamModel' })).toBeDefined()
    expect(await ui.find({ key: 'sel-tokenMode' })).toBeDefined()
    await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-details' })
    expect(await ui.find({ type: 'Text', text: /92 ms of 150 ms · 40 runs/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Loaded into every message$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /minimize it/ })).toBeDefined()
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('a chat one folder up shows the only Cortex project inside it; the model can open the panel; the band has a 0-token button', async ($, on) => {
  const cwds: (string | undefined)[] = []
  const argv0: string[] = []
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('process.run', (_: unknown, e: any) => {
    cwds.push(e.init?.cwd)
    argv0.push(`${e.argv?.[0]} ${String(e.argv?.[1]).split('/').slice(-3).join('/')}`)
    return e.init?.cwd === '/work/demo'
      ? { value: { exitCode: 0, stdout: JSON.stringify(STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 1, stdout: JSON.stringify({ off: true, cwd: '/work', nearby: ['demo'] }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/work', surface: 'desktop', isInteractive: true })
  const r: any = await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  expect(String(r.result)).toMatch(/Opened the Kapex Cortex panel/)
  expect(cwds).toContain('/work/demo')
  expect(argv0[0]).toBe('node cortex/src/cli.ts')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^chat in work$/ })).toBeDefined()
  await ui.unmount()
  const band = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: {} } as any)
  expect(await band.find({ key: 'kc-open' })).toBeDefined()
  await band.unmount()
})

test('every pane width draws (narrow → 4 columns, terminal too)', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kc' } as any)
  for (const bodyColumns of [40, 70, 100, 120, 145, 170, 200, 260, 400]) {
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } } as any)
      expect(await ui.find({ type: 'Text', text: /Context/ })).toBeDefined()
      await ui.unmount()
    }
  }
})

test('picking a setting saves it with kc prefs set', async ($, on) => {
  const calls: string[] = []
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', (_: unknown, e: any) => {
    calls.push((e.argv as string[]).slice(2).join(' '))
    return { value: { exitCode: 0, stdout: JSON.stringify(STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kc' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-settings' })
  await ui.select({ key: 'sel-tokenMode', value: 'lean' })
  expect(calls).toContain('prefs set tokenMode lean')
  await ui.unmount()
})

test('without Node it says so plainly, with a download link', async ($, on) => {
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('process.run', () => { throw new Error('spawn node ENOENT') })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kc' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Node\.js 23\.6 or newer is needed/ })).toBeDefined()
  expect(await ui.find({ type: 'Link' })).toBeDefined()
  await ui.unmount()
})

test('before anything has loaded it shows a quiet loading view, never a blank pane', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Loading your project…' })).toBeDefined()
  await ui.unmount()
})

test('details: each MCP server and plugin skill set with its cost; ones unused in recent chats are flagged', async ($, on) => {
  const calls: string[] = []
  const T = { input: 10, output: 5_000, cacheRead: 900_000, cacheWrite: 20_000, replies: 40 }
  engine(on, { ...STATUS, parked: { servers: [], keepOn: ['figma'], disabled: [] }, spend: { today: T, week: T, all: T, since: '2026-11-08', chats: 3, resumed: 1, resumedContext: 600_000 } }, {
    mcpTools: [
      { name: 'mcp__figma__get_file', serverName: 'figma', tokens: 2_500, isLoaded: true },
      { name: 'mcp__figma__get_node', serverName: 'figma', tokens: 1_700, isLoaded: true },
      { name: 'mcp__cortex__pin', serverName: 'cortex', tokens: 900, isLoaded: true },
      { name: 'mcp__linear__create', serverName: 'linear', tokens: 3_000, isLoaded: false },
    ],
    skills: { totalSkills: 3, includedSkills: 3, tokens: 1_400, skillFrontmatter: [
      { name: 'vercel:deploy', source: 'plugin', pluginName: 'vercel', tokens: 600 },
      { name: 'vercel:env', source: 'plugin', pluginName: 'vercel', tokens: 500 },
      { name: 'cortex-resume', source: 'plugin', pluginName: 'kapex-cortex', tokens: 300 },
    ] },
  }, calls)
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-details' })
  expect(await ui.find({ type: 'Text', text: /^MCP · figma$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^unused( lately)?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^(used )?×5$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^MCP · cortex$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 unused · about 5\.3k tokens of context in every message$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Skills · kapex-cortex$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /linear/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^Tokens this project used$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^600k$/ })).toBeDefined() // context a resumed chat didn't re-read
  expect(calls.some(c => c.startsWith('park add'))).toBe(false) // you turned figma back on: never auto-parked
  await ui.press({ key: 'park-figma' })
  expect(calls).toContain('park add figma')
  expect(await ui.find({ key: 'park-cortex' })).toBeDefined()
  await ui.unmount()
})

test('status strip: context ring, cache countdown, plan, handoff and waiting count in one small drawing', async ($, on) => {
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  const band = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: {} } as any)
  const strip: any = ((await band.findAll({ type: 'Svg' })) as any[]).find(x => /cache/.test(String(x.props?.alt)))
  expect(strip).toBeDefined()
  expect(String(strip.props.alt)).toMatch(/^context 42% · cache till .* · 5h 23% · week 41% · 2 to review$/)
  expect(String(strip.props.source)).toMatch(/<animate attributeName="width"/)
  await band.unmount()
  const term = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'terminal', props: {} } as any)
  expect(await term.find({ type: 'Text', text: /^Cortex · context 42%/ })).toBeDefined()
  await term.unmount()
})

test('timeline tiles and the Dream page: leave a finding out, apply, undo, dream now — each one press, 0 tokens', async ($, on) => {
  const ep = (i: number) => ({ id: `E${i}`, session: 's', start: '2026-11-09T10:00:00Z', end: '2026-11-09T10:05:00Z', ask: `Request number ${i}`, tools: { Edit: 1 }, files: ['/a.ts'], commands: ['npm test'], tests: { ran: 1, failed: i === 1 ? 1 : 0 }, commits: 1, errors: 0, interrupted: false, skills: [], mcp: [], outTokens: 1200, contextTokens: 9000, done: `did thing ${i}`, next: '' })
  const timeline = [{ id: 'turn-E2', ts: '2026-11-09T10:05:00Z', kind: 'turn', title: 'Request number 2', tags: ['1 file'], tone: 'ok' }, { id: 'dream-1', ts: '2026-11-09T10:04:30Z', kind: 'dream', title: 'Dream: 2 findings to review', tags: ['claude · sonnet'], tone: 'warn' }, { id: 'git-abc', ts: '2026-11-09T10:04:00Z', kind: 'commit', title: 'fix parser', tags: ['abc', 'pushed'], tone: 'info' }]
  const applied = { ...DREAM, id: '01JC0000000000000000000009', status: 'applied', applied: { at: '2026-11-09T09:00:00Z' } }
  const calls: string[] = []
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: 3 }))
  on('session.usage', () => ({ value: { startedAt: 0, version: 'x', context: { tokens: 1000, window: 200_000, percent: 1 }, rateLimits: [] } }))
  on('process.run', (_: unknown, e: any) => { calls.push((e.argv ?? []).slice(2).join(' ')); return { value: { exitCode: 0, stdout: JSON.stringify({ ...STATUS, episodes: [ep(1), ep(2)], timeline, dream: { running: null, recent: [DREAM, applied] } }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Request number 1' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^1 of 1 checks failed$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^did thing 1$/ })).toBeDefined()
  await ui.press({ key: 'tab-timeline' })
  expect(await ui.find({ type: 'Text', text: 'Dream: 2 findings to review' })).toBeDefined()
  expect(((await ui.findAll({ type: 'Svg' })) as any[]).some(x => /1 dreams/.test(String(x.props?.alt)))).toBe(true)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
  await ui.press({ key: 'fa-C1' })
  expect(calls).toContain(`dream decide ${DREAM.id} C1 apply`)
  await ui.press({ key: 'fk-C2' })
  expect(calls).toContain(`dream decide ${DREAM.id} C2 keep`)
  await ui.press({ key: 'fr-C2' })
  expect(calls).toContain(`dream decide ${DREAM.id} C2 remove`)
  await ui.press({ key: 'kc-dream-apply' })
  expect(calls).toContain(`dream decide ${DREAM.id} all apply`)
  await ui.press({ key: `kc-undo-${applied.id}` })
  expect(calls).toContain(`dream undo ${applied.id}`)
  await ui.press({ key: 'kc-dream' })
  expect(calls).toContain('dream')
  await ui.press({ key: 'kc-dream-checks' })
  expect(calls).toContain('dream run --no-model')
  await ui.unmount()
})

test('tips: a cold cache on a big chat warns with the handoff; a cooling cache says when; quiet when all is fine', async () => {
  const live = (tokens: number, percent: number) => ({ model: 'm', turns: 9, context: { tokens, window: 1_000_000, percent, rows: [{ name: 'Autocompact buffer', tokens: 30_000 }] }, limits: [] })
  const s = STATUS as any
  const cold = tipFor(s, live(758_000, 76) as any, { lastAt: Date.now() - 2 * 3_600_000, read: 0, write: 0, input: 0, ttl: '1h', ttlSource: 'x' }, [])
  expect(cold?.text).toMatch(/^Cold cache: next message re-reads 758k$/)
  expect(cold?.detail).toMatch(/a new chat starts with about 1\.8k tokens/)
  const cooling = tipFor(s, live(300_000, 30) as any, { lastAt: Date.now() - 55 * 60_000, read: 0, write: 0, input: 0, ttl: '1h', ttlSource: 'x' }, [])
  expect(cooling?.text).toMatch(/^Cache cools at /)
  expect(tipFor({ ...s, handoff: { ...s.handoff, exists: false } }, live(20_000, 2) as any, { lastAt: Date.now(), read: 0, write: 0, input: 0, ttl: '1h', ttlSource: 'x' }, [])).toBeNull()
})


test('stress: every button on every page and sub-page presses without breaking the panel; each one sends a real command', async ($, on) => {
  const calls: string[] = []
  engine(on, { ...STATUS, dream: { running: null, recent: [DREAM, { ...DREAM, id: '01JC0000000000000000000009', status: 'applied', applied: { at: '2026-11-09T09:00:00Z' } }] } }, {}, calls)
  on('prompt.submit', (_: unknown, e: any) => ({ text: String(e?.text ?? '') }))
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'kc' } as any)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 160 } })
  const pages: [string, string?][] = [['tab-overview'], ['tab-timeline'], ['tab-data', 'sub-dream'], ['tab-data', 'sub-files'], ['tab-data', 'sub-handoff'], ['tab-data', 'sub-details'], ['tab-settings']]
  const go = async (pg: [string, string?]) => { await ui.press({ key: pg[0] }); if (pg[1]) await ui.press({ key: pg[1] }) }
  let pressed = 0
  for (const pg of pages) {
    await go(pg)
    const keys = ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)).filter(k => !/^(tab|sub)-/.test(k))
    for (const key of keys) {
      await go(pg)
      if (!(await ui.find({ key }))) continue // an expand toggled it away
      await ui.press({ key })
      pressed++
      expect(await ui.drawn()).toBeDefined()
    }
  }
  expect(pressed).toBeGreaterThan(20)
  for (const c of ['status --json', 'dream', 'dream run --no-model', `dream decide ${DREAM.id} all apply`, `dream discard ${DREAM.id}`, 'dream undo 01JC0000000000000000000009', 'h']) expect(calls).toContain(c)
  await ui.unmount()
})

test('plan limits: a window whose reset time has passed starts again at 0%, never shows the old number', () => {
  const now = Date.parse('2026-11-11T13:03:00Z')
  const [five, week] = freshLimits([{ kind: 'five_hour', percentUsed: 99, resetsAt: '2026-11-11T11:40:00Z' }, { kind: 'seven_day', percentUsed: 85, resetsAt: '2026-11-13T04:00:00Z' }], now)
  expect(five).toEqual({ kind: 'five_hour', percentUsed: 0, resetsAt: '2026-11-11T11:40:00Z', rolled: true })
  expect(week?.percentUsed).toBe(85)
  expect(week?.rolled).toBeUndefined()
})

test('hand-off: at 82% the Overview asks; flagged memory is checked first; Yes saves the handoff and copies /cortex-resume', async ($, on) => {
  const calls: string[] = []
  const copied: string[] = []
  engine(on, STATUS, {}, calls, { tokens: 164_000, percent: 82 })
  on('ui.copy', (_: unknown, e: any) => { copied.push(String(e?.text)); return { value: { isCopied: true } } })
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  const ui: any = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns: 160 } })
  expect(await ui.find({ type: 'Text', text: /^Context 82% full: continue in a fresh chat\?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^2 memory notes to check first$/ })).toBeDefined() // the fixture Dream has 2 open findings
  await ui.press({ key: 'sw-yes' })
  expect(await ui.find({ key: 'sw-review' })).toBeDefined()
  await ui.press({ key: 'sw-anyway' })
  expect(calls).toContain('handoff')
  expect(copied).toEqual(['/cortex-resume'])
  expect(await ui.find({ type: 'Text', text: /^Handoff saved and \/cortex-resume copied\./ })).toBeDefined()
  await ui.press({ key: 'sw-done' })
  expect(await ui.find({ key: 'sw-yes' })).toBeUndefined() // "Done" waits 30 minutes or 5 more points
  await ui.unmount()
})

test('mascot: the Overview mood follows Cortex status (stressed > dream > working > hi > calm); drawings are cached and bounded', () => {
  const s: any = STATUS, quiet: any = { ...STATUS, dream: { running: null, recent: [] } }
  const l = (percent: number, turns = 5): any => ({ model: 'm', turns, context: { tokens: percent * 2000, window: 200_000, percent, rows: [] }, limits: [] })
  const sw = { pct: 82, tokens: 164_000, cold: false }
  expect(moodOf(s, l(82), sw, null, 0)).toBe('stressed') // the hand-off question is open
  expect(moodOf(quiet, l(30), null, null, 92)).toBe('stressed') // 5-hour plan nearly used
  expect(moodOf(s, l(30), null, null, 10)).toBe('dream') // 2 notes waiting for a decision
  expect(moodOf(quiet, l(65), null, null, 10)).toBe('working')
  expect(moodOf(quiet, l(5, 1), null, null, 10)).toBe('hi')
  expect(moodOf(quiet, l(20), null, null, 10)).toBe('calm')
  const a = moodSvg('calm', 150)
  expect(moodSvg('calm', 150)).toBe(a) // the same string from the cache, not built again
  expect(a.length).toBeLessThan(4_000)
  expect(a).not.toMatch(/<animate|<script|@keyframes/) // static
  for (let w = 100; w < 400; w++) moodSvg('hi', w)
  expect(cachedDrawings()).toBeLessThanOrEqual(64)
})
