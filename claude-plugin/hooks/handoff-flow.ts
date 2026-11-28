import type { LiveView, ViewState } from '../types'
import { kc, readLive, refresh, refreshLive, readStatus, setHanded, type Dollar } from './data'
import { say } from './note'
import { chip, notify } from './notify'

// Handing off from the panel or the strip: save the handoff, copy /cortex-resume, and remember that this chat was
// handed off (until a reply here), so nothing suggests the handoff again in the meantime (v4.6).
/** What you paste in the new chat: typed by you, so a slash command is fine (the panel itself can't send one). */
export const RESUME_COMMAND = '/cortex-resume'
/** Whether a turn is running now (pulse.ts says, on turn start and end): a handoff pressed mid-turn allows that turn. */
let turnRunning = false
export function setTurnRunning(on: boolean): void { turnRunning = on }
/** This chat was just handed off: the handoff is saved and /cortex-resume copied, and no reply came here since (the
 * turn running at the press, if any, is allowed). The strip and Overview say "paste it in a new chat" instead of
 * suggesting a handoff again; a later reply here means you kept working in this chat, and the suggestions return. */
export function handedOff(vw: ViewState, l: LiveView | null): boolean {
  return vw.flow === 'copied' && vw.flowTurns !== undefined && (l?.turns ?? 0) <= vw.flowTurns // a 'copied' saved before v4.6 has no count: not handed off
}
/** Hand off: save the handoff with a snapshot of the working tree, then put /cortex-resume on the clipboard. */
export async function handOff($: Dollar): Promise<void> {
  await say($, 'Saving the handoff…')
  const r = await kc($, ['handoff'])
  let copied = false
  try { copied = !!(await $.ui.copy({ text: RESUME_COMMAND })).isCopied } catch { /* no clipboard on this surface */ }
  await refresh($)
  await refreshLive($) // the turn count as it is now, not as the last beat read it
  await setHanded($, r.ok, ((await readLive($))?.turns ?? 0) + (turnRunning ? 1 : 0))
  void notify($, r.ok ? 'done' : 'alert', r.ok ? (copied ? 'Handoff saved · resume copied' : 'Handoff saved') : 'Handoff failed · see Handoff', await readStatus($))
  await say($, r.ok ? (copied ? 'Handoff saved · /cortex-resume copied' : 'Handoff saved') : `Couldn't save the handoff: ${(r.out.split('\n')[0] ?? '').slice(0, 120) || 'no answer'}`)
}
export async function copyResume($: Dollar): Promise<void> {
  let copied = false
  try { copied = !!(await $.ui.copy({ text: RESUME_COMMAND })).isCopied } catch { /* no clipboard */ }
  await say($, copied ? '/cortex-resume copied' : 'Couldn\'t copy here: type /cortex-resume in the new chat')
  void chip($, copied ? 'done' : 'alert', copied ? '/cortex-resume copied' : 'Couldn\'t copy: type /cortex-resume') // the strip says it too
}

