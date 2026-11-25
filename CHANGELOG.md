# Changelog

All notable changes to Kapex Cortex. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Numbers are measured on an Apple M4 (macOS, Node 26) with `node scripts/benchmark.ts` unless marked otherwise.

## [4.5.1] - 2026-11-25

The first v4.5 release with binaries: the v4.5.0 tag's Windows CI run failed, so it has no release. Same features as 4.5.0, plus:

### Fixed
- Windows: `CLAUDE.md` files in folders above the project were never found (the "inside your home folder" check assumed `/` in paths).
- Windows: a worktree's main `CLAUDE.md` is recognised as the same file when Windows spells its folder two ways (a long name vs an 8.3 short name like `RUNNER~1`, or a different case), so a Dream never treats it as a duplicate.
- Windows: an absolute git `commondir` (`C:/…`) is read as absolute.

## [4.5.0] - 2026-11-25 (tag only, no release: Windows CI failed)

The engine release: handoffs that survive any number of chats, a strip that is always about the chat you are in, and hooks hardened against what real machines do. Includes the unreleased 4.1.0–4.4.0 panel work.

### Added
- **Mission contract.** The handoff now carries a contract from chat to chat: the north-star goal, your binding rules in your own words (mandatory skills, never/must rules, decisions), the approaches you rejected and why, and the chain's lineage (hop count, origin chat, parent handoff, git head). It is carried as data, never re-read from shortened text, and archived when you say the task is done or start a new one.
- **5-hop telephone benchmark** (`scripts/telephone.ts`, part of `node scripts/benchmark.ts`): five consecutive chats on one task, with adversarial noise turns. Chat 5 keeps 13/13 probes; the v4.0.0 release's handoff kept 3 of the same 7 facts.
- **One vault per repository.** Chats in git worktrees (including Claude Desktop's own `.claude/worktrees/*`) hand off through the main checkout's vault; each worktree's `STATE.md` shows its own newest chat, and the packet names the worktree to work in.
- **0 tokens in normal chats.** The plugin's skills are things you start yourself, so they are marked `disable-model-invocation` and their descriptions stay out of Claude's context (measured with `/context`: about 250 tokens per chat before, 0 after). The handoff is pull-only: the one-line "a handoff exists" note is now opt-in (`kc prefs set startNotice on`).
- Dream: a rule the code has drifted from ("keep files under 300 lines", "**Hooks**: always exit 0") is shown as drift and waits for you, never offered for deletion, whatever the evidence; a fact a command's own run disproves is still fixed. A finding of a kind the schema doesn't allow is rejected.
- `docs/ARCHITECTURE.md` with diagrams; `CHANGELOG.md`, `SECURITY.md`, `CONTRIBUTING.md`, issue and pull-request templates; `llms.txt` for AI assistants.

### Changed
- The panel's status read runs from a pre-built file and reuses git answers until git's own files change: 133 → 64 ms median (190 → 73 ms on a real 400-turn project vault).
- The Stop hook reuses `git status` on turns that edited nothing and parses its journals once: 54.7 → 39 ms median (p95 56.7 ms). The p95 bar is now 60 ms (was 150).
- A chat that only resumed shows the mission's north star as its goal and says where its next step came from.

### Fixed
- A `/clear` or resume left the strip showing the previous chat's context, cache clock and history until the first reply, and stopped the strip's heartbeat for good.
- Under a symlinked folder (macOS `/var`, a linked projects folder) every hook silently did nothing.
- A 50 MB transcript crashed the hook under a 64 MB heap; transcripts are now read in 8 MB slices with base64 images dropped before parsing (peak memory 236 → 178 MB on a real 42 MB transcript).
- A usage-limit or API-error notice ("You've hit your 5-hour limit") could become the handoff's newest reply or a Timeline result.
- Rewinds (a branch to an earlier message, or a transcript that shrank) now drop the abandoned messages from the goal, rules and trail; a shrunk transcript is never counted twice.
- A chat whose turn ended while another held the views lock lost its packet for that turn; a "hi" or a side question in a new tab could replace the real handoff.
- Git edge cases: detached HEAD names its commit, a rebase or merge in progress is called out, repos with no commits and folders with no git hand off cleanly.
- On Windows, an atomic write (and auto-park's write to `~/.claude.json`) retries briefly when another process has the target open; a failed write never leaves a temp file behind; a lock Windows keeps refusing can't spin past its deadline; 8.3 short paths (`C:\PROGRA~1`) resolve to one spelling.
- Secrets are scrubbed from the journal and saved inputs too, and an empty lock file (a hook killed mid-write) goes stale by age instead of freezing `STATE.md`.
- A brief you paste on its own (no typed words around it) now pins its directives; a pasted assistant reply never does. Old packets are read strictly, so their stray lines don't become rules.
- `SECURITY.md` now lists everything Cortex writes, including auto-park's edit to `~/.claude.json` and the opt-in verify gate (the one hook that can send Claude back to work).
- The benchmark's "before" line is pinned to the v4.0.0 release instead of `main`.

## [4.4.0] - 2026-11-17 (not published separately)
- The Timeline loads as you go: Show older 24 at a time, history past the status fetched with no gaps.

## [4.3.0] - 2026-11-17 (not published separately)
- Older Timeline events open with their details; a numbered pager top and bottom.

## [4.2.0] - 2026-11-17 (not published separately)
- Panel buttons never send a prompt by themselves (message box, send now, copy, cancel). Orbit rings and Crystal facets backdrops.

## [4.1.0] - 2026-11-17 (not published separately)
- The Timeline can't blank the pane (one page at a time, a drawing budget and an error catch on every page); graded strip colours.

## [4.0.0] - 2026-11-17
- First official release: Timeline paging, Costs & usage, notifications, Dreams with Apply and Undo, single-file binaries for macOS, Linux and Windows.

[4.5.0]: https://github.com/kafilcodes/kapex-cortex/compare/v4.0.0...v4.5.0
[4.0.0]: https://github.com/kafilcodes/kapex-cortex/releases/tag/v4.0.0
