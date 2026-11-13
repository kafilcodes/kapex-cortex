import type { Hook } from 'claude-code'

import type { StatusView, Tab } from '../types'
import { k, prettyModel } from './charts'
import { act, chooseProject, planLimits, readFail, readOff, refresh, refreshNow, refreshSoon, setSub, setTab, snapshot, statusOrSaved, toReview, type Dollar } from './data'
import { healthRing } from './icons'
import { introPage, introSeen } from './intro'
import { kit } from './kit'
import { LOGO_SIZE, LOGO_SVG } from './logo'
import { overviewPage } from './overview'
import { settingsBody } from './settings'
import { dataPage } from './tabs'
import { K } from './theme'
import { timelinePage } from './timeline'
import { switchDue } from './switch'
import { tipFor } from './tips'
import { readPulse } from './pulse'

// The Cortex panel: a greeting header and four pages (Overview · Timeline · Dream & Memory · Settings), so nothing is
// crammed onto one page. Transparent, so it follows Claude Code's light or dark mode. No timers.
type PaneEvent = Parameters<Hook<'ui.render'>>[1]
const PAGES: [Tab, string, string][] = [['overview', 'Overview', '1'], ['timeline', 'Timeline', '2'], ['data', 'Dream & Memory', '3'], ['settings', 'Settings', '4']]
const LEGACY: Partial<Record<Tab, [Tab, string]>> = { waiting: ['data', 'dream'], rules: ['data', 'files'], failed: ['data', 'files'], handoff: ['data', 'handoff'], compactions: ['data', 'dream'], details: ['data', 'details'] }

/** The last drawing and what it was drawn from. A redraw with the same inputs (the pane scrolled, the window moved)
 * returns the same tree, so nothing on screen reloads: no chart frame blinking, no scroll position lost. */
let memo: { key: string; tree: JSX.Element | null } = { key: '', tree: null }

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
    const ph1 = (key: string, w: string, rows: number) => <Box key={key} width={w} height={rows} backgroundColor={K.card} borderStyle="round" borderColor={K.hairline} />
    return shell([
      u.big('t', 'Kapex Cortex'),
      u.muted('ld', failed ? `Couldn't load: ${failed}` : 'Loading your project…'),
      failed ? <Button key="kc-retry" onPress={() => { void refresh($) }}>Retry</Button> : null,
      <Box key="sk" flexDirection="row" flexWrap="wrap" gap={1}>{ph1('sk1', '32%', 8)}{ph1('sk2', '66%', 8)}{ph1('sk3', '32%', 6)}{ph1('sk4', '32%', 6)}{ph1('sk5', '32%', 6)}</Box>,
    ])
  }

  const { limits, at: limitsAt } = await planLimits($, l)
  const tip = tipFor(s, l, cv, limits, switchDue(s, l, cv, vw))
  const legacy = LEGACY[snap.chosen as Tab]
  const page: Tab = legacy ? legacy[0] : (snap.chosen as Tab) || 'overview'
  if (legacy && vw.sub !== legacy[1]) void setSub($, legacy[1])
  const waiting = toReview(s)
  const over = s.native.files.filter(f => f.over && f.loads === 'first-200').length
  const needs = [waiting ? `${waiting} to review` : '', s.dream.running ? 'dreaming' : '', over ? 'memory over its limit' : '', failed ? 'refresh failed' : ''].filter(Boolean)
  const metaTags = [
    u.tag('m-model', 'model', K.emerald, prettyModel(l?.model ?? '?')),
    s.git ? u.tag('m-branch', 'branch', K.silver, s.git.branch) : null,
    u.tag('m-mem', 'rule', K.silver, `${k(s.native.alwaysTokens)} memory tokens`),
    s.opencode.plugin && cols >= 100 ? u.tag('m-oc', 'link', K.silver, 'OpenCode ready') : null, // narrow: it wrapped alone onto a line
    dir && o ? u.tag('m-dir', 'file', K.silver, `chat in ${o.cwd.split('/').pop()}`) : null,
  ]
  const intro = !(await introSeen($, s, vw))
  const key = JSON.stringify([e.surface, cols, intro ? bodyRows : 0, pulse, snap, s, failed, o, dir, limits, limitsAt, new Date().getHours()])
  if (memo.key === key && memo.tree) return memo.tree
  const body = intro ? introPage($, els, u, vw, px, bodyRows)
    : page === 'timeline' ? timelinePage($, els, u, s, vw, px)
    : page === 'data' ? dataPage($, { els, u, s, l, current: page, wip: s.git?.wip, five: limits.find(x => x.kind === 'five_hour'), px, vw })
    : page === 'settings' ? settingsBody($, els, u, s, cols >= 120)
    : overviewPage($, els, u, { s, l, cv, hist, ph, vw, limits, limitsAt, tip, cols, px })

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
          {u.Svg ? <u.Svg key="kc-health" source={healthRing(!needs.length)} alt={needs.length ? 'Needs you' : 'All good'} width={18} height={18} /> : null}
          <Text size="caption" weight="medium" color={needs.length ? K.amber : K.emerald}>{needs.length ? needs.join(' · ') : 'All good'}</Text>
          {msg ? <Text size="caption" color={K.muted}>{msg}</Text> : null}
          <Button key="kc-refresh" hotkey="r" variant="secondary" onPress={() => { void refreshNow($) }}>Refresh</Button>
        </Box>
      </Box>

      {intro ? null : <Box key="nav" flexDirection="row" gap={1} flexWrap="wrap">
        {PAGES.map(([t, label, key]) => <Button key={`tab-${t}`} hotkey={key} variant={page === t ? 'primary' : 'secondary'} onPress={() => { void setTab($, t) }}><Text color={page === t ? K.emerald : undefined} weight={page === t ? 'semibold' : undefined}>{t === 'data' && waiting ? `${label} · ${waiting}` : label}</Text></Button>)}
      </Box>}

      {body}

      {u.muted('tip', 'Minimize the panel to hide it.')}
    </Box>
  )
  memo = { key, tree }
  return tree
}
