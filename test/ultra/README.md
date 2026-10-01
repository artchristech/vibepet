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

## Env vars (all unset = vibepet as shipped)

| var | effect |
|---|---|
| `VIBEPET_CLAUDE_DIR` | Claude config root (default `~/.claude`). `projects/` and `sessions/` are read under it (`overrides.js`). Set = *isolated*: background tasks, localhost servers and dev processes show only when their cwd is (under) a session's cwd in that root. |
| `VIBEPET_USER_DATA` | Electron `userData` (state.json, ledger, single-instance lock, Chromium profile), set before the lock. Different dirs → instances run side by side. |
| `VIBEPET_HOTKEY` | `off` = no global shortcuts at all (jump key and ⌃⌥⌘R), or an accelerator that replaces the saved jump key. `launch()` defaults to `off`. |
| `VIBEPET_TEST` | Test mode (`launch()` always sets it). The pet appears without taking focus (`showInactive`; `focus`, theater and gesture training never activate the app). OS banners are recorded in `__vibepet.notes`, not posted. Chromium uses a mock Keychain. The instance quits when its launcher dies. Exposes `globalThis.__vibepet` in main: `snapshot()`, `tick()`, `state()`, `win()`, `notes`, `banners`, `banner()`, `bindKey()`, `keyTaken()`, `jumpKey()`, `require`, `paths`. |
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
- Under `projects/` and `sessions/` (4 levels deep), every symlink must land inside `~/.vibepet-ultra` or in a
  fixture-fleet dir (a path segment containing `-vibepet-ultra-fleet-`). `sessions/` may also link a registry
  file `…/sessions/<pid>.json`. That is the fleet layout: `root/.claude/projects/<fleet dir>` →
  `~/.claude/projects/<fleet dir>`.
- Never point an instance at `~/.claude`, and never screenshot one that isn't isolated. Real transcripts must not leave
  this machine, and a screenshot you read is text that leaves it.

## Careful: some of these are real

- The pet window is on the real screen (always on top, bottom-right of the main display), and each instance adds a
  menu-bar icon. Neither takes focus.
- Some panel and menu actions reach the OS. **Jump** uses `ps`, `lsof` and osascript, activates a terminal app, or copies a resume command to the clipboard. **Approve/Reply** (`send-to`) types keystrokes through Accessibility. **Stop** opens a native dialog, then kills a pid. **Record a short** captures the screen. Folder pickers are native. CDP can't answer native dialogs. Only trigger these against fleet sessions and processes you started.
- Chat without an API key runs the user's `claude` login (`claude -p --no-session-persistence`, so no transcript is written). Use `env: { ANTHROPIC_BASE_URL }` to fault-inject.
