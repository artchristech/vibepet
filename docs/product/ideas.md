# vibepet — idea ledger

Append-only. Each loop the PM (a harsh critic) takes an idea pool, kills anything that nags, adds guilt, speaks first without a user-needed state change, or bloats the pet, then ranks what's left by user value × novelty × feasibility-in-one-loop (1–5 each). The top 2 non-conflicting ideas get built.

Standing constraints: Game mode and Animations default OFF. No nagging or guilt. The hover pill (compose = chat, ⋯ = menu) morphs from the ground shadow. Chat uses the Anthropic API, and every feature degrades gracefully without a key. Never touch `main`, never merge or push, and never touch the real userData (`~/Library/Application Support/vibepet`).

---

## Loop 1 (2026-09-27, branch design/0927)

Pool: 25 ideas from five lenses (agency, usefulness, novelty, seamless, excellence). After merging duplicates, "click the pet to go to the agent" was proposed independently by four lenses, and "show the question/roster in the pill" by three.

Checked before speccing: live `claude` CLI processes each own a tty (`ps -axo pid,tty,comm` → `claude ttys000…`). Session jsonl files contain `{"type":"ai-title","aiTitle":…}` records. `/usr/sbin/lsof` is present.

### Picked

#### P1. Click the pet to go to the agent that needs you (V5 × N3 × F4 = 60)

Merges agency#1, usefulness#1, excellence#2 and part of seamless#5. This is research change #10, which never shipped.

**Spec**
- `main.js`
  - Add `locateSession(s)`. List `claude` CLI processes (`ps -axo pid,ppid,tty,comm`, where comm basename is `claude`). For each, read the cwd with `lsof -a -p PID -d cwd -Fn` and match it to `s.cwd`. If several processes share a cwd, choose the one whose start time (`ps -o lstart=`) is closest to, and not after, the session file's first record. Otherwise take the lowest `since` gap. Cache `id → {pid, tty}` and drop the entry when the pid dies. It runs only on demand (a click), never per tick.
  - Walk the ppid chain (`ps -o ppid=,comm= -p`) up to the first process whose path contains `.app/Contents/MacOS/`. That process's bundle is the terminal host (iTerm2, Terminal, Ghostty, Warp, VS Code/Cursor, …).
  - Add `focusTty(app, tty)`. For iTerm2, osascript iterates windows → tabs → sessions with `tty of s is "/dev/ttysNNN"`, then `select` and `activate`. For Terminal.app, it matches `tty of t` over windows' tabs, sets `selected tab`, sets `index of window` to 1, then activates. For any other host, it runs `open -b <bundleId>`, which activates the app only.
  - Add `ipcMain.handle('jump', id)`, which returns `{ok:true, level:'tab'|'app'}` or `{ok:false, cmd}`. For the fallback, if no process is found, it copies `cd <cwd> && claude --resume <id>` to the clipboard and returns `{ok:false, cmd}`. Nothing in this path ever types into a terminal.
  - `snapshot().agents[]` gains `id`.
- `preload.js`: expose `jump: id => ipcRenderer.invoke('jump', id)`.
- `renderer/app.js` `poke()`: if `agentsIn('waiting')` or `agentsIn('stalled')` is non-empty, `await api.jump(top.id)`, picking the most urgent by RANK and, within a rank, the oldest `since`. Then call `markSeen()`. On success, show no bubble and play no sound; the terminal coming forward is the feedback. On `{ok:false}`, show one line: `"<name>: couldn't find its terminal — resume command copied"`. If nothing is pending, keep today's reaction. A ready (done, unseen) agent also jumps on click, since that's the next place the user wants to be. Only 'none' keeps the pet reaction.
- The first osascript call may trigger macOS's Automation prompt. That only ever happens because of a user click, never at launch.
- README: change `Click = pet` to `Click = go to the agent that needs you`.

**Acceptance**
1. `node --check main.js renderer/app.js preload.js` passes, and `npm start` launches with no console errors, using a temp userData (`--user-data-dir` or `app.setPath` via env). The real `~/Library/Application Support/vibepet` mtime is unchanged.
2. A unit-level check (script in `docs/designpass/` or `test/`) runs `locateSession` against a live `claude` process in a known cwd and returns its pid and tty (`/dev/ttys…`). It returns `null` for a cwd with no process.
3. With a session in iTerm2 or Terminal.app in the `waiting` phase and focus in another app, clicking the pet brings that exact tab frontmost within 1 s (manual check, or verified with `osascript -e 'tell application "iTerm2" to tty of current session of current window'` after the click).
4. With no pending agents, a click still plays the existing reaction and does not call `jump` (verified by a log line or spy).
5. If no process matches, the clipboard holds `cd <cwd> && claude --resume <id>` and exactly one bubble line appears. There is no OS notification and no sound.
6. `grep -n "is waiting on you" renderer/app.js` no longer matches inside `poke()`.
7. No new timers or polling: `ps`/`lsof`/`osascript` are invoked only from the `jump` handler (grep shows no call inside `tick`/`scanAgents`).

#### P2. The question in the pill: hover shows what each agent needs (V4 × N3 × F4 = 48)

Merges usefulness#2 and excellence#3, plus agency#4 without the focus pin. This is pull-only: it appears on hover and never pushes.

**Spec**
- `main.js` `classify()`: return `ask` along with `phase`:
  - `waiting`: the last non-empty line of the final assistant text, trimmed to ≤120 chars.
  - `stalled`: the last `tool_use` as `` `${name}: ${input.command || input.file_path || input.pattern || ''}` ``, trimmed to ≤120 chars.
  - `ready`: the first sentence of the final assistant text, trimmed to ≤120 chars.
  - `working`: omitted.
  
  Also scan the same tail for the latest `{type:'ai-title'}` and return `title = aiTitle` so that two sessions in one repo stop both reading "vibepet". This reuses the existing parse pass, with no extra file reads. `snapshot().agents[]` gains `ask`, `title` and `id`.
- `renderer/index.html`: add `<div id="roster" class="hit hidden"></div>` directly above `#bubble`, in the same slot. The stage is `flex-end`, so content above the pet never moves the pet or the pill.
- `renderer/app.js`:
  - `renderRoster()` builds rows only for agents whose signal is `needs`, `stuck` or unseen `ready`, sorted by RANK, max 4. Each row is a `<button data-id>` containing an LED dot (`LED[sig]`), a bold `title || name`, the `ask` on one line with ellipsis, and a right-aligned, tabular-nums `ago(since)`.
  - The roster is visible only while `#hud.live` is true and at least one row exists. While it is visible it hides the bubble. Collapse follows the pill's existing 500 ms grace.
  - The mousemove hit logic treats `#roster` as part of the hover zone (add it to the `showHud(...)` condition), so moving from the pill up over the pet into the roster doesn't collapse it.
  - Clicking a row calls `api.jump(id)` from P1. When P1 isn't present, the row copies the `ask`.
  - Remove the `#hud` `mouseover` → native `title` tooltip handler, which this replaces.
  - Under reduced motion the roster appears with a 200 ms opacity fade. Otherwise it appears with the pill's `--a` opacity. It has no movement of its own.
- `renderer/style.css`: `#roster` uses the bubble/pill material (`rgba(18,18,20,.92)`, radius 14px). Rows are ≥28px tall, `max-width: 300px`, text 11px, and ellipsis on overflow.
- No API key is used, nothing leaves the machine, and there is no OS notification, sound, or unsolicited appearance.

**Acceptance**
1. `node --check` passes on the edited files, and the app launches with temp userData and no console errors.
2. A fixture test feeds `classify()` three synthetic jsonl tails (a question end_turn, a pending Bash tool_use older than 90 s, and a plain end_turn). It gets `{phase:'waiting', ask:'…?'}`, `{phase:'stalled', ask:'Bash: npm test'}` and `{phase:'ready', ask:<first sentence>}`, each ≤120 chars. A tail containing an `ai-title` record also returns `title`.
3. With only `working` agents or none, hovering shows the plain 2-icon pill and `#roster` stays `hidden` (verified in a designpass capture state).
4. With one waiting and one stalled agent, hovering the pill shows 2 rows ordered needs then stuck, each with its dot colour, title, ask and age. The pet's canvas `getBoundingClientRect()` is identical with the roster shown and hidden (the pet doesn't move).
5. Moving the cursor off both the pill and the roster collapses the roster within about 500 ms plus spring settle. With the cursor off-window it never appears (no speaking first).
6. `grep -n "hud').addEventListener('mouseover'" renderer/app.js` returns nothing.
7. Add designpass states `16-roster-needs` and `17-roster-none` to `docs/designpass/states.json`.

**Why these two together:** P2 tells you which agent needs you and why. P1 takes you there in one click. P2's rows call P1's `jump`. They touch disjoint code (P1: `poke()` plus main-process process lookup; P2: `classify()` output plus a new DOM node above the pet), so they don't conflict. Both work with no key.

### Rejected (one line each)

- **Allow/Deny from the pill (hook bridge)**: the highest ceiling in the pool, but it writes to `~/.claude/settings.json`, opens a security surface and needs the hook schema verified. That's too much for one loop. Revisit in Loop 2 once P1's session locating is proven.
- **Reply to agent from the pill**: typing keystrokes into a terminal is fragile and could land in the wrong pane. It needs P1's tty proof first.
- **Global key that cycles through what needs you**: depends on P1's `jump`. It's a natural Loop 2 follow-up and too thin to justify on its own now.
- **Roster focus pin (agency#4)**: pin state adds mode complexity. The roster (P2) delivers most of the value without it.
- **Two agents, one file / Crossed wires collision guard**: novel and valuable, but it fires unprompted on a heuristic with real false-positive risk (intended handoffs). Deferred until there's a way to measure precision.
- **Tide line ETA on the shadow**: a new mark on the shadow/pill competes with the reveal morph, and heavy-tailed turn times make it lie. Novel but noisy.
- **Groundhog loop detector**: strong novelty and low UI cost. It lost only on ranking (value is situational, and tool_result joins in a 128KB tail are unproven). Top candidate for Loop 2.
- **Headroom context-fullness forecast**: the window and compaction thresholds aren't in the jsonl, so the number would be guesswork dressed as data.
- **Gaze toward the terminal**: needs an Accessibility permission and heuristic window-title matching for a 1–2 px pupil shift. P1 solves the same problem with a click.
- **Menu-bar tray + relaunch summon + hotkey**: the tray adds persistent chrome (bloat), and the hotkey belongs with the queue idea. The second-instance summon is a worthwhile 5-line fix; fold it into any loop.
- **Display-aware positioning + content protection**: the re-home on unplug is real but a rarer pain. `setContentProtection` breaks the designpass capture pipeline and users' own screenshots.
- **Key flow (shell import, verify, error mapping, keyless chips)**: solid hygiene with low novelty. The keyless local answers for `agent?`/`vibe` are mostly covered by P2. Candidate for a later polish loop.
- **First light demo reveal + not-watching state**: the demo reveal is motion the user didn't cause. The `CLAUDE_CONFIG_DIR` plus hollow-antenna "not watching" state is good and small; carry it into a later loop.
- **Give focus back after chat/menu**: the pain is real but needs System Events Automation for app-level focus. Its jump half is P1.
- **While-you-were-away card**: pull-only and useful, but it takes over the first hover after an absence, which feels like the pet speaking first. P2's roster covers the "what's pending" core.
- **Per-agent commit message**: needs a per-session touched-file map and still misses Bash edits. Mostly key-dependent.
- **Idle diet (RAM/CPU)**: worthwhile engineering, but a window resize and a second BrowserWindow are risky for one loop with no user-visible payoff. Do the cheap part (per-file `{size,mtime}` cache in `scanAgents`) opportunistically.
- **Chat streaming + prompt caching**: good for chat, but chat is secondary to the pet's status job and needs a key. Later.
- **Good macOS citizen (reduced motion, silent typewriter, share-hide, hotkey)**: the typewriter `blip()` in `show()` breaking the no-sound promise and reduced motion speeding the spring up (W = 40) are real bugs. They're cheap fixes rather than features and should be fixed in a designpass pass, not spent as a pick. Share-hide is rejected as above.

---

## Loop 2 (2026-09-27, branch design/0927)

Pool: 23 ideas from five lenses. After merging duplicates: resume shelf (agency#3 = usefulness#3), keyboard path (agency#1 = excellence#2, plus seamless#1's relaunch summon), and honest first run (seamless#5 = excellence#4).

Checked before speccing, against the last 120 real session files (read-only):
- `permissionMode` is `"auto"` in 2753 of 2793 records (bypass 12, plan 28). Any idea that predicts permission prompts from settings rules does nothing for this user.
- The `Agent` tool appears in 114 of 120 sessions. Subagents write to `<session-id>/subagents/agent-*.jsonl`, next to a `.meta.json` holding `{toolUseId, description, requestShape:"background"|…, parentAgentId, spawnDepth}`. There are 83 such dirs. The parent's own jsonl stays silent while its children run, so today's rule (a pending tool_use with more than 90 s idle means `stalled`) paints almost every fan-out red with "needs approval". That's a false alarm on the core signal, and it fires an OS notification when the user is away. Background agents also return a tool_result right away ("launched in background"), so the parent can `end_turn` and read as "done" while its work is still running.
- A failed Bash tool_result has `is_error:true` and content that starts with `"Exit code N"`.

### Picked

#### P3. Fan-out gauge, and the end of false "stuck" on subagents (V5 × N4 × F4 = 80)

Novelty#3, rebuilt on the `subagents/` dir (verified above) instead of a tool_result join in a truncated tail. Half of it is a correctness fix. With auto mode, most red LEDs this user sees today are fan-outs rather than real approvals.

**Spec**
- `agents.js`
  - Add `fanout(file)`. It sets `dir = file.slice(0, -6) + '/subagents'` and returns `null` if the dir is missing (one `statSync`). It reads the `*.meta.json` files. Direct children are the metas with no `parentAgentId`; if every meta has one, it takes the metas at the minimum `spawnDepth` (confirm against a real dir first and pin the rule in a test). It considers at most the 32 newest children by jsonl mtime, and only children whose jsonl mtime falls within the parent's current turn. The turn start is the `timestamp` of the last real human prompt in the parent tail (a user record with text content, not a tool_result, not `isMeta`). Add `turnAt` to `classify()`'s return by walking the same `lines` array, with no extra read. If no prompt is found in the tail, fall back to the last 45 min.
  - For each child, classify it with the existing `classify(childFile, mtime)`, cached in a module Map `fp → {size, mtimeMs, phase}` so it re-parses only when size or mtime changed. `working`/`stalled` counts as open only if its mtime is under 10 min old. Anything else counts as done.
  - Return `{total, done, open, oldestOpenAt, newestAt, items:[{desc, open}]}`, where `desc` is `meta.description` capped to 40 chars.
  - Add the pure function `settle(c, fo)`, which returns the phase the pet shows. If `fo?.open > 0`: `stalled` becomes `working`, and `ready` or `parked` becomes `working` (a background fan-out is still work). `waiting` stays `waiting`, because a real question always wins. Otherwise it returns `c.phase` unchanged. Export `fanout` and `settle`.
- `main.js` `scanAgents()`
  - The 45-min skip uses `max(parent mtime, fo?.newestAt)`, so a long fan-out doesn't drop its parent off the pet. Compute `fo = fanout(fp)` before the skip whenever the parent is older than the cutoff: the cost is one `statSync`, and one readdir only if the dir exists.
  - Use `phase = settle(c, fo)` everywhere `c.phase` is used today, including `transition()`. The result: no "is done" line or batched notification while children run, and no "needs approval" for a fan-out.
  - Store `fanout: fo && fo.total ? {total, done, oldestOpenAt, items} : undefined` on the session. `snapshot().agents[]` gains `fanout`.
- `renderer/app.js` `renderRoster()`
  - A row whose agent has `fanout` gets `<s class="fo" title="3 of 5 subagents done · oldest running 6m · <desc list>">`. It holds up to 8 pips in the row's LED colour, filled when done and hollow when open, plus `+N` beyond 8.
  - `working` agents with `fanout.open > 0` join the roster after the pending rows, with the `running` LED. The cap stays at 4 rows total, and pending rows always come first. Clicking one jumps (P1) like any other row.
  - The pips are static and redraw only on tick. No new timer, rAF loop, or motion.
- `renderer/style.css`: `.fo` pips are 5×5 px with 2 px gaps, `vertical-align: middle`, and sit after the title. Hollow means a 1 px border in the LED colour.
- The pet's antenna and pips need no change. They read the settled phase.
- Keyless and local-only. Nothing new appears unprompted. The only visible change without a hover is the LED staying green instead of turning falsely red.

**Acceptance**
1. `node --check agents.js main.js renderer/app.js` passes.
2. `test/` fixtures (tmp dirs, never `~/.claude`):
   - (a) The parent's last record is a pending `Agent` tool_use with mtime 5 min ago. Its child jsonl is a pending tool_use with mtime now. Then `settle(classify(p), fanout(p)) === 'working'` and fanout is `{total:1, done:0}`.
   - (b) Same parent, no `subagents/` dir: the result is `'stalled'` (unchanged behaviour).
   - (c) The parent ends with `end_turn` and the child is open: the result is `'working'`, not `'ready'`.
   - (d) Same as (c) with the child ended (`end_turn`): the result is `'ready'`.
   - (e) Five children, three ended: `{total:5, done:3}`.
   - (f) The parent asks a question and a child is open: the result is `'waiting'`.
   - (g) Children whose mtime is before `turnAt` are not counted.
3. Cache: a second `fanout()` call with unchanged stats makes 0 `readTail` calls on children (spy or counter).
4. A parent whose jsonl mtime is 50 min old, with a child written 1 min ago, still appears in `scanAgents()` output (factor the dir root into a param or env such as `VIBEPET_CLAUDE_DIR` so a test can point it at a tmp dir).
5. A read-only script run over the real `~/.claude/projects` prints each live session's `{phase before settle, phase after, total, done}` and writes nothing.
6. Add designpass state `18-roster-fanout` to `docs/designpass/states.json`: one stuck row, and one working row with 3 of 5 pips filled. The capture shows the pips, and the pet canvas rect is identical to the no-roster state.
7. `git diff` adds no `setInterval`, `requestAnimationFrame` or CSS `animation` for the pips.

#### P4. The jump door: a global key and clickable notifications (V4 × N3 × F5 = 60)

Merges agency#1, excellence#2 and seamless#1's summon. Loop 1 deferred it until P1's jump shipped, and it now has. Today the "needs you" and "done" banners are dead ends, because clicking them does nothing. It jumps straight to the terminal, with no pill UI to focus and no stolen activation: the renderer's existing `pending()` + `jumpTo()` stay the one source of truth, so main never duplicates the queue order.

**Spec**
- `main.js`
  - In `app.whenReady`, call `registerHotkey()`, which calls `globalShortcut.register(state.hotkey, () => send('hotkey'))`.
  - `DEFAULTS.hotkey = 'Control+Alt+Command+J'`. Avoid `Alt+Space` (Raycast/ChatGPT/Alfred) and `Control+Alt+Space` (macOS "next input source").
  - If `register` returns false, keep `hotkeyTaken = true`, register nothing, and say nothing.
  - Add `app.on('will-quit', () => globalShortcut.unregisterAll())`.
  - Menu gains `Jump key` with a submenu of radio items: `⌃⌥⌘J`, `⌥⌘J`, `Off`. When registration failed, the label reads `Jump key (⌃⌥⌘J taken)`.
  - `transition(name, prev, phase, now)` also takes `id` and passes `agent: id` through `emit`.
  - `emit()` and `flushDone()` keep each `Notification` in a module `Set` until its `close`/`click` event, or for 10 min. Electron drops the click handler of a garbage-collected Notification.
  - Add `n.on('click', () => send('jumpTo', { id }))`. Here `id` is the agent that caused the notification, or, for a batched "done" note, the first id in that batch. `doneQueue` stores `{name, id}`.
  - Add `app.on('second-instance', …)`. If the saved pos is off every display, re-home it with the same logic as `createWindow`, which you factor into `homePos()`. Then call `win.showInactive()` and `send('summon')`.
- `renderer/app.js`
  - `api.on('hotkey')`:
    - If `now - cyc.at < 4000` and `cyc.ids.length`, set `cyc.i = (cyc.i + 1) % cyc.ids.length`.
    - Otherwise set `cyc = {ids: pending().map(a => a.id), i: 0}`. The list is snapshotted at the first press, because `jumpTo`'s `markSeen` would reshuffle `pending()` mid-cycle.
    - Set `cyc.at = now`. The target is the first agent from `cyc.i` onward that's still in `snap.agents`.
    - If a target exists, call `jumpTo(a)`. If not, do nothing: no bubble, no sound, no pet reaction.
  - `api.on('jumpTo', ({id}))` jumps to that agent if it's still present. Otherwise it jumps to `pending()[0]`, and with no pending agent it does nothing.
  - `api.on('summon')` sets `wantUntil = performance.now() + 1500` and calls `wake()`. The pill opens once, silently, because the user asked by relaunching.
- `README.md`: add `⌃⌥⌘J = jump to what needs you (again within 4 s = next)`, `click a notification = go there`, and `Lost him? Open vibepet again.`
- No key is needed. Nothing is typed into any terminal. The hotkey and notification clicks are the only new ways in, and both are user-caused.

**Acceptance**
1. `node --check` passes on `main.js`, `renderer/app.js` and `preload.js`. The app launches with temp userData (`--user-data-dir` in a tmp dir) with no console errors, and the real `~/Library/Application Support/vibepet` mtime is unchanged.
2. `grep -n "unregisterAll" main.js` hits inside a `will-quit` handler. `grep -n "register(" main.js` shows exactly one registration path, which is guarded by the return value.
3. With 0 pending agents, a synthetic `hotkey` event (sent from a test hook, or `win.webContents.send('hotkey')` in a dev-only path) produces no `say`, no `blip`, and no `api.jump` call (spy/log).
4. With one waiting agent and one stalled agent (fixture snapshot), three presses under 4 s apart call `api.jump` with the ids needs, then stuck, then needs, in order. A press after more than 4 s restarts at needs.
5. Every `new Notification` has a `click` handler and is held in the retention Set (grep plus review). A spy on `webContents.send` shows `jumpTo` with the correct id when `n.emit('click')` fires in a dev harness.
6. Pre-occupy `Control+Alt+Command+J` (register it first in a scratch Electron script, or stub `register` to return false). The app still launches, and the menu label shows `taken`.
7. Launching a second instance while one runs doesn't start a second process (`pgrep -f vibepet` count unchanged). The existing window gets `summon`, and a pos saved off-screen is re-homed onto the primary display's workArea.

**Why these two together:** P3 makes the signal truthful: red means a real block, and "done" means the work actually finished. P4 makes that signal reachable from anywhere: a key or a banner click lands in the terminal. They touch disjoint code. P3 covers `agents.js` classify/fanout, `scanAgents` phase and roster row content. P4 covers globalShortcut, notifications, second-instance and renderer event handlers. P4's cycle reads `pending()`, which P3 only makes more accurate. Both need no key.

### Rejected (one line each)

- **Allow/Deny from the roster (hook bridge)**: still the highest ceiling. But with this user in `auto` mode, real permission prompts are rare. It edits global `settings.json`, opens a local socket security surface, and any hook wait delays the terminal prompt. Not a one-loop build; revisit if prompts become common.
- **Resume shelf (agency#3 / usefulness#3)**: `claude --resume` already has a picker. It's a nice menu convenience with low novelty. Candidate for a polish loop.
- **Drop a file/text on a row**: drag events through a click-through transparent window are unproven, and copy-then-jump saves little over paste.
- **Proof of green (last test/build chip)**: strong and verified feasible (`is_error` + `"Exit code N"`). It lost only because it edits the same `classify()` walk and roster row as P3. First candidate for Loop 3, with the "before edits" grey state.
- **What it touched (turn footprint)**: useful, but a nested hover-dwell inside the pill adds a second reveal layer, and shared-file diff counts mislead. After proof-of-green.
- **Today so far standup**: a reporting tool, which is outside the pet's status-mirror job (bloat), and 4 MB reads per file at click time.
- **Instant stall via permission rules**: `permissionMode:"auto"` is in 99% of this user's records, and the idea treats auto as unknown, so it's a no-op here. Session-level approvals also make false reds possible.
- **Who touched this (file drop)**: the same drag-through-click-through unknown as above, and Bash writes are invisible. Niche.
- **Session heartbeat strip**: decorative texture on an 11 px row. It adds visual noise where P3's pips already carry the one structural signal worth drawing.
- **Chat as a non-activating panel**: a real pain, but `type:'panel'` accepting text input without activating the app is unverified on Electron 44. Spike it on a scratch branch in a polish loop.
- **Relaunch without amnesia (true ages, persisted seen, chat)**: a genuine bug (`since = now` on first sight). It's cheap: fold `since = mtime` for non-working phases into the next designpass pass rather than spending a pick on it.
- **Jump that explains itself (Automation denial, editors)**: good robustness. Detecting -1743 and `open -b <bid> <cwd>` for editors are small. Polish-loop candidate after P4 raises jump usage.
- **Honest first run / not-watching state (seamless#5 = excellence#4)**: carried a second time. It's small and right, but it helps new installs, not the daily loop. Now first in line for the polish loop, along with `CLAUDE_CONFIG_DIR`.
- **Idle diet v2**: engineering hygiene with no user-visible payoff this loop. P3's per-child `{size,mtime}` cache is the pattern to extend to `scanAgents` later.
- **One material (bubble grows from the pill, no typewriter blips)**: the blip in `show()` is a known no-sound bug. It's a designpass fix, not a product pick.
- **Live roster ages + ⌘-click dismiss**: snoozing needs/stuck can hide a real blocker, and 1 Hz age updates add a timer for little gain.

---

## Loop 3 (2026-09-27, branch design/0927)

Pool: 22 ideas from five lenses. After merging duplicates: Receipt line = Proof of green (usefulness#1 = excellence#3), keyless compose (seamless#1 ~ agency#2), focus hand-back (seamless#4 ⊂ excellence#5), honest first run (seamless#5 ~ excellence#4), and a file-overlap family (crossed wires ~ stale-read).

Checked before speccing (read-only):
- `pmset -g assertions`: a live `claude` process holds its own `caffeinate -i -t 300` (PreventUserIdleSystemSleep), child of pid `claude`. Claude Code already keeps the Mac awake while it works, so novelty#1 is redundant.
- `claude --help` (at `~/.local/bin/claude`): `-p`, `--no-session-persistence` ("sessions will not be saved to disk"), `--tools ""` ("Use \"\" to disable all tools"), `--system-prompt`, `--output-format json`, `--setting-sources`, and `--strict-mcp-config` all exist. `--bare` would skip hooks, but it refuses OAuth ("strictly ANTHROPIC_API_KEY"), so it's unusable for the keyless path.
- `agents.js` `classify()` already computes `turnAt` (P3) and the backward walk. The Loop 2 check (`is_error:true`, `"Exit code N"`) still stands.
- `scan()` already skips project dirs containing `private-tmp`.

### Picked

#### P5. Receipt line: what the turn touched, and whether it's green (V4 × N4 × F4 = 64)

Merges usefulness#1 and excellence#3. This is the first carried candidate from Loop 2 ("proof of green"), with "what it touched" folded inline so it no longer needs a second hover layer. It answers the question a user has at handoff ("did it run the tests after its last edit, and how much did it change?") from data the pet already reads. Keyless, local, and pull-only.

**Spec**
- `agents.js`
  - Export `CHECK_RE`, a runner-specific regex that matches anywhere in a Bash `command`: `(npm|pnpm|yarn|bun) (run )?(test|build|lint|typecheck|check)`, `npx (tsc|jest|vitest|eslint|playwright)`, `(^|[;&|] *)tsc\b`, `pytest`, `cargo (test|build|check|clippy)`, `go (test|build|vet)`, `xcodebuild`, `swift (test|build)`, `make( (test|check|build))?\b`, `node (--test|--check)`. A bare `build` or `test` word does **not** match, so `rm -rf build` isn't a check.
  - Add `receipt(lines, turnAt, side)`, a forward pass from the first record with `timestamp >= turnAt`. It fully parses only lines containing `"tool_use"` or `"tool_result"`, and skips sidechain records unless `side`.
    - Edits: `Edit`, `MultiEdit`, `Write` and `NotebookEdit` tool_use give `files` (a Set of `path.resolve(cwd, file_path)`), `add`/`del` (newline counts of `new_string`/`content` vs `old_string`, summed over MultiEdit `edits[]`), and `lastEditAt`.
    - Check: the last Bash tool_use whose `command` matches `CHECK_RE` gives `{cmd: first line capped to 24 chars, full, id, at}`. It joins to the tool_result with the same `tool_use_id`. `is_error:true` or text matching `/^Exit code (\d+)/` gives `ok:false, exit:N`; any other result gives `ok:true`. No result in the tail means the check is still running or was truncated, so the verdict is `undefined`, not a guess.
    - `truncated`: true when `turnAt` precedes the tail's first record timestamp, or when `turnAt` is the 45-min fallback.
    - Returns `{files:[…], add, del, check?, stale: check && lastEditAt > check.at, truncated}`, or `undefined` when there are no edits and no check.
  - `classify()` attaches `receipt` to every `out()`. It costs one extra pass over the already-read `lines`, with no extra file read.
  - `kidPhase()` stores the child's `receipt` in `kidCache` (the child is classified with `side=true`).
  - `fanout()` folds it into the parent. `files` is the union across counted children. The check is the latest by `at` across parent and children. `stale` is true if any edit in parent or child comes after that check. Subagents do most of the editing in this user's sessions (Agent appears in 114 of 120).
- `main.js` `snapshot().agents[]` passes `receipt` through. No other main-process code reads it.
- `renderer/app.js` `renderRoster()`, for `ready` and `waiting` rows only (`stuck` and running rows keep today's content):
  - After the ask, append `<small class="rc" title="<file list, ≤12, then +N> · +add −del · <full cmd> · exit N">`.
  - Content: `[≥]N file(s)` (≥ when `truncated`), then the verdict chip. `✓ <cmd> <ago(at)>` is ok. `✗ <cmd> exit N` is a fail. `– edited after <cmd>` is stale. No check means no chip, never "untested", because a regex miss must read as unknown.
  - If both the files and the check are absent, render nothing.
  - `$('roster').onclick`: `if (e.target.closest('.rc [data-cmd]'))`, call `api.copy(full)` and return. That neither jumps nor calls `markSeen()`.
- `renderer/style.css`: `.rc` is 10px, `font-variant-numeric: tabular-nums`, 55% opacity. `✓` uses the LED green, `✗` the LED red, and stale 45% grey. No `animation` or `transition` of its own. The row stays one line with ellipsis, so row height is unchanged.
- It never feeds the LED, antenna, `say()`, `emit()`, `banner()` or sounds.

**Acceptance**
1. `node --check agents.js main.js renderer/app.js` passes. The app launches with a temp `--user-data-dir` and no console errors, and the real `~/Library/Application Support/vibepet` mtime is unchanged.
2. `test/receipt.test.js` (tmp fixtures, never `~/.claude`):
   - (a) An Edit of 2 files, then `npm test` with a success result gives `files.length === 2`, `check.ok === true`, `stale === false`.
   - (b) `npm test` with a result `"Exit code 1\n…"` gives `ok:false, exit:1`.
   - (c) A passing check, then an Edit gives `stale === true`.
   - (d) Edits and no check give `check === undefined`.
   - (e) A check tool_use with no tool_result in the tail gives `check.ok === undefined` and renders no chip.
   - (f) `rm -rf build && mkdir build` doesn't match `CHECK_RE`. `cd x && pnpm run test` does.
   - (g) Records before `turnAt` are ignored.
   - (h) A tail whose first record is newer than `turnAt` gives `truncated === true`.
   - (i) A parent with one child that edits 3 files and runs `cargo test` gives a parent receipt with 3 files and a `✓ cargo test` verdict.
3. A cache check: a second `scanAgents()` with unchanged stats makes 0 extra `readTail` calls (the existing counter or spy).
4. `grep -n "receipt" main.js renderer/app.js` hits only `snapshot()`, `renderRoster()` and the roster click handler.
5. Add designpass state `19-roster-receipt` to `docs/designpass/states.json`: one ready row showing `3 files · ✓ npm test 4m` and one waiting row showing `– edited after tsc`. The capture shows both, and the pet canvas `getBoundingClientRect()` is identical to the `17-roster-none` state.
6. `git diff` adds no `setInterval`, `requestAnimationFrame` or CSS `animation`.
7. A read-only script over the real `~/.claude/projects` prints `{title, phase, files, check.cmd, ok, stale}` for live ready/waiting sessions and writes nothing. A human spot-checks 3 of them against the terminal.

#### P6. Chat without a key: run it on the user's own `claude` login (V4 × N3 × F4 = 48)

From seamless#1. Today a keyless user who double-clicks the pet hits the key form, and most vibe coders sign in to Claude Code with OAuth and have no `sk-ant` key. This turns the dead end into a working chat with zero setup. The API key becomes an optional speed-up.

**Spec**
- `main.js`
  - Add `findClaude()`, which is lazy (first chat open only, never at launch or per tick) and caches `claudeBin` (a path or `null`) for the process lifetime.
    - The order is `process.env.VIBEPET_CLAUDE_BIN` (a test hook), `~/.local/bin/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`, `~/.claude/local/claude`. Each is checked with `fs.accessSync(p, X_OK)`.
    - As a last resort it runs one `execFile('/bin/zsh', ['-lc', 'command -v claude'], {timeout: 3000})`.
  - Add `ipcMain.handle('chat-via')`, which returns `'key'` when `hasKey()`, else `'claude'` if `findClaude()` finds a binary, else `null`.
  - `ipcMain.handle('chat')`: when there's no key and `claudeBin` is set, call `chatViaClaude(system, messages)`.
    - `spawn(claudeBin, ['-p', '--no-session-persistence', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--output-format', 'json', '--model', state.model, '--system-prompt', system], {cwd: <os.tmpdir()>/vibepet-chat (mkdir -p), timeout: 90000})`.
    - The transcript goes on stdin, flattened as `User: …` / `${state.name}: …` blocks. It's never passed as an argv value, so text starting with `-` can't be read as a flag.
    - Parse the stdout JSON. If `!is_error`, return `{text: result, via: 'claude'}`. If the result matches `/log ?in|not logged|api key|auth/i`, return `{error: 'nokey'}` so the existing key form appears. Any other error returns its first line.
    - On a non-zero exit with unparsable stdout, retry once without `--model`: the CLI may not know the API model id.
    - One request in flight at a time. A second send waits (the renderer already blocks input while dots show).
  - `--setting-sources ''` keeps the user's hooks (UserPromptSubmit, SessionStart, …) from firing on pet chat. **Verify by hand first.** If the CLI rejects the empty value, use `--settings '{"disableAllHooks":true}'` instead and note which in the commit.
  - `system` is the existing `SYSTEM(state.name)` plus the `buildContext(mode)` block, unchanged. `state.mood` +1 on success, as the API path does.
  - `{error: 'nokey'}` is returned only when there's neither a key nor a binary.
- `preload.js`: expose `chatVia: () => ipcRenderer.invoke('chat-via')`.
- `renderer/app.js` `openChat()`: show `#keyForm` only when `await api.chatVia() === null`. When it's `'claude'`, the first pet message is `using your Claude Code login · ⋯ → Set API key for faster replies`, followed by the existing privacy line. The existing waiting indicator runs during the 5–10 s wait; no new timer.
- `renderer/index.html` `#keyForm <p>`: add one clause: `…or sign in to Claude Code (\`claude\`) and chat works without a key.`
- The spawned `claude` is never visible to the pet as an agent. `--no-session-persistence` writes no jsonl, and the `private-tmp` cwd skip covers it if one ever does.

**Acceptance**
1. `node --check main.js preload.js renderer/app.js` passes, and the app launches with a temp `--user-data-dir`.
2. Before wiring it in, run the exact argv by hand from `$TMPDIR/vibepet-chat` with `echo 'User: say hi' | claude -p …`. It exits 0 and prints JSON with `is_error:false` and a non-empty `result`. Record whether `--setting-sources ''` was accepted.
3. With `ANTHROPIC_API_KEY` unset and `keyEnc` null (temp userData), the `vibe check` chip returns text and the key form never appears.
4. Before and after that chat, `ls ~/.claude/projects | wc -l` is unchanged, `find ~/.claude/projects -newer <marker> -name '*.jsonl' -path '*vibepet-chat*'` finds nothing, and no roster row appears for it.
5. With `VIBEPET_CLAUDE_BIN=/nonexistent`, `PATH=/usr/bin:/bin` and no candidates, the key form appears exactly as today, and no `claude` process is spawned (`pgrep -f 'claude -p'` stays empty).
6. With `VIBEPET_CLAUDE_BIN` pointing at a stub script that prints `{"is_error":true,"result":"Invalid API key · Please run /login"}`, the key form appears and there's no crash or stack in the chat.
7. A probe counter shows `findClaude()` runs 0 times from launch to 60 s idle and exactly once across two chat opens.
8. With a key set, the API path is byte-identical to today. `git diff` shows the `fetch` branch untouched apart from the new keyless `else` branch.
9. `git diff` adds no `setInterval`.

**Why these two together:** P5 finishes the handoff story: the roster says who needs you (P2), what the turn did, and whether it's green, and one click jumps there (P1/P4). P6 fixes the one surface that dead-ends for most users. They touch disjoint code. P5 covers `agents.js` classify/fanout, `snapshot` and the roster row. P6 covers the `chat` IPC, preload, `openChat()` and the key form. Neither pushes anything unprompted, and both work without an API key.

### Rejected (one line each)

- **Keep the Mac awake while agents work (novelty#1)**: redundant. Live `claude` already runs `caffeinate -i -t 300` itself (verified in `pmset -g assertions`).
- **Hold: SIGSTOP an agent (agency#1)**: its core premise is unverified (does Claude Code's API stream survive a multi-minute stop?), and a crash between STOP and CONT freezes the user's agent. Spike it on a scratch branch before it can be a pick.
- **Dispatch: compose starts a real agent (agency#2)**: high agency, but it competes with P6 for the keyless compose field. It's also the first time the pet would launch processes, it needs Automation, and non-iTerm/Terminal hosts only get copy. Loop 4 candidate once P6 shows how keyless compose gets used.
- **Resume in place (agency#3)**: depends on Dispatch's `openInTerminal`, and can start a second process on a session hidden in tmux/ssh/VS Code. Ship it with Dispatch, not before.
- **Wake me for this one: one-shot bell (agency#4)**: bypassing the user's own Mute adds a hidden mode and a long-press gesture. It's too close to the rejected focus pin for too niche a moment.
- **'You asked' line (usefulness#2)**: cheap and right, but it adds a second line to ready rows, just as P5 adds a receipt. Fold `you` into the row `title` tooltip in a designpass pass, not a pick.
- **Crossed wires, pull-only (usefulness#3)**: now honest (pull-only), and it needs P5's `receipt.files`. First in line for Loop 4, on P5's data.
- **Spin counter: same error ×N (usefulness#4)**: strong (V4 × N4 × F4), but it shares P5's turn walk and roster row, the same conflict rule that deferred proof-of-green in Loop 2. Co-first for Loop 4. Reuse P5's forward pass.
- **You said: past answers recalled (novelty#2)**: novel, but a Jaccard match on short questions will surface confident wrong answers in the one moment the user is deciding. Needs a precision measurement on real transcripts first.
- **Turn snapshots via `git stash create` (novelty#3)**: writes refs into the user's repo unprompted on every turn. The pet mirrors state and doesn't mutate the user's repo.
- **Stale-read marker (novelty#4)**: same family as crossed wires, with worse precision (Reads fall out of the 128KB tail first). Merge into the crossed-wires build if at all.
- **Waking the Mac doesn't set off false alarms (seamless#2)**: a real correctness bug, but the fix is a `powerMonitor` resume quiet window (2 ticks) that fits in a designpass pass. The full slept-interval bookkeeping in `classify` is overbuilt.
- **Out of sight counts as away (seamless#3)**: the net effect is more banners for multi-monitor users, and the 30 s threshold is a guess. Revisit only with ledger evidence of missed questions.
- **Borrowed focus: hand the keyboard back (seamless#4)**: a real bug with a permission-free route (`lsappinfo front`). It's small enough to be a designpass fix, and it rides along with P6 only if `closeChat()` is already being touched.
- **The first hover teaches the pet (seamless#5)**: third lap for first-run honesty. It's a new-install aid, not the daily loop, so it's a designpass fix, and it stops being carried as a product pick.
- **Idle diet v3 (excellence#1)**: rejected a third time for the same reason: no user-visible payoff. Drop it from future pools unless someone reports Activity Monitor numbers. Opportunistic: gate `scanGit()` on `.git/index` mtime.
- **Jump that never fails silently (excellence#2)**: good polish (`-1743` detection, `open -b <bid> <root>` for editors), but low novelty. Polish-loop candidate.
- **Proof of green (excellence#3)**: merged into P5.
- **Honest first run / not-watching (excellence#4)**: see seamless#5. The `CLAUDE_CONFIG_DIR` resolution is a one-line correctness fix for the next designpass pass.
- **Chat at glance speed: streaming + caching (excellence#5)**: key-gated polish on a secondary surface. P6 makes the keyless majority's chat work first. Streaming can follow for both paths (`--output-format stream-json`).
