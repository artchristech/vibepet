# Round 0 baseline: what vibepet shows vs. what the fleet is doing

**Build:** `ultra/round-0`, app code = main 649beb2 plus the harness overrides. Integration worktree `~/.vibepet-ultra/int`.

**Launch:** through `test/ultra/launch.js` with these settings:
- `VIBEPET_CLAUDE_DIR=~/.vibepet-ultra/root/.claude`
- `VIBEPET_USER_DATA=~/.vibepet-ultra/userdata/r0-int`
- `VIBEPET_HOTKEY=off`

**Fleet:** 6 members on Claude Code 2.1.287 / claude-haiku-4-5, all in state (`fleet.js status`: ALL GREEN at 22:41:05Z).

**Real UI:** a CDP click on Net's opaque pixels opened the Net Home panel. Every row action was clicked through the DOM.

## Evidence in this directory

| path | what |
|---|---|
| `canon.json`, `1-home/` … `7-keys/` | Final baseline: `canon.js --all-rows --act` at 22:41:06Z. Pet, panel and every row (`1-home/row-<member>.png`), a jump from every row (`4-rows/jump-<member>.png`), Approve pressed on kestrel (`4-rows/approve.png`), goal, the other surfaces. 31/31 reachability assertions. |
| `watch/timeline.jsonl`, `watch/summary.json`, `watch.log` | `watch.js`: 8 min at 2 s (22:22:56–22:30:56Z), Home open the whole time, while every member was re-armed into a fresh episode. Each sample has the registry truth and the Home row. Times below are `t` = seconds since 22:22:56Z. |
| `attempt-1/` | First baseline (22:24:54Z). Same findings. Approve was pressed on kestrel. `row-delta.png` is wrong: it was captured below the list's fold before canon scrolled rows into view. |
| `attempt-2/` | Second baseline (22:34:36Z). A fresh instance launched while delta's subagents were ~125 s into `slow.sh` shows delta as **stuck** (M5). Approve was pressed on delta. |
| `../canon/run-1`, `../canon/run-2` | The two canonical runs (22:43:48Z, 22:44:21Z). Same rows and same mismatches, with an `age:` check on every row. |
| `../canon/attempt-1/run-2` | The run whose ✓ click was dropped (M14). |
| `../canon/from-fresh-worktree` | Canon run from a throwaway worktree, right after `pause` exited delta and ember (M9). |

## Snapshot: every fleet member vs. its Home row (final baseline, rows read at 22:41:14Z)

Home showed **exactly the 6 fleet members and nothing else**: 6 rows, no extra or stale rows, nothing from the real `~/.claude`. Only 4 of the 6 fit above the list's fold.

| member | true state (registry) | in it for | Home row: signal · label | actions offered | verdict |
|---|---|---|---|---|---|
| kestrel | approval: `waiting` (permission prompt), Bash `./deploy.sh --dry-run` | 18 m | stuck · `kestrel · stuck 1m` | Approve ▶ ✓ ◎ | signal right, age wrong (M3), "stuck" wording (M15) |
| beacon | question: `waiting` (input needed), AskUserQuestion | 18 m | stuck · `beacon · stuck 1m` | Approve ▶ ✓ ◎ | **wrong**: no Reply, Approve offered for a question (M2), age wrong (M3) |
| vibepet | done: `idle`, end_turn, a statement | 24 s | ready · `vibepet · done just now` | ▶ ✓ ◎ | right now; it vanishes ~5–7 min later (M7) |
| ember | /loop: `idle` between fires, 1 cron job | 18 s | ready · `ember · done just now` | ▶ ◎ | a loop reads as "done" (M8) |
| delta | fan-out: `busy`, 3 subagents each running `slow.sh` | 14 s | running · `delta · 3s`, fan-out 3/3 open | ▶ ✓ ◎ | right at this age; a fresh instance after 90 s says stuck (M5) |
| atlas | working: `busy`, `build.sh` (9 min) | 25 s | running · `atlas · 3s` | ▶ ✓ ◎ | right at this age; after 90 s the label sticks at `0s` (M4) |

Canon run-1 and run-2 (22:43–22:44Z) agree row for row: kestrel and beacon stuck, vibepet and ember ready, atlas and delta running. Their `age:` check flags four members:
- kestrel "stuck 1m" against 21 m waiting;
- beacon "stuck 1m" against 21 m waiting;
- atlas "0s" against 3–4 m busy;
- ember "done just now" against 3–4 m idle.

## Mismatches (seeds for Round 1)

### Detection

**M1. A permission prompt is flagged only after ~94 s.**
- **What happens:** kestrel's registry went to `waiting (permission prompt)` at t=15 s. For the next 92 s, Home showed it as **running** (`kestrel · 1m 30s`, no Approve button). It turned **stuck** at t=109 s, a 94 s latency.
- **Why:** the only signal used is transcript silence. `agents.js` `classify` marks a session stalled when its last record is a tool_use and it has been idle >90 s.
- **What the registry offers:** `waiting` + `waitingFor` within ~75 ms of the tool_use (fleet-states.md). vibepet reads `sessions/<pid>.json` only for `sessionId`, in `locateSession`.
- **Evidence:** `watch/summary.json` → `members.kestrel.changes`: `{to:'approval', shownAs:'stuck', afterMs:94082}`.

**M2. A question never shows as "needs you" and never offers Reply.**
- **What happens:** beacon's AskUserQuestion was `waiting (input needed)` from t=19 s. Home showed:
  - **running** until t=109 s;
  - then **stuck** with an **Approve** button and the ask "AskUserQuestion";
  - never `needs`.
- **Why Reply never appears:** Reply exists only for phase `waiting`, which requires an end_turn text that ends in `?`.
- **Why Approve is dangerous here:** Approve sends Enter "on the highlighted Yes". On a question that would pick the highlighted option without the user ever seeing the choices.
- **When the transcript withholds the tool_use:** this happened in 5 of 25 dialogs (fleet-states.md), and for beacon's previous episode for over an hour. Then the last record is the user prompt: Home says running for 120 s, then **parks the session (hidden)**.
- **Evidence:**
  - the watch;
  - `canon.json` `compare[beacon]`;
  - `../canon/run-*` `summary.mismatches`;
  - `1-home/row-beacon.png`.

**M5. Whether a fan-out shows as stuck depends on when vibepet started.**
- **Why:** `kidPhase` caches each subagent's phase keyed by file (size, mtime). A subagent whose file goes silent during a 150 s Bash call keeps the phase it had when first read.
- **Long-running instance (watch):** delta stayed **running**, fan-out 3/3/0 stuck, through two full `slow.sh` cycles (t=37–187 s and 261–409 s). A subagent that really is stuck would never be flagged.
- **Fresh instance:** `attempt-2/` launched at subagent age ~125 s. It showed delta **stuck** (`delta · stuck 1m`, ask `Bash: ./slow.sh shard-3`) with an Approve button, though nothing awaits approval. Approve was pressed there: "couldn't find its tab".
- **Result:** same fleet state, opposite answers.

**M6. File mtime is used as "last activity", but Claude Code touches the transcript without writing.**
- **What happens:** with a dialog open, the transcript's mtime moved but no new record appeared:
  - beacon: mtime 22:25:19Z, 2 m 06 s after its last record (22:23:13Z, the AskUserQuestion tool_use);
  - kestrel: mtime 22:41:29Z, 18 m 20 s after its last record. Its size was 362 477 B both before (22:25:50Z) and after.
- **Why it matters:** vibepet computes idle as now − mtime, so the row drops from stuck back to **running** for another 90 s.
- **Evidence:**
  - the watch: beacon at t=147–235 s;
  - the final baseline: seconds after Home showed kestrel stuck, the jump-key queue (`7-keys`, `keys.queue`) held only beacon.
- **Cause still open:** these runs only read transcripts (theater, `fleet.js status`, `canon.js`, `watch.js`). The writer that moves the mtime was not identified.

### Lifecycle

**M7. A finished session disappears.**
- **What happens:** vibepet (`idle` at its prompt, done, waiting for the next prompt) showed **ready** from t=25 s and was **hidden** from t=425 s (~6.7 min). The session was alive the whole time.
- **Why:** the park rule is end_turn plus 5 min since the last write. Over 15 sessions, finished ones quietly leave the list.

**M8. A /loop session reads as "done".**
- **What happens:** ember between fires showed `ember · done 5m ago` until its fire at t=311 s, briefly **running**, then "done" again.
- **What is missing:** there is no scheduled or looping state. With a period over 5 min it would be parked (hidden) between fires.
- **What the data offers:** Claude Code does not record the next fire time (fleet-states.md). It does record the live cron job and `.claude/scheduled_tasks.lock`.

**M9. Exited sessions show as running.**
- **What happens:** about 45 s after `fleet.js pause` exited delta and ember (`/exit`), a fresh instance listed both as **running** (`delta · 3s`, `ember · 3s`). Truth: no claude process.
- **Why:**
  - the last record is the `/exit` user prompt, which counts as working for 120 s;
  - delta's killed subagents keep it "running" through `fanout` while their files are <10 min old.
- **Evidence:** `../canon/from-fresh-worktree/canon.json` → `compare`.

### Clocks and labels

**M3. Every row's clock restarts when vibepet launches.** `since` is the first time this vibepet process saw the phase. A fresh instance shows:
- 18–21 min approval or question waits as `stuck 1m`;
- a 3–4 min busy atlas as `0s`;
- a 3–4 min idle ember as `done just now`.

The truth is in the registry (`statusUpdatedAt`) and in the record timestamps. **Evidence:** `../canon/run-*/canon.json` → `compare[].age` and the `age:` problems.

**M4. A long tool's clock sticks at `0s`.**
- **What happens:** atlas showed `atlas · 0s` from t=121 s to t=479 s of its 9-minute build. The phase stays right (running).
- **Why:**
  - after 90 s of transcript silence, `scan` classifies the session as `stalled`, which differs from the previous phase `working`, so `since` resets every tick;
  - `unstick` then sees `build.sh` and flips it back to working.
- **How this differs from the brief's prediction:** "atlas reads stalled" never reaches the UI. The visible symptom is the frozen clock.
- **Side effect:** the same flip-flop restarts M3's clock every 3 s.

**M15. A permission prompt is labelled "stuck Nm" with a red light.** It is waiting on the user, not stuck. This is the most common needs-you state, so it is worth naming correctly.

### Acting on a session (tmux)

**M10. Approve cannot reach a tmux pane.**
- **What happens:** Approve on kestrel goes through `send-to`:
  1. Accessibility is trusted for the dev Electron (`perms.ax: true`).
  2. `locateSession` finds the pid.
  3. `hostApp` returns null, because the tmux server's parent is launchd.
  4. Home posts "Couldn't approve: couldn't find its tab".
- **Result:** kestrel stayed at its dialog (`fleet.js status` afterwards: approval OK).
- **Evidence:**
  - `4-rows/approve.png`;
  - `canon.json` → `surfaces.rows.actions.approve.pressed`;
  - `attempt-1/` (also kestrel).
- **What would work:** the registry already carries the pane (`tmux: vp-kestrel:@8.%8`), and every session has a `messagingSocketPath`.

**M11. Jump cannot reach a tmux pane, and its failure is hard to see.**
- **What happens:** all 6 row clicks returned `{ok:false, cmd:"cd <repo> && claude --resume <id>"}` with one clipboard write each. Canon intercepted those writes; unstubbed, they overwrite the user's clipboard.
- **Why the fallback is wrong:** that command would start a second claude on a session that is still live in its pane.
- **Jump key:** main sends `hotkey`, which went to `pending()[0]` and failed the same way.
- **Feedback:** the "couldn't find its terminal" bubble renders behind the open Home panel (`4-rows/jump-kestrel.png`: faint text under the input).
- **Evidence:** `canon.json` → `surfaces.rows.actions.jump`, `surfaces.keys.hotkey`.

**M12. Reply was never offered in any capture.** The causes are M2 and the `?`-ending rule. The reply path itself (form → `send-to` with text) has the same tmux dead end as M10.

### Panel and UI

**M13. The fold.**
- **In the panel:** 4 of 6 rows fit above the Now list's fold (`home.aboveFold: 4`; `#now` max-height 46%). In the final baseline, rows 5 and 6 (delta, atlas, both running) are only reachable by scrolling (`1-home/panel.png`).
- **The footer goes too:** Record a short, Today and the localhost servers live in the same scroll box, so they also drop out of view. With 6 sessions, the localhost section of `panel.png` is not visible at all. Canon still finds it because Playwright scrolls.
- **The cap:** Home shows at most 8 rows (renderer `.slice(0, 8)`). At 15 sessions, 7 are never shown.

**M14. ✓ (goal done) is dropped by a race with the tick.**
- **What happens:** in 2 of 7 canon runs the first ✓ did nothing: `../canon/attempt-1/run-2` failed `rows/goalDone`, and `../canon/run-1` has `firstClickDropped: true`.
- **Why:**
  1. `main.js` `tick()` sets `agents = scanAgents()` (fresh objects without `.goal`).
  2. It then awaits `unstick()`, which runs `ps` and `lsof` whenever a session is stalled.
  3. A `goal-done` IPC in that window runs `goalDone(a)` with `a.goal` undefined and returns.
  4. Its own `tick()` is skipped because `busy` is set.
- **Canon's handling:** it now clicks a second time, as a person would, and records that the first click was dropped.

## The brief's predictions, checked

| prediction | observed |
|---|---|
| atlas reads 'stalled' while its build runs | Not in the UI: `unstick` flips it back to running every tick. The real symptom is the clock frozen at `0s` (M4). |
| kestrel is only flagged after 90 s | Confirmed: 94 s (M1). |
| approve and jump cannot reach tmux panes | Confirmed for both (M10, M11), with AX trusted. Neither reached a pane: kestrel stayed at its dialog, and no keystroke was sent anywhere. |

## Not a vibepet issue

- **Watch row `extra:ember` at t=27–35 s:** ember had just restarted under a new pid. Its registry link only appears after `fleet.js rearm` rebuilds the root at the end of a multi-member rearm. `watch.js` could not map the session for 8 s. This is an artifact of `watch.js`.
