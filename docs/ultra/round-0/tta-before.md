# Time to attention, before (Round 0)

**Question:** when a fleet session starts needing you, how long until the pet shows it, and can you act on it from the pet?

**Build under test:** `~/.vibepet-ultra/int`, `ultra/round-0` @ `c2b5c0a` (the app is main `649beb2` plus the harness overrides).

**Fleet:** live, real Claude Code 2.1.287 sessions on Haiku 4.5 in tmux.

**Tool:** `test/ultra/tta.js` on `ultra/r0-tta` @ `2851667`.

**Data:**
- raw trials and summary: `tta-before.json`;
- per-trial logs and screenshots: `tta-before/`.

## Result

| kind (member) | trials | detect: median (each trial) | action offered | actionable: median | clicks on the pet | resolvable from the pet? |
|---|---|---|---|---|---|---|
| approval (kestrel) | 3 | **none within 240 s** (—, —, 92.4 s) | Approve, 1/3, at 92.4 s | **never** | 2 (Net, Approve), and Approve fails | **No** |
| AskUserQuestion (beacon) | 3 | **none within 240 s** (—, 92.7 s, —) | Approve (the wrong action), 1/3, at 92.7 s; never Reply | **never** | 2 (Net, Approve), and it fails | **No** |
| plain end-turn question (vibepet) | 3 | **1.3 s** (0.9, 1.3, 1.4) | Reply, 3/3, median 1.3 s | **never** | 2 + typed answer + Enter (Net, Reply, text, Enter), and sending fails | **No** |
| done (vibepet) | 3 | **2.3 s** (2.1, 2.3, 2.6) | none (no Reply on a done row) | **never** | 1 (Net); nothing there resolves it | **No** (read-only via ▶) |
| /loop wakeup stalled on approval (ember) | 7 | **none within 200 s** (—, —, —, 100.9, 91.3, —, —) | Approve, 2/7, at 100.9 and 91.3 s | **never** | 2 would reach Approve (see note) | **No** |
| subagent blocked on approval (delta) | 3 | **never within 300 s** (—, —, —) | none | **never** | 1 (Net); no action | **No** |

**How to read the columns:**
- **detect** is seconds from the block's start to the first signal visible on the pet with Home closed: bubble, antenna LED or face.
  - The start is the transcript timestamp of the tool_use or end_turn.
  - When Claude Code withheld that record, the start is the registry's `statusUpdatedAt`. The two agree within 19–150 ms when both exist (549 ms once, under load).
  - "—" means no signal for that session within the window.
  - A median that lands on "—" is reported as none.
- **detect (Home open):** the second instance kept Home open. Its row changed on the same tick as the LED in every detected trial, so this column would repeat **detect**.
- **actionable** is the time until the pet offers an action that actually resolves the session. It is "never" in every kind: no Approve or Reply press reached a session.

## What happened, per kind

### approval (kestrel: Bash `./deploy.sh --dry-run`)

**Trials 1 and 2 never surfaced.**
- The registry said `waiting (permission prompt)` 1.7 s after the prompt.
- The pane showed the dialog.
- But Claude Code did not write the tool_use to the transcript while the dialog was up.
- So vibepet saw a user prompt and nothing after it. It showed kestrel as **running** for ~120 s, then removed it from Home (119.4 s, 121.8 s).
- No bubble, LED, row or banner. At the end of the window, Home had no row for kestrel.

**Trial 3: the record was written.**
- At **92.4 s**, everything fired on the same tick:
  - the LED and face turned red with "?";
  - the row turned stuck: "kestrel · stuck 1m", `Bash: ./deploy.sh --dry-run`, Approve;
  - an OS banner was recorded (the user was away);
  - the sound fired.
- The bubble "kestrel needs approval" appeared at 93.1 s.

**Pressing it:**
- Approve gave "Couldn't approve: couldn't find its tab". The registry stayed `waiting` and no tool_result appeared.
- The row click (jump) failed and copied `cd …/kestrel && claude --resume <id>` (intercepted).

**Control (trial 2):** approving in kestrel's tmux pane ran the command. The check saw a non-error tool_result, and the session was idle within 4.2 s. So the check detects a real resolution.

### AskUserQuestion (beacon)

**Trials 1 and 3:** the tool_use was withheld, exactly as for approvals. beacon showed as running and was hidden at ~120 s.

**Trial 2 (written):**
- At **92.7 s** it surfaced as **"beacon needs approval"**, red, stuck, ask `AskUserQuestion`, with **Approve**.
- There was no Reply, no choices and no "needs you" (yellow) state.
- If Approve worked, it would press Enter on whichever option is highlighted.
- Pressing it failed: "couldn't find its tab". The session stayed `waiting (input needed)`.

### plain end-turn question (vibepet)

**Detection:** it surfaced in **0.9–1.4 s** (median 1.3 s):
- the bubble "vibepet has a question" (with sound, and a banner while away);
- the yellow LED and face;
- the row "needs" with the question as its ask, and **Reply**.

The label reads "waiting 1m" one second in.

**Resolving it:** Reply, then "yes", then Enter gave "Couldn't send: couldn't find its tab" in all 3 trials. No user prompt reached the session.

### done (vibepet)

**Detection:** LED, face and row "ready" ("vibepet · done just now") appeared in **2.1–2.6 s** (median 2.3 s).

**The bubble "vibepet is done"** appeared in only 1 of 3 trials (2.9 s), and so did the banner.
- In the other two, the turn started and ended between two 3 s ticks.
- vibepet went waiting → ready without seeing running, and it only announces "done" after running.

**Resolving it:**
- A done row has ▶ ✓ ◎ but no Reply, so you cannot give the session its next instruction from the pet.
- ▶ opens Theater with the session's beats (34–42), which is read-only.
- The row click (jump) fails.

### /loop wakeup stalled on approval (ember: its own `/loop 5m run ./tick.sh`; an `ask` rule makes every fire wait on approval)

**Trials 1, 2, 4, 7 and 8 never surfaced.** The fire's tool_use was withheld from the transcript.
- In trials 1 and 7, ember read **running** for ~120 s, then vanished.
- In trial 2, it never appeared at all: its last record was the previous Esc.
- In trials 4 and 8, it read **"ember · done … ago"** (ready) for the whole stall, counting up from the previous turn to 7 m and 5 m.

**Trials 5 and 6 (written):** stuck with Approve at **100.9 s** and **91.3 s**, with the bubble "ember needs approval".
- The Approve presses in these two trials did not execute, on a Mac at load average 125:
  - trial 5: Home did not open within 15 s of the click on Net;
  - trial 6: Home took 4.6 s to open, then the click on Approve timed out after 30 s.
- So a loop Approve was not pressed in this probe.
- It is the same `send-to` path that failed in all 5 presses in the other kinds (tmux has no `.app` host).

**Trial 3 excluded:** after two rejected fires, the fire ended with a question instead of calling the tool.
- vibepet showed the LED and row "needs" with Reply 2.6 s later.
- There was no bubble until the 3-minute nag ("ember has waited on your answer 3m"), because ember came from parked, not running.

### subagent blocked on approval (delta: one subagent runs `touch shards/.probe`)

**What the fleet did:** in all 3 trials, the dialog opened in delta's pane within 4–5 s, with registry `waiting (permission prompt)`. The subagent's tool_use was written.

**What the pet showed:** delta stayed **running** with fan-out 1/1 open, 0 stuck, for the full 300 s ("delta · 5m 7s"), with no Approve.
- vibepet classifies a subagent once, when it first sees the file, and caches that by size and mtime (M5).
- A file that goes silent on a pending call therefore never turns stuck in a pet that was already running.

## Across kinds

**1. Withheld records are the main detection failure.**
- In 9 of 13 main-session dialogs, Claude Code kept the pending tool_use out of the transcript while the dialog was up: approval 2/3, AskUserQuestion 2/3, loop 5/7.
- vibepet reads only transcripts, so it showed nothing for those sessions, or showed them as running or done.
- The registry flipped to `waiting` in every dialog trial, including all 9 with a withheld record. Where the record exists, the flip came 19–150 ms after its timestamp.

**Right now:** kestrel and beacon are back in their fixture dialogs, and both records are withheld. A freshly launched pet lists neither: its smoke run showed 0 sessions.

**2. When the record was written, detection is ~91–101 s.** That is the 90 s silence rule plus the 3 s tick, in 4 of 4 trials.

**3. Nothing resolves from the pet on tmux.**
- Approve and Reply were pressed 5 times; all 5 gave "couldn't find its tab", and the session never changed.
- Jump failed on every row it was tried on (13 trials) and copied a `claude --resume` command.

**4. With Home open, the bubble is hidden behind the panel.** It was occluded in all 9 trials where the open-Home instance had one. Home's row is the only signal there.

**5. Banners** (recorded in test mode, never posted) fired on the same tick as the bubble while the user was away (idle over 60 s). They never fired for a session the pet did not see.

## Conditions and caveats

**Background fleet:** kept quiet. kestrel's and beacon's standing dialogs were dismissed (Esc) first, because the LED and face are shared: one stuck session holds the LED red for every other. Both were re-armed at the end (`fleet.js rearm kestrel beacon`).

**The pet instances:**
- Launched before each kind's trials, so they were long-running relative to every block. A freshly launched pet answers some kinds differently (M3, M5).
- The alerts setting was "done", the shipped default.
- Sound was on but recorded, not played.

**Interaction:**
- Clicks were trusted CDP mouse events on the pet window. The OS cursor was not used.
- The guard refused Approve/Reply for a GUI-hosted terminal. No fleet session had one.

**Timing resolution:** each time is ±0.25 s (the 250 ms poll), on top of the app's own 3 s tick.

**The user and the Mac:**
- The user was away for every other trial (system idle over 60 s: 69–111 min early on, 8–33 min for subagent and loop 7–8).
- During loop 4–6 the user was active at the Mac (idle 0 s), and other work drove the load average to 125.
- There was no sleep or wake during the probe.

**Spend:** the estimate went from $2.0475 to $2.5294, **+$0.48 of the $0.60 budget** (transcripts +$0.34). The running estimate peaked at +$0.52, before delta's exit wrote its own cost record.
- About $0.18 of it was the first subagent trial, on a cold cache.
- $0.015 was the aborted first run (`tta-before/aborted-1/`: a script bug; its trials are not counted).

**Windows:** approval and AskUserQuestion 240 s, question and done 120 s, loop 200 s, subagent 300 s. Detection was never seen beyond 101 s.

## Rerun for the "after" numbers

```sh
cd ~/.vibepet-ultra/wt/r0-tta   # or any checkout with test/ultra/tta.js
E=/Users/christopherharris/projects/vibepet/docs/ultra/round-N
node test/ultra/tta.js --app <fixed worktree> --out $E/tta-after --plan approval:3,askuser:3 --quiet kestrel,beacon
node test/ultra/tta.js --app <fixed worktree> --out $E/tta-after --plan question:3,done:3 --interleave
node test/ultra/tta.js --app <fixed worktree> --out $E/tta-after --plan loop:3
node test/ultra/tta.js --app <fixed worktree> --out $E/tta-after --plan subagent:3
node test/ultra/tta.js --report $E/tta-after --json $E/tta-after.json --full
```

**Before running a fixed build:** once Approve or Reply can reach tmux, a trial resolves the session for real. The teardown then finds no dialog and moves on.

**Budget:** roughly $0.30 (estimate incl. hidden calls) for the set with warm caches. delta's first turn after an hour costs about $0.12 more.
