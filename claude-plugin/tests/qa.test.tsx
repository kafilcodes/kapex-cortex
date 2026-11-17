// Edge-case suite written by a fresh QA agent before v4.0: hostile, minimal and huge statuses at every width and surface,
// every button pressed, paging, the Costs views and notifications. It prints QA-* lines and fails on any finding.
import { expect, mock, test } from 'claude-code/testing'

import { BAND, empty, engine, healthy, hostile, HOUR, huge, hugeFewEvents, iso, minimal, pane, problems, see, spendDays, SURFACES, USAGE, WIDTHS, type Eng } from './qa-fixtures'

// Pre-1.0 QA pass over the panel and the strip. Every test draws real pages through the plugin's own hooks, on the
// desktop and in the terminal, at six widths, and fails when a drawing can't be made, when a press throws, or when a
// word nobody should see ("undefined", "NaN", "null", "[object", "Infinity", "Invalid Date", a double ellipsis)
// reaches the screen, a screen reader, or a drawing's source. Each problem prints as a QA-FINDING line.

const TABS = ['tab-overview', 'tab-timeline', 'tab-data', 'tab-handoff', 'tab-details', 'tab-settings']
const LONG_RUN = { timeoutMs: 180_000 }
const msg = (err: unknown) => String((err as Error)?.message ?? err).replace(/\s+/g, ' ').slice(0, 260)

/** Problems by what they are, with where they showed (the first few places and how many in all). */
class Log {
  private items = new Map<string, string[]>()
  constructor(private test: string) {}
  add(where: string, what: string): void { const w = this.items.get(what) ?? []; w.push(where); this.items.set(what, w) }
  get size(): number { return this.items.size }
  /** Prints every problem once and returns their count. */
  flush(): number {
    for (const [what, where] of this.items) console.log(`QA-FINDING ${JSON.stringify({ test: this.test, what, count: where.length, where: [...new Set(where)].slice(0, 8) })}`)
    return this.items.size
  }
}

const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any) // refreshes the status and opens the pane
async function start($: any): Promise<void> {
  await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true })
  await open($)
}
/** The drawing, checked: returns the tree, or null when it could not be drawn. */
async function check(ui: any, log: Log, where: string): Promise<unknown> {
  try {
    const tree = await ui.drawn()
    for (const p of problems(tree)) log.add(where, p)
    return tree
  } catch (err) { log.add(where, `THROW drawing: ${msg(err)}`); return null }
}
const has = async (ui: any, key: string): Promise<boolean> => { try { return !!(await ui.find({ key })) } catch { return false } }
const buttons = async (ui: any): Promise<string[]> => { try { return ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)) } catch { return [] } }
async function press(ui: any, log: Log, where: string, key: string): Promise<boolean> {
  try { await ui.press({ key }); return true } catch (err) { log.add(where, `THROW pressing ${key}: ${msg(err)}`); return false }
}
/** Past the first-run intro (drawn instead of the tabs), checking each of its steps. */
async function passIntro(ui: any, log: Log, where: string): Promise<void> {
  for (let i = 0; i < 6 && (await has(ui, 'intro-next')); i++) { await check(ui, log, `${where}/intro-${i}`); await press(ui, log, `${where}/intro-${i}`, 'intro-next') }
}

/** One status and one kind of live numbers, on both surfaces at every width: every tab and sub-tab, a few tiles opened
 * on each (first, second, last), the Timeline paged back and returned, and the strip. A page that cannot be drawn
 * leaves the pane blank (the tabs are part of the same drawing): the test then loads a healthy status, moves to the
 * next tab and puts the status under test back, so every page gets its turn. */
function matrix(name: string, eng: () => Eng, o: { tiles?: number; pages?: number; store?: boolean; widths?: readonly number[] } = {}): void {
  test(`matrix: ${name}: every page draws clean on desktop and terminal at ${(o.widths ?? WIDTHS).join('/')} columns`, LONG_RUN, async ($, on) => {
    mock.clock(on, { now: Date.now() })
    if (o.store !== false) mock.store(on)
    const e = eng()
    const holder = { fn: e.status }
    engine(on, { ...e, status: () => holder.fn() })
    const log = new Log(name)
    await start($)
    let seen = 0
    for (const surface of SURFACES) {
      for (const cols of o.widths ?? WIDTHS) {
        const where = `${surface}@${cols}`
        const mount = () => $.ui.mount({ ...pane(cols), surface } as any) as Promise<any>
        let ui: any = null, broken = false
        try { ui = await mount() } catch (err) { log.add(`${where}/first`, `THROW mounting the pane: ${msg(err)}`); broken = true }
        if (ui) { if (!(await check(ui, log, `${where}/first`))) broken = true; else await passIntro(ui, log, where) }
        /** Makes `tab` the open page, through a healthy status when the pane is blank. Returns whether it drew. */
        const goTab = async (tab: string): Promise<boolean> => {
          if (broken) {
            holder.fn = healthy; await open($)
            await ui?.unmount().catch(() => undefined)
            try { ui = await mount() } catch (err) { log.add(`${where}/${tab}`, `THROW the pane stays blank even with a healthy status: ${msg(err)}`); holder.fn = e.status; return false }
            if (await has(ui, 'intro-skip')) await press(ui, log, where, 'intro-skip')
            await press(ui, log, `${where}/${tab}`, tab)
            holder.fn = e.status; await open($)
            broken = false
          } else if (!(await has(ui, tab))) { log.add(where, `MISSING ${tab}`); return false }
          else if (!(await press(ui, log, `${where}/${tab}`, tab))) return false
          if (!(await check(ui, log, `${where}/${tab}`))) { broken = true; return false }
          return true
        }
        for (const tab of TABS) {
          if (!(await goTab(tab))) continue
          seen++
          const subs = (await buttons(ui)).filter(k => /^sub-/.test(k))
          for (const sub of subs.length ? subs : ['']) {
            if (broken) break
            const at = sub ? `${where}/${tab}/${sub}` : `${where}/${tab}`
            if (sub) { if (!(await press(ui, log, at, sub))) continue; if (!(await check(ui, log, at))) { broken = true; break } seen++ }
            for (let p = 0; p < (o.pages ?? 2) && (await has(ui, 'tl-more')); p++) { await press(ui, log, at, 'tl-more'); if (!(await check(ui, log, `${at}/older-${p + 1}`))) { broken = true; break } }
            if (broken) break
            const tx = (await buttons(ui)).filter(k => /^(tx-|ls-more)/.test(k))
            const n = o.tiles ?? 3
            for (const k of [...new Set([...tx.slice(0, Math.max(0, n - 1)), ...tx.slice(-1)])].slice(0, n)) {
              if (!(await has(ui, k))) continue
              if (await press(ui, log, at, k)) { if (!(await check(ui, log, `${at}/${k.slice(0, 40)}`))) { broken = true; break } seen++ }
            }
            if (!broken && (await has(ui, 'tl-less'))) { await press(ui, log, at, 'tl-less'); await check(ui, log, `${at}/newest`) }
          }
        }
        if (broken) { holder.fn = healthy; await open($); await ui?.unmount().catch(() => undefined); try { ui = await mount(); await press(ui, log, where, 'tab-overview') } catch { /* said above */ } holder.fn = e.status; await open($) }
        await ui?.unmount().catch(() => undefined)
      }
      const where = `${surface}@strip`
      try {
        const band: any = await $.ui.mount({ ...BAND, surface } as any)
        await check(band, log, where)
        await band.unmount()
      } catch (err) { log.add(where, `THROW mounting the strip: ${msg(err)}`) }
    }
    console.log(`QA-PASS ${JSON.stringify({ test: name, drawings: seen, problems: log.size })}`)
    expect(log.flush(), `${name}: problems found (see the QA-FINDING lines)`).toBe(0)
  })
}

// 1. a minimal status: only the required fields. The first-run intro shows first (a store with nothing in it).
matrix('minimal status, no live numbers', () => ({ status: minimal, usage: null, turns: 0 }))
matrix('minimal status, no store either', () => ({ status: minimal, usage: null, turns: 0 }), { store: false, widths: [40, 120] })
matrix('minimal status, live numbers', () => ({ status: minimal }), { widths: [40, 84, 200] })
// optional fields present and empty or zero
matrix('empty status, bare live numbers', () => ({ status: empty, usage: USAGE.bare }))
// a healthy project (the baseline: this one must be spotless)
matrix('healthy status, normal chat', () => ({ status: healthy }))
matrix('healthy status, 86% full chat', () => ({ status: healthy, usage: USAGE.full }))
// 3. live usage absent, and rate limits whose reset time has passed
matrix('healthy status, no live numbers', () => ({ status: healthy, usage: null }), { widths: [40, 84, 200] })
matrix('healthy status, plan windows already reset', () => ({ status: healthy, usage: USAGE.pastReset }), { widths: [40, 84, 200] })
matrix('healthy status, live numbers Claude Code should not send', () => ({ status: healthy, usage: USAGE.weird }), { widths: [40, 84, 200] })
// 2. a huge one (600 events with 2,000-character titles), and the same with the Timeline held to the CLI's own cap
matrix('huge status, 86% full chat', () => ({ status: huge, usage: USAGE.full }), { tiles: 3, pages: 2 })
matrix('huge status with 160 events, 86% full chat', () => ({ status: hugeFewEvents, usage: USAGE.full }), { tiles: 3, pages: 2 })
matrix('huge status with 160 events, no live numbers', () => ({ status: hugeFewEvents, usage: null }), { widths: [60, 200], tiles: 2, pages: 1 })
matrix('hostile status (zero, negative, future and unreadable times)', () => ({ status: hostile }), { tiles: 4 })
matrix('hostile status, weird live numbers', () => ({ status: hostile, usage: USAGE.weird }), { widths: [40, 120, 260], tiles: 2 })
// 4. spend shapes
const withSpend = (spend: object, usage?: object) => () => ({ ...healthy(), spend: { ...healthy().spend, ...spend }, ...(usage ? { usage: { ...healthy().usage, ...usage } } : {}) })
const zeros = () => Array.from({ length: 7 }, () => Array(24).fill(0))
matrix('spend: one day', () => ({ status: withSpend({ days: spendDays(1) }) }))
matrix('spend: 400 days', () => ({ status: withSpend({ days: spendDays(400), since: '2025-10-01' }) }))
matrix('spend: one day, a year ago', () => ({ status: withSpend({ days: { '2025-11-10': 123_456 }, since: '2025-11-10' }) }), { widths: [40, 120, 260] })
matrix('spend: hours all zeros', () => ({ status: withSpend({ hours: zeros() }) }))
matrix('spend: hours all zeros and tools empty', () => ({ status: withSpend({ hours: zeros() }, { tools: {} }) }))
matrix('spend: tools empty', () => ({ status: withSpend({}, { tools: {} }) }))
matrix('spend: no days, no hours, usage missing', () => ({ status: () => { const s = withSpend({})(); delete s.spend.days; delete s.spend.hours; delete s.usage; return s } }), { widths: [40, 120, 260] })
matrix('spend: one busy hour, one tool', () => ({ status: withSpend({ hours: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d === 6 && h === 23 ? 500 : 0))) }, { tools: { Bash: 5000 } }) }), { widths: [40, 120, 260] })

// ── every button, once ───────────────────────────────────────────────────────────────────────────────────────────
type Page = [tab: string, sub?: string]
async function goTo(ui: any, log: Log, where: string, pg: Page): Promise<boolean> {
  if (await has(ui, 'intro-skip')) await press(ui, log, where, 'intro-skip')
  await passIntro(ui, log, where)
  if (!(await has(ui, pg[0]))) { log.add(where, `MISSING ${pg[0]}`); return false }
  if (!(await press(ui, log, where, pg[0]))) return false
  if (pg[1] && (await has(ui, pg[1]))) await press(ui, log, where, pg[1])
  return true
}
function everyButton(name: string, eng: () => Eng, surface: 'desktop' | 'terminal', cols: number, least = 20): void {
  test(`buttons: ${name}: each Button, option and field on each page, pressed once in a fresh mount (${surface}, ${cols} columns)`, LONG_RUN, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on)
    const calls: string[] = [], prompts: string[] = []
    engine(on, { ...eng(), calls, prompts })
    const log = new Log(`buttons ${name} ${surface}@${cols}`)
    await start($)
    const mount = () => $.ui.mount({ ...pane(cols), surface } as any) as Promise<any>
    // which pages there are (sub-tabs differ between versions): found from the drawing, not assumed
    const pages: Page[] = []
    {
      const ui = await mount()
      for (const tab of TABS) {
        if (!(await goTo(ui, log, 'setup', [tab]))) continue
        const subs = (await buttons(ui)).filter(k => /^sub-/.test(k))
        if (subs.length) for (const s of subs) pages.push([tab, s]); else pages.push([tab])
      }
      await ui.unmount()
    }
    const pressed: string[] = []
    for (const pg of pages) {
      const at = pg.join('/')
      let ui = await mount()
      if (!(await goTo(ui, log, at, pg))) { await ui.unmount(); continue }
      const all = await buttons(ui)
      const keys = [...new Set(all.filter(k => !/^(tab|sub)-/.test(k) && k !== 'undefined'))]
      const unkeyed = all.filter(k => k === 'undefined').length
      if (unkeyed) log.add(at, `${unkeyed} Button(s) without a key (cannot be pressed by key)`)
      const dup = all.filter((k, i) => k !== 'undefined' && all.indexOf(k) !== i)
      if (dup.length) log.add(at, `two Buttons share a key: ${[...new Set(dup)].slice(0, 5).join(', ')}`)
      const selects = ((await ui.findAll({ type: 'Select' })) as any[]).map(x => ({ key: String(x.key), values: ((x.props?.options ?? []) as any[]).map(op => String(op.value)) }))
      const inputs = ((await ui.findAll({ type: 'Input' })) as any[]).map(x => String(x.key))
      await ui.unmount()
      for (const key of keys) {
        ui = await mount()
        // an earlier press may have changed the page (a decided finding, a finished flow): then the key is simply gone
        if ((await goTo(ui, log, `${at}/${key}`, pg)) && (await has(ui, key)) && (await press(ui, log, `${at}/${key}`, key))) { pressed.push(`${at}/${key}`); await check(ui, log, `${at}/${key}/after`) }
        await ui.unmount().catch(() => undefined)
      }
      for (const sel of selects) for (const value of sel.values) {
        ui = await mount()
        if ((await goTo(ui, log, `${at}/${sel.key}`, pg)) && (await has(ui, sel.key))) {
          try { await ui.select({ key: sel.key, value }); pressed.push(`${at}/${sel.key}=${value}`); await check(ui, log, `${at}/${sel.key}=${value}/after`) } catch (err) { log.add(`${at}/${sel.key}`, `THROW selecting ${value}: ${msg(err)}`) }
        }
        await ui.unmount().catch(() => undefined)
      }
      for (const key of inputs) for (const text of ['', '   ', 'x'.repeat(5000), '🚀 "quoted" `tick` --flag=1; rm -rf / \n second line', '-1', '1e999']) {
        ui = await mount()
        if ((await goTo(ui, log, `${at}/${key}`, pg)) && (await has(ui, key))) {
          try { await ui.input({ key, text }); pressed.push(`${at}/${key}<-${JSON.stringify(text.slice(0, 12))}`); await check(ui, log, `${at}/${key}/after`) } catch (err) { log.add(`${at}/${key}`, `THROW typing ${JSON.stringify(text.slice(0, 20))}: ${msg(err)}`) }
        }
        await ui.unmount().catch(() => undefined)
      }
    }
    // the strip's buttons
    for (const key of ['kc-do', 'kc-refresh', 'kc-retry', 'kc-open']) {
      try {
        const band: any = await $.ui.mount({ ...BAND, surface } as any)
        if ((await has(band, key)) && (await press(band, log, `strip/${key}`, key))) { pressed.push(`strip/${key}`); await check(band, log, `strip/${key}/after`) }
        await band.unmount()
      } catch (err) { log.add(`strip/${key}`, `THROW: ${msg(err)}`) }
    }
    const cmds = [...new Set(calls)].filter(c => c !== 'status --json')
    console.log(`QA-PRESSED ${JSON.stringify({ test: `${name} ${surface}@${cols}`, pages: pages.map(p => p.join('/')), pressed: pressed.length, commands: cmds.length, prompts: prompts.length, keys: [...new Set(pressed.map(p => p.split('/').pop()!.replace(/[0-9A-Z]{20,}/, 'ID').replace(/<-.*/, '<-text')))].join(' ').slice(0, 1500) })}`)
    expect(pressed.length, 'buttons pressed').toBeGreaterThan(least)
    expect(log.flush(), `${name}: problems found (see the QA-FINDING lines)`).toBe(0)
  })
}
everyButton('healthy, 86% full (the hand-off question is open)', () => ({ status: healthy, usage: USAGE.full }), 'desktop', 200)
everyButton('healthy, normal chat', () => ({ status: healthy }), 'desktop', 84)
everyButton('healthy, normal chat', () => ({ status: healthy }), 'terminal', 120)
everyButton('healthy, a fresh chat (0 turns: Continue from the handoff)', () => ({ status: () => ({ ...healthy(), dream: { running: null, recent: [] } }), turns: 0, session: 'new-chat' }), 'desktop', 120)
everyButton('huge with 160 events', () => ({ status: hugeFewEvents, usage: USAGE.full }), 'desktop', 200)
everyButton('hostile', () => ({ status: hostile, usage: USAGE.weird }), 'desktop', 60)
everyButton('minimal', () => ({ status: minimal, usage: null, turns: 0 }), 'terminal', 40, 8)

// ── a command that fails must leave a readable panel ─────────────────────────────────────────────────────────────
test('buttons whose command fails: the page still draws and says what went wrong in words', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  let failing = false
  engine(on, { status: healthy, run: args => (failing && args !== 'status --json'
    ? { value: { exitCode: 1, stdout: '', stderr: 'Error: EACCES: permission denied, open \'/demo/.vault/STATE.md\'\n    at Object.openSync (node:fs:562:18)\n    at file:///x/cli.ts:1:1', isStdoutTruncated: false, isStderrTruncated: false } }
    : { value: { exitCode: 0, stdout: JSON.stringify(healthy()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) })
  const log = new Log('failing commands')
  await start($)
  failing = true
  let n = 0
  for (const pg of [['tab-data', 'sub-dream'], ['tab-handoff'], ['tab-details', 'sub-costs'], ['tab-settings']] as Page[]) {
    let ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
    await goTo(ui, log, pg.join('/'), pg)
    const keys = [...new Set((await buttons(ui)).filter(k => !/^(tab|sub|tx)-/.test(k)))]
    await ui.unmount()
    for (const key of keys) {
      ui = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
      if ((await goTo(ui, log, pg.join('/'), pg)) && (await has(ui, key)) && (await press(ui, log, `${pg.join('/')}/${key}`, key))) { n++; await check(ui, log, `${pg.join('/')}/${key}/after`) }
      await ui.unmount().catch(() => undefined)
    }
  }
  console.log(`QA-PASS ${JSON.stringify({ test: 'failing commands', pressed: n, problems: log.size })}`)
  expect(n).toBeGreaterThan(10)
  expect(log.flush()).toBe(0)
})

// ── what `kc status --json` can answer when things go wrong ──────────────────────────────────────────────────────
function broken(name: string, run: (args: string) => unknown, o: { store?: Record<string, unknown>; expectText?: RegExp } = {}): void {
  test(`status failures: ${name}: the pane and the strip still draw, on both surfaces`, { timeoutMs: 60_000 }, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on, o.store ?? {})
    engine(on, { status: healthy, run })
    const log = new Log(`status failure: ${name}`)
    try { await start($) } catch (err) { log.add('start', `THROW: ${msg(err)}`) }
    for (const surface of SURFACES) for (const cols of [40, 120]) {
      const where = `${surface}@${cols}`
      try {
        const ui: any = await $.ui.mount({ ...pane(cols), surface } as any)
        const tree = await check(ui, log, where)
        if (o.expectText && tree && !see(tree).texts.some(t => o.expectText!.test(t))) log.add(where, `expected words matching ${o.expectText} are missing`)
        for (const key of (await buttons(ui)).filter(k => !/^tab-/.test(k)).slice(0, 6)) { if (await has(ui, key)) { await press(ui, log, `${where}/${key}`, key); await check(ui, log, `${where}/${key}/after`) } }
        for (const tab of TABS) if (await has(ui, tab)) { await press(ui, log, `${where}/${tab}`, tab); await check(ui, log, `${where}/${tab}`) }
        await ui.unmount()
      } catch (err) { log.add(where, `THROW mounting the pane: ${msg(err)}`) }
      try { const band: any = await $.ui.mount({ ...BAND, surface } as any); await check(band, log, `${where}/strip`); await band.unmount() } catch (err) { log.add(`${where}/strip`, `THROW mounting the strip: ${msg(err)}`) }
    }
    console.log(`QA-PASS ${JSON.stringify({ test: `status failure: ${name}`, problems: log.size })}`)
    expect(log.flush()).toBe(0)
  })
}
const out = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
broken('exit 1 with a stack trace', () => out(1, '', 'Error: ENOENT: no such file or directory, open \'/demo/.vault/cortex.json\'\n    at file:///cli.ts:1:1'), { expectText: /Couldn't load|Loading/ })
broken('exit 0 with text that is not JSON', () => out(0, 'Warning: something\n{"project":'), { expectText: /Couldn't load|Loading|unreadable/ })
broken('exit 0 with nothing', () => out(0, ''))
broken('node is missing (the program cannot start)', () => { throw new Error('spawn node ENOENT') }, { expectText: /Node\.js/ })
broken('the command times out', () => { throw new Error('process.run timed out after 20000 ms') })
broken('no Cortex here, 40 folders nearby', () => out(1, JSON.stringify({ off: true, cwd: '/work/some folder', nearby: Array.from({ length: 40 }, (_, i) => `project-${i}-${'long-name-'.repeat(6)}`) })))
broken('no Cortex here, nothing nearby, cwd empty', () => out(1, JSON.stringify({ off: true, cwd: '', nearby: [] })))
broken('no Cortex here, `nearby` missing', () => out(1, JSON.stringify({ off: true, cwd: '/work' })))
// a status with fields missing: an older or newer CLI than the panel (the two ship together, but the saved copy below doesn't)
broken('exit 0 with {} (a status with no fields)', () => out(0, '{}'))
broken('exit 0 with JSON null', () => out(0, 'null'))
broken('exit 0 with a JSON array', () => out(0, '[]'))
broken('exit 0 with only project and root', () => out(0, JSON.stringify({ project: 'demo', root: '/demo' })))
broken('the status saved by an earlier version has fewer fields, and the refresh fails', () => out(1, '', 'boom'), { store: { 'last-status-v3': { project: 'demo', root: '/demo', handoff: { exists: true, ageMinutes: 5, ready: false, from: 'claude-code' }, native: { files: [], alwaysTokens: 0, alwaysLines: 0 }, hooks: { p95: 50, samples: 4, cap: 150 }, stateAt: iso(HOUR), health: 'good' } } })
broken('a Dream report in the status has no findings list', () => out(0, JSON.stringify({ ...healthy(), dream: { running: null, recent: [{ id: '01JZ', ts: iso(HOUR), status: 'proposed' }] } })))
broken('saved plan numbers from another chat are malformed', () => out(0, JSON.stringify(healthy())), { store: { 'last-limits': { at: 'yesterday', limits: [{ kind: 'five_hour' }, { percentUsed: 40, resetsAt: 12345 }, null] } } })

// ── how long a page takes to draw ────────────────────────────────────────────────────────────────────────────────
function timing(name: string, eng: () => Eng): void {
  test(`timing: ${name}: each page at 200 columns on the desktop (median of 5, ms)`, LONG_RUN, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on)
    engine(on, eng())
    await start($)
    const t0 = Date.now()
    const ui: any = await $.ui.mount({ ...pane(200), surface: 'desktop' } as any)
    await ui.drawn()
    const mountMs = Date.now() - t0
    if (await has(ui, 'intro-skip')) await ui.press({ key: 'intro-skip' })
    const pages: Page[] = []
    for (const tab of TABS) { await ui.press({ key: tab }); const subs = (await buttons(ui)).filter(k => /^sub-/.test(k)); if (subs.length) for (const s of subs) pages.push([tab, s]); else pages.push([tab]) }
    type Row = { median: number; max: number; nodes: number; kChars: number; svgs: number; biggestSvg: number }
    const rows: Record<string, Row> = {}
    const size = (tree: unknown) => { const s = see(tree); return { nodes: s.nodes, kChars: Math.round(s.chars / 1000), svgs: s.svgs.length, biggestSvg: Math.max(0, ...s.svgs.map(x => x.source.length)) } }
    for (const pg of pages) {
      const times: number[] = []
      let tree: unknown = null
      for (let i = 0; i < 5; i++) {
        // leave the page (so the next visit is a real redraw, not the memoized tree), then time the way back
        await ui.press({ key: pg[0] === 'tab-settings' ? 'tab-overview' : 'tab-settings' }); await ui.drawn()
        const t = Date.now()
        await ui.press({ key: pg[0] })
        if (pg[1] && (await has(ui, pg[1]))) await ui.press({ key: pg[1] })
        tree = await ui.drawn()
        times.push(Date.now() - t)
      }
      times.sort((a, b) => a - b)
      rows[pg.join('/')] = { median: times[2]!, max: times[4]!, ...size(tree) }
    }
    // a Timeline tile opened, and the Timeline paged back to its end
    await ui.press({ key: 'tab-timeline' })
    const tx = (await buttons(ui)).find(k => /^tx-/.test(k))
    if (tx) { const t = Date.now(); await ui.press({ key: tx }); const tree = await ui.drawn(); rows['tab-timeline/open-a-tile'] = { median: Date.now() - t, max: 0, ...size(tree) } }
    let worst = 0, presses = 0, tree: unknown = null
    for (; presses < 40 && (await has(ui, 'tl-more')); presses++) { const t = Date.now(); await ui.press({ key: 'tl-more' }); tree = await ui.drawn(); worst = Math.max(worst, Date.now() - t) }
    if (presses) rows[`tab-timeline/paged-to-the-end (${presses} presses)`] = { median: worst, max: worst, ...size(tree) }
    await ui.unmount()
    const tb = Date.now()
    const band: any = await $.ui.mount({ ...BAND, surface: 'desktop' } as any); await band.drawn(); await band.unmount()
    console.log(`QA-TIMING ${JSON.stringify({ test: name, mountMs, stripMs: Date.now() - tb, pages: rows })}`)
    expect(Object.keys(rows).length).toBeGreaterThan(6)
  })
}
timing('healthy status', () => ({ status: healthy }))
timing('huge status with 160 events', () => ({ status: hugeFewEvents, usage: USAGE.full }))

// ── a long session: the lists the panel keeps must stay bounded ──────────────────────────────────────────────────
test('a long session: 300 replies, heartbeats and refreshes keep the drawing the same size', LONG_RUN, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() }); mock.store(on)
  let pct = 1
  engine(on, { status: healthy, usage: () => ({ ...USAGE.normal(), context: { ...USAGE.normal().context, percent: pct, tokens: pct * 2000 }, rateLimits: [{ kind: 'five_hour', percentUsed: pct % 100, resetsAt: iso(-HOUR) }] }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  const first = see(await ui.drawn())
  for (let i = 0; i < 300; i++) {
    pct = (i % 97) + 1
    await $.turn.start({ turnId: `t${i}` } as any)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${i}`, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 100 } } as any)
    if (i % 25 === 0) await clock.advance(31_000)
  }
  await clock.advance(5_000)
  const last = see(await ui.drawn())
  const bad = problems(await ui.drawn())
  console.log(`QA-PASS ${JSON.stringify({ test: 'long session', nodesFirst: first.nodes, nodesLast: last.nodes, charsFirst: first.chars, charsLast: last.chars, bad })}`)
  expect(bad).toEqual([])
  expect(last.nodes).toBeLessThan(first.nodes * 1.5 + 50)
  expect(last.chars).toBeLessThan(first.chars * 2 + 20_000)
  await ui.unmount()
})
