import type { StatusView } from '../types'
import type { Dollar } from './data'

// Per-chat helpers that read no panel state (data.ts holds the atoms).

/** Cache lifetime: the person's setting, else env, else inferred from the plan (subscription → 1 h). */
export async function cacheTtl($: Dollar, hasPlanLimits: boolean): Promise<{ ttl: '5m' | '1h'; source: string }> {
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
 * strip's heartbeat to know, with four stats and no Node, that a full refresh would show something new. In a linked
 * worktree the vault is the main checkout's and git's log is in the worktree's own git folder. */
export async function vaultStamp($: Dollar, root: string, vaultRoot = root, gitDir = `${root}/.git`): Promise<string> {
  const at = (f: string) => $.fs.stat(f).then(x => String(x.mtimeMs), () => '-')
  return (await Promise.all([`${vaultRoot}/.vault/STATE.md`, `${vaultRoot}/.vault/private/episodes.jsonl`, `${vaultRoot}/.vault/dreams`, `${gitDir}/logs/HEAD`].map(at))).join(':')
}
export const ago = (m: number | null) => (m === null ? 'never' : m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`)
export const minsSince = (iso?: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000)) : null) // unreadable: "never", not NaN
/** Changes the newest Dream proposes and you haven't looked at yet (it must still be "proposed"). */
export const toReview = (s: StatusView | null | undefined) => { const d = s?.dream?.recent?.[0]; return d && d.status === 'proposed' ? d.findings.filter(f => !f.skip && !f.done).length : 0 }
