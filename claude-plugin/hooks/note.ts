import { atom, read, update } from 'claude-code'

import type { Dollar } from './data'

// The panel header's feedback chip (the `note`): what the last press did, in its own words ("Dark mode: AMOLED black",
// "Handoff saved"), for a few seconds (v4.6: it used to stay up for good). Working words ("Saving the handoff…") stay
// until the outcome replaces them; a result clears itself (5 s when it went well, 15 s when it didn't), unless a newer
// note took its place. `noteAt` keeps when it ends, so a note whose timer died with a plugin reload still stops showing.
export const note = atom({ plugin: 'kapex-cortex', key: 'note' } as const, '', { shape: 'note-1' })
export const noteAt = atom({ plugin: 'kapex-cortex', key: 'noteAt' } as const, 0, { shape: 'note-at-1' })
export const NOTE_MS = { done: 5_000, failed: 15_000, working: 90_000 }
let noteSeq = 0

/** How a note reads: still working, failed, or done (the chip's icon and colour, and how long it stays). */
export function noteTone(m: string): 'working' | 'failed' | 'done' {
  return /…$/.test(m) ? 'working' : /^(?:Couldn'?t|Could not|Didn'?t work)\b/.test(m) ? 'failed' : 'done'
}
/** The words until their end time (a result's few seconds, working words' 90 s, or the time the caller asked); else ''. */
export function liveNote(text: string, until: number, now = Date.now()): string {
  return text && now <= until + 1_000 ? text : ''
}
export async function say($: Dollar, text: string, ms?: number): Promise<void> {
  const mine = ++noteSeq, tone = noteTone(text), hold = tone === 'working' ? NOTE_MS.working : ms ?? NOTE_MS[tone]
  await update($, noteAt, () => Date.now() + hold)
  await update($, note, () => text)
  if (!text || tone === 'working') return
  try { $.clock.after(hold, () => { if (noteSeq === mine) void update($, note, n => (n === text ? '' : n)).catch(() => undefined) }) } catch { /* no clock: liveNote hides it */ }
}
export async function clearNote($: Dollar): Promise<void> { noteSeq++; await update($, note, () => '') }
export async function readNote($: Dollar): Promise<string> { return liveNote(await read($, note), await read($, noteAt)) }
