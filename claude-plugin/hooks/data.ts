import { atom, read, update } from 'claude-code'
import type { Hook } from 'claude-code'

import type { CacheView, LiveView, OffView, StatusView, Tab, ViewState } from '../types'
import { unusedTools } from './tips'

// Kapex Cortex panel state and refresh. Data: Claude Code's own numbers ($.session.usage/model/turns, turn.complete usage)
// plus `kc status --json`. No timer: refreshes on turn end, button press or panel open, writes state only
// on change, animates only on change. Layout follows the pane's width: stacked cards → 2 → 3 columns.
export const PANE = 'kapex-cortex'
export const status = atom({ plugin: 'kapex-cortex', key: 'status' } as const, null as StatusView | null, { shape: 'status-4' })
export const live = atom({ plugin: 'kapex-cortex', key: 'live' } as const, null as LiveView | null, { shape: 'live-1' })
export const note = atom({ plugin: 'kapex-cortex', key: 'note' } as const, '', { shape: 'note-1' })
export const tab = atom({ plugin: 'kapex-cortex', key: 'tab' } as const, '' as Tab | '', { shape: 'tab-3' })
export const history = atom({ plugin: 'kapex-cortex', key: 'history' } as const, [] as number[], { shape: 'history-1' })
export const planHist = atom({ plugin: 'kapex-cortex', key: 'planHist' } as const, [] as { t: number; p: number }[], { shape: 'plan-1' })
export const cache = atom({ plugin: 'kapex-cortex', key: 'cache' } as const, { lastAt: null, read: 0, write: 0, input: 0, ttl: '1h', ttlSource: 'assumed' } as CacheView, { shape: 'cache-1' })

// project: the Cortex folder this chat shows (empty = the chat's own folder); off: what kc said when the folder has no Cortex
export const project = atom({ plugin: 'kapex-cortex', key: 'project' } as const, '', { shape: 'project-1' })
export const off = atom({ plugin: 'kapex-cortex', key: 'off' } as const, null as OffView | null, { shape: 'off-1' })
// files the read guard already warned about in this session: the second read of the same file goes through
export const warned = atom({ plugin: 'kapex-cortex', key: 'warned' } as const, [] as string[], { shape: 'warned-1' })
// list state for the Memory and Timeline tabs: collapsed groups, how many rows each shows, the memory being edited
export const view = atom({ plugin: 'kapex-cortex', key: 'view' } as const, { collapsed: [], more: {}, editing: '', expanded: [], sub: '' } as ViewState, { shape: 'view-2' })
// why the last refresh failed ('' when it worked): shown in the strip instead of the strip vanishing
export const fail = atom({ plugin: 'kapex-cortex', key: 'fail' } as const, '', { shape: 'fail-1' })

export type Dollar = Parameters<Hook<'session.start'>>[0]
const STORE_STATUS = 'last-status-v3' // v3 status has another shape: a v2 one saved before the update is never read
const STORE_LIMITS = 'last-limits'
let lastTry = 0
let sessionCwd = ''
/** The chat's folder (from session.start): a saved status is only reused for the same project. */
export function noteCwd(cwd: string): void { sessionCwd = cwd }
const seen: Record<string, string> = {}
const lastJson = { s: '', l: '' }
export const animateFor = (key: string, sig: string) => { const changed = seen[key] !== sig; seen[key] = sig; return changed }

// The CLI ships inside the plugin (cortex/src/cli.ts) and runs with Node directly: no shell, so it works
// the same on macOS, Linux and Windows. GUI apps don't always get the shell's PATH, so a few usual places
// are tried once; the one that works is remembered until the next reload.
let nodeBin = ''
export async function kc($: Dollar, args: string[]): Promise<{ ok: boolean; out: string }> {
  const dir = await read($, project)
  const cli = `${$.plugin.root}/cortex/src/cli.ts`
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
  const tries = nodeBin ? [nodeBin] : ['node', `${home}/.local/bin/node`, '/opt/homebrew/bin/node', '/usr/local/bin/node']
  let why = ''
  for (const bin of tries) {
    try {
      const r = await $.process.run([bin, cli, ...args], { timeoutMs: 20_000, ...(dir ? { cwd: dir } : {}) })
      nodeBin = bin
      return { ok: r.exitCode === 0, out: String(r.stdout || r.stderr || '') }
    } catch (err) {
      // a non-zero exit doesn't throw; a throw means the program couldn't start (or timed out)
      why = String(err)
      if (/timed? ?out/i.test(why)) break
    }
  }
  return { ok: false, out: /timed? ?out/i.test(why) ? why : 'Node.js 23.6 or newer is needed (nodejs.org) and was not found.' }
}

/** Cache lifetime: the person's setting, else env, else inferred from the plan (subscription → 1 h). */
async function cacheTtl($: Dollar, hasPlanLimits: boolean): Promise<{ ttl: '5m' | '1h'; source: string }> {
  try {
    const st = (await $.settings.read()) as { promptCacheTtl?: string }
    if (st.promptCacheTtl === '1h' || st.promptCacheTtl === '5m') return { ttl: st.promptCacheTtl, source: 'your setting' }
  } catch { /* no settings */ }
  if (await $.env.get('FORCE_PROMPT_CACHING_5M')) return { ttl: '5m', source: 'env' }
  const env = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  if (env === '1h' || env === '5m') return { ttl: env, source: 'env' }
  if (await $.env.get('ENABLE_PROMPT_CACHING_1H')) return { ttl: '1h', source: 'env' }
  return hasPlanLimits ? { ttl: '1h', source: 'assumed for subscription' } : { ttl: '5m', source: 'API default' }
}

/** The files other chats and tools write here (handoff, journal, Dreams, git): their times, joined. Read by the
 * strip's heartbeat to know, with four stats and no Node, that a full refresh would show something new. */
export async function vaultStamp($: Dollar, root: string): Promise<string> {
  const at = (f: string) => $.fs.stat(`${root}/${f}`).then(x => String(x.mtimeMs), () => '-')
  return (await Promise.all(['.vault/STATE.md', '.vault/private/episodes.jsonl', '.vault/dreams', '.git/logs/HEAD'].map(at))).join(':')
}
let seenStamp = ''
/** The stamp the last full refresh started from ('' before the first). */
export const lastStamp = () => seenStamp

export async function refresh($: Dollar): Promise<void> {
  const root = (await read($, status))?.root
  if (root) seenStamp = await vaultStamp($, root).catch(() => '')
  let r = await kc($, ['status', '--json'])
  let s: StatusView | null = null
  if (!r.ok) {
    // no Cortex in this chat's folder: if exactly one child folder has it (a chat opened one level up), show that one
    let o: OffView | null = null
    try { const j = JSON.parse(r.out) as OffView & { off?: boolean }; o = j.off ? { cwd: j.cwd, nearby: j.nearby ?? [] } : null } catch { o = /^Node\.js/.test(r.out) ? { cwd: '', nearby: [], error: r.out } : null }
    if (JSON.stringify(o) !== JSON.stringify(await read($, off))) await update($, off, () => o)
    if (o && o.nearby.length === 1 && !(await read($, project))) { await update($, project, () => `${o.cwd}/${o.nearby[0]}`); r = await kc($, ['status', '--json']) }
  }
  let failed = ''
  if (r.ok) { try { s = JSON.parse(r.out) as StatusView } catch { failed = 'Cortex sent an unreadable status' } }
  else if (!(await read($, off))) failed = (r.out.split('\n')[0] ?? '').slice(0, 140) || 'Cortex did not answer'
  // a failed refresh never blanks a good status: keep the last one (and say it's stale) until one succeeds
  if (!s && failed) s = (await read($, status)) ?? ((await $.store.get(STORE_STATUS)) as StatusView | undefined) ?? null
  if ((await read($, fail)) !== failed) await update($, fail, () => failed)
  if (r.ok && s) void $.store.set(STORE_STATUS, s).catch(() => undefined) // instant strip after a restart or app update
  if (!root && s?.root) seenStamp = await vaultStamp($, s.root).catch(() => '')
  const l = await liveNow($)
  if (l) {
    const t = await cacheTtl($, l.limits.some(x => x.kind === 'five_hour'))
    const cur = await read($, cache)
    if (cur.ttl !== t.ttl || cur.ttlSource !== t.source) await update($, cache, c => ({ ...c, ttl: t.ttl, ttlSource: t.source }))
    // after an app restart this chat's last reply time is gone: the journal has it (the Stop hook wrote it)
    const ep = !cur.lastAt && l.turns > 0 && l.sessionId ? s?.episodes?.find(e => e.session === l.sessionId) : undefined
    if (ep && Date.parse(ep.end)) await update($, cache, c => (c.lastAt ? c : { ...c, lastAt: Date.parse(ep.end) }))
  }
  const sj = JSON.stringify(s)
  if (sj !== lastJson.s) { lastJson.s = sj; await update($, status, () => s) }
  await putLive($, l)
  if (s && l) void autoPark($, s, l)
}

/** Claude Code's own numbers for this chat (in-process: no command, no tokens), or null where they can't be read. */
async function liveNow($: Dollar): Promise<LiveView | null> {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    return {
      model: await $.session.model(),
      turns: await $.session.turns(),
      context: { tokens: u.context.tokens, window: u.context.breakdown?.maxTokens ?? u.context.window, percent: u.context.percent, rows: (u.context.breakdown?.categories ?? []).filter(c => !c.isDeferred).map(c => ({ name: c.name, tokens: c.tokens })) },
      limits: u.rateLimits.map(x => ({ kind: x.kind, percentUsed: x.percentUsed, resetsAt: x.resetsAt })),
      costUsd: u.cost?.usd,
      startedAt: (u as { startedAt?: number }).startedAt,
      sessionId: await $.session.id().catch(() => undefined),
      loadout: loadout(u.context.breakdown),
    }
  } catch { return null }
}
/** Live numbers only, while a turn runs: the strip's ring climbs as the chat grows, without starting Node. */
export async function refreshLive($: Dollar): Promise<void> { const l = await liveNow($); if (l) await putLive($, l) }
/** Writes the live numbers only when they changed (a write redraws the strip and panel). */
async function putLive($: Dollar, l: LiveView | null): Promise<void> {
  const lj = JSON.stringify(l)
  if (lj === lastJson.l) return
  lastJson.l = lj
  await update($, live, () => l)
  // plan use is only reported after a reply: keep the last known numbers across chats instead of an empty card
  if (l?.limits.length) void $.store.set(STORE_LIMITS, { at: Date.now(), limits: l.limits }).catch(() => undefined)
  const fiveNow = l?.limits.find(x => x.kind === 'five_hour')?.percentUsed
  if (fiveNow !== undefined) { const ph = await read($, planHist); if (ph[ph.length - 1]?.p !== fiveNow) await update($, planHist, x => [...x, { t: Date.now(), p: fiveNow }].slice(-20)) }
  const p = l?.context.percent
  if (p !== undefined) { const h = await read($, history); if (h[h.length - 1] !== p) await update($, history, x => [...x, p].slice(-40)) }
}

/** A refresh you asked for: the same as after a turn, plus a note saying when, so the press visibly did something. */
export async function refreshNow($: Dollar): Promise<void> {
  await refresh($)
  const d = new Date()
  await update($, note, () => `Refreshed at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`)
}

export async function act($: Dollar, label: string, args: string[]): Promise<void> {
  await update($, note, () => `${label}…`)
  const r = await kc($, args)
  await refresh($)
  await update($, note, () => (r.ok ? `${label}: done` : `${label}: ${(r.out.split('\n')[0] ?? '').slice(0, 120)}`))
}

export const ago = (m: number | null) => (m === null ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`)
export const minsSince = (iso?: string | null) => (iso ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null)
// transparent: Claude Code's own light or dark canvas shows through, so the panel looks native in both modes
export function openPane($: Dollar) { return $.ui.open({ id: PANE, title: 'Kapex Cortex', backgroundColor: 'transparent' }) }

// Every state read and write goes through these (the validator wants atoms used in the file that declares them).
export async function snapshot($: Dollar) {
  return { s: await read($, status), l: await read($, live), cv: await read($, cache), msg: await read($, note), chosen: await read($, tab), hist: await read($, history), ph: await read($, planHist), vw: await read($, view) }
}
export async function readStatus($: Dollar) { return read($, status) }
export async function readCache($: Dollar) { return read($, cache) }
export async function readOff($: Dollar) { return { o: await read($, off), dir: await read($, project) } }
export async function chooseProject($: Dollar, dir: string): Promise<void> { await update($, project, () => dir); await refresh($) }
export async function setTab($: Dollar, t: Tab): Promise<void> { await update($, tab, () => t) }
export async function stampCache($: Dollar, u?: { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }): Promise<void> {
  await update($, cache, c => ({ ...c, lastAt: Date.now(), ...(u ? { read: u.cache_read_input_tokens, write: u.cache_creation_input_tokens, input: u.input_tokens } : {}) }))
}

type Breakdown = { mcpTools?: readonly { name: string; serverName?: string; tokens: number; isLoaded: boolean }[]; skills?: { skillFrontmatter?: readonly { name: string; pluginName?: string; tokens: number }[] } }
/** What each MCP server and each plugin's skills cost here. Server keys match tool names (mcp__<server>__tool), as usage.ts counts them. */
function loadout(b: Breakdown | undefined): LiveView['loadout'] {
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

/** Changes the newest Dream proposes and you haven't looked at yet (it must still be "proposed"). */
export const toReview = (s: StatusView | null | undefined) => { const d = s?.dream?.recent?.[0]; return d && d.status === 'proposed' ? d.findings.filter(f => !f.skip && !f.done).length : 0 }

export async function readView($: Dollar): Promise<ViewState> { return read($, view) }
export async function toggleGroup($: Dollar, g: string): Promise<void> {
  await update($, view, v => ({ ...v, collapsed: v.collapsed.includes(g) ? v.collapsed.filter(x => x !== g) : [...v.collapsed, g] }))
}
export async function showMore($: Dollar, g: string, step = 10): Promise<void> {
  await update($, view, v => ({ ...v, more: { ...v.more, [g]: (v.more[g] ?? 0) + step } }))
}
export async function setEditing($: Dollar, id: string): Promise<void> { await update($, view, v => ({ ...v, editing: id })) }

/** Plan numbers last seen (any chat), for the cards and strip before this chat's first reply. */
export async function lastLimits($: Dollar): Promise<{ at: number; limits: LiveView['limits'] } | null> {
  try { return ((await $.store.get(STORE_LIMITS)) as { at: number; limits: LiveView['limits'] } | undefined) ?? null } catch { return null }
}
/**
 * The plan numbers to draw. Claude Code reports plan use only with a reply, so in a quiet chat (or from another chat's
 * saved copy) the numbers can be from before the window reset: a window whose reset time has passed starts again at 0%.
 */
export function freshLimits(limits: LiveView['limits'], now = Date.now()): LiveView['limits'] {
  return limits.map(x => (x.resetsAt && Date.parse(x.resetsAt) <= now ? { ...x, percentUsed: 0, rolled: true } : x))
}
/** This chat's plan numbers, else the last ones seen in any chat; either way aged past their reset time. */
export async function planLimits($: Dollar, l: LiveView | null): Promise<{ limits: LiveView['limits']; at: number | null }> {
  if (l?.limits.length) return { limits: freshLimits(l.limits), at: null }
  const saved = await lastLimits($)
  return { limits: freshLimits(saved?.limits ?? []), at: saved?.at ?? null }
}
/** The status the strip and panel draw: this chat's, else the last good one saved (instant after a restart). */
export async function statusOrSaved($: Dollar): Promise<StatusView | null> {
  const s = await read($, status)
  if (s) return s
  try {
    const saved = ((await $.store.get(STORE_STATUS)) as StatusView | undefined) ?? null
    const dir = (await read($, project)) || sessionCwd
    return saved && (!dir || dir === saved.root || dir.startsWith(`${saved.root}/`) || saved.root.startsWith(`${dir}/`)) ? saved : null
  } catch { return null }
}
export async function readFail($: Dollar): Promise<string> { return read($, fail) }
/** A refresh started by drawing (no timers): at most one every 20 seconds, only while nothing has loaded. */
export function refreshSoon($: Dollar): void {
  if (Date.now() - lastTry < 20_000) return
  lastTry = Date.now()
  void refresh($).catch(() => undefined)
}
/** One tile open at a time (an accordion): opening one closes the other, so the list stays calm and short. */
export async function toggleExpanded($: Dollar, id: string): Promise<void> {
  await update($, view, v => ({ ...v, expanded: v.expanded.includes(id) ? [] : [id] }))
}
export async function setSub($: Dollar, sub: string): Promise<void> { await update($, view, v => ({ ...v, sub })) }
/** First-run intro: the step to show, or -1 once finished or skipped. */
export async function setIntro($: Dollar, step: number): Promise<void> { await update($, view, v => ({ ...v, intro: step })) }

/** The handoff flow's step (Overview banner) and "Later". */
export async function setFlow($: Dollar, flow: '' | 'confirm' | 'copied'): Promise<void> { await update($, view, v => ({ ...v, flow })) }
export async function snoozeSwitch($: Dollar, pct: number): Promise<void> {
  await update($, view, v => ({ ...v, flow: '', snooze: { until: Date.now() + 30 * 60_000, pct } }))
}
/** What you paste in the new chat: typed by you, so a slash command is fine (the panel itself can't send one). */
export const RESUME_COMMAND = '/cortex-resume'
/** Hand off: save the handoff with a snapshot of the working tree, then put /cortex-resume on the clipboard. */
export async function handOff($: Dollar): Promise<void> {
  await update($, note, () => 'Saving the handoff…')
  const r = await kc($, ['handoff'])
  let copied = false
  try { copied = !!(await $.ui.copy({ text: RESUME_COMMAND })).isCopied } catch { /* no clipboard on this surface */ }
  await refresh($)
  await update($, view, v => ({ ...v, flow: 'copied' }))
  await update($, note, () => (r.ok ? (copied ? 'Handoff saved · /cortex-resume copied' : 'Handoff saved') : `Handoff: ${(r.out.split('\n')[0] ?? '').slice(0, 120)}`))
}
export async function copyResume($: Dollar): Promise<void> {
  let copied = false
  try { copied = !!(await $.ui.copy({ text: RESUME_COMMAND })).isCopied } catch { /* no clipboard */ }
  await update($, note, () => (copied ? '/cortex-resume copied' : 'Couldn\'t copy here: type /cortex-resume in the new chat'))
}

/** Auto-park: MCP servers that load into every message here but went unused in your recent chats (at least 10 of
 * them), from the next chat on. Never the Claude app's own servers, never one you turned back on, once per server per
 * app session. Undo is one press on the Costs page or in Settings. */
const tried = new Set<string>()
async function autoPark($: Dollar, s: StatusView, l: LiveView): Promise<void> {
  if (s.prefs?.autoPark === false || !s.usage || s.usage.chats < 10 || !s.parked) return
  const pick = unusedTools(s, l, 500).filter(x => x.kind === 'mcp' && x.server && !s.parked!.disabled.includes(x.server) && !s.parked!.keepOn.includes(x.server) && !tried.has(x.server))
  if (!pick.length) return
  for (const x of pick) tried.add(x.server!)
  const r = await kc($, ['park', 'add', ...pick.map(x => x.server!), '--auto', ...pick.flatMap(x => ['--tokens', `${x.server}=${x.loaded}`])])
  await update($, note, () => (r.ok ? `Turned off unused: ${pick.map(x => x.name).join(', ')} (new chats). Undo in Costs` : 'Couldn\'t turn off unused servers'))
  await refresh($)
}
export async function setParked($: Dollar, servers: string[], on: boolean): Promise<void> { await act($, on ? 'Turned off for new chats' : 'Turned on for new chats', ['park', on ? 'add' : 'remove', ...servers]) }
