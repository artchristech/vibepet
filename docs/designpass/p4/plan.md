# p4 plan: feature pass (idea ledger Loop 1, P1 + P2)

Two picked features from `docs/product/ideas.md`. They touch disjoint code. P2's roster rows call P1's `jump`. Both work with no API key.

Probe before building: Claude Code writes `~/.claude/sessions/<pid>.json` with `{pid, sessionId, cwd}` for every live CLI. That gives an exact pid → session match, so the cwd + start-time heuristic from the spec becomes the fallback. Live `claude` processes each own a tty (`ttys000…`), and the user's host is Ghostty (claude → zsh → login → Ghostty.app). iTerm2 isn't installed.

## P1. Click the pet to go to the agent that needs you

| Where | Change |
|---|---|
| agents.js (new, split from main.js:92-137 so node tests can require it) | `readTail`, `textOf`, `classify`; `psAll()` (one `ps -axo pid=,ppid=,tty=,lstart=,comm=`), `locateSession(s, procs)` (cached id → {pid, tty}; exact via sessions/<pid>.json, else `lsof -a -p PID -d cwd -Fn` == s.cwd, tie → start closest to (not after) the session file's birthtime), `hostApp(pid, procs)` (walk the ppid chain to the outermost `*.app`), `focusTty(bundleId, tty)` (iTerm2 `tty of session`, Terminal `tty of tab`; select + activate) |
| main.js:114-137, :158, :270 | require agents.js; `sessions` entries keep ask/title; `snapshot().agents` gains `id, ask, title` |
| main.js (new `ipcMain.handle('jump')` near :414) | tab focus, else `open -b <bundleId>`, else copy `cd <cwd> && claude --resume <id>` → `{ok:false, cmd}`. Never types into a terminal |
| preload.js | `jump: id => ipcRenderer.invoke('jump', id)` |
| renderer/app.js:497-510 `poke()` | pending (needs > stuck > unseen ready, oldest first) → `jumpTo(top)`; success = silent; failure = one quiet bubble line. Nothing pending → the old reaction |
| renderer/app.js:286-302 `say/show` | `quiet` option skips the typewriter blip (acceptance 5: no sound) |
| README.md:12 | `Click = go to the agent that needs you` |
| package.json build.files | add `agents.js` |

## P2. The question in the pill

| Where | Change |
|---|---|
| agents.js `classify()` | `ask`: waiting = last line of final text (keeps its `?`), stalled = `Tool: command/file_path/pattern`, ready = first sentence; each ≤120 chars. `title` = latest `ai-title` in the same tail (sticky per session in main.js) |
| renderer/index.html:35 | `<div id="roster" class="hit hidden"></div>` above #bubble |
| renderer/app.js | `renderRoster()` from `renderHud()`: rows for needs/stuck/unseen-ready, RANK order, max 4, `<button data-id>` with dot, title‖name, ask, age. Visible only while `#hud.live` and rows > 0. Ready rows are held while the pill is open (hover's markSeen would otherwise delete them at p .5, before the roster shows at p .6). `zoneRect` and the mousemove showHud condition include #roster. Row click → `jumpTo`, or copies the ask without jump. Opacity = pill's `--a`; reduced motion → 200 ms fade. Remove the `#hud` mouseover title handler (:513) |
| renderer/style.css | #roster: bubble material, 14px radius, max-width 300px, rows ≥28px, 11px, ellipsis, tabular-nums age. `#roster:not(.hidden) ~ #bubble { display:none }` |
| docs/designpass/states.json | `16-roster-needs`, `17-roster-none` |

## Acceptance (from the ledger)
P1: 1) node --check; temp-userData launch with no console errors; real userData mtime unchanged. 2) `node test/agents.test.js` locates a live claude (pid + /dev/ttys…) and returns null for a cwd with no process. 3) Tab focus within 1 s (manual: no iTerm2 here, and Terminal Automation would raise a TCC prompt). 4) No pending agents → old reaction, no jump. 5) No match → clipboard holds the resume command, one bubble line, no sound or notification. 6) no "is waiting on you" in poke(). 7) ps/lsof/osascript only reachable from the jump handler.
P2: 1) node --check + launch. 2) classify fixtures (waiting ends '?', `Bash: npm test`, first sentence, ≤120, title). 3) State 17: plain 2-icon pill, roster hidden. 4) State 16: 2 rows needs→stuck; the pet rect is identical shown vs hidden. 5) Collapse follows the 500 ms grace; nothing shows with the cursor off-window. 6) grep: no hud mouseover handler. 7) States 16/17 added.
