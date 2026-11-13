// Copied next to the mod by scripts/preview.ts (never run by the normal tests): mounts each page and the strip
// with a real status and prints the drawn trees for the HTML preview.
import { mock, test } from 'claude-code/testing'

const STATUS = __STATUS__
const COLS: number[] = __COLS__

function engine(on: any) {
  on('settings.read', () => ({ value: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e?.name === 'HOME' ? '/home/test' : undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(STATUS), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: 7 }))
  on('session.usage', () => ({ value: { startedAt: 0, version: 'x', context: { tokens: 84_000, window: 200_000, percent: 42, breakdown: { categories: [
    { name: 'System prompt', tokens: 20_000, isDeferred: false }, { name: 'Skills', tokens: 6_400, isDeferred: false }, { name: 'MCP tools', tokens: 9_000, isDeferred: false }, { name: 'Messages', tokens: 48_600, isDeferred: false },
    { name: 'Free space', tokens: 83_000, isDeferred: false }, { name: 'Autocompact buffer', tokens: 33_000, isDeferred: false }], maxTokens: 200_000 } },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-11-10T15:00:00Z' }, { kind: 'seven_day', percentUsed: 41 }] } }))
}
const out = (name: string, tree: unknown) => console.log('@@PREVIEW ' + JSON.stringify({ name, tree }))

test('preview', async ($, on) => {
  mock.clock(on, { now: Date.now() })
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: STATUS.root, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  const band: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 80 } } as any)
  out('strip', await band.drawn()); await band.unmount()
  for (const bodyColumns of COLS) {
    const ui: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', surface: 'desktop', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as any)
    const shot = async (name: string, ...keys: string[]) => { for (const k of keys) { try { await ui.press({ key: k }) } catch {} } out(`${name}-${bodyColumns}`, await ui.drawn()) }
    await shot('overview', 'tab-overview')
    await shot('timeline', 'tab-timeline')
    const opened = async (name: string) => { const b = ((await ui.findAll({ type: 'Button' })) as any[]).find(x => /^tx-/.test(String(x.key))); if (!b) return; await ui.press({ key: b.key }); out(`${name}-${bodyColumns}`, await ui.drawn()); await ui.press({ key: b.key }) }
    await opened('timeline-open')
    for (const sub of ['dream', 'files', 'handoff', 'details']) await shot(`data-${sub}`, 'tab-data', `sub-${sub}`)
    await shot('data-dream', 'tab-data', 'sub-dream'); await opened('data-dream-open')
    await shot('settings', 'tab-settings')
    await shot('intro-1', 'st-intro-b'); await shot('intro-2', 'intro-next'); await shot('intro-3', 'intro-next'); await ui.press({ key: 'intro-next' })
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})
