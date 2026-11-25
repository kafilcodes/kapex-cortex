import { expect, mock, test } from 'claude-code/testing'

import { BAND, dream, engine, events, healthy, huge, minimal, pane, problems, quiet, see, SVG_MAX, USAGE } from './qa-fixtures'

// QA for what v4.0 added (the Timeline's paging became a list that loads as you go in v4.4: tl-more / tl-newer / tl-less), the Costs
// tab's two views (sub-costs / sub-usage), and notifications (a strip chip, a toast, Cortex's own two sounds).

const LONG_RUN = { timeoutMs: 120_000 }
const msg = (err: unknown) => String((err as Error)?.message ?? err).replace(/\s+/g, ' ').slice(0, 260)
const open = ($: any) => $.tool.call({ tool: 'mcp__kapex-cortex__open_panel' } as any)
async function start($: any): Promise<void> { await $.session.start({ cwd: '/demo', surface: 'desktop', isInteractive: true }); await open($) }
const has = async (ui: any, key: string): Promise<boolean> => { try { return !!(await ui.find({ key })) } catch { return false } }
const tilesOf = (tree: unknown) => see(tree).keys.filter(k => /^tile-/.test(k))
const textOf = async (ui: any, key: string): Promise<string> => String((await ui.find({ key }))?.text ?? '')
/** The paging line's count ("N older events not shown" / "All N events shown"), or '' when it isn't drawn. */
const countOf = async (ui: any): Promise<string> => see(await ui.drawn()).texts.find(t => /older events? not shown$|^All \d+ events shown$/.test(t)) ?? ''
const PAGE = 24

// ── Timeline: a list that loads as you go ────────────────────────────────────────────────────────────────────────
// Show older adds 24 below (and scrolls to the first of them); at most 48 tiles are drawn at once, so the newest drop
// off the top (Show newer brings them back) and the pane never grows past what the desktop app draws (v4.0 blanked it at
// ~750 KB). Back to newest returns to the first 24. Past the status's 160, Show older asks the core for more.
const WINDOW = 48
const rangeOf = async (ui: any): Promise<string> => see(await ui.drawn()).texts.find(t => /^\d+–\d+ of \d+ · /.test(t)) ?? ''
const expectAt = async (ui: any, list: any[], end: number, n: number, range?: string) => {
  const begin = Math.max(0, end - WINDOW), tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(tilesOf(tree), `tiles ${begin + 1}–${end}`).toEqual(list.slice(begin, end).map(e => `tile-${e.id}`))
  expect(see(tree).chars, 'never past what the app draws').toBeLessThan(400_000)
  expect(await has(ui, 'tl-newer'), 'Show newer once the newest dropped off the top').toBe(begin > 0)
  expect(await has(ui, 'tl-less'), 'Back to newest past the first 24').toBe(end > PAGE)
  if (n > PAGE) expect(await rangeOf(ui)).toBe(range ?? `${begin + 1}–${end} of ${n} · ${end < n ? `${n - end} older loaded` : 'the oldest'}`)
}
for (const n of [0, 1, 24, 25, 48, 49, 100]) {
  test(`timeline: ${n} events: Show older grows the list 24 at a time, keeps at most 48 drawn, Show newer and Back to newest return`, LONG_RUN, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on)
    const list = events(n)
    engine(on, { status: () => ({ ...healthy(), timeline: list }) })
    await start($)
    const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
    await ui.press({ key: 'tab-timeline' })
    let end = Math.min(n, PAGE)
    await expectAt(ui, list, end, n)
    if (n <= PAGE) { expect(await has(ui, 'tl-more'), 'nothing older').toBe(false); expect(await rangeOf(ui)).toBe(''); await ui.unmount(); return }
    while (await has(ui, 'tl-more')) { await ui.press({ key: 'tl-more' }); end = Math.min(n, end + PAGE); await expectAt(ui, list, end, n) }
    expect(end, 'reached the oldest').toBe(n)
    if (end - WINDOW > 0) { await ui.press({ key: 'tl-newer' }); end -= PAGE; await expectAt(ui, list, end, n) }
    await ui.press({ key: 'tl-less' })
    await expectAt(ui, list, PAGE, n)
    await ui.unmount()
  })
}

test('timeline: past the status\'s 160, Show older fetches the next ones from the core, with their details, until there are none', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const list = events(160), older = events(208).slice(160), calls: string[] = []
  let left = 2 // two fetches of 24, then the start of history
  const status = { ...healthy(), timeline: list }
  engine(on, { status: () => status, calls, run: (args: string) => {
    if (!/^timeline --before/.test(args)) return { value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    const from = 24 * (2 - left); left--
    const out = { events: older.slice(from, from + 24), episodes: [], more: left > 0 }
    return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  } })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let i = 0; i < 6; i++) await ui.press({ key: 'tl-more' })
  await expectAt(ui, list, 160, 160, '113–160 of 160 · more in history')
  await ui.press({ key: 'tl-more' })
  expect(calls.some(c => c.startsWith(`timeline --before ${list[159].ts}`)), 'asked for what is older than the oldest loaded').toBe(true)
  await expectAt(ui, [...list, ...older.slice(0, 24)], 184, 184, '137–184 of 184 · more in history')
  await ui.press({ key: 'tl-more' }) // the second fetch: the core says nothing older is left
  await expectAt(ui, [...list, ...older], 208, 208, '161–208 of 208 · the oldest')
  expect(await has(ui, 'tl-more')).toBe(false)
  await ui.unmount()
})

test('timeline: a fetch that fails keeps Show older for another try and says so, never "the oldest"', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const toasts: string[] = []
  const status = { ...healthy(), timeline: events(30), timelineMore: true }
  let fail = true
  engine(on, { status: () => status, toasts, run: (args: string) => {
    if (!/^timeline --before/.test(args)) return { value: { exitCode: 0, stdout: JSON.stringify(status), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: fail ? { exitCode: 1, stdout: 'boom', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } : { exitCode: 0, stdout: JSON.stringify({ events: events(54).slice(30), episodes: [], more: false }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  } })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  await ui.press({ key: 'tl-more' }) // 30 shown
  await ui.press({ key: 'tl-more' }) // the fetch fails
  expect(toasts.some(t => /Couldn't load older events/.test(t))).toBe(true)
  expect(await has(ui, 'tl-more'), 'still there to try again').toBe(true)
  expect(see(await ui.drawn()).texts).toContain('1–30 of 30 · more in history')
  fail = false
  await ui.press({ key: 'tl-more' })
  expect(see(await ui.drawn()).texts).toContain('7–54 of 54 · the oldest')
  await ui.unmount()
})

test('timeline: the list shrinking while far down snaps back inside it; an empty list says nothing negative', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  let n = 100
  engine(on, { status: () => ({ ...healthy(), timeline: events(n) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let i = 0; i < 4; i++) await ui.press({ key: 'tl-more' })
  n = 30; await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't-shrink' } as any)
  await expectAt(ui, events(30), 30, 30)
  n = 0; await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't-empty' } as any)
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(tilesOf(tree).length).toBe(0)
  expect(see(tree).texts.filter(t => /-\d+|of 0 ·/.test(t) && /older|oldest/.test(t))).toEqual([])
  await ui.unmount()
})

test('timeline: opening the panel again starts at the newest, so a state far down can never come back blank', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => ({ ...healthy(), timeline: events(160) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let i = 0; i < 4; i++) await ui.press({ key: 'tl-more' })
  await open($)
  expect(tilesOf(await ui.drawn())).toEqual(events(160).slice(0, PAGE).map(e => `tile-${e.id}`))
  expect(await has(ui, 'tl-less')).toBe(false)
  await ui.unmount()
})

test('timeline: an open tile stays open while it is drawn, leaves with the newest that drop off, and is open again on return', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => ({ ...healthy(), timeline: events(120).map((e, i) => ({ ...e, detail: `Detail ${i}. ${'more words '.repeat(30)}` })) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  const firstTx = ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)).find(k => /^tx-/.test(k))!
  await ui.press({ key: firstTx })
  const open = async () => ((await ui.findAll({ type: 'Text', text: 'Show less' })) as any[]).length
  await ui.press({ key: 'tl-more' })
  expect(await open(), 'still drawn: still open').toBe(1)
  for (let i = 0; i < 2; i++) await ui.press({ key: 'tl-more' })
  expect(await open(), 'dropped off the top').toBe(0)
  await ui.press({ key: 'tl-less' })
  expect(await open()).toBe(1)
  await ui.unmount()
})

test('drawing budget: the Timeline of a huge project stays well under what the desktop app handles, however far down', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => huge() })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(200), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let p = 0; p < 26 && (await has(ui, 'tl-more')); p++) {
    const s = see(await ui.drawn())
    expect(s.chars, `press ${p}`).toBeLessThan(400_000)
    expect(s.svgs.length, `press ${p}`).toBeLessThanOrEqual(140)
    await ui.press({ key: 'tl-more' })
  }
  await ui.unmount()
})

// ── the Activity chart: how many events, and how long their titles, one drawing can hold ─────────────────────────
// The engine refuses a tree with an Svg source over 131,072 characters, and then draws nothing at all for the pane.
test('timeline chart: its drawing must stay under the engine\'s Svg limit, whatever the events say', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  let cur: any[] = events(10)
  engine(on, { status: () => ({ ...healthy(), timeline: cur }) })
  await start($)
  let ui: any = await $.ui.mount({ ...pane(200), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  const rows: string[] = [], blank: string[] = []
  // 160 events is the CLI's cap; 400 characters its cap on a turn's words (a commit subject: 140). Escaping grows them:
  // a title of quotes or angle brackets is 4–6 times longer in the drawing's source.
  for (const [n, len, kind] of [[80, 90, 'words'], [160, 90, 'words'], [160, 400, 'real'], [160, 400, 'words'], [100, 400, 'json'], [160, 400, 'json'], [100, 400, 'quotes'], [160, 2000, 'words']] as [number, number, string][]) {
    // fresh ids per case: the chart is memoized by event ids, not by their titles
    cur = kind === 'real'
      // one busy week at the CLI's caps: 100 replies (400 characters of your words each), 50 commits (140), 10 handoffs
      ? events(160, 60, len).map((e, i) => ({ ...e, id: `r-${i}`, kind: i < 100 ? 'turn' : i < 150 ? 'commit' : 'handoff', title: e.title.slice(0, i < 100 ? 400 : i < 150 ? 140 : 70) }))
      : events(n, 60, len).map(e => ({ ...e, id: `${e.id}-${n}-${len}-${kind}`, ...(kind === 'quotes' ? { title: '"<&>"'.repeat(Math.ceil(len / 5)).slice(0, len) } : kind === 'json' ? { title: '{"name": "value", "list": [1, 2], "ok": true} '.repeat(Math.ceil(len / 46)).slice(0, len) } : {}) }))
    await open($)
    let size = -1
    try { const s = see(await ui.drawn()); size = Math.max(0, ...s.svgs.filter(x => /events:/.test(x.alt)).map(x => x.source.length)) } catch (err) {
      blank.push(`${n} events × ${len}-character ${kind} titles: ${msg(err)}`)
      // the pane is blank now and stays blank: its tabs are in the same drawing. Load a small list to get it back.
      cur = events(10); await open($); await ui.unmount().catch(() => undefined); ui = await $.ui.mount({ ...pane(200), surface: 'desktop' } as any)
    }
    rows.push(`${n}×${len} ${kind}: ${size < 0 ? 'PANE BLANK' : `${size} chars (${Math.round((100 * size) / SVG_MAX)}% of the limit)`}`)
  }
  console.log(`QA-CHART ${JSON.stringify(rows)}`)
  for (const b of blank) console.log(`QA-FINDING ${JSON.stringify({ test: 'timeline chart', what: `THROW the pane draws nothing: ${b}`, count: 1, where: ['desktop@200/tab-timeline'] })}`)
  await ui.unmount().catch(() => undefined)
  expect(blank, 'the pane went blank').toEqual([])
})

// ── the Costs tab's two views ────────────────────────────────────────────────────────────────────────────────────
test('costs & usage: two views, the choice is kept across tabs and mounts; Overview\'s "See all costs" lands on Costs, not Usage', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: quiet })
  await start($)
  const usage = (tree: unknown) => see(tree).texts.some(t => /^Usage: how you have used Claude/.test(t))
  for (const [surface, cols] of [['desktop', 120], ['terminal', 60], ['desktop', 40]] as const) {
    let ui: any = await $.ui.mount({ ...pane(cols), surface } as any)
    await ui.press({ key: 'tab-details' })
    expect(await has(ui, 'sub-costs')).toBe(true)
    expect(await has(ui, 'sub-usage')).toBe(true)
    await ui.press({ key: 'sub-usage' })
    let tree = await ui.drawn()
    expect(problems(tree)).toEqual([])
    expect(usage(tree)).toBe(true)
    await ui.press({ key: 'sub-usage' }) // pressing the view you are on changes nothing
    expect(JSON.stringify(await ui.drawn())).toBe(JSON.stringify(tree))
    await ui.press({ key: 'tab-overview' }); await ui.press({ key: 'tab-details' })
    expect(usage(await ui.drawn()), 'the view is remembered').toBe(true)
    await ui.unmount()
    ui = await $.ui.mount({ ...pane(cols), surface } as any)
    expect(usage(await ui.drawn()), 'and across mounts').toBe(true)
    await ui.press({ key: 'tab-overview' })
    await ui.press({ key: 'ov-costs' }) // "See all costs"
    tree = await ui.drawn()
    expect(see(tree).texts.some(t => /^Costs: what every message carries/.test(t)), 'See all costs opens the Costs view').toBe(true)
    expect(problems(tree)).toEqual([])
    await ui.unmount()
  }
})
test('costs & usage: a project with no replies yet says so on the Usage view, at every width', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on, { 'intro-seen-1': true })
  engine(on, { status: minimal, usage: null, turns: 0 })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) for (const cols of [40, 84, 200]) {
    const ui: any = await $.ui.mount({ ...pane(cols), surface } as any)
    await ui.press({ key: 'tab-details' }); await ui.press({ key: 'sub-usage' })
    const tree = await ui.drawn()
    expect(problems(tree)).toEqual([])
    expect(see(tree).texts.some(t => /Shows after your first replies/.test(t))).toBe(true)
    await ui.press({ key: 'sub-costs' })
    expect(problems(await ui.drawn())).toEqual([])
    await ui.unmount()
  }
})

// ── notifications ────────────────────────────────────────────────────────────────────────────────────────────────
const band = (cols?: number) => ({ ...BAND, props: cols ? { bodyColumns: cols } : {} })
function notifies(name: string, prefs: (p: any) => any, expectSound: string | null): void {
  test(`notify: a handoff saved shows a chip in the strip, one toast, ${expectSound ? `the sound ${expectSound}` : 'and no sound'} (${name})`, LONG_RUN, async ($, on) => {
    const clock = mock.clock(on, { now: Date.now() }); mock.store(on)
    const toasts: string[] = [], sounds: string[] = []
    engine(on, { status: () => { const s = quiet(); s.prefs = prefs(s.prefs); return s }, toasts, sounds })
    await start($)
    const strip: any = await $.ui.mount({ ...band(120), surface: 'desktop' } as any)
    expect(await has(strip, 'kc-flash'), 'no chip before anything happened').toBe(false)
    const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
    await ui.press({ key: 'tab-handoff' }); await ui.press({ key: 'kc-hand3' }) // Hand off now
    expect(toasts.length, `toasts: ${JSON.stringify(toasts)}`).toBe(1)
    expect(sounds, 'sounds').toEqual(expectSound ? [expectSound] : [])
    const chip = await strip.find({ key: 'kc-flash' })
    expect(chip, 'the chip is in the strip').toBeDefined()
    expect(chip.text).toMatch(/^Handoff saved/)
    expect(problems(await strip.drawn())).toEqual([])
    await clock.advance(7_000) // it clears itself
    expect(await has(strip, 'kc-flash'), 'the chip is gone after its few seconds').toBe(false)
    expect(problems(await strip.drawn())).toEqual([])
    await ui.unmount(); await strip.unmount()
  })
}
notifies('sound on', p => ({ ...p, sound: true }), 'sounds/done.wav')
notifies('sound off', p => ({ ...p, sound: false }), null)
notifies('the sound setting is missing: on by default', p => { const { sound, ...rest } = p; return rest }, 'sounds/done.wav')

test('notify: where toasts and sounds don\'t exist (the calls throw) the chip still shows and nothing is left unhandled', LONG_RUN, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: quiet, noToast: true, noAudio: true })
  await start($)
  const strip: any = await $.ui.mount({ ...band(120), surface: 'desktop' } as any)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' }); await ui.press({ key: 'kc-dream-checks' }) // Quick check
  expect((await strip.find({ key: 'kc-flash' }))?.text).toMatch(/^Quick check/)
  await clock.advance(7_000)
  expect(await has(strip, 'kc-flash')).toBe(false)
  await ui.unmount(); await strip.unmount()
})

test('notify: the chip fits a narrow strip (30 to 200 cells), the terminal strip says it in words, and the pane is not needed', LONG_RUN, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() }); mock.store(on)
  const toasts: string[] = []
  let running = true
  engine(on, { status: () => ({ ...quiet(), dream: { running: running ? { since: new Date().toISOString() } : null, recent: [dream(0, 4)] } }), toasts, usage: USAGE.full })
  await start($) // no pane mounted from here on
  running = false
  await open($) // the Dream that was running has ended: "Dream done · N to review"
  expect(toasts.filter(t => /Dream done/.test(t)).length, `toasts: ${JSON.stringify(toasts)}`).toBe(1)
  const bad: string[] = []
  for (const cols of [0, 30, 44, 60, 84, 120, 200]) {
    const strip: any = await $.ui.mount({ ...band(cols || undefined), surface: 'desktop' } as any)
    const tree = await strip.drawn()
    for (const p of problems(tree)) bad.push(`desktop strip @${cols}: ${p}`)
    const chip = await strip.find({ key: 'kc-flash' })
    if (!chip) bad.push(`desktop strip @${cols}: no chip while a notification shows`)
    else if (!/^Dream done/.test(chip.text)) bad.push(`desktop strip @${cols}: chip says "${chip.text}"`)
    // every drawing in the strip keeps a real width (the page lays it out from these numbers)
    for (const g of see(tree).svgs) { const w = Number(/width="([^"]*)"/.exec(g.source)?.[1]); if (!(w > 0) || w > 2000) bad.push(`desktop strip @${cols}: a drawing ${w} px wide (alt "${g.alt.slice(0, 40)}")`) }
    await strip.unmount()
    const term: any = await $.ui.mount({ ...band(cols || undefined), surface: 'terminal' } as any)
    const tt = see(await term.drawn())
    for (const p of problems(await term.drawn())) bad.push(`terminal strip @${cols}: ${p}`)
    if (!tt.texts.some(t => /Dream done/.test(t))) bad.push(`terminal strip @${cols}: the notification's words are missing`)
    await term.unmount()
  }
  for (const b of bad) console.log(`QA-FINDING ${JSON.stringify({ test: 'notify narrow strip', what: b, count: 1, where: [] })}`)
  await clock.advance(7_000)
  expect(bad).toEqual([])
})

test('notify: ten in a row leave one chip (the newest), which still clears; a refresh that keeps failing chimes once, not on every try', LONG_RUN, async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() }); mock.store(on)
  const toasts: string[] = [], sounds: string[] = []
  let fail = false, n = 0
  engine(on, { status: healthy, toasts, sounds, run: args => (fail && args === 'status --json'
    ? { value: { exitCode: 1, stdout: '', stderr: `Error: EBUSY: resource busy (attempt ${++n})`, isStdoutTruncated: false, isStderrTruncated: false } }
    : { value: { exitCode: 0, stdout: JSON.stringify(quiet()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) })
  await start($)
  const strip: any = await $.ui.mount({ ...band(120), surface: 'desktop' } as any)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-data' }); await ui.press({ key: 'sub-dream' })
  for (let i = 0; i < 10; i++) await ui.press({ key: 'kc-dream-checks' })
  expect(toasts.length).toBe(10)
  expect(((await strip.findAll({ key: 'kc-flash' })) as any[]).length).toBe(1)
  await clock.advance(7_000)
  expect(await has(strip, 'kc-flash')).toBe(false)
  // now every refresh fails, each time with slightly different words (a counter, a pid, a time)
  toasts.length = 0; sounds.length = 0; fail = true
  for (let i = 0; i < 6; i++) { await ui.press({ key: 'kc-refresh' }); await clock.advance(7_000) }
  console.log(`QA-NOTE ${JSON.stringify({ test: 'failing refresh', refreshes: 6, toasts: toasts.length, sounds: sounds.length })}`)
  expect(problems(await ui.drawn())).toEqual([])
  expect(toasts.length, 'one "couldn\'t refresh" for one outage, not one per try').toBe(1)
  await ui.unmount(); await strip.unmount()
})

test('notify: a Dream that ends with an error says so with the alert sound; one that ends with no report says nothing and throws nothing', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  const toasts: string[] = [], sounds: string[] = []
  let st: any = { ...quiet(), dream: { running: { since: new Date().toISOString() }, recent: [] } }
  engine(on, { status: () => st, toasts, sounds })
  await start($)
  st = { ...quiet(), dream: { running: null, recent: [dream(0, 2, 'failed', { error: 'model timed out' })] } }
  await open($)
  expect(toasts).toEqual(['Dream stopped · see Memory'])
  expect(sounds).toEqual(['sounds/alert.wav'])
  st = { ...quiet(), dream: { running: { since: new Date().toISOString() }, recent: [] } }; await open($)
  st = quiet(); await open($)
  expect(toasts.length).toBe(1)
})
