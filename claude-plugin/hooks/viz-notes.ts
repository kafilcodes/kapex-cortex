// The Memory check's summary drawings, each a form no other page uses:
//   noteStrip   every memory note as one tick in a single strip, in the colour of what became of it, so a problem
//               stands out among the notes that hold up
//   checkDots   the last checks as dots on a line, oldest on the left, each as big as what it found and in the colour
//               of what became of it; a clean check is a small open ring
import { esc, FONT, K } from './theme'

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
export const NOTE_COLORS = { ok: K.emerald, open: K.amber, fixed: '#14B8A6', kept: '#9CA3AF' } as const

/** One tick per note (grouped into wider bars past ~180 notes, so it stays a strip, not a smear). The ticks that need
 * you come first, then the fixed and kept ones, then the notes that hold up. */
export function noteStrip(o: { total: number; open: number; fixed: number; kept: number; width: number }): string {
  const W = Math.max(160, Math.round(o.width)), H = 30
  const total = Math.max(0, o.total)
  const open = Math.min(total, Math.max(0, o.open)), fixed = Math.min(total - open, Math.max(0, o.fixed)), kept = Math.min(total - open - fixed, Math.max(0, o.kept))
  if (!total) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect y="11" width="${W}" height="8" rx="4" fill="${K.pill}"/></svg>`
  const per = Math.max(1, Math.ceil(total / Math.floor(W / 3.2))) // notes per tick
  const ticks = Math.ceil(total / per), step = W / ticks, tw = Math.max(1.2, step * 0.62)
  const kindAt = (i: number) => { const n = i * per; return n < open ? 'open' : n < open + fixed ? 'fixed' : n < open + fixed + kept ? 'kept' : 'ok' }
  let body = ''
  for (let i = 0; i < ticks; i++) {
    const kd = kindAt(i), tall = kd !== 'ok'
    body += `<rect x="${f1(i * step)}" y="${tall ? 2 : 7}" width="${f1(tw)}" height="${tall ? 26 : 16}" rx="${f1(Math.min(1.5, tw / 2))}" fill="${NOTE_COLORS[kd]}" fill-opacity="${tall ? 1 : 0.55}"/>`
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><title>${esc(`${total} memory notes: ${total - open - fixed - kept} hold up, ${open} waiting for you, ${fixed} fixed, ${kept} kept`)}</title>${body}</svg>`
}

export type CheckDot = { found: number; status: 'clean' | 'waiting' | 'fixed' | 'dropped' | 'failed'; title: string; when: string }
const DOT: Record<CheckDot['status'], string> = { clean: K.emerald, waiting: K.amber, fixed: '#14B8A6', dropped: '#9CA3AF', failed: K.rose }

/** The last checks on one line, oldest on the left: a dot as big as what the check found, a clean check a small ring. */
export function checkDots(o: { checks: CheckDot[]; width: number }): string {
  const W = Math.max(160, Math.round(o.width)), H = 52, cy = 20, n = o.checks.length
  if (!n) return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><text x="0" y="${cy + 4}" ${FONT} font-size="11" fill="${K.ink}">No checks yet</text></svg>`
  const max = Math.max(1, ...o.checks.map(c => c.found)), pad = 14
  const x = (i: number) => (n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1))
  const line = `<line x1="${pad}" y1="${cy}" x2="${W - pad}" y2="${cy}" stroke="${K.hairline}" stroke-width="1.5"/>`
  const dots = o.checks.map((c, i) => {
    const r = c.found ? 4 + 7 * Math.sqrt(c.found / max) : 4
    const shape = c.found
      ? `<circle cx="${f1(x(i))}" cy="${cy}" r="${f1(r)}" fill="${DOT[c.status]}" fill-opacity="0.9"/>${c.found > 1 && r >= 8 ? `<text x="${f1(x(i))}" y="${cy + 3.5}" text-anchor="middle" ${FONT} font-size="10" font-weight="700" fill="#05130D">${c.found}</text>` : ''}`
      : `<circle cx="${f1(x(i))}" cy="${cy}" r="4" fill="none" stroke="${DOT[c.status]}" stroke-width="2"/>`
    return `<g><title>${esc(c.title)}</title>${shape}</g>`
  }).join('')
  const first = o.checks[0]!, last = o.checks[n - 1]!
  const labels = `<text x="${pad}" y="${H - 4}" ${FONT} font-size="10" fill="${K.ink}">${esc(first.when)}</text>`
    + (n > 1 ? `<text x="${W - pad}" y="${H - 4}" text-anchor="end" ${FONT} font-size="10" fill="${K.ink}">${esc(last.when)}</text>` : '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${line}${dots}${labels}</svg>`
}
