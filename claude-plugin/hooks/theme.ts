// Kapex Emerald tokens that follow Claude Code's own light or dark mode. The pane is opened with a transparent
// background, so Claude Code's canvas shows through; cards and pills are a see-through grey that reads as a step up
// in both modes; text uses the app's own theme colours. Emerald, amber and rose are mid-tones legible on both.
// Colour carries meaning only: emerald = healthy/active, amber = needs you soon, rose = blocked/expired.
export const K = {
  canvas: 'transparent',
  card: 'rgba(127,127,127,0.07)', // a bento card: one step up from the app's canvas
  pill: 'rgba(127,127,127,0.11)', // inner pills, tracks, cells
  hairline: 'rgba(127,127,127,0.20)', // 1px card borders
  edge: 'rgba(127,127,127,0.13)', // softer 1px edge on inner tiles, so their rounded corners match the cards
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

/** Width of a line of SVG text in px, from the system font's own character widths (measured from -apple-system at
 * 11 px in Chromium, which Claude Desktop is; per 1000 em, printable ASCII in order). One width for every character
 * left uneven gaps: "cache till 1:08" is mostly narrow letters. */
const W400 = [287,317,483,636,636,931,717,303,388,388,478,636,303,478,303,311,636,470,609,633,649,624,643,575,645,643,303,303,636,636,636,519,924,680,663,722,732,602,578,752,748,273,544,665,574,880,748,777,641,777,659,643,640,743,680,974,685,661,667,388,311,388,636,589,506,558,620,565,620,577,368,615,594,253,252,549,259,876,589,597,616,615,387,529,369,589,548,780,530,549,545,388,265,388,636]
const W600 = [271,347,544,664,664,1005,739,336,419,419,486,664,336,486,336,331,672,501,636,661,678,654,674,599,681,674,336,336,664,664,664,548,930,719,687,739,746,619,595,762,775,307,586,698,592,901,765,787,667,787,687,668,657,758,711,1001,718,696,677,419,331,419,664,619,506,583,645,584,645,597,398,639,624,280,279,588,287,917,619,616,641,641,423,558,402,619,575,829,568,585,563,419,292,419,664]
const WIDE: Record<string, number> = { '·': 303, '…': 811, '→': 912, '↻': 824 }
export function textWidth(t: string, size = 11, weight = 400): number {
  const tbl = weight >= 600 ? W600 : W400
  let w = 0
  for (const ch of t) { const c = ch.charCodeAt(0); w += c >= 32 && c < 127 ? tbl[c - 32]! : WIDE[ch] ?? 1000 }
  return (w / 1000) * size
}

export const FONT = `font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif"`

/** What "Resume" sends: plain words (a prompt starting with "/" is refused, it would run a command as you), which the
 * cortex-resume skill picks up. */
export const RESUME = 'Resume from the Kapex Cortex handoff: read .vault/STATE.md and continue from where we left off.'

/** What "Check with fresh eyes" sends: a Goldfish check (from Google's Elephant-Goldfish model). A subagent that shares
 * none of this chat's assumptions reads only the handoff and the files it names, and says where a stranger would stall;
 * this chat (the Elephant) then fixes the handoff. Nothing is added to later messages. */
export const GOLDFISH = 'Fresh-eyes check of the Kapex Cortex handoff: start a new subagent (general-purpose, not a fork of this chat) that knows nothing of our conversation. Tell it to read only .vault/STATE.md and the files it names, then reply in at most 8 bullets: what it could not act on without asking (a vague goal or next action, a missing path, a term it can\'t find in the code, a check it can\'t run), then one line: "Ready" or "Not ready". Show me its report, then fix each gap with /cortex-handoff (a sharper goal, next action and decisions).'
