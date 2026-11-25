import type { Hook } from 'claude-code'

import type { StatusView, Tab } from '../types'
import { prettyModel } from './charts'
import { act, chooseProject, planLimits, readFail, readOff, refresh, refreshNow, refreshSoon, setSub, setTab, snapshot, statusOrSaved, toReview, type Dollar } from './data'
import { healthRing, icon } from './icons'
import { introPage, introSeen } from './intro'
import { kit } from './kit'
import { LOGO_SIZE, LOGO_SVG } from './logo'
import { overviewPage } from './overview'
import { settingsBody } from './settings'
import { dataPage, handoffPage } from './tabs'
import { costsPage } from './tabs-more'
import { K } from './theme'
import { readOlder, timelinePage } from './timeline'
import { switchDue } from './switch'
import { tipFor } from './tips'
import { readPulse } from './pulse'
import { beginPass, endPass, readSettle, settleSoon } from './anim'
import { safely, withinBudget } from './guard'
import { readLook } from './look'
import { readAsk } from './ask'

// The Cortex panel: a greeting header and six flat pages (Overview · Timeline · Memory · Handoff · Costs · Settings), so
// nothing is crammed onto one page. Transparent, so it follows Claude Code's light or dark mode. No timers.
type PaneEvent = Parameters<Hook<'ui.render'>>[1]
const PAGES: [Tab, string, string][] = [['overview', 'Overview', '1'], ['timeline', 'Timeline', '2'], ['data', 'Memory', '3'], ['handoff', 'Handoff', '4'], ['details', 'Costs', '5'], ['settings', 'Settings', '6']]
// tabs from older versions, kept in the app between sessions: each still opens a sensible page
const LEGACY: Partial<Record<Tab, [Tab, string]>> = { waiting: ['data', 'dream'], rules: ['data', 'files'], failed: ['data', 'files'], compactions: ['data', 'dream'] }

/** The last drawing and what it was drawn from. A redraw with the same inputs (the pane scrolled, the window moved)
 * returns the same tree, so nothing on screen reloads: no chart frame blinking, no scroll position lost. */
let memo: { key: string; tree: JSX.Element | null } = { key: '', tree: null }
/** Each input's text form, kept per object: the engine asks for a drawing on every scroll tick, and the big status
 * object is the same one between refreshes, so it is turned into text once per refresh, not once per tick. */
const texts = new WeakMap<object, string>()
const sig = (x: unknown): string => {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? ''
  let t = texts.get(x)
  if (t === undefined) { t = JSON.stringify(x); texts.set(x, t) }
  return t
}

const greet = (name: string) => {
  const h = new Date().getHours()
  return `${h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}${name ? `, ${name}` : ''}`
}

export async function renderPane($: Dollar, e: PaneEvent): Promise<JSX.Element> {
  const pulse = await readPulse($) // the heartbeat: time-driven changes (cache, plan reset, day) redraw without a turn
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const u = kit(els, e.surface)
  const snap = await snapshot($)
  const s: StatusView | null = await statusOrSaved($)
  const { l, cv, msg, hist, ph, vw } = snap
  const cols = (e as { props?: { bodyColumns?: number } }).props?.bodyColumns ?? 60
  const bodyRows = (e as { props?: { scroll?: { bodyRows?: number } } }).props?.scroll?.bodyRows ?? 40
  const px = Math.max(220, Math.min(1400, cols * 7.2))
  const failed = await readFail($)
  const { o, dir } = await readOff($)
  /** The last action's note as a status chip: an icon that says how it went, then its words (a tick and "Saved",
   * a pending dot and "Saving the handoff…", an amber alert and the error). Tinted, borderless, like a badge. */
  const statusChip = (m: string) => {
    const working = /…$/.test(m), failed = !working && /^(?:Couldn'?t|Could not)|: (?!done$).+/.test(m) && !/^(?:Handoff saved|Refreshed at|Turned (?:off|on))/.test(m)
    const [ic, c] = working ? ['pending', K.silver] : failed ? ['alert', K.amber] : ['check', K.emerald]
    return (
      <Box key="kc-status" flexDirection="row" gap={1} alignItems="center" backgroundColor={`${c}1F`} paddingX={1} flexShrink={1}>
        {u.Svg ? <u.Svg key="kc-status-i" source={icon(ic, c, 12)} alt={working ? 'Working' : failed ? 'Needs a look' : 'Done'} width={12} height={12} /> : null}
        <Text size="caption" weight="medium" color={failed ? K.amber : working ? K.label : K.text} wrap="truncate-end">{m.replace(/^Refreshed at /, 'Refreshed ')}</Text>
      </Box>
    )
  }
  const shell = (children: (JSX.Element | null)[]) => <Box flexDirection="column" gap={1} padding={1}>{children}</Box>

  if (!s && o?.error) {
    const { Link } = els as unknown as { Link?: (p: { key: string; href: string; label: string }) => JSX.Element }
    return shell([u.big('t', 'Kapex Cortex'), u.body('e', o.error), Link ? <Link key="kc-node" href="https://nodejs.org/en/download" label="Download Node.js" /> : u.muted('n', 'nodejs.org/en/download'), u.muted('h', 'Install it, then restart Claude Code. Cortex needs nothing else.')])
  }
  if (!s && o) {
    const here = o.cwd.split('/').pop()
    const near = o.nearby
    return shell([
      u.big('t', 'Kapex Cortex'),
      u.label('w', `Cortex isn't on in ${here}.${near.length ? ' These folders inside it have it:' : ' One press sets it up.'}`),
      near.length ? <Box key="nb" flexDirection="row" gap={1} flexWrap="wrap">{near.map(n => <Button key={`kc-near-${n}`} variant="primary" onPress={() => { void chooseProject($, `${o.cwd}/${n}`) }}>{`Show ${n}`}</Button>)}</Box> : null,
      <Button key="kc-on" variant={near.length ? 'secondary' : 'primary'} onPress={() => { void act($, 'Turning on', ['i']) }}>{near.length ? `Turn on Cortex in ${here} too` : 'Turn on Cortex'}</Button>,
      msg ? u.muted('m', msg) : null,
    ])
  }
  if (!s) {
    // loading: quiet placeholder shapes (no animation), and one refresh started by drawing
    refreshSoon($)
    const ph1 = (key: string, w: string, rows: number) => <Box key={key} width={w} height={rows} backgroundColor={K.card} borderStyle="round" borderColor={K.cardEdge} />
    return shell([
      u.big('t', 'Kapex Cortex'),
      u.muted('ld', failed ? `Couldn't load: ${failed}` : 'Loading your project…'),
      failed ? <Button key="kc-retry" onPress={() => { void refresh($) }}>Retry</Button> : null,
      <Box key="sk" flexDirection="row" flexWrap="wrap" gap={1}>{ph1('sk1', '32%', 8)}{ph1('sk2', '66%', 8)}{ph1('sk3', '32%', 6)}{ph1('sk4', '32%', 6)}{ph1('sk5', '32%', 6)}</Box>,
    ])
  }

  const { limits, at: limitsAt } = await planLimits($, l)
  const legacy = LEGACY[snap.chosen as Tab]
  // Handoff and Costs used to be sub-pages of the Memory tab: a stored 'data' + 'handoff' / 'details' opens them
  const moved = snap.chosen === 'data' && (vw.sub === 'handoff' || vw.sub === 'details') ? vw.sub as Tab : null
  const page: Tab = moved ?? (legacy ? legacy[0] : (snap.chosen as Tab) || 'overview')
  if (legacy) { void setTab($, legacy[0]); if (vw.sub !== legacy[1]) void setSub($, legacy[1]) } // once: the stored tab becomes the new one
  if (moved) { void setTab($, moved); void setSub($, 'dream') }
  const waiting = toReview(s)
  const over = s.native.files.filter(f => f.over && f.loads === 'first-200').length
  // the headline below says how things stand; the header only adds what it can't (a refresh that failed, a file too long)
  const needs = [over ? `${over} memory file${over === 1 ? '' : 's'} too long` : '', failed ? 'Couldn\'t refresh' : ''].filter(Boolean)
  const intro = !(await introSeen($, s, vw))
  const lk = await readLook($) // read while drawing, so a Look press redraws Settings
  const asked = await readAsk($) // a panel prompt waiting for your choice (ask.tsx)
  const older = page === 'timeline' ? await readOlder($) : null // what Show older fetched past the status's 160
  // Only what the open page and the header draw: while Claude works, the live context number changes every 4 s, and
  // the Timeline (which doesn't show it) must not be rebuilt under your scroll for it. Overview depends on all of it.
  const head = [s.name, s.project, l?.model, s.git?.branch, dir, o?.cwd, over, failed, msg, waiting, asked?.id ?? '']
  const pageIn = intro ? [vw, bodyRows]
    : page === 'timeline' ? [sig(s.timeline), sig(s.episodes), sig(older), vw.expanded, vw.more?.timeline ?? 0, Math.ceil(Date.now() / 600_000), new Date().toDateString()]
    : page === 'settings' ? [sig(s), cols >= 120, sig(lk)]
    : page === 'data' ? [sig(s), sig(vw)]
    : page === 'handoff' ? [sig(s), sig(vw), Math.round((l?.context.tokens ?? 0) / 1000)]
    : [sig(s), sig(snap.l), sig(snap.cv), sig(snap.hist), sig(snap.ph), sig(vw), sig(limits), limitsAt, sig(o), page === 'details' ? Math.floor(Date.now() / 60_000) : 0]
  const key = [e.surface, cols, page, pulse, await readSettle($), new Date().getHours(), sig(head), ...pageIn.map(x => (typeof x === 'string' ? x : sig(x)))].join('\u0001')
  // the armed render (just opened, or Refresh pressed) is drawn fresh and may animate; any other with the same inputs reuses the last tree
  const armed = beginPass()
  if (!armed && memo.key === key && memo.tree) return memo.tree
  const metaTags = [
    u.tag('m-model', 'model', K.emerald, prettyModel(l?.model ?? '?')),
    s.git ? u.tag('m-branch', 'branch', K.silver, s.git.branch) : null,
    dir && o ? u.tag('m-dir', 'file', K.silver, `chat in ${o.cwd.split('/').pop()}`) : null,
  ]
  const tip = tipFor(s, l, cv, limits, switchDue(s, l, cv, vw)) // derived from inputs already in the key: computed only on a real redraw
  const ctx = { els, u, s, l, current: page, wip: s.git?.wip, five: limits.find(x => x.kind === 'five_hour'), px, vw, asked }
  // a page that throws shows why and a way back, never a blank pane (the other tabs keep working)
  const built = safely(() => intro ? introPage($, els, u, vw, px, bodyRows)
    : page === 'timeline' ? timelinePage($, els, u, s, vw, px, older)
    : page === 'data' ? dataPage($, ctx)
    : page === 'handoff' ? handoffPage($, ctx)
    : page === 'details' ? costsPage($, ctx)
    : page === 'settings' ? settingsBody($, els, u, s, cols >= 120, lk)
    : overviewPage($, els, u, { s, l, cv, hist, ph, vw, limits, limitsAt, tip, cols, px }))
  const body = built.ok ? built.tree : (
    <Box key="kc-broken" flexDirection="column" gap={1} padding={1} backgroundColor={K.card}>
      <Text weight="semibold" color={K.amber}>This page couldn't be drawn</Text>
      <Text size="caption" color={K.label}>{`${built.why}. The other pages still work.`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="kc-broken-home" variant="primary" onPress={() => { void setTab($, 'overview') }}>Go to Overview</Button>
        <Button key="kc-broken-retry" variant="secondary" onPress={() => { void refreshNow($) }}>Refresh</Button>
      </Box>
    </Box>
  )
  if (!built.ok) void logPaneError($, `${page}: ${built.why}`)

  // six tabs on one line where they fit, else three and three (never five and a lonely one)
  const tabBtn = ([t, label, hk]: [Tab, string, string]) => <Button key={`tab-${t}`} hotkey={hk} variant={page === t ? 'primary' : 'secondary'} onPress={() => { void setTab($, t) }}><Text color={page === t ? K.emerald : undefined} weight={page === t ? 'semibold' : undefined}>{t === 'details' && cols >= 100 ? 'Costs & usage' : label}</Text>{t === 'data' && waiting ? <Text color={K.amber} weight="semibold">{cols >= 100 ? ` · ${waiting} to review` : ' ●'}</Text> : null}</Button>
  // narrow panes get even rows, never a tab past the edge: one row, then three and three, then two by two
  const per = cols >= 80 ? 6 : cols >= 58 ? 3 : 2
  const nav = per === 6
    ? <Box key="nav" flexDirection="row" gap={1} flexWrap="wrap">{PAGES.map(tabBtn)}</Box>
    : <Box key="nav" flexDirection="column" gap={1}>{Array.from({ length: Math.ceil(PAGES.length / per) }, (_, r) => <Box key={`nav-${r}`} flexDirection="row" gap={1} flexWrap="wrap">{PAGES.slice(r * per, r * per + per).map(tabBtn)}</Box>)}</Box>
  const tree = (
    <Box flexDirection="column" gap={2} padding={1}>
      <Box key="hdr" flexDirection="row" gap={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
        <Box flexDirection="row" gap={2} alignItems="center">
          {u.Svg ? <u.Svg key="kc-logo" source={LOGO_SVG} alt="Kapex Cortex" width={LOGO_SIZE + 14} height={LOGO_SIZE + 14} /> : null}
          <Box flexDirection="column" gap={0}>
            <Text size="heading" weight="semibold" color={K.text}>{s.name ? greet(s.name) : s.project}</Text>
            <Box flexDirection="row" gap={2} flexWrap="wrap">{s.name ? u.tag('m-proj', 'folder', K.emerald, s.project) : null}{metaTags}</Box>
          </Box>
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          {needs.length && u.Svg ? <u.Svg key="kc-health" source={healthRing(false)} alt="Needs you" width={18} height={18} /> : null}
          {needs.length ? <Text size="caption" weight="medium" color={K.amber}>{needs.join(' · ')}</Text> : null}
          {msg ? statusChip(msg) : null}
          <Button key="kc-refresh" hotkey="r" variant="secondary" onPress={() => { void refreshNow($) }}>Refresh</Button>
        </Box>
      </Box>

      {intro ? null : nav}

      {body}
    </Box>
  )
  // kept under the sizes the desktop app handles (guard.ts): past them, the lowest drawings become their words
  const safe = withinBudget(tree, (k, alt) => <Text key={k} size="caption" color={K.muted}>{alt}</Text>, undefined, (k, cols) => <Box key={k} width={cols} flexShrink={0} />) as JSX.Element
  // a tree with animated drawings is never reused, and a redraw shortly after swaps in the same charts, still
  if (endPass()) { memo = { key: '', tree: null }; settleSoon($) } else memo = { key, tree: safe }
  return safe
}

/** A page that failed to draw, in .vault/private/errors.log (as the hooks log theirs), so it can be reported and fixed. */
async function logPaneError($: Dollar, why: string): Promise<void> {
  try {
    const p = '.vault/private/errors.log'
    const old = (await $.fs.exists(p)) ? String(await $.fs.read(p)).slice(-60_000) : ''
    await $.fs.write(p, `${old}${new Date().toISOString()} panel ${why}\n`)
  } catch { /* logging never breaks the pane */ }
}
