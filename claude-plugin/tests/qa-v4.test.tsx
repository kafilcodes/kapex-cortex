import { expect, mock, test } from 'claude-code/testing'

import { BAND, dream, engine, events, healthy, minimal, pane, problems, quiet, see, SVG_MAX, USAGE } from './qa-fixtures'

// QA for what v4.0 added: Timeline paging (tl-more / tl-less and the "N older events not shown" count), the Costs
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

// ── Timeline paging ──────────────────────────────────────────────────────────────────────────────────────────────
for (const n of [0, 1, 24, 25, 48, 49, 160]) {
  test(`paging: ${n} events: each press adds 24 (or the rest), the count says what is still hidden, the end has no button, Back to newest returns`, LONG_RUN, async ($, on) => {
    mock.clock(on, { now: Date.now() }); mock.store(on)
    engine(on, { status: () => ({ ...healthy(), timeline: events(n) }) })
    await start($)
    for (const surface of ['desktop', 'terminal'] as const) {
      const ui: any = await $.ui.mount({ ...pane(120), surface } as any)
      await ui.press({ key: 'tab-timeline' })
      if (await has(ui, 'tl-less')) await ui.press({ key: 'tl-less' }) // the other surface paged back: start from the newest
      let shown = Math.min(n, PAGE), presses = 0
      for (;;) {
        const tree = await ui.drawn()
        expect(problems(tree), `${surface}, ${shown} of ${n} shown`).toEqual([])
        const ids = tilesOf(tree)
        expect(ids.length, `${surface}: tiles drawn after ${presses} presses`).toBe(shown)
        expect(ids, 'newest first, none twice').toEqual(events(n).slice(0, shown).map(e => `tile-${e.id}`))
        const hidden = n - shown
        if (hidden > 0) {
          expect(await textOf(ui, 'tl-more')).toBe(hidden > PAGE ? 'Show 24 older' : `Show the last ${hidden} older`)
          expect(await countOf(ui)).toBe(`${hidden} older event${hidden === 1 ? '' : 's'} not shown`)
        } else {
          expect(await has(ui, 'tl-more'), 'no Show older at the end').toBe(false)
          if (presses) expect(await countOf(ui)).toBe(`All ${n} events shown`)
          else expect(await countOf(ui), 'nothing to page: no count either').toBe('')
        }
        expect(await has(ui, 'tl-less'), 'Back to newest only after paging').toBe(presses > 0)
        if (hidden <= 0) break
        await ui.press({ key: 'tl-more' }); presses++
        shown = Math.min(n, shown + PAGE)
      }
      expect(presses).toBe(Math.max(0, Math.ceil((n - PAGE) / PAGE)))
      // past the end: there is nothing to press
      await expect(ui.press({ key: 'tl-more' })).rejects.toBeDefined()
      if (presses) {
        await ui.press({ key: 'tl-less' })
        expect(tilesOf(await ui.drawn()).length).toBe(Math.min(n, PAGE))
        expect(await has(ui, 'tl-less')).toBe(false)
        expect(await has(ui, 'tl-more')).toBe(n > PAGE)
      }
      await ui.unmount()
    }
  })
}

test('paging: the list shrinks or grows while you are paged back (a refresh): the count stays true, nothing is negative', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  let n = 160
  engine(on, { status: () => ({ ...healthy(), timeline: events(n) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  for (let i = 0; i < 6; i++) await ui.press({ key: 'tl-more' }) // 168 asked for, 160 there
  expect(await countOf(ui)).toBe('All 160 events shown')
  n = 30; await open($) // the journal was trimmed (or another project was chosen)
  let tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(tilesOf(tree).length).toBe(30)
  expect(await countOf(ui)).toBe('All 30 events shown')
  expect(await has(ui, 'tl-more')).toBe(false)
  n = 400; await open($)
  tree = await ui.drawn()
  expect(tilesOf(tree).length).toBe(168)
  expect(await countOf(ui)).toBe('232 older events not shown')
  n = 0; await open($)
  tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(tilesOf(tree).length).toBe(0)
  expect(see(tree).texts.filter(t => /-\d+ older|All 0 events shown/.test(t)), 'an empty list does not say "All 0 events shown"').toEqual([])
  await ui.unmount()
})

test('paging: an open tile stays open across Show older, and the open tile on an older page is closed cleanly by Back to newest', LONG_RUN, async ($, on) => {
  mock.clock(on, { now: Date.now() }); mock.store(on)
  engine(on, { status: () => ({ ...healthy(), timeline: events(60).map((e, i) => ({ ...e, detail: `Detail ${i}. ${'more words '.repeat(30)}` })) }) })
  await start($)
  const ui: any = await $.ui.mount({ ...pane(120), surface: 'desktop' } as any)
  await ui.press({ key: 'tab-timeline' })
  const firstTx = ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)).find(k => /^tx-/.test(k))!
  await ui.press({ key: firstTx })
  await ui.press({ key: 'tl-more' })
  expect(((await ui.findAll({ type: 'Text', text: 'Show less' })) as any[]).length).toBe(1)
  const lastTx = ((await ui.findAll({ type: 'Button' })) as any[]).map(b => String(b.key)).filter(k => /^tx-/.test(k)).pop()!
  await ui.press({ key: lastTx }) // a tile only the second page shows
  await ui.press({ key: 'tl-less' })
  const tree = await ui.drawn()
  expect(problems(tree)).toEqual([])
  expect(tilesOf(tree).length).toBe(24)
  expect(((await ui.findAll({ type: 'Text', text: 'Show less' })) as any[]).length).toBe(0)
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
