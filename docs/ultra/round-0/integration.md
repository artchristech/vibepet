# Round 0 integration

Branch `ultra/round-0` (worktree `~/.vibepet-ultra/int`) merges the two Round 0 branches, `ultra/r0-harness` and `ultra/r0-fleet`. It adds `canon.js` and `watch.js`. The unit gate passes in about 3 s.

The isolated app shows all six fleet members and nothing else. Over time it reads several of them wrongly, and Approve and Jump cannot reach the tmux panes: 15 mismatches, listed in `baseline/notes.md`.

Nothing was pushed, released or deployed, and REPO is still on `main` @ 649beb2 with its untracked files untouched.

## 1. Branch

| commit | what |
|---|---|
| `85ed1af` | merge `ultra/r0-harness` (15 commits: `overrides.js`, test mode, `launch.js` / `smoke.js`, fast gate) |
| `0c5fd29` | merge `ultra/r0-fleet` (`test/fleet/`: `fleet.js`, `lib.js`, `members.json`, `probe.js`, `timings.js`, seed repos) |
| `ad863b8` | `test/ultra/canon.js` + `test/ultra/watch.js` + README |
| `6b26f35` | canon: an age check of each row against the registry; Approve/Reply target the member whose state asks for them; `home.aboveFold` |
| `c2b5c0a` | `canon --compare` compares the kind of each mismatch, not its clock |

- **Merges:** both were conflict-free. The two branches touch disjoint files (the fleet branch only adds `test/fleet/**`).
- **`npm install`:** run in the int worktree with `--cache ~/.vibepet-ultra/npm-cache`; 286 packages, playwright-core 1.63.0.
- **Electron binary:** Electron 44 has no postinstall, so it needs a separate step: `node node_modules/electron/install.js`. Without it, `node_modules/electron/dist` stays empty and `launch()` cannot start the app.
- **Shared `node_modules`:** later fix worktrees should symlink `node_modules` to `~/.vibepet-ultra/int/node_modules`. This was verified: canon ran 26/26 from a throwaway worktree with exactly that symlink (`canon/from-fresh-worktree/`). That worktree and its branch were removed afterwards.

**Unit gate.** `npm test` (`node --test test/*.test.js`):

| where | result |
|---|---|
| int worktree | 24/24 pass in 3.7 s wall |
| after the canon commits | 24/24 |

## 2. Fleet clone of vibepet

- **Update:** `git pull --ff-only REPO ultra/round-0` in `~/.vibepet-ultra/fleet/vibepet`, which is on `main` with no remote. It was fast-forwarded twice: to `0c5fd29` first, then to the final tip `c2b5c0a`.
- **Tests there:** `npm test` passes 24/24 in 2.5–3.0 s with no `npm install`. The working tree stayed clean.
- **The session:** the `vibepet` member stayed in its `done` state throughout (`fleet.js status`: OK). Pulling only changes files on disk; the session took no turn because of it. It took four turns from `fleet.js send` (the member's `rearmPrompt`), each to refresh its "done" row for a capture.

## 3. Fleet

**Initial status (22:07Z).**
- In state: kestrel (approval), vibepet (done), beacon (question).
- Paused (in the previous round): atlas, delta, ember.

**Re-arms.**
- **For the watch:** Esc plus a re-prompt gave kestrel and beacon fresh episodes, so the timeline starts at the moment each dialog opens. atlas was re-armed and ember resumed its single cron job.
- **For the captures:** delta was re-armed before each capture whose home view needed its subagents under 90 s old, six cycles in all. atlas was re-armed when its 9-minute build ended.
- **Root:** `fleet.js root` is rebuilt by every rearm and pause.

At every capture, `fleet.js status` was ALL GREEN, 6/6 in state.

**Paused again at the end** (`fleet.js pause`):
- atlas: Esc, its claude process left running;
- delta and ember: exited (`/exit`);
- kestrel, vibepet and beacon keep their states.

Idle cost is now $0/h.

**Spend** (`fleet.js spend`, logged to `docs/ultra/fleet-spend.jsonl`):

| | transcripts | estimate incl. hidden calls |
|---|---|---|
| before this task | $0.8924 | $1.2282 |
| after | $1.3639 | $2.0475 |
| this task | **+$0.47** | **+$0.82** |

The cap is $5. The hidden-call overhead, measured on 14 exited sessions, is now +50%.

## 4. Baseline: through the real UI

Full write-up with evidence: **`baseline/notes.md`**.

**Setup.**
- **Launched from int:** `VIBEPET_CLAUDE_DIR=~/.vibepet-ultra/root/.claude`, `VIBEPET_USER_DATA=~/.vibepet-ultra/userdata/r0-int`, `VIBEPET_HOTKEY=off`.
- **Opened Home:** a CDP click on Net.
- **Command:** `canon.js --all-rows --act`.

**Captured:** pet, panel, every row, a jump from every row, Approve pressed on kestrel, and the other surfaces. There is also an 8-minute `watch.js` timeline (2 s samples) of registry truth vs. Home row while every member was re-armed.

**Home showed exactly the 6 fleet members and nothing else:** 6 rows, no stale or real sessions. Each member's row:

| member | true state | Home row |
|---|---|---|
| kestrel | approval | **stuck** "stuck 1m" (Approve), though it had waited 18 m |
| beacon | question | **stuck** "stuck 1m" (Approve, no Reply), 18 m |
| vibepet | done | **ready** "done just now" |
| ember | /loop | **ready** "done just now" |
| delta | fan-out | **running** "3s", 3/3 open |
| atlas | building | **running** "3s" |

### Mismatches (Round 1 seeds)

Evidence for each is in `baseline/notes.md`.

**Detection**
- **M1: approval latency.** A permission prompt shows as *running* for 94 s before turning *stuck*. vibepet ignores the registry, which knows within ~75 ms.
- **M2: questions.** An AskUserQuestion is never *needs*, never offers Reply, and does offer Approve: Enter would pick the highlighted option blind. When the transcript withholds the tool_use, the question is hidden after 120 s.
- **M5: fan-out depends on launch time.** A subagent's phase is cached by file (size, mtime). A long-running instance never flags a silent subagent; an instance launched mid-tool flags delta as *stuck* and offers Approve.
- **M6: mtime is not activity.** Claude Code moved transcript mtimes with no new record (beacon +2 m, kestrel +18 m), so a *stuck* row goes back to *running* for 90 s.

**Lifecycle**
- **M7: finished sessions vanish.** A done session disappears from Home ~5–7 min after its turn ends, though it is alive at its prompt.
- **M8: loops read as "done".** A /loop session shows "done Nm ago" between fires, and would be hidden with a period over 5 min.
- **M9: exited sessions look busy.** They show as *running* for up to 2 min; with killed subagents, up to 10 min.

**Clocks and labels**
- **M3: every age restarts at launch.** A fresh instance labels 18–21 min waits "stuck 1m".
- **M4: long tools freeze at `0s`.** atlas's clock resets every tick after 90 s: `0s` for 6 minutes. This is the real form of "atlas reads stalled".
- **M15: wording.** A permission prompt is labelled "stuck" in red.

**Acting on a session (tmux)**
- **M10: Approve.** With Accessibility trusted, it fails with "couldn't find its tab": the tmux server has no `.app` ancestor. kestrel stays at its dialog.
- **M11: Jump** (row click and jump key). It fails on all 6 rows. It writes `claude --resume <id>` to the clipboard, which would start a second claude on a live session. Its "couldn't find its terminal" bubble renders behind the open panel.
- **M12: Reply** never appears (M2). Its send path would fail like M10.

**Panel**
- **M13: the fold.** Only 4 of 6 rows fit above the fold; Record / Today / localhost scroll out of view; Home caps at 8 rows.
- **M14: ✓ race.** ✓ (goal done) is lost when it lands while `tick()` awaits `unstick()`: 2 of 7 runs.

## 5. `test/ultra/canon.js`: the canonical capture

```sh
node test/ultra/canon.js --app <worktree> --out <dir> [--userdata <dir>]   # ~25 s, exit 1 if a surface is unreachable
node test/ultra/canon.js --compare <outA> <outB> [--json FILE]              # exit 1 if the two runs differ
# extra flags: --all-rows (baseline view), --act (really press Approve/Reply), --live-chat, --strict, --root
```

### The 7 surfaces

Each opens through the real UI and saves 2–3 named screenshots. `canon.json` holds 26 functional assertions.

| surface | what canon does | asserts |
|---|---|---|
| Home | clicks Net | panel opens; rows render; rows = snapshot |
| chat | types a message and presses Enter | input and quick asks visible; message shown; reply arrives; engine called once in print mode with no session persistence |
| command bar | types `/` | the bar lists 8 commands; `/today` posts its note |
| row actions | ◎ → `/goal` → ✓; opens Reply; clicks a row to jump | goal prefilled, set and done; Reply form opens; jump IPC fires |
| Theater | clicks ▶ on a row | the window opens with beats; seeks to the middle beat |
| ports | starts a fixture server in a fleet repo | it appears in the footer; Open calls `openExternal` with the right URL; ✕ asks to confirm and the fixture's pid is gone |
| keys + gestures | sends main's `hotkey`, then ⋯ → Settings → Gesture → Record gesture… and 3 strokes | the hotkey jumps to `pending()[0]`; the native menu is captured; the gesture pad opens and the gesture is saved (3 templates) |

**What canon.json also records:**
- each fleet member's truth vs. its row: signal, action, and the age of the label against the registry's `statusUpdatedAt`;
- `home.aboveFold`;
- every intercepted side effect;
- `firstClickDropped` for ✓ (M14).

**Isolation.**
- **Privacy guard:** `launch()`'s guard.
- **Stubs in main:** dialogs answer themselves; `openExternal`, `openPath` and the clipboard only record; native menus are captured.
- **Spies:** `jump` and `send-to` are wrapped through `ipcMain._invokeHandlers`, so each call's result is recorded.
- **Chat:** goes to a stub `claude` by default (`VIBEPET_CLAUDE_BIN`, $0, deterministic). `--live-chat` uses the real login.
- **Environment:** `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID` and `CLAUDE_EFFORT` are stripped from the app's environment.
- **Approve/Reply:** pressed only with `--act`, and refused when the session's terminal is a GUI app.
- **Processes:** the only process canon signals is its own fixture server.

### Runs

Outputs are in `canon/`.

| run | time | assertions | rows |
|---|---|---|---|
| `run-1` | 32.6 s | 26/26 | kestrel and beacon stuck, vibepet and ember ready, atlas and delta running |
| `run-2` | 24.6 s | 26/26 | identical |

`canon --compare` → `canon/stability.json`: **same**.
- **Assertions and mismatches:** identical, compared by kind (the ages read 21 m vs. 22 m).
- **Screenshots:** differ by 0–1.3% of pixels, except `7-keys/hotkey.png` at 17% (the speech-bubble animation).
- **✓ clicks:** run-1 needed a second ✓ click (M14); the run still passed.
- **Fresh worktree:** `canon/from-fresh-worktree/` ran 26/26 from a new worktree whose `node_modules` was a symlink.

**Earlier attempts**, kept as evidence:
- `canon/attempt-1/` (before the ✓ retry): run-2 failed `goalDone` because of M14.
- `canon/attempt-2/`: before the `age:` check.

### `test/ultra/watch.js`

```sh
node test/ultra/watch.js [--app <worktree>] --out <dir> [--secs 300] [--every 2]
```

It keeps Home open and logs registry truth vs. Home row every N seconds. It produced `baseline/watch/` (detection latency, label clocks). It is read-only on the fleet.

## Caveats for Round 1

- **Fleet timing decides some rows.** Make a capture comparable by setting up the fleet first:
  - re-arm delta right before canon; its subagents read *running* only during their first 90 s in a fresh instance (M5);
  - prompt the vibepet member within 5 min of the capture (M7);
  - re-arm atlas when its 9-minute build ends.
- **`--act` against a fixed build reaches real fleet sessions.** Once Approve/Reply reach tmux, `--act` answers kestrel or beacon. The session leaves its state and its next turn costs money, so re-arm afterwards. Default canon never presses either.
- **Accessibility is trusted for the dev Electron.** A build whose `hostApp` finds a GUI terminal would type keystrokes with System Events. Canon's `--act` guard checks the session's terminal before pressing; any new test must do the same.
- **The Mac must stay awake.** Check `pmset -g log` before trusting timings. This run was on AC, and the last wake was 21:49Z, with no sleep through the end of the work at 22:48Z.
- **Shared screen.** The pet window appears bottom-right of the main display for about 25 s per canon run. A real cursor near Net can show the hover roster in a shot.
