// The small drawing that leads every list tile (Timeline, Dream findings, Memory files, Handoffs): one per kind of
// thing, so the kind reads at a glance without words. Built from the mascot's vocabulary (the emerald robot's face,
// notes, the moon, the lens, sparkles, a round badge with a white mark), on a 48×48 grid so it scales. Static, no
// animation; neutral parts are grey at part opacity, so they read on light and dark. Each drawing is built once per
// kind, size and tint and kept in a small bounded cache.
import { K } from './theme'

export type Lead =
  | 'reply-ok' | 'reply-bad' | 'reply-warn' | 'reply-none'
  | 'commit' | 'commit-tag' | 'merge' | 'handoff' | 'dream' | 'dream-ok' | 'dream-bad'
  | 'mem-user' | 'mem-parent' | 'mem-project' | 'mem-rule' | 'mem-auto'
  | 'f-false' | 'f-stale' | 'f-contradiction' | 'f-duplicate' | 'f-visible' | 'f-scope' | 'f-replace' | 'f-over-cap'
  | 'f-broken-link' | 'f-orphan' | 'f-lesson' | 'f-rejected'

const E = K.emerald, S = K.sage, A = K.amber, R = K.rose, T = '#14B8A6'
const G = '#9CA3AF', SCREEN = '#1F2937', GLOW = '#34D399', W = '#fff'
const cache = new Map<string, string>()

// ---- parts ------------------------------------------------------------------------------------------------------
/** a sheet of notes: a soft grey card with three lines */
const note = (x: number, y: number, w = 22, h = 28, c: string = G, lines = [0.62, 0.78, 0.48]) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}" fill-opacity="${c === G ? 0.12 : 0.14}" stroke="${c}" stroke-opacity="${c === G ? 0.6 : 1}" stroke-width="1.6"/>`
  + lines.map((f, i) => `<path d="M${x + 4.5} ${y + 7.5 + i * 5.5}H${(x + 4.5 + (w - 9) * f).toFixed(1)}" stroke="${c}" stroke-opacity="${c === G ? 0.65 : 0.8}" stroke-width="2"/>`).join('')
/** a round badge with a white mark, the mascot's tick disc */
const MARK: Record<string, (x: number, y: number) => string> = {
  tick: (x, y) => `<path d="M${x - 3.4} ${y + 0.2}l2.3 2.3 4.5-4.8" stroke="${W}" stroke-width="2"/>`,
  cross: (x, y) => `<path d="M${x - 2.6} ${y - 2.6}l5.2 5.2M${x + 2.6} ${y - 2.6}l-5.2 5.2" stroke="${W}" stroke-width="2"/>`,
  clock: (x, y) => `<path d="M${x} ${y - 3.2}V${y}l2.4 1.6" stroke="${W}" stroke-width="1.8"/>`,
  bang: (x, y) => `<path d="M${x} ${y - 3.4}v3.6" stroke="${W}" stroke-width="2.2"/><circle cx="${x}" cy="${y + 3}" r="1.2" fill="${W}"/>`,
  link: (x, y) => `<path d="M${x - 1.2} ${y + 1.2}l2.4-2.4M${x - 2} ${y - 0.2}l-1 1a1.8 1.8 0 0 0 2.6 2.6l1-1M${x + 2} ${y + 0.2}l1-1a1.8 1.8 0 0 0-2.6-2.6l-1 1" stroke="${W}" stroke-width="1.4"/>`,
}
const badge = (x: number, y: number, c: string, mark: keyof typeof MARK, r = 7.5) => `<circle cx="${x}" cy="${y}" r="${r + 1.6}" fill="${c}" fill-opacity="0.18"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>${MARK[mark]!(x, y)}`
const star = (x: number, y: number, s: number, c: string = S) => `<path d="M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}Z" fill="${c}"/>`
const moon = (x: number, y: number, r: number, c: string = E) => `<path d="M${x} ${y - r}a${r} ${r} 0 1 0 ${r * 1.08} ${r * 1.3}a${r * 0.8} ${r * 0.8} 0 0 1-${r * 1.08}-${r * 1.3}z" fill="${c}" fill-opacity="0.9"/>`
const lens = (x: number, y: number, r = 6.5, c: string = E) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="0.14" stroke="${c}" stroke-width="2.2"/><path d="M${x + r * 0.72} ${y + r * 0.72}l4.6 4.6" stroke="${c}" stroke-width="2.8"/>`
const folder = (x: number, y: number, w: number, h: number, c: string = E) => `<path d="M${x} ${y + 3}a3 3 0 0 1 3-3h${w * 0.3}l3 3.5h${w * 0.7 - 9}a3 3 0 0 1 3 3V${y + h - 3}a3 3 0 0 1-3 3H${x + 3}a3 3 0 0 1-3-3z" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="1.6"/>`
const win = (x: number, y: number, w: number, h: number, c: string = G) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4.5" fill="${c}" fill-opacity="0.1" stroke="${c}" stroke-opacity="${c === G ? 0.6 : 1}" stroke-width="1.6"/><circle cx="${x + 4.5}" cy="${y + 4.5}" r="1.1" fill="${c}" fill-opacity="0.7"/><circle cx="${x + 8}" cy="${y + 4.5}" r="1.1" fill="${c}" fill-opacity="0.7"/>`
const shield = (x: number, y: number, c: string = E) => `<path d="M${x} ${y - 8}l7 3v5c0 5-3 7.6-7 9.6-4-2-7-4.6-7-9.6v-5z" fill="${c}"/><path d="M${x - 3.2} ${y + 0.6}l2.2 2.2 4.4-4.6" stroke="${W}" stroke-width="1.9"/>`

/** the mascot's head and shoulders, on its own: eyes and mouth say how a reply went */
function face(eyes: 'happy' | 'open' | 'worry' | 'focus', mouth: 'smile' | 'wavy' | 'flat' | 'o', antenna: string): string {
  const ex = [15, 23], ey = 29.6
  const eye = (x: number) => eyes === 'happy' ? `<path d="M${x - 2.2} ${ey + 1}Q${x} ${ey - 2.2} ${x + 2.2} ${ey + 1}" stroke="${GLOW}" stroke-width="1.7"/>`
    : eyes === 'focus' ? `<rect x="${x - 2.3}" y="${ey - 0.9}" width="4.6" height="1.8" rx="0.9" fill="${GLOW}"/>`
    : eyes === 'worry' ? `<circle cx="${x}" cy="${ey + 0.4}" r="1.7" fill="${R}"/><path d="M${x - 2.4} ${ey - 3 + (x < 19 ? 1 : 0)}L${x + 2.4} ${ey - 3 + (x < 19 ? 0 : 1)}" stroke="${R}" stroke-width="1.3"/>`
    : `<circle cx="${x}" cy="${ey}" r="2" fill="${GLOW}"/>`
  const m = { smile: `<path d="M16.6 33.6Q19 35.8 21.4 33.6" stroke="${GLOW}" stroke-width="1.5"/>`, flat: `<path d="M17 34.2H21" stroke="${GLOW}" stroke-width="1.5"/>`,
    wavy: `<path d="M15.8 34.6q.8-1.2 1.6 0t1.6 0 1.6 0 1.6 0" stroke="${R}" stroke-width="1.3"/>`, o: `<circle cx="19" cy="34.2" r="1.1" fill="${S}"/>` }[mouth]
  return `<ellipse cx="19" cy="46.2" rx="11" ry="1.6" fill="${G}" fill-opacity="0.22"/><rect x="12" y="39.5" width="14" height="6.5" rx="3" fill="${E}" fill-opacity="0.35"/>`
    + `<path d="M19 21V16.6" stroke="${E}" stroke-width="1.6"/><circle cx="19" cy="14.8" r="2.3" fill="${antenna}"/>`
    + `<rect x="3.4" y="27" width="3.4" height="7.4" rx="1.7" fill="${E}"/><rect x="31.2" y="27" width="3.4" height="7.4" rx="1.7" fill="${E}"/>`
    + `<rect x="6" y="21" width="26" height="20" rx="7" fill="${E}" fill-opacity="0.18" stroke="${E}" stroke-width="1.6"/>`
    + `<rect x="9.4" y="24.4" width="19.2" height="13.2" rx="4.6" fill="${SCREEN}"/>${eye(ex[0]!)}${eye(ex[1]!)}${m}`
}
/** a speech bubble up and to the right of the face, pointing at it */
const bubble = (c: string, inner: string) => `<path d="M31 4h10a5 5 0 0 1 5 5v6a5 5 0 0 1-5 5h-6.5l-4.5 4 .6-4.2A5 5 0 0 1 26 15V9a5 5 0 0 1 5-5z" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="1.6"/>${inner}`
const IN = {
  tick: (c: string) => `<path d="M32.4 12.2l2.6 2.6 4.8-5" stroke="${c}" stroke-width="2"/>`,
  cross: (c: string) => `<path d="M33.4 9.4l5 5M38.4 9.4l-5 5" stroke="${c}" stroke-width="2"/>`,
  pause: (c: string) => `<path d="M34.2 9.2v6M37.8 9.2v6" stroke="${c}" stroke-width="2.2"/>`,
  dots: (c: string) => [32.4, 36, 39.6].map(x => `<circle cx="${x}" cy="12" r="1.3" fill="${c}"/>`).join(''),
}

// ---- drawings ---------------------------------------------------------------------------------------------------
const branch = `<path d="M14 3V45" stroke="${G}" stroke-opacity="0.5" stroke-width="2"/>`
const DRAW: Record<Lead, (tint: string) => string> = {
  'reply-ok': c => `${face('happy', 'smile', S)}${bubble(c, IN.tick(c))}`,
  'reply-bad': c => `${face('worry', 'wavy', R)}${bubble(c, IN.cross(c))}`,
  'reply-warn': c => `${face('focus', 'flat', A)}${bubble(c, IN.pause(c))}`,
  'reply-none': c => `${face('open', 'smile', S)}${bubble(c, IN.dots(c))}`,
  commit: c => `${branch}<circle cx="14" cy="21" r="6.2" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="2.2"/><path d="M25 17.5H42M25 24H36" stroke="${G}" stroke-opacity="0.55" stroke-width="2.4"/>${badge(33, 36.5, c, 'tick')}`,
  'commit-tag': c => `${branch}<circle cx="14" cy="21" r="6.2" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="2.2"/><path d="M25 17.5H42" stroke="${G}" stroke-opacity="0.55" stroke-width="2.4"/>`
    + `<path d="M25 27.5h11.5l6.5 6.5-6.5 6.5H25a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" fill="${c}"/><circle cx="36.5" cy="34" r="1.8" fill="${W}"/>${star(43, 24, 2.6)}`,
  merge: c => `${branch}<path d="M34 9c0 12-9 14-20 17" stroke="${G}" stroke-opacity="0.5" stroke-width="2"/><circle cx="34" cy="9" r="3.6" fill="${G}" fill-opacity="0.25" stroke="${G}" stroke-opacity="0.7" stroke-width="1.6"/>`
    + `<circle cx="14" cy="27" r="6.2" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="2.2"/><circle cx="14" cy="27" r="2.2" fill="${c}"/>${star(36, 36, 3)}`,
  handoff: c => `${win(2, 15, 17, 28)}<path d="M5.5 26H14M5.5 30.5H12M5.5 35H15" stroke="${G}" stroke-opacity="0.6" stroke-width="1.8"/><path d="M5.5 39.2H11" stroke="${A}" stroke-width="1.8"/>${win(29, 15, 17, 28, c)}`
    + `<path d="M8 11Q22 1 37 10" stroke="${c}" stroke-width="1.8" stroke-dasharray="0.5 3.5"/><path d="M33.6 9.2l3.6 1 -1.4 3.4" stroke="${c}" stroke-width="1.8"/>`
    + `<rect x="17.5" y="22" width="13" height="16" rx="2.6" fill="${c}" fill-opacity="0.9"/><path d="M20.5 27H27.5M20.5 31H25.5" stroke="${W}" stroke-width="1.6"/>${star(39.5, 34, 2.6, c)}`,
  dream: c => `${moon(14, 13, 8.5, c)}${star(28, 7, 2.6)}${note(16, 16, 22, 27)}${lens(36, 33, 6, c)}`,
  'dream-ok': c => `${moon(14, 13, 8.5)}${star(28, 7, 2.6)}${note(16, 16, 22, 27)}${badge(37, 37, c, 'tick')}`,
  'dream-bad': c => `${moon(14, 13, 8.5, G)}${note(16, 16, 22, 27)}${badge(37, 37, c, 'cross')}`,
  'mem-user': c => `${note(9, 7, 24, 32)}${star(35, 34, 8, c)}${star(40, 13, 2.6)}`,
  'mem-parent': c => `${folder(4, 16, 40, 27, c)}<path d="M24 12V3.5M20 7.2l4-4 4 4" stroke="${c}" stroke-width="2"/>`,
  'mem-project': c => `<rect x="13" y="8" width="20" height="22" rx="3.5" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/><path d="M17 14H28M17 19H25" stroke="${G}" stroke-opacity="0.65" stroke-width="2"/>${folder(4, 18, 40, 25, c)}${star(40, 10, 2.6)}`,
  'mem-rule': c => `${note(7, 7, 24, 32)}${shield(35, 33, c)}`,
  'mem-auto': c => `<path d="M21 9V4.6" stroke="${c}" stroke-width="1.6"/><circle cx="21" cy="3.4" r="2.3" fill="${S}"/>`
    + `<rect x="8" y="9" width="26" height="33" rx="5" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/><rect x="12" y="13" width="18" height="10" rx="3.6" fill="${SCREEN}"/><circle cx="17.5" cy="18" r="1.7" fill="${GLOW}"/><circle cx="24.5" cy="18" r="1.7" fill="${GLOW}"/>`
    + `<path d="M12.5 29H29M12.5 34H24" stroke="${G}" stroke-opacity="0.65" stroke-width="2"/>${star(39, 33, 5.5, c)}${star(41, 15, 2.6)}`,
  'f-false': c => `${note(8, 7, 24, 32)}<path d="M11 33L29 13" stroke="${c}" stroke-width="2.2"/>${badge(35, 36, c, 'cross')}`,
  'f-stale': c => `${note(8, 7, 24, 32)}<circle cx="35" cy="35" r="9.1" fill="${c}" fill-opacity="0.18"/><circle cx="35" cy="35" r="7.5" fill="${W}" stroke="${c}" stroke-width="2"/><path d="M35 31v4l2.6 1.8" stroke="${c}" stroke-width="1.8"/>`,
  'f-contradiction': c => `<g transform="rotate(-8 14 24)">${note(3, 9, 18, 26)}</g><g transform="rotate(8 34 24)">${note(25, 9, 18, 26)}</g>${badge(24, 38, c, 'bang')}`,
  'f-duplicate': c => `<path d="M19 9V7a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3h-2" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/>${note(9, 11, 23, 30)}${star(41, 39, 2.8)}`,
  'f-visible': c => `<path d="M12 19V9a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/><path d="M16 11.5H26M16 15.5H23" stroke="${G}" stroke-opacity="0.65" stroke-width="2"/>${folder(4, 17, 36, 25, G)}${badge(37, 37, c, 'tick')}`,
  'f-scope': c => `${note(4, 8, 20, 26)}<path d="M25 21h8M30 17.5l3.6 3.5-3.6 3.5" stroke="${c}" stroke-width="2"/>${folder(26, 28, 19, 15, c)}`,
  'f-replace': c => `${note(5, 7, 20, 30, G, [0.85, 0.9, 0.75])}<path d="M27 22h5M29.5 19.5l2.5 2.5-2.5 2.5" stroke="${c}" stroke-width="1.8"/>`
    + `<rect x="34" y="14" width="11" height="16" rx="3" fill="${c}" fill-opacity="0.16" stroke="${c}" stroke-width="1.6"/><path d="M37 20H42M37 24.5H40.5" stroke="${c}" stroke-width="1.8"/>${star(40, 38, 3)}`,
  'f-over-cap': c => `<rect x="10" y="4" width="24" height="40" rx="4" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.6" stroke-width="1.6"/>`
    + [10, 15.5, 21, 26.5].map((y, i) => `<path d="M14.5 ${y}H${[29, 26, 30, 24][i]}" stroke="${G}" stroke-opacity="0.65" stroke-width="2"/>`).join('')
    + `<path d="M14.5 37H28M14.5 41H23" stroke="${c}" stroke-width="2"/><path d="M4 32H44" stroke="${c}" stroke-width="1.8" stroke-dasharray="3 2.6"/>${badge(40, 22, c, 'bang', 6)}`,
  'f-broken-link': c => `<path d="M21 17l-3-3a6 6 0 0 0-8.5 8.5l3 3" stroke="${G}" stroke-opacity="0.75" stroke-width="3.2"/><path d="M27 31l3 3a6 6 0 0 0 8.5-8.5l-3-3" stroke="${G}" stroke-opacity="0.75" stroke-width="3.2"/>`
    + `<path d="M22 26l-5 4M26 22l4-5M20.5 22.5l-6-.8M27.5 25.5l6 .8" stroke="${c}" stroke-width="2"/>${badge(37, 39, c, 'cross', 6)}`,
  'f-orphan': c => `${note(8, 7, 24, 32)}${badge(35, 36, c, 'link')}`,
  'f-lesson': c => `${note(8, 7, 24, 32)}${badge(35, 36, c, 'tick')}${star(40, 12, 3)}`,
  'f-rejected': c => `${note(8, 7, 24, 32)}${badge(35, 36, c, 'cross')}`,
}
const NATURAL: Partial<Record<Lead, string>> = {
  'reply-bad': R, 'reply-warn': A, 'reply-none': G, 'dream-bad': R, handoff: E,
  'f-false': R, 'f-stale': A, 'f-contradiction': A, 'f-duplicate': G, 'f-visible': G, 'f-scope': T, 'f-replace': T,
  'f-over-cap': R, 'f-broken-link': R, 'f-orphan': A, 'f-rejected': G,
}

/** One tile's leading drawing at `size` px square. `tint` overrides the kind's own colour; `muted` draws it quieter
 * (loaded only when needed, a finding you kept). */
export function lead(kind: Lead, size = 40, tint?: string, muted = false): string {
  const c = muted ? G : tint ?? NATURAL[kind] ?? E
  const key = `${kind}|${size}|${c}|${muted ? 1 : 0}`
  let v = cache.get(key)
  if (!v) {
    const body = DRAW[kind](c)
    v = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">${muted ? `<g opacity="0.6">${body}</g>` : body}</svg>`
    if (cache.size < 96) cache.set(key, v)
  }
  return v
}
/** For tests: how many lead drawings are cached (bounded at 96). */
export const cachedLeads = () => cache.size
