# Round 0 ground truth (reconciled)

Snapshot: transcripts up to **2026-10-01 20:00Z** (14:00 MDT). The data covers 356 top-level sessions from 2026-07-17 to 2026-10-01 (1.48 GB, 160,977 records). Private-tmp/scratchpad sessions, fleet sessions and subagent transcripts are excluded. "Last 30 d" means the 30 × 24 h before the snapshot.

Two independent miners produced these numbers: `tools/mineA.js` (Node) and `tools/mineB.py` (Python). They now agree on all 100 cross-checks; the largest relative difference is 0.02%, from rounding. Every wait, prompt and live-span event is identical between the two event dumps. The final numbers are in `ground-truth.json`, and the original runs are kept in `reconcile/pre/`.

## How many sessions run at once

| | all time | last 30 d |
|---|---|---|
| Live sessions per live minute: median / p75 / p90 / max | 1 / 2 / 4 / 10 | 1 / 3 / 4 / 10 |
| Peak per local day: median / p90 | 3 / 7 | 4 / 8 |
| Concurrency seen by a session-minute: median / p90 | 2 / 5 | 3 / 6 |
| Live minutes with 2 or more sessions / 5 or more | 36% / 4.8% | 48% / 8.0% |

Concurrency is rising. The last ten daily peaks were 4, 6, 8, 7, 8, 5, 7, 8, 8 and today 10. A session counts as "live" only while it writes records less than 30 min apart, so terminals that are open but silent are not counted. That is why the maximum is 10 while the user reports about 15 sessions open.

## Time to attention (the north star)

Waits are censored at 2 h. 57 of the 437 blocks (13%) waited longer than that and count as "away".

| class | n | median | p90 | last 30 d: n / median / p90 |
|---|---|---|---|---|
| **a+b+c combined** | **380** | **122 s** | **1647 s** | 232 / 181 s / 2035 s |
| (a) end-of-turn question | 276 | 116 s | 1504 s | 169 / 177 s / 2045 s |
| (b) AskUserQuestion | 64 | 218 s | 1809 s | 38 / 226 s / 1702 s |
| (c) approval, human prompt shown | 40 | 111 s | 1278 s | 25 / 183 s / 1189 s |
| (c) approval, spec rule as written | 243 | 3.7 s | 75 s | 142 / 4.5 s / 118 s |
| a+b+c with the spec-rule approval | 583 | 37 s | 923 s | 349 / 43 s / 1207 s |
| done-idle (not TTA) | 1735 | 101 s | 1333 s | 1150 / 103 s / 1339 s |

**Which approval definition is the headline, and why.** 96% of tool calls ran in auto mode, and auto mode never shows an Edit or Write prompt. Under the spec rule ("Edit-like gap > 2 s"), 203 of the 223 edit gaps were therefore classifier or hook latency: median 3.1 s, maximum 83 s. So the headline approval class keeps only the waits where a human answered a prompt. It has three parts:

- user rejections (25)
- ExitPlanMode plan approvals (20)
- default-mode edits (none in this data)

Approved Bash prompts leave no marker in the transcript, so this class undercounts. The 23 Bash rejections under auto mode show that some Bash prompts do reach the human.

## Detection or away?

For each wait, the time is cut at every human prompt the user sent in any session. A stretch of 20 min or more with no prompt anywhere counts as away (the spec's away threshold). The rest counts as present. This is computed over the 62 censored wait-hours across 380 a+b+c blocks:

| share of waiting time | all time | last 30 d |
|---|---|---|
| **Present, plausibly a detection problem** | **60%** | **65%** |
| …of which: typing into other sessions while this block waited | 38.5% | 46.0% |
| …of which: the final stretch before answering (noticing, reading, deciding) | 21.9% | 19.4% |
| **Away (20 min or more with no input anywhere)** | **40%** | **35%** |

- With a 10-min or 30-min threshold instead, the away share is 53% or 33%.
- Presence is only visible through typing, so 40% is an upper bound on away time.
- In 32% of blocks, the user prompted another session while the block waited. Only 7.6% of blocks contain a 20-min silence.
- Blocks answered within 30 s: 21%. Within 1 min: 34%. Within 5 min: 68%.
- One corroborating signal: Claude Code's CLI writes an away recap about 3 min after its terminal loses focus. That recap appears in 45% of CLI question or done waits lasting 3 min to 2 h. The desktop app never writes one.
- What this means: most waiting happens while the user is at the keyboard working in another session. That is a detection problem a pet can solve. The away share needs a phone ping instead.

## Attention load

- **Blocks:** 1.12 per live session-hour (1.05 in the last 30 d). Per-session median 0.93, p90 2.97.
- **Sessions blocked at once:**
  - 1 or more sessions blocked in 17.7% of live minutes (23.6% in the last 30 d)
  - 2 or more in 3.9% (5.9%)
  - 3 or more in 0.8%
  - at most 6 at the same moment
- **The same tool call blocked in two sessions at overlapping times:** 0. This was checked across 243 waits under the spec rule, with exact and coarse matching keys.
- **Away gaps (20 min or more with no prompt anywhere):**
  - 333 gaps (142 in the last 30 d), median 135 min.
  - In the 305 gaps where a session was live, 19% saw a block start and 71% saw a turn finish.
  - Pile-up per gap: median 1, p90 2, max 10.
- **Shared workspace,** measured over the 5,067 minutes with 2 or more sessions live:
  - same cwd: 35%
  - same git worktree: 20.5%
  - same git repo: 21% (17.6% in the last 30 d)
- **Same file edited by two sessions within 30 min:** 9 files, 38 events, 8 session pairs. **None in the last 30 d.**
- **Commits made while another live session had newer edits in the same worktree:** 13 of 542 (2.4%); 5 of 327 in the last 30 d.
- **Loops:**
  - /loop: 18 sessions
  - ScheduleWakeup: 20 sessions, 157 calls, delay median 1200 s, range 60–2400 s
  - CronCreate: 0
- **Spend:** $5,329 at list price ($2,076 in the last 30 d). Per-session median $2.99, p90 $42. Top-level sessions only; subagents are excluded.

## What reconciliation fixed

1. **The corpus is live.** The two runs read different data, so both now take `--cutoff`.
2. **Windows, percentiles and days were aligned.** Both now use the same 30-d window, linear percentiles and America/Denver days.
3. **Question pairing (A had 106 s, n 279; B had 116 s, n 276).** A let a wait run on through machine-driven continuations: stop hooks, task notifications and scheduled fires. A now drops the wait when a new assistant message arrives, as B did. All 314 question events now match.
4. **Approval.**
   - B counted 14 `automode-unavailable` denials as human. They cluster at fixed timeouts (60–70 s and 917–1040 s), and in all 14 cases the model resumed on its own. Both miners now exclude them.
   - B's "fast Bash command with a gap > 30 s" heuristic (8 events) is now a sensitivity count only.
   - The headline switched to the human-prompt definition, for the reason given above.
5. **Machine prompts.** Scheduled fires (B) and compaction summaries (A) no longer count as human prompts.
6. **Duplicate ownership.** One resume/fork pair was split between files: 574 shared records, with tied first timestamps. Both miners now assign shared records to the earliest-born file.
7. **Shared repo (A 36%, B 21%).** A fell back to the cwd for directories outside git. Both now count git repos only.

One residual difference remains: the worktree/repo shares differ by 0.1 point, because the two miners treat deleted directories differently.

Rebuild: see `ground-truth.json` → `source.rerun`.
