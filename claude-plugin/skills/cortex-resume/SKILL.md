---
name: cortex-resume
description: Continue work that Kapex Cortex handed off from another session, tool or model. Use when the user says resume, continue where I left off, pick up the handoff, or after hitting a usage limit in another tool.
---

1. In the current project, read `.vault/STATE.md`. If it doesn't exist, say so and ask what to continue. (The project's rules are already loaded: CLAUDE.md, .claude/rules and auto memory.)
2. Tell the user in two or three lines what you are picking up: the goal, the next action, the open items, and how old the packet is (its header has the time).
3. **Pinned for this session** holds what the session set out to do, the user's standing instructions in their own words and the decisions recorded at handoff: treat them as binding unless the user changes them. If it lists **memory notes flagged, not fixed yet**, those notes were loaded with your memory but may be wrong: don't rely on them, and tell the user in one line. **Session trail** is what earlier turns did, so don't redo finished work. **Where we left off** holds the last exchanges word for word, oldest first. Treat the newest reply as your own previous message: if it was a plan, a table or a list of findings, you already have it, so don't redo the work. **Active files**, **Last check** and **Open items** say what is in progress. Continue from **Next action** (or the open items). A turn-specific instruction in an earlier user message, such as "don't edit yet", applied to that turn; the user running /cortex-resume is the go-ahead.
4. If the goal is marked as from an earlier session, check `git log -5 --oneline` and the working tree first: it may already be done. Then ask what to continue.
5. Don't read old transcripts or `.vault/private/` files: the packet is what carries over.
6. You are done only when the commands under **Verify** pass. Run them and report the output.
