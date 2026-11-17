// Blocky: Cortex's pixel critter, a companion to the emerald robot. A wide block body, side nubs, square eyes and
// stubby legs on a 20 x 18 grid (12 x 8 for `tiny`), every rect on whole grid units with crispEdges so it stays sharp
// from 16 to 120 px. A pine right edge and underside give it the printed-block depth; the antenna spark is its status
// light (sage = fine, amber = worried, pine = asleep). Pure and static: built once per size, kept in a small cache.
import { K } from './theme'

export type BlockyMood = 'idle' | 'happy' | 'cool' | 'sleepy' | 'worried' | 'tiny'
export type BlockyPage = 'timeline' | 'memory' | 'handoff' | 'costs' | 'settings' | 'dream'

const E = K.emerald, S = K.sage, P = K.pine, A = K.amber
const INK = '#0B1F17', SHINE = '#ECFDF5', BLUSH = '#FDA4AF', G = K.silver
/** One pixel block: x, y, width, height in grid units, colour, optional opacity. */
type Px = [number, number, number, number, string, number?]

const cache = new Map<string, string>()
const memo = (key: string, make: () => string) => { let v = cache.get(key); if (!v) { v = make(); if (cache.size < 64) cache.set(key, v) } return v }
const rects = (px: Px[]) => px.map(([x, y, w, h, c, o]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"${o === undefined ? '' : ` fill-opacity="${o}"`}/>`).join('')
const svg = (size: number, w: number, h: number, px: Px[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(size)}" height="${Math.round(size * h / w)}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects(px)}</svg>`
const shift = (px: Px[], dx: number, dy = 0): Px[] => px.map(([x, y, w, h, c, o]) => [x + dx, y + dy, w, h, c, o])

type Body = { eyes: Px[]; dy?: number; legH?: number; spark?: string; earUp?: number; glint?: boolean; extra?: Px[] }

/** The full critter on a 20 x 18 grid. `dy` sinks the body (sleepy sits down), `earUp` lifts the nubs (happy). */
function critter({ eyes, dy = 0, legH = 3, spark = S, earUp = 0, glint = true, extra = [] }: Body): Px[] {
  const ey = 7 + dy - earUp, top = 4 + dy, foot = 15 + dy
  return [
    // antenna: a pine stem with a four-point spark (pale core), off-centre like a sprout; asleep it is a drooped bulb
    ...(spark === P ? [[14, 3 + dy, 1, 1, P], [15, 2 + dy, 1, 1, P]] as Px[]
      : [[14, dy, 1, 3, spark], [13, 1 + dy, 3, 1, spark], [14, 1 + dy, 1, 1, SHINE, 0.9], [14, 3 + dy, 1, 1, P]] as Px[]),
    // side nubs: pine underside, the right one shaded on its outer face
    [0, ey, 2, 4, E], [0, ey + 3, 2, 1, P], [18, ey, 1, 4, E], [19, ey, 1, 4, P], [18, ey + 3, 1, 1, P],
    // body with a pine right face and underside, and a sage glint in the top-left corner
    [2, top, 16, 11, E], [17, top, 1, 11, P], [2, top + 10, 16, 1, P], ...(glint ? [[3, top + 1, 2, 1, S], [3, top + 2, 1, 1, S]] as Px[] : []),
    // four chunky legs, evenly spaced; the inner pair is pine, so it reads as standing behind
    [3, foot, 2, legH, E], [7, foot, 2, legH, P], [11, foot, 2, legH, P], [15, foot, 2, legH, E],
    ...shift(eyes, 0, dy), ...extra,
  ]
}

/** A 4 x 4 pixel Z. */
const zee = (x: number, y: number, o?: number): Px[] => [[x, y, 4, 1, E, o], [x + 2, y + 1, 1, 1, E, o], [x + 1, y + 2, 1, 1, E, o], [x, y + 3, 4, 1, E, o]]
const square: Px[] = [[4, 7, 2, 2, INK], [14, 7, 2, 2, INK]]
const MOODS: Record<Exclude<BlockyMood, 'tiny'>, () => Px[]> = {
  idle: () => critter({ eyes: square }),
  // > < squint, rosy cheeks, nubs raised a step
  happy: () => critter({
    earUp: 1,
    eyes: [[4, 7, 1, 1, INK], [5, 8, 1, 1, INK], [4, 9, 1, 1, INK], [15, 7, 1, 1, INK], [14, 8, 1, 1, INK], [15, 9, 1, 1, INK],
      [3, 10, 2, 1, BLUSH], [15, 10, 2, 1, BLUSH]],
  }),
  // pixel shades with two glints each: everything is fine
  cool: () => critter({
    eyes: [[3, 7, 14, 1, INK], [3, 8, 5, 1, INK], [12, 8, 5, 1, INK], [4, 9, 3, 1, INK], [13, 9, 3, 1, INK],
      [4, 8, 1, 1, SHINE], [5, 9, 1, 1, SHINE], [13, 8, 1, 1, SHINE], [14, 9, 1, 1, SHINE]],
  }),
  // sat down (legs folded), eyes shut, spark off, a small z and a big Z
  sleepy: () => critter({
    dy: 2, legH: 1, spark: P,
    eyes: [[4, 8, 2, 1, INK], [14, 8, 2, 1, INK]],
    extra: [...zee(0, 1, 0.6), ...zee(5, 0)],
  }),
  // eyes dropped a row under raised inner brows, a wobbly mouth, amber spark and an amber "!"
  worried: () => critter({
    spark: A, glint: false,
    eyes: [[4, 8, 2, 2, INK], [14, 8, 2, 2, INK], [3, 6, 2, 1, INK], [5, 5, 2, 1, INK], [13, 5, 2, 1, INK], [15, 6, 2, 1, INK],
      [8, 12, 1, 1, INK], [9, 11, 1, 1, INK], [10, 12, 1, 1, INK], [11, 11, 1, 1, INK]],
    extra: [[0, 1, 1, 3, A], [0, 5, 1, 1, A]],
  }),
}

/** The 12 x 8 version for 16 to 24 px: no antenna, two legs, bigger eyes for its size. */
const tinyPx = (): Px[] => [
  [0, 2, 1, 2, E], [11, 2, 1, 2, P],
  [1, 0, 10, 6, E], [10, 0, 1, 6, P], [1, 5, 10, 1, P], [2, 1, 1, 1, S],
  [2, 2, 2, 2, INK], [7, 2, 2, 2, INK],
  [2, 6, 2, 2, E], [7, 6, 2, 2, P],
]

/** Blocky in a mood, `size` px wide (height follows the grid: 18/20 of it, or 8/12 for `tiny`). */
export function blocky(mood: BlockyMood, size: number): string {
  return memo(`b-${mood}-${Math.round(size)}`, () => mood === 'tiny' ? svg(size, 12, 8, tinyPx()) : svg(size, 20, 18, MOODS[mood]()))
}

// Page props on the right of a 32 x 18 canvas, same pixel language.
const PROPS: Record<BlockyPage, () => Px[]> = {
  // three event dots on a rail, newest (emerald) on top
  timeline: () => [[25, 2, 1, 15, G, 0.6], [24, 3, 3, 3, E], [28, 4, 3, 1, G, 0.5], [24, 8, 3, 3, S], [28, 9, 3, 1, G, 0.5], [24, 13, 3, 3, A], [28, 14, 3, 1, G, 0.5]],
  // a note card with lines and a tick badge
  memory: () => [[23, 4, 8, 11, G, 0.3], [24, 6, 5, 1, G, 0.8], [24, 8, 6, 1, G, 0.8], [24, 10, 4, 1, G, 0.8], [27, 12, 5, 5, E], [28, 14, 1, 1, SHINE], [29, 15, 1, 1, SHINE], [30, 13, 1, 2, SHINE]],
  // a clipboard held out, its clip in pine
  handoff: () => [[23, 5, 8, 11, G, 0.3], [25, 4, 4, 2, P], [24, 8, 6, 1, E], [24, 10, 5, 1, G, 0.8], [24, 12, 6, 1, G, 0.8]],
  // a stack of amber coins and a bar
  costs: () => [9, 12, 15].flatMap((y): Px[] => [[22, y, 5, 2, A], [23, y, 3, 1, '#FCD34D'], [22, y + 2, 5, 1, '#B45309']]).concat([[29, 6, 2, 11, E], [29, 6, 1, 1, S]] as Px[]),
  // a chunky pixel gear
  settings: () => [[25, 6, 4, 8, E], [23, 8, 8, 4, E], [24, 7, 6, 6, E], [26, 6, 2, 1, P], [23, 9, 1, 2, P], [30, 9, 1, 2, P], [26, 13, 2, 1, P], [26, 9, 2, 2, INK]],
  // a crescent moon and a star
  dream: () => [[25, 2, 3, 1, S], [24, 3, 2, 1, S], [23, 4, 2, 2, S], [24, 6, 2, 1, S], [25, 7, 3, 1, S], [29, 10, 1, 3, E], [28, 11, 3, 1, E]],
}
const SCENE_MOOD: Record<BlockyPage, Exclude<BlockyMood, 'tiny'>> = { timeline: 'idle', memory: 'happy', handoff: 'idle', costs: 'idle', settings: 'cool', dream: 'sleepy' }

/** Blocky with one page prop beside it, `size` px wide on a 32 x 18 grid. */
export function blockyScene(page: BlockyPage, size: number): string {
  return memo(`s-${page}-${Math.round(size)}`, () => svg(size, 32, 18, [...MOODS[SCENE_MOOD[page]](), ...PROPS[page]()]))
}

/** For tests: how many drawings are cached (bounded at 64). */
export const cachedBlocky = () => cache.size

const SAYS: Record<Exclude<BlockyMood, 'tiny'>, string> = { idle: 'Blocky, Cortex\'s little helper', happy: 'Blocky, happy', cool: 'Blocky in pixel sunglasses: all good', sleepy: 'Blocky asleep, dreaming', worried: 'Blocky, worried' }
/** Blocky as a page header's companion beside the robot: 40 px (2 px per pixel, so it stays crisp); none in a narrow pane. */
export function companion(mood: Exclude<BlockyMood, 'tiny'>, px: number): { svg: string; alt: string } | undefined {
  return px >= 420 ? { svg: blocky(mood, 40), alt: SAYS[mood] } : undefined
}
