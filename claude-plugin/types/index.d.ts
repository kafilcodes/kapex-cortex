/** One of Claude Code's own memory files, as Cortex measured it. */
export type NativeFileView = { path: string; label: string; scope: 'user' | 'parent' | 'project' | 'rules' | 'auto'; loads: 'always' | 'on-demand' | 'first-200'; paths?: string[]; lines: number; bytes: number; tokens: number; editable: boolean; over?: string }
export type FindingView = {
  id: string; kind: string; severity: 'high' | 'medium' | 'low'; by: 'check' | 'model'
  file: string; label: string; line: number; end: number; entry: string; why: string; evidence: string[]
  action: { op: 'delete' | 'replace' | 'move' | 'add-index' | 'add-lesson' | 'none'; text?: string; to?: string; paths?: string[] }
  skip?: boolean
  done?: 'applied' | 'kept'
  was?: string
}
export type EvidenceView = { id: string; kind: 'run' | 'you' | 'note' | 'commit'; ts: string; session: string; text: string; cmd?: string; ok?: boolean }
export type DreamView = {
  id: string; ts: string; status: 'proposed' | 'applied' | 'discarded' | 'undone' | 'failed' | 'replaced'; ms: number
  model: string | null; modelError?: string; dropped?: number; rejected?: string[]; transcripts: number; evidenceCount: number; entryCount: number
  findings: FindingView[]; evidence: EvidenceView[]; files: { path: string; label: string; hash: string | null }[]
  applied?: { at: string }; undone?: string; error?: string; kept?: number
}
export type StatusView = {
  project: string
  root: string
  name?: string
  episodes?: EpisodeView[]
  timeline?: TimelineEventView[]
  handoff: { exists: boolean; ageMinutes: number | null; ready: boolean; from: string; session?: string; chat?: string; preview?: { exchanges: number; files: number; openItems: number; tokens: number; lastCheck: string; goal?: string; next?: string; instructions?: number; decisions?: number; trail?: number; commits?: number; flagged?: number } }
  native: { files: NativeFileView[]; alwaysTokens: number; alwaysLines: number; autoMemory: { dir: string; enabled: boolean } }
  dream: { running: { since: string } | null; recent: DreamView[] }
  git: { branch: string; dirty: number; untracked: number; wip: { ref: string; sha: string; at: string } | null } | null
  hooks: { p95: number | null; samples: number; cap: number; recent?: number[] }
  opencode: { installed: boolean; plugin: boolean }
  /** what Cortex adds to every message: its skill names and descriptions (duplicates: old copies in ~/.claude/skills) */
  footprint?: { tokens: number; skills: number; duplicates: number }
  /** the safety check for autonomous runs: secrets, sandbox, a check before Claude finishes */
  safety?: { findings: { id: 'secrets' | 'sandbox' | 'gate'; level: 'ok' | 'info' | 'warn'; title: string; detail: string; fix?: 'secrets' | 'gate' }[]; command: string; undo: boolean }
  history?: HistoryView
  prefs?: PrefsView
  usage?: { chats: number; skills: Record<string, number>; mcp: Record<string, number>; tools: Record<string, number> }
  spend?: { today: TokensView; week: TokensView; all: TokensView; since: string | null; chats: number; resumed: number; resumedContext: number; sessions?: Record<string, number> }
  parked?: { servers: { name: string; at: string; auto: boolean; tokens: number }[]; keepOn: string[]; disabled: string[] }
  memHealth?: { files: { label: string; lines: number; limit: number }[]; scopedTokens: number; alwaysTokens: number; open: number; checks: number; clean: number }
  migrated?: string
  stateAt: string | null
  health: 'good' | 'attention'
}
/** Handoff snapshots: one STATE per session, and git WIP refs. */
export type HistoryView = {
  states: { session: string; at: string; from: string; goal: string }[]
  wips: { session: string; sha: string; at: string }[]
}
/** Settings in force here, and what the handoff costs. */
export type TokensView = { input: number; output: number; cacheRead: number; cacheWrite: number; replies: number }
export type PrefsView = { tokenMode: string; greeting?: boolean; name?: string; dreamBackend: string; dreamModel: string; dreamApi: string; dreamUrl: string; dreamTranscripts: number; autoDream: boolean; quickCheck?: boolean; handoffAt?: number; autoPark?: boolean; overridden: string[]; tokens: { handoff: number } }
/** `kc status --json` in a folder without Cortex: which child folders have it. */
export type OffView = { cwd: string; nearby: string[]; error?: string }
/** What Claude Code itself reports (no estimates). */
export type LiveView = {
  model: string
  turns: number
  context: { tokens?: number; window: number; percent?: number; rows: { name: string; tokens: number }[] }
  limits: { kind: string; percentUsed: number; resetsAt?: string; rolled?: boolean }[]
  costUsd?: number
  /** MCP servers and skill sets loaded in this chat, by what they cost (from Claude Code's own /context numbers) */
  loadout?: { kind: 'mcp' | 'skills'; name: string; tokens: number; loaded: number; items: number; names?: string[]; server?: string }[]
  startedAt?: number
  sessionId?: string
}
/** The panel's pages; Dream & Memory has its own sub-pages (ViewState.sub). Old values still load (mapped to a page). */
export type Tab = 'overview' | 'timeline' | 'data' | 'settings' | 'waiting' | 'rules' | 'failed' | 'handoff' | 'compactions' | 'details'
export type TimelineEventView = { id: string; ts: string; kind: string; title: string; detail?: string; tags: string[]; tone: 'ok' | 'warn' | 'bad' | 'info' }
/** The Memory and Timeline tabs' list state. */
export type ViewState = { collapsed: string[]; more: Record<string, number>; editing: string; expanded: string[]; sub: string; flow?: '' | 'confirm' | 'copied'; snooze?: { until: number; pct: number }; /** first-run intro: the step shown, -1 once finished or skipped */ intro?: number }
/** One turn of the session journal. */
export type EpisodeView = {
  id: string; session: string; start: string; end: string; ask: string
  tools: Record<string, number>; files: string[]; commands: string[]; tests: { ran: number; failed: number; lastOk?: boolean }
  commits: number; errors: number; interrupted: boolean; skills: string[]; mcp: string[]
  outTokens: number; contextTokens: number; done: string; next: string
  rating?: { stars?: number; thumb?: 'up' | 'down'; note?: string }
  feedback?: { sentiment?: number; note?: string }
}
/** The last main-thread reply: when it finished and how its input split between cache and fresh tokens. */
export type CacheView = { lastAt: number | null; read: number; write: number; input: number; ttl: '5m' | '1h'; ttlSource: string }

declare module 'claude-code' {
  interface PluginState {
    'kapex-cortex': {
      status: Shaped<StatusView | null>
      live: Shaped<LiveView | null>
      note: Shaped<string>
      tab: Shaped<Tab | ''>
      cache: Shaped<CacheView>
      history: Shaped<number[]>
      planHist: Shaped<{ t: number; p: number }[]>
      project: Shaped<string>
      off: Shaped<OffView | null>
      warned: Shaped<string[]>
      view: Shaped<ViewState>
      fail: Shaped<string>
      pulse: Shaped<string>
    }
  }
}
