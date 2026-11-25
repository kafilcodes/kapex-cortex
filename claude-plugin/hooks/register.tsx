import type { Register } from 'claude-code'

import { renderBand } from './band'
import { ensureChat, noteCwd, openPane, PANE, refresh, refreshLive, stampCache } from './data'
import { startPulse, stopPulse, turnEnded, turnStarted } from './pulse'
import { renderPane } from './panel'
import { renderBackdrop, startLook } from './look'

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
    // this chat's own numbers at once (0% / cache starts on reply / resume offer), never the last chat's: in-process,
    // no Node, bounded so a slow engine call can't hold the start
    try { await within($, (async () => { await ensureChat($); await refreshLive($) })(), 400) } catch { /* the heartbeat fills it */ }
    // lets the model open the panel when asked ("show me Cortex"); behind ToolSearch, so it costs only its name per request
    // a refused registration never stops the strip and panel from starting
    try { await $.tool.register({ name: 'open_panel', description: 'Open the Kapex Cortex panel beside the chat: project rules, approvals, handoffs, compactions and cache. Use when the user asks to see Cortex, its panel or dashboard.', inputSchema: { type: 'object', properties: {} } }) } catch { /* the panel still opens with /kc */ }
    void refresh($)
    startPulse($) // the strip stays true between turns: see pulse.ts
    await startLook($) // the Kapex look, where it applies (look.tsx); never blocks or breaks the start
    return next(e)
  })
  // the main thread's turn: the first request warms the cache, and the strip's numbers follow the turn live
  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    if ((e as { agentId?: string }).agentId === undefined) { void stampCache($); turnStarted($) }
    return r
  })
  // a /clear or a resume ends this chat but not the process, and no session.start follows: start the per-chat values
  // over for the new id and keep the heartbeat. Any other end (exit, logout, a signal) stops the heartbeat for good.
  on('session.end', async ($, e, next) => {
    const reason = (e as { reason?: string }).reason
    const r = await next(e)
    if (reason === 'clear' || reason === 'resume') {
      try { await ensureChat($, (e as { sessionId?: string }).sessionId ?? ''); await refreshLive($) } catch { /* the next beat retries */ }
      startPulse($)
      void refresh($)
    } else stopPulse()
    return r
  })
  // after Claude summarizes the chat the context drops: show it now, not at the next reply
  on('session.compact', async ($, e, next) => { const r = await next(e); void refreshLive($).catch(() => undefined); return r })
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

  // the Kapex backdrop behind the conversation (desktop and mobile); other plugins' scenes pass through
  on('ui.render', { component: 'Backdrop' }, ($, e, next) => renderBackdrop($, e as never, next as never) as Promise<JSX.Element>)

  // anything that still fails (a store read, the engine itself) draws a short card with Refresh, never a blank or closed pane
  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e)).catch(($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Text weight="semibold">Kapex Cortex</Text>
        <Text size="caption" color="inactive">The panel couldn't draw just now. Press Refresh, or type /kc again.</Text>
        <Button key="kc-fallback-refresh" variant="primary" onPress={() => { void refresh($) }}>Refresh</Button>
      </Box>
    )
  })
}
