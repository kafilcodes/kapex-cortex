<div align="center">

<img src="docs/brand/kapex-cortex-logo-512.png" width="112" alt="Kapex Cortex mark: a twisted hexagonal prism, emerald and silver facets around an open core">

# Kapex Cortex

**Keep Claude Code's memory true, switch chats without losing your place, and see what every message costs.**

A local add-on for **Claude Code** (CLI and Desktop) with an **OpenCode** fallback. It works *with* Claude Code's own memory, never beside it.

![version](https://img.shields.io/badge/version-3.5.3-10B981)
![license](https://img.shields.io/badge/license-MIT-10B981)
![deps](https://img.shields.io/badge/runtime%20deps-0-8b949e)
![tokens added per message](https://img.shields.io/badge/tokens%20added%20per%20message-0-10B981)

</div>

---

## In 10 seconds

Claude Code already remembers: `CLAUDE.md`, rule files in `.claude/rules/`, and its own **auto memory** (`MEMORY.md`, where Claude writes notes as it works). Three things it doesn't do, and Cortex does:

| | What Cortex adds | Why it matters |
|---|---|---|
| **Dream** | Checks those memory files against what really happened (your chats, test runs, git) and proposes fixes you can Apply and Undo | One wrong note ("`npm test` is broken") is trusted by every future chat. Anthropic calls this the Mount Moon problem |
| **Lossless handoff** | After every reply, in three parts: what's pinned for the session (its goal, your standing instructions in your words, decisions), the trail of earlier turns, and the last exchanges word for word. At 80% full (70% with a cold cache) it offers a fresh chat; `/cortex-resume` picks it up there (or in OpenCode, after a usage limit) | A cold cache at 70% context costs a full re-read; a new chat costs about 2k–7k tokens and keeps the plan, even when the last turns were small |
| **Status strip and panel** | Context, cache countdown, 5-hour plan, handoff state in one line above the prompt; a panel with what each MCP server and skill costs per message (turn off the unused ones), and the tokens this project used | Claude Code Desktop doesn't show the cache timer, what each tool costs per message, or per-project use |

Cortex adds **0 tokens** to your messages. It has no MCP server and no memory store of its own.

## Dream: memory that stays true

Anthropic's agent-memory study (Nov 2026) found that less, verified memory wins. Notes saved in the heat of a turn go stale or wrong, and a "dream" pass checks notes against the transcripts and fixes them. Claude Code has no local dreaming. Cortex's Dream does it on your machine:

1. **Reads** your project's `CLAUDE.md`, `.claude/rules/*.md` and Claude's auto memory (your own `~/.claude` files too, read-only).
2. **Extracts evidence by program**, not by model, from your last 10 Claude Code chats and git: each test or check run and whether it passed, your own words, when Claude wrote each note, recent commits.
3. **Checks what a program can prove:**
   - a file over Claude Code's limits (auto memory loads only its first 200 lines)
   - index links to missing files
   - files and colours a note names that no longer exist
   - claims a real run contradicts
   - duplicates
4. **Optionally asks a model** (Sonnet on your plan by default, or OpenCode, your own API key, or none) for what needs judgment:
   - stale notes
   - contradictions
   - notes that only repeat what the repo shows
   - notes that apply only to some folders: moved into `.claude/rules/<topic>.md` with `paths:`, so they cost nothing until Claude touches those files
   - verified lessons, each saved with how we know
5. **Checks every model claim:**
   - it must cite real evidence about the same thing
   - its rewrites and lessons can't carry commands, links or secrets
   - it must be at least 70% sure
   - refused claims are listed, with the reason
6. **Proposes, never writes.** Each finding has its own buttons: Apply or Keep for a proposed change; Remove line, Ask Claude or Keep for a note that's yours to decide; Undo on every decision, and Apply all / Undo this Dream. Every decision rebuilds the files from the copy taken at Dream time, so one at a time is as exact as all at once, and it's refused if a file changed meanwhile. Keep is remembered, so the same note isn't flagged again until it changes. Each Dream keeps its before and after copies in `.vault/dreams/`.

**Quick check after every turn.** The program-only checks run in the background whenever a memory file or the code changed (the turn itself only compares file times, about 1 ms), so a stale path or an over-limit file shows up right away, with the same buttons. No model, no tokens; it can be switched off in Settings.

A Dream with Sonnet on this repository took about 5 seconds; the program-only check takes 0.2 s and no tokens.

## Lossless handoff

After every reply Cortex rewrites `.vault/STATE.md`, in three parts, from what it already stored (no model, 0 tokens):

1. **Pinned for this session:** the request it started with, your standing instructions in your own words ("never…", "don't…", "instead…"), the decisions `/cortex-handoff` recorded, and memory notes a check flagged but nobody fixed (the new chat is told not to rely on them).
2. **Session trail:** one line per earlier turn (what you asked → what got done) and the session's commits.
3. **Where we left off:** the last three exchanges word for word (a plan in the last reply survives whole), the files edited, the last check, open items, and a git snapshot at handoff moments.

Each part has its own share of the budget, so a run of small final turns (a CI fix, git commands) can't push the session's purpose out. At 80% full, or 70% when the cache has cooled, Overview asks whether to continue in a fresh chat: Yes checks the flagged memory first, saves the handoff and copies `/cortex-resume`; open a new chat and paste it. When Claude hits a usage limit, the handoff is stamped ready and you get a notification: open OpenCode (free models work) and type `/cortex-resume` there. When that OpenCode session goes idle, the handoff is written back for Claude Code.

## The panel and the strip

**Strip** (above the prompt, one line):
- context ring, cache countdown, 5-hour plan
- one tip that matters now: a cold cache on a big chat, the cache about to cool, near compaction, plan nearly used, tools you never use
- ⟳ to refresh, and **Open Cortex** with the count of Dream changes waiting

**Panel** (`/kc`, or ask Claude to open it):
- **Overview:** the context gauge, plan/cache/handoff, the last turn, ready-to-switch, the memory Claude loads, savings, what every message carries.
- **Timeline:** a swimlane of turns, commits, handoffs and Dreams, then every event as a tile that opens for details.
- **Dream & Memory:** Dream (run, findings with evidence and their buttons), Memory files (what loads every session, what it costs, and memory health: line budgets, scoped rules, flagged notes, clean checks), Handoff, Costs (what loads into every message, each MCP server and skill with Park, the tokens this project used today / this week / all kept, and what Cortex measurably saved).
- **Settings:** the Dream model, how many chats it reads, Dream by itself (off by default), Quick check after every turn (on), when to offer a fresh chat (80%), parking unused MCP servers (on), handoff size, greeting.

It follows Claude Code's light or dark mode.

## Get started

You need [Node.js 23.6+](https://nodejs.org). In Claude Code:

```
/plugin marketplace add kafilcodes/kapex-cortex
/plugin install kapex-cortex@kapex-cortex
```

Open a new chat in your project, press **Open Cortex** above the prompt (or type `/kc`), and press **Turn on Cortex** once. Upgrading from v2 is automatic. Cortex v3 archives your old Cortex memories word for word in `.vault/archive/memories-v2.md` and removes the files it generated (its rules file, its blocks in `AGENTS.md`, the permission denies it added). It never touches your own text. Copy what you still want into `CLAUDE.md`, or run a Dream.

| Command | Does |
|---|---|
| `kc d` | Dream in the background · `kc d run` now (`--no-model` for program checks only) |
| `kc d show` · `kc d apply <id>` · `kc d undo <id>` · `kc d discard <id>` | Review and act on a Dream |
| `kc d decide <id> <finding\|all> apply\|remove\|keep\|undo` · `kc d quick` | One finding at a time · the background Quick check |
| `kc park` · `kc park add <server>` · `kc park remove <server>` | MCP servers parked here (names as `/mcp` shows them) |
| `kc m` | Claude Code's memory files: what loads every session, and what it costs |
| `kc h` · `kc r` | Save a handoff now · show it |
| `kc s` | Status card |

## Safety

| Guard | Means |
|---|---|
| Proposes, never writes | Nothing changes until you Apply; Apply is all or nothing; Undo restores every byte |
| Evidence by program | A Dream's proof comes from Cortex reading transcripts and git, not from a model's wording |
| Untrusted model | Claims need cited evidence and 70% confidence; rewrites can't carry commands, links or secrets |
| Your files stay yours | `~/.claude` and parent-folder files are only read; v2 migration keeps all your own text |
| Secret scrubber | Keys, tokens and passwords are redacted before anything is saved |
| Never breaks your tool | Every hook exits cleanly (the Stop hook's p95 is about 65 ms); errors go to `.vault/private/errors.log` |
| Claude Code's own switches | Parking a server writes the same per-project `disabledMcpServers` list `/mcp` writes, keeps the file's other settings and permissions, takes effect in the next chat (the current chat's cache stays intact), and is one press to undo |

## Honest limits

- **Dream quality is measured on planted bugs, not yet on months of real use.** The test suite plants a false, a stale and a duplicate note and checks that a Dream finds all three, fixes them and undoes exactly. On this repository's real memory, a Sonnet Dream proposed nothing it was sure of; the program flagged two out-of-date colours.
- **The model is optional, and the program checks are narrow by design.** Without a model, a Dream finds only what it can prove: limits, broken links, missing files and colours, claims real runs contradict, duplicates.
- **Parking covers MCP servers, not every skill.** Skills that come with plugins Claude Desktop installs from its catalog aren't Claude Code plugin files; turn those off with /plugin or in Desktop's Customize. Some of the Claude app's own servers stay on whatever the setting says; the panel tells you when a parked server still loads.
- **"Saved" means measured:** context a resumed chat didn't re-read on its first message, context a message no longer carries because of parked servers. Cache reads are counted as re-reads at about a tenth of the price, never as full-price savings.
- **Claude Code transcripts are kept 30 days by default** (`cleanupPeriodDays`), so a Dream sees at most that far back.
- The handoff benchmark (a new chat knew 11–12 of 12 rules with Cortex, 0 without) ran on OpenCode in v1, before Claude Code's auto memory was compared. That comparison hasn't been run.
- Tested by hand on macOS with Claude Code 2.1.31x. Linux and Windows pass the test suite in CI.

## Other tools

Cortex is built for Claude Code first. What carries over, and how each tool reads its instructions:

| Tool | Reads | With Cortex |
|---|---|---|
| **Claude Code** | `CLAUDE.md` (and `AGENTS.md` when there's no `CLAUDE.md`), `.claude/rules/`, auto memory | Everything above |
| **OpenCode** | `AGENTS.md`, else `CLAUDE.md`; globally `~/.config/opencode/AGENTS.md`, else `~/.claude/CLAUDE.md`; skills in `~/.claude/skills` | A plugin that writes the handoff when a session goes idle, and `/cortex-resume`, which works on the free models. `kc setup` keeps Cortex's skills in `~/.claude/skills` current |
| **OpenAI Codex CLI** | `AGENTS.md` (global `~/.codex/AGENTS.md`, then each folder down to where you work) | No integration yet. The handoff is plain Markdown: ask it to read `.vault/STATE.md` |
| **Cursor** | `AGENTS.md` and `.cursor/rules/` | No integration yet; same as Codex |

To share one set of instructions, keep them in `CLAUDE.md` and make `AGENTS.md` a pointer to it (or the reverse); Cortex's Dream checks whichever Claude Code loads.

## Built with

TypeScript run directly by Node ≥ 23.6 · a Claude Code mod for the panel and strip. **Zero runtime dependencies.**
[`BUILD-LOG.md`](BUILD-LOG.md): what broke and how it was fixed.

MIT © Mohd. Kafil Khan
