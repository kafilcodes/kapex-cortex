// Kapex Emerald tokens that follow Claude Code's own light or dark mode. The pane is opened with a transparent
// background, so Claude Code's canvas shows through; cards and pills are a see-through grey that reads as a step up
// in both modes; text uses the app's own theme colours. Emerald, amber and rose are mid-tones legible on both.
// Colour carries meaning only: emerald = healthy/active, amber = needs you soon, rose = blocked/expired.
export const K = {
  canvas: 'transparent',
  card: 'rgba(127,127,127,0.07)', // a bento card: one step up from the app's canvas
  pill: 'rgba(127,127,127,0.11)', // inner pills, tracks, cells
  hairline: 'rgba(127,127,127,0.20)', // 1px card borders
  emerald: '#10B981', // brand, healthy, primary fills, headings, the active tab
  sage: '#34D399', // secondary accent, cache warmth, positive deltas
  pine: '#047857', // deeper emerald for fills that need contrast in light mode
  amber: '#F59E0B', // near compaction, waiting for review
  rose: '#F43F5E', // blocked, delete, cold cache
  text: 'text', // the app's primary text colour (theme key)
  label: 'subtle', // secondary text (theme key)
  muted: 'inactive', // timestamps, captions (theme key)
  silver: '#9CA3AF', // a neutral that reads on both modes (charts only)
  ink: '#8B929B', // chart labels inside SVG: mid-grey, readable on light and dark
} as const

/** Each memory type has its own colour, used everywhere that type appears. */
export const TYPE_COLOR: Record<string, string> = {
  invariant: K.emerald, fact: '#0EA5A4', decision: '#14B8A6', preference: K.sage, lesson: '#22C55E', failed: K.rose, promoted: K.silver, pending: K.amber,
}
export const TYPE_LABEL: Record<string, string> = {
  invariant: 'Rule', fact: 'Fact', decision: 'Decision', preference: 'Preference', lesson: 'Lesson', failed: 'Failed', promoted: 'In CLAUDE.md', pending: 'Waiting',
}

/** Emerald when fine, amber when getting full, rose when (nearly) out. */
export const levelColor = (share: number, warn = 0.6, danger = 0.85) => (share >= danger ? K.rose : share >= warn ? K.amber : K.emerald)

/** Escape text for use inside SVG markup. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"`

/** What "Resume" sends: plain words (a prompt starting with "/" is refused, it would run a command as you), which the
 * cortex-resume skill picks up. */
export const RESUME = 'Resume from the Kapex Cortex handoff: read .vault/STATE.md and continue from where we left off.'
