# vibepet surface map (round 0, REPO main @ 649beb2, read-only)

All refs are `file:line` on main. "R" = renderer/app.js, "M" = main.js, "A" = agents.js, "P" = ports.js, "T" = theater/*.

## 0. Blockers and hazards to know before driving anything

| # | Finding | Where | Consequence for ultra |
|---|---|---|---|
| B1 | **No `VIBEPET_CLAUDE_DIR` on main.** `CLAUDE_DIR` is hardcoded to `~/.claude/projects` | M:18 (used M:118 scan, M:718 Theater menu) | A launched main build scans the user's 15 REAL sessions. Titles (`aiTitle`), `ask` (last assistant line / tool command) and goal text (first prompt) render in Home (`.na`, `.ng`), the roster and bubbles. **Screenshotting main as-is breaks rule 2.** Add the env first (r0-harness worktree exists at ULTRA/wt/r0-harness). |
| B2 | Other hardcoded `~/.claude` paths the env must also cover | A:9 `SESS_DIR=~/.claude/sessions`. T/index.js:23 path guard (`timeline()` throws 'not a session file' outside `~/.claude/projects`). P:123 bg-task info reads `~/.claude/projects/<pd>/*.jsonl` | Theater can't open fleet files under ULTRA/root. If fleet claude runs with `CLAUDE_CONFIG_DIR=ULTRA/root/.claude`, its `sessions/<pid>.json` likely lands there too (unverified), so the exact pid match at A:314-316 misses and falls back to the lsof cwd match (A:317-323). |
| B3 | `npm test` has **no script**. package.json:6-9 only has `start` and `dist` | package.json | `npm test` fails with "Missing script". The gate that works is `node --test test/*.test.js`: 10 files, all pass, ~59 s (SKIP_RENDER=1). Add `"test": "node --test test/*.test.js"`. |
| B4 | Chat sends real transcript text off-machine | M:454-472 `agentTranscript`, M:496 (`agent`/`next` modes), M:494 (`goal` mode), M:483-489 git diff | With a real CLAUDE_DIR, chat ships real transcript text to Anthropic. Only chat against the isolated root. Default model is `claude-sonnet-5` (M:30); seed `state.model` to `claude-haiku-4-5-20251001` and count chat spend against the $5. |
| B5 | Side effects that leave the test instance | jump fallback writes the clipboard (M:693-694). send-to without AX opens System Settings (M:421). jump 'noax' opens Settings (M:688). local-open runs `shell.openExternal` (M:411). local-stop/localMenu use a native `dialog.showMessageBox` (M:374, M:414). `openChat` steals app focus `app.focus({steal:true})` (R:784 → M:670). openTheater steals focus (M:768). OS banners fire when `away()` (M:80, M:112). | Stub these in main via `app.evaluate` (patch `dialog.showMessageBox`, `shell.openExternal`, `clipboard.writeText`; they are looked up at call time). Seed `muted:true`. Expect focus theft while the user types. |
| B6 | Global shortcuts are process-global | M:789 `Control+Alt+Command+J` (default `state.hotkey`, M:31). M:791 `Control+Alt+Command+R` always registered | A test instance grabs ⌃⌥⌘J/⌃⌥⌘R from the user. If the user's vibepet is running, register fails (`keyTaken`). Seed `hotkey:null` and trigger the hotkey by IPC instead (§7). |
| B7 | tmux sessions can't be jumped, approved or replied to | A:327-333 `hostApp` walks ppid for a `*.app/Contents/` ancestor. tmux server is daemonized (ppid 1), so the chain is claude→shell→tmux→launchd | `jump` → `{ok:false, cmd}` and the clipboard is overwritten (M:693). `send-to` → "couldn't find its tab" (M:424). The fix point is `send-to`/`jump`: map `loc.tty` to a tmux pane with `tmux list-panes -a -F '#{pane_tty} #{pane_id}'`, then `send-keys` (no AX needed). |
| B8 | Home caps rows at 8, roster at 6 | R:901 `.slice(0, 8)`, R:577 `.slice(0, 6)`, R:543 hud chips 6, M:355 servers 8 | With 15 sessions, 7 are invisible in Home. Parked sessions are dropped entirely (A:284). |
| B9 | Dead code: the click menu `#actions` / `openMenu()` is never called | R:756 (no caller). index.html:49-56 | One click opens Home (R:729). Ignore `#actions`. |
| B10 | No "Collision Radar" yet (grep: 0 hits) | — | Input already in the snapshot: `agents[].receipt.files` (absolute edited paths, M:351, from A:64-110 + A:112-119 fold), `cwd`, git root (M:259-265). |

## 1. Windows

| Window | Created | Size / pos | Chrome | Playwright handle |
|---|---|---|---|---|
| Pet (Net + every panel) | M:627-651 `createWindow` | W×H = 660×960 (M:14). Pos = `homePos(state.pos)`, else the primary work area's bottom-right: `x=wa.x+wa.w-660-24`, `y=wa.y+wa.h-960` (M:605-612). On load, `moveTo` → `place()` (place.js:22-33) **trims the height** (h ≠ 960 near the menu bar or Dock) and may flip panels below Net (`below` IPC). petTop defaults to 276 (M:16), and the renderer reports the real value via `pet-top` (R:437, R:463). | frameless, transparent, `#00000000`, no shadow, resizable:false, skipTaskbar, alwaysOnTop 'floating' (M:635), all workspaces + fullscreen (M:636), `acceptFirstMouse` (M:632). **Click-through:** `setIgnoreMouseEvents(true,{forward:true})` (M:637), toggled by renderer `set-ignore` when the cursor is over a `.hit` element (R:705-714). Canvas hits need alpha>60 at the pixel (R:633-640). | `app.firstWindow()`. `<title>vibepet</title>` (renderer/index.html:5). URL `file://…/renderer/index.html`. contextIsolation, no sandbox flag. |
| Theater (one per session file) | T/index.js:57-67 `open` | 1280×800, min 820×520, default position | `titleBarStyle:'hiddenInset'`, bg `#07080c`, sandbox:true, window.open denied, navigation blocked (T/index.js:63-64). Reopening the same file focuses the existing window (T/index.js:58-59). | `app.waitForEvent('window')` then match url `…/theater/player.html`. Title starts as `Theater` (player.html:6) and becomes `Theater — <cwd basename>` (player.js:174). |
| Recorder (hidden) | content/index.js:30-36, lazily on the first recording | 200×200, show:false | — | url `…/content/recorder.html`, title `vibepet recorder`. Appears only after `/record` or rec-toggle. |
| Tray | M:776-781 | menu bar | click → `toggleNet(trayPoint())`. Right-click → `buildMenu()` (native, not Playwright-drivable) | — |
| Native menus | M:703-765 `buildMenu` (right-click on Net R:731 → `menu` IPC M:771, `⋯` `#homeMore` R:939, `/settings` R:963) | — | OS menu | Not in DOM. Reach the menu items' effects by IPC/`webContents.send` (see each surface). |

Other launch facts: `requestSingleInstanceLock` (M:23) is keyed by userData, so `--user-data-dir=ULTRA/userdata/<x>` co-exists with the user's install. Dock is hidden (M:847). Hardware acceleration is off (M:22). State lives in `<userData>/state.json` (M:34, defaults M:28-32) and `<userData>/ledger.jsonl` (M:161).

Seed state.json before launch: `{"setupDone":true,"muted":true,"hotkey":null,"model":"claude-haiku-4-5-20251001","alerts":"all","pos":{...}}`. Gesture stays off by default (M:797).

Launch: `_electron.launch({ executablePath: require(REPO+'/node_modules/electron'), cwd: WT, args: ['.', '--user-data-dir=…'], env: {...process.env, VIBEPET_TEST:'1', VIBEPET_CLAUDE_DIR:ULTRA/root/.claude /*after B1*/, VIBEPET_CLAUDE_BIN:<wrapper>} })`. This is the same pattern as `~/.claude/skills/designpass/scripts/capture_electron.mjs:34-38`; playwright-core is in `~/.claude/skills/designpass/node_modules`, not in the repo.

## 2. Test hooks

- Main: `globalThis.__vibepet = { banners, banner, bindKey, keyTaken }`, only with `VIBEPET_TEST` (M:855). It does **not** expose sessions, agents, tick, snapshot or openTheater, so main state is opaque. Candidates to add: `tick`, `snapshot`, `sessions`, `openTheater`, `ports.poll`.
- Main via Playwright: `app.evaluate(({BrowserWindow, ipcMain, dialog, shell, clipboard}) => …)`. `ipcMain.emit('<on-channel>', {sender:…}, arg)` drives `ipcMain.on` handlers. `ipcMain.handle` handlers can be swapped with `removeHandler` + `handle` (states.json `12-chat`).
- Renderer: app.js is a classic script, so top-level `let/const` are evaluable by name: `snap`, `openChat()`, `closeChat()`, `renderHome()`, `renderHud()`, `jumpTo(a)`, `command('/x')`, `send(text,mode)`, `pending()`, `addMsg()`, `cursor`, `rp`, `hoverHit`. Note `snap` is overwritten by the next `tick` (3 s) unless the channel is frozen.
- `docs/designpass/states.json` holds `freeze:["tick","cursor"]` (monkeypatches `webContents.send` per window), a `prelude` that resets renderer state, and 31 states (01-idle … 30-gesture-hint). The `[main]` states inject `event`s and stub `chat-via`. All of them fake `snap`, so they are useless for live-fleet truth.
- Theater: `window.__theater = { seek, beat, card, pin, T }` is always on (player.js:191).
- Env: `VIBEPET_CLAUDE_BIN` overrides the claude used for chat (M:515). `ANTHROPIC_API_KEY` forces the key engine (M:436-448). `DESIGNPASS` is unused by the app.

## 3. Data pipeline feeding every surface

`setInterval(tick, 3000)` (M:19, M:854). Re-entry is guarded by `busy` (M:325-343). Order:
1. `decay()` M:54.
2. `scan(CLAUDE_DIR, sessions, transition)` A:259-289:
   - skip dirs containing `private-tmp`/`scratchpad` (A:263; fleet dirs `-vibepet-ultra-fleet-` are NOT skipped);
   - per `*.jsonl`, skip if mtime >45 min, unless ≤12 h old with a subagent written in the last 45 min (A:271);
   - `classify` A:134-172 reads a 128 KB tail, widening to 16 MB (A:11-26);
   - `fanout`+`settle` A:219-256;
   - parked rows are dropped from the output (A:284).
3. `unstick` M:230-249: a stalled session whose claude pid has a child process started ≥ toolAt-2 s becomes working. Uses `psAll` + `locateSession`.
4. Goals: `goalFor` M:135-147 (first intentful prompt, A:175-198). `watchDrift` M:183-200 needs the same verdict on 2 ticks. `nag` M:215-224.
5. `scanGit` M:267-310: `rev-parse`, `log -1`, `diff HEAD --numstat`, `ls-files --others`, `branch`, each with a 5 s timeout.
6. `watchLocal` M:363-369 → `ports.poll()`.
7. `send('tick', snapshot())` M:345-359 → R:433.

Phase rules (classify, newest record first, A:152-170):

| phase | condition |
|---|---|
| `working` | last assistant record has tool_use and idle ≤90 s; or a user/tool_result record and idle ≤120 s |
| `stalled` | last assistant has tool_use and **idle >90 s** (A:159). Carries `ask`=`toolAsk`, `agentWait`, `toolAt`. The UI calls it "stuck"/needs approval. |
| `waiting` | end_turn/stop_sequence/max_tokens, idle ≤5 min, text ends with `?` (A:163) |
| `ready` | same, without `?` |
| `parked` | end_turn and **idle >5 min** (A:161). Or a `[Request interrupted` user record. Or a user record idle >120 s (A:169). Hidden everywhere. |

Fan-out: a child is open when working/stalled and mtime <10 min (A:241). Max 32 direct kids. `settle` keeps the parent `working`, or `stalled` when a child is stuck (A:252-256).

Transitions → events (M:120-130):
- working/stalled→ready: `agentDone`, plus an OS banner batch when `away()`, one per 20 s (M:96-110).
- →waiting: `agentNeeds`.
- working→stalled: `agentStalled`, announced only after `unstick` (M:244-248).
- Blocked >3 min: `agentNag`, once per episode (M:214).

`emit` drops kinds per `state.alerts` (M:76): `blocked` drops agentDone/goalBack/localhost; `done` drops localhost.

Snapshot keys (M:345-359): `agents[]{id,name,title,goal{text,auto,done,verdict},phase,since,ask,fanout,receipt{files[],add,del,check,stale,truncated}}`, `git`, `servers[≤8]{port,pid,name,http}`, `local{servers,procs,tasks,names}`, `rec`, `perms{ax,screen}`, `setupDone`, `size`, `alerts`, `feel`, `pet`, `pets`, `scale`, `hasKey`, `hour`, `game` stats.

## 4. Surfaces

### 4.1 Net Home panel (Now + chat + command bar, Setup card, recording + localhost)

- **Open (real UI):**
  - single left-click on an opaque pixel of `canvas#pet`; opens after a **220 ms** delay that waits out a double-click (R:717-730);
  - double-click opens at once (R:728);
  - drag >4 px moves Net instead (R:727);
  - a second click toggles it closed.
  - Also: menu "Open Home" → `event{kind:'openChat'}` (M:716 → R:521). "Setup…" → `openSetup` (M:717 → R:990).
- **Close:** `#chatClose`, Esc (R:801), **window blur** while not sending (R:803), `hide` (R:465).
- **DOM** (renderer/index.html:11-34):
  - `#chat` (`.hidden` toggled; `.fresh` when there are no msgs; `.busy` while sending);
  - header: `#chatHead #chatDot #chatName #chatMeta #homeMore(⋯→native menu) #chatClose`;
  - `#setup` (Setup card) / `#now` (Now list): exactly one is visible (R:897-899);
  - `#keyForm #keyInput`, `#renameForm #renameInput`, `#msgs`, `#chips button[data-mode]`, `form#chatForm input#chatInput button#chatSend`, `#slash`, `#chatNote #chatNoteText`.
- **Now list** `renderHome` R:895-923:
  - rows `#now .nlist .nr.<needs|stuck|ready|running>[data-id]` with `.tl`, `.nm b` (title), `small` (name · phaseTime), `.ng` goal (`.done|.on|.drift`), `.na` ask (needs/stuck only);
  - actions in `.nb button[data-do=…]`;
  - footer `.nfoot`: `button[data-do=rec]`, `button[data-do=today]`, `.srvs .srv[data-pid][data-port] button[data-do=open|stop]`;
  - empty state `.nempty`.
  - Re-rendered on every tick while open and not sending (R:436). Skipped while an `INPUT` inside `#now` has focus (R:900). Sorted by `byUrgency` (R:893): needs > stuck > ready > running, then newest `since`.
- **Setup card** `renderSetup` R:971-983: `.sq .seg button[data-k=pet|size|feel|alerts][data-v]` → `set-prefs` (M:402-409). `.perm button[data-perm=ax|screen]` → `open-perm` (M:399, which calls `isTrustedAccessibilityClient(true)` and so prompts). `button[data-done]` → `setupDone`. Shown while `!snap.setupDone` or `/setup`.
- **Panel geometry:** `#chat` is 620 px wide, `min-height: min(460px, var(--room))`, `max-height: min(720px, var(--room))` (style.css:78). `#now` max-height 46% (62% when fresh) (style.css:102-103). `--room` comes from the `room` IPC (M:622 → R:462). `#stage.below` comes from the `below` IPC (M:621 → R:461).
- **Hover roster** (a separate mini-surface above Net): `#roster button[data-id]` with `em.replay[data-theater]`, `span.goal[data-goal]`, `.rc var` (copies the check command) and `small.local` (R:571-585, click R:620-628).
  - Visible only when `#hud.live` (spring p>0.6, R:685-701) or while editing a goal. The spring is driven by the real OS cursor from the `cursor` IPC (M:643-650) and by DOM mousemove `hoverHit` (R:705-713).
  - Hover marks ready rows seen (R:695 `markSeen`). This changes `pending()` and the LED.
- **Test recipe:** `page.locator('#pet')`, then `page.mouse.click(x,y)` at the canvas centre-low (body pixels; the states use `top+h*0.62`). Wait ≥300 ms, `expect('#chat').not.toHaveClass(/hidden/)`, then `#now .nr`.
  - mousedown also sends `drag-start`, which polls the **real** OS cursor every 16 ms (M:656-664). If the human moves the mouse between down and up, the window moves. Keep the click fast.
  - Prefer `page.evaluate('openChat()')` only when the click path is not what's under test.

### 4.2 Chat
- **Use:** type in `#chatInput`, Enter → `#chatForm` submit (R:864-871) → `send()` (R:834-863) → `api.chat` → `ipcMain.handle('chat')` (M:565-590).
  - Chips `#chips button[data-mode=agent|commit|goal|next|vibe]` (R:873, prompts R:826-832) are visible only while `#chat.fresh` (style.css:177).
- **Engine:** `engine()` M:447-452. `chat-via` M:524 sets the `#chatMeta`/`#chatNote` text (R:785-793).
  - Default: spawn `claude -p --no-session-persistence --tools '' --setting-sources '' --strict-mcp-config --output-format json --model <state.model> --system-prompt …`, with context on stdin (M:544-563).
  - cwd `os.tmpdir()/vibepet-chat`. 90 s SIGKILL timeout (M:535). Single-flight `claudeBusy` ("still thinking about the last one", M:545). Retries once without `--model` on a 404/selected-model error (M:556).
  - Key path: fetch `api.anthropic.com/v1/messages`, max_tokens 800 (M:574-589).
- **Context:** `buildContext(mode)` M:474-498: agents phases, git stat/log. Full diff for commit/vibe. Transcripts for goal/agent/next — the transcript is `agents[0]`, i.e. the most recent mtime, not the selected row.
- **DOM out:**
  - `.msg.user`, `.msg.pet` (markdown via `renderMd` R:805-810, `pre button.copy`);
  - `.msg.pet.typing span.think` (cycles every 1.8 s, R:841-845);
  - errors `.msg.pet.err` "That didn't work: …";
  - `nokey` → shows `#keyForm` (R:852-856). `set-key` M:592-601 (safeStorage keychain; avoid in tests).
- **History:** last 16 messages, trimmed to start at a user turn (R:846-847). Kept in memory only.
- **Failure points:** blur closes the panel mid-type (R:803). A stub claude via `VIBEPET_CLAUDE_BIN` is the cheap, deterministic path. A live Haiku run costs real tokens.

### 4.3 Command bar (same input)
- A leading `/` shows `#slash` with `button[data-cmd]` (R:947-951; it hides once a space is typed). Clicking a cmd fills `#chatInput` (R:952). Submitting `/…` → `command()` (R:954-966), never chat.

| cmd | effect | ref |
|---|---|---|
| `/record` | `rec-toggle` → `content.toggle()` | R:956, M:766 |
| `/goal <text>` | `set-goal` for `goalFor` (set by a row's ◎) or the most urgent session. Empty resets to the first prompt. Note `.msg.note` | R:957, M:152-159 |
| `/jump <q>` | `findSession(q)`: substring of `title name`, else the most urgent → `jumpTo` | R:953, R:958 |
| `/replay <q>` | `theater` IPC | R:959, M:769 |
| `/stop <port>` | `local-stop` pid by port among `snap.servers` (the 8 shown) | R:960, M:412-416 |
| `/today` | `today` invoke → ledger summary note | R:961, M:166-180 |
| `/setup` | `setupForced` → Setup card | R:962 |
| `/settings` | native menu | R:963 |
| other | "Unknown command" note | R:964 |

### 4.4 Row actions (Home `#now .nr`)

| action | DOM | shown when | IPC → handler | tmux outcome |
|---|---|---|---|---|
| jump | click the row anywhere except a button/form (R:927); roster button (R:627); `/jump`; hotkey; banner | always | invoke `jump` → M:676-696: `psAll` → `locateSession` (A:307-324: exact via `~/.claude/sessions/<pid>.json` `sessionId`, else lsof cwd + closest start) → `hostApp` (A:327-333) → `bundleId` (plutil) → `focusTty`. iTerm2/Terminal use AppleScript by tty (A:343-377). Others use an OSC-2 title tag + System Events AX raise (A:381-419, 12×80 ms). Fallback: `open -b`. Else copy `cd <cwd> && claude --resume <id>` | **fails**: no .app ancestor → `{ok:false,cmd}`, clipboard overwritten. The UI note "couldn't find its terminal — resume command copied" lasts 4 s, plus a quiet bubble (R:745-752) |
| approve | `button[data-do=approve]` | phase `stalled` (R:904) | invoke `send-to {id,text:null}` → M:419-430: requires `perms().ax`, else opens the Settings pane. Locate+focus as for jump, then System Events `key code 36` (Enter) | **fails** "couldn't find its tab" → `.msg.note` "Couldn't approve: …" |
| reply | `button[data-do=reply]` toggles `form.nrep input` (maxlength 2000); submit (R:922) | phase `waiting` (R:905) | `send-to {id,text}` → `keystroke "<text>"` + Enter. Text sliced to 2000 and escaped (M:425-426) | **fails** the same way |
| replay | `button[data-do=replay]` ▶ (always; `api.theater` is always truthy) | always | send `theater` → M:769 → `openTheater(s.file)` (M:768) | works if the file passes the T/index.js:23 guard (B2) |
| goal | `button[data-do=goal]` ◎ → prefills `#chatInput` with `/goal …`, sets `goalFor` (R:933) | always | via `/goal` → `set-goal` (M:152): drift reset, ledger `goal_set`, `tick()` | n/a |
| done | `button[data-do=done]` ✓ | goal exists and not done (R:907) | send `goal-done` → M:211 → `goalDone` (M:202-210): ledger, `goalDone` event, +15xp | n/a |

Roster equivalents (R:620-628): ▶ `[data-theater]` = replay; `[data-goal]` click → inline `form.goalf` editor (R:555-570); **⌥-click** marks done; `.rc var` copies the check command.

Goal auto-done: a new commit in the session's repo whose subject shares ≥2 goal terms (goal.js:61-65, M:314). The commit must be a child of the previous HEAD and ≤10 min old (M:285-286).

### 4.5 Theater replay
- **Open:**
  - Home ▶;
  - roster ▶;
  - `/replay <q>`;
  - native menu "Theater…" (M:718: `theater.recent(CLAUDE_DIR)`, 12 h, ≤15, size >2000 B, T/index.js:33-52. **It reads first-prompt text into menu labels**, so it's real text with real CLAUDE_DIR).
  - All paths → `theater.open` (T/index.js:57).
- **Data:** the player calls `window.theater.timeline()` → invoke `theater-timeline` (theater/preload.js:3) → M:770 `theater.timeline(fileFor(sender))` (T/index.js:22-30). That reads the whole jsonl + `subagents/*.jsonl` + `.meta.json` + `git log --all` in the window [t0-60 s, t1+300 s] → `build()` (T/model.js:113-156). Strings pass through `redact` (content/edl.js). Virtual clock: gaps capped at 6 s, min 700 ms per beat (model.js:10-11).
- **DOM** (player.html):
  - header `#top #title #stats`;
  - stage `#focus` (scene), `#pin` (beat detail, `.x` close), `#card #cardNo #cardText` (chapter card), `#flash`;
  - rail `#railWrap #rail svg#branches #beats .b[data-i].<kind>` (`.on` / `.past` / `.pinned` / `.side` / `.bad` / `.okc`), `#nowLbl`, `.lbl.ch`;
  - controls `#play`, `#speed button[data-s=1|4|16]`, `#scrub #ticks #fill #knob`, `#clock`, `#chap`.
- **Keys** (player.js:159-168): Space play/pause, ←/→ beat, `[`/`]` chapter, Esc unpin, 1/2/3 speed. Clicking a beat seeks and pins (player.js:158). Scrub by pointer (player.js:155-157).
- **Boot** (player.js:183-192): autoplay at 4× after a 2.2 s card. Error text goes in `#title` ("Could not read session: …" / "Nothing to replay in this session.").
- **Test:** trigger from Home → `const th = await app.waitForEvent('window', w => w.url().endsWith('theater/player.html'))`. Assert `#beats .b` count > 0 and `#title` has no "Could not". Use `window.__theater.seek(v)` for determinism.

### 4.6 Ports / localhost
- **Poll:** `ports.poll(10e3)` is called from each tick (M:364). A refresh starts when the cache is ≥10 s old and none is in flight (P:168-175), so the effective cadence is 12 s.
  - `listServers` (P:142-164): `lsof -iTCP -sTCP:LISTEN`, `ps -axo pid,etime,command`, lsof cwd. Rows owned by system processes outside HOME are skipped (P:152). Each new `pid:port` gets one HTTP GET to `/` (800 ms timeout) for its `<title>` (P:77-86).
  - Dev procs: age >60 s, matching `DEV_RE` and not `SKIP_RE` (P:74-75, P:145).
  - `listTasks` (P:105-137): `/private/tmp/claude-<uid>/*/*/tasks/*.output` modified in the last 24 h, ≤40 files, ≤20 returned. `running` = the file is held open (lsof) or there's no status and it changed in the last 30 s. Done tasks are kept 6 h. Names come from parsing the session jsonl (real text with the real root).
- **Diff:** `ports.diff` (P:177-181) → `localhost` events ("X on :port is up/went down"). These only show with `alerts:'all'` (M:76). The first poll is a silent baseline (M:366).
- **UI:**
  - Home `.nfoot .srvs .srv[data-pid][data-port]` (snapshot servers ≤8, M:355). `button[data-do=open]` is disabled when the probe failed (`http:false`) → `local-open` (M:411, `shell.openExternal`). `button[data-do=stop]` → `local-stop` (M:412-416: native confirm dialog → `ports.stop`).
  - `ports.stop` (P:185-193): `launchctl bootout` when a non-apple launchd label owns the pid, else SIGTERM.
  - Roster footer `small.local` "⌂ N servers · N bg tasks · N dev procs" (R:582-583).
  - Native "Localhost" submenu (M:371-392) adds dev procs and background tasks.
- **Rule-3 hazard:** these lists include the user's real servers and processes. A test may only stop a pid it started. Pick it by its own port and confirm the pid. Stub `dialog.showMessageBox` → `{response:0}`.

### 4.7 Gestures + global jump key
- **Jump key:** `bindKey` M:786-792 registers `state.hotkey` (choices M:784: ⌃⌥⌘J / ⌥⌘J / Off). The handler shows Net if hidden (`summon`), then sends `hotkey`.
  - Renderer R:446-455: a press <4 s after the last walks to the next id, else it snapshots `pending()`: needs > stuck > ready, oldest first (R:123-126). It then calls `jumpTo`. With nothing pending, nothing happens.
  - Banner click → `jumpTo` IPC (M:89 → R:456-459).
  - **Test:** `app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('renderer/index.html')).webContents.send('hotkey'))`. Assert on the jump IPC result through a spy (`ipcMain.removeHandler('jump')` + wrap) or the row note. `__vibepet.keyTaken()` reports a registration clash.
- **Gesture training:** native menu Settings → Gesture → "Record gesture…" → `recordGesture` (M:832) → `gesture-rec {start:true}` → `#gest` pad.
  - DOM (index.html:36-47): `#gestMsg`, `canvas#gestPad` (400×400; pointer events R:476-488), `#gestShots canvas×3`, `#gestUndo`, `#gestCancel`.
  - Each stroke is sent as `gesture-sample` (M:807-822). Fewer than 8 points or under 25 px is refused as trivial. After 3 consistent samples (pairwise ≥0.74, gesture.js:119-132) the templates are saved, `on=true`, the watcher starts and the pad closes after 2.8 s (R:497).
  - Undo/cancel: `gesture-undo` M:823, `gesture-cancel` M:833.
  - **Test:** there's no IPC to start recording. Use `app.evaluate` to `webContents.send('gesture-rec',{previews:[],start:true})`. Main's `rec` stays null, though, so the samples are ignored. Real training needs an exposed `recordGesture` (__vibepet) or `ipcMain.emit`. Draw on the pad with `page.mouse` down/move/up, which works with CDP.
- **Summon recognition:** `gesture.watcher` polls the **real OS cursor** `screen.getCursorScreenPoint()` every 50 ms, 16 ms mid-stroke (gesture.js:156-169).
  - Segmenter: START at 260 px/s, a stroke ends after 160 ms still; max stroke 3.5 s (gesture.js:105, gesture.js:136-154).
  - Plausibility gate: min side 35, min big side 90, turn ratio 1.6. Thresholds: low 0.88, med 0.85, high 0.825 (gesture.js:4).
  - A match → `toggleNet` (M:799-802), with a 2.5 s debounce after any toggle (M:801). It hides Net (`hide`, then `win.hide()` after 260 ms, M:831) or summons him at the stroke end (`summonAt` M:824-829).
  - Live testing would have to move the user's real mouse. Don't. Unit-test `segmenter`/`recognize` (test/gesture.test.js) or inject cursor points by stubbing `screen.getCursorScreenPoint` in main.

## 5. IPC table

Renderer→main via preload.js:3-31 (`window.pet.*`):

| channel | kind | preload | handler | notes |
|---|---|---|---|---|
| set-ignore | send | :5 | M:654 | click-through toggle |
| drag-start / drag-end | send | :6-7 | M:656-669 | 16 ms real-cursor follow; saves `state.pos` |
| pet-top | send | :8 | M:655 | Net's offsetTop; ignored when below or the window is trimmed |
| menu | send | :9 | M:771 | native popup |
| focus | send | :10 | M:670 | steals focus |
| copy | send | :11 | M:671 | clipboard |
| rename | send | :12 | M:697 | ≤16 chars |
| pet | send | :13 | M:699 | mood +2 / 10 s |
| exit-done | send | :14 | M:698 | quit |
| chat | invoke | :15 | M:565 | see 4.2 |
| chat-via | invoke | :16 | M:524 | 'claude'/'key'/'key-locked'/null |
| set-key | invoke | :17 | M:592 | keychain |
| set-goal | send | :18 | M:152 | ledger |
| goal-done | send | :19 | M:211 | |
| rec-toggle | send | :20 | M:766 | content.toggle |
| set-prefs | send | :21 | M:402 | pet/size/feel/alerts/setupDone |
| open-perm | send | :22 | M:399 | prompts AX |
| today | invoke | :23 | M:410 | |
| local-open | send | :24 | M:411 | openExternal |
| local-stop | send | :25 | M:412 | dialog + kill |
| send-to | invoke | :26 | M:419 | approve/reply |
| jump | invoke | :27 | M:676 | |
| theater | send | :28 | M:769 | |
| gesture-cancel / gesture-sample / gesture-undo | send | :29-31 | M:833 / M:807 / M:823 | |
| theater-timeline | invoke | theater/preload.js:3 | M:770 | file chosen by the sender window |
| rec-started / rec-chunk / rec-stopped / rec-failed / rec-cards | send | content/preload.js | content/index.js:113,129,142,134,166 | recorder window |

Main→renderer (`send` M:74; listeners in R):

| channel | sent at | listener | payload |
|---|---|---|---|
| tick | M:339, M:408, M:738, content refresh M:850 | R:433 | snapshot |
| event | M:79 (`emit`), M:415 | R:502, R:990 | `{kind,text,agent,id,...}`. Kinds: agentDone, agentNeeds, agentStalled, agentNag, goalDrift, goalBack, goalDone, commit, levelup, snack, snackNo, localhost, content, contentDone, openChat, openSetup, openKey, openRename, exit |
| cursor | M:647 | R:432 | window-relative real cursor |
| hotkey | M:789 | R:447 | — |
| summon | M:789, M:828, M:832, M:841 | R:464 | — |
| hide | M:831 | R:465 | — |
| jumpTo | M:89 | R:456 | `{id}` |
| below / room | M:621-622 | R:461-462 | bool / px |
| gesture-rec | M:806, M:818 | R:490 | `{previews,hint,done,start}` |

## 6. Timers and thresholds

| value | where |
|---|---|
| tick 3 s | M:19 |
| stalled: tool_use + 90 s silence | A:159; kid stuck A:213 |
| parked: end_turn + 5 min, or user record + 120 s | A:161, A:169 |
| scan window 45 min (12 h when kids are active); turnAt fallback 45 min | A:271, A:147 |
| fanout open window 10 min, ≤32 kids | A:241, A:237 |
| unstick child-start slack 2 s | M:236 |
| nag 3 min, once per episode | M:214 |
| done banners ≥20 s apart; `away` = hidden or idle >60 s | M:96, M:112 |
| drift needs 2 equal ticks; judge `on` ≥3 hits and ≥30%; `drift` = none of the newest 12 | M:187, goal.js:49-58 |
| goal retry 30 s; TTL 3 days | M:134-139 |
| commit counted if ≤10 min old and a child of the previous HEAD | M:285-286 |
| ports refresh ≥10 s; probe 800 ms; dev proc >60 s; task live 30 s / kept 6 h | P:168, P:77, P:145, P:133-136 |
| renderer: click→Home 220 ms; drag 4 px; hotkey cycle 4 s; jump note 4 s; alert face for waiting <8 s; sleep after 15 min idle or 01-06 h | R:729, R:727, R:449, R:750, R:107, R:113-114 |
| hud spring NEAR 24 / FAR 120 px, grace 500 ms, intent 300 ms dwell or 100 ms still | R:646, R:678 |
| cursor feed 16 ms near / 100 ms far | M:649 |
| chat timeout 90 s; findClaude at +3 s | M:535, M:853 |
| osascript: focus 5 s; tag-focus 8 s (12×80 ms); run 3 s | A:422, A:415, A:292 |
| gesture: poll 50/16 ms; START 260 px/s; STILL 160 ms; max 3.5 s; toggle debounce 2.5 s | gesture.js:162, gesture.js:136, gesture.js:105, M:801 |
| Theater: gap cap 6 s; min beat 700 ms; start 4×; first card 2.2 s | model.js:10-11, player.js:187-189 |

## 7. tmux / fixture-fleet failure expectations

1. **jump:** `locateSession` finds the pid. With fleet `sessions/<pid>.json` in the real `~/.claude/sessions` it's exact; otherwise lsof cwd. tty is `/dev/ttysNNN` of the tmux pane (A:300). `hostApp` returns null (A:327-333), so `open` is skipped and the code falls to clipboard + `{ok:false}` (M:681-695).
2. **approve/reply:** they return early unless `perms().ax` (M:421). In dev that's AX for `node_modules/electron/dist/Electron.app`, probably untrusted, so System Settings opens. If trusted: `bid` null → "couldn't find its tab". Even with a GUI host, `keystroke` goes to the frontmost app after focus, so it races the user's typing.
3. **unstick** works under tmux, because it's ps-based (M:230-243).
4. **Theater for fleet files** is blocked by the path guard unless `VIBEPET_CLAUDE_DIR` also widens T/index.js:23.
5. **Phase timing:** a Haiku session that asks for permission becomes `stalled` only after 90 s of transcript silence plus a tick (≤3 s), and the event fires only after `unstick` rules out a child process. A finished turn shows `ready`/`waiting` for 5 min, then is parked and disappears.
6. **Multiple sessions per cwd:** the lsof fallback picks the claude started closest before the jsonl was born (A:321-323). Give each fleet session its own repo dir.

## 8. Minimal "drive it for real" checklist per surface

| surface | trigger via real UI | assert |
|---|---|---|
| Home | `page.mouse.click` on `#pet` body, wait 300 ms | `#chat:not(.hidden)`, `#now .nr[data-id]` count = live fleet sessions (≤8) |
| Setup | fresh userData (setupDone false), then click Net | `#setup:not(.hidden) .seg button[data-k]` |
| Chat | `#chatInput` fill + Enter (stub `VIBEPET_CLAUDE_BIN` or Haiku) | `.msg.pet:not(.typing)` appears; no `.err` |
| Command bar | fill `/` | `#slash button[data-cmd]` ×8; `/jump <name>` → jump IPC fired |
| jump | click `.nr` body | resolved `jump` result (spy); on tmux expect `{ok:false,cmd}` until the tmux path exists |
| approve | `.nr.stuck button[data-do=approve]` (fleet session blocked on a permission ≥90 s) | the fleet pane advances (`tmux capture-pane` of the fleet pane only) |
| reply | `.nr.needs button[data-do=reply]` → `.nrep input` fill + Enter | the fleet transcript gets a new user record |
| replay | `.nr button[data-do=replay]` | new window `theater/player.html`, `#beats .b` > 0 |
| goal / done | ◎ → `#chatInput` `/goal x` Enter; ✓ | `.ng` text = x; `.ng.done` |
| localhost | start a fixture server in ULTRA/fleet, wait ≤13 s, open Home | `.srv[data-port=<p>]`; stop with the dialog stubbed → the server's pid is gone |
| hotkey | `webContents.send('hotkey')` | jump spy called with `pending()[0].id` |
| gesture pad | needs a `recordGesture` hook; then 3 `page.mouse` strokes on `#gestPad` | `#gestMsg` "Saved." |
