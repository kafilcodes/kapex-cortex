import type { ElementTable } from 'claude-code'
import { clearSvg, pageScene } from './mascot'

import type { AskView, DreamView, FindingView, StatusView, ViewState } from '../types'
import { ask, askRow } from './ask'
import { act, ago, minsSince, type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { checkDots, noteStrip, NOTE_COLORS, type CheckDot } from './viz-notes'
import { tiles } from './tiles'
import type { Lead } from './leads'
import { companion } from './blocky'

// The Dream page: run one, see what it found with the evidence for each finding, then Apply (all or what you
// kept), Discard, or Undo an applied one. Nothing changes until you press Apply; every Apply can be undone.
export const KIND: Record<string, { label: string; icon: string; color: string }> = {
  false: { label: 'Not true', icon: 'cross', color: K.rose },
  stale: { label: 'Out of date', icon: 'pending', color: K.amber },
  contradiction: { label: 'Contradiction', icon: 'alert', color: K.amber },
  duplicate: { label: 'Duplicate', icon: 'promoted', color: K.silver },
  visible: { label: 'Already in the repo', icon: 'file', color: K.silver },
  scope: { label: 'Only for some files', icon: 'move', color: '#14B8A6' },
  replace: { label: 'Shorter version', icon: 'turn', color: '#14B8A6' },
  'over-cap': { label: 'Too long', icon: 'alert', color: K.rose },
  'broken-link': { label: 'Broken link', icon: 'link', color: K.rose },
  orphan: { label: 'Not in the index', icon: 'link', color: K.amber },
  lesson: { label: 'Verified lesson', icon: 'lesson', color: K.emerald },
}
/** each finding's leading drawing, in words */
const LEAD_ALT: Record<string, string> = {
  'f-false': 'A note crossed out: not true', 'f-stale': 'A note with a clock: out of date', 'f-contradiction': 'Two notes that disagree',
  'f-duplicate': 'Two copies of the same note', 'f-visible': 'A note already in the project files', 'f-scope': 'A note moving to a folder',
  'f-replace': 'A long note made shorter', 'f-over-cap': 'A note running past its line limit', 'f-broken-link': 'A broken link',
  'f-orphan': 'A note missing from the index', 'f-lesson': 'A note with a tick: a verified lesson',
}
const ORDER = { high: 0, medium: 1, low: 2 }
const STATUS: Record<string, string> = { applied: 'Applied', proposed: 'Waiting for you', discarded: 'Discarded', undone: 'Undone', failed: 'Failed', replaced: 'Replaced' }
const doing = (f: FindingView) => f.action.op === 'delete' ? 'Remove the line' : f.action.op === 'replace' ? `Rewrite as: "${f.action.text}"` : f.action.op === 'move' ? `Move to ${f.action.to} (loads only for ${(f.action.paths ?? []).join(', ')})` : f.action.op === 'add-index' ? `Add to MEMORY.md: ${f.action.text}` : f.action.op === 'add-lesson' ? `Add to auto memory: "${f.action.text}"` : 'Yours to decide: remove the line, keep it, or ask Claude to rewrite it'
/** What "Ask Claude" sends: you press it, so it's your prompt; Claude edits the note with its own tools, as you'd ask. */
const askFix = (f: FindingView) => !f.entry ? `Kapex Cortex flagged ${f.label}: ${f.why} Shorten it without losing any rule that still applies (move details that only matter for some folders into .claude/rules/ files with paths: frontmatter), and tell me what you changed.` : `Kapex Cortex flagged a memory note as out of date. In ${f.label}${f.line ? ` line ${f.line}` : ''}: "${f.entry.replace(/\s+/g, ' ').slice(0, 300)}". Why: ${f.why} Update that note so it matches the project as it is now (or remove it if it no longer applies), and tell me what you changed.`

/** Cortex's pick for a note that is yours to decide, shown beside the buttons before you choose (never after). A stale
 * note that still names something real is part right, so a rewrite keeps what holds; a note that is wrong, repeated or
 * already in the project files can go. */
export function suggestFor(d: DreamView, f: FindingView): { pick: 'apply' | 'remove' | 'ask' | 'keep'; text: string } {
  if (f.action.op !== 'none' && !f.skip) {
    const a = f.action
    return { pick: 'apply', text: a.op === 'delete' ? 'remove the line.' : a.op === 'replace' ? `rewrite it as “${a.text ?? ''}”` : a.op === 'move' ? `move it to ${a.to} (it loads only for ${(a.paths ?? []).join(', ')}).` : a.op === 'add-index' ? 'list it in MEMORY.md, so Claude knows to read it.' : 'add it to auto memory as a lesson.' }
  }
  const canRemove = !!f.line && d.files.some(x => x.path === f.file)
  if (canRemove && ['false', 'duplicate', 'visible', 'broken-link'].includes(f.kind)) return { pick: 'remove', text: f.kind === 'duplicate' ? 'remove the line: another note already says it.' : f.kind === 'visible' ? 'remove the line: the project files already say it.' : 'remove the line: it no longer matches the project.' }
  if (f.entry || f.kind === 'over-cap') return { pick: 'ask', text: f.kind === 'over-cap' ? 'ask Claude to shorten it, keeping every rule that still applies.' : 'ask Claude to rewrite it: part of it may still hold.' }
  return { pick: 'keep', text: 'keep it: there is nothing here to fix by itself.' }
}
/** What a decided finding did, in words: "Removed line 9 from memory/release-tooling.md". */
export function outcomeText(f: FindingView): string {
  const at = `${f.line ? `line ${f.line} ` : ''}${f.line ? 'in' : 'to'} ${f.label}`
  if (f.done === 'kept') return `Kept as it is: ${f.label}${f.line ? ` line ${f.line}` : ''}`
  return f.action.op === 'delete' ? `Removed line ${f.line} from ${f.label}` : f.action.op === 'replace' ? `Rewrote ${at}` : f.action.op === 'move' ? `Moved to ${f.action.to}` : f.action.op === 'add-index' ? 'Added to MEMORY.md' : f.action.op === 'add-lesson' ? 'Added a lesson to auto memory' : `Fixed ${f.label}`
}
/** The one fix an earlier check applied, when it applied just one (its tile then says what it did). */
const oneFix = (d: DreamView) => { const a = d.findings.filter(f => f.done === 'applied'); return a.length === 1 ? a[0] : d.findings.length === 1 ? d.findings[0] : undefined }
/** A fix's icon and colour: what was done to the note. */
function fixIcon(f: FindingView): [string, string] {
  if (f.done === 'kept') return ['pending', K.silver]
  const op = f.done ? f.action.op : 'none'
  return op === 'delete' ? ['minus', '#14B8A6'] : op === 'replace' ? ['pen', '#14B8A6'] : op === 'move' ? ['move', '#14B8A6'] : op === 'add-index' || op === 'add-lesson' ? ['plus', K.emerald] : [(KIND[f.kind] ?? KIND.stale!).icon, (KIND[f.kind] ?? KIND.stale!).color]
}
/** What was done, in a few words (the file and line go on the line below). */
function fixWords(f: FindingView): string {
  if (f.done === 'kept') return 'Kept as it is'
  if (!f.done) return `${(KIND[f.kind] ?? { label: f.kind }).label}: not changed`
  const op = f.action.op
  return op === 'delete' ? 'Removed the line' : op === 'replace' ? `Rewrote it as “${(f.action.text ?? '').slice(0, 80)}”` : op === 'move' ? `Moved to ${f.action.to}` : op === 'add-index' ? 'Listed it in MEMORY.md' : op === 'add-lesson' ? 'Added a lesson to auto memory' : 'Fixed'
}
/** What became of a check, for its dot on the check line. */
function dotOf(d: DreamView): CheckDot {
  const found = d.findings.length, when = ago(minsSince(d.ts))
  const status: CheckDot['status'] = d.status === 'failed' || d.error ? 'failed' : !found ? 'clean' : (d.status === 'proposed' || d.status === 'applied') && d.findings.some(f => !f.done) ? 'waiting' : d.status === 'applied' || d.findings.some(f => f.done === 'applied') ? 'fixed' : 'dropped'
  const word = { clean: 'all clear', waiting: 'waiting for you', fixed: 'fixes applied', dropped: 'nothing applied', failed: 'failed' }[status]
  return { found, status, title: `${when}: ${found} found, ${word}`, when }
}

export function dreamBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px = 800, asked: AskView | null = null): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded, px)
  const recent = s.dream?.recent ?? []
  const last = recent[0]
  const running = s.dream?.running
  const be = s.prefs?.dreamBackend ?? 'claude'
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1)
  const model = be === 'off' ? '' : be === 'claude' ? cap(s.prefs?.dreamModel || 'sonnet') : s.prefs?.dreamModel || (be === 'opencode' ? 'an OpenCode model' : 'your model')
  const n = s.prefs?.dreamTranscripts ?? 10

  const dec = (d: DreamView, f: FindingView | 'all', what: string, label: string) => { void act($, label, ['dream', 'decide', d.id, f === 'all' ? 'all' : f.id, what]) }
  const btn = (key: string, label: string, onPress: () => void, primary = false) => <Button key={key} variant={primary ? 'primary' : 'secondary'} onPress={onPress}>{label}</Button>
  // an open finding's choices, Cortex's pick first and marked as the main one
  const quickFor = (d: DreamView, f: FindingView): JSX.Element[] => {
    if (d.status !== 'proposed' && d.status !== 'applied') return []
    const pick = suggestFor(d, f).pick
    const keep = btn(`fk-${f.id}`, 'Keep', () => dec(d, f, 'keep', 'Kept'), pick === 'keep')
    if (f.action.op !== 'none' && !f.skip) return [btn(`fa-${f.id}`, 'Apply', () => dec(d, f, 'apply', 'Applied'), true), keep]
    const canRemove = !!f.line && d.files.some(x => x.path === f.file)
    const all = [
      canRemove ? { k: 'remove', b: btn(`fr-${f.id}`, 'Remove line', () => dec(d, f, 'remove', 'Removed'), pick === 'remove') } : null,
      f.entry || f.kind === 'over-cap' ? { k: 'ask', b: btn(`fc-${f.id}`, 'Ask Claude', () => { void ask($, `fix-${f.id}`, `Ask Claude to fix ${f.label}${f.line ? ` line ${f.line}` : ''}`, askFix(f)) }, pick === 'ask') } : null,
      { k: 'keep', b: keep },
    ].filter((x): x is { k: string; b: JSX.Element } => !!x)
    return [...all.filter(x => x.k === pick), ...all.filter(x => x.k !== pick)].map(x => x.b)
  }

  const findingTile = (d: DreamView, f: FindingView) => {
    const k = KIND[f.kind] ?? { label: f.kind, icon: 'spark', color: K.silver }
    const ev = new Map(d.evidence.map(e => [e.id, e]))
    const lk = (`f-${f.kind}` in LEAD_ALT ? `f-${f.kind}` : 'f-stale') as Lead
    const sug = suggestFor(d, f)
    return t.tile({
      id: `${d.id}-${f.id}`, icon: k.icon, color: f.skip ? K.muted : k.color,
      lead: { kind: lk, alt: LEAD_ALT[lk]!, muted: !!f.skip }, accent: f.severity === 'high' && !f.skip ? `${k.color}66` : undefined,
      title: f.entry ? f.entry.replace(/^\s*[-*+]\s+/, '').replace(/\s*\n\s*/g, ' ') : f.why, wrap: true, preview: f.entry ? `Why: ${f.why}` : undefined,
      time: f.line ? `line ${f.line}` : undefined,
      badges: [[k.label, k.color, k.icon], [f.label, K.label, 'file'], [f.by === 'check' ? 'Proven by a check' : 'The model\'s judgement'], f.skip ? ['Left out', K.muted] : null],
      body: [
        ...f.evidence.map(id => { const e = ev.get(id); return e ? u.tag(`fe-${f.id}-${id}`, e.kind === 'run' ? (e.ok ? 'check' : 'cross') : e.kind === 'commit' ? 'commit' : e.kind === 'note' ? 'save' : 'turn', e.kind === 'run' ? (e.ok ? K.emerald : K.rose) : K.silver, `${e.ts.slice(5, 16).replace('T', ' ')} · ${e.text}`, K.label) : null }),
      ],
      // Cortex's pick sits with the buttons, before you choose
      suggest: askRow($, els, asked, `fix-${f.id}`) ?? u.tag(`fsg-${f.id}`, 'suggest', K.emerald, `Cortex suggests: ${sug.text}`, K.text),
      quick: quickFor(d, f),
    })
  }
  // one fix as a line: an icon for what was done (removed, rewritten, moved, added, kept), the words, then the file
  // and line as a quiet tag, and what the note said before, struck through in spirit (muted, after "Was")
  const fixLine = (key: string, f: FindingView) => {
    const [ic, c] = fixIcon(f)
    return (
      <Box key={key} flexDirection="row" gap={1} alignItems="flex-start" paddingY={0}>
        {u.node(`${key}-i`, ic, c, 18)}
        <Box flexDirection="column" gap={0} flexShrink={1} minWidth={12}>
          <Text size="caption" weight="medium" color={K.text}>{fixWords(f)}</Text>
          <Text size="caption" color={K.muted}>{`${f.label}${f.line ? ` · line ${f.line}` : ''}${f.entry ? ` · was “${f.entry.replace(/^\s*[-*+]\s+/, '').replace(/\s+/g, ' ').slice(0, 110)}${f.entry.length > 110 ? '…' : ''}”` : ''}`}</Text>
        </Box>
      </Box>
    )
  }
  // a fix row's caption lines at this width (its words line, then the file, line and what it was, wrapped)
  const fixLines = (f: FindingView) => 1 + Math.max(1, Math.ceil(((String(f.label ?? '').length + 12 + Math.min(116, String(f.entry ?? '').length + 8)) * 6.2) / Math.max(160, px - 170)))
  const decidedTile = (d: DreamView, f: FindingView) => {
    const k = KIND[f.kind] ?? { label: f.kind, icon: 'spark', color: K.silver }
    const kept = f.done === 'kept'
    return t.tile({
      flat: true,
      id: `${d.id}-${f.id}-done`, icon: kept ? 'pending' : 'check', color: kept ? K.silver : K.emerald,
      lead: { kind: kept ? 'f-stale' : 'f-lesson', alt: kept ? 'A note kept as it is' : 'A note that was fixed', muted: kept },
      title: outcomeText(f), wrap: true, time: ago(minsSince(d.applied?.at ?? d.ts)),
      preview: f.entry ? `Was: ${f.entry.replace(/^\s*[-*+]\s+/, '').replace(/\s*\n\s*/g, ' ')}` : f.why,
      badges: [[kept ? 'Kept' : 'Applied', kept ? K.label : K.emerald, kept ? 'pending' : 'check'], [k.label, K.label]],
      quick: [btn(`fu-${f.id}`, 'Undo', () => dec(d, f, 'undo', 'Undone'))],
    })
  }

  const live = !!last && (last.status === 'proposed' || last.status === 'applied')
  const openList = live ? last.findings.filter(f => !f.done).sort((a, b) => ORDER[a.severity] - ORDER[b.severity]) : []
  const decided = live ? last.findings.filter(f => f.done) : []
  const applicable = openList.filter(f => !f.skip && f.action.op !== 'none').length
  const appliedN = decided.filter(f => f.done === 'applied').length, keptN = decided.length - appliedN

  // the summary: a ring of how much of the memory holds up, what is waiting, and what each recent check found
  const total = last?.entryCount ?? 0
  const sw = Math.max(160, px - 64) // the strip and the check line span the page
  const strip = noteStrip({ total, open: openList.length, fixed: appliedN, kept: keptN, width: sw })
  const dots = checkDots({ checks: recent.slice(0, 12).reverse().map(dotOf), width: Math.min(sw, 520) })
  const holdUp = Math.max(0, total - openList.length - appliedN - keptN)
  const legend = ([[holdUp, NOTE_COLORS.ok, 'hold up'], [openList.length, NOTE_COLORS.open, 'waiting for you'], [appliedN, NOTE_COLORS.fixed, 'fixed'], [keptN, NOTE_COLORS.kept, 'kept']] as [number, string, string][]).filter(([v]) => v > 0)
  const clearW = Math.round(Math.max(96, Math.min(140, px * 0.2))) // the all-clear robot grows with the pane, within reason
  const headline = !last ? 'Not checked yet' : last.error ? 'The last check failed' : total ? `${holdUp} of ${total} notes hold up` : 'Nothing to check yet'
  const when = running ? `Dreaming… started ${ago(minsSince(running.since))}` : last ? `Last checked ${ago(minsSince(last.ts))}${last.model ? ` · judged by ${last.model.replace(/^claude · /, '')}` : ' · quick check'}` : 'Press a button below to run the first check'
  const head = (
    <Box key="dr-head" flexDirection="column" gap={1} paddingX={1}>
      <Box key="dr-hr" flexDirection="row" justifyContent="space-between" alignItems="flex-end" columnGap={3} rowGap={1} flexWrap="wrap">
        <Box flexDirection="column" gap={0} flexShrink={1} minWidth={20}>
          <Text size="title" weight="semibold" color={openList.length ? K.amber : K.text}>{headline}</Text>
          <Text size="caption" color={K.muted}>{when}</Text>
        </Box>
        <Box key="dr-btns" flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
          <Button key="kc-dream-checks" variant="secondary" onPress={() => { void act($, 'Checked', ['dream', 'run', '--no-model']) }}>Quick check (free)</Button>
          <Button key="kc-dream" variant="primary" onPress={() => { void act($, 'Dream started', ['dream']) }}>{running ? 'Dreaming…' : 'Dream now (1–2 min)'}</Button>
        </Box>
      </Box>
      {total ? u.graphic('dr-strip', strip, `${total} memory notes: ${legend.map(([v, , w]) => `${v} ${w}`).join(', ')}`) : null}
      {/* a key only when there is more than one kind to tell apart: one kind would repeat the headline */}
      {legend.length > 1 ? <Box key="dr-lg" flexDirection="row" columnGap={3} rowGap={0} flexWrap="wrap">{legend.map(([v, c, w]) => <Text key={`dr-lg-${w}`} size="caption" color={K.label}><Text color={c}>■ </Text><Text weight="semibold" color={K.text}>{String(v)}</Text>{` ${w}`}</Text>)}</Box> : null}
      {/* one check is already said by "Last checked" above: the history line starts at two (never "The last 1 checks") */}
      {recent.length >= 2 ? <Box key="dr-hh" flexDirection="column" gap={0} paddingTop={1}>
        <Text size="caption" weight="semibold" color={K.label}>{`The last ${Math.min(12, recent.length)} checks`}</Text>
        {u.graphic('dr-dots', dots, `The last ${Math.min(12, recent.length)} checks: ${recent.slice(0, 12).map(d => d.findings.length).join(', ')} found, newest first`)}
      </Box> : null}
      {u.muted('dr-cost', model ? `A Dream reads your last ${n} chats, test runs and commits, and asks ${model} to judge: about 10–25k tokens of your plan. A quick check is free and instant. Nothing changes until you choose.` : 'Both are free: with no model chosen in Settings, a Dream only flags what Cortex can prove.')}
    </Box>
  )

  // the earlier Dreams whose fixes still stand (Undo works); the rest live in the history bars
  const earlier = recent.slice(1).filter(d => d.status === 'applied').slice(0, 5)
  const openActs = openList.length
    ? <Box key="dr-act" flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
        {last!.status === 'proposed' && !decided.length ? btn('kc-dream-discard', 'Discard all', () => { void act($, 'Discarded', ['dream', 'discard', last!.id]) }) : null}
        {applicable > 1 ? btn('kc-dream-apply', `Apply all ${applicable}`, () => dec(last!, 'all', 'apply', 'Applied'), true) : null}
      </Box>
    : null
  const undoCount = decided.length + earlier.length

  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('dr-in', pageScene('dream', 100), 'Cortex dreaming over notes', 'Memory check: is what Claude remembers still true?', `A Dream is a deep check that Claude's notes still match what really happened. A quick check is a free, instant check for broken links, missing files and repeats.`, companion('sleepy', px))}
      {head}
      {last?.error ? u.card('dr-err', '100%', [u.tag('dr-err-t', 'cross', K.rose, `The last Dream failed: ${last.error}`, K.text)], K.rose) : null}
      {last?.modelError ? u.tag('dr-merr', 'alert', K.amber, `The model step failed, so only Cortex's own checks ran: ${last.modelError}`, K.label) : null}
      {last?.rejected?.length ? t.tile({
        id: `rj-${last.id}`, icon: 'cross', color: K.silver, lead: { kind: 'f-rejected', alt: 'Suggestions Cortex turned down' }, title: `Cortex turned down ${last.rejected.length} suggestion${last.rejected.length === 1 ? '' : 's'} from the model`, preview: 'The model wasn\'t sure enough, had no evidence, or it was about your own files outside this project.',
        badges: [['Proven by a check']],
        body: last.rejected.map((r, i) => <Text key={`rjt-${i}`} size="caption" color={K.muted}>{r}</Text>),
      }) : null}
      {last && !last.error && !last.findings.length ? u.illo('dr-ok-i', clearSvg(clearW), 'Cortex cheering beside a tick: nothing to fix', [<Text key="dr-ok-t" weight="semibold" color={K.text}>Nothing to fix</Text>, u.muted('dr-ok-d', 'Claude\'s memory matches what really happened.')], true) : null}
      {live && !openList.length && decided.length ? u.illo('dr-done-i', clearSvg(clearW), 'Cortex cheering beside a tick: all decided', [<Text key="dr-done-t" weight="semibold" color={K.text}>All decided</Text>, u.muted('dr-done-d', `${appliedN ? `${appliedN} applied` : ''}${appliedN && keptN ? ', ' : ''}${keptN ? `${keptN} kept` : ''}. Each one can be undone below.`)], true) : null}
      {last && last.status === 'undone' ? u.tag('dr-un', 'turn', K.silver, `Undone ${ago(minsSince(last.undone ?? last.ts))}: every file is back as it was.`, K.label) : null}
      {openList.length ? t.groupHead('dr-fh', 'dream', K.amber, 'Waiting for you', String(openList.length)) : null}
      {openActs}
      {openList.length ? t.stack('dr-fl', openList.map(f => findingTile(last!, f))) : null}
      {last?.kept ? u.muted('dr-kept', `${last.kept} note${last.kept === 1 ? '' : 's'} you kept before ${last.kept === 1 ? 'was' : 'were'} not flagged again.`) : null}
      {undoCount ? <Box key="dr-uh" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
        {t.groupHead('dr-uhh', 'check', K.emerald, 'Fixes you can undo', String(undoCount))}
        {decided.length > 1 ? btn('kc-dream-undo', 'Undo all from this check', () => dec(last!, 'all', 'undo', 'Undone')) : null}
      </Box> : null}
      {/* fixes you can undo: rows on one card (craft: lists are rows), this check's first, then earlier Dreams' */}
      {decided.length || earlier.length ? t.rows('dr-ul', [...decided.map(f => decidedTile(last!, f)), ...earlier.map(d => t.tile({
        flat: true, id: `dh-${d.id}`, icon: 'dream', color: K.emerald,
        lead: { kind: 'dream-ok', alt: 'A Dream whose fixes were applied' }, title: oneFix(d) ? outcomeText(oneFix(d)!) : `${d.findings.filter(f => f.done === 'applied').length || d.findings.length} fixes applied`, time: ago(minsSince(d.ts)),
        badges: [[STATUS[d.status] ?? d.status, K.emerald], [d.model ? `Judged by ${d.model.replace(/^claude · /, '')}` : 'Quick check']],
        body: [t.twig(`dht-${d.id}`, d.findings.slice(0, 8).map(f => ({ el: fixLine(`dhf-${d.id}-${f.id}`, f), lines: fixLines(f) })), K.emerald, 22)], // the wire starts at the tile's Applied badge
        quick: [btn(`kc-undo-${d.id}`, 'Undo', () => { void act($, 'Undone', ['dream', 'undo', d.id]) })],
      }))]) : null}
    </Box>
  )
}
