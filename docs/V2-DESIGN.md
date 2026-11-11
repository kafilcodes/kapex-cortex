# Kapex Cortex v2 — design

Written 8 Nov 2026 after Kafil's v1.7 review. What's **built** (v1.8.0) is marked so; the rest is the plan, ordered by value.
Claims are labelled: **verified** (test or real use), **vendor** (someone else's numbers), **estimate** (mine, unmeasured).

---

## 0. The one-paragraph version

Cortex today is a good memory *core* (append-only ledger, handoff packet, compaction audit) with a narrow *front door* (per-project hooks, Mac/Linux, engineer-style setup). v2 keeps the core and fixes the front door: **ship everything as one Claude Code plugin** (hooks + MCP + skills + panel + a bundled CLI), so `/plugin install` is the whole setup, it runs in every chat, and it works on Windows. On top of that: a smarter rule judge (built), a layered context pack instead of a bigger handoff, user profiles with token modes, and a few proven token savers borrowed from the ecosystem.

---

## 1. Smarter rules — BUILT in v1.8.0

**Problem:** every guessed rule waited for approval (noisy), and text from another AI session or a paste could still be pinned with "rule:".

**What it does now** (`src/core/judge.ts`, deterministic, ~0.1 ms per sentence, no dependency):

| Who wrote it | Clear rule (score ≥ 3) | Doubtful (1–2) | Weak (≤ 0) |
|---|---|---|---|
| **You** (typed in chat) | added automatically | asked | dropped |
| **Pasted** text | asked | dropped | dropped |
| **Another AI session's brief** | asked | dropped | dropped |
| **Harness output** (slash commands, hook feedback, status cards) | never | never | never |

- Score = rule word (+1) · lasting wording like "always / never / from now on / in this project" (+2) · instruction form (+1) · specific (a file, a command, backticks) (+1) · question (−3) · unsure wording (−2) · a story ("I watched…") (−2) · numbered item of a long message (−2) · half a sentence (−5).
- **Newest wins:** if a new rule contradicts an active one (shared topic + flipped negation or "instead of / no longer / switch to"), it supersedes it. If the overlap is unclear, it's asked instead of guessed.
- Each record now stores `source` and `note` (why), shown in the panel with the date. "Retire" is now **Delete**.
- Defense in depth: brief/pasted records carry a non-user origin, so the ledger's old taint guard also forces them to pending.
- Tests: `test/v17.test.ts` uses the three real junk rules from 8 Nov.

**Why not the alternatives (for now):**

| Approach | Latency | Cost | Privacy | Dependencies | Accuracy on this task | Verdict |
|---|---|---|---|---|---|---|
| **Rule-based judge (built)** | ~0.1 ms | 0 | local | 0 | good on clear cases; explainable | default |
| `compromise` (JS NLP) | ~1–5 ms | 0 | local | +1 runtime dep (breaks a project rule) | better sentence/POS splitting, same judgement problem | only if splitting proves to be the weak spot |
| Jev (TypeSafe, hosted decision model) | network round trip per call (vendor: fast) | paid per call | sends your words to a third party | API key + network | strong on fuzzy calls (vendor); can still be confidently wrong | optional opt-in for **ambiguous** cases only, later |
| Ask the harness model (one line in the Stop instruction) | 0 extra calls | a few tokens of your plan per ask | local to your session | 0 | very good: it has the whole conversation | use for the "asked" cases: it already writes the question |
| Embeddings / vector match | ms + model load | RAM (16 GB Mac) | local | heavy | good for duplicates, weak for intent | no |

**Next:** "seen in 2+ sessions" boost (TokenEconomizer's evidence rule), and a weekly "rules you haven't needed" review.

---

## 2. Handoff → a layered context pack

**What's true today (verified by reading the code):**
- The handoff packet holds goal, next, verify, rule counts, working tree, last failure, last user and assistant message (8,000-char cap).
- **Goal and next go stale.** They only change when someone runs `/cortex-handoff`.
- **Claude's compaction summaries are not stored.** PostCompact reads `compact_summary` only to audit it, then throws it away.
- Your exact words are stored (`private/turns.jsonl`) and re-added after a compaction, within a 9,500-char budget.

**Principle:** don't make the packet bigger. Every token injected into a fresh chat is a token it can't use for work. Instead, split context into layers by *how often it's needed*:

| Layer | Contents | Injected when | Budget |
|---|---|---|---|
| **L0 Rules** | active rules, failed approaches | always (rules file) | ≤ 1,500 tokens |
| **L1 Brief** | goal, next, verify, decisions made this session, open questions, files touched, last failure | new chat / resume / after compaction | ≤ 800 tokens |
| **L2 Recall** | previous compaction summaries, older sessions, all your words, decision log | **only when asked**, via MCP `search` / new `history` tool | 0 until used |

Changes:
1. **Store compaction summaries** in `private/summaries.jsonl` (one line per compaction). Searchable through MCP, never auto-injected.
2. **Fresh goal/next without a model:** goal = your first substantial request of the session (or the last explicit "now do X"); next = a `Next:` line in the assistant's last message if present; mark the pair **stale** once its verify command passes or after N turns on other files.
3. **Decisions this session:** collect "decision:" pins and approved rules from this session into L1, not just counts.
4. **Files touched:** from the git snapshot diff, top 10 paths.
5. Make `/cortex-resume` read L1 first and use L2 only on demand (one MCP call, not a file dump).

**Still unverified in real use** (tests only): re-adding rules after a real compaction, the compaction audit, OpenCode resume after a real rate limit. Plan: one scripted long session per release (the `bench/` folder), measured with and without Cortex.

---

## 3. One plugin, every OS, one-click install

**Today:** clone the repo, run `bin/cortex start .`, then `kc i` in every project. Mac/Linux only: `/bin/sh` launchers, `/bin/sh` in the panel, macOS notifications. Hooks live in each project's `.claude/settings.local.json`, so chats outside a Cortex folder capture nothing.

**Target:** `/plugin install kapex-cortex` is the whole setup, on macOS, Windows and Linux.

1. **Ship hooks, MCP server, skills and panel inside the plugin.** Claude Code plugins can carry `hooks/hooks.json` (command hooks), an MCP server and skills, with `${CLAUDE_PLUGIN_ROOT}` for paths. Hooks then run in **every** chat. A chat without a `.vault/` gets a one-button "Turn on memory here" in the panel, or uses a per-user vault for loose chats.
2. **No `/bin/sh` anywhere.** The panel calls `node <plugin>/src/cli.ts` directly via `$.process.run([node, cli, …])`. Hook commands are a single quoted `node` invocation, which bash, cmd and PowerShell all run the same way. Windows hooks run under Git Bash or cmd depending on the machine (reported in Claude Code issues), so avoid any shell syntax.
3. **Node without asking users to install Node:**
   - Don't assume Node is installed: the native Claude Code installer doesn't need it, so many users won't have it.
   - **Node single-executable app (SEA):** bundle `cli.ts` into one `cortex` / `cortex.exe` per OS, attached to GitHub Releases. The plugin downloads the right one on first run, checks its sha256, stores it under the plugin's data folder. No Node, no npm, no PATH edits.
   - Fallback when a modern Node is already on PATH: use it.
4. **Windows specifics:** `kc.cmd` launcher, toast notifications via PowerShell (or none), paths through `node:path` only, no `brctl`/iCloud helpers.
5. **Vault setup:** `.vault/` is the main store. Obsidian is optional: a panel toggle "Mirror to Obsidian" finds the open vault by itself, two-way sync off by default.
6. **For non-technical users:** a Setup tab in the panel (the engine has `Select` and `Input` elements). Pick profile → pick vault (optional) → done. No terminal.

Estimate: steps 1–2 are 1 day; SEA builds plus release CI are 1–2 days; Windows testing needs a Windows machine or a GitHub Actions `windows-latest` runner (free for public repos; private repos use the plan's free minutes, where Windows minutes count extra).

---

## 4. Profiles, preferences, token modes

One settings file (`~/.cortex/config.json`, per-project overrides in `.vault/config.json`) edited from a **Settings tab** in the panel.

| Profile | What it captures as rules | What it re-adds | Suggested skills |
|---|---|---|---|
| Coder | commands, files, tools, tests, "never touch X" | rules + failed approaches + verify | code review, simplify |
| Designer | brand, colours, fonts, "never use X look", references | rules + taste notes | anti-slop design kits, UI-library picker |
| Writer / blogger | voice, tone, banned words, audience, formats | rules + style sheet | doc generation, editing |
| Creator | channels, formats, posting rules, assets | rules + brand kit | motion/graphics guides |

**Token modes:** *Lean* (rules only, short packet, aggressive tool trimming), *Balanced* (default), *Rich* (more of your words re-added after compaction). Each mode sets the L0/L1 budgets above and which optional savers are on. The panel shows tokens injected by Cortex per chat, so the cost is visible.

---

## 5. What to borrow from the ecosystem

From research on 8 Nov 2026 (most savings figures are **vendor** claims, measured on different tasks, so not comparable):

| Idea | Who does it | Token source | Borrow? |
|---|---|---|---|
| Learn repo facts from repeated evidence (3 confirmations, drop when contradicted) | TokenEconomizer micro-skills | wasted retries | **Yes**: rules/failed approaches get an evidence count. Ours needs no model calls. |
| Prune unused tools / MCP servers (each schema is sent on every request) | TokenEconomizer | tool definitions | **Yes**: panel shows unused MCP servers over the last N sessions, with a one-click "turn off here". |
| Nudge a stuck turn (judge model, ≥ 0.7 confidence, once per turn) | TokenEconomizer | failure loops | **Partly**: deterministic version. The same failing command 3× in a turn → add the matching graveyard entry as context. |
| Block huge file reads, point to a cheaper path | Spotify shunt (PreToolUse on Read) | input reads | Yes, as an opt-in in Lean mode. |
| Rewrite noisy shell commands / trim output | RTK, context-mode | tool output | Opt-in only. Two compressors on one request fight over the same tokens, so don't stack with Headroom-style proxies. |
| Shorter answers | Caveman (output style) | output tokens | No: changes the model's voice. Leave to the user. |
| Symbol-level code lookup | Serena, Codebase Memory | input reads | Recommend, don't rebuild. |
| Measure first | ccusage, claude-hud | n/a | Yes: the panel already has Claude Code's own usage. Add "tokens Cortex added". |

**TokenEconomizer in short** (read from its README, 8 Nov 2026): a plugin for Claude Code, Codex, Copilot CLI and others. Python stdlib core, Apache-2.0. Three mechanisms: learned micro-skills (off by default because they need model calls), tool pruning, and a failure-loop judge. Reported **18.4–30.9% lower mean cost** on 277 SWE-Bench tasks, with pass@1 up in 4 of 5 combinations (**vendor**). It does **not** compress prompts or trim output. Our edge: zero model calls by default, the same ledger used for rules, cross-tool handoff, and a visible panel.

---

## 6. The panel UI

- The panel is drawn by Claude Code from its own elements (Box, Text, Button, Input, Select, Svg, Markdown, Client). There is no browser DOM, React or CSS inside, so shadcn, Radix, Sonner, Vaul, cmdk, NumberFlow, Magic UI and similar libraries **cannot run there**. They're the right choice for the kapex.ai site and for artifact pages.
- The desktop surface has no Image element. The logo is an SVG in `claude-plugin/hooks/logo.ts`, built to be swapped. A PNG can be embedded inside an SVG wrapper.
- **Fixed in v1.8.0:** blank panel when widened. Card width `32.5%` was refused because only whole-number percentages are allowed. A test now draws the panel at 9 widths on both surfaces.
- **Next UI round, anti-slop pass within those elements:** fewer glyph icons, one accent colour plus semantic colours, numbers that don't shout, tabs → a compact segmented row, consistent 8-px rhythm, a Settings tab and a Setup tab. Checked against the Impeccable / Emil Kowalski rules where they apply to non-web UIs.

---

## 7. Order of work (suggested)

| # | Work | Why first | Size |
|---|---|---|---|
| 1 | ~~One plugin: hooks + MCP + skills inside the plugin, no `/bin/sh`~~ **built in v1.9.0** | runs in every chat; unblocks Windows | done |
| 2 | ~~L1 brief freshness + store compaction summaries~~ **built in v1.10.0** | the handoff stops going stale | done |
| 3 | ~~Settings tab: profile + token mode~~ **built in v1.11.0** | general users | done |
| 4 | ~~SEA binaries + release CI + Windows runner~~ **built in v1.12.0** (download-on-first-run waits for a public repo) | install for non-technical users | done |
| 5 | ~~Evidence counts, tool-pruning report, stuck-loop nudge~~ **built in v1.13.0** | measurable token savings | done |
| 6 | Bench v3: casual once-mentioned rules, 3 compactions (built in v1.14.0; results in bench/results/RESULTS.md) | the number for the case study | running |
| 7 | ~~Panel anti-slop redesign~~ **built in v1.14.0** | polish after the plumbing | done |
