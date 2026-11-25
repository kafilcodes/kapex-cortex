import { atom, read, update } from 'claude-code'

import { cacheState } from './charts'
import { ensureChat, lastLimits, lastStamp, readCache, refresh, refreshLive, statusOrSaved, vaultStamp, type Dollar } from './data'

// The strip's heartbeat: it keeps the strip true between turns, with no turn, no model call and no redraw that changes
// nothing (a redraw happens only when `pulse` gets a new value).
//   while a turn runs   every 4 s: Claude Code's own usage numbers (in-process, no Node), so context climbs live
//   idle                every 30 s: a few cheap checks, and `pulse` changes only when one changes its answer:
//                         the cache crossing warm → cooling → cold, a plan window resetting, a new day;
//                       and another chat or tool writing here (four file stats) starts a full read
//   full status read    one Node process (~0.3 s), only when those files changed, while a Dream runs, or every 15 min
// One timer per session, rescheduled and never stacked; a plugin reload cancels it with the old copy; session end
// stops it. Work never overlaps: a beat that finds the last one still running only reschedules.
export const pulse = atom({ plugin: 'kapex-cortex', key: 'pulse' } as const, '', { shape: 'pulse-1' })

export const FAST = 4_000
export const IDLE = 30_000
const FULL = 15 * 60_000
type Timer = ReturnType<Dollar['clock']['after']>
let timer: Timer | null = null
let busy = false
let running = false
let lastFull = 0
let busySince = 0
let stopped = false
let runningSince = 0

function schedule($: Dollar, ms: number): void {
  if (stopped) return // the session ended: a beat still finishing must not start the heartbeat again
  timer?.cancel()
  timer = $.clock.after(ms, () => { timer = null; void beat($) })
}

/** Session start (and every plugin reload), and a /clear or resume (a new chat in the same process): one timer, first
 * beat soon. Never stacked: the one pending is cancelled first. */
export function startPulse($: Dollar): void { stopped = false; busy = false; lastFull = Date.now(); schedule($, 1_500) } // a beat in flight keeps its flag: no overlap
/** The process is leaving (exit, logout, a signal): no beat may start again. Not for a /clear: the strip lives on. */
export function stopPulse(): void { stopped = true; busy = false; timer?.cancel(); timer = null }
/** For tests and the leak check: whether a beat is scheduled, and whether the heartbeat has stopped for good. */
export const pulseState = () => ({ scheduled: timer !== null, stopped, busy, running })
/** A main-thread turn began: fast beats until it ends. */
export function turnStarted($: Dollar): void { busy = true; busySince = Date.now(); schedule($, FAST) }
/** It ended: back to idle, with a beat soon to catch what the Stop hook writes just after. */
export function turnEnded($: Dollar): void { busy = false; schedule($, 2_500) }

/** What the strip's answer depends on that time alone changes: the cache's state, which plan windows have reset, the
 * day. Pure, so it's tested directly. (Anything else that changes the strip arrives as a new status or live value.) */
export function signal(o: { lastAt: number | null; ttlMs: number; resets: (string | undefined)[] }, now = Date.now()): string {
  const rolled = o.resets.map(r => (r && Date.parse(r) <= now ? 1 : 0)).join('')
  const c = cacheState(o.lastAt, o.ttlMs, now)
  // the minutes left in 5-minute steps too, so "Cache 55 min" and its hourglass move with time between turns
  return [c.state, c.state === 'warm' || c.state === 'cooling' ? Math.ceil(c.leftMin / 5) : '', rolled, new Date(now).toDateString()].join('|')
}

async function beat($: Dollar): Promise<void> {
  // a beat whose call never came back stops counting as running after a minute, so the heartbeat can't stall for good
  if (running && Date.now() - runningSince < 60_000) { schedule($, busy ? FAST : IDLE); return }
  running = true; runningSince = Date.now()
  const mine = runningSince // a stale beat, let go by the watchdog, must not clear a newer beat's flag
  try {
    // a turn whose end never reached us (a crash, a lost worker) stops counting as running after 30 minutes
    if (busy && Date.now() - busySince > 30 * 60_000) busy = false
    if (busy) { await refreshLive($); return }
    if (await ensureChat($)) await refreshLive($) // a new chat in this process that no event announced
    const s = await statusOrSaved($)
    const stamp = s ? await vaultStamp($, s.root, s.vaultRoot, s.gitDir) : ''
    const now = Date.now()
    if (s && ((lastStamp() && stamp !== lastStamp()) || s.dream.running || now - lastFull > FULL)) { lastFull = now; await refresh($) }
    const cv = await readCache($)
    const sig = signal({ lastAt: cv.lastAt, ttlMs: cv.ttl === '1h' ? 3_600_000 : 300_000, resets: ((await lastLimits($))?.limits ?? []).map(x => x.resetsAt) })
    if ((await read($, pulse)) !== sig) await update($, pulse, () => sig)
  } catch { /* the strip keeps its last drawing; the next beat tries again */ } finally {
    if (runningSince === mine) running = false
    if (!timer) schedule($, busy ? FAST : IDLE)
  }
}

/** Read while drawing, so the strip and panel redraw when the heartbeat's answer changes (and only then). */
export async function readPulse($: Dollar): Promise<string> { return read($, pulse) }
