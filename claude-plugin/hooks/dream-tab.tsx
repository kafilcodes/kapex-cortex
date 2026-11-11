import type { ElementTable } from 'claude-code'

import type { DreamView, FindingView, StatusView, ViewState } from '../types'
import { act, ago, minsSince, type Dollar } from './data'
import type { Kit } from './kit'
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
const doing = (f: FindingView) => f.action.op === 'delete' ? 'Remove it' : f.action.op === 'replace' ? `Rewrite as: "${f.action.text}"` : f.action.op === 'move' ? `Move to ${f.action.to} (loads only for ${(f.action.paths ?? []).join(', ')})` : f.action.op === 'add-index' ? `Add to MEMORY.md: ${f.action.text}` : f.action.op === 'add-lesson' ? `Add to auto memory: "${f.action.text}"` : 'Yours to decide (Apply leaves it)'

export function dreamBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState): JSX.Element {
  const { Box, Text, Button } = els
  const t = tiles($, els, u, vw.expanded)
  const recent = s.dream?.recent ?? []
  const last = recent[0]
  const running = s.dream?.running
  const model = s.prefs?.dreamBackend === 'off' ? 'checks only (no model)' : `${s.prefs?.dreamBackend ?? 'claude'} · ${s.prefs?.dreamModel || 'sonnet'}`
  const n = s.prefs?.dreamTranscripts ?? 10

  const findingTile = (d: DreamView, f: FindingView) => {
    const k = KIND[f.kind] ?? { label: f.kind, icon: 'spark', color: K.silver }
    const ev = new Map(d.evidence.map(e => [e.id, e]))
    return t.tile({
      id: `${d.id}-${f.id}`, icon: k.icon, color: f.skip ? K.muted : k.color, accent: f.severity === 'high' && !f.skip ? `${k.color}66` : undefined,
      title: f.entry ? f.entry.replace(/^\s*[-*+]\s+/, '').replace(/\s*\n\s*/g, ' ') : f.why, wrap: true,
      time: f.line ? `line ${f.line}` : undefined,
      badges: [[k.label, k.color, k.icon], [f.label, K.label, 'file'], [f.by === 'check' ? 'checked by Cortex' : 'judged by the model'], f.skip ? ['left out', K.muted] : null],
      body: [
        f.entry ? u.tag(`fw-${f.id}`, 'tip', K.silver, `Why: ${f.why}`, K.label) : null,
        ...f.evidence.map(id => { const e = ev.get(id); return e ? u.tag(`fe-${f.id}-${id}`, e.kind === 'run' ? (e.ok ? 'check' : 'cross') : e.kind === 'commit' ? 'commit' : e.kind === 'note' ? 'save' : 'turn', e.kind === 'run' ? (e.ok ? K.emerald : K.rose) : K.silver, `${e.ts.slice(5, 16).replace('T', ' ')} · ${e.text}`, K.label) : null }),
        u.tag(`fa-${f.id}`, f.action.op === 'none' ? 'pending' : 'spark', f.action.op === 'none' ? K.silver : K.emerald, doing(f), K.text),
      ],
      quick: d.status === 'proposed' && f.action.op !== 'none'
        ? [<Button key={`fs-${d.id}-${f.id}`} plain onPress={() => { void act($, f.skip ? 'Put back' : 'Left out', ['dream', 'skip', d.id, f.id, ...(f.skip ? ['off'] : [])]) }}><Text size="caption" color={K.label}>{f.skip ? 'Include' : 'Leave out'}</Text></Button>]
        : [],
    })
  }

  const kept = last ? last.findings.filter(f => !f.skip && f.action.op !== 'none').length : 0
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
    u.muted('dr-what', `Checks CLAUDE.md, your rules and Claude's auto memory against your last ${n} chats, test runs and git: what's no longer true, out of date, repeated, or only needed for some files. Nothing changes until you press Apply.`),
    <Box key="dr-m" flexDirection="row" gap={1} flexWrap="wrap">
      {t.metric('dm-c', 'turn', K.silver, last ? String(last.transcripts) : '–', 'chats read', '40%')}
      {t.metric('dm-e', 'test', K.silver, last ? String(last.evidenceCount) : '–', 'facts checked', '40%')}
      {t.metric('dm-n', 'rule', K.silver, last ? String(last.entryCount) : '–', 'notes checked', '40%')}
      {t.metric('dm-f', 'alert', last?.findings.length ? K.amber : K.emerald, last ? String(last.findings.length) : '–', 'findings', '40%')}
    </Box>,
    u.tag('dr-cost', 'spark', K.silver, `Dream now uses ${model} on your plan, about 10k–25k tokens, in the background (a minute or two; press Refresh to see it). Quick check uses no model and no tokens.`, K.muted),
  ], K.emerald)

  const list = last ? [...last.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]) : []
  const actions = last && last.status === 'proposed' && last.findings.length
    ? <Box key="dr-act" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} rowGap={1} flexWrap="wrap">
        <Text size="caption" color={K.label}>{kept ? `Apply changes ${kept} file note${kept === 1 ? '' : 's'}; the files are saved first, so Undo puts them back.` : 'Nothing to apply: these are for you to decide.'}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="kc-dream-discard" onPress={() => { void act($, 'Discarded', ['dream', 'discard', last.id]) }}>Discard</Button>
          {kept ? <Button key="kc-dream-apply" variant="primary" onPress={() => { void act($, 'Applied', ['dream', 'apply', last.id]) }}>{`Apply ${kept}`}</Button> : null}
        </Box>
      </Box>
    : last && last.status === 'applied'
      ? <Box key="dr-act" flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1} flexWrap="wrap">
          {u.tag('dr-ap', 'check', K.emerald, `Applied ${ago(minsSince(last.applied?.at ?? last.ts))}`, K.text)}
          <Button key="kc-dream-undo" onPress={() => { void act($, 'Undone', ['dream', 'undo', last.id]) }}>Undo</Button>
        </Box>
      : null

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
      {last && !last.error && !last.findings.length ? u.card('dr-ok', '100%', [u.tag('dr-ok-t', 'check', K.emerald, 'Nothing to fix: your memory matches what happened.', K.text)]) : null}
      {list.length ? t.groupHead('dr-fh', 'dream', K.emerald, 'What it found', String(list.length), actions) : null}
      {list.length ? t.railed('dr-fl', list.map(f => ({ tile: findingTile(last!, f), lines: 2 + Math.ceil((f.entry || f.why).length / 55) }))) : null}
      {recent.length > 1 ? t.groupHead('dr-hh', 'pending', K.silver, 'Earlier Dreams', String(recent.length - 1)) : null}
      {recent.slice(1, 8).map(d => t.tile({
        id: `dh-${d.id}`, icon: 'dream', color: d.status === 'failed' ? K.rose : d.status === 'applied' ? K.emerald : K.silver, title: `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`, time: ago(minsSince(d.ts)),
        badges: [[d.status, d.status === 'applied' ? K.emerald : d.status === 'failed' ? K.rose : K.label], [d.model ?? 'checks only']],
        body: d.findings.slice(0, 6).map(f => u.tag(`dhf-${d.id}-${f.id}`, (KIND[f.kind] ?? KIND.stale!).icon, (KIND[f.kind] ?? KIND.stale!).color, `${(KIND[f.kind] ?? { label: f.kind }).label} · ${f.label}${f.line ? `:${f.line}` : ''}`, K.label)),
        quick: d.status === 'applied' ? [<Button key={`kc-undo-${d.id}`} plain onPress={() => { void act($, 'Undone', ['dream', 'undo', d.id]) }}><Text size="caption" color={K.label}>Undo</Text></Button>] : [],
      }))}
    </Box>
  )
}
