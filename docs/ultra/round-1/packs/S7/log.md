# S7 — Gestures + global jump key: flow log

All times UTC (2026-10-02). Load = 1-minute load average from `uptime` at the time of the step (the laptop is shared with other work).

## Setup

- **App:** the real vibepet (Electron), launched through the test launcher. It watches an isolated Claude root that contains only the fixture fleet. It uses its own profile (userData), with setup done, muted and alerts on "everything".
- **Fleet (ground truth):** real Claude Code sessions on Haiku in tmux. Truth comes from the fleet's status tool (registry `status` / `waitingFor` / `statusUpdatedAt`, transcript tail kind, tool processes) and the fleet transcripts. Other testers were also driving fleet members during this run. Every truth change used below is listed in the timeline.
- **Real UI:** clicks on Net's pixels, panel buttons, pad strokes and pet drags are trusted Chromium mouse events. Native menus are captured and their items clicked, because a native popup can't be driven otherwise. Dialogs, `shell.openExternal` and the clipboard are stubbed so nothing leaves the instance. Every clipboard write was recorded instead of performed.
- **Jump key, OS-level:** key events were posted at the HID level with `CGEventPost` (osascript, JXA). This is the same path a physical key takes through the window server's hotkey dispatch. A full press means modifiers down, J down/up, modifiers up. Posting J with the modifier flags only (no modifier key events) reached the handler 1 of 8 times; the full sequence reached it 8 of 8 times. All timings below use the full sequence.
  - ⌃⌥⌘J was registered as instructed (F1), but was never pressed at OS level. The user's own installed vibepet was running with the same saved key, and F2c shows that one press fires every app holding the key. That press would have jumped the user's own pet into one of their real sessions.
  - OS-level presses therefore went to ⌥⌘J, the app's own alternative jump key (Settings → Jump key), on a relaunch of the same profile. The user's own pet does not hold ⌥⌘J.
- **Gestures:** the summon watcher reads the real OS cursor (`screen.getCursorScreenPoint`). Moving the real pointer was off-limits, because the machine is in use and the user's own pet has a gesture on. So each stroke was replayed into that cursor feed on a timed path, while the same path was dispatched as Chromium mouse moves over the pet window. Pet drags are real mousedown/up on Net's pixels, with the window following the replayed cursor.

## Fleet truth timeline (members used here)

| time | kestrel | beacon | vibepet |
|---|---|---|---|
| 02:23:41 | **approval**: Bash permission prompt, registry `waiting (permission prompt)` since 02:03:49 (20 min). Transcript ends at the user prompt (the tool_use record is not written while the dialog is up) | **question**: AskUserQuestion, registry `waiting (input needed)` since 02:13:42.7 (10 min). Transcript ends at the user prompt | **done**: idle since 02:12:19, last record end_turn (statement) |
| 02:24:57 / 02:25:20 | | transcript mtime moved at 02:25:20, 11.7 min after its last record; no new record, size unchanged | transcript mtime moved at 02:24:57, 12.6 min after its last record; no new record |
| 02:29:37–02:29:43 | old dialog dismissed (Esc), re-prompted: new permission prompt, registry `waiting` since **02:29:42.9**. Tool_use not written | still blocked | |
| 02:30:04.49 | | | re-prompted: new **done** turn (statement) |
| 02:40–02:44 | | | another tester: new done turn at 02:40:56 |
| 02:41:29.36 | transcript mtime moved, no new record (atlas's moved the same millisecond) | | |
| 02:46:18.98 | turn ended with a **question**: "Should dry-run output be stored in logs for audit purposes?" (registry idle). Truth: needs you (reply) | still blocked | |
| 02:50:25.97 | new **permission prompt**, tool_use written this time, registry `waiting` 02:50:26.0 | still blocked (37.5 min at 02:51:12) | idle (done) |

atlas, delta and ember were paused for most of the run (idle or exited). atlas ran a build from 02:40:38 to about 02:44 (another tester).

---

## F1 — launch with the jump key ⌃⌥⌘J; did it register?

| step | expected | actual | result |
|---|---|---|---|
| Launch with hotkey `Control+Alt+Command+J` (saved key set to the same) | registers; no "taken" state | `globalShortcut.register` returned **true**; `isRegistered` true; `keyTaken` false. Ready in 336 ms (load 1.25). Shot 01: Net calm, grey light | PASS (registration) |
| ⋯ → Settings → Jump key | label without "(taken)", ⌃⌥⌘J checked | "Jump key"; ⌃⌥⌘J checked, ⌥⌘J / Off unchecked. No banner exists for either case: the only "taken" signal is this menu label | PASS |
| Is the key really ours? | a key another app already holds should read "(taken)" | the user's own installed vibepet was running with ⌃⌥⌘J saved, and the test instance still registered it with no "(taken)". ⌃⌥⌘R (record a short) also registered `true` alongside it. F2c shows two holders both fire on one press | **FAIL**: a clash is not detected |
| Home two minutes later (02:26, shot 03) | kestrel (blocked 22 min) and beacon (blocked 12 min) listed as needing you | rows: "vibepet · done 1m ago" (truth: done 14 min earlier) and "beacon · 38s" green/running (truth: AskUserQuestion open 12 min). kestrel missing | FAIL (truth) |

## F2 — trigger the jump key: where does it go, in what order, does it land on the pane?

**F2a. Handler press, empty queue** (02:24:16, load 1.25). Truth: kestrel approval blocked 20.5 min, beacon AskUserQuestion blocked 10.6 min, vibepet done 12 min.
- Steps: invoke the registered ⌃⌥⌘J handler (the callback the OS calls) 3×, 5.7 s apart.
- Expected: jump to beacon or kestrel (longest-blocked first).
- Actual: handler → `hotkey` delivered to the pet in 1–2 ms. The pet's queue (`pending()`) was **empty**: no jump, no bubble, no sound, no change (shot 02). The snapshot listed **no sessions at all**.
- **FAIL.**

**F2b. Press with Home open** (02:26:46). Truth: as above.
- Home showed vibepet (done) and beacon (running). Opening Home marks done rows as seen, so the queue stayed empty and the press did nothing (shot 04).
- **FAIL** (nothing to walk while two sessions are blocked).

**F2c. Two holders of one key** (02:28 and 02:44, load 1.35 and ~3.8).
- Steps: two instances of the pet (separate profiles) both on ⌥⌘J; then OS-level presses.
- Expected: the second instance reports the key as taken; one press reaches one app.
- Actual: both `register()` → true, both `keyTaken` false. 4 of 4 OS presses fired **both** handlers, within 1 ms of each other (presses at 02:28:33, 02:44:28, 02:44:33, 02:44:38). On the first press both instances also jumped and wrote the clipboard; the other three were checked at the handler only.
- **FAIL.**

**F2d. OS-level press, one done session queued** (02:30:22–02:30:29, ⌥⌘J, load 1.72). Truth at the press (02:30:29): kestrel approval (new, 46 s, record not written), beacon AskUserQuestion (16.8 min), vibepet done (25 s).
- Queue before: `[vibepet (ready, 16 s)]`. kestrel showed as **running**; beacon was absent. Shot 05: Net shows the mint "done" check while two sessions are blocked.
- The press that reached the handler (an earlier flags-only one; see Setup) → shortcut +26 ms → jump IPC → `{ok:false, cmd:"cd <fleet>/vibepet && claude --resume 6101876b-…"}` + one clipboard write. Bubble: "vibepet: couldn't find its terminal — resume command copied".
- The tmux pane `vp-vibepet:0.0` was unchanged before and after (`session_attached=0`, same window and pane active).
- Queue after the failed jump: `[]`. The done row was marked seen although nothing was reached.
- Walk order: the key went to the one session that did **not** need the user, and skipped both blocked ones.
- **FAIL.**

**F2e. Detection, as seen by the jump queue** (500 ms polling, load 1.7–3.8):

| block | truth start | in the queue | result |
|---|---|---|---|
| done (vibepet) | 02:30:04.490 | 02:30:06.234 (**1.7 s**) | PASS |
| question at end of turn (kestrel) | 02:46:18.982 | 02:46:21.324 (**2.3 s**) | PASS |
| permission prompt, record written (kestrel) | 02:50:25.974 | 02:51:57.764 as "stalled" (**91.8 s**) | FAIL (>3 s) |
| permission prompt, record not written (kestrel) | 02:29:42.9 | **never**: shown as running from 02:29:42, dropped at 02:31:41 while still blocked | FAIL |
| permission prompt, record not written (kestrel, earlier episode) | 02:03:49 | **never** (25.8 min, until it was dismissed at 02:29:37) | FAIL |
| AskUserQuestion (beacon) | 02:13:42.7 | **never** in 37.5 min | FAIL |
| done row lifetime | vibepet stayed alive at its prompt | the row disappears 5 min after the last transcript write (02:30:00, 02:35:06, 02:45:57) and comes back when the transcript's mtime moves without a new record (02:24:57 → "done 1m ago") | FAIL |

**F2f. Jump with a question queued** (presses at 02:47:06 and 02:47:13, load 7.83, a load spike from other work). Truth: kestrel's turn ended in a question 47 s earlier; beacon AskUserQuestion blocked 33.4 min.
- Queue: `[kestrel (waiting)]`; beacon absent. The roster pill was open (the pointer was resting on Net) and showed "Deploy.sh dry run" with a yellow light (shot 24).
- Press → shortcut +77 ms → jump result +233 ms: `{ok:false, cmd:"cd …/fleet/kestrel && claude --resume 13a1427d-…"}` + clipboard write.
- **No visible feedback.** The bubble is suppressed while the pill is open, and the row shows no note: shot 25 is byte-identical to shot 24.
- Same press with Home open: jump result +292 ms. The bubble is drawn **behind** the Home panel (the element at the bubble's centre is the panel; shot 26 shows its ghost under the panel).
- kestrel stayed in the queue, so a second press goes to kestrel again. The tmux pane `vp-kestrel:0.0` was unchanged.
- **FAIL** (lands nowhere; failure invisible in 2 of 3 contexts).

**F2g. Key while Net is hidden** (load 1.54–2.68).
- Hidden via right-click → Hide Net (3×), then an OS press:
  - Net shown 67 / 73 / 72 ms after the key (median 72);
  - visible in the page 154 ms after the key (median, n=3);
  - the roster pill opens once (shot 07: the only row is vibepet, done; the two blocked sessions are not listed).
  - **PASS** (speed); **FAIL** (content).
- With a session queued (kestrel question, press at 02:50:10): Net shown at +71 ms, jump failed at +171 ms. The failure bubble stayed hidden behind the summon pill until **+1.78 s**, then showed until +5.2 s (shots 27, 28).

**F2h. Jump on a queued permission prompt** (02:52:0x, load 2.33).
- Queue: `[kestrel (stalled)]`. Net shows a red light and a red "?" (shot 29).
- Press → shortcut +76 ms → jump failed +157 ms. The bubble is visible this time, with the pill closed (shot 30).
- The Home row reads "kestrel · stuck 1m", in red with Approve (shot 31). Truth: a permission prompt open for 1 min 44 s, waiting on the user, not stuck. beacon (38 min blocked) is not listed.
- **FAIL** (lands nowhere; wrong label).

**Order walked by repeated presses**, over the whole run:
- `[]` while kestrel and beacon were blocked (02:24, 02:26);
- `[vibepet(done)]` (02:30);
- `[kestrel(question)]` (02:47);
- `[kestrel(stalled)]` (02:52).

Truth's longest-blocked-first order was beacon first every time (blocked from 02:13:42), then kestrel, then vibepet (done). beacon was never reachable with the key.

## F3 — summon gesture: recognized? right action? latency? false positives?

**Supported gesture (gesture.js):**
- One user-trained unistroke shape, 3 samples on the pad, matched with a $1 recognizer against the global cursor stream.
- A looped scribble is compared by its first loop.
- Gate: at least 90 px on the long side, at least 35 px on the short side, path at least 1.6× the box diagonal, at most 3.5 s, starts above 260 px/s, ends after 160 ms still.
- Sensitivity: Low 0.88 / Medium 0.85 (default) / High 0.825.
- Action: toggle. Visible Net hides; hidden Net appears at the stroke's end. 2.5 s lockout after any toggle.
- The trained shape here was a clockwise circle (F4).

**Recognition** (strokes over/around Net; Medium unless noted; load 2.55–3.90):

| stroke | toggled / tries | expected | result |
|---|---|---|---|
| clockwise circle r=110 px, 0.6 s (Net visible) | 3/3 hide; median 200 ms to hide, window gone at 461 ms (shot 15) | hide | PASS |
| same circle (Net hidden) | 3/3 summon at the stroke end; median 202 ms (shot 16) | summon | PASS |
| triple loop clockwise, 1.5 s | 2/2 | match | PASS |
| 2:1 ellipse clockwise | 2/2 | match (same shape, sloppy) | PASS |
| circle at 2.4 s / 4 s | 2/2 / 0/1 | match / no (over 3.5 s) | PASS |
| small circle r=40 (80 px) | 0/2 | no (below the size gate) | PASS, but no hint |
| **counter-clockwise circle** | **0/3** | a circle is a circle; nothing told the user to keep a direction | FAIL |
| Z, zig-zag, straight line, diagonal, L, back-and-forth wiggle, U arc, figure-8 | 0/1–0/2 each | no | PASS |
| **square** 180 px, 0.8 s | **3/3 hide** at Medium; 0/2 at Low (Low still matched circles 2/2 and the ellipse 1/1) | no | FAIL (false positive at the default) |

**False positives while using the pet:**
- **Dragging Net in a loop** (mouse held on Net, 0.9 s): **4/4 hid him** about 198 ms after release: two closed loops, one 0.85-turn loop and one 0.8-turn loop (shots 20 → 21 → 22). Loop drags that end in a straight 140 px run: 0/3 (shot 17). The watcher ignores the mouse button, so any looping drag counts.
- **Clicking Net:** no stroke, no toggle (Home opens as designed).
- **Circle over an open Home panel:** hides Net and closes Home (1/1). A typed draft ("draft: ask kestrel why") survived the hide and summon (shots 18, 19).
- **Summon within the lockout:** re-summon strokes ending 1.35 s and 1.73 s after a gesture hide were ignored silently (Net stayed hidden). One ending at 2.73 s worked.

## F4 — gesture teaching (sample / redo / cancel)

Path: Net → Home → ⋯ → Settings → Gesture → "Record gesture…" (load 1.67–1.75).

| step | expected | actual | result |
|---|---|---|---|
| open the pad | pad + instructions | menu up 43 ms after ⋯, pad 14 ms after the item. "Draw your gesture 3 times on the pad." Redo last disabled (shot 08) | PASS |
| sample 1 (circle) | count down, preview | "Nice — 2 more, same shape." with preview 1 (shot 09), ≤3 ms after release | PASS |
| Redo last | drops the sample | previews cleared, text back to the start (19 ms; shot 10) | PASS |
| a tiny flick | refused, with a hint | "That was tiny — draw it a little bigger." (shot 11) | PASS |
| circle, circle, Z | keep the two that agree | "Two of those match — once more like those." (shot 12) | PASS |
| one more circle | saved, gesture on | "Saved. Hide Net, then move the mouse in that shape to bring him back." 3 previews; closes by itself (2.8 s timer). State: on, Medium, 3 templates; watcher polling (shot 13) | PASS. The copy only mentions bringing him back; the first use hid him |
| Record a new gesture… → 1 sample → Cancel | pad closes; old gesture kept | closed in 25 ms; the same 3 templates; watcher paused while recording, resumed after (shot 14) | PASS |
| Record a new gesture… → 2 samples → Esc | same | closed; old gesture kept; watcher resumed | PASS |

## Exploration (a person running 5–15 sessions)

- **Setup card** (⋯ → Setup…) says "⌃⌥⌘J jump to who needs you · ⌃⌥⌘R record a short". The active and saved jump key was ⌥⌘J (shots 23, 26).
- **Labels:** the failure bubble names the session by folder ("kestrel: …"). The pill and Home rows lead with its title ("Deploy.sh dry run").
- **The resume command** the key copies on a tmux session (`cd <repo> && claude --resume <id>`) targets a session that is live in its pane. Pasting it would start a second claude on the same conversation.
- **One press consumes every done row:** a jump, failed or not, marks every done session as seen, so after the 4 s walk window the key can no longer reach them.

## Summary

| flow | result |
|---|---|
| F1 register ⌃⌥⌘J | registers; a clash with another holder is not detected |
| F2 where / order / pane | goes to the first queued session within ~0.2 s. The queue misses permission prompts (never, or after 92 s) and AskUserQuestion (never). It lands on no tmux pane and copies a resume command. The failure is invisible when the pill or Home is open |
| F3 gestures | trained circle: reliable, ~200 ms. Direction-sensitive. A square and a looped drag of Net also fire |
| F4 teaching | sample, redo, refuse-tiny, partial match, save, cancel and Esc all work, fast and clear |
