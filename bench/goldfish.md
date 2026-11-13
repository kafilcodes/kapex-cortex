# The Goldfish test (handoff recall, blind)

`node scripts/benchmark.ts` lives a dummy project through 25 turns in two chats (the second starts with `/cortex-resume`) and writes the handoff the real Stop hook produced to `bench/results/goldfish-state.md`, with the project path replaced by `<project>`. It also checks deterministically that the file holds the answer to each question below.

The blind half: start a fresh subagent that knows nothing of the run (a different model is better; we use Sonnet), give it only this prompt, and grade its answers against the key.

```text
You are a new engineer joining a project with zero prior context. The only thing you may read is this one file:
<path>/bench/results/goldfish-state.md
Do not read any other file, do not search the disk, do not run commands. Answer using only what it says;
if it doesn't say, write "NOT IN HANDOFF" (do not guess).
1. What is the project's goal?
2. How must money be stored (a decision made early in the work)?
3. What must be run before every commit?
4. What bug was fixed in the earlier chat?
5. Which file held that bug?
6. What is the immediate next step?
7. Which file will that next step create?
8. Which git branch is the work on?
9. Did the most recent test/check pass?
10. Which decision was recorded at handoff?
Reply "Q1: …" to "Q10: …", then "Gaps: …".
```

Key: invoice parser CLI with currency support · integer cents, never floats · `npm test` · the rounding bug in totals (off by one cent) · `src/totals.ts` · CSV export with a test · `src/export.ts` · `main` · yes · keep zero runtime dependencies.
