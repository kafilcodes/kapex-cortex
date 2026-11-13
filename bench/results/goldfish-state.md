# STATE — invoices · main · updated 2026-11-13T07:06:12.911Z · from claude-code · session bench-chat-b

> Handoff packet written by Kapex Cortex at the end of every turn, in three parts: what's pinned for this session, the trail of earlier turns, and the last exchanges word for word. The project's rules load by themselves (CLAUDE.md, .claude/rules, auto memory): read this, then continue from **Next action**.

## Goal
Goal: build the invoice parser CLI with currency support. Read the repo first.

_Carried from the chat this one continues (“Invoice parser”)._

## Next action
add CSV export in src/export.ts with a test.

## Pinned for this session (kept whatever the last turns were about)
**Started with** (turn 1, 05:42): Docs pass 1: explain the totals in README.

**Your standing instructions** (your words, this chat and the one it continues):
- Decision: we store money as integer cents, never floats. _(earlier chat)_
- Always run npm test before committing. _(earlier chat)_

**Decisions recorded at handoff:**
- Keep zero runtime dependencies

**Continued from “Invoice parser”** (session bench-ch); what it got done:
- Totals are off by one cent on 3-line invoices. Fix it. → Fixed the rounding bug in totals: src/totals.ts summed floats; it now sums integer cents. _(files: src/totals.ts; a failing check fixed)_

**Memory notes flagged, not fixed yet** (Claude Code loaded them anyway: don't rely on them, and mention them to the user):
- `CLAUDE.md` over-cap: 207 lines: Claude follows files under 200 lines better
- `memory/MEMORY.md:1` broken-link: It points to testing.md, which doesn't exist.
- `CLAUDE.md:6` stale: #111315 isn't used anywhere in the project any more.
- `CLAUDE.md:7` stale: `src/legacy/report.ts` no longer exists in the project.
- `memory/MEMORY.md:2` false: It says `npm test` doesn't work, but it ran successfully 2 times.

## Verify (done = these pass)
- `npm run test`

## Working tree
```
README.md | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

WIP snapshot: `refs/cortex/wip/bench-chat-b (f395707def)` (restore with `git stash apply <sha>`).

## Last failure
None recorded.

## Session trail (earlier turns, oldest first; the newest are below, word for word)
- T1 05:42 · Docs pass 1: explain the totals in README.
- T2 05:47 · Docs pass 2: explain the totals in README.
- T3 05:52 · Docs pass 3: explain the totals in README.
- T4 05:57 · Docs pass 4: explain the totals in README.
- T5 06:02 · Docs pass 5: explain the totals in README.
- T6 06:07 · Docs pass 6: explain the totals in README.
- T7 06:12 · Docs pass 7: explain the totals in README.
**Commits this session** (newest first): `6213bd8 docs: totals` · `c5f00ca totals: fix the rounding bug (integer cents)` · `5ff17ec parse: cleanups` · `5e96ec6 parse: currency codes` · `7664c3d scaffold the invoice CLI`

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

### You (2026-11-13 07:06)
Docs pass 8: explain the totals in README.

### Assistant
Docs pass 8 done.

### You (2026-11-13 07:06)
Docs pass 9: explain the totals in README.

### Assistant
Docs pass 9 done.

### You (2026-11-13 07:06)
Docs pass 10: explain the totals in README.

### Assistant
Docs pass 10 done. Next: add CSV export in src/export.ts with a test.
