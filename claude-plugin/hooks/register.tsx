import type { Register } from 'claude-code'

import { renderBand } from './band'
import { noteCwd, openPane, PANE, refresh, stampCache } from './data'
import { startPulse, stopPulse, turnEnded, turnStarted } from './pulse'
import { renderPane } from './panel'

// Kapex Cortex: hook wiring only. State and refresh live in data.ts, the pane in panel.tsx + tabs.tsx.
/** Waits for `p`, but no longer than `ms` (where there is no clock, as in tests, just for `p`). */
async function within($: Parameters<typeof refresh>[0], p: Promise<void>, ms: number): Promise<void> {
  let t: { cancel(): void } | undefined
  const late = new Promise<void>(res => { try { t = $.clock.after(ms, res) } catch { /* no clock */ } })
  try { await Promise.race([p, late]) } finally { t?.cancel() }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    noteCwd((e as { cwd?: string }).cwd ?? '')
    // lets the model open the panel when asked ("show me Cortex"); behind ToolSearch, so it costs only its name per request
    // a refused registration never stops the strip and panel from starting
    try { await $.tool.register({ name: 'open_panel', description: 'Open the Kapex Cortex panel beside the chat: project rules, approvals, handoffs, compactions and cache. Use when the user asks to see Cortex, its panel or dashboard.', inputSchema: { type: 'object', properties: {} } }) } catch { /* the panel still opens with /kc */ }
    void refresh($)
    startPulse($) // the strip stays true between turns: see pulse.ts
    return next(e)
  })
  // the main thread's turn: the first request warms the cache, and the strip's numbers follow the turn live
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if ((e as { agentId?: string }).agentId === undefined) { void stampCache($); turnStarted($) }
    return r
  })
  on('session.end', async ($, e, next) => { stopPulse(); return next(e) })
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = (e as { usage?: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }; agentId?: string })
    if (!u.agentId) {
      const usage = u.usage
      await stampCache($, usage)
      turnEnded($)
      void refresh($)
    } // a subagent's turn: no full read each time (parallel agents would start one each); the heartbeat sees what they wrote
    return r
  })

  // /kc opens the panel and prints nothing: no transcript line, so nothing reaches the model (0 tokens). The command is
  // the plugin's `kc` skill (skills/kc), listed from disk when the chat starts, so Claude Desktop knows /kc from the
  // first keystroke (a command registered in session.start can reach the app's command list too late, and the app
  // then says "/kc isn't a command here"). This hook answers it before the skill's text could reach the model.
  on('command.run', { command: /^(kapex-cortex:)?kc$/ }, async $ => {
    await within($, refresh($), 1_500) // fresh numbers when they come quickly; never held longer by a slow refresh
    await openPane($)
    return {}
  })
  on('tool.call', { tool: /^mcp__kapex-cortex__open_panel$/ }, async $ => {
    await within($, refresh($), 1_500)
    await openPane($)
    return { result: 'Opened the Kapex Cortex panel beside the chat.' }
 }).catch(($, e, next) => (next.called ? next(e) : { result: 'Could not open the Kapex Cortex panel; type /kc instead.' }))

  // the status strip above the prompt: context, cache, plan, handoff, waiting memories, and an Open Cortex button (0 tokens)
  on('ui.render', { component: 'AbovePrompt' }, ($, e, next) => renderBand($, e as never, next as never) as Promise<JSX.Element>)

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
