import { clock, k } from './charts'
import { ago, animateFor, minsSince, type Dollar } from './data'
import type { Ctx } from './tabs'
import { K, levelColor } from './theme'
import { parkButton, parkedList, savedCard, spendCard } from './spend'
import type { Tiles } from './tiles'
import { area, lollipop, micro, stacked } from './viz'
import { sceneSvg } from './mascot'

/** Category colours for the composition bar: neutrals first, then the emerald family (never the warning colours). */
const CAT = ['#9CA3AF', '#14B8A6', '#34D399', '#6B7280', '#10B981', '#A7F3D0', '#4B5563']

// Costs: hook speed, the plan, what loads into every message, which MCP servers and skills you never use.
// Data already on hand only.

export function detailsBody($: Dollar, o: Ctx, t: Tiles): JSX.Element {
  const { s, l, u, five } = o
  const { Box, Text } = o.els
  const w = Math.min(o.px - 120, 520)
  const recent = s.hooks.recent ?? []
  const rows = (l?.context.rows ?? []).filter(r => !/messages|free space|autocompact/i.test(r.name) && r.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const usage = s.usage
  const lo = (l?.loadout ?? []).filter(x => x.loaded >= 200)
  // a skill is called as "plugin:skill" or just "skill" in transcripts: match on the skill's own short name
  const usedHere = (x: { kind: string; name: string; names?: string[] }) => !usage ? true : x.kind === 'mcp'
    ? (usage.mcp[x.name] ?? 0) > 0
    : Object.keys(usage.skills).some(n => n.startsWith(`${x.name}:`) || (x.names ?? []).includes(n.split(':').pop()!))
  const label = (x: { kind: string; name: string }) => `${x.kind === 'mcp' ? 'MCP' : 'Skills'} · ${x.name.replace(/^plugin_/, '')}`
  const idle = lo.filter(x => !usedHere(x))
  const maxLo = Math.max(1, ...lo.map(x => x.loaded))
  // a half-width pane: no bar, shorter badges, so each row (and its button) stays on one line
  const narrow = o.px < 900
  const line = (key: string, left: string, right: string, color: string = K.label, ic = '') => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>{ic ? u.tag(`${key}-t`, ic, color === K.amber ? K.amber : K.silver, left, color) : <Text size="caption" color={color}>{left}</Text>}<Text size="caption" tabular color={K.text}>{right}</Text></Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      {u.intro('d-in', sceneSvg('costs', 120), 'Cortex counting tokens', 'What it costs', 'Per message and for this project, from Claude Code\'s own numbers.')}
      {u.card('d-speed', '100%', [
        u.head('d-speed-h', 'Speed and plan'),
        line('d-hook-l', 'Hook speed, real runs (p95)', s.hooks.p95 !== null ? `${s.hooks.p95} ms of ${s.hooks.cap} ms · ${s.hooks.samples} runs` : 'no runs yet'),
        recent.length > 1 ? u.graphic('d-hook-g', area({ values: recent, width: w, height: 48, limit: s.hooks.cap, color: levelColor((s.hooks.p95 ?? 0) / s.hooks.cap, 0.7, 0.95), animate: animateFor('hooks', recent.join(',')) }), `Hook times, last ${recent.length} runs`) : null,
        line('d-plan-l', 'Plan usage, 5-hour window', five ? `${five.percentUsed}%${five.resetsAt ? ` · resets ${clock(Date.parse(five.resetsAt))}` : ''}` : 'no data'),
        u.graphic('d-plan-g', micro({ share: (five?.percentUsed ?? 0) / 100, width: w, animate: animateFor('dplan', `${five?.percentUsed}`) }), `${five?.percentUsed ?? 0}% used`),
        line('d-mem', 'Memory Claude loads in every session', `${k(s.native.alwaysTokens)} tokens · ${s.native.alwaysLines} lines`),
        line('d-cx', 'What Cortex adds to your messages', s.footprint ? `~${k(s.footprint.tokens)} tokens: its ${s.footprint.skills} skill descriptions${s.footprint.duplicates ? `, ${s.footprint.duplicates} listed twice (old copies in ~/.claude/skills)` : ''}; plus one short note when a chat opens with a handoff waiting` : 'its skill descriptions, plus one short note when a chat opens with a handoff waiting'),
      ])}
      {rows.length ? u.card('fixed', '100%', [
        u.head('fx-t', 'Loaded into every message', `${k(rows.reduce((a, r) => a + r.tokens, 0))} tokens before you type`),
        u.graphic('fx-g', stacked({ items: rows.slice(0, 7).map((r, i) => ({ value: r.tokens, color: CAT[i % CAT.length]!, label: `${r.name}: ${k(r.tokens)} tokens` })), width: Math.min(o.px - 90, 980), animate: animateFor('fx', rows.map(r => r.tokens).join(',')) }), rows.map(r => `${r.name} ${k(r.tokens)}`).join(', ')),
        <Box key="fx-lg" flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={0}>
          {rows.slice(0, 7).map((r, i) => (
            <Box key={`fx-${r.name}`} flexDirection="row" gap={1} alignItems="center">
              {u.dot(`fxd-${r.name}`, CAT[i % CAT.length]!)}
              <Text size="caption" color={K.label}>{r.name.replace(/^System /, '')}</Text>
              <Text size="caption" tabular weight="semibold" color={K.text}>{k(r.tokens)}</Text>
              <Text size="caption" tabular color={K.muted}>{`${Math.round((100 * r.tokens) / Math.max(1, rows.reduce((a, x) => a + x.tokens, 0)))}%`}</Text>
            </Box>
          ))}
        </Box>,
        u.muted('fx-cache', 'Cached after the first reply: re-read at about 1/10 the price.'),
      ]) : null}
      {lo.length ? u.card('lo', '100%', [
        u.head('lo-t', 'Tools and skills loaded here', usage ? `use counted over your last ${usage.chats} chat${usage.chats === 1 ? '' : 's'} here` : undefined),
        ...lo.slice(0, 10).map(x => {
          const used = usedHere(x)
          const n = x.kind === 'mcp' ? usage?.mcp[x.name] ?? 0 : Object.entries(usage?.skills ?? {}).filter(([n2]) => n2.startsWith(`${x.name}:`) || (x.names ?? []).includes(n2.split(':').pop()!)).reduce((a, [, v]) => a + v, 0)
          return (
            <Box key={`lo-${x.kind}-${x.name}`} flexDirection="row" alignItems="center" columnGap={1} flexWrap="nowrap">
              <Box {...(narrow ? { flexGrow: 1 } : { width: '34%' })} minWidth={12} flexShrink={1}>{u.tag(`lot-${x.kind}-${x.name}`, x.kind === 'mcp' ? 'link' : 'spark', used ? K.emerald : K.amber, label(x), K.text)}</Box>
              {narrow ? null : <Box flexGrow={1} minWidth={10}>{u.graphic(`log-${x.kind}-${x.name}`, lollipop({ share: x.loaded / maxLo, width: Math.max(60, w * 0.42), color: used ? K.emerald : K.amber, animate: animateFor(`lo-${x.name}`, String(x.loaded)) }), `${k(x.loaded)} tokens`)}</Box>}
              <Text size="caption" tabular weight="semibold" color={K.text}>{k(x.loaded)}</Text>
              {t.badge(`lob-${x.kind}-${x.name}`, usage ? (used ? (narrow ? `×${n}` : `used ×${n}`) : (narrow ? 'unused' : 'unused lately')) : 'use unknown', used ? K.emerald : K.amber, narrow ? undefined : used ? 'check' : 'pending')}
              {parkButton($, o.els, s, x)}
            </Box>
          )
        }),
        idle.length && usage ? t.badge('lo-idle', `${idle.length} unused · about ${k(idle.reduce((a, x) => a + x.loaded, 0))} tokens of context in every message`, K.amber, 'alert') : null,
      ]) : null}
      {parkedList($, o.els, u, t, s, l)}
      {idle.some(x => x.kind === 'skills') ? u.muted('lo-sk', 'Plugin skills: turn off with /plugin, or in Claude Desktop → Customize.') : null}
      {spendCard($, o.els, u, t, s, o.px)}
      {savedCard(u, t, s)}
      {u.muted('d-turns', `${l ? `${l.turns} turns this session` : ''}${l?.costUsd !== undefined ? ` · $${l.costUsd.toFixed(2)} at API prices` : ''}`)}
    </Box>
  )
}
