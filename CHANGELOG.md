# Changelog

All notable changes to Kapex Cortex. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Numbers are measured on an Apple M4 (macOS, Node 26) with `node scripts/benchmark.ts` unless marked otherwise.

## [4.6.0] - 2026-11-28

Positioning and precision: Cortex says plainly what it adds to Claude Code's own memory, and its handoff keeps only what you really said.

### Changed
- **AMOLED black is the default dark theme** (Settings → Look; light and dark still follow the app). A ground you saved earlier is kept.
- **The strip leaves the 5-hour and weekly plan to Claude Code**, whose prompt box now shows both; the amber "5h plan 70%" tip is gone too. Cortex still speaks up at 90%, with a move (hand off and continue in OpenCode). The Overview and Costs pages keep the plan cards.
- **Dream is now the Memory check.** A *quick check* (no model, no tokens) and a *full check* (reads your recent chats, asks a model) everywhere you read it: panel, strip, notifications, CLI, docs. `kc c` and `kc check` are new; `kc d`, `kc dream`, the pref keys and `.vault/dreams/` are unchanged.
- **README: how Cortex differs** from auto memory and `/doctor prompt-audit`.
- **Overview names the real memory limit**: auto memory past 200 lines or 25 KB is cut silently by Claude Code; a long `CLAUDE.md` loads whole but is followed less well. It used to say "first 200 lines" for both.
- **Contour is the default backdrop**, and no icon sits in a circle (both from v4.10, as decided then).

### Added
- **Mission steps, ticked against your tests.** A numbered list in your own message (typed or pasted; never a reply you quote) becomes the mission's steps, word for word, carried through every handoff. Claude ticks a step with `kc mission done <n>` when it is finished; Cortex calls a tick *verified* only while the newest check run at or after it passed, says *check failing* when a later one fails, and *not verified* when none ran. You can tick, untick or drop any step on the Handoff page; the mission never closes by itself: when every step is done, one press closes it. `kc mission` lists them (`add`, `drop`, `open`, `close`, `reopen`). Ticks live in `.vault/private/mission-marks.jsonl`, keyed by mission, so a contract rebuilt from the transcript keeps them.
- **Claude's own "Step 2 is done" ticks the step**, so a first chat (which has never seen the tick command) still checks off what it finished. Strict: the sentence must start with the step and say it is done; "once step 2 is done", "step 3 is not finished" and questions never count; one reply ticks once, even if you untick it later.
- **Ticks name their mission** (`--mission <id>`, given in STATE.md's Steps line and by every panel press), so two chats or worktrees never tick each other's steps; STATE.md spells the exact command that works from the chat's shell (an older `kc` on the PATH has no `mission`), and OpenCode's `/cortex-resume` explains the steps too. Found by an end-to-end run Claude Code → OpenCode → Claude Code.
- **The Mission card** on the Handoff page (Stageshow pass): one progress ring, the north star as the title, what's left first, finished steps folded with their proof, your rules folded into one line.
- **Rules keep their reason.** The sentence right after a rule that says why ("Never run docker here. It eats the 16 GB.") rides with it into the mission contract (`— why: …`), so a later chat or another model knows what the guardrail protects.
- **Load-bearing notes are never offered for removal.** Neither Cortex's own checks nor the model's judgment offer to delete or rewrite a rule, a note under a "Tried and failed"-style heading, or a note that is mostly your current task's own rules; they show it instead. A duplicate copy can still go, since the other copy keeps the guardrail.
- **Full-check judge** (from v4.10): Claude on your plan (Haiku, Sonnet or Opus, with a thinking level) or your own key; when your key fails, Claude judges instead and the report says why.
- **Carry on in OpenCode** card on the Handoff page (from v4.10), with OpenCode found on Windows too (`opencode.exe`, npm's `.cmd`).

### Fixed
- **The strip no longer suggests a handoff you just made.** After Hand off it says "Handoff saved · paste /cortex-resume in a new chat" with Copy again, until a reply in this chat; the Overview's mascot calms down too.
- **The header chip clears itself** and says what changed ("Dark mode: AMOLED black", "Suggest a fresh chat at: 70% full", "Handoff saved"), never a bare "Saved" that stayed up for good; a failure says so and stays 15 s; a chip whose timer died with a plugin reload stops showing anyway.
- **The 5-hour plan's "now" marker is labelled and keeps up.** Clock times sit on the hour boundaries (start … reset) instead of under each block, where the current block's start time in emerald read as "the time now"; the marker says "now" and moves in 10-minute steps even while the chat sits idle with a cold cache.
- **The intro's Undo drawing** is the usual undo arrow, drawn whole inside its frame (its arc ran past the edge and was clipped).
- **Copy again** shows a chip in the strip too.
- **The memory check never calls a runtime or main-checkout path stale.** A path counts as gone only when it is missing from every checkout of the repo (a worktree's notes often name files in the main checkout), and files a program makes as it runs (`.vault/private/`, `*.log`, `*.jsonl`, `*.lock`, `*.pid`) never count: an `errors.log` that doesn't exist until the first error once got a hard-limit rule offered for removal.
- **Open items** in the Handoff preview count only the packet's open items, never the mission's steps.
- **`package.json`** says memory check, not Dreams.
- **README: no "0 tokens added" badge.** Cortex injects nothing into your prompts, but its panel tool's name costs about 85 tokens a message (measured); the badge and intro now say exactly that.
- **A `!command`'s output is never a rejection.** Git printing `! [rejected]` after a push you typed no longer lands under *Rejected* in the contract.
- **An earlier reply quoted inline** (`…for context: {` … `}`) is quoted text, not your standing instructions.
- **Pleas and cut-off dictation never bind**: "don't make mistakes" or a sentence that stops at "and." or "the." is no longer a never-rule taking a slot from a real one ("…unless I say so." and "…until I tell you to." stay rules). Contracts inherited from older chats shed these once; every other pin is carried as it was.
- **An inline quote ends where it really ends**: a `}` inside the quoted reply's own code block no longer closes it early, and Windows line endings quote too.
- **Your own key's model survives split settings**: switching to your key in one settings file while the model name sits in the other no longer resets it to Sonnet.
- **OpenCode installed through npm on Windows** (`opencode.cmd`) reports its version, so set-up picks the right command folder.
- **Set-up never removes your own OpenCode command**: only a file whose front matter names Kapex Cortex.

Measured: 138 core + 166 panel tests; memory check 6/6 with 0 false positives; handoff 10/10 (~1.1k tokens); telephone 13/13 probes, 7/7 facts (v4.0.0: 3/7); Stop hook p95 55.6–58.4 ms on a quiet machine (main: 56.9–57.4), and per turn across the 5-chat script, main vs v4.6 interleaved: p50 73.9 vs 72.0 ms, p95 93.3 vs 84.6 ms.

## [4.5.2] - 2026-11-25

Handoff reliability: nothing in the contract or the handoff note is lost or contradicted without saying so.

### Fixed
- **`kc handoff` never cuts silently.** A goal past the north star's 600 characters, a decision past 300 and more than 8 decisions each print a note on stderr saying what is kept (the newest 8 decisions).
- **`kc handoff --next` on its own keeps the note's goal and decisions.** Each field you leave out keeps what that chat's note already had, and new decisions are added to the old ones; a note saved for another chat still starts fresh.
- **Superseded decisions are tracked, not carried forward.** A pin that confines work to one place ("work only … on main") gives way to a newer goal or decision naming a different branch or worktree, and an older decision gives way to a newer one that clearly updates it. Replaced decisions are listed in the packet under **Superseded** as no longer binding; the user's own rules are never dropped, only flagged with ⚠ for the chat to ask. "Newer" is judged by chat first, then time, so a rebuilt parent's timestamps can't protect a stale pin.
- **Cross-OS test stability.** The handoff-history merge test gave its three snapshots distinct modification times: files written in the same instant could tie on Windows CI and sort apart, which failed it once.

Measured: 92 core + 139 panel tests; Dream 6/6 with 0 false positives; handoff 10/10 (~1.1k tokens); 5-hop telephone 13/13; Stop hook p50 40 ms, p95 55.6 ms.

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
