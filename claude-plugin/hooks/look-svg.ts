// Shared pieces of the Kapex backdrops (look-scenes.ts, look-scenes-2.ts): the frame, the palette and the motion.
//
// Motion is SVG's own animation (SMIL: <animate>, <animateTransform>), the same the panel's charts use, so it runs
// wherever the app draws the backdrop (as an image or in a sandboxed frame). It is Cortex's own setting alone
// (Settings → Look → Motion: Off, Slow, Medium, Fast): the Mac's Reduce Motion does not stop it (v4.8; until v4.7 the
// scenes stopped all motion when the Mac asked for reduced motion, so "on" never moved on such a Mac).
//
// Cost: a backdrop is one big image, and any change in it redraws the whole window. Smooth (every-frame) motion cost
// 13 to 34% of a core in headless Brave (CSS keyframes were no cheaper), so every motion here is STEPPED
// (calcMode="discrete"): drifts take 4, 6 or 12 steps a second by speed, each well under a pixel, which the eye reads
// as smooth; quick beats (a pulse, a glint, a signal) take 12 steps a second only while they play, and hold one value
// at rest, which redraws nothing. All steps sit on one 1/12 s grid, so animations that run together redraw together.
// Faster speeds step more often, so they cost a little more (measured per speed in the v4.8 notes).

export type Motion = 'off' | 'slow' | 'medium' | 'fast'
export const W = 1280, H = 760
export const LINE = '#10B981', LINE2 = '#34D399', GLOW = '#10B981', GLOW2 = '#0D9488'
export const f1 = (n: number) => n.toFixed(1)
/** A small seeded random, so a scene is the same every time it is drawn. */
export const rnd = (seed: number) => { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647 }

export const BEAT_FPS = 12
/** Each speed: how much shorter a drift's cycle is, its steps a second, and how much shorter a beat's cycle is. */
export const SPEEDS: Record<Exclude<Motion, 'off'>, { drift: number; fps: number; beat: number }> = {
  slow: { drift: 1, fps: 4, beat: 1 },
  medium: { drift: 1 / 3, fps: 6, beat: 1 / 2 },
  fast: { drift: 1 / 7, fps: 12, beat: 1 / 3 },
}
// the speed being drawn: set by frame() for the length of one synchronous build
let cur = SPEEDS.slow
/** A time in a beat's cycle (a phase or a gap) at the speed being drawn. */
export const tk = (s: number) => s * cur.beat
const GRID = 1 / BEAT_FPS
/** A start time snapped to the shared 1/12 s grid. */
export const onGrid = (s: number) => +(Math.round(s / GRID) * GRID).toFixed(4)
const num = (n: number) => +n.toFixed(3)
/** Ease-in-out (sine) from 0 to 1. */
const ease = (t: number) => (1 - Math.cos(Math.PI * t)) / 2

/** A to-and-fro transform, stepped: `from`, out to `to` and back over `dur` seconds at slow speed (shorter when
 * faster), forever. Each value is a list (rotate: angle cx cy; translate: x y). */
export function swing(type: 'rotate' | 'translate', from: number[], to: number[], slowDur: number, begin = 0): string {
  const dur = num(slowDur * cur.drift), n = Math.round(dur * cur.fps), values: string[] = []
  for (let k = 0; k < n; k++) { const e = ease(k / n < 0.5 ? (2 * k) / n : 2 - (2 * k) / n); values.push(from.map((a, i) => num(a + (to[i]! - a) * e)).join(' ')) }
  return `<animateTransform attributeName="transform" type="${type}" calcMode="discrete" values="${values.join(';')}" dur="${dur}s" begin="${onGrid(begin)}s" repeatCount="indefinite"/>`
}

/** A to-and-fro of one attribute (an opacity), stepped like a drift. */
export function breathe(attr: string, a: number, b: number, slowDur: number, begin = 0): string {
  const dur = num(slowDur * cur.drift), n = Math.round(dur * cur.fps), values: number[] = []
  for (let k = 0; k < n; k++) values.push(num(a + (b - a) * ease(k / n < 0.5 ? (2 * k) / n : 2 - (2 * k) / n)))
  return `<animate attributeName="${attr}" calcMode="discrete" values="${values.join(';')}" dur="${dur}s" begin="${onGrid(begin)}s" repeatCount="indefinite"/>`
}

/** A beat once per cycle (`slowDur` seconds at slow speed, shorter when faster): over its first `active` seconds (at
 * most three quarters of the cycle) the attribute follows `at(u)` (u from 0 to 1) at 12 steps a second, then it holds
 * `rest` for the rest of the cycle, which redraws nothing. Staggered `begin`s (scale phases with tk()) make a wave;
 * they are snapped to the shared grid. */
export function beat(attr: string, at: (u: number) => number, rest: number, slowDur: number, active: number, begin: number): string {
  const dur = num(slowDur * cur.beat)
  active = Math.min(active, dur * 0.75)
  const n = Math.max(2, Math.round(active * BEAT_FPS)), times: number[] = [], values: number[] = []
  for (let k = 0; k < n; k++) { times.push(num((k * GRID) / dur)); values.push(num(at(k / n))) }
  times.push(num((n * GRID) / dur)); values.push(num(rest))
  return `<animate attributeName="${attr}" calcMode="discrete" values="${values.join(';')}" keyTimes="${times.join(';')}" dur="${dur}s" begin="${onGrid(begin)}s" repeatCount="indefinite"/>`
}

/** A pulse: rises from `base` to `peak` over the first third of `active`, settles back over the rest, then rests. */
export const pulse = (attr: string, base: number, peak: number, dur: number, begin: number, active = 2.4) =>
  beat(attr, u => base + (peak - base) * (u < 1 / 3 ? ease(u * 3) : 1 - ease((u - 1 / 3) * 1.5)), base, dur, active, begin)

/** A scene: shared defs, and its body drawn moving or still. */
export type Scene = { defs: string; body: (move: boolean) => string }

/** The whole SVG for a scene at a motion speed. Light mode softens the linework (`.k-soft`) on paper. */
export function frame(s: Scene, motion: Motion): string {
  if (motion !== 'off') cur = SPEEDS[motion]
  const body = s.body(motion !== 'off')
  cur = SPEEDS.slow
  const css = '@media (prefers-color-scheme: light){.k-soft{opacity:.6}}'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><style>${css}</style><defs>${s.defs}</defs>${body}</svg>`
}
