# STATE — invoices · main · updated 2026-11-25T15:23:12.069Z · from claude-code · session bench-chat-b

> Handoff packet written by Kapex Cortex at the end of every turn. The **Mission contract** carries over from chat to chat: its goal, the user's binding rules and rejected approaches hold until the user says the mission is done. Below it, the rolling part: this chat's goal and next step, the trail of earlier turns, and the last exchanges word for word. The project's rules load by themselves (CLAUDE.md, .claude/rules, auto memory): read this, then continue from **Next action**.

## Mission contract (binding across chats until the user says it is done or starts a new task)
<!-- cortex-lineage: handoff=h_01M89MVF0PE4EW054A0CWDP3D3 parent=h_01M89MVDX36GGQKD5HNSF5TZ5X parent_session=bench-chat-a hop=2 origin=bench-chat-a head=7a88ddf618e5f5a0870131ef376e7f7d1ba8bc76 mission=m_01M89MVDX43ADMKDK8RMKRMBD1 status=active -->
**North star:** build the invoice parser CLI with currency support. Read the repo first. _(set in chat 1, 2026-11-25 11:25)_
**Chain:** chat 2 of this task (it began in “Invoice parser”; this chat continues “Invoice parser”). **Where:** branch `main` · head `7a88ddf618`.
**Binding rules (the user's own words; follow them exactly):**
- [never] “Decision: we store money as integer cents, never floats.” _(chat 1, 2026-11-25 11:32)_
- [must] “Always run npm test before committing.” _(chat 1, 2026-11-25 11:32)_
- [decision] “Keep zero runtime dependencies” _(chat 2, this one, 2026-11-25 15:23)_

## Goal
build the invoice parser CLI with currency support. Read the repo first.

_The mission's north star: this chat has only continued it so far._

## Next action
add CSV export in src/export.ts with a test.

## Verify (done = these pass)
- `npm run test`

## Pinned for this session (kept whatever the last turns were about)
**Started with** (turn 1, 13:59): Docs pass 1: explain the totals in README.

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

WIP snapshot: `refs/cortex/wip/bench-chat-b (56c8c10ba2)` (restore with `git stash apply <sha>`).

## Last failure
None recorded.

## Session trail (earlier turns, oldest first; the newest are below, word for word)
- T1 13:59 · Docs pass 1: explain the totals in README.
- T2 14:04 · Docs pass 2: explain the totals in README.
- T3 14:09 · Docs pass 3: explain the totals in README.
- T4 14:14 · Docs pass 4: explain the totals in README.
- T5 14:19 · Docs pass 5: explain the totals in README.
- T6 14:24 · Docs pass 6: explain the totals in README.
- T7 14:29 · Docs pass 7: explain the totals in README.
**Commits this session** (newest first): `7a88ddf docs: totals` · `0b28589 totals: fix the rounding bug (integer cents)` · `68517b2 parse: cleanups` · `e03f23a parse: currency codes` · `c0f656e scaffold the invoice CLI`

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

### You (2026-11-25 14:34)
Docs pass 8: explain the totals in README.

### Assistant
Docs pass 8 done.

### You (2026-11-25 14:39)
Docs pass 9: explain the totals in README.

### Assistant
Docs pass 9 done.

### You (2026-11-25 14:44)
Docs pass 10: explain the totals in README.

### Assistant
Docs pass 10 done. Next: add CSV export in src/export.ts with a test.
