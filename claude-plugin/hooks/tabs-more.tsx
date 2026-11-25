import { clock, k } from './charts'
import { ago, animateFor, minsSince, setCostsSub, type Dollar } from './data'
import type { Ctx } from './tabs'
import { K } from './theme'
import { parkButton, parkedList, savedCard, spendCard } from './spend'
import { tiles } from './tiles'
import { area, lollipop, micro, stacked } from './viz'
import { pageScene } from './mascot'
import { burnCard, workCard } from './activity'
import { planCard } from './plan-card'
import { companion } from './blocky'

/** Category colours for the composition bar: neutrals first, then the emerald family (never the warning colours). */
const CAT = ['#9CA3AF', '#14B8A6', '#34D399', '#4B5563', '#10B981', '#A7F3D0', '#6B7280']
/** Claude Code's context categories in plain words. */
const PLAIN: Record<string, string> = { 'System prompt': 'System prompt', 'System tools': 'Built-in tools', 'MCP tools': 'Tools (MCP servers)', 'Custom agents': 'Agents', 'Memory files': 'Memory files', Skills: 'Skills (instructions plugins add)' }
const plain = (n: string) => PLAIN[n] ?? n.replace(/^System /, '')
/** Past the 150 ms target, amber up to here and red only beyond: a few slow replies on a busy machine are not a fault. */
const SLOW = 200

// Costs: hook speed, the plan, what loads into every message, which MCP servers and skills you never use.
// Data already on hand only.

export function costsPage($: Dollar, o: Ctx): JSX.Element {
  const { s, l, u, five } = o
  const t = tiles($, o.els, u, o.vw.expanded, o.px)
  const { Box, Text } = o.els
  const w = Math.max(160, Math.round(o.px - 52)) // a chart spans its card (pane padding, card padding and border)
  const recent = s.hooks.recent ?? []
  const p95 = s.hooks.p95
  const speed = p95 === null || p95 <= s.hooks.cap ? { text: 'Within the target', color: K.emerald, icon: 'check' }
    : p95 <= SLOW ? { text: 'A little slow: usually a busy Mac', color: K.amber, icon: 'pending' }
    : { text: 'Over the limit', color: K.rose, icon: 'alert' }
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
  // Usage: what you used over time (Costs is what each message costs now); the same quiet track as Memory's views
  const sub = o.vw.csub === 'usage' ? 'usage' : 'costs'
  const nav = t.seg('csubnav', [['costs', 'Costs'], ['usage', 'Usage']], sub, x => { void setCostsSub($, x) })
  if (sub === 'usage') {
    const cards = [burnCard(o.els, u, s, o.px), workCard(o.els, u, s, o.px), spendCard($, o.els, u, t, s, o.px)]
    return (
      <Box flexDirection="column" gap={1}>
        {nav}
        {u.intro('us-in', pageScene('saved', 100), 'Cortex beside a stack of tokens', 'Usage: how you have used Claude in this project', 'Day by day, hour by hour and tool by tool, from Claude Code\'s own transcripts. Nothing here costs tokens.', companion('happy', o.px))}
        {cards.some(Boolean) ? cards : u.tag('us-none', 'pending', K.silver, 'Shows after your first replies in this project.')}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {nav}
      {u.intro('d-in', pageScene('costs', 100), 'Cortex counting tokens', 'Costs: what every message carries, and what this project used', 'From Claude Code\'s own numbers. Claude re-reads a chat at a tenth of the price while its cache is warm.', companion('idle', o.px))}
      {planCard(o, t, w)}
      {s.footprint?.duplicates ? u.muted('d-cx', `Cortex's skills are listed twice (old copies in ~/.claude/skills): ${s.footprint.duplicates} extra descriptions in every message.`) : null}
      {rows.length ? u.card('fixed', '100%', [
        u.head('fx-t', 'Loaded into every message', `${k(rows.reduce((a, r) => a + r.tokens, 0))} tokens of setup`),
        u.graphic('fx-g', stacked({ items: rows.slice(0, 7).map((r, i) => ({ value: r.tokens, color: CAT[i % CAT.length]!, label: `${plain(r.name)}: ${k(r.tokens)} tokens` })), width: w, animate: animateFor('fx', rows.map(r => r.tokens).join(',')) }), rows.map(r => `${plain(r.name)} ${k(r.tokens)}`).join(', ')),
        <Box key="fx-lg" flexDirection="row" flexWrap="wrap" columnGap={3} rowGap={0}>
          {rows.slice(0, 7).map((r, i) => (
            <Box key={`fx-${r.name}`} flexDirection="row" gap={1} alignItems="center">
              {u.dot(`fxd-${r.name}`, CAT[i % CAT.length]!)}
              <Text size="caption" color={K.label}>{plain(r.name)}</Text>
              <Text size="caption" tabular weight="semibold" color={K.text}>{k(r.tokens)}</Text>
              <Text size="caption" tabular color={K.muted}>{`${Math.round((100 * r.tokens) / Math.max(1, rows.reduce((a, x) => a + x.tokens, 0)))}%`}</Text>
            </Box>
          ))}
        </Box>,
        u.muted('fx-cache', 'Cached after the first reply, so re-reading it costs about a tenth.'),
      ]) : null}
      {lo.length ? u.card('lo', '100%', [
        u.head('lo-t', 'Tools (MCP servers) and skills (instructions plugins add) in this chat', usage ? `use in your last ${usage.chats} chat${usage.chats === 1 ? '' : 's'}` : undefined),
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
      {idle.some(x => x.kind === 'skills') ? u.muted('lo-sk', 'To turn off a plugin\'s skills, use /plugin, or Customize in Claude Desktop.') : null}
      {savedCard(u, t, s, o.px)}
      {u.card('d-speed', '100%', [
        // Cortex's own cost in time, last: it matters, but it is not what you came here to see. The target is 150 ms;
        // a busy Mac (a build, a browser full of tabs) can push a few replies past it, so only past 200 ms is red
        u.head('d-speed-h', 'How fast Cortex is'),
        line('d-hook-l', 'Time Cortex takes after each reply (slowest 1 in 20)', p95 !== null ? `${p95} ms · target ${s.hooks.cap} ms · ${s.hooks.samples} replies` : 'no replies yet'),
        p95 !== null ? <Box key="d-hook-bw" flexDirection="row">{t.badge('d-hook-b', speed.text, speed.color, speed.icon)}</Box> : null,
        recent.length > 1 ? u.graphic('d-hook-g', area({ values: recent, width: w, height: 48, limit: s.hooks.cap, color: speed.color, animate: animateFor('hooks', recent.join(',')) }), `Hook times, last ${recent.length} runs`) : null,
      ])}
    </Box>
  )
}
