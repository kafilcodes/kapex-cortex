import type { LiveView } from '../types'

// What each MCP server and each plugin's skills cost in this chat, from Claude Code's own context breakdown (data.ts
// reads it with the live numbers). Pure: no state.
type Breakdown = { mcpTools?: readonly { name: string; serverName?: string; tokens: number; isLoaded: boolean }[]; skills?: { skillFrontmatter?: readonly { name: string; pluginName?: string; tokens: number }[] } }
/** What each MCP server and each plugin's skills cost here. Server keys match tool names (mcp__<server>__tool), as usage.ts counts them. */
export function loadout(b: Breakdown | undefined): LiveView['loadout'] {
  if (!b) return undefined
  const m = new Map<string, { kind: 'mcp' | 'skills'; name: string; tokens: number; loaded: number; items: number; names?: string[]; server?: string }>()
  const add = (kind: 'mcp' | 'skills', name: string, tokens: number, loaded: boolean, item?: string, server?: string) => {
    const k = `${kind}:${name}`
    const x = m.get(k) ?? { kind, name, tokens: 0, loaded: 0, items: 0, ...(server ? { server } : {}) }
    x.tokens += tokens; x.items += 1; if (loaded) x.loaded += tokens
    if (item) x.names = [...(x.names ?? []), item.split(':').pop()!]
    m.set(k, x)
  }
  // serverName is the name /mcp shows: the one Claude Code's own disabledMcpServers list takes
  for (const t of b.mcpTools ?? []) add('mcp', t.name.split('__')[1] ?? t.name, t.tokens, t.isLoaded, undefined, t.serverName)
  for (const sk of b.skills?.skillFrontmatter ?? []) add('skills', sk.pluginName ?? (sk.name.includes(':') ? sk.name.split(':')[0]! : 'your own'), sk.tokens, true, sk.name)
  return [...m.values()].sort((a, b2) => b2.loaded - a.loaded)
}
