import type { ElementTable } from 'claude-code'
import { pageScene } from './mascot'

import type { NativeFileView, StatusView, ViewState } from '../types'
import { k } from './charts'
import { type Dollar } from './data'
import type { Kit } from './kit'
import { K } from './theme'
import { tiles } from './tiles'
import type { Lead } from './leads'
import { micro } from './viz'
import { companion } from './blocky'

// Claude Code's own memory, the way it loads it: what is in every session (and its cost), what loads only for
// some files, and what Claude reads when it needs to. Newest-first doesn't apply here: files are in load order.
const SCOPE: Record<string, { icon: string; label: string; lead: Lead; alt: string }> = {
  user: { icon: 'star', label: 'yours, for every project', lead: 'mem-user', alt: 'A note with a star: yours, for every project' },
  parent: { icon: 'folder', label: 'from a folder above this project', lead: 'mem-parent', alt: 'A folder above this project' },
  project: { icon: 'file', label: 'from this project', lead: 'mem-project', alt: 'A note in this project\'s folder' },
  rules: { icon: 'rule', label: 'a rule (in .claude/rules)', lead: 'mem-rule', alt: 'A note with a shield: a rule' },
  auto: { icon: 'lesson', label: 'Claude\'s auto memory', lead: 'mem-auto', alt: 'A note with the robot\'s antenna: Claude\'s auto memory' },
}
const loads = (f: NativeFileView) => f.loads === 'first-200' ? 'every session (first 200 lines)' : f.loads === 'always' ? 'every session' : f.paths?.length ? `only for ${f.paths.join(', ')}` : 'when Claude needs it'

export function filesBody($: Dollar, els: ElementTable, u: Kit, s: StatusView, vw: ViewState, px: number): JSX.Element {
  const { Box, Text } = els
  const t = tiles($, els, u, vw.expanded, px)
  const n = s.native
  const always = n.files.filter(f => f.loads !== 'on-demand')
  const later = n.files.filter(f => f.loads === 'on-demand')
  const tile = (f: NativeFileView) => {
    const sc = SCOPE[f.scope] ?? SCOPE.project!
    const cap = f.loads === 'first-200' ? 200 : f.loads === 'always' ? 200 : 0
    // one line per file: its name, when it loads (and a too-long warning, the only status), its size; the rest on Show more
    return t.tile({
      flat: true,
      id: `nf-${f.label}`, icon: sc.icon, color: f.over ? K.amber : f.loads === 'on-demand' ? K.silver : K.emerald, title: f.label, compact: true,
      lead: { kind: sc.lead, alt: f.loads === 'on-demand' ? `${sc.alt}, loaded only when needed` : sc.alt, tint: f.over ? K.amber : undefined, muted: f.loads === 'on-demand' },
      time: f.tokens ? `${k(f.tokens)} tokens` : `${f.lines} lines`,
      preview: f.over ? `${loads(f)} · ${f.over}` : loads(f),
      body: [
        cap ? u.graphic(`nfg-${f.label}`, micro({ share: Math.min(1, f.lines / cap), width: Math.min(320, px - 140), color: f.lines > cap ? K.rose : f.lines > cap * 0.8 ? K.amber : K.emerald, animate: false }), `${f.lines} of ${cap} lines`) : null,
        <Text key={`nfs-${f.label}`} size="caption" color={K.label}>{`${sc.label.charAt(0).toUpperCase()}${sc.label.slice(1)}${f.editable ? '' : '. Cortex never changes this file'}`}</Text>,
        <Text key={`nfp-${f.label}`} size="caption" color={K.muted}>{`${f.lines} lines · ${(f.bytes / 1024).toFixed(1)} KB · ${f.path}`}</Text>,
      ],
    })
  }
  const mh = s.memHealth
  // health as plain pass / fail sentences
  const verdict = (key: string, ok: boolean | null, text: string) => u.tag(key, ok === null ? 'pending' : ok ? 'check' : 'alert', ok === null ? K.silver : ok ? K.emerald : K.amber, text, K.text)
  const overN = mh ? mh.files.filter(f => f.lines > f.limit).length : 0
  const share = mh && mh.scopedTokens + mh.alwaysTokens ? Math.round((100 * mh.scopedTokens) / (mh.scopedTokens + mh.alwaysTokens)) : 0
  const found = mh ? mh.checks - mh.clean : 0
  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('nf-in', pageScene('memory', 100), 'Cortex with your memory files', 'Memory files: the notes Claude Code loads by itself', 'Most load into every chat and cost tokens each time, so shorter is better.', companion('happy', px))}
      {u.card('nf-sum', '100%', [
        u.head('nf-h', 'What every chat pays for', n.autoMemory.enabled ? 'Claude\'s auto memory is on' : 'Claude\'s auto memory is off', n.autoMemory.enabled ? K.emerald : K.amber),
        <Box key="nf-m" flexDirection="row" alignItems="center" columnGap={1} rowGap={0} flexWrap="wrap">
          <Text size="heading" weight="semibold" tabular color={K.text}>{k(n.alwaysTokens)}</Text>
          <Text size="caption" color={K.label}>{`tokens, ${n.alwaysLines} lines`}</Text>
        </Box>,
        u.muted('nf-c', `${always.length} load in every chat · ${later.length} only when needed`),
        mh ? <Box key="nf-v" flexDirection="column" gap={0} paddingTop={1}>
          {verdict('nfh-b', !overN, overN ? `${overN} file${overN === 1 ? ' is' : 's are'} over Claude's 200-line limit` : `Every file is under Claude's 200-line limit`)}
          {verdict('nfh-s', share ? true : null, share ? `${share}% of your rules load only when Claude works in their folder` : 'All your rules load in every chat; folder rules could load only there')}
          {verdict('nfh-o', !mh.open, mh.open ? `${mh.open} flagged note${mh.open === 1 ? '' : 's'} not fixed yet` : 'No flagged notes left unfixed')}
          {mh.checks ? verdict('nfh-c', !found || !mh.open, !found ? `The last ${mh.checks} quick checks found nothing to fix` : mh.open ? `${found} of the last ${mh.checks} quick checks found something to fix` : `${found} of the last ${mh.checks} quick checks caught issues, all fixed since`) : null}
        </Box> : null,
      ])}
      {t.groupHead('nf-ah', 'spark', K.emerald, 'Loaded in every chat', String(always.length))}
      {t.rows('nf-al', always.map(f => tile(f)))}
      {later.length ? t.groupHead('nf-lh', 'pending', K.silver, 'Loaded only when needed', String(later.length)) : null}
      {later.length ? t.rows('nf-ll', later.map(f => tile(f))) : null}
      {s.migrated ? u.tag('nf-mig', 'save', K.silver, `Your Cortex v2 memories are kept in ${s.migrated}: copy what you still want into CLAUDE.md, or let a Dream sort it.`, K.muted) : null}
    </Box>
  )
}
