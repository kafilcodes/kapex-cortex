// What people typed, made fit for a heading: Timeline titles, the Last turn lines, a handoff's goal. Raw prompt text
// carries backticks, markdown marks, slash commands, "(pasted)" markers, @file attachments and system notices; none
// of that belongs in a title. tidy() keeps the first sentence (or `n` characters, cut on a word); `full` keeps all of
// it, cleaned, for an opened tile.

/** System notices Claude Code writes into a turn, said as a short plain phrase. */
const NOTICES: [RegExp, string][] = [
  [/^(?:<[^>]+>\s*)*background (?:task|agent|command|bash)\b[^]*?\b(?:finished|completed|failed|done)\b/i, 'A background task finished'],
  [/^(?:<[^>]+>\s*)*(?:a )?background (?:task|agent|command)/i, 'A background task finished'],
  [/^\[?request interrupted by user[^\]]*\]?/i, 'You stopped the reply'],
  [/^this session is being continued from a previous conversation/i, 'Continued from an earlier chat'],
  [/^caveat: the messages below were generated/i, 'A command you ran locally'],
]
/** A leading slash command, said as what it did (the rest of the line, if any, is what you asked). */
const COMMANDS: Record<string, string> = { 'cortex-resume': 'Picked up from the handoff', 'cortex-handoff': 'Saved a handoff', clear: 'Cleared the chat', compact: 'Summarized the chat', model: 'Switched model' }

/** Sentences that carry on with the work rather than say it ("Continue:", "The 5-hour limit has reset", "Read
 * .vault/STATE.md first", "we are continuing from yesterday"): dropped from the front of a title (src/core/brief.ts
 * drops them from the handoff goal the same way). */
const CONTINUES = /^(?:(?:hey|hi|ok(?:ay)?|yes|so|now|alright)\b[\s,.!:-]*)*(?:please\s+)?(?:continue|resume|proceed|carry on|go on|keep going|pick (?:it )?up|let'?s continue|we(?:'re| are) continuing|(?:the )?(?:5|five)[- ]hour limit (?:has |is )?reset|(?:the |my |our )?(?:usage |rate )?limits? (?:has |have |is |are )?(?:been )?reset|(?:first,?\s*)?read [`"]?\.vault\/STATE\.md|resume from the kapex cortex handoff)\b/i
/** What may follow a lead-in for its sentence to be only a continuation: punctuation, a bracket, the end, or filler
 * ("Continue: …", "continue (we are back…", "we are continuing from…", "Read .vault/STATE.md first…"). Anything else
 * ("Continue building the export", "Resume work on the webhook") is the task itself and is kept whole. Same rule as
 * withoutLeadIn in src/core/brief.ts (the handoff goal). */
const FILLER = /^\s*[`"']?\s*(?:[.!?;:,(\-–—]|$|(?:from|where|after|again|first|now|and|so|please|then)\b)/i
function leadIn(text: string): string {
  let t = text.trim()
  for (let i = 0; i < 6; i++) {
    const m = CONTINUES.exec(t)
    if (!m) break
    const rest = t.slice(m[0].length)
    if (!FILLER.test(rest)) break
    const end = /[.!?;:](?=\s|$)|\n/.exec(rest)
    const sentence = end ? rest.slice(0, end.index) : rest
    // "…first, then fix the login test" / "…and now add the heatmap": what follows then/now in it is the task
    const turn = /(?:^|[\s,;(])(?:and\s+)?(?:then|now)\s+(?!(?:continue|carry on|go on|proceed|resume)\b)/i.exec(sentence)
    if (turn) { t = (sentence.slice(turn.index + turn[0].length) + (end ? rest.slice(end.index) : '')).trim(); continue }
    t = end ? rest.slice(end.index + 1).trim() : ''
  }
  return t
}

export function clean(text: string): string {
  let t = (text ?? '').replace(/\r/g, '')
  for (const [re, said] of NOTICES) if (re.test(t.trim())) return said
  t = t.replace(/\(pasted(?: text)?\)\s*/gi, ' ')
    .replace(/@"[^"]*"/g, ' ').replace(/(^|\s)@[^\s]+/g, ' ') // attachments are file names, not what you asked
    .replace(/<[^>]{1,40}>/g, ' ') // stray tags
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [words](link) → words
    .replace(/```[^]*?```/g, ' ').replace(/`+/g, '') // code fences and backticks
    .replace(/(^|\n)\s*(?:#{1,6}|>|[-*+]|\d+[.)])\s+/g, '$1') // headings, quotes, list marks
    .replace(/\*\*|__|(?<![\w])[*_](?=\S)|(?<=\S)[*_](?![\w])/g, '') // bold and italic marks
    .replace(/\s+/g, ' ').replace(/\s+([:;,.!?])(?=\s|$)/g, '$1').trim()
  const cmd = /^\/([\w:-]+)\s*/.exec(t)
  if (cmd) {
    const rest = t.slice(cmd[0].length).trim()
    t = rest || COMMANDS[cmd[1]!.split(':').pop()!] || `Ran /${cmd[1]}`
  }
  if (CONTINUES.test(t)) { const rest = leadIn(t); if (!rest) return 'Carried on where it stopped'; t = rest }
  t = t.replace(/^[\s:;,.·•–-]+/, '').replace(/^(?:the |my |our )?goal\s*[:：-]\s*/i, '') // "Goal: …" you wrote: the card says Goal itself
  // capitalised like a sentence, unless the first word is a name or version (v3.8.2, npm, iOS)
  return /^[a-z]+(?=[\s,.:;!?]|$)/.test(t) && !/^(?:npm|npx|pnpm|yarn|bun|git|gh|node|kc|tsc|claude)\b/.test(t) ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

/** The first sentence, or `n` characters cut on a word with …; `full` keeps the whole text (cleaned). */
export function tidy(text: string | undefined, n = 90, full = false): string {
  const t = clean(text ?? '')
  if (full) return t
  const first = /^(.+?[.!?])(?=\s+[A-Z(“"'])/.exec(t)?.[1] ?? t
  const one = first.length >= 12 ? first : t
  // text an older journal cut mid-way ("…our uncommitted +1,") ends on a dangling mark: say it trails off
  const cut = one.length <= n ? (/[,;:(\[–-]$/.test(one) ? `${one.replace(/[\s,;:(\[–-]+$/, '')}…` : one) : `${one.slice(0, n).replace(/\s+\S*$/, '').replace(/[,;:–-]+$/, '')}…`
  return cut.replace(/(?:\.{2,}|…)+(?:\s*…)+$/, '…').replace(/\.{3,}/g, '…')
}
