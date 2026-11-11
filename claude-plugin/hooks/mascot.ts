// Cortex's mascot: a small emerald robot drawn here (no third-party art). Five moods for Overview, chosen from Cortex's
// own status, and one scene per page. All static: no animation, no timers. Each drawing is built once per size and
// kept in a small cache, so drawing the panel again costs a Map lookup. Neutral parts are grey at part opacity and
// the face is a dark screen, so it reads on Claude Code's light and dark canvas alike.
import { K } from './theme'

export type Mood = 'hi' | 'calm' | 'working' | 'stressed' | 'dream'
export type Scene = 'timeline' | 'dream' | 'memory' | 'costs' | 'settings'

const E = K.emerald, S = K.sage, A = K.amber, R = K.rose
const G = '#9CA3AF', SCREEN = '#1F2937', GLOW = '#34D399'
const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"`
const cache = new Map<string, string>()
const memo = (key: string, make: () => string) => { let v = cache.get(key); if (!v) { v = make(); if (cache.size < 64) cache.set(key, v) } return v }
const wrap = (w: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${Math.round(w * 0.7)}" viewBox="0 0 200 140" fill="none" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

type Eyes = 'open' | 'happy' | 'focus' | 'stress' | 'sleep'
type Mouth = 'smile' | 'grin' | 'flat' | 'wavy' | 'o'
type Arms = 'down' | 'wave' | 'front' | 'up' | 'rest'

const eye = (x: number, kind: Eyes) => {
  const y = 53
  switch (kind) {
    case 'open': return `<circle cx="${x}" cy="${y}" r="4.2" fill="${GLOW}"/>`
    case 'happy': return `<path d="M${x - 4.5} ${y + 2}Q${x} ${y - 4} ${x + 4.5} ${y + 2}" stroke="${GLOW}" stroke-width="2.6"/>`
    case 'focus': return `<rect x="${x - 4.5}" y="${y - 1.6}" width="9" height="3.2" rx="1.6" fill="${GLOW}"/>`
    case 'stress': return `<circle cx="${x}" cy="${y}" r="4.8" stroke="${A}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="1.6" fill="${A}"/>`
    case 'sleep': return `<path d="M${x - 4.5} ${y - 1}Q${x} ${y + 4} ${x + 4.5} ${y - 1}" stroke="${S}" stroke-width="2.4"/>`
  }
}
const mouth = (kind: Mouth) => ({
  smile: `<path d="M95 61.5Q100 65.5 105 61.5" stroke="${GLOW}" stroke-width="2.2"/>`,
  grin: `<path d="M94.5 60.5Q100 68 105.5 60.5Z" fill="${GLOW}"/>`,
  flat: `<path d="M96 62.5H104" stroke="${GLOW}" stroke-width="2.2"/>`,
  wavy: `<path d="M93.5 63q1.6-2.4 3.2 0t3.3 0 3.3 0 3.2 0" stroke="${A}" stroke-width="2"/>`,
  o: `<circle cx="100" cy="62.5" r="1.8" fill="${S}"/>`,
})[kind]
const arm = (d: string, hx: number, hy: number) => `<path d="${d}" stroke="${E}" stroke-width="5"/><circle cx="${hx}" cy="${hy}" r="5" fill="${E}"/>`
const arms = (kind: Arms) => ({
  down: arm('M78 92Q70 101 66 109', 65, 111) + arm('M122 92Q130 101 134 109', 135, 111),
  wave: arm('M78 92Q70 101 66 109', 65, 111) + arm('M122 90Q140 82 146 64', 147, 60) + `<path d="M155 52q4 4 2 10M160 48q6 7 3 16" stroke="${S}" stroke-width="2" stroke-opacity="0.8"/>`,
  front: arm('M79 93Q74 104 86 108', 88, 108) + arm('M121 93Q126 104 114 108', 112, 108),
  up: arm('M78 90Q62 80 58 64', 57, 60) + arm('M122 90Q138 80 142 64', 143, 60),
  rest: arm('M78 90Q60 76 66 54', 67, 52) + arm('M122 90Q140 76 134 54', 133, 52),
})[kind]

/** The robot: arms that sit behind the head are drawn first, then body, head and face. */
function bot(o: { eyes: Eyes; mouth: Mouth; arms: Arms; antenna?: string }): string {
  const behind = o.arms === 'rest' ? arms('rest') : ''
  const front = o.arms === 'rest' ? '' : arms(o.arms)
  return `<ellipse cx="100" cy="131" rx="34" ry="4.5" fill="${G}" fill-opacity="0.22"/>${behind}`
    + `<rect x="84" y="118" width="10" height="10" rx="4" fill="${E}" fill-opacity="0.55"/><rect x="106" y="118" width="10" height="10" rx="4" fill="${E}" fill-opacity="0.55"/>`
    + `<rect x="76" y="82" width="48" height="38" rx="13" fill="${E}" fill-opacity="0.16" stroke="${E}" stroke-width="2.5"/>`
    + `<circle cx="100" cy="99" r="4.5" fill="${o.antenna ?? E}" fill-opacity="0.9"/><path d="M90 109H110" stroke="${E}" stroke-opacity="0.5" stroke-width="2"/>`
    + `<rect x="94" y="76" width="12" height="7" fill="${E}" fill-opacity="0.4"/>`
    + `<path d="M100 30V19" stroke="${E}" stroke-width="2.5"/><circle cx="100" cy="15" r="4.5" fill="${o.antenna ?? S}"/>`
    + `<rect x="60" y="46" width="7" height="16" rx="3.5" fill="${E}"/><rect x="133" y="46" width="7" height="16" rx="3.5" fill="${E}"/>`
    + `<rect x="66" y="30" width="68" height="48" rx="16" fill="${E}" fill-opacity="0.16" stroke="${E}" stroke-width="2.5"/>`
    + `<rect x="74" y="39" width="52" height="30" rx="11" fill="${SCREEN}"/>${eye(88, o.eyes)}${eye(112, o.eyes)}${mouth(o.mouth)}${front}`
}
const star = (x: number, y: number, s: number, c: string = S) => `<path d="M${x} ${y - s}L${x + s * 0.3} ${y - s * 0.3}L${x + s} ${y}L${x + s * 0.3} ${y + s * 0.3}L${x} ${y + s}L${x - s * 0.3} ${y + s * 0.3}L${x - s} ${y}L${x - s * 0.3} ${y - s * 0.3}Z" fill="${c}"/>`
const note = (x: number, y: number, w = 30, h = 36) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="${G}" fill-opacity="0.12" stroke="${G}" stroke-opacity="0.55" stroke-width="2"/><path d="M${x + 6} ${y + 10}H${x + w - 8}M${x + 6} ${y + 18}H${x + w - 6}M${x + 6} ${y + 26}H${x + w - 12}" stroke="${G}" stroke-opacity="0.6" stroke-width="2.4"/>`
const moon = (x: number, y: number) => `<path d="M${x} ${y - 13}a13 13 0 1 0 14 17a10.5 10.5 0 0 1-14-17z" fill="${E}" fill-opacity="0.85"/>`
const lens = (x: number, y: number) => `<circle cx="${x}" cy="${y}" r="10" fill="${E}" fill-opacity="0.12" stroke="${E}" stroke-width="3"/><path d="M${x + 7} ${y + 7}l8 8" stroke="${E}" stroke-width="3.5"/>`
const gear = (x: number, y: number, r: number, c: string) => `<circle cx="${x}" cy="${y}" r="${r}" stroke="${c}" stroke-width="${r * 0.42}" stroke-dasharray="${(r * 0.55).toFixed(1)} ${(r * 0.42).toFixed(1)}"/><circle cx="${x}" cy="${y}" r="${r * 0.62}" stroke="${c}" stroke-width="2.4"/><circle cx="${x}" cy="${y}" r="${r * 0.22}" fill="${c}"/>`

const MOODS: Record<Mood, () => string> = {
  // a new chat: waving, with a hello
  hi: () => `<rect x="18" y="14" width="46" height="26" rx="12" fill="${E}" fill-opacity="0.14" stroke="${E}" stroke-width="2"/><path d="M50 40l-2 8 10-8" fill="${E}" fill-opacity="0.14" stroke="${E}" stroke-width="2"/><text x="41" y="32" text-anchor="middle" ${FONT} font-size="13" font-weight="700" fill="${E}">Hi!</text>${bot({ eyes: 'open', mouth: 'grin', arms: 'wave' })}${star(176, 30, 4)}`,
  // all good: hands behind the head, a plant, a tick
  calm: () => `<circle cx="38" cy="40" r="13" fill="${E}" fill-opacity="0.16"/><path d="M32 40l4.5 4.5 8-9" stroke="${E}" stroke-width="2.8"/>${bot({ eyes: 'happy', mouth: 'smile', arms: 'rest' })}<rect x="150" y="112" width="20" height="16" rx="3" fill="${G}" fill-opacity="0.35"/><path d="M160 112c0-12 4-18 12-20M160 112c-1-9-5-14-12-15M160 112v-16" stroke="${E}" stroke-width="2.4"/>${star(176, 36, 3.5)}`,
  // something needs watching: at the laptop, a gear turning (drawn still)
  working: () => `${bot({ eyes: 'focus', mouth: 'flat', arms: 'front' })}<rect x="78" y="88" width="44" height="27" rx="3" fill="${SCREEN}" stroke="${G}" stroke-opacity="0.6" stroke-width="2"/><path d="M85 96H101M85 102H109M85 108H97" stroke="${GLOW}" stroke-width="2.2"/><path d="M112 107h2" stroke="${A}" stroke-width="2.6"/><rect x="70" y="114" width="60" height="5" rx="2.5" fill="${G}" fill-opacity="0.6"/>${gear(158, 36, 11, A)}${gear(176, 54, 6.5, G)}`,
  // red: time to hand off. Arms up, a drop of sweat, a warning
  stressed: () => `<path d="M38 22L54 50H22Z" fill="${R}" fill-opacity="0.16" stroke="${R}" stroke-width="2.4"/><path d="M38 32v8" stroke="${R}" stroke-width="2.6"/><circle cx="38" cy="45" r="1.6" fill="${R}"/>${bot({ eyes: 'stress', mouth: 'wavy', arms: 'up', antenna: R })}<path d="M150 34c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z" fill="#93C5FD" fill-opacity="0.85"/>`,
  // time for a Dream: asleep, auditing notes under the moon
  dream: () => `${moon(40, 34)}${star(64, 22, 3.5)}${star(22, 60, 2.6, E)}${note(26, 86, 28, 34)}${bot({ eyes: 'sleep', mouth: 'o', arms: 'down' })}${lens(152, 98)}<text x="146" y="34" ${FONT} font-size="14" font-weight="700" fill="${S}">z</text><text x="157" y="24" ${FONT} font-size="11" font-weight="700" fill="${S}" fill-opacity="0.7">z</text>`,
}

const SCENES: Record<Scene, () => string> = {
  timeline: () => `<g transform="translate(-30 0)">${bot({ eyes: 'open', mouth: 'smile', arms: 'wave' })}</g><path d="M164 20V124" stroke="${G}" stroke-opacity="0.5" stroke-width="2.4"/>${[[34, E], [64, S], [94, A], [118, G]].map(([y, c]) => `<circle cx="164" cy="${y}" r="5.5" fill="${c}"/><rect x="174" y="${Number(y) - 5}" width="20" height="10" rx="4" fill="${G}" fill-opacity="0.3"/>`).join('')}`,
  dream: () => MOODS.dream(),
  memory: () => `<g transform="translate(-26 0)">${bot({ eyes: 'happy', mouth: 'smile', arms: 'down' })}</g>${note(140, 40, 36, 44)}${note(150, 54, 36, 44)}<circle cx="182" cy="104" r="11" fill="${E}"/><path d="M176.5 104l4 4 7-8" stroke="#fff" stroke-width="2.6"/>${star(140, 26, 3.5)}`,
  costs: () => `<g transform="translate(-28 0)">${bot({ eyes: 'focus', mouth: 'smile', arms: 'down' })}</g>${[0, 1, 2, 3].map(i => `<ellipse cx="150" cy="${120 - i * 8}" rx="13" ry="4.5" fill="${A}" fill-opacity="${0.35 + i * 0.12}" stroke="${A}" stroke-width="1.6"/>`).join('')}<path d="M172 120V92M182 120V74M192 120V100" stroke="${E}" stroke-width="7"/>${star(176, 54, 3.5)}`,
  settings: () => `<g transform="translate(-28 0)">${bot({ eyes: 'open', mouth: 'smile', arms: 'down' })}</g>${gear(160, 50, 16, E)}${gear(186, 30, 8, S)}<path d="M140 92H192M140 106H192M140 120H192" stroke="${G}" stroke-opacity="0.45" stroke-width="3"/><circle cx="160" cy="92" r="5" fill="${E}"/><circle cx="178" cy="106" r="5" fill="${S}"/><circle cx="150" cy="120" r="5" fill="${E}"/>`,
}

/** Overview's mood drawing at `width` px (height is 70% of it). */
export const moodSvg = (mood: Mood, width = 150) => memo(`m-${mood}-${Math.round(width)}`, () => wrap(width, MOODS[mood]()))
/** A page's scene drawing at `width` px. */
export const sceneSvg = (scene: Scene, width = 120) => memo(`s-${scene}-${Math.round(width)}`, () => wrap(width, SCENES[scene]()))
/** For tests: how many drawings are cached (bounded at 64). */
export const cachedDrawings = () => cache.size
