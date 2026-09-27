# p5 ship

`node --check` passes on agents.js, main.js, preload.js and renderer/app.js. The recapture captured 19/19 states (idle 0.2% CPU, 327 MB). Both `node test/fanout.test.js` and `node test/agents.test.js` pass. In an isolated harness run (temp HOME and temp userData), there were no console or page errors, and the real `~/Library/Application Support/vibepet` mtime didn't change.

| # | Feature | Status | Files |
|---|---|---|---|
| P3 | Fan-out gauge, no false "stuck" or "done" on subagents | done | agents.js (`classify` side/turnAt/agentWait, `fanout`, `settle`, `scan`), main.js (`scanAgents` → `scan`, snapshot `fanout`), renderer/app.js (`renderRoster`, `foPips`, `foTitle`), renderer/style.css (`#roster em/u`), states.json `18-roster-fanout`, test/fanout.test.js, test/fanout-real.js |
| P4 | The jump door: global key, clickable notifications, relaunch summon | done | main.js (`globalShortcut`, `bindKey`, `KEYS`, Jump key menu, `banner` + `banners` Set, `queueDone({name,id})`, `transition(s, prev)`, `homePos`, `second-instance`, `will-quit`, primary-only `whenReady`), renderer/app.js (`hotkey`/`cyc`, `jumpTo`, `summon`), README.md, states.json `19-summon` |

## Evidence
- P3-2: fixtures a–g pass. (a) pending Agent 5 min + open child: stalled→working, {1,0}. (b) stalled, fanout null. (c) ready→working. (d) ready, {1,1}. (e) {5,3}, and the grandchild is ignored. (f) waiting. (g) {0,0}.
- P3-3: the second `fanout()` with unchanged stats made 0 child `fs.openSync` calls.
- P3-4: `scan(tmpRoot)` returns a parent that's been silent 50 min (child written 1 min ago) as working, fanout 1/1 open.
- P3-5: `node test/fanout-real.js 6` is read-only over the real ~/.claude/projects: 9 sessions, 7 with a subagents dir. Settle changed 1 phase: this designpass orchestrator session, parked→working (25/26 done, 1 open). That open child is the workflow agent writing this file.
- P3-6/7: state 18 shows amber pips on the waiting row and green on the working rows (3 filled + 2 hollow, and 8 + "+4"). The title reads `k of n subagents done · oldest running Xm · descs`. The pill and pet sit at the same y as in 16/17. No setInterval, rAF or CSS animation was added.
- P4-2: there is one `globalShortcut.register` (main.js:422), guarded by its return value and a try. `unregisterAll` is in `will-quit` (main.js:425).
- P4-3: with an empty queue, `hotkey` caused 0 jumps, 0 `say` calls and 0 `blip` calls.
- P4-4: waiting + stalled + working, with three presses < 4 s apart, went s-needs → s-stuck → s-needs. A press after 4.5 s restarted at s-needs. No `say`/`blip` calls.
- P4-5: both banners were retained (Set size 2), each with 1 click and 1 close handler. `emit('click')` sent `jumpTo {id:'s-needs'}` and the renderer jumped there. The Set emptied after click and after close. `Notification.show` was stubbed, so no real banner appeared.
- P4-6: with `register` stubbed to false, the menu label reads `Jump key (taken)` (● ⌃⌥⌘J ○ ⌥⌘J ○ Off). Re-binding for real succeeded, and the key isn't taken on this Mac.
- P4-7: the second launch with the same userData exited with code 0 in 198 ms, and the process count stayed at 1. The window moved to (-6000,-6000) was re-homed to (1056,321) in the workArea, and the renderer got 1 `summon` (`wantUntil` in the future). State 19 shows the pill open.

## Deviations
- stalled → working only when the parent's pending tool is Agent/Task (`agentWait`). If a parent waits on a Bash approval while background agents run, it stays red. The fixture for this passes.
- `fanout` also reads `subagents/workflows/<run>/agent-*.jsonl`, since workflow runs keep their agents there. Without it, a session running a workflow reads parked (the real data above).
- Scan cost: a parent that's been silent 45 min–12 h gets one readdir of its subagents dir per tick. Metas are cached for good, and child phases are cached by {size, mtime}. Both caches clear at 4000 entries.
- Known limit, as specced: a child stuck > 90 s on its own approval still counts as open, so the parent reads working, not stuck, for up to 10 min.
- A test hook, `globalThis.__vibepet`, exists only when `VIBEPET_TEST` is set.

## Try it
- `npm start`, then ask Claude Code to "use 3 subagents to …". The LED stays green with no "needs approval" banner. Hover the pet: the row shows ●●○ pips, and the tooltip lists the descriptions.
- Get an agent to ask a question, switch apps and press ⌃⌥⌘J: its terminal comes forward. Press again within 4 s for the next one. Right-click → Jump key changes the key or turns it off.
- Step away (idle > 60 s) until an agent asks something, then click the banner.
- Drag the pet mostly off-screen, then run `open -a vibepet` (or `npm start` again). It comes back and its pill opens once.
- `node test/fanout.test.js` · `node test/fanout-real.js 24`
