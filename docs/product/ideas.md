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
