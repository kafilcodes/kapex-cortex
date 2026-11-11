---
name: cortex-handoff
description: Record a handoff so another tool or model can continue this work (Kapex Cortex). Use when the user says hand off, save state, I'm about to switch tools, or before a usage limit.
---

1. Decide, in one sentence each: the overall **goal** of the current work, and the concrete **next action** (which file, function or command comes next).
2. Run exactly:

   node "${CLAUDE_PLUGIN_ROOT}/cortex/src/cli.ts" handoff --goal "<goal>" --next "<next action>"

3. Reply with the two sentences and tell the user: "Handoff saved to .vault/STATE.md. In OpenCode, run /cortex-resume."
