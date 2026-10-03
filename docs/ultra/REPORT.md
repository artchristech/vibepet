# vibepet ultra: final report

> On `main` this folder holds only the report, plan, rubric and tools. The evidence it cites (`round-0/`, `round-1/`, `fleet-spend.jsonl`; 420 MB, ~2,700 screenshots) stays on the `ultra/round-1` branch @ `a7e23cb`.

**Status (2026-10-02):** wrapped up at the user's request partway through Round 1's fix phase.
- **Round 0 is complete:** ground truth, harness, fixture fleet, baseline.
- **Round 1:** drive, hostile critic, two blind raters and triage are complete. Four fix branches passed their gates and are merged into `ultra/round-1`. Eleven more were built but not gated or merged when the run stopped.
- **Not run:** the feature sprint (away digest, Collision Radar, chat streaming) and Rounds 2–5.

**Rules for every number:**
- Measured on the live fixture fleet (real Claude Code 2.1.287 sessions on Haiku 4.5 in tmux), or mined from the user's own transcripts as numbers only.
- The rubric is in `rubric.md`.
- Evidence is in `round-0/` and `round-1/`. The workflow scripts are in `tools/workflows/`.

| round | branch | state |
|---|---|---|
| 0 | `ultra/round-0` @ `315952c` | done: harness, fleet, ground truth, ranking, chat benchmark, baseline, TTA before, audit |
| 1 | `ultra/round-1` @ `3488d20` | partial: scored. 4 of 15 fix tasks merged: 35 of 129 confirmed bugs, including 7 of 8 blockers |
| 2–5 | — | not run |

---

## 1. Ground truth

**Source:** the user's own Claude Code history.
- Snapshot: transcripts up to 2026-10-01 20:00Z.
- Coverage: 356 top-level sessions from 2026-07-17, 1.48 GB, 160,977 records.
- Excluded: subagent, fleet and scratch sessions.

Two independent miners (`tools/mineA.js` in Node, `tools/mineB.py` in Python) agree on 100/100 cross-checks (max relative difference 0.0002). The audit reproduced `ground-truth.json` from their outputs; only the timestamp differed.

Details: `round-0/ground-truth.md`.

### Sessions at once

| | all time | last 30 d |
|---|---|---|
| Live sessions per live minute: median / p75 / p90 / max | 1 / 2 / 4 / 10 | 1 / 3 / 4 / 10 |
| Peak per local day: median / p90 | 3 / 7 | 4 / 8 |
| Concurrency seen by a session-minute: median / p90 | 2 / 5 | 3 / 6 |
| Share of live minutes with 2+ / 5+ sessions | 36% / 4.8% | 48% / 8.0% |

**Trend:** concurrency is rising. The last 10 daily peaks were 4, 6, 8, 7, 8, 5, 7, 8, 8, 10.

**Why the max is 10 when the user runs ~15:** "live" means records less than 30 min apart, so open but silent terminals do not count.

### Time to attention: the north star

TTA is the time from a block's start until the user answers it. Waits are censored at 2 h; 57 of 437 blocks waited longer.

| class | n | median | p90 | last 30 d: n / median / p90 |
|---|---|---|---|---|
| **a+b+c combined (headline)** | **380** | **122 s** | **1,647 s** | 232 / 181 s / 2,035 s |
| (a) question at the end of a turn | 276 | 116 s | 1,504 s | 169 / 177 s / 2,045 s |
| (b) AskUserQuestion | 64 | 218 s | 1,809 s | 38 / 226 s / 1,702 s |
| (c) approval, with a prompt shown to the human | 40 | 111 s | 1,278 s | 25 / 183 s / 1,189 s |
| (c) approval, spec rule as written | 243 | 3.7 s | 75 s | — |
| done, then idle (not counted as TTA) | 1,735 | 101 s | 1,333 s | 1,150 / 103 s / 1,339 s |

**Which approval definition is the headline.** 96.4% of tool calls ran in auto mode, and auto mode never shows an Edit or Write prompt. So 203 of the spec rule's 223 edit gaps measure classifier or hook latency, not a human. The headline keeps only waits a human answered:
- user rejections;
- ExitPlanMode plan approvals;
- default-mode edits.

**Present or away** (share of the 62 censored wait-hours):
- **Present: 60.4%.** Of that, 38.5% was the user typing into other sessions and 21.9% the final stretch before answering.
- **Away: 39.6%.** Away means a stretch of 20 min or more with no prompt in any session.
- **Last 30 d:** present 65.3%, away 34.7%.
- **Speed of answers:** 20.8% within 30 s, 68.2% within 5 min.
- **Meaning:** most waiting happens while the user is at the keyboard in another session. That is a detection problem a pet can fix.

**Attention load:**
- 1.12 blocks per live session-hour.
- One or more sessions blocked in 23.6% of live minutes (last 30 d); at most 6 at once.
- The same tool call blocked in two sessions at overlapping times: 0.

## 2. Time to attention, before → after

**Method:** `test/ultra/tta.js` on the live fleet, through the real UI.
- **Before:** `ultra/round-0`, from `round-0/tta-before.md`.
- **After:** the merged `ultra/round-1` @ `3488d20`, from `round-1/tta-after/` and `round-1/tta-after.report.json`.
- **Detect:** seconds from the block's start (registry or transcript) to the first signal on the pet.
- **Actionable:** seconds until the pet offers an action that really resolves the block. Every press was checked in the session itself.

| block kind (member) | detect, before | detect, after | actionable, before | actionable, after | clicks, before | clicks, after | resolvable from pet |
|---|---|---|---|---|---|---|---|
| approval (kestrel) | none in 240 s (2 of 3); 92.4 s (1 of 3) | **1.1 s and 0.3 s** (n=2; one trial had the record withheld by Claude Code) | never: Approve failed on tmux | **1.1 s / 0.3 s** | 2, then the action fails | **2, works**: the approved command ran (2 of 2) | no → **yes** |
| AskUserQuestion (beacon) | none in 240 s (2 of 3); 92.7 s (1 of 3) | **2.8 s** (n=1, record withheld) | never: the wrong action (Approve) was offered | not on this branch: Reply is refused safely ("pick one of its options") | 2, fails | 3, safe refusal | no → no. The option picker is on `ultra/r1/row-actions` (built, not gated) |
| question at end of turn (vibepet) | 1.3 s | not re-measured | never: Reply failed on tmux | not re-measured. The Reply path now reaches tmux (tmux-reach) | 2 + text, fails | — | — |
| done (vibepet) | 2.3 s | not re-measured | never | not re-measured | — | — | — |
| /loop stall (ember) | none in 200 s (5 of 7) | not re-measured | never | not re-measured | — | — | — |
| subagent blocked (delta) | never in 300 s | not re-measured | never | not re-measured | — | — | — |

**What changed:**
- vibepet now reads Claude Code's own session registry (`~/.claude/sessions/<pid>.json`: status, waitingFor, tmux pane). Before, it read transcripts only.
- Claude Code withholds the pending tool_use record while its dialog is open (9 of 13 dialogs in Round 0). The registry flips within ~75 ms either way.
- Approve, Reply and Jump target the registry's tmux pane, and refuse unless that pane is in the matching state.

**Caveat:** small n (2 approval trials, 1 AskUserQuestion trial), stopped there to save fleet budget. The other kinds were not re-measured.

## 3. Score table

Two blind raters scored every surface on the rubric's five axes, from evidence packs captured on the live fleet. Round 1's packs show the code as it stood when Round 1 started (`ultra/round-0`), so these are the baseline. No later round was run, so there are no counted deltas.

| surface | R1 rater A | R1 rater B | R1 mean | d = \|A − B\| | axes A / B (correctness / speed / clarity / agency / delight) |
|---|---|---|---|---|---|
| S1 Net Home panel | 39.0 | 40.4 | **39.7** | 1.4 | 30/35/40/35/55 · 32/40/40/35/55 |
| S2 Chat | 40.2 | 40.2 | **40.2** | 0.0 | 25/55/38/28/55 · 28/58/35/25/55 |
| S3 Command bar | 50.6 | 49.8 | **50.2** | 0.8 | 35/80/45/38/55 · 35/76/45/38/55 |
| S4 Row actions | 38.0 | 39.0 | **38.5** | 1.0 | 30/45/35/30/50 · 30/40/40/35/50 |
| S5 Theater replay | 55.0 | 55.2 | **55.1** | 0.2 | 54/86/48/32/55 · 52/87/50/32/55 |
| S6 Ports / localhost | 51.2 | 56.4 | **53.8** | 5.2 | 45/68/40/55/48 · 48/74/45/65/50 |
| S7 Gestures + jump key | 44.2 | 45.2 | **44.7** | 1.0 | 34/40/45/40/62 · 35/40/45/40/66 |
| **overall** | | | **46.0** | | R2–R5: not run |

**Reading:**
- The raters agree closely: d ≤ 1.4 on six surfaces, 5.2 on S6.
- Correctness (25–54) and agency (25–65) are the weak axes everywhere. Both trace mostly to the two root causes the merged fixes address: transcript-only state, and actions that couldn't reach tmux.
- The merged state was not re-scored. The stop rule (all surfaces ≥ 85, or two rounds gaining < 2) was never reached.

## 4. Bug ledger

**Round 1:** 153 found, 129 confirmed, 35 fixed. Every confirmed bug maps to a fix task (`round-1/tasks.json`).
- **Confirmed by severity:** 8 blocker, 44 major, 58 minor, 19 polish.
- **Rejected by the critic (24):** 13 not-a-bug, 8 duplicates, 3 not reproduced.
- **Ledger:** `round-1/bugs.jsonl`. One line per bug: repro, evidence, critic verdict, cause (file:line), task, gate, merged.

| surface | found | confirmed | fixed (merged) |
|---|---|---|---|
| S1 Net Home panel | 21 | 17 | 10 |
| S2 Chat | 31 | 27 | 6 |
| S3 Command bar | 23 | 16 | 3 |
| S4 Row actions | 22 | 21 | 5 |
| S5 Theater replay | 23 | 22 | 3 |
| S6 Ports / localhost | 18 | 11 | 0 |
| S7 Gestures + jump key | 15 | 15 | 8 |
| **total** | **153** | **129** | **35** |

**Blockers:** 7 of 8 fixed. Still open: `r1-S4-02`, answering an AskUserQuestion from the pet. The fix is on `ultra/r1/row-actions`, built but not gated.

**Round-0 seeds:**

| status | seeds | branch |
|---|---|---|
| fixed on `ultra/round-1` | M1, M3, M4, M6, M7, M9, M15, T1 (queue-state); M10, M11, M12 (tmux-reach); T2 (home-feedback); CH23–25, CH38–39 (chat-context) | merged |
| partly fixed | M2: it now surfaces as needs-you in 2.8 s, and the wrong Approve is refused. Answering the options needs row-actions | merged + `ultra/r1/row-actions` |
| open | M5, M8 (loop-rows, red), M13 (home-keyed, red), M14, T3, most CH items (chat-bar, not merged) | unmerged branches, §8 |

### Harness and test infrastructure (fixed in Round 0)

| id | finding | found | fixed |
|---|---|---|---|
| H1 | `npm test` hung: `content.test.js` ran a full production render (minutes) inside the gate | R0 | R0 `f515f13`: render opt-in (`npm run test:render`); gate 24/24 in ~3 s |
| H2 | A killed test run orphaned `ffmpeg` (ppid 1, still encoding) | R0 | R0 `f515f13`: `render.js` tracks and kills its children |
| H3 | No `VIBEPET_CLAUDE_DIR` on main: a test instance would show the user's real sessions | R0 | R0 `483d5e8`: `overrides.js` |
| H4 | In isolated mode, ports listed the user's real dev servers and offered to Stop them; recordings listed the user's real screen recordings | R0 | R0 `c4aca2f`, `0a5e118` |
| H5 | Test instances stole focus from the user's frontmost app | R0 | R0 `8c86666`: accessory activation policy |
| H6 | The privacy guard accepted any `sessions/<pid>.json` link. A registry of one of the user's sessions, or a fleet link whose pid was reused, could put a real session's name, cwd and status on screen | R0 audit | R0 `315952c`: every registry's cwd must be inside `~/.vibepet-ultra`; 4 new test cases, mutation-checked |

### Claude Code behaviours the fixes must design around (not vibepet bugs)

- **CC1:** the pending tool_use record is withheld while a dialog is up: 5/25 in `fleet-states.md`, 9/13 in tta-before.
- **CC2:** `statusUpdatedAt` is not a heartbeat, and the next /loop fire time is not recorded anywhere.
- **CC3:** the Agent tool backgrounds subagents even when the prompt asks for the foreground.
- **CC4:** desktop-app sessions have no registry entry. They are 24% of blocks in the last 30 d.

## 5. Chat bar

Benchmarked against Raycast AI and Warp in `round-0/benchmark.md`. **Verdict: not delivered.** Only context fidelity is merged.

| claim | bar | result |
|---|---|---|
| Claims match the transcripts | every claim about a session checks out in its jsonl | **Improved, not fully proven.** chat-context (merged, gate green) gives chat every session's state, exact ask, title, repo and edited files; before, it saw `name=phase` only. Known gap: on "which session needs me first?", Haiku names only the first blocked session about half the time. No claims critic was re-run on the merged tip |
| First token < 1.5 s | Enter → first visible model token | **Not met.** `ultra/r1/chat-bar` built a warm streaming engine, but it missed its own TTFT gate on Haiku 4.5 for later turns: the prefix is below Haiku's 4096-token minimum cacheable size. Not merged. Before: 4.2–12 s, non-streaming |
| No-key / offline / 429 copy | each state says what to do | on `ultra/r1/chat-bar` (not merged) |
| History across restart | survives a restart | on `ultra/r1/chat-bar` (not merged) |
| `@session` commands | "@kestrel approve", "tell the vibepet session to run its tests" | `ultra/r1/session-console` built /approve, /deny, /answer, /reply, /interrupt and @session in the command bar. Its gate never ran. Chat-side routing was not built |

## 6. Many-session features

Ranked by TTA saved for this user (last 30 d, attention-switch model, c = 0.1, h = 30 s). Details: `round-0/feature-ranking.md`.

| # | feature | s saved/block × blocks/day = s/day | range | confidence | build |
|---|---|---|---|---|---|
| 1 | **Attention queue**: persistent rows, true block age, oldest block first, one order for Home, roster and jump key | 66 × 7.73 = **513** (8.5 min/day) | 349–673 | medium | S–M |
| 2 | **"While you were away" digest** | 85 × 0.67 = **57** after #1 (71 alone) | 14–142 | low | M |
| 3 | **Loop-aware rows** ("sleeping · wakes 14:32", "waiting on 2 background tasks") | 0 direct TTA; 64–142 s/day of false-"done" checks avoided | 16–142 | medium on counts | S–M |
| 4 | Spend burn per session | 0 | 0 | high | S |
| 5 | Batch-approve identical calls | 0 (no identical concurrent blocks in the history) | ≤ 0.1 | high | M–L |

**The case for #1:**
- Today's pet hides 61% of blocked time. Questions park at 5 min; approvals are hidden for 90 s and dropped at 45 min.
- The user's own pet has not moved TTA in its 6 days (median 178 → 191 s).
- **Runner-up, sixth feature:** an away ping (phone push) is worth ~181 s/day at a 10% response rate, but that rate is unproven.

**Top 3 status:**

| feature | before | after | proof |
|---|---|---|---|
| **Attention queue** (core shipped) | blocks invisible, or 91–101 s late. Ages reset at launch; dropped after 5 or 45 min; actions fail on tmux | merged (queue-state + tmux-reach + home-feedback): needs-you from the registry, true block ages, one order for Home, roster and jump key. Approval: detect 0.3–1.1 s; resolved in 2 clicks (2 of 2) | `round-1/tta-after/`, `round-1/fixes/queue-state/`, `round-1/canon-final/` (30/30) |
| Away digest | nothing exists | **not built** (feature sprint not run) | — |
| Loop-aware rows | a loop reads "done N m ago" | built on `ultra/r1/loop-rows`, **red at its gate** (check 4, diff risk). Not merged | `round-1/fixes/loop-rows/` |

## 7. Collision Radar

**Not built.** The feature sprint, where it was scheduled, did not run.

**Spec and proof plan:** `tools/workflows/features.js`, feature `radar`.
- Signals, earliest first: B reads a file A has dirty; B's pending Edit (registry + pane text); port binds; commit-on-top.
- Fixture: forge-a / forge-b sharing one repo.
- Pass bar: the alert precedes the second write, with zero false alarms over 30 min.

**Sizing from ground truth (§1 inputs):**
- Two live sessions shared a git repo in 21% of multi-session minutes.
- The same file was edited by two sessions within 30 min 38 times.
- 13 of 542 commits landed while another session had newer edits in that worktree.

## 8. Branches ready to merge

`main` is untouched at `649beb2`. Nothing was pushed, released or deployed.

| branch | contents | test status | recommendation |
|---|---|---|---|
| `ultra/round-1` @ `3488d20` | everything in `ultra/round-0`, plus fleet leases, queue-state (registry-driven needs-you, true ages, one order), tmux-reach (jump/approve/reply via the registry's tmux pane, refusing on a state mismatch), home-feedback (toasts over the panel, failures in the row, honest jump queue), chat-context (chat sees every session), and this evidence tree (`docs/ultra`, 409 MB, 2,730 screenshots). Code: 60 files, +5,416 / −176 vs `main` | `npm test` 64/64 in 9.1 s. canon 30/30 (start of round: 20/22). Live TTA in §2 | **merge this one.** It contains round-0 |
| `ultra/round-0` @ `315952c` | harness only: `VIBEPET_CLAUDE_DIR` / `VIBEPET_USER_DATA` / `VIBEPET_HOTKEY` (inert when unset), test mode, render child tracking, the `"test"` script; `test/ultra/*`, `test/fleet/*` | `npm test` 24/24 | superseded by round-1 |

**Unmerged Round 1 fix branches.** All were built in their own worktrees under `~/.vibepet-ultra/wt/`, on top of the wave-1 tip `8e5fe27`.

| branch | covers | state |
|---|---|---|
| `ultra/r1/row-actions` | 14 bugs incl. blocker r1-S4-02: Approve/Always/Deny, AskUserQuestion options, Reply | fix ok; gate interrupted by the stop |
| `ultra/r1/session-console` | 12: command bar as a session console (/approve /deny /answer /reply /interrupt, @session) | fix ok; gate not run |
| `ultra/r1/keys-entry` | 7: Home ≤150 ms by click or key, caret in place | fix ok; gate interrupted |
| `ultra/r1/live-rows` | lowest-surface fix (S4): actionable < 1 s, every action judged by Claude Code's files | fix ok; gate interrupted |
| `ultra/r1/theater-data` | 7: Theater tells the session's own story | fix ok; gate not run |
| `ultra/r1/gesture` | 5: summon gesture never fires on a drag | fix ok; gate not run |
| `ultra/r1/ports-truth` | 12: chips name their session, [::1]/HTTPS, retries | fix unfinished |
| `ultra/r1/theater-player` | 10: fits the window, opens at now | fix unfinished |
| `ultra/r1/chat-bar` | 17: warm streaming engine, Stop, error states, history | fix not ok (TTFT gate on Haiku) |
| `ultra/r1/loop-rows` | 2: loop-aware rows | gate red (diff risk) |
| `ultra/r1/home-keyed` | 8: Home rows update in place | gate red: the needs-you stack has no size limit, so 10–12 of 15 rows become unreachable |

**To continue:**
- Run `tools/workflows/round.js` (args `{round, spendStop}`) and `features.js` with the Workflow tool.
- The fleet restarts from `~/.vibepet-ultra/int` with `node test/fleet/fleet.js up`.

## 9. Fleet spend

**Cap:** $5 at Haiku 4.5 list prices. "Estimate" adds Claude Code's hidden-call overhead (+50%). Ledger: `fleet-spend.jsonl`.

| phase | transcripts | estimate incl. hidden calls |
|---|---|---|
| Round 0 (build, experiments, baseline, TTA before, audit) | $1.73 | $2.57 |
| Round 1 (drive, critic, fixes) + wrap-up TTA after | +$0.64 → **$2.37** | +$0.96 → **$3.53** |

**By member (transcripts):**

| member | spend |
|---|---|
| delta | $0.92 |
| kestrel | $0.41 |
| ember | $0.41 |
| beacon | $0.21 |
| vibepet | $0.15 |
| atlas | $0.11 |
| Round 0 probe dirs | $0.15 |

**Fleet torn down 2026-10-02:** all `vp-*` tmux sessions killed; the scratch repos are kept in `~/.vibepet-ultra/fleet/`.

**Not fleet spend:** chat and TTFT probes on the user's own Claude login, about $0.01.

**Cleanup when done:**
- `git -C ~/projects/vibepet worktree remove` each `~/.vibepet-ultra/wt/*` and `~/.vibepet-ultra/int`.
- Delete the `ultra/r0-*` and `ultra/r1/*` branches you don't want.
- `rm -rf ~/.vibepet-ultra`.
- The fleet's own transcripts are in `~/.claude/projects/-Users-christopherharris--vibepet-ultra-fleet-*`.
