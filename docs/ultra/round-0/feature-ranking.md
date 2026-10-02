# Round 0: many-session feature ranking

Ranks the five candidate features by time-to-attention (TTA) saved for this user.

- **Data:** the reconciled ground-truth snapshot (transcripts up to 2026-10-01 20:00Z). The basis is the last 30 days unless marked otherwise.
- **Blocks:** answered question, AskUserQuestion and human-shown approval waits (a+b+c), censored at 2 h, exactly as defined in `ground-truth.md`.
- **Baseline:** vibepet `main` @ 649beb2.
- **Sources:** numbers come from `feature-ranking.json`, `feature-loops.json` and `feature-selfresume.json`. The scripts are `tools/feature_*.py`; they read only numbers and enums and never print transcript text.

## Ranking

| # | Feature | Main mechanism | s saved per block × blocks/day = s/day (last 30 d) | Range | Confidence | Build cost |
|---|---|---|---|---|---|---|
| **1** | **Attention queue**: persistent, true age, oldest block first | Detection: shows the 61% of blocked time today's pet hides | **66 × 7.73 = 513** (8.5 min/day) | 349–673 | medium | S–M, ~1 day |
| **2** | **"While you were away" digest** | Detection and decision at the moment of return | **85 × 0.67 = 57** after #1 (107 × 0.67 = 71 on its own) | 14–142 | low | M, ~1 day |
| **3** | **Loop-aware rows**, scoped to "resumes on its own" | Removes false "done" signals (wasted checks, signal noise) | **0 × 7.73 = 0** direct TTA; 10 s × 6.4–14.2 false "done"/day = **64–142 s/day of checks** | 16 (ScheduleWakeup only) – 142 | medium on counts, low on cost per check | S–M, ~0.5–1 day |
| 4 | Spend burn per session | None (spend is not a wait state) | 0 × 7.73 = 0 | 0 | high | S |
| 5 | Batch-approve identical calls | Action: k approvals → 1 click | 0 identical concurrent blocks → 0 | ≤ 0.1 | high | M–L |

#1 is an order of magnitude ahead of everything else. #2 and #3 are close:

- On a+b+c TTA alone, the digest ranks ahead. That is the ranking key used here, as asked.
- If wasted checks count as attention time, #3 (with the scope given here) overtakes it.

Both are cheap, so build both after #1. Built narrowly (ScheduleWakeup only), #3 is worth about 16 s/day.

## Today's baseline: what vibepet does now, and what it costs (last 30 d)

- **Questions disappear after 5 minutes.** A question is "parked" after 5 min of file silence (`agents.js:161`) and dropped from the list (`agents.js:284`). 68 of 184 questions (37%) lasted longer than that.
- **Approvals and AskUserQuestion are hidden for 90 s, then dropped at 45 min.**
  - They read "working" for the first 90 s, then "stalled" (`agents.js:159`).
  - Any file silent for more than 45 min is skipped entirely (`agents.js:271`).
  - 20 of 74 were answered before they ever showed. 16 of 74 lasted past 45 min.
- **Net effect: the pet hides 61% of censored blocked time** (3,198 of 5,228 s/day). The cost is concentrated in the long tail: 91% of blocked time sits in blocks that last over 5 min, and those are exactly the ones the pet stops showing.
- **The displayed age is wrong.** Age is `since`, the detection time (`agents.js:280`). It resets on every phase change and on a pet restart, and stalled rows read 90 s younger than they are.
- **Two different orders.** The roster and jump key sort oldest-first within a rank (`app.js:123`). Home sorts newest-first within a rank (`app.js:893`).
- **AskUserQuestion is mishandled.** The row shows only the bare tool name, and it gets an "Approve" button that presses Enter in the tab (`app.js:904`, `main.js:426`). That would pick whichever option is highlighted.
- **20–34% of "done" signals are false.** These are turns that end and then resume on their own (11.4–23.4 per day; see #3).
- **The user's own pet has not moved TTA.**
  - It was born 2026-09-25 19:48Z, runs muted (no OS banners), uses `alerts=done`, and Setup is not finished.
  - In its 6 days, TTA median went 178 → 191 s, mean 693 → 659 s, p90 1,709 → 2,088 s (n = 116 each). Unchanged.
  - Meanwhile the block rate went from 5.5 to 21.1 per day.

## Method

**Attention-switch model** (`tools/feature_rank.py`):

- When the user prompts another session while block B waits, they are at the keyboard and choosing what to do next.
- If B is visible as "needs you" at that moment, the user attends B with probability c, and B is answered h seconds later.
- Saving(B) = actual end − expected counterfactual end.
- The policies differ only in when B is visible: "today" uses the rules above; "queue" shows B from its start until it is answered.

What the model does not credit:
- Only observed switch moments count. The 63% of blocks with no prompt elsewhere get no credit.
- The unobservable time between physically returning and typing the first prompt is not counted either.

**Calibration.**
- At c = 0.5 the model predicts that today's pet alone would cut mean TTA from 676 to 374 s. The pet era shows no change.
- So a passive, muted pet gets c ≲ 0.15.
- Central values: **c = 0.1, h = 30 s**. The sensitivity grid covers c ∈ {0.05, 0.1, 0.25, 0.5, 1} and h ∈ {15, 30, 60}.

**Ceiling (natural experiment).**
- Blocks that start with 2 or more live sessions wait 729 s on average, against 472 s with one live session.
- That is a multi-session tax of 258 s per block × 6.13 such blocks/day = **1,581 s/day**.
- No detection feature can save more than this tax plus the away share.

## 1. Attention queue (rank 1)

**Scope**
- One list of every blocked session, oldest block first.
- True block start, taken from the record timestamp or the registry's `statusUpdatedAt`, plus a "blocked 14m" timer and the exact ask.
- A blocked session is never dropped: no 5-min park and no 45-min skip.
- AskUserQuestion and ExitPlanMode are classified by tool name immediately.
- Permission prompts come from the CLI registry `~/.claude/sessions/<pid>.json` (`status: waiting`, `waitingFor: permission prompt | input needed`). Today 2 of 20 sessions showed it live.
- "Done" rows go below the blocks and also stop vanishing at 5 min.
- One order for Home, the roster and the jump key.

**Mechanism**
- **Detection (the main effect).** The 61% of blocked time that is hidden today becomes visible. At c = 0.5:
  - persistence gives 574 of 627 s/day (92%);
  - instant ask/plan/permission detection adds 53.
- **Decision.** The ask is shown in plain words, with the real age. Today the row says "AskUserQuestion" and stalled ages are 90 s short.
- **Action.**
  - The jump key walks the queue oldest-first: one key.
  - Actions depend on the kind of block: Reply (question), Answer in tab (AskUserQuestion), Approve (permission prompt or plan).
- **The sort itself barely moves the mean.** Answering in a different order doesn't change the total waiting. It helps the tail: 1.8 times a day the user answered a younger block while an older one in another session kept waiting, for a median 397 s more.

**Arithmetic (last 30 d, c = 0.1, h = 30 s)**
- 66.3 s/block × 7.73 censored blocks/day = **513 s/day**.
- Across the full grid: 45–87 s/block, **349–673 s/day**.
- Pre-pet period (Sep 1–25): 54.5 × 4.83 = 263 s/day.
- At the pet era's rate of 19.3 blocks/day: 78 × 19.3 = **1,509 s/day**.
- By class (c = 0.5): questions 568, AskUserQuestion 50, approvals 10 s/day.
- By host (c = 0.5): CLI 466, desktop 161 s/day.

**Modelled TTA (Monte Carlo, c = 0.1)**

| | mean | p90 |
|---|---|---|
| History | 676 s | 2,041 s |
| Today's pet | 546 s | 1,503 s |
| Queue | 476 s | 1,195 s |

**Confidence: medium.** The mechanism is certain, because the hidden-time figures are counts. The magnitude rests on c.

**Build cost: S–M, about 1 day, about 250 lines.**
- `agents.js`: classify (park rule at :161, stall rule at :159, ask text at :41-44) and scan (the skip at :271).
- A registry reader.
- `main.js` snapshot: add `blockedAt` and `kind`.
- `app.js`: `pending` (:123), `byUrgency` (:893), row actions (:904).
- Tests.

**Dependencies**
- **Desktop sessions have no registry entry.** They are 24% of blocks in the last 30 d (62 of 258) and 50% all-time.
  - Detection by tool name works for them; other permission prompts keep the 90 s rule.
  - Jump can only open the app, and reply is impossible.
- **Action paths depend on the host.**
  - The user's 15 live claude processes outside the fleet all run in Ghostty, not tmux. The 5 tmux processes are the fixture fleet.
  - In Ghostty, jump and reply need Accessibility (the OSC-2 tag path, `agents.js:381`).
  - Fleet proofs need a tmux path, which doesn't exist today. The registry has a `tmux` field to build it on.
- **Fix the AskUserQuestion "Approve = Enter" hazard** before any Approve button goes on the queue.

## 2. "While you were away" digest (rank 2)

**Scope.** When the user returns after 20 min or more with no input (or the Mac wakes or unlocks), the pet shows one card:
- who needs you, oldest first, with the ask and its age;
- who finished, with the receipt (files, check ✓/✗);
- what is still running (loops, background work).

**Mechanism.** Detection and decision latency at the moment of return. It does not shorten the away time itself.

**Arithmetic (last 30 d)**
- 4.77 returns per day.
- Blocks still pending at a return: 20 in 30 d, or 0.67/day.
  - 8 of the 20 were answered by the return prompt itself.
  - The delay after returning: median 62 s, mean 235 s, p90 643 s.
- A pop-up the user acts on half the time (c = 0.5, items handled 30 s apart): 107 s × 0.67 = **71 s/day**. At c = 1: 142. At c = 0.1: 14.
- Once #1 ships, the queue already shows these blocks at the return and earns the c = 0.1 share. So the digest's own TTA saving is 71 − 14 = **57 s/day** (85 s × 0.67).

**Not TTA, but real**
- 3.13 finished sessions per day are waiting at a return. Their mean wait for the next prompt is 557 s. At c = 0.5 the digest saves 834 s/day of idle-session time.
- 21 blocks in 30 d (0.7/day) were still unanswered at the user's first return and then waited 2 h or more beyond it. These are likely deliberate deferrals, but the digest is the one place they would be named.

**Confidence: low.** Only 20 blocks. The catch-up time between physical return and the first prompt, where a digest helps most, is invisible in transcripts.

**Build cost: M, about 1 day, about 200 lines.**
- An away detector: powerMonitor idle, lock and resume, plus an env override so the fleet test can fake a return.
- An accumulator on `transition()` in `main.js`.
- A digest card that reuses the receipts.

**Dependencies**
- #1's persistence. Without it, blocks older than 5 min (questions) or 45 min (others) are gone before the user returns.
- #3's row states, for the "still running" line.
- Works for desktop sessions too, because it only reads transcripts.

## 3. Loop-aware rows, scoped to "resumes on its own" (rank 3)

**Scope**
- A session that ended its turn but will continue without the user never shows "done". Instead it shows:
  - "sleeping · wakes 14:32" for ScheduleWakeup, read from the tool result's `scheduledFor`;
  - "waiting on 2 background tasks" for a pending `run_in_background` call, Agent call or workflow handback.
- Once `scheduledFor` plus a grace period passes with no new record, the row flips to "loop overdue".
- These sessions get no agentDone bubble.

**Mechanism.** Removes false "done" signals: each one is a wasted check, and the noise teaches the user to ignore the pet. Direct a+b+c TTA saved is 0, because no block gets shorter.

**Arithmetic (last 30 d)**
- **ScheduleWakeup only (the narrow reading).**
  - 74 effective calls in 3 sessions.
  - 47 false "done" signals (1.57/day, in 2 sessions), each shown for a median 168 s.
  - Of the 74 calls, 66 woke early from a task notification or agent handback, 4 fired on time, 1 fired late and 3 were cut short by the human.
  - Stalled loops: 0 in the last 30 d. All-time there were 11: in 8 nobody typed anywhere during the stall, and in the other 3 the first prompt elsewhere came 2–6 h later. A pet flag would have saved about 0.
  - At 10 s per false "done" checked: 1.57 × 10 = 16 s/day.
- **All self-resumes (the scope above).**
  - Turns that ended and then resumed with no human, shown as "done" for 3 s or more: 23.4/day across 91 sessions. That is 34% of all "done" signals.
  - Excluding agent handbacks, which `fanout()` often already shows as working: 11.4/day (20%).
  - Lasting 30 s or more: 6.4–14.2/day.
  - At 10 s each: **64–142 s/day** of checks.

**Confidence.** Medium on the counts. Low on the 10 s cost per false "done".

**Build cost: S–M, about 0.5–1 day, about 150 lines** in `agents.js` (pending ScheduleWakeup and pending background tasks) and the row renderer.

**Dependencies**
- Fleet member ember (/loop) must use dynamic ScheduleWakeup. CronCreate has 0 uses in the data.
- A fleet member with a background task is needed to prove the "waiting on background task" state.

## 4. Spend burn per session (rank 4)

- **Mechanism:** none on TTA. Spend is not a wait state.
- **Arithmetic:** 0 s/block × 7.73 = 0.
- **Context:** $2,076 in 30 d ($69/day). Per session: median $2.99, p90 $42, max $417. Useful for cost, not for attention.
- **Build:** S. Use message usage × the price table in `mineA.js`, or Claude Code's own `cost-state` record, which is present in 169 of 356 sessions.
- **Confidence:** high that the TTA saving is 0.

## 5. Batch-approve identical calls (rank 5)

- **Mechanism:** action latency, turning k approvals into 1 click.
- **Arithmetic:** the ground truth found 0 identical tool calls blocked in two sessions at overlapping times, by both exact and coarse keys. So 0 s/day.
- **Even a broader "approve all pending" barely applies.**
  - Across any tools there was 1 overlapping pair of human-shown approvals in 30 d.
  - The 27 approvals were 15 Bash rejections and 12 plan approvals. Neither kind is batchable.
  - 96% of tool calls run in auto mode, which never shows an Edit or Write prompt.
- **Build:** M–L. Needs registry detection, call identity, an approve path for each host (Ghostty Accessibility keystrokes, tmux `send-keys`, nothing for desktop), and a never-the-wrong-window guard.
- **Confidence:** high that the saving is about 0.

## Is there a more valuable sixth feature?

**Away ping** (a phone push when a block is waiting and the Mac is idle).
- The away share is 35% of blocked time, or 1,814 s/day, plus 0.87 blocks/day that wait over 2 h.
- At a 10% response rate it would save about 181 s/day, more than #2 and #3 combined.
- The case is not overwhelming:
  - the response rate is unmeasured;
  - the user muted their pet's OS banners, which suggests low appetite for interruptions;
  - it can't be proven on the fleet without a phone.
- It is the best Round 2 candidate. Swap it in for #3 only if an unproven rate is acceptable.

**Persistent "done" rows** (not TTA).
- Applying #1's persistence to "done" rows saves 2,450 s/day of idle-session time (38 finished turns/day, at c = 0.5).
- Fold this into #1, with done rows below the blocks, rather than building a separate feature.

## Reproduce

```
node docs/ultra/tools/mineA.js --cutoff 2026-10-01T20:00:00Z --out $TMP/mineA.json --dump $TMP/a.jsonl
python3 docs/ultra/tools/feature_loops.py docs/ultra/round-0/feature-loops.json
python3 docs/ultra/tools/feature_selfresume.py docs/ultra/round-0/feature-selfresume.json
python3 docs/ultra/tools/feature_rank.py --dump $TMP/a.jsonl --loops docs/ultra/round-0/feature-loops.json --out docs/ultra/round-0/feature-ranking.json
```

## Caveats

- **The compliance value is weakly pinned down.** c is calibrated on a 6-day window (n = 116) in which the pet was muted and Setup unfinished. With the queue's persistent, ordered list, compliance could be higher. The per-block saving stays within 45–87 s for every c from 0.05 to 1, because persistence matters most when compliance is low.
- **Approval counts are a floor.** Approved Bash prompts leave no transcript marker. The registry fixes this from now on, but not for the history.
- **The host census is a snapshot.** It reflects today's processes (15 Ghostty, 5 tmux in the fleet), not historical hosting.
- **One overlap is assumed.** That `fanout()` already covers agent handbacks is assumed, not measured. That is why #3's range runs from 11.4 to 23.4 per day.
- **The 10 s cost per false "done" is an assumption.** At 5 s or 15 s per check, #3 comes to 32–213 s/day.
