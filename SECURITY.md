# Security policy

## Supported versions

Only the latest release gets fixes. Update with `/plugin update kapex-cortex@kapex-cortex` (or `claude plugin update`), then `/reload-plugins`.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** button on the [Security tab](https://github.com/kafilcodes/kapex-cortex/security/advisories/new). Don't open a public issue for a security problem. You'll get an answer within 7 days, and a fix or a plan within 30.

## What Cortex does and doesn't touch

Cortex is built to be safe to leave running in every chat. Here is what it reads and writes, including every place outside your project:

- **No network calls of its own.** The hooks, the panel and the CLI never send your code, prompts or transcripts anywhere. The only exception is a full memory check judged by a model you choose: your Claude plan (through Claude Code itself), or your own API key and endpoint, which you set up explicitly.
- **Nothing injected into your chats** by default (0 tokens). It never rewrites, compresses or adds to your prompts.
- **What it writes when you set it up:**
  - **Turn on Cortex** (once per project) creates `.vault/`, adds Cortex's lines to `.gitignore`, adds its hooks to `.claude/settings.local.json` (or removes them when the plugin already runs them), and writes `.opencode/plugins/kapex-cortex.ts` and `.opencode/commands/` for OpenCode.
  - The first `kc start` (machine setup) puts small `kc` and `cortex` launchers in `~/.local/bin` (never over a file that isn't Cortex's), copies the `/cortex-*` skills to `~/.claude/skills` when the plugin isn't installed (and to `~/.config/opencode/skills` when OpenCode is), and removes the `kapex-cortex` MCP server that versions before v3 registered (from Claude Code's user scope and `~/.config/opencode/opencode.json`).
- **What it writes on its own, without a press:**
  - `.vault/` in your project (`.vault/private/` is git-ignored and holds the journal and handoffs) and `~/.cortex/`.
  - **Auto-park (on by default)** edits Claude Code's own config, `~/.claude.json`: it adds MCP servers you haven't used in your last 10 chats here to that project's `disabledMcpServers` list, the same list `/mcp` writes. It never touches the Claude app's own servers, it keeps a record in `.vault/private/parked.json` so Undo only reverses what it parked, and a server you turn back on is never parked again. Switch it off with `kc prefs set autoPark off` or in the panel's Settings.
- **What it writes only when you press Apply:**
  - A **Memory check**, once you press Apply, edits your memory files (`CLAUDE.md`, `.claude/rules/`, Claude's auto memory). It never changes a file until you press Apply, and every Apply can be undone byte for byte.
  - The **safety check** adds Read deny rules for `.env` files, `~/.ssh` and `~/.aws/credentials` to your Claude Code settings, and can install a verify gate (below). Both can be undone.
- **What it reads:** Claude Code's own transcripts and memory files, to build handoffs and memory checks.
- **Secrets are scrubbed** from everything it stores (API keys, tokens, passwords in common formats) before writing.
- **Zero runtime dependencies**: Node.js built-ins only, so there is no third-party code in the plugin to compromise.
- **Cortex's own hooks always exit 0**: they can't block or break a Claude Code session, and errors go to `.vault/private/errors.log`. The one exception is the **verify gate**, which you install yourself from the safety check: it is a separate Stop hook whose whole job is to send Claude back to work when your project's check fails.

Cortex never patches Claude Code, bypasses its permission prompts or changes its safety settings.
