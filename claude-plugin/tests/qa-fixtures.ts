// QA fixtures for the Kapex Cortex panel: status shapes from "only the required fields" to "far more than the CLI
// would ever send", and the engine mock every test shares. Not a test file (no *.test.* name): qa*.test.tsx import it.
// Times are relative to now, so no test here goes stale with the calendar.

export const HOUR = 3_600_000
export const DAY = 24 * HOUR
export const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()
export const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const WIDTHS = [40, 60, 84, 120, 200, 260] as const
export const SURFACES = ['desktop', 'terminal'] as const
export const pane = (bodyColumns: number, bodyRows = 40) => ({ plugin: 'kapex-cortex', component: 'Pane', requestId: 'kapex-cortex', props: { title: 'Kapex Cortex', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} } }) as const
export const BAND = { plugin: 'kapex-cortex', component: 'AbovePrompt', props: {} } as const

// ── text that breaks naive formatting ────────────────────────────────────────────────────────────────────────────
const SENTENCE = 'Refactor the `parser` so **tokens** never leak across [chats](https://example.com/a?b=c&d=e) and # headings > quotes stay intact; '
export const LONG = SENTENCE.repeat(Math.ceil(2000 / SENTENCE.length)).slice(0, 2000)
export const UNBROKEN = 'x'.repeat(2000)
export const UNICODE = '🚀🔥 修复解析器的错误并更新文档 — مرحبا بالعالم هذا اختبار — שלום עולם 👨‍👩‍👧‍👦 `code` **bold** _it_ <b>tag</b> & "quotes" \'single\' \\ back\\slash'
export const MARKDOWN = '# Heading\n\n- item one\n- item `two`\n\n```ts\nconst x = `template ${1}`\n```\n> quote **bold** __under__ *it* [link](http://x.y) | table | cell |'
/** 135 characters of words, then an ellipsis exactly where a 140-character preview is cut. */
export const ELLIPSIS_AT_CUT = `${'word '.repeat(27)}… and then some more text follows here so the preview is cut right after the mark`
export const DOTS_AT_CUT = `${'word '.repeat(27)}... and then some more text follows here so the preview is cut right after the dots`
export const TEXTS = [LONG, UNICODE, MARKDOWN, UNBROKEN, ELLIPSIS_AT_CUT, DOTS_AT_CUT, 'Short one', '', '   ', '/cortex-resume', '@"some file.png" (pasted text)', 'Wait...', 'Trailing comma,', '<system-reminder>background task finished</system-reminder>']
const text = (i: number) => TEXTS[i % TEXTS.length]!

// ── the smallest status the types allow ──────────────────────────────────────────────────────────────────────────
export function minimal(): any {
  return {
    project: 'demo', root: '/demo',
    handoff: { exists: false, ageMinutes: null, ready: false, from: '' },
    native: { files: [], alwaysTokens: 0, alwaysLines: 0, autoMemory: { dir: '', enabled: false } },
    dream: { running: null, recent: [] },
    git: null,
    hooks: { p95: null, samples: 0, cap: 150 },
    opencode: { installed: false, plugin: false },
    stateAt: null, health: 'good',
  }
}
/** Every optional field present, and empty or zero. */
export function empty(): any {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, replies: 0 }
  return {
    ...minimal(), name: '', episodes: [], timeline: [],
    handoff: { exists: true, ageMinutes: 0, ready: false, from: '', session: '', chat: '', preview: { exchanges: 0, files: 0, openItems: 0, tokens: 0, lastCheck: '' } },
    git: { branch: '', dirty: 0, untracked: 0, wip: null },
    hooks: { p95: 0, samples: 0, cap: 150, recent: [] },
    footprint: { tokens: 0, skills: 0, duplicates: 0 },
    safety: { findings: [], command: '', undo: false },
    history: { states: [], wips: [] },
    prefs: { tokenMode: 'balanced', dreamBackend: 'claude', dreamModel: '', dreamApi: '', dreamUrl: '', dreamTranscripts: 0, autoDream: false, overridden: [], tokens: { handoff: 0 } },
    usage: { chats: 0, skills: {}, mcp: {}, tools: {} },
    spend: { today: zero, week: zero, all: zero, since: null, chats: 0, resumed: 0, resumedContext: 0, sessions: {}, days: {}, hours: Array.from({ length: 7 }, () => Array(24).fill(0)) },
    parked: { servers: [], keepOn: [], disabled: [] },
    memHealth: { files: [], scopedTokens: 0, alwaysTokens: 0, open: 0, checks: 0, clean: 0 },
    stateAt: iso(0),
  }
}

// ── a realistic, healthy project (the base the variants below change one thing in) ───────────────────────────────
const KINDS = ['false', 'stale', 'contradiction', 'duplicate', 'visible', 'scope', 'replace', 'over-cap', 'broken-link', 'orphan', 'lesson', 'never-heard-of-it']
const OPS = ['delete', 'replace', 'move', 'add-index', 'add-lesson', 'none'] as const
export function finding(i: number, over: object = {}): any {
  const op = OPS[i % OPS.length]!
  return {
    id: `C${i}`, kind: KINDS[i % KINDS.length], severity: (['high', 'medium', 'low'] as const)[i % 3], by: i % 2 ? 'model' : 'check',
    file: i % 2 ? '/demo/CLAUDE.md' : '/mem/MEMORY.md', label: i % 2 ? 'CLAUDE.md' : 'memory/MEMORY.md', line: i % 5 === 4 ? 0 : i + 1, end: i + 1,
    entry: i % 7 === 6 ? '' : `- ${text(i) || 'A note.'}`, why: text(i + 3) || 'It no longer matches the project.', evidence: i % 3 === 0 ? ['E1', 'E-missing'] : [],
    action: { op, ...(op === 'replace' || op === 'add-index' || op === 'add-lesson' ? { text: text(i + 1) } : {}), ...(op === 'move' ? { to: '.claude/rules/api.md', paths: i % 2 ? ['src/api/**'] : undefined } : {}) },
    ...(i % 11 === 10 ? { skip: true } : {}), ...over,
  }
}
export function dream(i: number, n: number, status = 'proposed', over: object = {}): any {
  return {
    id: `01JD${String(i).padStart(22, '0')}`, ts: iso(i * DAY + HOUR), status, ms: 900 + i, model: i % 2 ? null : 'claude · sonnet', transcripts: 10, evidenceCount: 63, entryCount: 40,
    findings: Array.from({ length: n }, (_, j) => finding(j, status === 'applied' ? { done: 'applied', was: 'old line' } : {})),
    evidence: [{ id: 'E1', kind: 'run', ts: iso(i * DAY + 2 * HOUR), session: 's1', text: '`npm test` succeeded', cmd: 'npm test', ok: true }, { id: 'E2', kind: 'commit', ts: iso(i * DAY + 3 * HOUR), session: 's1', text: 'fix: parser' }],
    files: [{ path: '/mem/MEMORY.md', label: 'memory/MEMORY.md', hash: 'a' }, { path: '/demo/CLAUDE.md', label: 'CLAUDE.md', hash: null }],
    ...(status === 'applied' ? { applied: { at: iso(i * DAY) } } : {}), ...over,
  }
}
export function episode(i: number, msAgo: number, over: object = {}): any {
  return {
    id: `E${i}`, session: `s${i % 7}`, start: iso(msAgo + 90_000), end: iso(msAgo), ask: i % 9 === 8 ? '' : `Request ${i}: ${text(i)}`,
    tools: { Edit: i % 4, Read: i % 15, Bash: i % 6, mcp__figma__get: i % 2 }, files: Array.from({ length: i % 12 }, (_, j) => (j % 3 ? `/demo/src/deep/folder/file-${i}-${j}.ts` : `C:\\work\\demo\\src\\win-${j}.ts`)),
    commands: ['npm test', 'cd "/demo" && FOO=1 npm run check | tail -5'], tests: { ran: i % 5, failed: i % 5 === 4 ? 2 : 0, ...(i % 10 === 4 ? { lastOk: true } : i % 10 === 9 ? { lastOk: false } : {}) },
    commits: i % 3, errors: i % 8 === 7 ? 3 : 0, interrupted: i % 13 === 12, skills: [], mcp: [], outTokens: 1200 * (i % 40), contextTokens: 9000 + i * 500,
    done: i % 6 === 5 ? '' : `Did thing ${i}. ${text(i + 2)}`, next: i % 4 === 3 ? text(i + 4) : '', ...over,
  }
}
const EV_KINDS = ['turn', 'turn', 'turn', 'commit', 'turn', 'merge', 'handoff', 'dream', 'turn', 'commit']
const TONES = ['ok', 'warn', 'bad', 'info'] as const
export function event(i: number, msAgo: number, over: object = {}): any {
  const kind = EV_KINDS[i % EV_KINDS.length]!
  const tags = [['1 file'], ['tests 3/3', '2 files', '1 commit'], ['tag v3.9.0', 'pushed', 'main', 'abc1234', 'signed', 'extra'], [], [UNICODE, LONG.slice(0, 300)]][i % 5]!
  return { id: kind === 'turn' ? `turn-E${i}` : `${kind}-${i}`, ts: iso(msAgo), kind, title: `${kind} ${i}: ${text(i)}`, ...(i % 3 ? { detail: text(i + 5) } : {}), tags, tone: TONES[i % 4], ...over }
}
/** `n` plain events, newest first, `gapMin` minutes apart, each title `titleLen` characters (what the CLI sends: ≤ 400). */
export function events(n: number, gapMin = 20, titleLen = 60): any[] {
  const words = 'Fix the parser and add "quoted" <tags> & more words to the request so it reads like a real one. '
  return Array.from({ length: n }, (_, i) => event(i, (i + 1) * gapMin * 60_000, { title: `${i}: ${words.repeat(Math.ceil(titleLen / words.length))}`.slice(0, titleLen), detail: i % 2 ? 'Did it.' : undefined, tags: ['1 file'] }))
}
export function memFile(i: number, over: object = {}): any {
  const scope = (['user', 'parent', 'project', 'rules', 'auto'] as const)[i % 5]
  const loads = (['always', 'on-demand', 'first-200'] as const)[i % 3]
  return { path: `/demo/.claude/rules/${'nested/'.repeat(i % 4)}file-${i}.md`, label: i % 6 === 5 ? `rules/${UNICODE.slice(0, 40)}-${i}.md` : `rules/file-${i}.md`, scope, loads, ...(loads === 'on-demand' ? { paths: i % 2 ? ['src/**', 'test/**/*.ts'] : [] } : {}), lines: 10 + i * 13, bytes: 500 * i, tokens: 120 * i, editable: i % 4 !== 3, ...(i % 6 === 2 ? { over: `${10 + i * 13} lines: only the first 200 load` } : {}), ...over }
}
export function spendDays(n: number, value = (i: number) => 50_000 + (i * 7919) % 900_000): Record<string, number> {
  const out: Record<string, number> = {}
  for (let i = 0; i < n; i++) out[localDay(Date.now() - i * DAY)] = value(i)
  return out
}
const tokens = (m: number) => ({ input: 1200 * m, output: 900 * m, cacheRead: 90_000 * m, cacheWrite: 4000 * m, replies: 3 * m })
export function healthy(): any {
  return {
    ...minimal(), name: 'Asha',
    episodes: Array.from({ length: 8 }, (_, i) => episode(i, (i + 1) * 20 * 60_000)),
    timeline: Array.from({ length: 12 }, (_, i) => event(i, (i + 1) * 20 * 60_000)),
    handoff: { exists: true, ageMinutes: 5, ready: true, from: 'claude-code', session: 'old-chat', chat: 'Cortex resume design', preview: { exchanges: 3, files: 2, openItems: 1, tokens: 1800, lastCheck: 'npm run check passed, 5 min ago', goal: 'Ship v4.0', next: 'Run the benchmark', instructions: 2, decisions: 1, trail: 6, commits: 2, flagged: 0 } },
    native: { files: Array.from({ length: 4 }, (_, i) => memFile(i)), alwaysTokens: 875, alwaysLines: 70, autoMemory: { dir: '/mem', enabled: true } },
    dream: { running: null, recent: [dream(0, 4), dream(1, 3, 'applied'), dream(2, 0, 'discarded'), dream(3, 2, 'failed', { error: 'model timed out' })] },
    git: { branch: 'main', dirty: 2, untracked: 1, wip: { ref: 'refs/cortex/wip/s1', sha: 'abc1234def', at: iso(HOUR) } },
    hooks: { p95: 92, samples: 40, cap: 150, recent: [40, 55, 61, 48, 92, 70] },
    opencode: { installed: true, plugin: true },
    footprint: { tokens: 280, skills: 4, duplicates: 2 },
    safety: { findings: [{ id: 'secrets', level: 'warn', title: 'Secrets are readable', detail: '.env is not protected', fix: 'secrets' }, { id: 'sandbox', level: 'info', title: 'Sandbox off', detail: 'Bash runs unsandboxed' }, { id: 'gate', level: 'ok', title: 'Check before finishing', detail: 'npm run check', fix: 'gate' }], command: 'npm run check', undo: true },
    history: { states: [{ session: 's1', at: iso(HOUR), from: 'claude-code', goal: 'Ship the parser refactor', chat: 'Parser refactor', copies: 2 }, { session: 's2', at: iso(DAY), from: 'opencode', goal: '' }, { session: 's3', at: iso(3 * DAY), from: '', goal: LONG }], wips: [{ session: 's1', sha: 'abc1234', at: iso(HOUR) }] },
    prefs: { tokenMode: 'balanced', greeting: true, name: 'Asha', dreamBackend: 'claude', dreamModel: 'sonnet', dreamApi: 'anthropic', dreamUrl: '', dreamTranscripts: 10, autoDream: false, quickCheck: true, handoffAt: 80, autoPark: true, sound: true, introDone: true, overridden: ['tokenMode'], tokens: { handoff: 1800 } },
    usage: { chats: 20, skills: { 'kapex-cortex:cortex-resume': 2 }, mcp: { cortex: 5 }, tools: { Bash: 90, Read: 200, Edit: 60, Grep: 30, Task: 4, WebFetch: 2, mcp__figma__get: 9, Skill: 3 } },
    spend: { today: tokens(1), week: tokens(9), all: tokens(40), since: localDay(Date.now() - 30 * DAY), chats: 22, resumed: 3, resumedContext: 410_000, sessions: { s1: 120_000, s2: 80_000 }, days: spendDays(30), hours: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h > 8 && h < 20 ? (d * 3 + h) % 9 : 0))) },
    parked: { servers: [{ name: 'figma', at: iso(DAY), auto: true, tokens: 9000 }, { name: 'vercel', at: iso(2 * DAY), auto: false, tokens: 0 }], keepOn: ['linear'], disabled: ['figma', 'vercel'] },
    memHealth: { files: [{ label: 'CLAUDE.md', lines: 40, limit: 200 }, { label: 'memory/MEMORY.md', lines: 170, limit: 200 }], scopedTokens: 150, alwaysTokens: 875, open: 2, checks: 4, clean: 3 },
    stateAt: iso(5 * 60_000), health: 'attention',
  }
}
/** A healthy project where nothing notifies by itself: no Dream waiting, no unused server to turn off. */
export const quiet = (): any => ({ ...healthy(), dream: { running: null, recent: [] }, parked: { servers: [], keepOn: ['figma', 'linear', 'Drive'], disabled: [] } })

/** Far more than the CLI sends (it caps the timeline at 160 events and a turn's words at 400 characters): 600 events,
 * 300 turns, 40 memory files, 2,000-character titles, emoji / right-to-left / CJK text, backticks and markdown
 * everywhere. Every number and time is valid. */
export function huge(): any {
  const h = healthy()
  return {
    ...h, name: UNICODE.slice(0, 60), project: `demo-${UNICODE.slice(0, 30)}`,
    episodes: Array.from({ length: 300 }, (_, i) => episode(i, (i + 1) * 45 * 60_000)),
    timeline: Array.from({ length: 600 }, (_, i) => event(i, (i + 1) * 22 * 60_000)), // ~9 days back
    handoff: { ...h.handoff, chat: LONG, preview: { ...h.handoff.preview, goal: LONG, next: UNICODE, lastCheck: `${LONG.slice(0, 400)} FAILED`, tokens: 48_000, exchanges: 12, files: 240, openItems: 99, instructions: 40, decisions: 30, trail: 300, commits: 80, flagged: 7 } },
    native: { files: Array.from({ length: 40 }, (_, i) => memFile(i)), alwaysTokens: 1_250_000, alwaysLines: 90_000, autoMemory: { dir: '/mem', enabled: true } },
    dream: { running: { since: iso(3 * 60_000) }, recent: [dream(0, 60, 'proposed', { rejected: Array.from({ length: 30 }, (_, i) => text(i) || 'no reason'), modelError: LONG, kept: 12, dropped: 4 }), ...Array.from({ length: 12 }, (_, i) => dream(i + 1, 9, i % 2 ? 'applied' : 'undone', i % 2 ? {} : { undone: iso(i * DAY) }))] },
    git: { branch: `feature/${UNBROKEN.slice(0, 180)}`, dirty: 4200, untracked: 9100, wip: h.git.wip },
    history: { states: Array.from({ length: 60 }, (_, i) => ({ session: `s${i}`, at: iso(i * 5 * HOUR), from: ['claude-code', 'opencode', 'hermes', 'zed', ''][i % 5], goal: text(i), ...(i % 2 ? { chat: text(i + 1) } : {}), ...(i % 5 === 0 ? { copies: i } : {}) })), wips: Array.from({ length: 60 }, (_, i) => ({ session: `s${i * 2}`, sha: `${'abcdef0123456789'.repeat(3)}`.slice(i % 8), at: iso(i * 5 * HOUR) })) },
    usage: { chats: 4000, skills: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`plugin-${i % 9}:skill-${i}`, i])), mcp: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`server-${i}`, i * 3])), tools: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [i % 3 ? `mcp__server-${i}__tool` : ['Bash', 'Read', 'Edit', 'Grep', 'Task', 'WebFetch'][i % 6]! + (i > 6 ? i : ''), 1 + i * 11])) },
    spend: { today: tokens(400), week: tokens(9000), all: tokens(4_000_000), since: localDay(Date.now() - 400 * DAY), chats: 9000, resumed: 800, resumedContext: 98_000_000_000, sessions: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`s${i}`, i * 1000])), days: spendDays(400), hours: Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => d * 1000 + h * 37)) },
    parked: { servers: Array.from({ length: 30 }, (_, i) => ({ name: i % 4 ? `server-${i}` : `${'0a1b2c3d'}-${'1234'}-server-${i}-${UNBROKEN.slice(0, 60)}`, at: iso(i * DAY), auto: i % 2 === 0, tokens: i * 1500 })), keepOn: Array.from({ length: 10 }, (_, i) => `keep-${i}`), disabled: Array.from({ length: 30 }, (_, i) => `server-${i}`) },
    memHealth: { files: Array.from({ length: 40 }, (_, i) => ({ label: `rules/file-${i}.md`, lines: i * 37, limit: 200 })), scopedTokens: 80_000, alwaysTokens: 1_250_000, open: 60, checks: 900, clean: 840 },
    safety: { ...h.safety, findings: h.safety.findings.map((f: any) => ({ ...f, title: `${f.title} ${UNICODE}`, detail: LONG })), command: LONG.slice(0, 500) },
  }
}
/** The huge status with the Timeline held to what its chart can draw (see the "timeline chart" test), so the other pages get their turn. */
export const hugeFewEvents = (): any => ({ ...huge(), timeline: events(160, 60, 90) })

/** Values no healthy journal holds, but a corrupted line, a clock change or a git commit dated in the future can: zero
 * and negative numbers, times in the future, times that don't parse. */
export function hostile(): any {
  const h = healthy()
  const badTs = ['not-a-date', '', iso(-3 * DAY), '2026-13-45T99:99:99Z', iso(-10 * 365 * DAY), '0000-00-00T00:00:00Z', iso(40 * 365 * DAY)]
  const ts = (i: number) => badTs[i % badTs.length]!
  return {
    ...h,
    episodes: Array.from({ length: 30 }, (_, i) => episode(i, 0, { start: ts(i + 1), end: ts(i), outTokens: i % 2 ? -5000 : 0, contextTokens: -1, commits: -1, errors: -2, tests: { ran: i % 3 ? -1 : 0, failed: 5 } })),
    timeline: Array.from({ length: 60 }, (_, i) => event(i, 0, { ts: ts(i) })),
    handoff: { ...h.handoff, ageMinutes: -30, preview: { ...h.handoff.preview, exchanges: -1, files: -2, openItems: -3, tokens: -1800, instructions: -1, decisions: 0, trail: -4, commits: -1, flagged: -1 } },
    native: { files: Array.from({ length: 6 }, (_, i) => memFile(i, { lines: i % 2 ? -10 : 0, bytes: -1, tokens: i % 2 ? -100 : 0 })), alwaysTokens: -875, alwaysLines: -1, autoMemory: { dir: '', enabled: true } },
    dream: { running: { since: 'not-a-date' }, recent: [dream(0, 5, 'proposed', { ts: 'not-a-date', ms: -1, entryCount: -3, evidence: [{ id: 'E1', kind: 'run', ts: 'x', session: '', text: '', ok: false }] }), dream(1, 2, 'applied', { ts: iso(-2 * DAY), applied: { at: 'never' } }), dream(2, 1, 'undone', { ts: '', undone: 'garbage' })] },
    git: { branch: '', dirty: -1, untracked: -1, wip: { ref: '', sha: '', at: 'not-a-date' } },
    hooks: { p95: -20, samples: -1, cap: 0, recent: [-5, 0, 100000] },
    footprint: { tokens: -250, skills: -1, duplicates: -2 },
    history: { states: [{ session: '', at: 'not-a-date', from: '', goal: '' }, { session: 's-future', at: iso(-5 * DAY), from: 'claude-code', goal: 'From the future' }], wips: [{ session: '', sha: '', at: '' }] },
    usage: { chats: -1, skills: { a: -1 }, mcp: { b: -2 }, tools: { Bash: -90, Read: 0, Edit: 12 } },
    spend: { today: tokens(-1), week: tokens(0), all: tokens(-40), since: 'not-a-date', chats: -1, resumed: -3, resumedContext: -410_000, sessions: { s1: -1 }, days: { 'not-a-day': 5000, '2026-13-45': 7000, [localDay(Date.now() + 5 * DAY)]: 9000, [localDay(Date.now() - DAY)]: -400, [localDay(Date.now())]: 0 }, hours: [[-5, 0, 3], [], [1, 2]] },
    parked: { servers: [{ name: '', at: 'not-a-date', auto: true, tokens: -1 }], keepOn: [], disabled: [] },
    memHealth: { files: [{ label: 'CLAUDE.md', lines: 40, limit: 0 }, { label: 'b.md', lines: -5, limit: 200 }, { label: 'c.md', lines: 0, limit: 0 }], scopedTokens: -1, alwaysTokens: -875, open: -1, checks: 0, clean: 0 },
    stateAt: 'not-a-date',
  }
}

// ── Claude Code's own numbers ($.session.usage) ──────────────────────────────────────────────────────────────────
const CATS = [{ name: 'System prompt', tokens: 20_000, isDeferred: false }, { name: 'System tools', tokens: 14_000, isDeferred: false }, { name: 'MCP tools', tokens: 30_000, isDeferred: false }, { name: 'Skills', tokens: 6_400, isDeferred: false }, { name: 'Memory files', tokens: 3_000, isDeferred: false }, { name: 'Messages', tokens: 64_000, isDeferred: false }, { name: 'Free space', tokens: 30_000, isDeferred: false }, { name: 'Autocompact buffer', tokens: 33_000, isDeferred: false }]
const MCP_TOOLS = [{ name: 'mcp__figma__get_design', serverName: 'figma', tokens: 9000, isLoaded: true }, { name: 'mcp__linear__list', serverName: 'linear', tokens: 7000, isLoaded: true }, { name: 'mcp__0a1b2c3d-1234-5678-9abc-def012345678__search', serverName: 'Drive', tokens: 6000, isLoaded: true }, { name: 'mcp__vercel__deploy', tokens: 8000, isLoaded: false }]
const SKILLS = { skillFrontmatter: [{ name: 'vercel:deploy', pluginName: 'vercel', tokens: 3000 }, { name: 'my-skill', tokens: 800 }, { name: 'kapex-cortex:kc', pluginName: 'kapex-cortex', tokens: 250 }] }
export const USAGE = {
  /** a normal chat, 42% full */
  normal: () => ({ startedAt: Date.now() - HOUR, version: 'x', context: { tokens: 84_000, window: 200_000, percent: 42, breakdown: { categories: CATS, maxTokens: 200_000, mcpTools: MCP_TOOLS, skills: SKILLS } }, rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: iso(-2 * HOUR) }, { kind: 'seven_day', percentUsed: 41, resetsAt: iso(-3 * DAY) }], cost: { usd: 3.4567 } }),
  /** 86% full on a 1M window: the hand-off question shows */
  full: () => ({ startedAt: Date.now() - 6 * HOUR, version: 'x', context: { tokens: 860_000, window: 1_000_000, percent: 86, breakdown: { categories: CATS, maxTokens: 1_000_000, mcpTools: MCP_TOOLS, skills: SKILLS } }, rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: iso(-20 * 60_000) }, { kind: 'seven_day', percentUsed: 78, resetsAt: iso(-DAY) }] }),
  /** plan windows whose reset time has passed */
  pastReset: () => ({ startedAt: 0, version: 'x', context: { tokens: 120_000, window: 1_000_000, percent: 12, breakdown: { categories: [], maxTokens: 1_000_000 } }, rateLimits: [{ kind: 'five_hour', percentUsed: 95, resetsAt: iso(HOUR) }, { kind: 'seven_day', percentUsed: 60, resetsAt: iso(2 * DAY) }] }),
  /** numbers Claude Code shouldn't send, but nothing stops it */
  weird: () => ({ startedAt: 0, version: 'x', context: { tokens: undefined, window: 0, percent: undefined }, rateLimits: [{ kind: 'five_hour', percentUsed: 150, resetsAt: 'not-a-date' }, { kind: 'seven_day', percentUsed: -4 }, { kind: 'opus_week', percentUsed: 12 }] }),
  /** no rate limits at all (an API key, not a plan), no breakdown */
  bare: () => ({ startedAt: 0, version: 'x', context: { tokens: 0, window: 200_000, percent: 0 }, rateLimits: [] }),
}

// ── the engine beneath the plugin ────────────────────────────────────────────────────────────────────────────────
export type Eng = {
  status: () => unknown; usage?: (() => unknown) | null; calls?: string[]; prompts?: string[]; turns?: number; session?: string; exit?: number; home?: string
  /** answers process.run instead of the status (returns the engine's `{ value }`, or throws) */ run?: (args: string) => unknown
  /** every toast and sound the plugin asked for; `noToast` / `noAudio`: a surface without them (the call throws) */
  toasts?: string[]; sounds?: string[]; noToast?: boolean; noAudio?: boolean
}
/** Everything the plugin asks the engine for, answered from memory. `usage: null` = no $.session.usage here (it throws). */
export function engine(on: any, o: Eng): void {
  on('settings.read', () => ({ value: {} }))
  on('env.get', (_: unknown, e: any) => ({ value: e?.name === 'HOME' ? (o.home ?? '/home/test') : undefined }))
  on('command.register', () => ({ value: { command: 'kc' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__kapex-cortex__open_panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  if (!o.noToast) on('ui.toast', (_: unknown, e: any) => { o.toasts?.push(String(e?.text ?? e?.message ?? JSON.stringify(e))); return { value: undefined } })
  if (!o.noAudio) on('audio.play', (_: unknown, e: any) => { o.sounds?.push(String(e?.clip?.asset ?? e?.asset ?? JSON.stringify(e))); return { value: undefined } })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('turn.start', () => ({ turnId: 't1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', (_: unknown, e: any) => { o.prompts?.push(String(e?.text ?? '')); return { text: String(e?.text ?? '') } })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.turns', () => ({ value: o.turns ?? 7 }))
  on('session.id', () => ({ value: o.session ?? 's1' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 1, isLink: false } }))
  on('fs.exists', () => ({ value: true }))
  on('process.run', (_: unknown, e: any) => {
    const args = (e?.argv ?? []).slice(2).join(' ')
    o.calls?.push(args)
    if (o.run) return o.run(args)
    return { value: { exitCode: o.exit ?? 0, stdout: JSON.stringify(o.status()), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  if (o.usage !== null) on('session.usage', () => ({ value: (o.usage ?? USAGE.normal)() }))
}

// ── reading a drawing ────────────────────────────────────────────────────────────────────────────────────────────
export type Seen = { texts: string[]; svgs: { alt: string; source: string; key?: string }[]; nodes: number; depth: number; chars: number; keys: string[]; /** keys two siblings share (React keeps one and may reuse the wrong one) */ twins: string[] }
/** Every word a person (or a screen reader) is given, and every drawing's source, from the tree as drawn. */
export function see(tree: unknown): Seen {
  const out: Seen = { texts: [], svgs: [], nodes: 0, depth: 0, chars: 0, keys: [], twins: [] }
  const walk = (n: any, d: number): void => {
    if (n === null || n === undefined || typeof n === 'boolean') return
    if (typeof n === 'string' || typeof n === 'number') { out.texts.push(String(n)); return }
    if (Array.isArray(n)) { for (const c of n) walk(c, d); return }
    if (typeof n !== 'object') return
    out.nodes++; out.depth = Math.max(out.depth, d)
    const p = n.props ?? {}
    if (p.key !== undefined) out.keys.push(String(p.key))
    if (n.type === 'Svg') out.svgs.push({ alt: String(p.alt), source: String(p.source), key: p.key })
    for (const name of ['label', 'placeholder', 'value', 'title', 'submitLabel', 'href']) if (typeof p[name] === 'string') out.texts.push(p[name])
    if (Array.isArray(p.options)) for (const op of p.options) out.texts.push(String(op?.label))
    const kids = (Array.isArray(n.children) ? n.children : [n.children]).flat(3).filter((c: any) => c && typeof c === 'object' && c.props?.key !== undefined).map((c: any) => String(c.props.key))
    for (const k of new Set(kids.filter((k: string, i: number) => kids.indexOf(k) !== i))) out.twins.push(k as string)
    walk(n.children, d + 1)
  }
  walk(tree, 1)
  try { out.chars = JSON.stringify(tree).length } catch { out.chars = -1 }
  return out
}
/** What must never reach the screen. */
export const BAD_TEXT: [string, RegExp][] = [
  ['undefined', /undefined/], ['NaN', /NaN/], ['null', /\bnull\b/], ['[object', /\[object/], ['Infinity', /Infinity/], ['Invalid Date', /Invalid Date/],
  ['double ellipsis', /…\s*…|\.{3,}\s*…|…\s*\.{2,}|\.{4,}/],
]
/** In a drawing's source the same words mean a broken shape (width="NaN", translate(undefined)). User text inside
 * <title>/<text> is escaped by the plugin and none of the fixtures contain these words. */
export const BAD_SVG: [string, RegExp][] = [['undefined', /undefined/], ['NaN', /NaN/], ['null', /\bnull\b/], ['[object', /\[object/], ['Infinity', /Infinity/], ['Invalid Date', /Invalid Date/], ['negative size', /(?:width|height|r|rx)="-\d/]]
export const SVG_MAX = 131_072 // the engine's limit for one Svg source
/** Problems in one drawing, each as "what: where". */
export function problems(tree: unknown): string[] {
  const s = see(tree)
  const out: string[] = []
  const cut = (t: string) => (t.length > 110 ? `${t.slice(0, 50)} ⟪…⟫ ${t.slice(-50)}` : t)
  for (const t of s.texts) for (const [name, re] of BAD_TEXT) { const m = re.exec(t); if (m) out.push(`text has ${name}: "${cut(t.slice(Math.max(0, m.index - 60), m.index + 50))}"`) }
  for (const k of new Set(s.twins)) out.push(`siblings share the key "${cut(k)}"`)
  for (const g of s.svgs) {
    for (const [name, re] of BAD_TEXT) { const m = re.exec(g.alt); if (m) out.push(`svg alt has ${name}: "${cut(g.alt.slice(Math.max(0, m.index - 60), m.index + 50))}"`) }
    for (const [name, re] of BAD_SVG) { const m = re.exec(g.source); if (m) out.push(`svg source has ${name} (alt "${cut(g.alt).slice(0, 60)}"): …${g.source.slice(Math.max(0, m.index - 70), m.index + 30)}…`) }
    if (g.source.length > SVG_MAX) out.push(`svg source is ${g.source.length} characters, over the engine's ${SVG_MAX} (alt "${cut(g.alt).slice(0, 60)}")`)
    if (!g.alt || g.alt === 'undefined') out.push(`svg without alt text (key ${g.key})`)
  }
  return out
}
