import type { LiveView, StatusView } from '../types'

/** A status the panel can draw: the sections every page reads are there. `kc status` that printed `{}` or `[]`, or a
 * copy saved by an older version in another shape, fails this and is treated as no status (a message, never a blank
 * pane). */
/** The status with anything a page can't draw left out: a full check report without its findings list (a half-written or
 * older report) is dropped rather than trusted. Returns a new object; the one given is never changed. */
export function usable(s: StatusView): StatusView {
  const recent = s.dream.recent.filter(d => !!d && typeof d === 'object' && Array.isArray(d.findings))
  return recent.length === s.dream.recent.length ? s : { ...s, dream: { ...s.dream, recent } }
}
export function isStatus(x: unknown): x is StatusView {
  const s = x as Partial<StatusView> | null
  return !!s && typeof s === 'object' && !Array.isArray(s) && typeof s.root === 'string' && typeof s.project === 'string'
    && !!s.native && Array.isArray(s.native.files) && !!s.handoff && typeof s.handoff === 'object'
    && !!s.dream && Array.isArray(s.dream.recent) && !!s.hooks && typeof s.hooks === 'object'
}

/**
 * The plan numbers to draw. Claude Code reports plan use only with a reply, so in a quiet chat (or from another chat's
 * saved copy) the numbers can be from before the window reset: a window whose reset time has passed starts again at 0%.
 */
export function freshLimits(limits: LiveView['limits'], now = Date.now()): LiveView['limits'] {
  // a reset time that doesn't parse is dropped (the cards then simply don't say when): never "resets NaN:NaN"
  return limits.map(x => (x.resetsAt && !Number.isFinite(Date.parse(x.resetsAt)) ? { ...x, resetsAt: undefined } : x))
    .map(x => (x.resetsAt && Date.parse(x.resetsAt) <= now ? { ...x, percentUsed: 0, rolled: true } : x))
}
