# Net Home panel: evidence log

## Setup

- **App:** the real vibepet (Electron), launched through the test harness. It watches an isolated Claude root that holds only the fixture fleet, so the user's own sessions never appear.
- **Profile:** fresh, so the first click shows the first-run Setup card. Shipped defaults: alerts "+ Finished", sound on. Sounds are recorded instead of played, and OS banners are recorded, not posted. Global keys are off in this test instance.
- **Screen:** 1440×900 at 2x, work area 1440×816. The pet window is 660×816 at the bottom right (x 756, y 25).
- **Appearance:** macOS is in Dark mode, but the harness page defaults to light. Shots 01–07 are light. From shot 08 on, dark is emulated to match the OS. Shot 22 is light again, for comparison.
- **Input:** clicks and keys are trusted input events sent into the pet window. The user's real cursor and keyboard are never used.
- **Polling:** the Home DOM and the app snapshot are read every 250 ms. Each change is logged with a timestamp.
- **Truth:** `fleet status --json` (registry status, waitingFor, statusUpdatedAt, last transcript record, tool processes) plus each member's transcript tail. All times are UTC.
- **Load:** the 1-minute load average (laptop shared with other work) is in `timings.json` next to each timing. It ranged from 1.8 to 10.1 during the run.

### Fleet: six real Claude Code sessions (Haiku, in tmux)

| member | state it is held in | what the user should see |
|---|---|---|
| kestrel | approval: Bash `./deploy.sh --dry-run` waits on a permission prompt | needs you: approve, with the command |
| beacon | AskUserQuestion: "Which database should beacon use…" (SQLite / Postgres / Redis) | needs you: answer, with the question |
| vibepet | done: turn finished with a plain statement, idle at its prompt | done, your move |
| atlas | working: `./build.sh` runs in the foreground for about 9 min | running, with time since start |
| delta | fan-out: 3 subagents each run `./slow.sh` (~150 s) | running, 3 subagents open |
| ember | `/loop 5m run ./tick.sh`: idle between fires | looping/scheduled, not done and not waiting on you |

---

## F1: open, close, reopen

**Steps**
1. Single click on Net, then Esc. Repeated ×5.
2. Double click on Net, then the header "esc" button. Repeated ×3.
3. Click Net to open, click Net again to close. Repeated ×3.
4. Click-away. A real click-away blurs the window, but this test instance never holds the OS focus, so a synthetic window blur was dispatched instead (emulated).

**Expected:** the panel opens in ≤ 150 ms and closes at once.

**Actual**

| action | median | samples |
|---|---|---|
| single click → panel shown | **221.4 ms** (n=5) | 220.2–222.6 ms |
| single click → first painted frame | **236 ms** (n=5) | — |
| single click → panel detected (wall clock, incl. input dispatch) | 373 ms (n=5) | — |
| double click → painted | 20.9 ms (n=3) | — |
| Esc → hidden | 14 ms | — |
| "esc" button → hidden | immediate | — |
| second click on Net → hidden | 233 ms | — |
| emulated blur | closes Home | — |

- Every single click waits a fixed ~220 ms (the gap between mouseup and the panel appearing is constant) before Home shows.
- Reopening keeps the composer text. I typed "tell kestrel to wait for me", pressed Esc and reopened: the text was still there.

**Result**
- Speed: **FAIL** (236 ms > 150 ms).
- Close paths and reopen: PASS.

---

## F2: truth table, every member vs. its row

### (a) As found, 01:52:09Z (shots 01, 04, 05)

Home said **"No live sessions. Start Claude Code anywhere and I'll pick it up."** The pet was calm with a grey LED (shot 01).

| member | truth | Home row | verdict |
|---|---|---|---|
| kestrel | permission prompt open since 00:32:53Z (**79 min**). The registry says `waiting · permission prompt`. The last transcript record is the user prompt (the pending tool_use is not written while the dialog is up). | none | **WRONG**: missing |
| beacon | AskUserQuestion open since 00:32:56Z (**79 min**); `waiting · input needed` | none | **WRONG**: missing |
| vibepet | turn ended 01:01:01Z (51 min), idle at its prompt | none | **WRONG**: missing |
| atlas | paused: idle, not in its working state | none | ok |
| delta | paused: claude not running | none | ok |
| ember | /loop, idle since 01:48:23Z (3.8 min) | `ember · done 4m ago`, yellow dot | **WRONG**: a loop reads as "done" |

### (b) All six in state, 01:58:43Z (shots 13, 14, 15)

| member | truth | Home row | verdict |
|---|---|---|---|
| kestrel | fresh permission prompt open since 01:54:40.8Z (4.0 min). tool_use not written. | none | **WRONG**: missing |
| beacon | fresh AskUserQuestion open since 01:54:41.4Z (4.0 min) | none | **WRONG**: missing |
| vibepet | turn ended 01:55:03Z (3.7 min) | ready · `vibepet · done 4m ago` · ▶ ✓ ◎ | ok |
| atlas | build running since 01:53:55Z (**4 min 50 s**), 3 tool processes | running · `atlas · 0s` | **WRONG**: age 0 s |
| delta | 3 subagents running (busy since 01:58:09.7Z), 9 tool processes. The app's own snapshot has fan-out 3 total / 3 open. | running · `delta · 33s` | partly: state and age right, but **no fan-out gauge or subagent count** in the row |
| ember | /loop. Fires at 01:53:07Z and 01:57:52Z (each turn 2.2 s); idle since 01:57:54.7Z (**49 s**) | ready · `ember · done 10m ago` | **WRONG**: shown as done; age 10 min vs 49 s |

- **Fold:** only 3 of the 4 rows fit in the Now box. delta's row is cut in half.
- **Footer:** Record, Today and both localhost servers are below the fold (shot 14). They show only after scrolling (shot 15).
- **Empty space:** about 250 px of empty chat area sits under the box the whole time.

### (c) 02:00:52Z: ember exited, delta finished, kestrel ended a turn with a question

| member | truth | Home row | verdict |
|---|---|---|---|
| kestrel | end_turn at 02:00:09.6Z: "Should the deploy script have unit tests?" (42 s ago) | needs · `kestrel · waiting 1m` · ask = the question · Reply ▶ ✓ ◎ | ok. The age rounds 42 s up to "1m". |
| vibepet | idle at its prompt, turn ended 5.8 min ago | none: removed at 02:00:05Z | **WRONG**: missing |
| atlas | build running 7 min | `atlas · 0s` | **WRONG**: age |
| beacon | AskUserQuestion open 6.2 min | none | **WRONG**: missing |
| delta | turn finished 02:00:48.9Z | ready · `delta · done just now` | ok |
| ember | exited at 01:59:35.9Z: no claude process, registry gone | running · `ember · 1m 13s` | **WRONG**: a dead session shown as running |

### (d) 02:08:29Z (shots 18, 19)

**Truth:**
- kestrel: permission prompt open since 02:03:49Z (4.7 min).
- beacon: question open 13.8 min.
- vibepet, atlas and delta: idle at their prompts (13, 5.5 and 7.7 min).

**Home:** "No live sessions." At 02:17:41Z the closed pet was calm with a grey LED while kestrel and beacon were still blocked (shot 24).

**Result: FAIL.**
- Members that need the user are missing in every snapshot.
- A loop reads "done".
- A dead session reads "running".
- Long-tool and loop ages are wrong.
- No fan-out information.

---

## F3: does the panel lead with what needs me, oldest wait first?

**Case 1: question at the end of a turn (kestrel), 02:00:11Z–02:03Z (shot 16).**
- Expected: a needs-you row on top, with the ask and an action.
- Actual: the row led the list, tinted amber, with the question in plain words ("Should the deploy script have unit tests?") and a Reply button. Net's LED turned amber.
- Result: **PASS** for this case.

**Case 2: permission prompts and AskUserQuestion (kestrel, beacon), 5 episodes in this run.**
- Expected: on top, with the command or question, and Approve or Reply.
- Actual: never listed (F2, F4). With them hidden, Home leads with done and running sessions.
- Result: **FAIL**.

**Case 3: order within a rank.**
- Expected: the longest wait first.
- Actual: newest first, so the longer-waiting session sinks.
  - At 02:02:59Z, `atlas · done just now` was listed above `delta · done 2m ago` (shot 16).
  - At 02:03:53Z, `atlas · done 1m ago` was listed above `delta · done 3m ago` (shot 17).
  - Both rows' ages were right at those moments (atlas finished 02:02:57Z, delta 02:00:49Z).
- Result: **FAIL**.

**Case 4: is the wait visible?**
- "waiting 1m" at 42 s and "waiting 3m" at 2 min 50 s: minute rounding, minimum 1m.
- Approvals and AskUserQuestion get no wait at all, because they have no row.
- Result: partial.

**Case 5: Net's bubble while Home is open.**
- 02:02:59Z: "atlas is done" was drawn **behind** the panel. The element at the bubble's centre is the composer (shot 16: faint text under the input).
- Result: **FAIL**.

**Case 6: row click = go to that session's terminal (atlas, a tmux session).**
- The jump returned `ok:false` after 171 ms. A `cd … && claude --resume <id>` command was written to the clipboard (intercepted by the harness).
- The only feedback was the bubble "atlas: couldn't find its terminal — resume command copied", hidden behind the panel. The row itself shows nothing (shot 17).
- Result: **FAIL**.

---

## F4: live latency (Home open, DOM polled every 250 ms)

**Block start:**
- For approvals and AskUserQuestion: the registry's `statusUpdatedAt` when it turned `waiting`. In all 4 dialog trials the transcript did not contain the pending tool_use while the dialog was up.
- For finishes: the end_turn record's timestamp.

| # | kind | member | block start | first matching row | result |
|---|---|---|---|---|---|
| 1 | approval (fresh prompt after re-arm) | kestrel | 01:54:40.790Z | none. "running · kestrel · 0s…1m" from −0.5 s to 119.5 s, then the row was removed | **never** |
| 2 | approval (fresh prompt after re-arm) | kestrel | 02:03:49.383Z | none. "running" from 0.9 s to 121.0 s, then removed. Shot 17 shows it as running (green) at +4 s. | **never** |
| 3 | AskUserQuestion (fresh after re-arm) | beacon | 01:54:41.359Z | none. "running" until 119.0 s, then removed | **never** |
| 4 | AskUserQuestion (old dialog dismissed, re-armed) | beacon | 02:13:42.729Z | none. "running · beacon · 1m 3s" with a green dot (shot 21), removed at 119.0 s | **never** |
| 5 | question at end of turn | kestrel | 02:00:09.598Z | needs + Reply + question text at +1.454 s | 1.45 s |
| 6 | finished turn | ember (loop fire) | 01:48:23.720Z | done at +1.165 s | 1.17 s |
| 7 | finished turn (2.2 s turn) | ember (loop fire) | 01:53:08.983Z | none. Never shown running; the row kept "done 5m ago" | **never** |
| 8 | finished turn (2.3 s turn) | ember (loop fire) | 01:57:54.638Z | none. The row kept "done 9m ago" | **never** |
| 9 | finished turn | vibepet | 01:55:03.362Z | done at +0.812 s | 0.81 s |
| 10 | finished turn | delta (after its 3 subagents) | 02:00:48.941Z | done at +1.384 s | 1.38 s |
| 11 | finished turn | atlas (9-min build) | 02:02:56.993Z | done at +2.170 s | 2.17 s |

**Approval and AskUserQuestion: FAIL.**
- 0 of 4 dialogs were ever shown as needing the user.
- Each dialog showed as "running" for 2 min, and then the session was removed from Home while the dialog was still open. The registry turned `waiting` 1.3–1.7 s after each prompt was sent.

**Finished turns: 4 of 6 detected, median 1.27 s.**
- The two misses were turns shorter than the 3 s refresh.

---

## F5: parked (done and idle for more than 5 min)

- **vibepet:** removed from Home 301.7 s after its turn ended (02:00:05Z). At 01:52Z (51 min done) it had no row at all.
- **atlas:** removed 302.6 s after its build finished (02:07:59Z).
- Both stayed alive at their prompts the whole time (registry `idle`).
- **Typing `/jump vibepet`:** "No session matches 'vibepet'." (shot 10). `/jump kestrel` and `/jump beacon` give the same answer (shot 11).
- **The only place these sessions still appear:** ⋯ → Theater… lists kestrel, beacon and vibepet, as replays only.
- **No "idle" group, no "N hidden" count, no filter.**
- **For someone juggling 10 sessions:** every finished session quietly leaves the panel after 5 min, so "your move" sessions cannot be found from the pet.
- **Result: FAIL.**

---

## F6: other sections

### Setup card (first run, shots 02, 03; Size Large, shot 20)

**What works**
- Clean layout, legible.
- Pet, Size, Feel and Alerts segments respond in 51–71 ms.
- Done → Now list in 34 ms.
- `/setup` reopens the card.
- Size Large still fits above Net.

**What is off**
- The header says "no repo · claude code" while three fleet sessions were live.
- Permissions show ✓ Accessibility "exact tab jumps, approve & reply" and ✓ Screen Recording.
- The Keys line advertises ⌃⌥⌘J / ⌃⌥⌘R.

**Result:** PASS on render and speed.

### Localhost (shots 06–09, 14, 15)

**What works**
- A server started in ember's repo appeared 14.6 s later as `:58308 ember preview ✕`.
- Servers in other fleet repos show as `:47103 node (kestrel)` and `:47106 Directory listing for /`.
- Open and Stop are reachable by keyboard.

**What is off**
- There is no section label.
- A server can be listed for a session that Home hides (kestrel).
- With 4 rows the whole section is below the fold.

**Result:** readable, but hidden as soon as the list grows.

### Recording and Today (shots 06, 12)

- "● Record a short" renders in both themes. It was not pressed.
- Today posts "Goals set: 0 · hit: 0 · time drifting: 0m" in 14 ms.
- Notes ("No session matches …", Today) pile up in the panel with no way to clear them.

---

## F7: geometry, legibility, themes

**Panel position**
- 620×460 px, screen rect (776, 219)–(1396, 679).
- Fully inside the work area. No panel element is clipped.
- The only truncated text is the long goal line, which ends in an ellipsis.

**Type sizes and contrast**
- 10 px: "esc".
- 11 px: row state labels, header meta, server chips.
- 11.5–13 px: everything else.
- The row's state label ("atlas · 0s", "done 4m ago") is the smallest and dimmest text in the row: 11 px grey, 5.27:1 on the dark panel.
- The name is bold 13 px at 15:1, and repeats for untitled sessions ("ember" / "ember · done …").

**Colour**
- Done rows and needs-you rows share the same yellow dot.
- The header dot is always green, whatever the fleet is doing.

**Themes**
- Dark (the OS setting) and light both render cleanly: shots 08 vs 07, and 23 vs 22.

**Not tested**
- Net near the top of the screen, where panels flip below him. Moving him needs a drag that follows the real OS cursor.

**Result:** PASS for on-screen geometry and both themes. Hierarchy flaws noted above.

---

## Exploration: what a person running 5–15 sessions trips on

**Keyboard focus is wiped every refresh.**
- I tabbed to a row's ◎ button. 2.5 s later focus was back on the page body, because the Now list is rebuilt every 3 s.
- Rows themselves are not focusable, and there are no number keys.
- Keyboard-only use of rows is not possible.

**Tab closes Home.**
- One Tab from the composer, or Shift+Tab past the ⋯ button, moves focus out of the page and Home closes.

**Row actions are bare glyphs.**
- ▶ means replay, ✓ means mark goal done, ◎ means set goal. Each is explained only in a hover title.
- ✓ sits where an "approve" button would be expected.

**The header names one repo.**
- It shows "ember/main" or "atlas/main", whichever session was last active, and changed during the run. It means little with many sessions.

**⋯ opens the native menu.**
- Watching ember, Localhost (2), Open Home, Setup…, Theater…, content, Today…, Pet, Toss a snack, Settings, Hide Net, Quit Net.

**Esc keeps a half-typed message.** Good.
