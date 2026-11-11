---
name: cortex-init
description: Turn on Kapex Cortex in the current project (status strip and panel, lossless handoffs between chats and to OpenCode, Dreams that check Claude's memory against real sessions). Use when the user asks to enable Cortex.
---

1. Run, from the project root:

   node "${CLAUDE_PLUGIN_ROOT}/cortex/src/cli.ts" init .

2. Show the user the list of changes it printed.
3. Explain in two lines: after every reply Cortex saves a handoff, so a new chat (or OpenCode, after a usage limit) continues with /cortex-resume; /kc opens the panel, where Dream checks CLAUDE.md, .claude/rules and auto memory against what really happened. Hooks take effect in new sessions.
