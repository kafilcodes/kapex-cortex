# Drafts: features kept out of the launch

Launch scope (Kafil, 2026-11-18): **the Claude Code plugin, plus your own API key for full memory checks.** The one other tool
Cortex supports is **OpenCode, for the handoff only**: when Claude's usage limit is reached, `/cortex-resume` there
reads the same `.vault/STATE.md`, and when an OpenCode 2 session ends a turn the plugin saves the handoff back.

Everything below was built or designed, then taken out of production for the launch. Nothing here is deleted from
history: each entry names the last commit that had it, so it can come back as its own change.

## OpenCode as a Dream judge (removed in v4.10)

- What it did: `backends.ts` ran `opencode run -m <provider/model> --format json "<system>\n\n<message>"` and joined
  the `text` events of its JSON-lines output into the answer. Settings offered "An OpenCode model (free models cost
  nothing)" with a `provider/model` field.
- Why it went: the launch's Dream judges are Claude on your plan and your own key. OpenCode's free models were slow
  and inconsistent at the JSON shape a Dream needs, and every answer still had to pass the same checks.
- What happens to a saved choice: `dreamBackend: "opencode"` now reads as `claude` (Sonnet), and its
  `provider/model` name is dropped.
- To bring it back: restore `viaOpencode` and the `opencode` backend from `8f3a20f^` (v4.9), add it to
  `DREAM_BACKENDS`, and let `judge()` fall back to Claude for it as it does for your key.

## OpenCode plugin: blocked commands and the read guard (kept, inactive)

- What it does: the generated `.opencode/plugins/kapex-cortex.ts` hooks `execute.before` to refuse shell commands
  and paths listed in `.vault/enforce.json` (v2's checkable rules from INVARIANTS.md), and, when `readGuard` is on,
  refuses the first whole read of a text file over 40 KB with a hint to read part of it.
- Status: nothing has written `.vault/enforce.json` since v3, so the block doesn't fire today. v4.10 removed it;
  v4.6.0 keeps it (no existing feature is taken out for the launch), so it can come back with a writer and a switch.

## Hermes and other tools

- SPEC.md (2026-11-07) planned one vault shared with Hermes, and an MCP server for every harness. Neither shipped
  in v3 or v4; the only trace left is the word "Hermes" as the name of a tool a handoff can come from, so an old
  packet still reads right.
- SPEC §6.2 and §6.4 describe that pre-launch scope; this file is where the launch differs.

## Not started, worth doing after the launch

- An OpenCode 1.x hand-back: 1.x loads plugins as named exports, which OpenCode 2 refuses (see CLAUDE.md, tried and
  failed). A second, 1.x-only file would need its own loader test. Until then the card and `/cortex-resume` tell
  OpenCode 1.x users to run `/cortex-handoff` before they stop.
