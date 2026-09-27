# p4 ship

`node --check` passes on main.js, agents.js, preload.js and renderer/app.js. The recapture launched and captured 17/17 states (idle 0.6% CPU, 274 MB). `node test/agents.test.js` passes. An isolated Playwright run (temp HOME and temp userData, with a fake session whose cwd has no process) had no console errors. The real `~/Library/Application Support/vibepet` dir mtime stayed at 1790538733. Its state.json mtime moves because the user's own vibepet instance (pid 12389) is running; that instance is untouched.

| # | Feature | Status | Files |
|---|---|---|---|
| P1 | Click the pet to go to the agent that needs you | done (tab-level focus not verified live) | agents.js (new), main.js (`jump` handler, snapshot id), preload.js, renderer/app.js (`pending`, `jumpTo`, `poke`, `say` quiet), README.md, package.json build.files |
| P2 | The question in the pill | done | agents.js `classify` (ask, title), main.js (sticky title), renderer/index.html (#roster), renderer/app.js (`renderRoster`, `rosterShow`, zoneRect, hover hit, held ready rows; hud title handler removed), renderer/style.css, docs/designpass/states.json (16, 17) |

## Evidence
- P1-2: `test/agents.test.js` finds a live claude by cwd `/Users/christopherharris/projects` → pid 21401, `/dev/ttys006`, and returns `null` for an empty temp dir. Every live CLI also matches exactly through Claude Code's `~/.claude/sessions/<pid>.json` (sessionId). That registry is the first lookup; cwd + start time is the fallback. The host chain resolves to `/Applications/Ghostty.app` → `com.mitchellh.ghostty`.
- P1-3: not verified. iTerm2 isn't installed, and the user's terminal is Ghostty, which gets app-level focus (`open -b`). A Terminal.app check would raise a macOS Automation prompt on the user's screen, so it's left as a manual check.
- P1-4: with nothing pending, a click plays the old reaction and makes 0 jump calls (stubbed handler counted them).
- P1-5: with no match, the clipboard held `cd <cwd> && claude --resume nomatch-1111`, the bubble showed 1 line, blip ran 0 times, and there was no notification. The clipboard was restored afterwards.
- P1-6/7: "is waiting on you" is gone from `poke()`. ps, lsof and osascript are only reachable from `ipcMain.handle('jump')` (main.js:377).
- P2-2: fixtures give waiting `…?` (≤120), stalled `Bash: npm test`, ready = the first sentence, and title from `ai-title`.
- P2-3/4: state 17 shows the plain 2-icon pill with the roster hidden. State 16 shows 2 rows (amber needs, then red stuck) with title, ask and age. The pet canvas rect is identical with the roster shown and hidden.
- P2-5: the roster collapsed 546 ms after the cursor left, and it can't show unless `#hud.live`.

## Notes
- Ready rows: hovering marks ready agents as seen at p .5, but the roster opens at p .6. `heldReady` keeps those rows until the pill closes, so finished agents still get a row.
- Capture leak (existing, not from this pass): in 06-waiting, a live `projects is done` event slipped through because `freeze` doesn't drop `event`.

## Try it
- `npm start`, get a Claude Code session to ask a question, then hover the pet. The pill lists it. Click the row or the pet: iTerm2/Terminal bring that tab forward, and Ghostty and other hosts activate the app.
- Close that terminal and click again. The resume command is now on your clipboard.
- `node test/agents.test.js`
