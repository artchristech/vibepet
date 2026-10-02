# S4 Row actions (jump / approve / reply / replay / goal / done): flow log

Date 2026-10-02, times UTC. Every action is a real input on the pet window (trusted mouse clicks, key presses, drags, hover). Latencies come from the app's own IPC records and DOM polling (16–25 ms). The load average (1/5/15 min) sits next to each timing in `timings.json`, which has the medians and n.

## Setup

- **App:** the app under test, launched through the test harness. It watches an isolated Claude root that holds only the fixture fleet, with its own profile (setup done, muted, alerts "all"). Home opens with one click on Net (median 418 ms, n=3).
- **What the harness records instead of doing:** in the main process, clipboard writes, `openExternal` and native dialogs are recorded but not carried out, so the operator's clipboard and screen stay untouched. Everything a write would have put on the clipboard is quoted below.
- **Fleet:** six real Claude Code sessions (Haiku) running in tmux:

| member | state it holds |
|---|---|
| kestrel | permission prompt |
| beacon | AskUserQuestion |
| vibepet | finished turn |
| atlas | long build |
| delta | 3-subagent fan-out |
| ember | /loop |

- **Ground truth:** `fleet status --json` (registry, transcript tail, pane) and the fleet transcripts.
- **Terminal:** for the jump checks, a Terminal.app window held a tmux client attached to kestrel's session, in the background (01:53–02:16).

## Ground truth at start (01:47) vs. Home → shot 01

| member | truth (registry / pane / transcript) | Home row |
|---|---|---|
| kestrel | `waiting (permission prompt)` for 74 min. The pane shows "Bash command ./deploy.sh --dry-run … Do you want to proceed? 1. Yes 2. Yes, and don't ask again for: ./deploy.sh * 3. No". The transcript's last record is the user prompt: the pending tool_use was not written. | none |
| beacon | `waiting (input needed)` for 74 min. The pane shows "Which database should beacon use to store check results? 1. SQLite 2. Postgres 3. Redis 4. Type something. 5. Chat about this". Last record is the user prompt. | none |
| vibepet | `idle` at its prompt: turn finished 46 min earlier, a plain statement | none |
| atlas | `idle` (last turn interrupted) | none |
| delta, ember | claude not running | none (correct) |

**Home said:** "No live sessions. Start Claude Code anywhere and I'll pick it up."

**Effect on this surface:** two sessions were blocked on the user and two more were live, but there was no row, so no action could be taken on any of them.

## F1 Jump (click a row's title) → shots 02–09

**Steps:**
1. Click the row's title (not a button).
2. Wait for the jump result.
3. Read the frontmost app and the tmux client's session/pane before and after.
4. Screenshot.

Repeated 3× per member, 6 members.

**Expected:** the terminal that shows the session comes forward. Here that means Terminal.app with its tmux client switched to that session's pane. If the pet can't do that, it says so where the user is looking.

**Actual: FAIL in 18 of 18 jumps.**
- **Result:** every jump returned `{ok:false}`.
- **Clipboard:** each wrote `cd ~/.vibepet-ultra/fleet/<member> && claude --resume <session-id>`.
  - That command starts a second `claude` on a session that is still live in its pane.
  - This happened on rows of live sessions: kestrel, beacon, atlas, delta and vibepet.
- **Frontmost app:** unchanged in 18 of 18.
- **tmux client:** stayed on kestrel's session in 18 of 18, including jumps to beacon, atlas, delta, ember and vibepet.
- **Feedback:** the only feedback was a bubble, "<member>: couldn't find its terminal — resume command copied", drawn behind the open panel.
  - The element on top at the bubble's centre was the panel in 18 of 18.
  - It shows only as faint text under the chat input (shots 03, 04, 06–09).
  - Nothing appeared inside the panel.
- **Timing:** click → result median 154 ms (n=18, 102–393 ms).

| member | true state at the jump | row shown | jump result |
|---|---|---|---|
| kestrel | waiting (permission prompt), 2–11 s into a fresh episode | running "kestrel · 0s…9s" | fail ×3 |
| beacon | waiting (input needed) from 01:54:41 | running "beacon · 3s…9s" | fail ×3 |
| atlas | busy, build.sh running | running "atlas · 0s" | fail ×3 |
| ember | claude not running (exited) | running "ember · 34s" | fail ×3; resume command (right for an exited session; its "running" label is wrong) |
| delta | busy, fan-out | running "delta · 2m 4s" | fail ×3 |
| vibepet | idle, turn just finished | ready "vibepet · done 2m ago" | fail ×3 |

## F2 Approve kestrel (permission prompt) → shots 02, 10, 11, 12

Two fresh episodes: Esc on the old dialog (no API call), then the arm prompt again (01:54:39 and 02:03:50).

**Expected:**
- an Approve on kestrel's row while the dialog is up;
- pressing it runs `./deploy.sh --dry-run`, which shows up as a tool_result in the transcript.

**Actual: FAIL. Approve was never offered.**
- **Registry:** `waiting (permission prompt)` 1.6–2.0 s after each prompt.
- **Transcript:** kept the pending tool_use back (last record = the prompt).
- **Pet row:** "kestrel · 0s" appeared 0.5–0.8 s after the registry flip. It read **running** (green) with ▶ ✓ ◎, and counted up as running.
- **Removal:** the row was removed 120.6 s and 120.9 s after the flip, while the registry still said `waiting (permission prompt)` and the pane still showed the dialog.
- **Afterwards:** no row, no bubble, no Approve anywhere (shots 10–12). About 240 s were watched in total.

**Approve's code path, probed directly** (an IPC call, not a UI flow):
- `send-to(kestrel, Enter)`, the call Approve makes, returned `{ok:false, why:"couldn't find its tab"}` in 89 ms;
- kestrel stayed at its dialog.

**Fleet afterwards:** kestrel is back in its approval state after each episode (status OK).

## F3 Answer beacon's AskUserQuestion → shots 02, 10

Fresh episode at 01:54:39. Registry `waiting (input needed)` at 01:54:41.4.

**Expected:** the question and its options on the row, or a Reply, answerable from the pet.

**Actual: FAIL.**
- **Row:** "beacon · 0s" read **running** with ▶ ✓ ◎. There was no Reply, no options and no question text.
- **Removal:** removed at +120.0 s while still waiting (shot 10).
- **Probe:** `send-to(beacon, Enter)` returned `{ok:false, why:"couldn't find its tab"}` (87 ms). Even where Approve is offered, Enter would pick whichever option is highlighted.

**Fleet afterwards:** beacon is back in its question state.

## F4 Reply to a plain end-of-turn question (kestrel) → shots 13–16

**Prompt (02:00:07):** "Ask me one short yes/no question about this project … ending with a question mark."

**Truth:** end_turn "Should the deploy script have unit tests?" at 02:00:09.6, registry `idle`.

**Row:** "Deploy.sh dry run · kestrel · waiting 1m", with Reply ▶ ✓ ◎ and the question as its ask line. It appeared 2.3 s after the end_turn (shot 13).

**Steps, ×3:**
1. Click Reply. The box opens and has focus in 1–2 ms.
2. Type "yes".
3. Press Enter.

**Expected:** the answer reaches the session (a new user record in the transcript, then a new turn).

**Actual: FAIL in 3 of 3.**
- **Note:** "Couldn't send: couldn't find its tab", 136 ms after Enter (median, n=3).
- **Session:** 0 new transcript records; the registry stayed `idle`.
- **The box:** stays open showing "yes" (the panel doesn't redraw while the box has focus; shot 15).

**Focus check (shot 16):**
1. With the reply box open, click into the chat input.
2. Type "what is atlas doing" at a normal pace (7 s).

- **Result:** the chat input ended with "what ". The other words, "is atlas doing", landed in kestrel's reply box.
- **Cause:** at the next 3 s redraw, focus jumped into the reply box mid-word. Enter at that moment would send those words to kestrel as a reply.

## F5 Replay (▶) → shots 17–19

- **Kestrel's row ▶ (02:01:50):** opened Theater on kestrel's session. The title reads "Run exactly ./deploy.sh … kestrel · 02:19 PM · 5.7h real → 3:15 replay", with 25 prompts.
- **vibepet's ready row ▶, clean slate, 3 opens closed in between:**
  - window in 139 ms and beats drawn in 176 ms (medians, n=3, load 3.1–3.4);
  - right session: "Theater — vibepet", 50 beats;
  - reopening the same row reuses one window (3 clicks → 1 window).
- **Roster ▶:** window in 119 ms.

**Result: PASS** (right session, fast).

**Caveat:** every replay starts at "Session start", 5.7–5.8 h back (0:00 of 3:35 at 4×). The turn that needs you is the last beat, 3+ minutes of playback away (shots 17, 19).

## F6 Goal: set, edit, clear, where shown, restart → shots 20–24, 28–29

**Steps on kestrel's row:**

| step | what was in the chat input | result |
|---|---|---|
| ◎ | prefilled with "/goal " (auto goal = the first prompt) | 2 ms |
| set | "/goal Goal One: answer the test question" + Enter | row line "◎ Goal One…" + note "Goal for Deploy.sh dry run: …" (shot 20) |
| edit | ◎ prefilled the current goal, replaced with "/goal Goal Two: add the missing test" | shot 21 |
| clear | "/goal " | reset to the first prompt + note "…reset to its first prompt." (shot 22) |

- **Enter → row updated:** median 353 ms (n=14).
- **Where the goal shows:**
  - the row's goal line;
  - the hover roster (shot 28; click → inline editor → saved in 731 ms incl. typing, shot 29);
  - the Today note (shot 24).
- **Restart:** "Goal Three: persist me" was set, then the app quit and relaunched on the same profile. The goal was still on kestrel's row (shot 23). Relaunch 883 ms, Home 418 ms.

**Result: PASS**, with two notes:
- ◎ on an auto goal gives an empty "/goal ", so the guessed goal can't be edited, only retyped.
- The edit happens in the chat bar at the panel's bottom, not on the row.

## F7 Done (✓) → shots 25–27, 30

- **✓ on "Goal Three":**
  - the line turned "✓ Goal Three: persist me" in 249 ms and the ✓ button disappeared;
  - a ledger "goal_done" was written and +15 xp awarded;
  - the "goal hit … +15xp" bubble rendered behind the panel (occluded).
- **9 ✓ presses** (goal re-set before each, random tick phase, while atlas's build was running and its row stayed at "atlas · 0s"): all took on the first click, median 260 ms.
- **Undo:** none on the row. The only way back is ◎ → "/goal " → Enter (reset to the first prompt), and the reset does not undo the bookkeeping:

| after | Today said |
|---|---|
| marking, resetting and re-marking the same auto goal 3× | "Goals set: 12 · hit: 13" (more hits than goals) |
| repeated ✓ | 195 xp and a "LEVEL 3! unlocked" bubble, also behind the panel (shot 27) |

- **Layout shift:** after ✓, the row's buttons shift right and ▶ slides into the spot where ✓ was.
  - A second click on the same spot 250 ms or 400 ms later opened Theater (2 of 3; not at 600 ms).
- **Roster:** ⌥-click on the goal line marks it done in 45 ms (shot 30). The only hint is the tooltip.

**Result: PASS** for the action itself; FAIL on reversibility.

## F8 Actions a 5–15-session user needs but can't find

What each kind of row offered, against what the session needed:

| row (true state) | buttons offered | what the session's own UI offers |
|---|---|---|
| permission prompt (kestrel, registry `waiting`) | ▶ ✓ ◎ (shown as running), then no row | 1 Yes · 2 Yes, don't ask again · 3 No · Esc · Tab to amend |
| AskUserQuestion (beacon) | ▶ ✓ ◎, then no row | 5 options incl. "Type something" |
| plain question (kestrel) | Reply ▶ ✓ ◎ | free text |
| finished turn (vibepet, atlas) | ▶ ✓ ◎ | free text (the next instruction) |
| running (atlas build, delta fan-out) | ▶ ✓ ◎ | Esc to interrupt |

Missing from every row:
- deny (No / Esc);
- stop or interrupt a running or looping session;
- give a finished session its next instruction;
- answer one of a question's options;
- "Yes, and don't ask again";
- open the diff or changed files;
- act on several sessions at once;
- keyboard shortcuts for row actions.

## Exploration (about 10 min)

- **The 3 s redraw wipes interaction state.** Home rebuilds the list every tick, even when nothing changed:
  - a click whose press and release span a redraw is lost (0 of 2 at 3.3 s holds; 120 ms clicks 2 of 2);
  - keyboard focus on a row button is lost to `<body>` at the first redraw (2977 ms after focusing); Enter then does nothing;
  - a text selection in a row is cleared within 3.4 s.
- **Selecting row text counts as a click.** Dragging across a row's goal text fired a jump (1 call). On a failed jump that also rewrites the clipboard with the resume command.
- **Rows reorder under the pointer.** There were 6 order changes in 6.3 min with 4–5 rows. atlas jumped ahead of the other running rows because its clock restarted every tick ("atlas · 0s" for its whole build). Approve and Reply have no confirmation that names the session.
- **The ask line is nearly invisible.** The question or command you act on is pale yellow monospace on cream: 1.23:1 contrast measured on the screenshot (the title is 15.1:1). Shots 13–16, 20, 23.
- **Icon-only buttons.**
  - ✓ means "mark goal done", not "approve" or "dismiss";
  - ◎ means "set goal";
  - their meanings are only in tooltips;
  - on a blocked row ✓ sits next to Reply/Approve.
- **Hover roster (Home closed).**
  - It shows within 2 ms of hovering Net and lists only rows Home lists.
  - The blocked kestrel and beacon were absent (shot 28).
  - ▶ appears only on hover.

## Checks that held

- Jump, Reply and Approve each fail fast (≤ 0.4 s) and never type into any window.
- Theater opens the right session.
- Goals persist across a restart.
- ✓ took on the first click in 9 of 9 presses during atlas's build.

## Fleet hygiene

- **Turns this run caused:** 5 (kestrel 3, beacon 1, vibepet 1).
- **End state:** kestrel holds its approval and vibepet its finished turn. beacon was re-armed by another tester after this run's episode and holds its question.
- **Terminal:** the Terminal.app window and its tmux client were closed after the jump checks.
