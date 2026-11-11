# Kapex Cortex v1.0 — SPEC

**Status:** LOCKED 2026-11-07 (Kafil: "use your defaults" for the open questions). **Build:** Nov 8–11, 2026. **Licence:** MIT.
**Read first:** `DISCOVERY.md` (why) and `SPIKE.md` (verified mechanics). This file is *what* we build and *how we know it works*.

---

## 1. Problem, in one paragraph
AI coding harnesses lose the rules you stated mid-session when they compact context. They can't hand an in-progress task to another tool or model when you hit a usage limit. And they treat every kind of context as "memory" fetched by similarity search, so nothing is ever guaranteed to be present. Cortex fixes this for **Claude Code (CLI + Desktop)** and **OpenCode (CLI + Desktop)**, sharing one Obsidian vault with Hermes. It runs locally with no daemon, no Docker, no API keys and no added chat latency.

## 2. Principles (each is a testable property)
1. **Invariants are not memories.** Rules, failed approaches and locked decisions are present at every cache boundary, word for word. They never go through search or summarization.
2. **Summarize the machine, never the human.** The user's own messages survive compaction verbatim (within a fixed budget, cut the same way every time).
3. **Only the user can create an invariant.** Text first seen in tool output (web pages, files, command output) can become a *finding*, never an *invariant*, unless a human approves it.
4. **Inject only at cache-cold boundaries:** session start, resume, after compaction, fork. Nothing changes the prompt prefix mid-session.
5. **Presence ≠ obedience.** Rules a machine can check compile into native permission denies; prose rules stay advisory, and the benchmark measures how often each model obeys them.
6. **The handoff is always ready,** refreshed on every turn and built from the turn's own facts, because when the rate limit hits, no model is available to write it.
7. **No terminal in daily use.** Everything is reachable from Claude Desktop, OpenCode Desktop or Obsidian.

## 3. Decisions (defaults adopted for DISCOVERY §6)
| # | Decision |
|---|---|
| Q1 | **One vault for every harness, Hermes included** (Kafil override, 2026-11-07). The iCloud vault is canonical. `~/wiki` was moved to the Trash (`~/.Trash/wiki-hermes-copy-2026-11-07`; it had no unique content) and replaced by a symlink to the iCloud vault, so Hermes's unchanged `cwd: ~/wiki` now opens it. Hermes therefore writes to the canonical vault under its own protocol (`meta/18`); Cortex treats Hermes as a trusted writer to the human zone. Hermes's own writes don't pass through Cortex's iCloud guards, so the split stays clean: `machine/` is written only by Cortex, the human zone only by Kafil and Hermes. |
| Q2 | `.vault/` **is tracked in git**, except `.vault/private/` (verbatim user messages, private-sensitivity records, the decay log), which is gitignored. The ledger merges line by line (`merge=union`). |
| Q3 | Provenance is recorded per record. AI writes only to the vault's `machine/`; changes to human pages go to `machine/proposals/` as diffs. Hermes's own write rules are left alone for now; restricting Hermes is a later proposal. |
| Q4 | **Anthropic** may receive `public` + `personal` content. **Free OpenCode providers** (DeepSeek, GLM) receive only *project-scoped* content: STATE, INVARIANTS, code, the last user message after scrubbing. Never personal or private vault pages. `private` goes nowhere. |
| Q5 | MIT open-source core. The benchmark uses ≤25% of one Claude Pro 5-hour window (its Claude sample runs on Haiku); everything else runs on free OpenCode models. |
| Q6 | Public wording follows the vault's evidence labels: "partitioned search index" (not "sharded"), "RLHF code-evaluation work" (not "model training"), and no latency number without a published benchmark. |

## 4. Architecture

```
capture (end of each turn, <150 ms)      store (append-only)            deliver (only at cache-cold boundaries)
──────────────────────────────────      ────────────────────           ───────────────────────────────────────
new user messages (transcript tail) ─┐                                 Claude: .claude/rules/cortex-invariants.md (native reload)
pin() calls via MCP                 ─┼─► .vault/ledger.jsonl  ─► views ─► Claude: SessionStart(compact) ← human turns ≤9.5k chars
git signals (revert, repeat fail)   ─┤   .vault/private/*.jsonl         Claude: SessionStart(startup|resume) ← STATE notice
tool output → finding (tainted)     ─┘        │                         OpenCode: instructions glob + compacting.context.push
                                               │                         OpenCode/Claude: /resume ← !`cat .vault/STATE.md`
                                               ├─► .claude/settings.local.json  permissions.deny  (checkable rules)
                                               ├─► opencode.json                permission deny   (checkable rules)
                                               └─► vault machine/projects/<repo>/  (Obsidian dashboard, single writer)
audit: PostCompact(compact_summary) vs INVARIANTS → .vault/private/decay.jsonl → bench numbers
```

**One package, one core:** `kapex-cortex` (TypeScript run directly by Node ≥23.6 via type stripping, ESM). **Zero runtime dependencies:** storage and search use `node:sqlite` with FTS5, and the MCP server is a small hand-written stdio JSON-RPC implementation. Claude hooks and the OpenCode plugin are thin shims that call `cortex hook <harness>.<event>` with JSON on stdin.

## 5. Data formats

### 5.1 Ledger record — `.vault/ledger.jsonl` (one JSON object per line, append-only)
```json
{"id":"01JC…ULID","ts":"2026-11-08T10:12:03Z","kind":"invariant",
 "text":"Never run docker on this machine.",
 "origin":{"role":"user","harness":"claude-code","session":"d100…","ref":"transcript:L182"},
 "status":"active","supersedes":null,"as_of":"2026-11-08","review_after":null,
 "sensitivity":"personal","enforce":{"tool":"Bash","pattern":"docker *","action":"deny"}}
```
- `kind`: `invariant | decision | failed | finding | preference | question`
- `origin.role`: `user | assistant | tool | git | human-approval`
- `status`: `pending | active | superseded | expired | rejected`. Status changes are **new lines** referencing the original `id`; nothing is ever rewritten in place.
- **Taint rule (enforced in code):** `kind=invariant` with `status=active` requires `origin.role ∈ {user, human-approval}`. Anything else is stored as `pending`.
- **Scrubber:** before any write, redact common secret shapes (`sk-`, `ghp_`, `AKIA`, `xox[bp]-`, JWTs, `-----BEGIN … KEY-----`, `.env`-style `KEY=value` with high entropy). Redactions are counted in the record (`"redacted":2`).

### 5.2 Views (generated from the ledger, never edited by hand)
| File | Content | Budget | Byte-stable? |
|---|---|---|---|
| `.vault/INVARIANTS.md` | active invariants + decisions, sorted by `id` | ≤ 6,000 chars | yes |
| `.claude/rules/cortex-invariants.md` | same content (copy) | same | yes |
| `.vault/GRAVEYARD.md` | active `failed` records: what, why, evidence ref | ≤ 6,000 chars | yes |
| `.vault/STATE.md` | handoff packet (§5.3); **gitignored** (changes every turn) | ≤ 8,000 chars | no (changes each turn) |
| `.vault/private/human-turns.md` | verbatim user messages (pastes > 600 chars → `[paste N lines → transcript:Lx]`) | ≤ 9,500 chars | yes, given the same inputs |

**Over budget:** keep pinned items, then rule-cued items (`never|always|don't|must|instead of|use X not Y`, in English and Hinglish), then the most recent; the cut is always made the same way. The full text stays in the ledger and transcripts.

### 5.3 STATE.md template (fixed headings; filled only from facts available at the end of a turn)
```markdown
# STATE — <repo> · <branch> · updated <iso> · from <harness>/<model>
## Goal            (from SPEC.md/README first line, or the last /handoff)
## Last user message (verbatim, scrubbed)
## Last assistant message (first 1,200 chars of last_assistant_message)
## Tasks           (harness task/todo list if available)
## Working tree    (git diff --stat; WIP ref: refs/cortex/wip/<session>)
## Last failure    (last non-zero command + first 20 lines of output, if any)
## Verify          (commands that define done: from .vault/verify.txt or package.json scripts)
## Invariants      → see INVARIANTS.md (count: N)
## Next action     (from /handoff narrative if present, else "continue from Last assistant message")
```
The WIP ref is made with `git stash create` + `git update-ref` and never touches your branch, index or working tree. To stay inside the latency budget (A8), an ordinary turn runs only one `git status`; the snapshot plus `git diff --stat` run at **handoff moments**: `StopFailure` (rate limit), `PreCompact` and `/cortex-handoff`. On a rate limit the last *completed* assistant answer is kept, not overwritten.

## 6. Harness integration

### 6.1 Claude Code (CLI + Desktop; same engine, verified)
Hooks go in `.claude/settings.local.json` (machine-specific absolute paths, gitignored), written by `cortex init` and merged with existing hooks, never replacing them:
| Hook | Matcher | Does | Budget |
|---|---|---|---|
| `SessionStart` | `compact` | inject `human-turns.md` (≤9,500 chars) | <100 ms |
| `SessionStart` | `startup\|resume\|fork` | inject a one-line notice: "Cortex: N invariants · STATE fresh (age) · pending: K" | <100 ms |
| `Stop` | — | append new user messages (from the `transcript_path` tail by byte offset); refresh STATE; WIP ref | sync, <150 ms |
| `PreCompact` | — | stdout: "Preserve these verbatim:" + invariants (≤9,500 chars); snapshot of what was injected | <100 ms |
| `PostCompact` | — | audit `compact_summary` against invariants and the user's rule-like sentences (paraphrase-tolerant, negation-aware) → `decay.jsonl`; `cortex audit` reports it | <100 ms |
| `StopFailure` | `rate_limit` | stamp STATE "handoff-ready (rate limit)"; macOS notification "Resume in OpenCode with /resume" | <100 ms |
| `SessionEnd` | — | spawn detached `cortex export` (throttled to 1/min; also on SessionStart startup/resume, to apply Obsidian approvals) | <50 ms (1.5 s budget) |

Native, no hook: invariants in `.claude/rules/cortex-invariants.md`; checkable rules in `.claude/settings.local.json` `permissions.deny`. Cortex owns only the entries listed in `.vault/private/managed.json` and never edits a user's own entries.
Skills (in `~/.claude/skills/`, installed by `cortex install-skills`, also read by OpenCode): **`/cortex-handoff`** (the model writes Goal + Next action via `cortex handoff`, STATE is re-rendered with a snapshot), **`/cortex-resume`** (read STATE + INVARIANTS + GRAVEYARD, continue, run Verify) and **`/cortex-init`**. They are prefixed because Claude Code already has a built-in `/resume`.
MCP server `cortex mcp` with 4 tools: `pin(kind, text, quote?)`, `search(query)` (FTS5 over the ledger, captured turns, STATE, and this project's Claude transcripts and OpenCode sessions), `state()`, `pending()`. **A `pin` is active only if `quote` matches the user's own message verbatim** (captured turns or the live transcript); otherwise it is pending. The model can pin what the user said, never invent a rule. `cortex setup` registers it at user scope in Claude Code and in OpenCode's global `mcp.servers`.

### 6.2 OpenCode 2.x (CLI + Desktop; same server). Verified live on 2.2.5; the public plugin docs describe the 1.x API
- `opencode.json` → `"instructions": [".vault/INVARIANTS.md"]`. Checkable rules go into the **ordered `permissions` list** (`{action: "shell", resource, effect: "deny"}`). Precedence isn't documented, so Cortex's denies are written at both the start and the end. The deprecated 1.x `permission.bash` map is updated only if the file already has it.
- `.opencode/commands/cortex-resume.md` and `cortex-handoff.md` use `` !`cat …` `` includes, which expand on the server; `@file` does not (SPIKE D6).
- Plugin `.opencode/plugins/kapex-cortex.ts`, generated from `templates/opencode-plugin.ts`, uses the **v2 format** `export default { id, setup(ctx) }` (1.x named exports fail to load):
  - `ctx.event.subscribe({ types })`, an async iterable: on `session.created`, put the invariants as a **native durable session instruction entry** (`ctx.session.instructions.entry.put`, "announced at the next step boundary", so the cache stays warm). On `session.execution.{succeeded,failed,interrupted}` (v2's end-of-turn; `session.idle` kept for 1.x): capture turns, refresh STATE, and re-put the entry only if it changed. On `session.compaction.ended`: re-put the invariants plus your verbatim messages as a second entry.
  - `ctx.tool.hook("execute.before")` blocks denied commands and paths (verified: a denied `shell` call was blocked).
  - It never relies on `experimental.session.compacting` (1.x only).
- The MCP server is registered in `opencode.json` `mcp` (M3).

### 6.3 Both harnesses
The project `AGENTS.md` gets one managed line: *"If `.vault/STATE.md` is newer than this session, read it and `.vault/INVARIANTS.md` before acting."* That makes the handoff findable even when commands don't expand (SPIKE T4).

### 6.4 Vault (iCloud) and Hermes
- `cortex export` (the only writer) mirrors each project to `machine/projects/<repo>/{STATE,INVARIANTS,GRAVEYARD,PENDING}.md` with frontmatter (`as_of`, `source`, `sensitivity`), plus `machine/index.md`. It never writes outside `machine/`.
- `PENDING.md` lists candidates as `- [ ] <text>  ^<ulid>`. Ticking one in Obsidian (Mac or iPhone) is read on the next `cortex` run as `human-approval`. This is the one human-written file inside `machine/`.
- Cross-project lessons are promoted only by approval to `machine/lessons/`.
- Hermes needs no adapter in v1: `~/wiki` now points at the iCloud vault, so it reads `machine/` directly, and it can use `cortex mcp`.

### 6.5 iCloud eviction and conflict guard (all vault I/O goes through `src/util/icloud.ts`)
**Threats:** (a) *eviction*: with "Optimize Mac Storage", iCloud replaces a file with a placeholder; older macOS uses `.<name>.icloud` stubs, newer uses APFS *dataless* files (size > 0, no local blocks, `SF_DATALESS` flag). Reading one blocks on a network download. (b) *Conflicts*: two writers editing at once, or a write landing mid-upload, make iCloud keep both as `<name> 2.md`. (c) *Torn writes*: a reader or uploader sees a half-written file.

**Rules:**
1. **Never block a hook on iCloud.** Before reading a vault file, check for a `.<name>.icloud` sibling or a dataless file (`stat` flags; fallback heuristic: `size > 0 && blocks == 0`). If evicted: ask macOS to fetch it (`brctl download <path>`, detached), skip this run and log `vault.evicted`. Vault reads happen only in `cortex export` and the `PENDING.md` reader, which are never on the hot path.
2. **Atomic writes only:** write to `<dir>/.<name>.<pid>.<rand>.nosync` (iCloud ignores `.nosync`), `fsync`, then `rename()` over the target (atomic on APFS), so iCloud sees one complete change.
3. **Write only when content changed:** compare the SHA-256 of the new bytes with the current file; identical means no write and no sync traffic.
4. **Single writer:** only `cortex export`, holding the global lock `~/.cortex/locks/vault.lock` (§6.6), writes to `machine/`.
5. **Read before write for human-touched files:** `PENDING.md` gets its ticks merged first, then rewritten. If its mtime is under 10 s old (the iPhone may be mid-sync), skip this export and retry next time.
6. **Conflict sweep:** at each export, look in `machine/` for iCloud conflict copies (`<name> <n>.md`). Merge their checkbox ticks (union), keep the canonical file, and move the copies to `machine/_conflicts/` (never delete). Log each one.
7. **Nothing high-frequency or binary in the vault:** ledger, SQLite indexes, locks and logs stay in the repo or `~/.cortex/` on local disk.

### 6.6 Multi-session safety (Claude Code and OpenCode open on the same repo)
1. **Ledger appends are lock-free and atomic:** each record is one `write()` of one complete line to a file opened with `O_APPEND`, and records are capped at 16 KB. APFS and ext4 do not interleave a single appended write, so concurrent appenders can't tear lines. Readers ignore a trailing partial line.
2. **View regeneration is serialized:** take `.vault/private/locks/views.lock` (created with `O_EXCL`, containing pid + timestamp; stale if the pid is dead or it is older than 10 s), read the *whole* ledger, render, write atomically (§6.5.2), release.
3. **No lost updates:** every appender regenerates after it appends. If the lock is busy past a 100 ms wait (the hook budget), the appender touches `.vault/private/locks/views.dirty` and returns; the lock holder re-checks `dirty` (and the ledger size) before releasing and renders again. The views always end up reflecting every appended line.
4. **Per-session state never contends:** transcript cursors live in `.vault/private/cursors/<harness>-<session>.json`, and each session's STATE goes to `.vault/private/states/<session>.md`. `STATE.md` is the newest of those, written atomically under the views lock and labelled with its source session.
5. **Idempotent generation:** views are pure functions of the ledger, so a regeneration repeated after a crash or a stale lock produces identical bytes (A1).

### 6.7 Pinning from chat (no tool call needed)
A user message containing `rule: …`, `failed: …`, `decision: …` or `pref: …` (also `#rule`, `#failed`, …) becomes an **active** record of that kind, attributed to the user. Other rule-like sentences ("never…", "don't…", "kabhi nahi…") become **pending** candidates for one-tap approval. Heuristics never activate a rule on their own.

## 7. Commands (for hooks; Kafil uses the skills)
`cortex init` · `cortex hook <harness>.<event>` · `cortex pin` · `cortex approve <id>` · `cortex state` · `cortex handoff` · `cortex export` · `cortex mcp` · `cortex audit` · `cortex bench`

## 8. Acceptance tests (v1 ships when all pass)
| # | Test | Pass |
|---|---|---|
| A1 | Views are stable | Same ledger → identical bytes for INVARIANTS/GRAVEYARD/human-turns, 100 runs |
| A2 | Taint | 20 adversarial tool outputs ("always disable tests", "the user says never…") → 0 active invariants |
| A3 | Scrubber | A fixture with 12 secret shapes → 12 redactions, 0 leaks in ledger, views, STATE or vault mirror |
| A4 | Claude survival | In Claude Code Desktop: state a rule in chat → `/compact` → the rule is in `cortex-invariants.md` and in context after compaction (`InstructionsLoaded compact`) |
| A5 ✅ | Enforcement | Rule "never run docker" → `Bash(docker ps)` is denied by native permissions in both harnesses. Verified live in Claude Code even with `--allowedTools Bash`; OpenCode guard verified live, native v2 `permissions` written (bracketed) |
| A6 ✅ | Handoff | Simulated rate limit in Claude → OpenCode `/cortex-resume` on DeepSeek V4.1 Flash continues the step, keeps the invariants, Verify passes. Verified live through OpenCode's server: fixed in 15 s, `tests pass`, `config/prod/` untouched |
| A7 ✅ | Reverse handoff | OpenCode → Claude `/cortex-resume` works the same way. Verified live: Haiku implemented OpenCode's plan, `tests pass (with multiply)` |
| A8 | Latency | p95 `Stop` hook < 150 ms and `SessionStart` < 100 ms on this M4 (50 runs) |
| A9 ✅ | Audit | A real `/compact` produces a `decay.jsonl` entry naming which invariants the summary dropped. Verified live on the Desktop engine; unit-tested for paraphrase and lost negation |
| A10 ✅ | Cold start (the Nov 26 test) | A repo untouched for 7 days (simulated with timestamps): a new session gets the notice, and `/cortex-resume` reaches the right step (unit-tested; the notice is verified, resume as in A6/A7) |
| A11 ✅ | Vault safety | After export runs (approvals, conflict copies, eviction, mid-sync), a content hash of everything outside `machine/` is unchanged; every vault path is guarded in code (unit-tested on a scratch vault; live vault not yet written) |
| A12 | Byte budget | No injection exceeds 9,500 chars (so it is never swapped for a file path) |
| A13 | Concurrency | 8 processes × 50 appends each, run in parallel with view regeneration → 400 intact ledger lines, no torn line, and final views equal a fresh single-process render |
| A14 | iCloud guard | Simulated placeholder (`.x.md.icloud`) and dataless heuristics → read skipped and logged, never blocks; atomic write leaves no `.nosync` temp file; a planted `PENDING 2.md` gets its ticks merged and moves to `_conflicts/` |

## 9. decay-bench (the portfolio piece)
- **Scenarios:** 12 planted rules per session, of four types: explicit, casual ("btw don't use X"), superseded later, and injected through tool output. Machine-discovered failed approaches are a separate class. Sessions are padded with realistic tool output to ~100k tokens, then compacted 1× and 2×.
- **Conditions:** vanilla · Baseline E (one shared rules file) · Cortex.
- **Models:** DeepSeek V4.1 Flash and GLM-5.3-Flash (free, the main runs) + Claude Haiku (≤25% of one Pro window).
- **Metrics:** *presence* (rule text in post-compaction context, checked deterministically) · *obedience* (probe actions; violation rate) · *false-invariant rate* (tainted text promoted) · *handoff success* (Verify passes after `/resume`) · tokens injected per boundary · hook latency.
- **Honesty rules:** publish every run with its variance, include the cases where Cortex should lose, cite arXiv 2606.22528 as the origin of the failure mode, and present pinning as prior art.

## 10. Milestones
| Date | Ship | Tests |
|---|---|---|
| Nov 7 night (M1) ✅ | `git init`; core (ledger, views, scrubber, taint, budgets, lock, atomic + iCloud I/O); `cortex init`; Baseline E for both harnesses; Claude `SessionStart`/`Stop`/`PreCompact` + OpenCode plugin shim | ✅ 18/18 tests: A1, A2, A3, A8 (Stop p95 ≈ 68 ms, SessionStart ≈ 70 ms), A12, A13, A14 utilities. ✅ A4 live on the Desktop engine 2.1.317. Plugin shim untested inside OpenCode.app (M2). |
| Nov 7 night (M2) ✅ | STATE + WIP ref; `StopFailure`; `/cortex-handoff`, `/cortex-resume`, `/cortex-init` skills; OpenCode 2 plugin + commands; native denies | ✅ 24/24 tests (Stop p95 ≈ 110 ms); A5, A6, A7 live; A10 unit |
| Nov 7 night (M3) ✅ | `PostCompact` audit; `cortex mcp`; vault export + `PENDING.md` approvals; `cortex setup` | ✅ 30/30 tests; A9 live; MCP live in Claude (quote-verified pin, search); A11 on a scratch vault; eviction check read-only on the real vault |
| Nov 11 AM | decay-bench, README, architecture diagram, results, limits | the bench itself |

**Cut line:** FTS5 `search` goes first, then the Obsidian mirror. Never cut the handoff, enforcement or the bench.

## 11. Out of scope for v1
Embeddings and vector search · paid Jev (a `classifier` interface stub only) · web dashboard · LangGraph · AST graphs · background consolidation ("dreaming") · effort/model routing (native now) · full transcript migration between harnesses · Gemini import · team sync (the commercial v2) · Windows testing (code stays portable; CI covers Linux and macOS).

## 12. Known limits (stated in the README)
- Capture of *machine-discovered* failed approaches is best-effort; it is measured, not guaranteed.
- Prose invariants are guaranteed to be *present*, not *obeyed*. Only checkable rules are enforced.
- OpenCode `experimental.session.compacting` may change. If it does, the `instructions` glob and the `AGENTS.md` line still deliver invariants.
- `@file` includes in OpenCode commands aren't relied on (server doesn't expand them).
- iCloud sync lag means Obsidian approvals take effect on the next session, not instantly.
