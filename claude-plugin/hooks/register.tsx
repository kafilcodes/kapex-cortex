import type { Register } from 'claude-code'

import { renderBand } from './band'
import { noteCwd, openPane, PANE, refresh, stampCache } from './data'
import { renderPane } from './panel'

// Kapex Cortex: hook wiring only. State and refresh live in data.ts, the pane in panel.tsx + tabs.tsx.
export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    noteCwd((e as { cwd?: string }).cwd ?? '')
    await $.command.register({ name: 'kc', description: 'Kapex Cortex: open the memory, handoff and cache panel' })
    // lets the model open the panel when asked ("show me Cortex"); behind ToolSearch, so it costs only its name per request
    await $.tool.register({ name: 'open_panel', description: 'Open the Kapex Cortex panel beside the chat: project rules, approvals, handoffs, compactions and cache. Use when the user asks to see Cortex, its panel or dashboard.', inputSchema: { type: 'object', properties: {} } })
    void refresh($)
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = (e as { usage?: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }; agentId?: string })
    if (!u.agentId) {
      const usage = u.usage
      await stampCache($, usage)
    }
    void refresh($)
    return r
  })

  // /kc opens the panel and prints nothing: no transcript line, so nothing reaches the model (0 tokens)
  on('command.run', { command: 'kc' }, async $ => {
    await refresh($)
    await openPane($)
    return {}
  })
  on('tool.call', { tool: /^mcp__kapex-cortex__open_panel$/ }, async $ => {
    await refresh($)
    await openPane($)
    return { result: 'Opened the Kapex Cortex panel beside the chat.' }
 }).catch(($, e, next) => (next.called ? next(e) : { result: 'Could not open the Kapex Cortex panel; type /kc instead.' }))

  // the status strip above the prompt: context, cache, plan, handoff, waiting memories, and an Open Cortex button (0 tokens)
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e, next))

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
