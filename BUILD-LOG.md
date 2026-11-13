# Build log

## 2026-11-07 night — Milestone 1 ✅
**Shipped:** core ledger (append-only JSONL, ULIDs monotonic per process, folded order-independently), taint guard, secret scrubber (13 patterns), deterministic budgets, views (INVARIANTS, GRAVEYARD, Claude rules file), verbatim human-turn store, Claude transcript and OpenCode DB capture with per-session cursors, view lock with the dirty-flag protocol, atomic + iCloud-safe I/O (eviction check, `.nosync` temp + rename, conflict-copy sweep), `cortex init` (idempotent, merges with the user's own config), Claude hooks (SessionStart / Stop / PreCompact), OpenCode plugin shim + `instructions` glob.

**Verified:**
- `npm run check`: tsc clean, **18/18 tests**.
- A8 latency (full process spawn, 50 runs): Stop p95 ≈ 68 ms, SessionStart(compact) p95 ≈ 70 ms (target < 150 ms).
- **A4 live**, on the Desktop's bundled engine 2.1.317 (Desktop launch flags, one long-lived process, Haiku): "rule: end every reply with KIWI" typed in chat → pinned by the Stop hook → after `/compact` the model listed it, obeyed it, and quoted the first message verbatim. Cortex's verbatim block was present in context after compaction. Caveat: in a 2-turn session the summary *also* kept both facts, so this proves the mechanism, not an advantage; the long-session bench (M4) measures that.

**Bugs found by tests and fixed:** same-millisecond ULIDs could sort before the record they supersede (now monotonic + a second-pass supersession); "rule:" only matched at line start (dictated text puts it mid-line).

**Not yet verified:** the OpenCode plugin shim inside OpenCode.app (event payload shape for `session.idle`, Bun runtime); `cortex init` on a real project; Windows.

**Environment notes:** `node` on PATH (`~/.local/bin/node`) is a symlink into Hermes's bundled Node 26.8.1; hooks record the PATH entry, so a Hermes upgrade keeps them working, but uninstalling Hermes would break them.

## 2026-11-07 night — Milestone 2 ✅
**Shipped:** STATE.md handoff packet (goal, next action, verify commands, invariant counts, working tree, last failed tool call, verbatim last user message, last assistant answer), WIP snapshot refs at handoff moments, `StopFailure` rate-limit stamp plus a macOS notification, `cortex handoff` and `cortex state`, the global skills `/cortex-resume`, `/cortex-handoff` and `/cortex-init`, OpenCode commands, enforcement compiler (rule → Claude `permissions.deny`, OpenCode v2 `permissions`, plugin guard), and the OpenCode **2.x** plugin.

**Verified:**
- `npm run check`: tsc clean, **24/24 tests**. Stop p95 ≈ 110 ms, SessionStart ≈ 75 ms.
- **A5 live (Claude):** with `--allowedTools Bash`, `docker --version` was denied by the compiled rule and `echo` ran.
- **OpenCode plugin live (2.2.5, via its server):** loads; `session.created` → invariants attached as a native instruction entry (row in `instruction_entry`); end-of-turn capture pinned a chat rule with `harness: opencode`; STATE written; the tool guard blocked a denied `shell` call the model didn't know was denied.
- **A6 live:** Claude (Haiku) planned the fix → simulated `StopFailure(rate_limit)` → OpenCode `/cortex-resume` on free DeepSeek V4.1 Flash fixed `math.js` in 15 s; `tests pass` (I ran it); `config/prod/` untouched.
- **A7 live:** OpenCode planned `multiply` → Claude `/cortex-resume` implemented it; `tests pass (with multiply)`.

**Wrong assumptions corrected by live runs (all fixed):**
1. OpenCode 2 rejects 1.x plugins: it needs `export default { id, setup }`. The public plugin docs are 1.x. I read the v2 contract from the 2.2.5 loader.
2. v2 ends a turn with `session.execution.succeeded`, not `session.idle`.
3. v2 permissions are an ordered `permissions` list with action `shell`; `permission.bash` is deprecated and wasn't applied.
4. A rate-limit payload without an assistant message overwrote the last good answer; it is now kept.
5. Pins swallowed the rest of a dictated line; they now end at the first sentence.
6. A planning turn's "don't edit yet" carried over into the resume; the resume instructions now say it applied to that turn only.

**Safety checks that blocked me (respected, not worked around):** launching OpenCode with blanket auto-approve (`--auto`), and an experiment granting "allow all shell". I used narrow scoped allows in scratch repos instead, and placed denies at both ends of the list rather than testing precedence.

**Not verified yet:** OpenCode `session.compaction.ended` handling in a real compaction; precedence of conflicting v2 `permissions` rules (mitigated by bracketing); the plugin inside the OpenCode.app window itself (it shares the server I tested through); a real, not simulated, Claude rate limit.

## 2026-11-07 night — Milestone 3 ✅
**Shipped:**
- **Decay audit:** after every compaction (Claude `PostCompact`, OpenCode `session.compaction.ended`), checks which invariants and which of your rule-like sentences the summary still carries. Paraphrase-tolerant (light stemming, ≥75% content words); a rule that loses its "never" counts as dropped. Writes `.vault/private/decay.jsonl`; `cortex audit` prints the report.
- **`cortex mcp`:** a dependency-free stdio MCP server with `pin`, `search`, `state`, `pending`. A pin is **active only if its quote matches your own message verbatim**: captured turns, or the live transcript, since capture runs at turn end.
- **`cortex export`:** the only writer to `<vault>/machine/`. Every path is checked to be inside `machine/`; it takes a global lock, writes atomically and only when content changed, applies `[x]`/`[-]` marks in `PENDING.md`, merges iCloud conflict copies into `_conflicts/`, and skips evicted or just-modified files. It runs in the background on SessionStart/SessionEnd, throttled to once a minute.
- **`cortex setup [--vault]`:** skills, MCP registration in Claude Code (user scope) and OpenCode (`~/.config/opencode/opencode.json` `mcp.servers`), and the vault path.

**Verified:**
- **30/30 tests**, run serially; parallel runs inflated the latency numbers. Stop p95 88 ms, SessionStart 75 ms.
- **A9 live** (Desktop engine 2.1.317, real `/compact`): entry written; `cortex audit` shows invariants 1/1 and your rules 3/3. A short session keeps everything; long sessions are the benchmark's job.
- **MCP live** (Claude Haiku via `--mcp-config`): "from now on every HTTP handler must return errors as JSON…" was pinned **active**, its quote verified against the live transcript before the turn ended; `search` found the earlier "never use an ORM" rule.
- Eviction detector, read-only on the real iCloud vault: 45/45 notes local, about 1 ms per file; `/usr/bin/brctl` present. The real vault has **not** been written (no `machine/` yet).

**Bugs found and fixed:** a `rule:` marker suppressed candidate detection for the other sentences in the same message; an MCP pin was duplicated as a pending candidate at turn end (now de-duplicated with the audit's matcher); the audit missed plurals ("replies" vs "reply").

**Not done:** `cortex setup` has not been run on this machine (it changes global config: MCP in every Claude/OpenCode session, plus the vault path); OpenCode compaction audit not seen live; Cortex not yet used on a real project.

## 2026-11-07 night — `cortex setup` run on this Mac
- `cortex setup --vault "<iCloud your Obsidian vault>"` → `~/.cortex/config.json` (vault path), MCP `kapex-cortex` registered at **user scope** in Claude Code (`claude mcp list`: ✔ Connected), and in OpenCode via a new `~/.config/opencode/opencode.json` (only `$schema` + `mcp.servers.kapex-cortex`; there was no global config before). The OpenCode server log shows `mcp connected server=kapex-cortex tools=4`. `opencode mcp list` still prints "No MCP servers configured" although `opencode debug config` shows the entry; it is probably reading a different field (unverified).
- Skills were already installed and unchanged.
- **The vault is still untouched:** `machine/` is created by the first `cortex export`, which runs only for projects that have run `cortex init`, and none has yet.
- New Claude/OpenCode sessions will list the 4 Cortex MCP tools. Sessions already open (including this one) don't load them until restarted.
- Undo: `claude mcp remove -s user kapex-cortex`; delete `mcp.servers.kapex-cortex` from `~/.config/opencode/opencode.json`; delete `~/.cortex/`.

## 2026-11-07 night — Dogfooding: Cortex on its own repo
- **Incident (fixed):** after `cortex setup` saved the real vault path, a test run's hook processes inherited it and exported 6 temp test repos into `<vault>/machine/projects/`. The path guard held (nothing outside `machine/` changed, checked by mtime scan), and the generated folder was moved to the Trash. Fix: tests run with an isolated `CORTEX_HOME` and no vault, and export refuses repos in temp directories unless `CORTEX_EXPORT_TMP=1`. There is a regression test; 31/31 pass.
- `cortex init` on `kapex-cortex`. Claude Code skips a repo's `AGENTS.md` when a parent folder has a `CLAUDE.md` (here `Claude Projects/CLAUDE.md`), so the STATE pointer now also lives in `.claude/rules/cortex-invariants.md`. Verified: this very session loaded the rules file the moment it was created.
- 9 rules from SPEC/BUILD-LOG proposed with `cortex pin --candidate` (7 invariants, 2 failed approaches). They stay **pending** until Kafil approves them in Obsidian.
- **First real iCloud export:** 5 files in `machine/`; a SHA-256 check of all 46 files outside `machine/` (excluding `.obsidian/`, `.DS_Store`) is identical before and after; no `.nosync` temp files left.
- Known quirk: an export within 10 s of the previous one treats Cortex's own fresh write of `PENDING.md` as "may still be syncing" and skips it. That's safe but over-cautious; to fix, remember the hash of the last write.
- Hooks are active only for **new** sessions opened in `kapex-cortex/`; this session predates them.

## 2026-11-07 late — Incident: one project's OpenCode plugin captured other projects' chats
- **What happened:** OpenCode runs **one shared server** for every project, and the plugin's event stream is server-wide. The plugin in `kapex-cortex/` (installed when we dogfooded) acted on the *benchmark's* sessions: it pinned "end every reply with KIWI" and the port facts into `kapex-cortex`'s ledger (3 records, 26 captured messages), may have sent Mac notifications for them, and attached Cortex instruction entries to the "vanilla" benchmark sessions. **The OpenCode benchmark rows were therefore contaminated** and set aside (`bench/results/invalid-opencode-runs.jsonl`). The Claude rows are unaffected, because Claude hooks are per project.
- **Fix, two independent guards:** (1) the plugin only acts on sessions whose directory (realpath) is its own, using `session.created`'s location or `ctx.session.get`; (2) `cortex hook opencode.*` checks the session's directory in OpenCode's own DB (`session_v2.directory`) and ignores foreign or unknown sessions. Regression test added (a foreign session's "rule:" is never pinned). Every plugin copy on disk (~200, mostly old test folders) was regenerated.
- **Cleanup:** the foreign records and turns were removed from `kapex-cortex/.vault` (backup kept in the session scratchpad), and the Obsidian page was re-exported. Your 9 approved rules are intact.
- **Lesson:** "per-project plugin" is not per-project on a shared server; isolation has to be checked per event.

## 2026-11-08 — v1.0 release prep
- Merged in-chat approval (inline-approval) into main; worktree removed. A live AskUserQuestion click in the Desktop app was parsed from its real answer text and synced to Obsidian (Waiting → Decided `[x]`).
- Bench: the opencode CLI truncates large piped output (~400 KB+), so output now goes to a file. Scenario v2: 9 rules/facts, 8080→9090→9091, two compactions, a docker probe (permission requests auto-rejected), and in-chat asking switched off in bench fixtures.
- Result: OpenCode 2's own compaction kept everything at this size, and plain ≈ Cortex. The earlier "presence gap" was a bench bug (the `summary` field wasn't read); README corrected.
- 38/38 tests, tsc clean.

## 2026-11-08 — v1.1.0
- Native panel inside Claude Code (a Claude Code mod in `claude-plugin/`): animated SVG health ring, 4 tiles, Approve/Reject buttons that call `kc` directly (no model, no tokens), actions (handoff, resume, sync, open in Obsidian), a strip above the prompt when something needs you, `/kc` status card. Validated with `claude plugin validate`; 2 panel tests pass on desktop and terminal.
- `kc` shortcuts (`kc i/s/p/a/aa/h/r/x/u/b/d`), launchers in `~/.local/bin`, `kc i` does machine setup on first run and finds the Obsidian vault from Obsidian's own list. Short skills `/kc-i /kc-r /kc-h /kc-a`; OpenCode `/kc` card.
- README rewritten (diagrams, comparison with Waku Agent from its README, honest results). LICENSE added. 42/42 tests.
- Not done: OpenCode's experimental GUI plugin slot (not documented), Client-module animation.

## 2026-11-08 — v1.2.0: telemetry panel
- The panel now uses **Claude Code's own numbers**: `$.session.usage()` (context tokens and %, the /context category breakdown, the compaction point from the autocompact buffer, 5-hour and 7-day plan windows with reset time, cost), `model()`, `turns()`. Nothing estimated.
- Charts (SVG, rounded, readable in light and dark): context window (stacked by category, compaction marker), plan usage, what Cortex re-adds after compaction (rules / failed approaches / your words, in characters against caps), memory donut, real hook p95 (hooks now record their own run time), compaction audit. Tabs: Waiting · Rules · Failed · Handoff, with 0-token buttons (Approve, Reject, Retire, Snapshot handoff now, Resume, Sync, Open in Obsidian).
- **Idle cost fixed:** no timer, no looping animation. It refreshes on turn end, button presses and panel open; state is written only when values change; charts animate once, only on a change. The terminal gets text bars.
- **Blank screen after closing the panel:** no error in the Desktop logs, but renderer memory grew from ~514 MB to ~766 MB while the old panel ran (an endless SVG animation plus a full redraw every 10 s, with a timer that outlived the panel). All three causes are removed. Not yet confirmed fixed by Kafil.
- Handoff tab: the auto-state from every turn and the git WIP snapshot (branch, changed and untracked counts, last snapshot) side by side; `kc h` works even before the first turn (manual snapshot).
- OpenCode: Desktop runs a package plugin's `./gui-experimental` bundle inside its windows. That's the route to a native OpenCode panel, but the contract is undocumented and it needs a package plugin, so it's left for later. OpenCode keeps the `/kc` card.
- 42/42 core tests; 2 panel tests (desktop + terminal); validator passes.

## 2026-11-08 — v1.3.0: responsive panel + Cache Clock
- **Layout:** labels are app text (follow the theme, wrap instead of colliding); SVG only draws slim bars and a small donut. Cards stack in a narrow pane and become 2 or 3 columns as the pane widens (from `bodyColumns`).
- **Hierarchy:** 4 key cards (Context with the compaction point, Rules, Handoff, Cache); deeper stats under a Details tab. Status dots and plain glyphs (◆ model, ⎇ branch, ◫ Obsidian) replace outlined badges. Hovering a card reveals a plain-English explanation (native hover reveal, no hook runs).
- **Cache Clock:** the last main-thread reply's time and real cache split come from `turn.complete` usage. Lifetime comes from your `promptCacheTtl` setting or env, else is inferred from the plan (5-hour limits → subscription → 1 h, labelled "assumed"). It shows an absolute "warm until 3:42 PM", so nothing ticks.
- **Blank screen after maximize → close:** the plugin API has no maximize state (panes are `dock`/`inline`), so the layout restore lives in the Desktop app. The panel now has its own "Close panel" button. Bug report drafted in `docs/desktop-pane-blank-bug.md`. Not fixable from a plugin.
- 42/42 core tests; 2 panel tests (desktop + terminal); validator passes.

## 2026-11-08 — v1.4.0: richer, adaptive panel
- New visuals: context-history sparkline with the compaction line, semicircle gauges for cache time left and plan usage (a new Plan card), top-rules preview in the Rules card.
- Adaptive: 1 → 2 → 3 → 4 columns by pane width; larger numbers, thicker bars and more padding on wide panes; subtle card background with hover highlight for contrast.
- Buttons: icons plus hotkeys (1–5 switch tabs, s snapshot, r refresh); primary/secondary/plain styling by importance.
- Fix: the Cache Clock now starts after any finished reply, even when the turn-end event carries no usage.
- 42/42 core tests, 2 panel tests; validator passes.

## 2026-11-08 — v1.5.0: scroll fix + forecasts
- Scroll overlap: scrolling re-runs the pane render; charts had no fixed size, so images could collapse and reflow into the tabs below. Every Svg now has an explicit width and height.
- New: compaction forecast (about N turns to go, from recent context growth), plan pace forecast (when the 5-hour limit would be hit at this pace), and the last reply token split (cache read / fresh / cache write).
- 42/42 core tests, 2 panel tests; register.tsx at 296 lines (split it next round).

## 2026-11-08 — v1.5.1
- /kc autocomplete: the short skills /kc-a /kc-h /kc-i /kc-r matched first and shadowed the panel command; removed (the panel buttons cover them).
- Close bug: confirmed it happens on any close, maximized or not, while minimize works. Plugins have no minimize call, so the Close panel button is gone and a tip says to minimize. Report updated in docs/desktop-pane-blank-bug.md.

## 2026-11-08 — v1.6.0: split panel + handoff history + compaction timeline
- register.tsx (296 lines) split into register.tsx (hook wiring, 50), data.ts (state + refresh), panel.tsx (header + cards) and tabs.tsx (tab bodies). The validator needs atoms read and written in the file that declares them, and helpers that take `$` to be `function` declarations, so all state access goes through small functions in data.ts.
- Handoff tab: recent STATE snapshots (goal, tool, age) and git WIP snapshot refs.
- New Compactions tab (hotkey 5): a timeline, newest first, with a slim bar per compaction (rules the summary kept vs lost, plus your own words), and "what Cortex re-added at the last compaction": the rules and instructions the summary dropped that Cortex put back.
- `kc status --json` gains `history` (src/core/history.ts), read from files already on disk (states/, refs/cortex/wip/, decay.jsonl). No timers; bars have fixed sizes.
- 43/43 core tests (new v16 test), 3 panel tests; validator passes; every file under 300 lines.

## 2026-11-08 — v1.7.0: /kc everywhere, open-panel button, quieter rule suggestions
- **/kc didn't work in any chat:** the panel was never installed, only hot-loaded from one old session's dev-mods folder. Now installed for the user (`claude plugin marketplace add <repo>` + `claude plugin install kapex-cortex@kapex-cortex`, read straight from `claude-plugin/`).
- **Chat opened one folder up** (e.g. "Claude Projects"): `kc status --json` now reports child folders with Cortex (`{off, cwd, nearby}`); the panel shows the only one automatically, or offers "Show <name>" buttons.
- **Opening the panel:** a quiet "◫ Open panel" button above the prompt (0 tokens); `/kc` prints nothing now (nothing reaches the model); the model can open it with the `open_panel` tool (behind ToolSearch, so only its name costs tokens).
- **Rule suggestions:** list lead-ins ending in ":" and task briefs from another AI session ("Background (from the session that started this one)") are no longer suggested. The approval prompt shows the full rule (was cut at 140 characters; storage was always complete).
- Known gap: Cortex hooks are per-project (`.claude/settings.local.json`), so a chat opened outside a Cortex folder captures nothing automatically.
- 44/44 core tests, 4 panel tests; validator passes; every file under 300 lines.

## 2026-11-08 — v1.8.0: smart rules, wide-panel fix, v2 design
- **Blank panel when widened:** the 3-column card width was `32.5%`; Claude Code only accepts whole-number percentages and refused the whole tree. Now 32%. A test draws the panel at 9 widths (40–400 columns) on desktop and terminal.
- **Smart rules** (`src/core/judge.ts`, deterministic, no dependency): trust by who wrote it (you / pasted / another AI's brief / harness output), certainty by wording score. Clear rules you type are added automatically; doubtful ones, pasted text and AI briefs are asked; questions, half sentences and harness output are dropped. A newer rule that contradicts an older one supersedes it (unclear overlap is asked). Records carry `source` and `note`.
- Bug found while building: the duplicate check treated a replacing rule ("use pnpm instead of npm") as already known. Fixed.
- "Stop hook feedback" messages are no longer stored as your words.
- Panel: Delete instead of Retire; each rule shows source, date, why, and "replaced an older rule"; full text instead of 140 characters; swappable SVG logo (`claude-plugin/hooks/logo.ts`).
- `docs/V2-DESIGN.md`: one-plugin install for every OS, layered context pack, profiles and token modes, what to borrow from TokenEconomizer and other token savers.
- 47/47 core tests, 5 panel tests; validator passes; every file under 300 lines.

## 2026-11-08 — v1.9.0: one plugin, every chat, every OS (V2 step 1)
- **The plugin is the whole install.** `claude-plugin/` now carries the hooks (`hooks/cortex-hooks.json`), the MCP server (`cortex`), the four skills and the panel, plus its own copy of the CLI in `claude-plugin/cortex/` (generated by `npm run bundle`; `npm run check` fails if it's stale, so a commit can't ship an old CLI).
- **No shell anywhere.** Hooks run in exec form (`node <plugin>/cortex/src/cli.ts hook …`), which Claude Code starts directly on macOS, Linux and Windows. The panel runs `node` the same way via `$.plugin.root`, trying PATH and the usual install folders, with a plain message if Node 23.6+ is missing.
- **Runs in every chat.** Plugin hooks fire in any folder. A chat opened one level above a single Cortex project (e.g. "Claude Projects") uses that project (`resolveProject`); with two or more below, Cortex stays out.
- **No double capture.** Plugin hooks stamp `.vault/private/plugin-hooks`; an older per-project hook seeing a fresh stamp steps aside, and takes over again if the plugin has been silent for 24 h. `kc i` with the plugin installed removes Cortex's per-project hooks and keeps everyone else's.
- Machine setup skips the per-user MCP server and skills when the plugin provides them (skills stay when OpenCode is installed, since it reads ~/.claude/skills).
- Windows: `kc.cmd` / `cortex.cmd` launchers instead of shell scripts.
- 52/52 core tests (5 new), 5 panel tests; validator passes; every file under 300 lines.
- Not yet verified: a real Windows machine, and the plugin hooks firing in a fresh Claude Desktop chat (check for `.vault/private/plugin-hooks`).

## 2026-11-08 — v1.10.0: fresh handoff brief + saved compaction summaries (V2 step 2)
- **Stale goal fixed.** The goal used to come from the last `/cortex-handoff`, forever. Now (`src/core/brief.ts`, no model calls): a handoff written in *this* session wins; otherwise the goal is this session's most recent real task statement (60+ characters, so "yes, do it" replies don't count; briefs from another AI session contribute their Task; pasted text and slash commands are left out). An older handoff goal is still shown, labelled "another session; may be done".
- **Fresh next action.** From a `Next:` line in the assistant's last reply (the rules file now asks for one when work is left, about 25 tokens), else the latest request.
- **Decided this session:** rules, decisions and failed approaches recorded in this session are listed in the packet (max 6).
- **Compaction summaries are kept.** PostCompact (Claude Code) and OpenCode compaction save the summary to `.vault/private/summaries/` (private, secrets scrubbed). They're never auto-injected (layer 2): the new MCP `history` tool lists/fetches them, and `search` indexes them. The packet only says how many exist.
- `/cortex-resume`: checks whether an earlier-session goal is already done (git log, working tree) and uses `history` / `search` instead of reading old files.
- Cleanup on this Mac: the per-user `kapex-cortex` MCP server and this project's per-project hooks were removed; the plugin's copies are confirmed working (`.vault/private/plugin-hooks` written by a plugin hook).
- 55/55 core tests (4 new), 5 panel tests; Stop hook p95 98 ms; validator passes; every file under 300 lines.

## 2026-11-08 — v1.11.0: Settings — profiles, token modes, auto-add switch (V2 step 3)
- **Preferences** (`src/core/prefs.ts`): profile (general, coder, designer, writer, creator), token mode (lean, balanced, rich), "add clear rules automatically" (on/off), Obsidian mirror (on/off). Per user in `~/.cortex/config.json`; a project can override in `.vault/private/prefs.json`. `kc prefs` / `kc prefs set <key> <value> [--project]`.
- **Token mode sets what Cortex injects:** the rules file every message carries (lean 3,000 / balanced 6,000 / rich 9,000 characters, now a strict limit including the intro line), your words re-added after a compaction (3,500 / 9,500 / 9,500; Claude Code caps injected text near 10,000), and the handoff packet (3,500 / 8,000 / 12,000; lean drops the assistant's last reply).
- **Profile tunes the rule judge:** domain words count as "specific" (designer: colours, fonts, spacing, brand; writer: tone, voice, audience, word choices; creator: channels, captions, thumbnails). "Don't use more than two fonts." is added for a designer and asked for everyone else.
- **Auto-add off** makes every rule wait for approval (failed approaches still go in).
- **Panel ⚙ Settings tab** (key 7): pickers for all four, a plain-English line under each, and the real cost here: on this project about 464 tokens per message, up to 632 once after a compaction, 668 when a new chat reads the handoff. Surfaces without a picker get buttons.
- Preferences are read once per hook process (cached), keeping the Stop hook p95 at 98 ms.
- 59/59 core tests (4 new), 6 panel tests (picking a value runs `kc prefs set`); validator passes; every file under 300 lines.

## 2026-11-08 — v1.12.0: single-file binaries, CI on three OSes (V2 step 4)
- **`npm run build:sea`** (`scripts/build-sea.ts`): esbuild bundles `src/` into one ES module (esbuild is a dev dependency; the product keeps zero runtime dependencies), `node --build-sea` turns it into one executable with the OpenCode template embedded, macOS gets an ad-hoc signature, then a smoke test runs `init`, `status --json` and a hook from the binary in a throwaway project. On this Mac: 3.5 s, 144 MB (43 MB gzipped), and the binary's MCP server answers.
- **Runs as a binary or as `node cli.ts`:** `src/core/self.ts` (`IS_BINARY`, `cmdline`, `argv`) writes launchers, hook commands, skills, the OpenCode plugin and the Obsidian export re-launch correctly in both modes. `nodeOnPath` now knows Windows (`;` separator, `node.exe`).
- **CI** (`.github/workflows/ci.yml`): `npm run check` on ubuntu, macos and windows for every push; on a version tag, binaries for linux-x64, linux-arm64, darwin-arm64 and win32-x64 are built, gzipped, checksummed and attached to the GitHub release.
- **Panel without Node:** says "Node.js 23.6 or newer is needed" with a download link instead of a setup button that would fail. Any failure to start the CLI (other than a timeout) counts as "Node not found".
- Not done: the plugin downloading the binary on first run. Release downloads from a private repo need a login, so that waits until the repo is public.
- 59/59 core tests, 7 panel tests; validator passes; every file under 300 lines.

## 2026-11-08 — v1.13.0: stuck-loop nudge, repeat = proof, what loads vs what you use (V2 step 5) + Windows/Linux fixes
- **Stuck-loop nudge** (`src/core/loops.ts`): a new `PostToolUseFailure` hook (plugin and per-project) fires only when a tool fails, so successful calls cost nothing. When the same attempt (the Bash command, or the tool plus its file/URL/query) fails a third time in a session within 30 minutes, Claude is told to stop retrying it as is, with any matching failed approach from the graveyard and a pointer to record a new one. Deterministic: TokenEconomizer uses a judge model for this.
- **Repeat = proof:** a waiting rule you type again in a *different* chat is approved automatically (the same chat repeating itself doesn't count).
- **What loads vs what you use** (`src/core/usage.ts`): skills, MCP servers and tools used in your last 20 Claude Code chats here, read from Claude Code's transcripts and cached per file (`kc status` stays at ~0.13 s). The panel's Details tab shows it next to Claude Code's exact per-message breakdown (system prompt, tools, MCP tools, skills, memory files) and, when skills cost over 2,000 tokens a message, how to turn off unused plugins.
- **CI findings fixed:** Windows reported every file as an evicted iCloud file (it gives 0 disk blocks), which broke export and the Obsidian sync; the iCloud check now runs on macOS only. Temp-folder detection used "/" and missed Windows paths. Git checked out CRLF on Windows (now `eol=lf`, and the bundle check ignores line endings). A test that changed `CORTEX_HOME` didn't restore it after a failure (now `finally`). On CI runners hook speed is reported, not enforced (shared runners measured 180–555 ms; this Mac enforces 150 ms).
- 63/63 core tests (4 new), 7 panel tests; validator passes; every file under 300 lines.

## 2026-11-09 — v1.14.0: Windows green, calmer panel, bench v3 (V2 steps 6–7)
- **Windows fixes found by CI:** (1) the Obsidian export stores the project path as JSON, where Windows backslashes are escaped; the next export compared the escaped text to the real path, decided it was another project, and wrote a second copy (this also broke ticking rules in Obsidian). Now decoded before comparing. (2) OpenCode's path-blocking rules compared `config\prod\a.yaml` against `config/prod/**` and never matched on Windows; paths are normalised to "/". (3) The lock file: Windows answers EPERM/EACCES/EBUSY where macOS/Linux say EEXIST when processes race, so the lock threw instead of waiting.
- **Panel anti-slop pass (step 7):** one accent colour; amber/red and a dot appear only when something needs you; values no longer shout in a colour each; no glyph "icons" in tabs, buttons or the header (a panel test now guards this); the decorative donut and the two semicircle gauges are gone, replaced by the same slim bars used everywhere; "Open in Obsidian" is a link (works on every OS; the old button only worked on macOS).
- **Bench v3 (step 6, `bench/v3.ts`):** v2 couldn't separate with/without Cortex (both 100%: 9 loudly labelled facts survive any summary). v3 plants 12 casual, once-mentioned rules mid-paragraph under ~140k tokens of log reading, supersedes one, compacts three times, then asks for a commit message + PR title, a code snippet, and five one-line answers. Scored by fixed patterns (a test checks the scorer gives 12/12 and 0/12 on known answers). Runs on OpenCode's free models only.
- 64/64 core tests, 7 panel tests; validator passes; every file under 300 lines.

## 2026-11-09 — v1.15.0: the new-chat result, and the bugs that hid it
- **Bench v3 results** (`bench/results/RESULTS.md`): through three compactions there is **no measurable difference** (without Cortex 12/12, 12/12; with Cortex 12/12, 11/12: OpenCode's own summary kept every casual rule). In a **brand-new chat**, without Cortex the model knew none of the 12 rules; with Cortex it kept **11/12**. That's the claim the data supports: Cortex carries rules across chats, not "better recall after compaction".
- **Fixed: rules you said were left waiting.** A rule the AI saves with the `pin` tool now counts as yours when your own typed words carry it, even paraphrased (75% of the key words, negation kept), instead of needing a letter-exact quote. Pasted text and other AIs' briefs never count; one-offs ("from memory only", "this time", "for now") and questions still wait; a saved rule that contradicts an older one replaces it.
- **Fixed: the live-message lookup missed folders with two spellings** (macOS `/var/…` vs `/private/var/…`), so a rule saved mid-turn found no matching message.
- **Fixed: old chats flooding suggestions.** The first time Cortex sees an existing chat (e.g. the plugin starts running in an old parent chat), it stores every message but only judges the last 3 for rules. Your 7 Nov planning instructions had come back as suggestions.
- **Fixed: the bench scorer** treated correct answers that mention the replaced value ("302, not 301", "raised from 50") as wrong and missed PR titles on the line below their label; tested on the real answers, every run re-scored.
- Rule updates worded "raised to / changed to / previous" now replace the older fact.
- 68/68 core tests, 7 panel tests; validator passes; every file under 300 lines.

## 2026-11-09 — v1.16.0: conventions said in passing, read guard, what each tool costs
- **Conventions capture** (`src/core/judge.ts`, `capture.ts`): Cortex now saves project facts said once, with no rule word, without waiting for the AI to call `pin`: "our env vars use the `LNKY_` prefix", "commits start with `lnk:`", "we use chi for routing", "short codes are exactly 7 characters", "redirects default to 302, not 301". Deterministic wording patterns plus a "names something concrete" check (a backticked name, a number, an acronym, `KEY=value`, a colour code). One that isn't clear on its own is dropped, not queued, so chatter ("the build is 3 minutes slower", "we use this approach because…") adds nothing. Sentences no longer split after "e.g." / "i.e.".
- **No duplicates between the AI's pin and Cortex's own capture:** a new "same fact" check (same numbers, 70% of the key words, short forms such as "env vars" = "environment variables") is used by both. The older rule a new one replaces is excluded from the check, so "now 120, not 50" still replaces "50".
- **Read guard (opt-in, Settings → "Warn before big reads", or `kc prefs set readGuard on`):** the first whole read of a text file over 40 KB (about 10k tokens) is turned back once with a hint to read only the part needed or grep first; reading it again goes through. In Claude Code it runs inside the panel mod (no extra process per Read, nothing at all while off); in OpenCode inside the plugin, via a flag in `.vault/enforce.json`. Any error lets the read through.
- **What each tool costs** (Details tab): each MCP server and each plugin's skills with the tokens they add to every message (from Claude Code's own `/context` numbers), flagged when your last chats here never used them. Schemas that load on demand aren't counted.
- README: benchmark section now shows v3 (the v2 table said "no gain yet"), the panel table matches the current panel, and the Windows line says what's actually verified (CI only).
- 72/72 core tests (4 new), 10 panel tests (3 new); validator passes; Stop hook p95 98.6 ms on this Mac.
- **Bench, new chat, v1.16:** 12/12 and 11/12 (the one miss: it named Jira while explaining why it left the ticket out). Run 2 exposed two duplicate pairs (pin + own capture in different words); fixed by stripping trailing full stops in word matching and ignoring dates when comparing numbers. Scorer: "obsolete / outdated / replaced" now marks an old value; all stored runs re-scored, only that run changed (10 → 11).

## 2026-11-09 — v2.0.0: memories sorted by type, a model sorts them, CLAUDE.md inbox, Emerald dashboard
Agreed with Kafil before building (the "Cortex 2.0" plan): Cortex is the inbox for CLAUDE.md, not a second rules file; a model sorts what you say, code decides trust; no more wording patterns.
- **Memory types** (`src/core/types.ts`, `views.ts`): Rule, Fact, Decision (dated, newest wins), Preference, Failed. Each carries strength (must/should/may), ★ for core, who sorted it, who said it, when, and what it replaced. The rules file Claude and OpenCode load is now in sections with a one-line legend, so the AI can tell a hard limit from a taste. Re-sorting is an append-only `meta` line: the AI may soften a memory; only you can star it or make it a "must".
- **Wording patterns removed.** The regex judge, conventions patterns and backfill are gone. Unmarked text is sorted by a model; what you mark yourself ("rule:", "fact:", "pref:", "decision:", "failed:") is still saved directly.
- **Classifier choices** (Settings → Memory, `src/core/classify.ts`, `backends.ts`): the AI in your chat via `pin` (default), Claude subscription in the background (`claude -p`, Haiku, no tools, no plugins, no settings, effort low: measured ~950 input tokens and 3.6 s for a short call), an OpenCode model, or your own API key (Anthropic or OpenAI-compatible; key from CORTEX_CLASSIFIER_KEY or the macOS keychain, never a file). Thinking models are refused by name; 45 s timeout; errors go to errors.log and the panel. The worker runs detached from the hook, takes a lock, keeps a cursor, starts at the newest message (no backfill bill) and does at most 10 messages per run.
- **Trust stays in code** (`src/core/remember.ts`): one save path for every sorter. Only your own typed words can become active by themselves, and a background model must be ≥ 75% sure. Pasted text is sorted in a separate call so it can't steer how your words are read, and it always waits. Every proposal must quote the message word for word, and its restatement may add at most a third new key words. Duplicates are checked against Cortex and against your CLAUDE.md/AGENTS.md (same numbers and same key words); the memory a new one replaces is found first, so "now 120, not 50" replaces "50" instead of being called a duplicate.
- **CLAUDE.md inbox** (`src/core/promote.ts`): "To CLAUDE.md" moves a memory into one marked block in CLAUDE.md (and AGENTS.md if present), atomically, leaving your own text untouched; it leaves Cortex's rules file so it's never loaded twice. "Back to Cortex" undoes it. New CLI: `kc m <id>`, `kc demote`, `kc sort <id> fact should star`, `kc delete`, `kc classify`, `pbpaste | kc key`. New MCP tool `sort` for tidying.
- **Trust bug found by labelling real messages:** background-task notices (`<task-notification>`), session events and "[Request interrupted by user]" arrive inside user messages and were counted as the user's own words. Now treated as harness output.
- **Dashboard redesign** (Kapex Emerald & AMOLED Slate tokens in `claude-plugin/hooks/theme.ts`): dark canvas, charcoal bento cards, one chart form per kind of data (`viz.ts`): arc gauge with the compaction mark for context, smooth area sparkline for trends and hook speed, KPI strip with micro-bars and a self-draining cache bar, bento tiles for memory by type, vertical capsules for what every message carries. Order: needs-you → context + plan/cache/handoff → memory + cost → tabs. Every text has an explicit colour (the mod can't read light/dark mode).
- **Status strip above the prompt** (`band.tsx`): logo, context ring, cache countdown (one SVG animation, no timers), 5-hour plan, handoff check, review count; the button now says "Open Cortex", no icon.
- **Logo**: the "Vault Prism", a twisted hexagonal prism with emerald and silver facets and real gaps around an open core (`logo.ts`). `scripts/logo-png.ts` draws PNGs from the same shapes with no dependencies (plugin icon, 512 and 1024 px in `docs/brand/`).
- **Memory eval** (`bench/memory-eval.ts`): extracts real messages from your transcripts into `.vault/private/eval/` (gitignored), labelled by sentence; scores a classifier's precision (junk rate), recall and type accuracy; `replay` shows what it would save from recent chats. Nothing is written to any project's memory.
- Session cleanup: the parent chat was archived (each turn here could wake it) and this chat renamed "Cortex 2.0".
- Windows CI: the v1.16 failure was a test importing a plain path (`C:\…`); now a file:// URL.
- This project's own memories: real ones sorted into types; 10 leftovers from before the trust checks (fragments, a question, harness text, feature requests) are left for Kafil to delete in the panel.
- **Memory eval result** (Haiku, 169 labelled real sentences): v1 prompt precision 48% / recall 69%; v2 prompt ("would you want this in a new chat next week?" + a leave-out list) precision 67%, recall 75%, type right 96%; of the 28 it would add by itself, 79% were worth keeping. The chat AI's `pin` tool got the same test in its description.

## 2026-11-09 — v2.1.0: learning playbook, session journal, format filter, panel that matches the app
Planned with Kafil first (8 areas, phases A–E), then built in one go, testing at the end.
- **Format filter** (`src/core/filter.ts`): before any sorter, drop code blocks, markdown tables, headings, dividers, JSON, shell prompts, lines that are mostly a path/URL/colour, and pasted documents (40+ lines or 4,000+ chars). Shape only, never meaning. The table-row "rules" from v1 can't happen again; saved text loses list markers and bold markup.
- **Approvals out of the chat** by default (`askInChat`, off): the Stop-hook question cost a model turn and made approving junk easy. Waiting memories show in Review and as a count in the status strip.
- **Session journal** (`src/core/episodes.ts`): one entry per turn, built from transcript lines the hooks already read: your ask (your words only), files changed, commands, tests run and failed, commits, tool errors, interruptions, tokens, and the AI's "Done:"/"Next:" lines (the rules file now asks for "Done:"). Ratings: stars in the panel, `rate: 4 note` in chat, or `kc rate`. Private, append-only.
- **Learning** (`src/core/reflect.ts`, the ACE "evolving playbook" pattern): a reflector model reads recent turns, ratings and your next message (where corrections show; never tool output text) and proposes add / helpful / wrong / retire; the curator (code) needs evidence and ≥ 0.7 confidence, merges duplicates into +1 helpful, keeps at most 25 lessons, retires the weakest, never touches starred ones. Lessons are a new memory type, loaded in their own section of the rules file at chat start or after compaction (cache-cold moments). Runs by itself at session end and pre-compaction when a background model is set; "Learn now" otherwise (Haiku, ~2k tokens).
- **Editing everything**: `kc edit <id> <text>` (a corrected copy replaces the old), `kc lesson <id> helpful|harmful` (your vote counts double), MCP `journal` tool.
- **Panel**: transparent pane and theme text colours, so it matches Claude Code's light or dark mode (fixed tokens only inside charts, chosen to read on both); icon header (model, branch, sync, OpenCode) and a health ring; Last turn card with one-press stars; Timeline tab; Memory tab with collapsible groups, 10 rows at a time, Edit, lesson votes, a prune hint at 50 and a 200 active cap; emerald tabs and headings with no dark tab bar; smaller right-aligned Save; settings in sections with hover help; profiles removed (they did nothing since v2.0). Status strip in three groups across the width.
- **Close button**: the engine doesn't tell a mod whether the pane is maximized, so the blank-screen close can't be blocked without breaking the close that works when minimized. Left as a Claude Desktop bug, with the tip in the panel.
- **Eval**: structured output (`claude -p --json-schema`), 8 made-up examples in the prompt, a 70/30 dev/test split, a regression gate with a saved baseline, and a two-labeller agreement check. Results in bench/results/RESULTS.md: about 82% of auto-added memories worth keeping and about 62% recall overall; the held-out split didn't match the dev gains.
- New-chat bench 11/12 (no regression). 79 core tests, 12 panel tests; Stop hook p95 108–126 ms across runs (limit 150); every file under 300 lines.

## 2026-11-10 — v2.2.0: strip that never vanishes, lossless handoff, four-page panel, other tools, public export
Researched first (engine types, $.store, transcripts, 47 commits), agreed with Kafil, then built Phases 1–5 in one go.
- **Status strip never vanishes**: a failed refresh used to replace the last good status with nothing (after an app update the first refresh can fail), so the strip drew nothing until the next reply. Now a failure keeps the last status, the last good one is saved in `$.store` and drawn at once after a restart, a folder with `.vault/` shows "Cortex is loading" and retries from drawing (no timers), and a failure shows the reason with Retry. Plan numbers are also remembered across chats ("last seen 16 h ago") instead of blank cards.
- **Tips** (`tips.ts`), one at a time in the strip's middle with the reason on hover, highest value first: a cold cache on a big chat ("next message re-reads 758k"), a cache about to cool, near compaction, a nearly used 5-hour plan, a recent handoff in a brand-new chat, tools loaded every message but never used.
- **Lossless handoff**: every turn's full exchange is saved privately (`exchanges.ts`, newest 6 per chat, secrets scrubbed, pasted blocks noted not copied). STATE.md now carries the last 3 exchanges word for word (the newest reply gets most of the room, so a plan survives whole), active files, the last test/check result and open items (unchecked boxes, ❌ rows, Next lines). Handoff budget raised to 30k characters in balanced mode: read once, far cheaper than a cold reload. /cortex-resume treats the newest reply as its own. The panel shows "Ready to switch" with exactly what a new chat will know and what it costs.
- **Four pages**: Overview (greeting, tip, gauge, plan/cache/handoff, last turn as asked → changed → result with stars, memory tiles with the icon beside the label, savings, what every message carries, ready to switch; three columns when wide), Timeline (turns, git commits and merges with pushed state, compactions, handoffs, memories, lessons, ratings; grouped by day; icon nodes instead of dots; one line each with More), Memory & Data (Review, Memory newest first, Handoff, Vault file tree, Compactions, Costs), Settings. Long text is one line with More everywhere.
- **Greeting**: your name setting wins; else the computer account's full name (macOS `id -F`, Windows the local account's FullName, Linux GECOS), first word only, never a login name, cached in ~/.cortex, never in the project or tests. Can be switched off.
- **Learning opt-in**: `autoLearn` off by default; nothing spends usage until you switch it on.
- **Other tools** (`targets.ts`): memories kept in sync in Cursor (.mdc, alwaysApply), Windsurf (always_on), Cline, GitHub Copilot (marked block) and AGENTS.md (marked block); `kc desktop [--write]` gives Claude Desktop's Chat and Cowork Cortex's MCP tools for one project.
- **Safety**: memory text can no longer close CLAUDE.md or AGENTS.md marked blocks; lessons with commands, links, paths or credential talk are refused; private logs rotate (journal 5 MB → newest 3,000 turns, messages 10 MB → newest 5,000).
- **Public export** (`scripts/export-public.ts`): a clean copy with no history, this project's own memory and machine config left out, home paths, vault names, emails and machine names rewritten, and a leak check that refuses to finish if anything personal remains. Nothing is pushed: it prints the publish command.
- Tests: 86 core (7 new, including a stress test: 3,000 memories and 2,000 turns give a status in ~0.2 s and the rules file stays in budget), 14 panel; Stop hook p95 109 ms.
- v2.2.1: the same release with the plugin bundle rebuilt (v2.2.0's version bump came after bundling, so CI's bundle check failed; no test failed).
- v2.2.2: Windows fix: active files in the handoff are now project-relative with "/" on every OS (Windows paths kept their C:\ prefix; caught by CI).

## 2026-11-10 — v2.3.0: one-line strip, structured cards, tiles everywhere, and a way to see the panel without the app
Fixes for the six points Kafil raised from screenshots of v2.2.2, each checked by screenshot before release.
- **Seeing the panel** (`scripts/preview.ts`): mounts every page and the strip through `claude plugin test` with this project's real status. It draws each element tree as HTML (dark and light; docked, mid and maximized) in git-ignored `docs/preview/`, ready to screenshot in a browser. It reproduced the reported bugs exactly, so every fix below was checked by eye.
- **Strip on one line**: one pill for context · cache · 5-hour plan, one for the current tip (else the handoff state), then Refresh (⟳) and Open Cortex pinned far right, with the review count on it. The week and the full reason show on hover. About 650 px at most, no wrapping.
- **Refresh in the panel header too** (⟳), since status mostly updates at the end of a turn.
- **Overview, most urgent first, no gaps**: tip → context (gauge with used / free / summary room) and plan, cache and handoff → last turn and ready to switch → memory, savings and what every message carries. Root cause of the gaps: percentage widths plus padding overflowed the row. Cards now start from a share and grow to fill their row (`flexGrow`), and full-width cards stretch instead of declaring 100%.
- **Structured cards**: Last turn (outcome badge, 4 small metrics, Done and Next lines, stars), Savings (3 metrics), Ready to switch (memories / exchanges / files / open items, last check, a token badge).
- **Tiles** (`tiles.tsx`): collapsed by default with a preview; Expand shows details and actions. Used by Timeline (plus a new Activity swimlane chart over the last 7 days), Memory (actions only when opened), Review (Approve / Reject always shown), Handoff, Compactions; a segmented sub-nav; Costs and Settings in cards (Settings in two columns when wide).
- **Bugs**:
  - The timeline sorted git dates with "+05:30" as text, so commits jumped above newer events. Every source is now put into UTC first.
  - Turns started by a background task, a side session or CI showed "(continued work)". They are now named ("Background task finished: …").
  - "Last check" showed `cd "…" && npm run check > /private/…`; it now shows `npm run check`.
  - Names like "Mohd. Kafil Khan" found no name (the title failed the check, and the empty result was cached). Titles and initials are now skipped, and an empty cached name is retried.
- Tests: 4 new core tests; panel tests updated to the new layout (14 pass).

## 2026-11-11 — v3.0.0: prune and pivot onto Claude Code's own memory
An audit against Anthropic's agent-memory study ("The components of agent memory", Nov 2026) and Claude Code's docs found:
- Cortex v2 ran a second memory store beside Claude Code's own CLAUDE.md, rules and auto memory. The model was told to save in two places.
- 12 of this project's 28 active memories were junk: sentence fragments, app text saved as rules, feature requests, a stale colour. That is the turn-by-turn pollution the study warns about.
- Claude Code has no local dreaming, and its `/doctor prompt-audit` checks files against files, not against what happened.

Kafil approved cutting v2's memory store and building on the native files.
- **Removed:**
  - the ledger and its views, the rules file, the `pin` tool and the MCP server (no tool definitions in every message)
  - all sorter modes, the review queue, the lesson reflector, ratings
  - exports to Cursor/Windsurf/Cline/Copilot/AGENTS.md, the Obsidian mirror
  - compaction re-injection (Claude Code reloads CLAUDE.md itself), the read guard, the stuck-loop nudge
  - the UserPromptSubmit, PostCompact and PostToolUseFailure hooks
  - 22 modules in all
- **Dream** (`dream*.ts`, `evidence.ts`, `native.ts`):
  - evidence read by program from Claude Code transcripts and git
  - program checks (limits, broken index links, missing files and colours, claims a real run contradicts, duplicates)
  - an optional model judge whose claims must cite that evidence
  - path-scoped rule moves (`.claude/rules/<topic>.md` with `paths:`) and closed-loop lessons
  - Apply/Discard/Undo with before/after copies, all or nothing, refused when a file changed
  - refused model claims are kept with their reasons
- **Migration** (`migrate.ts`):
  - archives v2 memories word for word
  - removes only what Cortex generated, including exactly the permission denies it had added
  - keeps memories the user had moved into CLAUDE.md
- This project's memory now lives natively:
  - `CLAUDE.md` (hard limits, a fact, tried-and-failed with what to do instead)
  - `.claude/rules/panel-design.md` (scoped to the panel's folder)
  - `~/.claude/rules/working-style.md` (three cross-project preferences)
- **Panel:** Overview · Timeline (turns, commits, handoffs, Dreams) · Dream & Memory (Dream, Memory files, Handoff, Costs) · Settings (Dream, Handoff, You). The strip counts Dream changes waiting.
- **Fixed on the way:**
  - "Last check" showed a command that only mentioned a `tests/` folder; one strict test-command pattern is now used everywhere
  - a `paths:` list in a rule file was read as a single value
  - a bare file name in a note (`theme.ts`) counted as missing
- **Verified:**
  - the Mount Moon test plants a false, a stale and a duplicate note (plus a broken link): the Dream finds all four, Apply fixes them, Undo restores every byte
  - a live Sonnet Dream on that project caught all four in 3.3 s
  - on this repository, a live Dream proposed nothing it was sure of (3 suggestions refused for low confidence or being about the user's own files)
  - 13 core tests, 10 panel tests; Stop hook p95 107 ms

## 2026-11-11 — v3.1.0: icons that render, real buttons, connector rails, a broken Resume fixed
From Kafil's screenshots of v3.0.0 in the app:
- **Icons never rendered in the app.** Every small icon (header tags, tile nodes, labelled lines) was an Svg with `alt=""`, and the desktop draws nothing for an empty alt; charts, logo and the health ring had alt text and showed. Every Svg now has alt text. The HTML preview now skips empty-alt Svgs too, so it can't hide this again.
- **Buttons:**
  - a Button's `label` is what the app draws, so "Refresh Cortex stats" appeared as words: the strip now has ↻ and Open Cortex as real buttons
  - the panel header has `[R] Refresh` (moved up from the footer), with "Refreshed at …" beside it so a press visibly does something
  - the sub-pages (Dream · Memory files · Handoff · Costs) are real tab buttons
- **Lists:**
  - Timeline, Dream findings, Memory files and Handoff tiles are joined by an L-shaped connector rail
  - tiles are all the same width
  - badges carry an icon where it helps (Commit, Dream, Turn, Out of date, read-only…)
- **Resume was broken:** the engine refuses a prompt starting with "/" (it would run a command as the user), so "Resume" and "Resume here" did nothing. They now send plain words the resume skill picks up. Found by a new stress test that presses every button on every page and sub-page (25 presses, each checked for the command it sends).
- **Smaller fixes:**
  - the unused-tools tip no longer lists the Claude app's own servers (session, browser, simulator…) and calls claude.ai connectors "connectors", not hex ids
  - replaced Dreams are left out of the timeline
  - Dream titles say "changes to review" or "notes for you to check"
  - Last turn shows commands as you'd type them
  - the Settings greeting matches the header
  - the context card no longer says Cortex puts memories back
- 13 core tests, 11 panel tests; Stop hook p95 101 ms.
- v3.1.1: a Windows-only test fix (a `/Users/…` path gets a drive letter there, so Claude Code's folder name starts `D--`); v3.0.0's CI had failed on it, so it had no release binaries.
- v3.1.2: a test used `/Users/me/…`, which the public export's privacy rewrite turned into `-Users-you-` on one side only; the public repo's first CI run failed on it. The test now uses `/Users/you/…`.

## 2026-11-11 evening — v3.2.0: the bugs found testing v3.1.2 in the real app
- **Stop hook 4× faster (p95 187 ms → ~40 ms).** Not the hook's work: Node's built-in TypeScript stripping cost ~30 ms per launch plus more per module. The hooks now run one pre-built JavaScript file (`claude-plugin/cortex/hook.mjs`, built by esbuild at `npm run bundle`, checked for staleness by `npm run check`; still zero runtime dependencies). `src/hook.ts` is the small entry point it is built from.
- **Refresh showed a plan number from before the reset** ("99% · resets 5:10 PM" at 6:33 PM). Refresh did run; Claude Code only reports plan use with a reply, so the panel fell back to a copy saved hours earlier and never checked its reset time. A window whose reset time has passed now reads "0% · new window since 5:10 PM · updates after a reply", in the panel and the strip.
- **Dream findings you couldn't act on.** Every finding now has buttons: Apply / Keep for proposed changes; Remove line / Ask Claude / Keep for notes that are yours to decide; Undo on each decision; Apply all and Undo this Dream. Every decision rebuilds the files from the Dream-time copy plus all applied findings, so one-by-one is as exact as all-at-once, and it's refused if a file changed by hand. Keep is remembered by the note's text (`.vault/dream-keep.json`), so the same note isn't flagged again until it changes.
- **Connectors and gaps in flat lists.** The L-shaped rails had a guessed height (the engine can't size a one-sided border), which also caused the big empty gaps. Recent handoffs, Dream findings and Memory files are now plain stacked lists; only the Timeline keeps its rail.
- **Costs is visual:** what loads into every message is one composition bar with a legend (share and tokens per part, plus the honest note that it's re-read from cache at about a tenth of the price); tools and skills are a ranked lollipop list with used/unused badges.
- **Real buttons** for "See the handoff" and the Memory card's Open/Review.
- **Public repo updates:** `node scripts/export-public.ts --sync` clones the public repo, lays a fresh clean copy over it (deleted files go too), commits with the public repo's existing author and tags the version. It pushes only with `--push`.
- 13 core tests, 12 panel tests (new: the plan reset; Remove line / Ask Claude / Keep on a yours-to-decide note). Stop hook p95 50.9 ms, now measured on the file the plugin runs.

## 2026-11-11 night — v3.3.0: a three-part handoff, memory checked every turn, a hand-off you confirm
- **STATE.md in three parts.** The last three exchanges alone lost the session's purpose whenever the last turns were small (a CI fix, git commands). Now, built at Stop from what Cortex already stores (no model, 0 tokens):
  1. **Pinned for this session:** the request it started with (your words, without `@file` paths; the start of your pasted prompt if that's all there was), your standing instructions in your own words ("never…", "don't…", "instead…", ranked, at most 8), the decisions `/cortex-handoff` recorded (new `--decision`), and memory notes a check flagged but nobody fixed yet.
  2. **Session trail:** one line per earlier turn (what you asked → what got done, commits and checks) and this session's commits.
  3. **Where we left off:** the last exchanges word for word, as before. Each part has its share of the budget, so the tail can't push the others out.
  The idea follows long-context memory designs that keep a gist, the ranked high-value items and the recent turns intact.
- **Dream-verified handoff.** Claude Code loads CLAUDE.md, rules and auto memory into a new chat by itself, flagged or not. Fixing them stays your press (Apply), so the hand-off asks first: "2 memory notes were flagged: Fix them first / Hand off anyway", and the packet tells the new chat which notes not to rely on.
- **Quick check after every turn, without slowing the turn.** The check itself takes ~100 ms (it greps the repo for every colour and path a note names), too much for the Stop budget. Stop now only compares a fingerprint (memory files' sizes and times, their folders, HEAD, the working tree: ~1 ms) and, when it changed, starts the check in the background (0.3 s, no model, no tokens). Findings arrive as a checks-only Dream with the usual buttons; it never replaces a Dream you're in the middle of, and an identical one replaces the last quietly. Settings → Quick check after every turn (on).
- **Hand off at 80%.** At 80% full (or 70% with a cold cache) Overview asks "Context 81% full and the cache is cold: continue in a fresh chat?" with Yes / Later, and the strip gets a "New chat…" button. Yes saves the handoff with a working-tree snapshot and copies `/cortex-resume`; you open the new chat and paste (Claude Code opens chats itself; a mod can't). Later waits 30 minutes or 5 more points. Settings → Offer a fresh chat at.
- **Ready to switch chats** on Overview now shows the goal, the next action and the three parts (pinned, earlier turns, word for word, open items), with "See the handoff" and "Hand off now" as real buttons. Last turn no longer shows raw `@/Users/…` attachment paths.
- **Old skill copies fixed.** `kc setup` writes copies of Cortex's skills to `~/.claude/skills` for OpenCode, and Claude Code prefers those over the plugin's. Ours were still v2 (`/cortex-resume` told Claude to read INVARIANTS.md and GRAVEYARD.md, which v3 removed). Cortex now refreshes its own copies at session start (only files that say "Kapex Cortex") and removes the retired `cortex-approve`.
- Fixed while building: a Stop without a session id wrote an "unknown" handoff that won as the newest; the auto-Dream started from a hook now launches the CLI, not the hook file.
- 18 core tests, 13 panel tests (new: tier extraction and order, the Quick check gate, the skill refresh, the hand-off flow). Stop hook p95 64.7 ms.

## 2026-11-11 night — v3.4.0: park unused MCP servers, what this project used, memory health, the subagent tip
- **Park MCP servers, by hand or by itself.** Parking writes Claude Code's own per-project switch, the `disabledMcpServers` list in `~/.claude.json` that `/mcp` writes, under the name `/mcp` shows (the context breakdown's `serverName`, so no guessing). Read-modify-rename with the file's permissions kept, then read back. It takes effect from the next chat: this chat keeps its tools, so its prompt cache stays intact. Cortex records what it parked (`.vault/private/parked.json`); Costs shows each with Park/Unpark, and says when a parked server was turned back on elsewhere or still loads (the Claude app keeps some of its own servers on). **Auto-park** (Settings, on): a server unused in your last 10+ chats here, never the Claude app's own, never one you turned back on.
- **Not parkable by file:** skills that come with plugins Claude Desktop installs from its catalog (here vercel, figma, design): they aren't Claude Code plugin files, and `skillOverrides` doesn't cover plugin skills. The panel says to turn them off with /plugin or in Desktop's Customize, instead of pretending.
- **Tokens this project used:** today, the last 7 days and everything kept, split into cache reads, cache writes, new input and output, from the usage numbers Claude Code writes into its transcripts (0 tokens). Each reply is logged once per content block, so replies are counted once by message id (in this project 685 lines were 300 replies); subagent chats count. Cached per file: 150 ms the first time over 60 MB, 6 ms after.
- **What Cortex saved, measured only:** context a chat started from a handoff didn't re-read (the size the chat before had grown to minus the new chat's first message), tokens a message no longer carries because of parked servers, tokens of path-scoped rules, and the 0 tokens Cortex adds. Cache reads are labelled as re-reads at about a tenth of the price, never counted as full-price savings.
- **Memory health** on Memory files: files under 200 lines, the share of rules that load only for their files, notes flagged but not fixed, and recent Quick checks that found nothing, each on its own (no made-up score), plus a line-budget bar per file.
- **Subagent tip, measured:** when the last turn grew this chat by 40k+ tokens across 12+ reads, searches and commands, a tip says a subagent would have kept that output out of this chat, and that its own tokens still count toward the plan.
- The `.md` optimizer the plan asked for is the Dream itself, now run every turn by the Quick check: path-scope moves into `.claude/rules/<folder>.md` with `paths:`, over-limit files, duplicates, broken links, orphans and stale notes, each with Apply and Undo.
- Panel numbers over a million read "247M", not "247406k".
- 20 core tests, 13 panel tests (new: reply counting and resumed chats; the config write keeps other settings and permissions, Undo, and "turned back on stays on"; Park on the Costs page). Stop hook p95 63.9 ms.

## 2026-11-11 night — v3.4.1: plain words, less text, illustrations
- "Park" is gone from the panel: buttons say **Turn off** / **Turn on**, the list is "Turned off here (disabled)", the setting "Turn off unused MCP servers (disable)", and every place says it applies to new chats.
- Less text: long explanations cut to one line (Dream, Memory files, Costs, the hand-off banner, tips, Settings). The handoff's default "Next" (written for Claude, not you) no longer shows on Overview; Last turn says "Ran 18 commands" instead of listing raw commands; Earlier Dreams shows only the ones you can still undo, the rest as one line.
- Illustrations drawn for Cortex in Kapex Emerald (no third-party art): a chat handing off to a fresh one (the hand-off question, no handoff yet), a quiet night over checked notes (nothing to fix, all decided), notes under a lens (no Dream yet). Grey at part opacity, so they read on light and dark; nothing animates.
- v3.4.2: the bundle step builds the hook with esbuild's JavaScript API instead of its command line: on Windows the shell split the banner argument into extra file names, so the public CI failed there (macOS and Linux passed).
- v3.4.3: the permissions check in the turn-off test runs only on macOS and Linux (Windows has no Unix file modes, so it failed there).

## 2026-11-11 night — v3.5.0: a mascot that shows how things stand
- **Overview hero:** the top of Overview is now one headline for right now (the hand-off question, a tip, Memory to review, or a calm summary), its action, and Cortex's mascot, a small emerald robot drawn for Cortex. Its mood comes only from Cortex's own status, most urgent first: **stressed** (time to hand off, a red tip, the 5-hour plan at 90%+), **dream** (notes waiting for a decision, or a Dream running), **working** (a tip, or context / plan getting full), **hi** (a fresh chat), **calm** (all fine). The tip card and the hand-off card folded into it.
- **A scene on every page, at the top:** Timeline (the robot by a rail of events), Dream (asleep over notes, with a lens), Memory files (with checked notes), Handoff (a full chat passing a packet to a fresh one), Costs (coins and bars), Settings (gears and sliders), each with a title and one short line. They replaced the explanatory lines that were inside the first card.
- **No card behind illustrations** ("Nothing to fix", "All decided", "No Dream yet").
- **Built for a panel that redraws often:** every drawing is static (no animation, no timers), 2–2.7 KB, built once per size and kept in a cache capped at 64 entries, so a redraw is a Map lookup. Neutral parts are grey at part opacity and the face is a dark screen, so it reads on light and dark.
- 20 core tests, 14 panel tests (new: mood order and the bounded cache).
- v3.5.1: the Settings page's opening line says "Preferences" (the tab already says Settings), and the Dream page's "Nothing to fix" / "All decided" / "No Dream yet" drawings are centered.
- v3.5.2: Timeline kind badges without a second icon (the tile already has one); Costs ranks tools and skills with rounded progress bars (no end dot); Overview Savings adds "tokens this chat used so far" (this chat's transcript, subagents included) and "tokens saved by Cortex so far", the same counts the Costs page uses.
- v3.5.3: Overview Savings is five compact rows again (the card is as tall as its neighbours, so the row no longer grows); in a half-width pane each Costs tool row drops its bar and uses shorter badges, so its Turn off / Turn on button stays on the same line at its normal size.

## 2026-11-12 — v3.8.0: rounded inner tiles, a first-run intro, safety for long runs, honest token count
- **Research first, and what it changed.** Claude Code already ships five ways to run work in parallel (subagents, agent view, agent teams, dynamic workflows, Projects beta), so Cortex builds **no orchestrator**: a sixth would compete with Claude Code instead of improving it. Google's Elephant-Goldfish model already installs as a Claude Code plugin (with a spec drift report), so Cortex borrows only the Goldfish idea for its own handoff. `/doctor prompt-audit` reviews memory wording natively; a Dream checks the facts. No token-compression code was left in v3 (nothing rewrites prompts), so there was nothing to remove.
- **The "0 tokens" claim was wrong.** `claude plugin details kapex-cortex` measures ~249 tokens always-on (three skill descriptions). On a machine that also had Cortex's copies in `~/.claude/skills` (written for OpenCode), Claude Code listed every skill twice: ~498. The panel now shows the measured number (and flags duplicates), the README badge says ~250, and at session start Cortex moves its own copies to OpenCode's folder (`~/.config/opencode/skills`) and removes them from `~/.claude/skills` when the plugin is installed. Files Cortex didn't write are never touched.
- **Claude-first.** Codex, Cursor and Windsurf were only README rows; they're gone. OpenCode stays as the usage-limit fallback.
- **Boxy inner tiles:** the desktop rounds a Box only when it has a border (the engine has no radius prop), and inner tiles had a background only. They now get a soft round edge (not in the terminal, where a border costs two rows). Plan, cache and handoff are a 2×2 grid: icon and title over a bar on the left, the value large on the right across both lines ("5 Hr Plan"), a caption below; the cells grow to fill the card, so no empty strip is left. Last turn's footer sits at the card's bottom edge.
- **First-run intro:** three steps, each a drawing made for Cortex and two sentences (strip and costs · handoff · Dream), Skip / Back / Next. Shown once per computer, skipped for projects with history, replayable from Settings.
- **Safety for long runs** (Settings, `kc safety`): Read deny rules for `.env` and `~/.ssh` (one press), the sandbox explained (never turned on for you), and a **verify gate**: a Stop hook (exec form, `${CLAUDE_PROJECT_DIR}/.claude/hooks/cortex-verify-gate.mjs`) that runs the project's check when Claude stops after changing files and answers `decision: "block"` on failure, at most 3 times in a row, skipping when nothing changed since the last green run. A plain `npm test` Stop hook can't send Claude back: exit 1 is non-blocking. Every Apply backs up the files first; Undo restores them byte for byte.
- **Fresh-eyes check** on the Handoff page: one press asks this chat to start a subagent (not a fork) that reads only `STATE.md` and the files it names and lists where it would stall; the chat then sharpens the handoff.
- **Stop hook 63 → ~51 ms p95:** this session's commits are asked of git only when HEAD moved (read from `.git`, no process), and the per-session working copies skip fsync (still atomic; STATE.md keeps it). What's left is Node's start (~22–28 ms) and one `git status` (~9 ms).
- Tried and fixed: the mod validator refuses `$` passed to a function expression across files (use function declarations), and an atom must be updated in the file that defines it (`setIntro` lives in data.ts). The gate's fingerprint includes its command, so a test must keep one command and change the result from outside.
- 26 core tests, 16 panel tests (new: duplicate skills moved and removed, the measured footprint, safety audit / apply / undo, the gate's block-pass-skip cycle, the intro flow, the Safety card and fresh-eyes button). `llms.txt` added; README rebuilt (install at the top, Q&A, native-vs-Cortex table).

## 2026-11-12 — v3.8.1: real-app fixes, a traffic-light strip
- **Badges were tall in the real app.** The desktop gives a bordered Box the card's padding, so the soft round edge turned every chip ("every session", "Ready", "1 of 15 checks failed") into a tall button. Badges and pills are plain again; only metric and KPI cells keep the rounded edge.
- **The intro fills the pane:** at least the pane's height (the pane's `bodyRows`), centered, art beside the words when wide, and three callouts per step (Context · Cache · Costs; Pinned · Trail · Last exchanges; Evidence · You decide · Undo).
- **"1 of 15 checks failed" on a turn that ended green:** the journal counted every failed test run in the turn. It now keeps the result of the last run: a failure fixed later reads "Checks passed · 1 fixed" (Timeline: "tests passed · 1 fixed"; handoff: "passed on the last run"). A turn that ends red still says so.
- **Timeline connectors:** a tile's connector height now follows its preview's real line count at the pane's width (it assumed 3 lines for any preview, which left a gap under one-line ones).
- **The strip is a traffic light.** Green: "All good" (and "handoff saved"). Amber, fine to continue: the cache cooling ("reply before"), context or the 5-hour plan filling up, memory fixes to review, tools never used, a Dream due (3+ days and 3+ chats). Red, the move and what it saves: a cold cache on a big chat, context at your hand-off threshold, the plan at 90%. One button beside it does the move: Hand off (saves the handoff and copies /cortex-resume, after showing flagged memory), Dream (background, proposes only), Review, Costs, Resume. "Continue: type /cortex-resume" now shows only in a brand-new chat, and only when the handoff came from another chat (the handoff's session id is read from STATE.md).
- 27 core tests, 18 panel tests (new: fixed-then-green checks, the traffic light at each level, a one-press hand-off from the strip).

## 2026-11-13 — v3.8.2: a live strip, chats that carry over, a benchmark and three outside judges
- **The strip is live between replies.** A heartbeat (`hooks/pulse.ts`): every 4 s while a turn runs it reads Claude Code's own usage in-process (no Node, no tokens), so context climbs live; idle, every 30 s it checks the cache state, plan resets and the day, and four file stats tell it when another chat or OpenCode wrote here (then one full read). The strip redraws only when its answer changes. One timer per session, rescheduled never stacked, cancelled on reload and session end. After an app restart, a chat's last reply time comes from the journal, so an idle chat says "cache cold" instead of "cache on reply"; a fresh chat ranks "Continue: /cortex-resume · 13 h ago" (naming the chat it came from) above tool tips.
- **Timeline:** handoff tiles name the chat they came from (Claude Code's own chat title, saved while the Stop hook reads the transcript, else read from the transcript's last 64 KB); one tile open at a time; the Activity chart no longer reloads (blinks) on every click: its right edge moves in 10-minute steps and the drawing is reused; the pane returns its previous tree when nothing it shows changed (scrolling); identical handoffs from two chats within 15 minutes are one row (×2).
- **Handoffs carry across chats.** A chat that starts with `/cortex-resume` records which chat it continues and carries its goal, standing instructions, decisions and milestones (commits, fixed checks, with files). A slash command's arguments are now kept as your words (they were dropped, so a long brief given as `/cortex-resume <brief>` was lost). "Goal: …" said explicitly wins. "Next:" is found mid-paragraph. A turn's outcome falls back to the reply's first real sentence (never a "Next:" one). Last check falls back to the newest check in the journal, marked "in an earlier chat".
- **Dream:** a contradiction ("`npm test` is broken" vs "run `npm test`") is no longer called a duplicate, a line already flagged isn't reported twice, and a copy must be contained or share 80% of all words ("Log X before merging" is not "Prefer X before merging").
- **`scripts/benchmark.ts`** (25 turns, 2 chats, real hooks, 3 rounds × 50 runs): Dream 6/6 planted found, 0 false positives among 204 valid rules; Apply + Undo byte-identical; handoff answers 10/10 (deterministic) and a zero-memory Sonnet agent answered 10/10 from STATE.md alone ([bench/goldfish.md](bench/goldfish.md)); Stop p50 46 / p95 51–53 ms, 60 MB; SessionStart p95 30–32 ms; Quick check gate 0.1 ms, run p95 94–99 ms. Before the fixes above the same run scored Dream precision 3% and handoff 6/10.
- **Taste pass and three blind judges.** Every page checked at 70/120/160 columns, dark and light: measured system-font widths for SVG text (the strip's dot sat 2 px from one word and 7 from the next), mascots and intro drawings kept beside their words, captions drop whole facts instead of "…", metric labels wrap, Collapse stays right-aligned, the expanded turn's red "24/25" fixed, Savings no longer claims Cortex adds 0 tokens. Opus, Sonnet and Fable judges (screenshots only) scored medians 5–6 for ease and craft and 4 for plain language; all three named jargon and naming as the weakest area. Fixed here: one name and colour for "handoff ready", plain labels, costs on the Dream buttons, Costs leads with your plan and drops Cortex's own speed to the bottom, no "proposed" with 0 findings, no insider Goldfish/egm note, no unsourced "1 in 10" claim, 1061M reads 1.06B. Not done yet (next): one verdict and one primary action per page, fewer equal-weight cards, toggles for on/off settings.
- **Real-machine hook time:** the Costs page showed p95 146 ms. A clone of this repo with today's 12 MB transcript measures p50 52 / p95 67 ms; the slow samples come from load when a reply ends, not from Cortex's work.
- Rules: `.claude/rules/panel-design.md` (anti-slop checklist, static-first loop, fresh-eyes judges), `.claude/rules/engineering.md` (judge with evidence the author didn't produce; verified model prices and routing). The `cook` skill is installed for long visual loops. 33 core tests, 23 panel tests.
