import { atom, read, update } from 'claude-code'

import type { Dollar } from './data'

// Charts animate in one armed pass only: the first full panel render after the panel opens (everything grows in) or
// after you press Refresh (only what changed since the last armed pass). Never on the heartbeat, a turn ending, a tab
// switch or a redraw. An arm that no render picks up within a few seconds lapses, so a later heartbeat can't use it.
const seen: Record<string, string> = {}
let arm: { mode: 'open' | 'refresh'; until: number } | null = null
let pass: { mode: 'open' | 'refresh'; any: boolean } | null = null

export function armAnimation(mode: 'open' | 'refresh'): void { arm = { mode, until: Date.now() + 4_000 } }
/** Called once per full panel render: true when this render is the armed one (it may animate). */
export function beginPass(): boolean {
  pass = arm && Date.now() <= arm.until ? { mode: arm.mode, any: false } : null
  arm = null
  return !!pass
}
/** Ends the render's pass: true when any drawing in it animated. */
export function endPass(): boolean { const any = !!pass?.any; pass = null; return any }
/** Whether a drawing animates in this render: always in the pass after opening, only on change after Refresh. */
export const animateFor = (key: string, sig: string): boolean => {
  if (!pass) return false
  const on = pass.mode === 'open' || seen[key] !== sig
  seen[key] = sig
  if (on) pass.any = true
  return on
}

// bumped once, ~1.5 s after an animated render: the redraw it causes mounts the same charts without their animation,
// so a chart scrolled back into view (the app re-creates its image) doesn't play again
export const settle = atom({ plugin: 'kapex-cortex', key: 'settle' } as const, 0, { shape: 'settle-1' })
export async function readSettle($: Dollar): Promise<number> { return read($, settle) }
/** One redraw ~1.5 s from now (one-shot; where there is no clock, as in some tests, nothing happens). */
export function settleSoon($: Dollar): void {
  try { $.clock.after(1_500, () => { void update($, settle, n => n + 1).catch(() => undefined) }) } catch { /* no clock here */ }
}
