import { atom, read, update, type Hook } from 'claude-code'

import type { LookView } from '../types'
import type { Dollar } from './data'
import { lookColors, type Ground } from './look-colors'
import { backdropSvg, type Backdrop, type Motion } from './look-scenes'

// The Kapex look for the Claude desktop app (Settings → Look): the app's colours in Kapex Obsidian (dark) and Mist
// (light), and a quiet backdrop behind the conversation. On by default in projects where Cortex is set up;
// once you choose (on or off), your choice holds in every project. Turning it off puts back the app's own look.
// The terminal draws no look, so this is the desktop (and mobile) app only. Kept in the plugin's own store, so it
// applies at session start, before Cortex has read the project.

// Contour is the default since v4.10 (it reads calmest behind the words and its wave is the clearest motion); a saved
// choice is kept as it was
// AMOLED black is the dark default since v4.6 (Kafil, 2026-11-28). Light and dark still follow the app's own setting.
export const LOOK_DEFAULT: LookView = { on: true, ground: 'amoled', backdrop: 'contour', motion: 'medium', chosen: false }
export const look = atom({ plugin: 'kapex-cortex', key: 'look' } as const, LOOK_DEFAULT, { shape: 'look-1' })
const STORE = 'look'
const DROPS = new Set(['prism', 'facets', 'contour', 'mesh', 'aurora', 'none']) // Orbit (v4.2) dropped: a saved choice of it shows Prism

/** What was saved, made safe: an unknown ground or backdrop (an older or edited store) falls back to the default. */
export function cleanLook(x: unknown): LookView {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<LookView>
  return {
    on: typeof o.on === 'boolean' ? o.on : LOOK_DEFAULT.on,
    // a saved ground is kept (Graphite, v4.1, was dropped: it shows Obsidian); none saved, or an unknown one, is the default
    ground: o.ground === 'amoled' ? 'amoled' : o.ground === 'obsidian' || (o.ground as unknown) === 'graphite' ? 'obsidian' : LOOK_DEFAULT.ground,
    backdrop: DROPS.has(o.backdrop as string) ? o.backdrop! : (o.backdrop as string) === 'orbit' ? 'prism' : LOOK_DEFAULT.backdrop, // Orbit's nearest is Prism
    motion: cleanMotion(o.motion),
    chosen: o.chosen === true,
  }
}

/** Motion is a speed since v4.8 (off, slow, medium, fast), Cortex's own setting whatever the Mac's Reduce Motion
 * says. Older saves: on, true and v4.7's "follow the Mac" become medium; off and false stay off. */
function cleanMotion(m: unknown): Motion {
  if (m === 'off' || m === false) return 'off'
  return m === 'slow' || m === 'medium' || m === 'fast' ? m : LOOK_DEFAULT.motion
}

/** Whether the theme standing now is Cortex's own (set in this session and not replaced since), so Off clears only it. */
let ours = false

export async function readLook($: Dollar): Promise<LookView> { try { return cleanLook(await read($, look)) } catch { return LOOK_DEFAULT } }

/** Draws the look: colours for both modes and, unless "None", the backdrop under the app's frosted panels. */
async function paint($: Dollar, l: LookView): Promise<void> {
  const { theme } = lookColors(l.ground as Ground)
  ours = true
  await $.theme.set({ colors: theme, ...(l.backdrop === 'none' ? {} : { backdrop: { scene: `kapex-${l.backdrop}-${l.motion}`, glass: { blur: 18, opacity: 0.62 } } }) })
}

/** At session start: the saved choice, then the look where it applies. One theme stands per session, the latest set,
 * so Cortex's replaces one another mod set earlier: that is what "on" means, and Settings → Look → Off gives the app
 * back. Nothing is ever cleared here. */
export async function startLook($: Dollar): Promise<void> {
  try {
    const l = cleanLook(await $.store.get(STORE).catch(() => undefined))
    await update($, look, () => l)
    if (!l.on) return
    // not chosen yet: on where Cortex is set up in this project, and nowhere else
    if (!l.chosen && !(await $.fs.exists('.vault/cortex.json').catch(() => false))) return
    await paint($, l)
  } catch { /* the look never stops the session from starting */ }
}

/** A press in Settings: saves the choice for every project and applies it now (off puts back the app's own look). */
export async function setLook($: Dollar, patch: Partial<LookView>): Promise<void> {
  const prev = await readLook($)
  const next = cleanLook({ ...prev, ...patch, chosen: true })
  await update($, look, () => next)
  try { await $.store.set(STORE, next) } catch { /* kept for this session at least */ }
  // Off clears only Cortex's own theme: one another mod set after it is left standing
  try { if (next.on) await paint($, next); else if (ours) { ours = false; await $.theme.clear() } } catch { /* a surface without themes */ }
}

type BackdropEvent = Parameters<Hook<'ui.render'>>[1]
/** Draws Cortex's own backdrops; any other plugin's scene is left to it. */
export function renderBackdrop($: Dollar, e: BackdropEvent, next: (e: BackdropEvent) => unknown): unknown {
  const p = (e as { props?: { scene?: string; plugin?: string } }).props
  const m = /^kapex-(prism|facets|contour|mesh|aurora)(?:-(off|slow|medium|fast|still|move))?$/.exec(p?.scene ?? '')
  if ((e.surface !== 'desktop' && e.surface !== 'mobile') || p?.plugin !== 'kapex-cortex' || !m) return next(e)
  // an older session's scene names: -still is off, -move or none is medium
  const svg = backdropSvg(m[1] as Backdrop, m[2] === 'still' ? 'off' : m[2] === 'move' || !m[2] ? 'medium' : m[2] as Motion)
  const { Svg } = $.ui.resolve(e) as unknown as { Svg?: (p: Record<string, unknown>) => JSX.Element }
  return svg && Svg ? <Svg source={svg} alt="Kapex backdrop: a quiet emerald pattern at the edges" isInteractive /> : next(e)
}
