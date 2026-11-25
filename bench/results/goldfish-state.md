# STATE — invoices · main · updated 2026-11-25T16:23:00.167Z · from claude-code · session bench-chat-b

> Handoff packet written by Kapex Cortex at the end of every turn. The **Mission contract** carries over from chat to chat: its goal, the user's binding rules and rejected approaches hold until the user says the mission is done. Below it, the rolling part: this chat's goal and next step, the trail of earlier turns, and the last exchanges word for word. The project's rules load by themselves (CLAUDE.md, .claude/rules, auto memory): read this, then continue from **Next action**.

## Mission contract (binding across chats until the user says it is done or starts a new task)
<!-- cortex-lineage: handoff=h_01M89R8YYPCRM1XKWK7J5P6KBE parent=h_01M89R8XYN0DQFYAYGKSPXRAQQ parent_session=bench-chat-a hop=2 origin=bench-chat-a head=02261f8967158dd5a9bd7b3aeeebd1c0515cfda4 mission=m_01M89R8XYPEWF2H3BE7THGNAQE status=active -->
**North star:** build the invoice parser CLI with currency support. Read the repo first. _(set in chat 1, 2026-11-25 12:24)_
**Chain:** chat 2 of this task (it began in “Invoice parser”; this chat continues “Invoice parser”). **Where:** branch `main` · head `02261f8967`.
**Binding rules (the user's own words; follow them exactly):**
- [never] “Decision: we store money as integer cents, never floats.” _(chat 1, 2026-11-25 12:31)_
- [must] “Always run npm test before committing.” _(chat 1, 2026-11-25 12:31)_
- [decision] “Keep zero runtime dependencies” _(chat 2, this one, 2026-11-25 16:23)_

## Goal
build the invoice parser CLI with currency support. Read the repo first.

_The mission's north star: this chat has only continued it so far._

## Next action
add CSV export in src/export.ts with a test.

## Verify (done = these pass)
- `npm run test`

## Pinned for this session (kept whatever the last turns were about)
**Started with** (turn 1, 14:58): Docs pass 1: explain the totals in README.

**Continued from “Invoice parser”** (session bench-ch); what it got done:
- Totals are off by one cent on 3-line invoices. Fix it. → Fixed the rounding bug in totals: src/totals.ts summed floats; it now sums integer cents. _(files: src/totals.ts; a failing check fixed)_

**Memory notes flagged, not fixed yet** (Claude Code loaded them anyway: don't rely on them, and mention them to the user):
- `CLAUDE.md` over-cap: 207 lines: Claude follows files under 200 lines better
- `memory/MEMORY.md:1` broken-link: It points to testing.md, which doesn't exist.
- `CLAUDE.md:6` stale: #111315 isn't used anywhere in the project any more.
- `CLAUDE.md:7` stale: `src/legacy/report.ts` no longer exists in the project.
- `memory/MEMORY.md:2` false: It says `npm test` doesn't work, but it ran successfully 2 times.

## Working tree
```
README.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

WIP snapshot: `refs/cortex/wip/bench-chat-b (73e4cf0954)` (restore with `git stash apply <sha>`).

## Last failure
None recorded.

## Session trail (earlier turns, oldest first; the newest are below, word for word)
- T1 14:58 · Docs pass 1: explain the totals in README.
- T2 15:03 · Docs pass 2: explain the totals in README.
- T3 15:08 · Docs pass 3: explain the totals in README.
- T4 15:13 · Docs pass 4: explain the totals in README.
- T5 15:18 · Docs pass 5: explain the totals in README.
- T6 15:23 · Docs pass 6: explain the totals in README.
- T7 15:28 · Docs pass 7: explain the totals in README.
**Commits this session** (newest first): `02261f8 docs: totals` · `823eb4f totals: fix the rounding bug (integer cents)` · `96cefb9 parse: cleanups` · `34b8e3d parse: currency codes` · `e1296f8 scaffold the invoice CLI`

## Active files
Edited in the last turns: `<project>/README.md`
Uncommitted:
```
README.md | 2 +-
```

## Last check
`npm test` passed on the last run (1 of 2 runs failed earlier and were fixed), 3 h ago (in an earlier chat).

## Open items
- [ ] add CSV export in src/export.ts with a test.

## Where we left off (the last exchanges, oldest first; continue from the newest)

### You (2026-11-25 15:33)
Docs pass 8: explain the totals in README.

### Assistant
Docs pass 8 done.

### You (2026-11-25 15:38)
Docs pass 9: explain the totals in README.

### Assistant
Docs pass 9 done.

### You (2026-11-25 15:43)
Docs pass 10: explain the totals in README.

### Assistant
Docs pass 10 done. Next: add CSV export in src/export.ts with a test.
