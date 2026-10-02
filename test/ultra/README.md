# test/ultra — drive the real vibepet, isolated

`launch.js` starts the real app (Electron, this checkout) through Playwright and hands you the pet window, the main
process, screenshots and a clean shutdown. The instance watches an isolated Claude root, never `~/.claude`.

```js
const { launch } = require('./test/ultra/launch');
const v = await launch({ root: `${os.homedir()}/.vibepet-ultra/root/.claude`, state: { setupDone: true } });
const { mode } = await v.openHome();        // real click on Net → 'now' (sessions + chat), or 'setup' on a first run
await v.shot('docs/ultra/round-1/home.png');
const snap = await v.evalMain(() => globalThis.__vibepet.snapshot());
const { orphans } = await v.close();        // [] or the run is broken
```

Self-test, real app, about 30 s: `node test/ultra/smoke.js --out <dir>`. It does 3 sequential runs (launch → Net drawn
→ click → Home → screenshots → close, no orphans), a first-run profile (Setup card), and two instances at once with
different userData. It writes PNGs and `smoke.json`, and exits 1 if any check fails. Flags: `--root`, `--runs N`,
`--no-parallel`, `--no-first-run`.

## Canonical capture: `canon.js` (every surface, against the live fleet)

```sh
node test/ultra/canon.js --app <worktree> --out <dir> [--userdata <dir>]   # ~25 s; exit 1 if a surface is unreachable
node test/ultra/canon.js --compare <outA> <outB> [--json FILE]              # two runs side by side (exit 1 if they differ)
```

It runs from any checkout that has `test/ultra` and `test/fleet` (playwright-core from that checkout's `node_modules`,
a symlink is fine) against the app in `--app` (Electron from *its* `node_modules`). Each run first reads the fleet's
truth (`test/fleet/fleet.js status --json`, read-only), then opens the 7 surfaces through the real UI and writes
`<out>/<n-surface>/*.png` plus `<out>/canon.json`:

| surface | what it does | shots |
|---|---|---|
| 1-home | real click on Net → Home; rows vs. the fleet (`compare[]`: per member truth, row signal, label, actions, problems) | pet, panel |
| 2-chat | types a message, Enter → reply. Engine = a stub `claude` (`VIBEPET_CLAUDE_BIN`, answers from the context's `Agents:` line, $0); `--live-chat` uses the user's login on Haiku | sending, reply |
| 3-command | `/` lists 8 commands; `/today` posts its note | slash, today |
| 4-rows | ◎ → `/goal canon goal` → ✓ (clicked again once if the first ✓ is dropped, see `firstClickDropped`); Reply opens its form; a row click jumps (`ipc:jump` result) | list, goal, reply, jump |
| 5-theater | ▶ on a row → Theater window with beats; the middle beat | open, seek-mid |
| 6-ports | a fixture HTTP server started by canon (cwd = a fleet repo) appears in the footer; Open; ✕ Stop (confirm dialog answered) kills it | footer, stopped |
| 7-keys | main's jump-key handler (`send('hotkey')`) jumps to `pending()[0]`; ⋯ → Settings → Gesture → Record gesture… → 3 strokes on the pad → saved | hotkey, gesture-pad, gesture-saved |

Before any click, main is instrumented: dialogs answer themselves, `shell.openExternal`/`openPath` and the clipboard
only record, native menus are captured (then their items clicked), and `jump`/`send-to` are wrapped to record each
call's result (`intercepted[]`). Flags: `--all-rows` (a shot + a jump of every row: the baseline view), `--act` (really
press Approve / send the Reply; refused when the session's terminal is a GUI app; on a build that reaches tmux this
answers a fleet session, which leaves its state: rearm after), `--root`, `--strict` (truth mismatches fail the run).

## Over time: `watch.js` (what Home shows vs. the registry, every 2 s)

```sh
node test/ultra/watch.js [--app <worktree>] --out <dir> [--secs 300] [--every 2]
```

Keeps Home open and samples, on one clock, each live fleet session's registry status (+ tool processes under its pid)
and its Home row (signal, label, snapshot phase, fan-out). Writes `timeline.jsonl` and `summary.json` (per member: the
segments of truth vs. UI, and how long each truth change took to show). Read-only: drive the fleet from another shell.

## Time to attention: `tta.js` (a session starts needing you: how long until the pet says so, and can you act on it)

```sh
node test/ultra/tta.js --app <worktree> --out <dir> --plan approval:3,askuser:3 --quiet kestrel,beacon
node test/ultra/tta.js --app <worktree> --out <dir> --plan question:3,done:3 --interleave
node test/ultra/tta.js --app <worktree> --out <dir> --plan loop:3          # then subagent:3 (costly: ~$0.05 a trial warm)
node test/ultra/tta.js --report <dir> --json <file> --full                # censored medians per kind + raw trials
```

It drives the fleet into a fresh block per trial (kestrel approval, beacon AskUserQuestion, a vibepet question or
statement, an ember /loop fire that stalls on an approval, a delta subagent whose Bash call needs approval), while two
instances of the app watch the isolated root: A with Home closed (bubble, LED, face: the ambient signal) and B with Home
open (the rows). Both are polled read-only every 250 ms. The block's start is the transcript timestamp of the tool_use or
end_turn, or the registry's `statusUpdatedAt` when Claude Code withholds the record. Each trial then resolves from the pet
for real in A: click Net, press the row's Approve / Reply (never when the session's terminal is a GUI app), and the fleet
session is the judge (tool_result written, registry left `waiting`, a new prompt landed). Writes `trials.jsonl`
(appended; trial numbers continue), `shots/<kind>-<n>/` (each signal as it appears, named by seconds since the trigger),
`run.log` and `meta-*.json`. Every prompt is spend-guarded (`--budget`, this probe's estimate incl. hidden calls).
Sounds are recorded instead of played; banners are recorded by test mode, never posted.

## Env vars (all unset = vibepet as shipped)

| var | effect |
|---|---|
| `VIBEPET_CLAUDE_DIR` | Claude config root (default `~/.claude`). `projects/` and `sessions/` are read under it (`overrides.js`). Set = *isolated*: background tasks, localhost servers and dev processes show only when their cwd is (under) a session's cwd in that root. |
| `VIBEPET_USER_DATA` | Electron `userData` (state.json, ledger, single-instance lock, Chromium profile), set before the lock. Different dirs → instances run side by side. Recordings and shorts go to `<userData>/recordings`, not `~/Movies/Vibepet`, so an instance never lists or finishes the user's real screen recordings. |
| `VIBEPET_HOTKEY` | `off` = no global shortcuts at all (jump key and ⌃⌥⌘R), or an accelerator that replaces the saved jump key. `launch()` defaults to `off`. |
| `VIBEPET_TEST` | Test mode (`launch()` always sets it). The app never takes the focus: it is an accessory app from launch (a regular one is activated by macOS on launch), the pet is shown with `showInactive`, and `focus`, theater and gesture training never activate it. OS banners are recorded in `__vibepet.notes`, not posted. Chromium uses a mock Keychain. The instance quits when its launcher dies. Exposes `globalThis.__vibepet` in main: `snapshot()`, `tick()`, `state()`, `win()`, `notes`, `banners`, `banner()`, `bindKey()`, `keyTaken()`, `jumpKey()`, `require`, `paths`. |
| `VIBEPET_RENDER_TEST=1` | `test/content.test.js` adds the full ffmpeg render. That takes about a minute of CPU, so it isn't in `npm test`; run it with `npm run test:render`. Add `VIBEPET_RENDER_KEEP=1` to keep the output. |

## `launch(opts)` → `v`

| opts | |
|---|---|
| `root` (required) | isolated Claude root, passed as `VIBEPET_CLAUDE_DIR`. Must pass the privacy guard. |
| `userData` | default: a fresh `~/.vibepet-ultra/userdata/run-*`, deleted on close. Pass your own to keep it, or to relaunch the same profile. |
| `state` | merged into `userData/state.json` before launch, e.g. `{ setupDone: true }` (skips the first-run Setup card) or `{ pet: 'cat', alerts: 'all' }`. |
| `env` | extra env (e.g. `ANTHROPIC_BASE_URL` for fault injection). It can't override the guarded `VIBEPET_*` keys. |
| `hotkey` | default `'off'`. |
| `appDir` | the checkout to run (default: this one). Electron resolves from its `node_modules` (a symlinked one works). |
| `timeout` | launch timeout, default 90 s. |

`v.app` is the Playwright `ElectronApplication`, `v.win` the pet window (`renderer/index.html`), and `v.windows()` lists all windows. `v.evalMain(fn, arg)` runs `fn(electron, arg)` in main. `v.shot(file, { alpha, bg, page, clip })`, `v.clickPet()`, `v.petPoint()`, `v.homeMode()`, `v.openHome()`, `v.processes()`, `v.close()`. Also `v.pid`, `v.paths` (what the app resolved), `v.readyMs`, `v.logs` (stdout and stderr).

- **Ready**: `launch()` returns once the pet window has loaded, main's hook is installed, the app reports the isolated root and userData (it throws otherwise), Net's canvas has opaque pixels, and the renderer has its first snapshot.
- **Real clicks**: `clickPet()` dispatches trusted mouse events (move → down → up) over CDP onto an opaque pixel of Net. The renderer runs the same handlers as for a hand, including the 220 ms double-click wait. The user's own cursor, keyboard and frontmost app are untouched. OS-level synthetic clicks were rejected on purpose: they land wherever the real cursor is, so they could go into someone's terminal. Panel buttons take Playwright's own trusted click, e.g. `v.win.click('#now [data-do=today]')` (verified: Today posts its note).
- **Home toggles**: one click opens it, the next closes it. `openHome()` throws if Home is already open. A fresh profile's Home is the Setup card (`mode: 'setup'`). Seed `state: { setupDone: true }` for the Now list.
- **Screenshots**: the pet window is transparent. `shot()` captures it with `omitBackground` (an RGBA PNG at device scale) and composites it with straight-alpha "over" onto neutral grey `#8a8f98`, then writes an opaque PNG. Dark panels, light cards and the pale sprites all read on that grey. `{ alpha: true }` writes the raw transparent capture, `{ bg: '#fff' }` picks another backdrop, and `{ page }` captures another window (theater). Capture goes through the compositor, so it works under a locked screen too.
- **close()** quits through Playwright (`app.quit()`). It waits for every process it saw: the main pid's descendants, plus processes started since launch whose command line names this instance's userData (the Electron helpers). Anything still alive 5 s later is ours: it is SIGKILLed and returned in `orphans`. The result is `{ how: 'quit', ms, procs, orphans: [] }`.

## Privacy guard (launch throws before anything starts; `shot()` re-checks before every capture)

- `root`, `root/projects`, `root/sessions` and `userData` must resolve (symlinks followed) inside `~/.vibepet-ultra`.
- Under `projects/` and `sessions/` (down to 5 levels), every symlink must land inside `~/.vibepet-ultra` or in a
  fixture-fleet dir (a path segment containing `-vibepet-ultra-fleet-`). `sessions/` may also link a registry
  file `…/sessions/<pid>.json`. That is the fleet layout: `root/.claude/projects/<fleet dir>` →
  `~/.claude/projects/<fleet dir>`.
- Every registry file under `sessions/`, linked or copied, must name a session whose `cwd` is inside `~/.vibepet-ultra`
  (a fleet repo). A registry carries a live session's name, cwd and status, so this keeps the user's own sessions off
  screen. It also catches a fleet link whose pid was reused: the member exited and one of the user's sessions now owns
  `~/.claude/sessions/<pid>.json`. A dangling link (the member exited) passes, since there is nothing to show.
- Never point an instance at `~/.claude`, and never screenshot one that isn't isolated. Real transcripts must not leave
  this machine, and a screenshot you read is text that leaves it.

## Careful: some of these are real

- The pet window is on the real screen (always on top, bottom-right of the main display), and each instance adds a
  menu-bar icon. Neither takes focus.
- Some panel and menu actions reach the OS. **Jump** uses `ps`, `lsof` and osascript and activates a terminal app; for a session in tmux (every fleet member) it switches an attached tmux client to the session's pane first (no client attached: it only says so), and only an exited session gets a resume command copied to the clipboard. **Approve/Reply** (`send-to`) types keystrokes through Accessibility, or, for a session in tmux, `tmux send-keys` into its pane once the pane's screen shows what the action answers. **Stop** opens a native dialog, then kills a pid. **Record a short** captures the screen. Folder pickers are native. CDP can't answer native dialogs. Only trigger these against fleet sessions and processes you started.
- Chat without an API key runs the user's `claude` login (`claude -p --no-session-persistence`, so no transcript is written). Use `env: { ANTHROPIC_BASE_URL }` to fault-inject.
