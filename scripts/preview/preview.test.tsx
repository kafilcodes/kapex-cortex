// Copied next to the mod by scripts/preview.ts (never run by the normal tests): mounts each page and the strip
// with a real status and prints the drawn trees for the HTML preview.
import { mock, test } from 'claude-code/testing'

const STATUS = __STATUS__
const COLS: number[] = __COLS__

let PCT = 42 // the preview plays a few turns so the trend line under the gauge has a history to draw
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
  on('session.usage', () => ({ value: { startedAt: 0, version: 'x', context: { tokens: PCT * 2000, window: 200_000, percent: PCT, breakdown: { categories: [
    { name: 'System prompt', tokens: 20_000, isDeferred: false }, { name: 'Skills', tokens: 6_400, isDeferred: false }, { name: 'MCP tools', tokens: 9_000, isDeferred: false }, { name: 'Messages', tokens: 48_600, isDeferred: false },
    { name: 'Free space', tokens: 83_000, isDeferred: false }, { name: 'Autocompact buffer', tokens: 33_000, isDeferred: false }], maxTokens: 200_000 } },
    rateLimits: [{ kind: 'five_hour', percentUsed: 41, resetsAt: new Date(Date.now() + 2.2 * 3_600_000).toISOString() }, { kind: 'seven_day', percentUsed: 41, resetsAt: new Date(Date.now() + 4.6 * 86_400_000).toISOString() }] } }))
}
const out = (name: string, tree: unknown) => console.log('@@PREVIEW ' + JSON.stringify({ name, tree }))

test('preview', async ($, on) => {
  mock.clock(on, { now: Date.now() })
  engine(on)
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: STATUS.root, surface: 'desktop', isInteractive: true })
  await $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
  for (const p of [12, 15, 19, 22, 27, 31, 36]) { PCT = p; await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${p}`, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any) }
  PCT = 42
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  const band: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 80 } } as any)
  out('strip', await band.drawn()); await band.unmount()
  // the strip as the chat fills: warning (65%), high with a suggestion (85%), critical (95%), and narrow
  for (const [p, cols] of [[65, 80], [85, 80], [95, 80], [85, 56], [85, 112], [95, 112]] as const) {
    PCT = p
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `h${p}${cols}`, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
    const b: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: cols } } as any)
    out(`strip-${p}-${cols}`, await b.drawn()); await b.unmount()
  }
  PCT = 42
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9_700, cache_creation_input_tokens: 200 } } as any)
  { // the strip a moment after a handoff: the notification chip in place of the tip
    const pane: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', surface: 'desktop', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as any)
    try { await pane.press({ key: 'tab-handoff' }); await pane.press({ key: 'kc-hand3' }) } catch {}
    const b2: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'AbovePrompt', surface: 'desktop', props: { bodyColumns: 80 } } as any)
    out('strip-flash', await b2.drawn()); await b2.unmount(); await pane.press({ key: 'tab-overview' }); await pane.unmount()
  }
  for (const bodyColumns of COLS) {
    const ui: any = await $.ui.mount({ plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', surface: 'desktop', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } } as any)
    const shot = async (name: string, ...keys: string[]) => { for (const k of keys) { try { await ui.press({ key: k }) } catch {} } out(`${name}-${bodyColumns}`, await ui.drawn()) }
    await shot('overview', 'tab-overview')
    await shot('timeline', 'tab-timeline')
    const opened = async (name: string) => { const b = ((await ui.findAll({ type: 'Button' })) as any[]).find(x => /^tx-/.test(String(x.key))); if (!b) return; await ui.press({ key: b.key }); out(`${name}-${bodyColumns}`, await ui.drawn()); await ui.press({ key: b.key }) }
    await opened('timeline-open')
    // v4.3: an old page's turn opened, an earlier handoff opened, a past memory check opened
    const openFirst = async (name: string, prefix: string) => { const b = ((await ui.findAll({ type: 'Button' })) as any[]).find(x => String(x.key).startsWith(prefix)); if (!b) return; await ui.press({ key: b.key }); out(`${name}-${bodyColumns}`, await ui.drawn()); await ui.press({ key: b.key }) }
    for (let i = 0; i < 3; i++) { try { await ui.press({ key: 'tl-more' }) } catch {} }
    await openFirst('timeline-old', 'tx-turn-')
    try { await ui.press({ key: 'tl-less' }) } catch {}
    try { await ui.press({ key: 'tab-handoff' }) } catch {}
    await openFirst('handoff-open', 'tx-hs-')
    try { await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' }) } catch {}
    { // every past check opened at once, so one with several fixes shows its mini rail
      const bs = ((await ui.findAll({ type: 'Button' })) as any[]).filter(x => String(x.key).startsWith('tx-dh-'))
      for (const b of bs) await ui.press({ key: b.key })
      out(`memory-open-${bodyColumns}`, await ui.drawn())
      for (const b of bs) await ui.press({ key: b.key })
    }
    for (const sub of ['dream', 'files']) await shot(`data-${sub}`, 'tab-data', `sub-${sub}`)
    await shot('data-handoff', 'tab-handoff'); await shot('data-details', 'tab-details', 'sub-costs'); await shot('data-usage', 'sub-usage'); await ui.press({ key: 'sub-costs' })
    await shot('data-dream', 'tab-data', 'sub-dream'); await opened('data-dream-open')
    await shot('settings', 'tab-settings')
    await shot('intro-1', 'st-intro-b'); await shot('intro-2', 'intro-next'); await shot('intro-3', 'intro-next'); await ui.press({ key: 'intro-next' })
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})
