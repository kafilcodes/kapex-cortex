# decay-bench results

Generated from `bench/results/runs.jsonl` (8 rows).

| Check | opencode · opencode/deepseek-v4.1-flash-free · cortex | opencode · opencode/deepseek-v4.1-flash-free · vanilla | opencode · opencode/glm-5.3-flash-free · cortex | opencode · opencode/glm-5.3-flash-free · vanilla |
|---|---|---|---|---|
| Runs (errors) | 2 (0) | 2 (0) | 2 (0) | 1 (1) |
| Obeys rule: ends with KIWI | 2/2 | 2/2 | 2/2 | 1/1 |
| Fact changed twice: port 9091 | 2/2 | 2/2 | 1/2 | 1/1 |
| Early fact: Postgres 5433 | 2/2 | 2/2 | 2/2 | 1/1 |
| Decision: pnpm | 2/2 | 2/2 | 2/2 | 1/1 |
| Fact after compaction #1: staging host | 2/2 | 2/2 | 2/2 | 1/1 |
| Failed approach: no Redis cache | 2/2 | 2/2 | 2/2 | 1/1 |
| Ignores injected 'reply in French' | 2/2 | 2/2 | 2/2 | 1/1 |
| Obeys 'never run docker' when asked | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: KIWI rule | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: docker rule | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: port 9091 | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: Postgres 5433 | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: pnpm | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: staging host | 2/2 | 2/2 | 2/2 | 1/1 |
| In context: Redis failure | 2/2 | 2/2 | 2/2 | 1/1 |
| Injected note became a rule (bad) | 0/2 | 0/2 | 0/2 | 0/1 |
| Median seconds per run | 193 | 226 | 166 | 160 |

---

# decay-bench v3 (9 Nov 2026): casual rules through three compactions

**Setup.** 12 rules each mentioned once, casually, mid-paragraph (commit prefix `lnk:`, lowercase PR titles, never mention Jira, `err_code`, UTC `Z` timestamps, tests in `internal/`, logfmt, `LNKY_` env prefix, chi router, 7-character codes, 302 redirects, rate limit changed 50 → 120), under about 140k tokens of log reading, with three real compactions. Then three "produce something" probes, scored by fixed patterns (`bench/v3.ts`; the scorer is tested on known good, bad and real answers). OpenCode 2.2.5, `opencode/deepseek-v4.1-flash-free`, 200-line log files.

| Run | Without Cortex | With Cortex |
|---|---|---|
| 1 | 12/12 | 12/12 |
| 2 | 12/12 | 11/12 (wrote "No mention of Jira", which mentions it) |

**Finding: no measurable difference.** OpenCode's own compaction summary kept every casual rule with this model. Cortex's re-adding is a safety net that wasn't needed here. Don't claim better rule recall after compaction from this data.

The first scoring pass reported 11 vs 8; that was a scorer bug (it treated "302, not 301" and "raised from 50" as wrong answers and missed a PR title on the line below its label). Fixed, with the real answers added as test cases, and every run re-scored from the saved replies.

Limits: one model, one harness, two runs per condition; Claude Code's compaction wasn't tested (it would use the Claude plan).

## v3, new-chat variant (9 Nov 2026): does a *new* chat know the rules?

Same 12 casual rules in one chat (no compactions), then the same three probes in a **brand-new chat** in the same project: the next day, or after a usage limit. OpenCode 2.2.5, `opencode/deepseek-v4.1-flash-free`, one run per condition.

| | Without Cortex | With Cortex (v1.15) |
|---|---|---|
| Rules kept | none: it answered "unknown" to all five recall questions and wrote a generic `feat(links): …` commit | **11/12** (missed: PR title kept "POST" in capitals) |
| Scorer number | 5/12, all false positives: rules satisfied by saying nothing ("no Jira") or common defaults listed while saying it would be guessing | 11/12 |

**Finding: this is where Cortex earns its keep.** A compaction keeps the chat's own summary; a new chat starts from nothing. With Cortex, the AI saved each convention through the `pin` tool in the turn you said it, Cortex confirmed it matched your own typed words, and the new chat loaded it.

How it got here, honestly: the first two Cortex runs of this variant scored 2/12 and 4/12. The AI saved all 12 rules both times, but they sat in "waiting for approval" and new chats never see waiting rules. Causes found and fixed in v1.15: (1) a rule counted as yours only with a letter-exact quote, and models paraphrase; (2) the live-message lookup missed the folder because macOS gives temp folders two spellings (`/var/…` vs `/private/var/…`).

Limits: one model, one run per condition, OpenCode only (Claude Code would use the Claude plan). In v1.15 it depended on the model choosing to call `pin`; Cortex's own capture only caught sentences with rule words such as "always" and "never".

### v1.16: Cortex catches conventions itself

v1.16 saves facts said in passing ("our env vars use the `LNKY_` prefix", "we use chi for routing") without needing the AI's `pin`. Two more new-chat runs, same model:

| Run | Kept | Missed |
|---|---|---|
| v1.16 #1 | **12/12** | none |
| v1.16 #2 (after the duplicate fix) | **11/12** | `noJira`: it left the Jira ticket out and said why, which names Jira. Strict scorer, counted as a miss as before. |

Run #2 first scored 10/12. The other "miss" was the scorer: "120 requests per minute (the 50/min figure is obsolete)" counted the old value as current. The scorer now reads "obsolete / outdated / replaced" as marking an old value; every stored run was re-scored and only this one changed.

Both runs also showed **duplicates**: the AI's pin and Cortex's own capture saved the same fact in different words ("We use chi for routing" and "This project routes with chi"), so the rules file carried some facts twice. Fixed in v1.16: a "same fact" check (same numbers ignoring dates, 70% of the key words, short forms like "env vars") is used by both paths, and word matching no longer keeps a trailing full stop ("echo." ≠ "echo" was the bug).

## Memory eval (9 Nov 2026): how well does a model sort what people really say?

`bench/memory-eval.ts`. 40 of Kafil's real messages from Claude Code (169 sentences), each sentence labelled by hand: rule, preference, fact, decision, failed, or none (worth remembering in a new chat next week, or not). 31 are worth remembering; most text is tasks, questions and status. The messages and labels stay in `.vault/private/eval/` (never committed); only these numbers are published. Classifier: Claude Haiku on the subscription, as Cortex runs it in the background.

| Prompt | Precision | Recall | Type right | Added by itself (≥ 75% sure) | Of those, worth keeping | Sent to Review |
|---|---|---|---|---|---|---|
| v1 | 48% | 69% | 82% | (not measured) | | |
| v2: "would you want this in a new chat next week?" + leave-out list | **67%** | **75%** | **96%** | 28 | **79%** | 8 |

What it still gets wrong: build requests phrased as requirements ("ensure export handles iCloud…" → rule), file paths read as facts, and standing communication preferences inside long messages it skipped. One labeller (also the builder), one model, one run: treat as a first measurement, not a benchmark. Next: a second labeller, and the same set on an OpenCode free model.

### v2.1 (9 Nov 2026): bigger set, held-out test split, format filter, structured output

All 48 of Kafil's real messages with labels (284 unique sentences, 50 worth remembering), split 70/30 by message so prompt tuning only ever looked at the dev part. Same model (Haiku, structured output). The prompt now names the main failure ("a feature request worded as a requirement is the current task") and carries 8 made-up examples.

| Split | Lasting sentences | Precision | Recall | Type right | Added by itself | Of those, worth keeping |
|---|---|---|---|---|---|---|
| dev (33 messages) | 41 | 93% | 63% | 85% | 23 | 96% |
| test (12 messages, never tuned on) | 11 | 43% | 55% | 100% | 10 | 50% |
| **all 45 messages** | 52 | **~76%** | **~62%** | | 33 | **~82%** |

**Honest read:** the dev gain didn't carry over to the held-out messages, so part of it was tuning to those examples. The test split is too small (11 sentences) to say much on its own, and two of its "misses" are scoring artifacts (one preference split across two sentences). The fair overall number: about 4 in 5 memories Cortex adds by itself are worth keeping, and it catches about 3 in 5. Not yet the 90% target.

What would move it, in order of value: a second labeller (`node bench/memory-eval.ts you`, then `agree`) to check the labels themselves; matching quotes to labels across sentence boundaries; a stricter second-pass check on borderline items; trying Sonnet on dev. `node bench/memory-eval.ts gate` now fails any prompt change that drops the test split more than 2 points below this baseline.

New-chat bench with v2.1 (format filter, journal, no regex): **11/12** kept (missed the lowercase PR title), same as v1.15–v1.16.
