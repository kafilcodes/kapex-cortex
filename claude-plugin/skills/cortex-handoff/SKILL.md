---
name: cortex-handoff
description: Record a handoff so another tool or model can continue this work (Kapex Cortex). Use when the user says hand off, save state, I'm about to switch tools, or before a usage limit.
---

1. Decide, in one sentence each: the overall **goal** of the current work, and the concrete **next action** (which file, function or command comes next).
2. List the **decisions** of this session a new chat must not undo: choices made, approaches rejected and why, workarounds that were verified. One short sentence each, at most 6, most important first; skip any already written in CLAUDE.md or the rules. Cortex already pins the user's own instructions and the turn-by-turn trail, so don't repeat those.
3. Run exactly (one --decision per decision; leave them out if there are none):

   node "${CLAUDE_PLUGIN_ROOT}/cortex/src/cli.ts" handoff --goal "<goal>" --next "<next action>" --decision "<decision 1>" --decision "<decision 2>"

4. Reply with the goal, the next action and the decisions, and tell the user: "Handoff saved to .vault/STATE.md. In a new chat (or OpenCode), run /cortex-resume."
