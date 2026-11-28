import { atom, read, update } from 'claude-code'

import type { StatusView } from '../types'
import { kc, type Dollar } from './data'

// Cortex's notifications, one call each: a short chip in the status strip with the Kapex mark and an icon (it clears
// itself after a few seconds), a macOS notification (top right; the app's toast elsewhere) with the same few words, and Cortex's own sound (scripts/sounds.ts made it:
// a soft rising chime for good news, two low notes when something needs you). Only for things worth a glance: a
// handoff saved, a full check or quick check finished, unused tools turned off, a refresh that stopped working. Settings
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

/** What `kc notify` did: a macOS notification went out (with its sound), the core held a repeat back, or the panel
 * must say it itself (toast and chime: not macOS, a failed call, an older core that doesn't know the words). */
export function noticeOutcome(ok: boolean, out: string): 'sent' | 'held' | 'fallback' {
  const o = out.trim()
  return ok && o === 'notified' ? 'sent' : ok && o.startsWith('skipped') ? 'held' : 'fallback'
}

export async function notify($: Dollar, kind: FlashKind, text: string, s?: StatusView | null): Promise<void> {
  const at = Date.now()
  await update($, flash, () => ({ kind, text, at })).catch(() => undefined)
  // on a Mac the notice is a macOS notification (top right, Cortex's icon) that carries the sound itself, so Focus and
  // the app's Notifications settings decide, and there is one sound, never two. Elsewhere, or when macOS notifications
  // can't go, the app's toast and Cortex's own chime. A repeat the core held back ("skipped") adds nothing: the
  // strip chip above already shows it.
  const sound = !!s && s.prefs?.sound !== false
  void kc($, ['notify', ...(sound ? ['--sound', kind === 'alert' ? 'alert' : 'done'] : []), 'Kapex Cortex', text]).then(r => noticeOutcome(r.ok, r.out), () => 'fallback' as const).then(o => {
    if (o !== 'fallback') return
    try { $.ui.toast(text, { timeoutMs: 4_000 }) } catch { /* a surface without toasts: the strip chip still shows */ }
    if (sound) void $.audio.play({ asset: kind === 'alert' ? 'sounds/alert.wav' : 'sounds/done.wav' }).catch(() => undefined)
  })
  // one-shot: takes this chip away (never a newer one) once it has been seen
  try { $.clock.after(SHOW_MS, () => { void update($, flash, f => (f && f.at === at ? null : f)).catch(() => undefined) }) } catch { /* no clock */ }
}

/** The strip chip alone, for a few seconds: no banner, no sound (a copy, a small confirmation). */
export async function chip($: Dollar, kind: FlashKind, text: string): Promise<void> {
  const at = Date.now()
  await update($, flash, () => ({ kind, text, at })).catch(() => undefined)
  try { $.clock.after(SHOW_MS, () => { void update($, flash, f => (f && f.at === at ? null : f)).catch(() => undefined) }) } catch { /* no clock */ }
}

/** A memory check that was running has finished: say what it found, in a few words. */
export function dreamFinished($: Dollar, s: StatusView): void {
  const d = s.dream.recent[0]
  if (!d) return
  if (d.error) { void notify($, 'alert', 'Memory check stopped · see Memory', s); return }
  const open = d.status === 'proposed' ? d.findings.filter(f => !f.skip && !f.done).length : 0
  void notify($, 'dream', open ? `Memory check done · ${open} to review` : 'Memory check done · all clear', s)
}
