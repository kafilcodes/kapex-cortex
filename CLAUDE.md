# Kapex Cortex: project instructions

Cortex adds what Claude Code doesn't have: a Desktop status strip and cost/cache panel, a lossless handoff between chats (`/cortex-resume`), and Dreams that check Claude Code's own memory (`CLAUDE.md`, `.claude/rules/`, auto memory) against session transcripts, test runs and git. It keeps no memory store of its own.

## Hard limits
- Zero runtime dependencies: Node built-ins only (node:sqlite, node:crypto, node:fs).
- Hooks never break the harness: always exit 0 and log errors to `.vault/private/errors.log`.
- Keep the Stop hook p95 under 150 ms (`npm test` measures it).
- Run `npm run check` (tsc + tests) before every commit.
- Tests never read the real `~/.cortex` or `~/.claude`, and never write to the real Obsidian vault.
- Keep every source file under 300 lines.
- Cortex never writes to the Obsidian vault outside its `machine/` folder.
- A Dream never changes a file until the user presses Apply, and every Apply can be undone.

## Facts
- OpenCode commands use shell includes, not `@file` includes, because `@file` does not expand on the server.

## Tried and failed (do this instead)
- OpenCode 1.x plugin style (named exports, `experimental.session.compacting`) does not load in OpenCode 2.x: use `export default { id, setup }`.
- `async: true` Stop hooks are killed when headless `claude -p` exits: keep Stop work synchronous and under 150 ms.
