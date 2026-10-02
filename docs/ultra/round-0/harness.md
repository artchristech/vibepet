# Round 0: harness

Branch `ultra/r0-harness` (worktree `~/.vibepet-ultra/wt/r0-harness`). It is 15 commits on top of `main` 649beb2, with 17 files changed (+818/−47). Nothing is merged or pushed.

## Result

| | main | ultra/r0-harness |
|---|---|---|
| `npm test` | no `test` script. `node --test test/*.test.js` had not finished after 90 s and was killed (exit 124); only agents and camera had reported | `node --test test/*.test.js`: **24/24 pass, exit 0**. 4.4 s and 5.0 s wall at load ~63; 11.9, 16.0 and 12.7 s at load ~130–150 |
| After a killed run | an orphaned `ffmpeg` (ppid 1) kept encoding | ffmpeg children die with the test (SIGTERM → exit 143, SIGINT → exit 130), and the temp dir is removed |
| Real app under test | none | `test/ultra/launch.js` (Playwright for Electron) + `test/ultra/smoke.js`. Self-test: 3/3 runs, plus a first run and 2 parallel instances, all green |

## Root cause of the hang

1. **`test/content.test.js` ran a full production render inside the unit gate.** Nothing was leaking handles or waiting on a permission or display. The test simply took minutes. `node --test` prints a file's result only when the file ends, so for minutes there was no output at all. Measured on this Mac (8-core M1, load average 120–490 during the work):
   - Step 1, the synthetic source: a software VP9 encode of a 10-minute 1280×800 recording (`execFileSync`). After 25 s it had encoded 124 of 600 s, so about 2 minutes for this step alone.
   - Step 2, the render: one 1080×1920 clip per edit (gblur σ28, VideoToolbox encode), about 34 s of output. With the faster H.264 source the full render still takes **61.8 s wall / 55 s CPU** (`npm run test:render`, exit 0). One smoke-scale render stalled **105 s at 9 s CPU**; the next identical run took 5.4 s. VideoToolbox contention and load make its duration unbounded.
   - **The leak:** the source encode ran under `execFileSync`, which blocks the event loop, so no signal handler could run. `render.js` also never tracked the ffmpeg processes it spawned. When the gate was killed, the encoder was orphaned. Reproduced on main: after `timeout 90`, `ffmpeg` was still running with ppid 1.
2. **`test/gesture.test.js` (~24 s) was CPU contention plus redundant work.** It ran 16 $1-recognizer searches per stroke where 4 give the same numbers. Alone, at load ~188: **17.4 s wall / 9.8 s CPU before, 4.2 s / 3.2 s after**. The report it prints is byte-identical (`cmp`). The ~24 s was this test competing with the encoder above.

Fixes:
- `content/render.js` tracks every ffmpeg/ffprobe it spawns and SIGKILLs them on exit.
- The test's source is what the recorder really writes (H.264 in WebM, 2 s GOP), built asynchronously so SIGINT/SIGTERM reach the handlers.
- The full render is **gated behind `VIBEPET_RENDER_TEST=1` (`npm run test:render`)**. It needs system ffmpeg plus VideoToolbox and a minute of CPU, so it is an integration run, not a unit check. Everything else in `content.test.js` (redaction, prompt tap, EDL) runs in the gate.
- A smoke-scale render was prototyped for the gate (2 clips, 3.5 s out). It was left out because of the 105 s stall above.

## Commits

| | |
|---|---|
| aa4fc5a | gesture test: score each stroke once and read every sensitivity off that score (same output; CPU 9.8 s → 3.2 s measured here) |
| f515f13 | gate script; render opt-in + leak-free (render.js child tracking, async source, temp dir removed) |
| 483d5e8 | `overrides.js`: `VIBEPET_CLAUDE_DIR`, `VIBEPET_USER_DATA` (before the single-instance lock), `VIBEPET_HOTKEY` (`off` / accelerator). main, agents, ports, theater and content read `projects/` and `sessions/` through it. Theater's replay guard now requires a path separator after `projects`. Includes `test/overrides.test.js` |
| a910be6 | test mode: pet shown with `showInactive`; no `app.focus({steal})`/`win.focus()`; OS banners recorded in `__vibepet.notes`; richer hook |
| c4aca2f | ports: isolated root lists only servers and dev processes under its sessions' cwds. It used to show (and offer to Stop) the user's real dev servers |
| 639eaa1 | test mode: `--use-mock-keychain`; instance quits when its launcher dies |
| db37d43 | `test/ultra/launch.js` + `playwright-core` 1.63 + `test/harness.test.js` |
| 416c715 | `test/ultra/smoke.js` + `test/ultra/README.md` |
| d5682db | ports test: a failing live-task assertion prints shape only (task names come from real transcripts) |
| 0a5e118 | recordings follow `VIBEPET_USER_DATA` (`<userData>/recordings`), not `~/Movies/Vibepet` (a test instance listed and could "finish" the user's real screen recordings) |
| a2878c7 | overrides test hardened for a loaded Mac (45 s child timeout; lsof re-polled) after 1 unexplained failure in ~13 runs |
| 8c86666 | test mode: activation policy `accessory` from launch (**focus was being stolen**, see below) |
| 7874014, 773195c, 6c93f06 | smoke: front-app check on the parallel pair; README |

## Env overrides (all unset = shipped behaviour)

- **`VIBEPET_CLAUDE_DIR`** moves the Claude root. When set, the app is *isolated*: tasks, servers and dev processes show only when they are under a watched session.
- **`VIBEPET_USER_DATA`** sets `app.setPath('userData')` before `requestSingleInstanceLock`. It also holds `recordings/`.
- **`VIBEPET_HOTKEY`** is `off` (no global shortcuts at all) or an accelerator.
- **`VIBEPET_TEST`** turns on test mode:
  - no focus: accessory app, `showInactive`, no activation;
  - no Notification Center (banners go to `__vibepet.notes`);
  - mock Keychain;
  - the instance quits when its parent dies;
  - the `globalThis.__vibepet` hook.

Unit tests:
- `test/overrides.test.js` (9) covers defaults, parsing, each module honouring the root in a child process with fixtures, and real listeners in and out of an isolated root. A source guard fails on any `~/.claude` path built outside `overrides.js`.
- `test/harness.test.js` (5) covers the privacy guard, compositing and process bookkeeping.

All 14 run without Electron.

## Harness (`test/ultra/launch.js`, details in `test/ultra/README.md`)

`launch({ appDir, root, userData, env, hotkey, state, timeout })` returns `{ app, win, windows(), evalMain(fn,arg), shot(file), clickPet(), openHome(), homeMode(), processes(), close(), pid, paths, readyMs, logs }`. It launches with `_electron.launch({ executablePath: <appDir's electron>, args: [appDir], env: { ...process.env, ...env, VIBEPET_TEST:'1', VIBEPET_CLAUDE_DIR: root, VIBEPET_USER_DATA, VIBEPET_HOTKEY: hotkey ?? 'off' } })`. The guarded keys go last, so `env` can't override them.

- **Privacy guard.** `launch()` throws before anything is spawned unless `root`, `root/projects`, `root/sessions` and userData all resolve (symlinks followed) inside `~/.vibepet-ultra`. The real `~/.claude` is refused. Every symlink under `projects/` and `sessions/`, down to 5 levels, must land inside `~/.vibepet-ultra`, in a fixture-fleet dir (`*-vibepet-ultra-fleet-*`), or (`sessions/` only) on a `<pid>.json` registry file. That is exactly the r0-fleet layout. `shot()` re-checks the guard before every capture. Mutation-tested: disabling the link check or widening the registry rule fails `test/harness.test.js`.
- **Ready.** The pet window is loaded, main's hook is installed, and the app reports the isolated root and userData (otherwise it throws). Net's canvas has opaque pixels and the renderer has its first snapshot.
- **Real click.** Trusted mouse events (move → down → up) go over CDP onto an opaque pixel of Net. The renderer runs its own handlers, including the 220 ms double-click wait. The user's cursor and keyboard are untouched.
- **Legible screenshots.** The pet window is transparent. `shot()` captures with `omitBackground` (RGBA at device scale; e.g. 34% of the Home capture is fully transparent and most of the panel is translucent). It composites straight-alpha "over" onto neutral grey **#8a8f98** and writes an opaque PNG (plain `zlib`, no dependency). `{ alpha: true }` keeps the raw capture.
- **Clean close.** Quit through Playwright. Every process seen (the main pid's descendants, plus helpers whose command line names this userData) must be gone within 5 s. Stragglers are SIGKILLed and returned as `orphans`.

## Evidence (`docs/ultra/round-0/harness/`)

From `node test/ultra/smoke.js --root ~/.vibepet-ultra/root-empty/.claude --out docs/ultra/round-0/harness --runs 3`: green in 61.8 s, `smoke.json`.

| instance | ready | Home (click → open) | still open 1 s later | close | procs | orphans | frontmost before → after |
|---|---|---|---|---|---|---|---|
| run-1 | 2414 ms | `now`, 742 ms | yes | quit, 4073 ms | 5 | 0 | Ghostty → Ghostty |
| run-2 | 2345 ms | `now`, 586 ms | yes | quit, 4912 ms | 5 | 0 | Ghostty → Ghostty |
| run-3 | 5895 ms | `now`, 594 ms | yes | quit, 1243 ms | 6 | 0 | Ghostty → Ghostty |
| first-run (fresh profile) | 1256 ms | `setup` (Quick setup card), 383 ms | yes | quit, 755 ms | 5 | 0 | Ghostty → Ghostty |
| parallel a + b | both up together (pids 98953 and 98952 alive at once; `userdata/run-WwjPRh` ≠ `userdata/run-xxYY2g`) | `now`, `now` | | quit, quit | 5, 4 | 0, 0 | Ghostty → Ghostty |

- **Screenshots.** `run-{1,2,3}-home.png` and `parallel-{a,b}-home.png` show the Home panel ("No live sessions…", Record/Today, Quick asks, command bar). All 5 are **byte-identical** (md5 425ddf17…), so rendering is deterministic across runs and across parallel instances. `first-run-home.png` is the Setup card. `*-idle.png` shows Net before the click.
- **Each instance** had its recordings dir at `<userData>/recordings` and posted 0 OS banners. After the run, no process names any of the run's userData dirs.
- **Same userData twice:** the second launch was refused in 457 ms, so the single-instance lock still holds per profile.
- **Orphans:** with the harness SIGKILLed mid-run, all 4 instance processes were gone in ~1 s. With the parent-death check disabled, they were still alive 15 s later.
- **Focus:** one smoke run with the user at the Mac failed **Ghostty → Electron on 4 of 4 launches** (focus steal). Earlier runs had the screen locked, so the check had passed vacuously. After `setActivationPolicy('accessory')`, a 150 ms sampled timeline across launch, Home and close stayed on Ghostty, as did all 5 instances above. The unfixed build was not re-run, to avoid taking the user's focus again. Also confirmed: no pet window is ever focused (`BrowserWindow.getFocusedWindow()` is null after launch and after Home).
- **Isolation, real listeners:** `test/overrides.test.js` starts a server under a fixture session's cwd and one outside it. Isolated, only the first is listed; unset, both are. With the filter disabled the test fails.
- **Opt-in render:** `npm run test:render` passed (render ok: 33.5 s short in 36.7 s; 61.8 s total). Killing it mid-encode left no ffmpeg and no temp dir.

## Not in `npm test`, and why

- The **full render** needs ffmpeg plus VideoToolbox, about a minute of CPU, and stalls of up to 100 s were seen. Run it with `npm run test:render`.
- The **Electron harness** (`smoke.js`) needs a GUI session and takes 30–60 s. Run it with `node test/ultra/smoke.js`.

## Notes for later rounds

- **The window is on the real screen.** Each instance shows the pet window (always on top, bottom-right) and a menu-bar icon, but neither takes focus.
- **Some panel actions still reach the OS:**
  - Jump uses osascript or the clipboard.
  - Approve/Reply types keystrokes via Accessibility.
  - Stop opens a native dialog, then kills a pid.
  - Record a short captures the screen.
  - CDP can't answer native dialogs. Only trigger these actions against fleet sessions.
- **Chat without an API key uses the user's `claude` login.** It runs with `--no-session-persistence`, so no transcript is written. To fault-inject, pass `env: { ANTHROPIC_BASE_URL }`.
- **Isolated localhost matching relies on Claude Code's dir naming.** A cwd's session dir is the cwd with non-alphanumerics turned into `-`. A session whose cwd is `$HOME` would put every process under the home dir in view, but fleet sessions run in `~/.vibepet-ultra/fleet/*`.
- **The Setup card's Keys row** still shows ⌃⌥⌘J / ⌃⌥⌘R when `VIBEPET_HOTKEY=off`. This is cosmetic.
