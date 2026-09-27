# p5 plan

## P3. Fan-out gauge, and the end of false "stuck" on subagents

Subagents write `<session>/subagents/agent-*.jsonl` (records are `isSidechain: true`) plus `agent-*.meta.json` `{description, toolUseId, parentAgentId?, spawnDepth}`. While they run, the parent jsonl is silent, so the 90 s rule paints it red. Background agents also let the parent `end_turn`, and it reads as done.

| Where | Change |
|---|---|
| agents.js:45-74 `classify` | Takes a third arg `side`: child files include sidechain records. Returns `turnAt`, the timestamp of the last real human prompt in the tail (fallback: now − 45 min), and `agentWait` (the pending tool is Agent/Task). |
| agents.js (new) `fanout(file, turnAt)` | `<file minus .jsonl>/subagents`, or null if missing. Keeps children with mtime ≥ turnAt. Direct = metas with no `parentAgentId`, else the min `spawnDepth`. Takes the 32 newest. Each child goes through `classify(…, true)`, cached by {size, mtimeMs}. Open = working/stalled with mtime < 10 min. Returns `{total, done, open, oldestOpenAt, newestAt, items[{desc, open}]}`. |
| agents.js (new) `settle(c, fo)` | Pure. If `fo.open > 0`, ready/parked → working, and stalled → working when the pending tool is Agent/Task. Waiting stays waiting. |
| agents.js (new) `scan(root, sessions, onChange)` | `scanAgents` body moved from main.js:93-120, so the claude dir can be injected in tests. The 45-min skip uses max(parent mtime, `fanout().newestAt`) and only probes parents < 12 h old. The phase is `settle()`d everywhere, `onChange` included. The session carries `fanout`. |
| main.js:93-132, 220-229 | `scanAgents = () => scan(CLAUDE_DIR, sessions, transition)`. `snapshot().agents[]` gains `fanout`. |
| renderer/app.js:404-409 `renderRoster` | Rows with fanout get ≤ 8 static 5 px pips in the row's LED colour (filled = done, hollow = open, +N). Title: `k of n subagents done · oldest running Xm · descs`. Working agents with `fanout.open > 0` follow the pending rows, 4 rows max, and a click jumps. |
| renderer/style.css:106-125 | `#roster em` / `u` pip styles. No animation. |
| docs/designpass/states.json | `18-roster-fanout`. |
| test/fanout.test.js (new), test/fanout-real.js (new, read-only) | Fixtures a–g, the cache check, the 50-min parent, and before/after over the real `~/.claude/projects`. |

Deviation, noted: stalled → working happens only when the parent's pending tool is Agent/Task. A parent blocked on a Bash approval while background agents run stays red. The spec's blanket rule would hide the one signal the pet exists for.

### Acceptance
1. `node --check` on agents.js, main.js and renderer/app.js.
2. Fixtures: (a) pending Agent 5 min + open child → working, {1,0}. (b) no subagents dir → stalled. (c) end_turn + open child → working. (d) child ended → ready. (e) 5 children, 3 done → {5,3}. (f) question + open child → waiting. (g) children older than turnAt excluded.
3. A second `fanout()` with unchanged stats makes 0 child reads (spied through `fs.openSync`).
4. A 50-min parent with a 1-min child still appears in `scan()`.
5. `node test/fanout-real.js` prints phase before/after settle and writes nothing.
6. State 18 shows pips, and the canvas rect is unchanged.
7. No setInterval, rAF or CSS animation added.

## P4. The jump door: global key + clickable notifications + relaunch summon

| Where | Change |
|---|---|
| main.js:2 | Import `globalShortcut`. |
| main.js:18-22 | `DEFAULTS.hotkey = 'Control+Alt+Command+J'`. |
| main.js:64-86 | `banner(body, id, silent)`: every Notification is kept in a Set until close/click, and a click sends `jumpTo {id}`. `emit` and `flushDone` use it. `doneQueue` holds `{name, id}`, and the batch clicks through to the first id. |
| main.js:122-132 | `transition(s, prev)` passes `id`. |
| main.js (new) `bindKey()` | The single register path, guarded by its return value (and a try), sets `keyTaken`. `will-quit` → `unregisterAll()`. |
| main.js:394-423 | Menu `Jump key (taken?)` radio: ⌃⌥⌘J / ⌥⌘J / Off. |
| main.js:323-329 | `homePos(pos)` factored out. `second-instance` re-homes an off-screen window, `showInactive()`, sends `summon`. `whenReady` runs only in the primary instance. |
| renderer/app.js:353-382 | `hotkey`: a press < 4 s after the last advances `cyc.i`, otherwise it snapshots `pending()` ids, then jumps to the next id still present. An empty queue does nothing. `jumpTo {id}`: that agent, else `pending()[0]`, else nothing. `summon`: `wantUntil = now + 1500`. |
| README.md | The key, notification click, and "Lost him? Open vibepet again." |
| docs/designpass/states.json | `19-summon` (main sends `summon`, and the pill opens). |

### Acceptance
1. `node --check` on main.js, renderer/app.js and preload.js. The app launches with temp userData and HOME and no console errors. The real userData mtime is unchanged.
2. `unregisterAll` is inside `will-quit`, and there is one `register` call guarded by its return.
3. With 0 pending agents, `hotkey` makes 0 say/blip/jumpTo calls.
4. With waiting + stalled, three presses < 4 s apart give needs→stuck→needs, and a press after > 4 s restarts at needs.
5. Every Notification is retained and has a click handler. Emitting `click` sends `jumpTo` with the id.
6. With register stubbed to false, the menu label reads `(taken)`.
7. A second launch exits (the process count is unchanged). The first gets `summon`, and an off-screen window is re-homed.
