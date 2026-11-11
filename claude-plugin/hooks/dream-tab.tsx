import type { ElementTable } from 'claude-code'

import type { DreamView, FindingView, StatusView, ViewState } from '../types'
import { act, ago, minsSince, type Dollar } from './data'
import type { Kit } from './kit'
import { illoDreamClean, illoDreamStart } from './illos'
import { K } from './theme'
import { tiles } from './tiles'

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
const ORDER = { high: 0, medium: 1, low: 2 }
const doing = (f: FindingView) => f.action.op === 'delete' ? 'Remove it' : f.action.op === 'replace' ? `Rewrite as: "${f.action.text}"` : f.action.op === 'move' ? `Move to ${f.action.to} (loads only for ${(f.action.paths ?? []).join(', ')})` : f.action.op === 'add-index' ? `Add to MEMORY.md: ${f.action.text}` : f.action.op === 'add-lesson' ? `Add to auto memory: "${f.action.text}"` : 'Yours to decide: remove the line, keep it, or ask Claude to rewrite it'
/** What "Ask Claude" sends: you press it, so it's your prompt; Claude edits the note with its own tools, as you'd ask. */
const askFix = (f: FindingView) => !f.entry ? `Kapex Cortex flagged ${f.label}: ${f.why} Shorten it without losing any rule that still applies (move details that only matter for some folders into .claude/rules/ files with paths: frontmatter), and tell me what you changed.` : `Kapex Cortex flagged a memory note as out of date. In ${f.label}${f.line ? ` line ${f.line}` : ''}: "${f.entry.replace(/\s+/g, ' ').slice(0, 300)}". Why: ${f.why} Update that note so it matches the project as it is now (or remove it if it no longer applies), and tell me what you changed.`

export function dreamBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded)
  const recent = s.dream?.recent ?? []
  const last = recent[0]
  const running = s.dream?.running
  const model = s.prefs?.dreamBackend === 'off' ? 'checks only (no model)' : `${s.prefs?.dreamBackend ?? 'claude'} · ${s.prefs?.dreamModel || 'sonnet'}`
  const n = s.prefs?.dreamTranscripts ?? 10

  const dec = (d: DreamView, f: FindingView | 'all', what: string, label: string) => { void act($, label, ['dream', 'decide', d.id, f === 'all' ? 'all' : f.id, what]) }
  const btn = (key: string, label: string, onPress: () => void, primary = false) => <Button key={key} variant={primary ? 'primary' : 'secondary'} onPress={onPress}>{label}</Button>
  const quickFor = (d: DreamView, f: FindingView): JSX.Element[] => {
    if (d.status !== 'proposed' && d.status !== 'applied') return []
    if (f.done) return [<Box key={`fq-${f.id}`} flexDirection="row" gap={1} alignItems="center">{t.badge(`fqb-${f.id}`, f.done === 'applied' ? 'Applied' : 'Kept', f.done === 'applied' ? K.emerald : K.label, f.done === 'applied' ? 'check' : 'pending')}{btn(`fu-${f.id}`, 'Undo', () => dec(d, f, 'undo', 'Undone'))}</Box>]
    const keep = btn(`fk-${f.id}`, 'Keep', () => dec(d, f, 'keep', 'Kept'))
    if (f.action.op !== 'none' && !f.skip) return [btn(`fa-${f.id}`, 'Apply', () => dec(d, f, 'apply', 'Applied'), true), keep]
    const canRemove = !!f.line && d.files.some(x => x.path === f.file)
    return [
      canRemove ? btn(`fr-${f.id}`, 'Remove line', () => dec(d, f, 'remove', 'Removed')) : null,
      f.entry || f.kind === 'over-cap' ? btn(`fc-${f.id}`, 'Ask Claude', () => { void $.prompt.submit({ text: askFix(f) }) }) : null,
      keep,
    ].filter((x): x is JSX.Element => !!x)
  }

  const findingTile = (d: DreamView, f: FindingView) => {
    const k = KIND[f.kind] ?? { label: f.kind, icon: 'spark', color: K.silver }
    const ev = new Map(d.evidence.map(e => [e.id, e]))
    return t.tile({
      id: `${d.id}-${f.id}`, icon: k.icon, color: f.done === 'kept' || f.skip ? K.muted : f.done === 'applied' ? K.emerald : k.color, accent: f.severity === 'high' && !f.skip && !f.done ? `${k.color}66` : undefined,
      title: f.entry ? f.entry.replace(/^\s*[-*+]\s+/, '').replace(/\s*\n\s*/g, ' ') : f.why, wrap: true, preview: f.entry ? `Why: ${f.why}` : undefined,
      time: f.line ? `line ${f.line}` : undefined,
      badges: [[k.label, k.color, k.icon], [f.label, K.label, 'file'], [f.by === 'check' ? 'checked by Cortex' : 'judged by the model'], f.skip && !f.done ? ['left out', K.muted] : null],
      body: [
        ...f.evidence.map(id => { const e = ev.get(id); return e ? u.tag(`fe-${f.id}-${id}`, e.kind === 'run' ? (e.ok ? 'check' : 'cross') : e.kind === 'commit' ? 'commit' : e.kind === 'note' ? 'save' : 'turn', e.kind === 'run' ? (e.ok ? K.emerald : K.rose) : K.silver, `${e.ts.slice(5, 16).replace('T', ' ')} · ${e.text}`, K.label) : null }),
        u.tag(`fa-${f.id}`, f.action.op === 'none' ? 'pending' : 'spark', f.action.op === 'none' ? K.silver : K.emerald, doing(f), K.text),
      ],
      quick: quickFor(d, f),
    })
  }

  const open = last ? last.findings.filter(f => !f.done).length : 0
  const applicable = last ? last.findings.filter(f => !f.done && !f.skip && f.action.op !== 'none').length : 0
  const appliedN = last ? last.findings.filter(f => f.done === 'applied').length : 0
  const live = !!last && (last.status === 'proposed' || last.status === 'applied')
  const head = u.card('dr-head', '100%', [
    <Box key="dr-h" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
      <Box flexDirection="row" gap={1} alignItems="center">
        {u.node('dr-n', 'dream', K.emerald, 26)}
        <Box flexDirection="column">
          <Text weight="semibold" color={K.text}>Dream</Text>
          <Text size="caption" color={K.muted}>{running ? `Dreaming… started ${ago(minsSince(running.since))}` : last ? `Last one ${ago(minsSince(last.ts))} · ${last.status}` : 'Not run yet'}</Text>
        </Box>
      </Box>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Button key="kc-dream-checks" onPress={() => { void act($, 'Checked', ['dream', 'run', '--no-model']) }}>Quick check</Button>
        <Button key="kc-dream" variant="primary" onPress={() => { void act($, 'Dream started', ['dream']) }}>{running ? 'Dreaming…' : 'Dream now'}</Button>
      </Box>
    </Box>,
    u.muted('dr-what', `Checks your memory files against your last ${n} chats, tests and git. Nothing changes until you Apply.`),
    <Box key="dr-m" flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric('dm-c', 'turn', K.silver, last ? String(last.transcripts) : '–', 'chats read', '40%')}
      {t.metric('dm-e', 'test', K.silver, last ? String(last.evidenceCount) : '–', 'facts checked', '40%')}
      {t.metric('dm-n', 'rule', K.silver, last ? String(last.entryCount) : '–', 'notes checked', '40%')}
      {t.metric('dm-f', 'alert', last?.findings.length ? K.amber : K.emerald, last ? String(last.findings.length) : '–', 'findings', '40%')}
    </Box>,
    u.tag('dr-cost', 'spark', K.silver, `Dream now: ${model}, about 10–25k tokens, 1–2 min. Quick check: free, no model.`, K.muted),
  ], K.emerald)

  // earlier Dreams worth a tile: the applied ones (Undo works); the rest is one line
  const earlier = recent.slice(1).filter(d => d.status === 'applied').slice(0, 5)
  const quiet = recent.slice(1).length - earlier.length
  const list = last ? [...last.findings].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || ORDER[a.severity] - ORDER[b.severity]) : []
  const actions = live && last.findings.length
    ? <Box key="dr-act" flexDirection="row" justifyContent="flex-end" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
        <Text size="caption" color={K.label}>{open ? `${open} open · ${appliedN} applied` : appliedN ? `All decided · ${appliedN} applied` : 'All decided'}</Text>
        {appliedN ? btn('kc-dream-undo', 'Undo this Dream', () => dec(last, 'all', 'undo', 'Undone')) : null}
        {open && last.status === 'proposed' && !appliedN ? btn('kc-dream-discard', 'Discard', () => { void act($, 'Discarded', ['dream', 'discard', last.id]) }) : null}
        {applicable ? btn('kc-dream-apply', `Apply all ${applicable}`, () => dec(last, 'all', 'apply', 'Applied'), true) : null}
      </Box>
    : last && last.status === 'undone' ? u.tag('dr-un', 'turn', K.silver, `Undone ${ago(minsSince(last.undone ?? last.ts))}: every file is back as it was.`, K.label) : null

  return (
    <Box flexDirection="column" gap={1}>
      {head}
      {last?.error ? u.card('dr-err', '100%', [u.tag('dr-err-t', 'cross', K.rose, `The last Dream failed: ${last.error}`, K.text)], K.rose) : null}
      {last?.modelError ? u.tag('dr-merr', 'alert', K.amber, `The model step failed, so only Cortex's own checks ran: ${last.modelError}`, K.label) : null}
      {last?.rejected?.length ? t.tile({
        id: `rj-${last.id}`, icon: 'cross', color: K.silver, title: `${last.rejected.length} suggestion${last.rejected.length === 1 ? '' : 's'} from the model refused`, preview: 'Not sure enough, no evidence behind it, or about your own files outside this project.',
        badges: [['checked by Cortex']],
        body: last.rejected.map((r, i) => <Text key={`rjt-${i}`} size="caption" color={K.muted}>{r}</Text>),
      }) : null}
      {last && !last.error && !last.findings.length ? u.card('dr-ok', '100%', [u.illo('dr-ok-i', illoDreamClean(150), 'All clear', [<Text key="dr-ok-t" weight="semibold" color={K.text}>Nothing to fix</Text>, u.muted('dr-ok-d', 'Your memory matches what happened.')])]) : null}
      {last && open === 0 && appliedN && live ? u.card('dr-done', '100%', [u.illo('dr-done-i', illoDreamClean(130), 'All decided', [<Text key="dr-done-t" weight="semibold" color={K.text}>All decided</Text>, u.muted('dr-done-d', `${appliedN} applied. Undo stays available below.`)])]) : null}
      {!last && !running ? u.card('dr-none', '100%', [u.illo('dr-none-i', illoDreamStart(150), 'No Dream yet', [<Text key="dr-none-t" weight="semibold" color={K.text}>No Dream yet</Text>, u.muted('dr-none-d', 'Press Quick check (free) or Dream now above.')])]) : null}
      {list.length ? t.groupHead('dr-fh', 'dream', K.emerald, 'What it found', String(list.length)) : null}
      {list.length ? actions : null}
      {list.length ? t.stack('dr-fl', list.map(f => findingTile(last!, f))) : null}
      {last?.kept ? u.muted('dr-kept', `${last.kept} note${last.kept === 1 ? '' : 's'} you kept before ${last.kept === 1 ? 'was' : 'were'} not flagged again.`) : null}
      {earlier.length ? t.groupHead('dr-hh', 'pending', K.silver, 'Earlier Dreams you can undo', String(earlier.length)) : null}
      {quiet ? u.muted('dr-hq', `${quiet} older Dream${quiet === 1 ? '' : 's'} discarded or replaced: nothing to undo.`) : null}
      {earlier.map(d => t.tile({
        id: `dh-${d.id}`, icon: 'dream', color: d.status === 'failed' ? K.rose : d.status === 'applied' ? K.emerald : K.silver, title: `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`, time: ago(minsSince(d.ts)),
        badges: [[d.status, d.status === 'applied' ? K.emerald : d.status === 'failed' ? K.rose : K.label], [d.model ?? 'checks only']],
        body: d.findings.slice(0, 6).map(f => u.tag(`dhf-${d.id}-${f.id}`, (KIND[f.kind] ?? KIND.stale!).icon, (KIND[f.kind] ?? KIND.stale!).color, `${(KIND[f.kind] ?? { label: f.kind }).label} · ${f.label}${f.line ? `:${f.line}` : ''}`, K.label)),
        quick: d.status === 'applied' ? [btn(`kc-undo-${d.id}`, 'Undo', () => { void act($, 'Undone', ['dream', 'undo', d.id]) })] : [],
      }))}
    </Box>
  )
}
