import { clock, k } from './charts'
import { ago, animateFor, minsSince, type Dollar } from './data'
import type { Ctx } from './tabs'
import { K, levelColor } from './theme'
import { area, micro } from './viz'

// Costs: hook speed, the plan, what loads into every message, which MCP servers and skills you never use.
// Data already on hand only.

export function detailsBody($: Dollar, o: Ctx): JSX.Element {
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
  const line = (key: string, left: string, right: string, color: string = K.label, ic = '') => (
    <Box key={key} flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={1}>{ic ? u.tag(`${key}-t`, ic, color === K.amber ? K.amber : K.silver, left, color) : <Text size="caption" color={color}>{left}</Text>}<Text size="caption" tabular color={K.text}>{right}</Text></Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      {u.card('d-speed', '100%', [
        u.head('d-speed-h', 'Speed and plan'),
        line('d-hook-l', 'Hook speed, real runs (p95)', s.hooks.p95 !== null ? `${s.hooks.p95} ms of ${s.hooks.cap} ms · ${s.hooks.samples} runs` : 'no runs yet'),
        recent.length > 1 ? u.graphic('d-hook-g', area({ values: recent, width: w, height: 48, limit: s.hooks.cap, color: levelColor((s.hooks.p95 ?? 0) / s.hooks.cap, 0.7, 0.95), animate: animateFor('hooks', recent.join(',')) }), `Hook times, last ${recent.length} runs`) : null,
        line('d-plan-l', 'Plan usage, 5-hour window', five ? `${five.percentUsed}%${five.resetsAt ? ` · resets ${clock(Date.parse(five.resetsAt))}` : ''}` : 'no data'),
        u.graphic('d-plan-g', micro({ share: (five?.percentUsed ?? 0) / 100, width: w, animate: animateFor('dplan', `${five?.percentUsed}`) }), `${five?.percentUsed ?? 0}% used`),
        line('d-mem', 'Memory Claude loads in every session', `${k(s.native.alwaysTokens)} tokens · ${s.native.alwaysLines} lines`),
        line('d-cx', 'What Cortex adds to your messages', '0 tokens (hooks write files; nothing is injected)'),
      ])}
      {rows.length || usage ? (
        <Box key="fixed" flexDirection="column" gap={1} backgroundColor={K.card} borderStyle="round" borderColor={K.hairline} paddingX={2} paddingY={1}>
          {u.head('fx-t', 'Loaded into every message')}
          {rows.slice(0, 6).map(r => line(`fx-${r.name}`, r.name, `${k(r.tokens)} tokens`))}
          {usage ? u.muted('fx-used', `Used in your last ${usage.chats} chat${usage.chats === 1 ? '' : 's'} here: skills ${Object.entries(usage.skills).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ×${v}`).join(', ') || 'none'} · MCP servers ${Object.entries(usage.mcp).sort((a, b) => b[1] - a[1]).map(([n, v]) => `${n} ×${v}`).join(', ') || 'none'}.`) : null}
        </Box>
      ) : null}
      {lo.length ? (
        <Box key="lo" flexDirection="column" gap={1} backgroundColor={K.card} borderStyle="round" borderColor={K.hairline} paddingX={2} paddingY={1}>
          {u.head('lo-t', 'Tools and skills loaded here')}
          {lo.slice(0, 8).map(x => line(`lo-${x.kind}-${x.name}`, `${label(x)}${usedHere(x) ? '' : ' · unused lately'}`, `${k(x.loaded)} tokens`, usedHere(x) ? K.label : K.amber, x.kind === 'mcp' ? 'link' : 'spark'))}
          {idle.length && usage ? u.muted('lo-idle', `Not used in your last ${usage.chats} chats here: ${idle.map(label).join(', ')} (about ${k(idle.reduce((a, x) => a + x.loaded, 0))} tokens in every message). A plugin turns off with claude plugin disable <name>; other MCP servers in /mcp.`) : null}
        </Box>
      ) : null}
      {u.muted('d-turns', `${l ? `${l.turns} turns this session` : ''}${l?.costUsd !== undefined ? ` · $${l.costUsd.toFixed(2)} at API prices` : ''}`)}
    </Box>
  )
}
