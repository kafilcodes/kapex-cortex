import type { ElementTable } from 'claude-code'
import { sceneSvg } from './mascot'

import type { NativeFileView, StatusView, ViewState } from '../types'
import { k } from './charts'
import { type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { tiles } from './tiles'
import { micro } from './viz'

// Claude Code's own memory, the way it loads it: what is in every session (and its cost), what loads only for
// some files, and what Claude reads when it needs to. Newest-first doesn't apply here: files are in load order.
const SCOPE: Record<string, { icon: string; label: string }> = {
  user: { icon: 'star', label: 'yours, all projects' }, parent: { icon: 'folder', label: 'folder above' },
  project: { icon: 'file', label: 'this project' }, rules: { icon: 'rule', label: 'rule file' }, auto: { icon: 'lesson', label: 'Claude\'s auto memory' },
}
const loads = (f: NativeFileView) => f.loads === 'first-200' ? 'every session (first 200 lines)' : f.loads === 'always' ? 'every session' : f.paths?.length ? `only for ${f.paths.join(', ')}` : 'when Claude needs it'

export function filesBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px: number): JSX.Element {
  const { Box, Text } = els
  const t = tiles($, els, u, vw.expanded)
  const n = s.native
  const always = n.files.filter(f => f.loads !== 'on-demand')
  const later = n.files.filter(f => f.loads === 'on-demand')
  const tile = (f: NativeFileView) => {
    const sc = SCOPE[f.scope] ?? SCOPE.project!
    const cap = f.loads === 'first-200' ? 200 : f.loads === 'always' ? 200 : 0
    return t.tile({
      id: `nf-${f.label}`, icon: sc.icon, color: f.over ? K.amber : f.loads === 'on-demand' ? K.silver : K.emerald, title: f.label,
      time: f.tokens ? `${k(f.tokens)} tokens` : `${f.lines} lines`,
      badges: [[loads(f), f.loads === 'on-demand' ? K.label : K.emerald, f.loads === 'on-demand' ? 'pending' : 'spark'], [sc.label], f.over ? [f.over, K.amber, 'alert'] : null, f.editable ? null : ['read only for Cortex', K.label, 'lock']],
      body: [
        cap ? u.graphic(`nfg-${f.label}`, micro({ share: Math.min(1, f.lines / cap), width: Math.min(320, px - 140), color: f.lines > cap ? K.rose : f.lines > cap * 0.8 ? K.amber : K.emerald, animate: false }), `${f.lines} of ${cap} lines`) : null,
        <Text key={`nfp-${f.label}`} size="caption" color={K.muted}>{`${f.lines} lines · ${(f.bytes / 1024).toFixed(1)} KB · ${f.path}`}</Text>,
      ],
    })
  }
  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('nf-in', sceneSvg('memory', 120), 'Cortex with your memory files', 'What Claude remembers', 'Rules without paths load in every chat; rules with paths only for their files.')}
      {u.card('nf-sum', '100%', [
        u.head('nf-h', 'What Claude Code loads by itself', n.autoMemory.enabled ? 'auto memory on' : 'auto memory off', n.autoMemory.enabled ? K.emerald : K.amber),
        <Box key="nf-m" flexDirection="row" gap={1} flexWrap="wrap">
          {t.metric('nfm-t', 'spark', K.emerald, k(n.alwaysTokens), 'tokens in every session', '26%')}
          {t.metric('nfm-l', 'rule', n.alwaysLines > 200 ? K.amber : K.silver, String(n.alwaysLines), 'lines in every session', '26%')}
          {t.metric('nfm-f', 'file', K.silver, String(n.files.length), 'memory files', '26%')}
        </Box>,
      ])}
      {s.memHealth ? (() => {
        const mh = s.memHealth
        const worst = [...mh.files].sort((a, b) => b.lines / b.limit - a.lines / a.limit)
        const share = mh.scopedTokens + mh.alwaysTokens ? Math.round((100 * mh.scopedTokens) / (mh.scopedTokens + mh.alwaysTokens)) : 0
        return u.card('nf-health', '100%', [
          u.head('nfh-h', 'Memory health', 'each measured on its own'),
          <Box key="nfh-m" flexDirection="row" gap={1} flexWrap="wrap">
            {t.metric('nfh-b', 'rule', worst.some(f => f.lines > f.limit) ? K.rose : worst.some(f => f.lines > f.limit * 0.8) ? K.amber : K.emerald, `${mh.files.filter(f => f.lines <= f.limit).length}/${mh.files.length}`, 'files under 200 lines', '20%')}
            {t.metric('nfh-s', 'move', share ? K.sage : K.silver, `${share}%`, 'of rules load only for their files', '20%')}
            {t.metric('nfh-o', 'alert', mh.open ? K.amber : K.emerald, String(mh.open), mh.open === 1 ? 'note flagged, not fixed' : 'notes flagged, not fixed', '20%')}
            {t.metric('nfh-c', 'test', K.silver, mh.checks ? `${mh.clean}/${mh.checks}` : '–', 'recent Quick checks found nothing', '20%')}
          </Box>,
          ...worst.slice(0, 4).map(f => (
            <Box key={`nfh-f-${f.label}`} flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
              <Box width="34%" minWidth={14}><Text size="caption" color={K.label} wrap="truncate-end">{f.label}</Text></Box>
              {u.graphic(`nfh-g-${f.label}`, micro({ share: Math.min(1, f.lines / f.limit), width: Math.min(300, px * 0.4), color: f.lines > f.limit ? K.rose : f.lines > f.limit * 0.8 ? K.amber : K.emerald, animate: false }), `${f.lines} of ${f.limit} lines`)}
              <Text size="caption" tabular color={K.muted}>{`${f.lines} / ${f.limit} lines`}</Text>
            </Box>
          )),
          u.muted('nfh-why', 'Keep each under 200 lines; move folder-only rules to .claude/rules/ with paths:. Dream proposes both.'),
        ])
      })() : null}
      {t.groupHead('nf-ah', 'spark', K.emerald, 'In every session', String(always.length))}
      {t.stack('nf-al', always.map(f => tile(f)))}
      {later.length ? t.groupHead('nf-lh', 'pending', K.silver, 'Only when needed', String(later.length)) : null}
      {later.length ? t.stack('nf-ll', later.map(f => tile(f))) : null}
      {s.migrated ? u.tag('nf-mig', 'save', K.silver, `Your Cortex v2 memories are kept in ${s.migrated}: copy what you still want into CLAUDE.md, or let a Dream sort it.`, K.muted) : null}
    </Box>
  )
}
