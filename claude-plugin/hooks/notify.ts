import { atom, read, update } from 'claude-code'

import type { StatusView } from '../types'
import type { Dollar } from './data'

// Cortex's notifications, one call each: a short chip in the status strip with the Kapex mark and an icon (it clears
// itself after a few seconds), a toast with the same few words, and Cortex's own sound (scripts/sounds.ts made it:
// a soft rising chime for good news, two low notes when something needs you). Only for things worth a glance: a
// handoff saved, a Dream or quick check finished, unused tools turned off, a refresh that stopped working. Settings
// clicks never chime. The sound follows the Sounds setting (on by default).

export type FlashKind = 'done' | 'dream' | 'alert'
export type Flash = { kind: FlashKind; text: string; at: number }
export const flash = atom({ plugin: 'kapex-cortex', key: 'flash' } as const, null as Flash | null, { shape: 'flash-1' })
const SHOW_MS = 6_500

/** The chip's words and kind while it shows, else null (read while drawing, so the strip redraws when it changes). */
export async function readFlash($: Dollar): Promise<Flash | null> {
  const f = await read($, flash)
  return f && Date.now() - f.at < SHOW_MS + 1_000 ? f : null
}

export async function notify($: Dollar, kind: FlashKind, text: string, s?: StatusView | null): Promise<void> {
  const at = Date.now()
  await update($, flash, () => ({ kind, text, at })).catch(() => undefined)
  try { $.ui.toast(text, { timeoutMs: 4_000 }) } catch { /* a surface without toasts: the strip chip still shows */ }
  if (s && s.prefs?.sound !== false) void $.audio.play({ asset: kind === 'alert' ? 'sounds/alert.wav' : 'sounds/done.wav' }).catch(() => undefined)
  // one-shot: takes this chip away (never a newer one) once it has been seen
  try { $.clock.after(SHOW_MS, () => { void update($, flash, f => (f && f.at === at ? null : f)).catch(() => undefined) }) } catch { /* no clock */ }
}

/** A Dream that was running has finished: say what it found, in a few words. */
export function dreamFinished($: Dollar, s: StatusView): void {
  const d = s.dream.recent[0]
  if (!d) return
  if (d.error) { void notify($, 'alert', 'Dream stopped · see Memory', s); return }
  const open = d.status === 'proposed' ? d.findings.filter(f => !f.skip && !f.done).length : 0
  void notify($, 'dream', open ? `Dream done · ${open} to review` : 'Dream done · all clear', s)
}
