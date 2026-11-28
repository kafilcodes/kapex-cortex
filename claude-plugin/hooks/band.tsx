import type { Hook } from 'claude-code'

import { cacheState, clock } from './charts'
import { act, copyResume, handedOff, handOff, openPane, planLimits, readFail, refresh, refreshNow, refreshSoon, setCostsSub, setFlow, setSub, setTab, snapshot, statusOrSaved, toReview, type Dollar } from './data'
import type { Tip } from './tips'
import { switchDue } from './switch'
import { tipFor } from './tips'
import { kit } from './kit'
import { drainHeat, heat, HEAT, K, RESUME } from './theme'
import { flaggedNotes } from './switch'
import { readPulse } from './pulse'
import { readFlash, type FlashKind } from './notify'
import { putInBox } from './ask'
import { MARK_AMBER, stripLevels, stripView, type StripModel, type StripMsg } from './strip'
export { drainSteps } from './strip'

/** How each kind of notification looks in the strip. */
const FLASH: Record<FlashKind, { icon: string; color: string; alt: string }> = { done: { icon: 'check', color: K.emerald, alt: 'Done' }, dream: { icon: 'dream', color: K.sage, alt: 'Memory check done' }, alert: { icon: 'alert', color: K.amber, alt: 'Needs a look' } }

// The status strip above the prompt, like a phone's status bar: what Claude Code doesn't show you at a glance. One
// line, never wrapping: the logo, the chat's vitals (context and cache; the plan is in Claude Code's own prompt box), one message (the tip that matters
// now, a notification for a few seconds, or "All good"), and Open Cortex at the far right. strip.tsx draws it.
type BandEvent = Parameters<Hook<'ui.render'>>[1]

const ACTION_LABEL: Record<string, string> = { handoff: 'Hand off', dream: 'Memory check', review: 'Review', costs: 'Costs', resume: 'Resume', memory: 'Fix' }

/** A tip as the strip's message. With a button, the words are only the reason: the button says the verb. */
export function tipMessage(t: Tip): StripMsg {
  const reason = (x: string) => {
    if (!t.action) return x
    const parts = x.split(' · ').filter(p => !/^handoff suggested$/i.test(p.trim())).map(p => p.replace(/ to review$/, ''))
    // a short form left as a bare saving ("~162k") says what it is: "Saves ~162k"
    const r = parts.join(' · ').replace(/^(~[\d.]+[kKmM]?)$/, 'saves $1')
    return r ? r.charAt(0).toUpperCase() + r.slice(1) : ''
  }
  const ink = t.level === 'act' ? 'error' : t.level === 'warn' ? 'warning' : 'text'
  const mark = t.level === 'act' ? t.color : t.level === 'warn' ? MARK_AMBER : K.emerald
  const icon = t.action === 'review' ? 'dream' : t.action === 'memory' ? 'alert' : 'suggest'
  return { icon, mark, ink, text: reason(t.text) || t.text, short: reason(t.short ?? t.text) || reason(t.text) || t.text, alt: `${t.text}. ${t.detail}`,
    ...(t.action ? { action: { label: ACTION_LABEL[t.action] ?? 'Open', primary: t.level === 'act' } } : {}),
    ...(t.action === 'review' || t.action === 'memory' || t.action === 'dream' ? { keep: true } : {}) }
}

/** One press from the strip. Hand off saves the handoff and copies /cortex-resume (memory flagged by a check is shown
 * first); Dream starts one in the background (it only proposes); the others open the panel where the decision is. */
async function doTip($: Dollar, action: string, s: NonNullable<Awaited<ReturnType<typeof statusOrSaved>>>): Promise<void> {
  if (action === 'resume') { await putInBox($, RESUME); return } // into the message box, never sent by itself
  if (action === 'handoff') {
    await setTab($, 'overview')
    if (flaggedNotes(s)) await setFlow($, 'confirm'); else await handOff($)
  } else if (action === 'dream') { await setTab($, 'data'); await setSub($, 'dream'); void act($, 'Full check started', ['dream']) }
  else if (action === 'review') { await setTab($, 'data'); await setSub($, 'dream') }
  else if (action === 'costs') { await setTab($, 'details'); await setCostsSub($, 'costs') }
  else if (action === 'memory') { await setTab($, 'data'); await setSub($, 'files') }
  await openPane($)
}

/** A folder without Cortex, as last found (60 s): the strip steps aside at once, without reading state or files. */
let notHere = 0
/** The strip's arrangement, kept while what it depends on is the same: the strip is drawn again often (each heartbeat,
 * each state write), and measuring it again each time is work for nothing. */
let levelsMemo: { key: string; levels: ReturnType<typeof stripLevels> | null } = { key: '', levels: null }

export async function renderBand($: Dollar, e: BandEvent, next: (e: BandEvent) => unknown): Promise<unknown> {
  if (Date.now() - notHere < 60_000) return next(e)
  const fl = await readFlash($) // a notification chip, while it shows (notify.ts)
  await readPulse($) // read so the heartbeat's changes (cache cooling, a plan reset) redraw the strip without a turn
  const { l, cv, vw } = await snapshot($)
  const s = await statusOrSaved($) // after a restart or an app update: the last good status at once, refreshed behind it
  const failed = await readFail($)
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const u = kit(els, e.surface)
  const waiting = toReview(s)
  const open = () => { if (waiting) { void setTab($, 'data'); void setSub($, 'dream') } void openPane($) }
  if (!s) {
    // nothing loaded yet: if this folder uses Cortex, say so and load, never an empty strip
    const here = (await $.fs.exists('.vault/cortex.json').catch(() => false)) || (await $.fs.exists('.vault/ledger.jsonl').catch(() => false))
    if (!here) { notHere = Date.now(); return next(e) }
    refreshSoon($)
    return (
      <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between" width="100%">
        <Text size="caption" color={failed ? 'warning' : K.muted}>{failed ? `Cortex couldn't load: ${failed}` : 'Cortex is loading…'}</Text>
        <Box flexDirection="row" gap={1}>
          {failed ? <Button key="kc-retry" plain onPress={() => { void refresh($) }}>Retry</Button> : null}
          <Button key="kc-open" plain onPress={open}>Open Cortex</Button>
        </Box>
      </Box>
    )
  }
  if (!l) refreshSoon($)
  const rows = l?.context.rows ?? []
  const win = l?.context.window ?? 1
  const buffer = rows.find(r => /autocompact/i.test(r.name))?.tokens ?? 0
  const ttlMs = cv.ttl === '1h' ? 3_600_000 : 300_000
  const cs = cacheState(cv.lastAt, ttlMs)
  const { limits } = await planLimits($, l)
  const sw = switchDue(s, l, cv, vw)
  const tip = tipFor(s, l, cv, limits, sw)
  const ctx = l?.context.percent ?? null
  const compactAt = buffer ? (win - buffer) / win : undefined
  // the ring turns as the chat fills (60% warning, 80% high, 90% critical), and earlier when Claude's own
  // summarizing point is near: whichever says more
  const RANK = [HEAT.ok, HEAT.warn, HEAT.high, HEAT.bad]
  const near = (gap: number) => compactAt !== undefined && ctx !== null && ctx / 100 >= compactAt - gap
  const ctxColor = RANK[Math.max(RANK.indexOf(heat((ctx ?? 0) / 100)), RANK.indexOf(near(0.05) ? HEAT.bad : near(0.15) ? HEAT.high : HEAT.ok))]!
  const share = cs.leftMin / (ttlMs / 60_000)
  const handoff = s.handoff.ready ? 'ready' : s.handoff.exists ? 'saved' : 'none'
  const fk = fl ? FLASH[fl.kind] : null
  const gone = handedOff(vw, l)
  const msg: StripMsg = fl && fk ? { icon: fk.icon, mark: fk.color === K.amber ? MARK_AMBER : fk.color, ink: fl.kind === 'alert' ? 'warning' : 'text', text: fl.text, short: fl.text.split(' · ')[0]!, alt: fk.alt, keep: true, flash: `${fk.color}24` }
    // just handed off: say where to paste, never suggest the handoff again until a reply here (v4.6)
    : gone ? { icon: 'check', mark: K.emerald, ink: 'text', text: 'Handoff saved · paste /cortex-resume in a new chat', short: 'Handoff saved', alt: 'The handoff is saved and /cortex-resume is on your clipboard: paste it in a new chat (+ New). Copy again puts it back on the clipboard.', action: { label: 'Copy again', primary: false }, keep: true }
    : tip ? tipMessage(tip)
    : handoff === 'ready' ? { icon: 'link', mark: K.emerald, ink: 'text', text: 'Handoff ready', short: 'Handoff ready', alt: 'A handoff is ready: a new chat continues with /cortex-resume', keep: true }
    : { icon: 'check', mark: K.emerald, ink: 'text', text: handoff === 'saved' ? 'All good · handoff saved' : 'All good', short: 'All good', alt: handoff === 'saved' ? 'All good, and the handoff is saved' : 'All good', keep: true }
  const m: StripModel = {
    ctx, ctxColor, msg, waiting, failed: !!failed,
    cache: { share, sec: cs.leftMin * 60, until: cs.state === 'unknown' || cs.state === 'cold' ? null : clock(cs.until!), state: cs.state === 'unknown' ? 'unknown' : cs.state === 'cold' ? 'cold' : 'warm', color: cs.state === 'unknown' ? K.ink : drainHeat(share), stepped: cs.state !== 'unknown' },
  }
  // words for screen readers and the terminal strip: every fact, said once
  const cacheText = cs.state === 'unknown' ? 'cache starts on reply' : cs.state === 'cold' ? 'cache cold' : `cache warm till ${clock(cs.until!)}`
  const words = [ctx !== null ? `chat ${ctx}% full` : '', cacheText, handoff === 'ready' ? 'handoff ready' : '', waiting ? `${waiting} to review` : ''].filter(Boolean).join(' · ')
  if (!u.Svg) return <Box flexDirection="row" gap={1} alignItems="center" justifyContent="space-between"><Text size="caption" color={waiting || (tip && tip.level !== 'ok') || fl?.kind === 'alert' ? 'warning' : undefined}>{`Cortex · ${fl ? `${fl.text} · ` : ''}${tip ? `${tip.text} · ` : ''}${words}`}</Text><Box flexDirection="row" gap={1}><Button key="kc-refresh" plain onPress={() => { void refreshNow($) }}>↻</Button><Button key="kc-open" plain onPress={open}>Open Cortex</Button></Box></Box>
  // the arrangement that fits, kept while what it depends on is the same (the strip is drawn again often)
  const cols = (e as { props?: { bodyColumns?: number } }).props?.bodyColumns
  const room = cols ? cols * 7.2 - 24 : Infinity
  const key = JSON.stringify([ctx, m.cache.state, m.cache.until, msg.text, msg.short, msg.action?.label, waiting, !!failed, room])
  m.words = words
  if (levelsMemo.key !== key || !levelsMemo.levels) levelsMemo = { key, levels: stripLevels(m, room) }
  // with the memory warning showing, Open Cortex goes where its Fix goes (on a narrow strip the Fix button is the one that leaves)
  const openHere = tip?.action === 'memory' && !fl && !gone ? () => { void doTip($, 'memory', s) } : open
  return stripView(els, m, levelsMemo.levels!, { act: () => { if (fl) return; if (gone) void copyResume($); else if (tip?.action) void doTip($, tip.action, s) }, refresh: () => { void (failed ? refresh($) : refreshNow($)) }, open: openHere })
}
