# S2 Chat: evidence log

Surface: the chat inside Net's Home panel (composer, Quick asks, message list, engine, errors, keyboard).
All times are UTC on 2026-10-02. Load = the laptop's 1-minute load average from `uptime` during the step (the machine was shared with other work, including other test instances).

## Setup

- **App:** vibepet launched through `test/ultra/launch.js`: isolated Claude root (`~/.vibepet-ultra/root/.claude`, fixture fleet only), a dedicated profile (setup done, sounds muted), global hotkey off. A Finder-like environment: launchd `PATH`, no Claude Code or API-key variables.
- **Engine:** the user's own Claude Code login (`claude -p`, the app's default path) on the app's default model. The CLI's own JSON (captured for 11 of the 14 normal sends) shows `claude-sonnet-5` answered each one.
  - F1 ran on the untouched path.
  - For F2, F3, F5 and the exploration, `VIBEPET_CLAUDE_BIN` pointed at a pass-through wrapper. It timestamps each spawn, keeps the exact context the app piped to the CLI, and keeps the CLI's JSON result, then `exec`s the real `claude`. Overhead: 8 ms median (n=6, `--version`).
- **Real UI only:**
  - Net opened by trusted CDP mouse events on his pixels.
  - Text entered with the keyboard; Enter, Esc, Tab, arrows and modifiers sent as key presses.
  - Buttons clicked.
- **Timing:** a probe in the page timestamps the Enter keydown (`event.timeStamp`) and every node added to `#msgs`, on the wall clock.
- **Side effects stubbed:** the clipboard, dialogs and `openExternal` only record.
- **Ground truth:**
  - `fleet.js status --json` snapshots taken seconds before and after each question.
  - The members' transcripts (jsonl), git status of their repos, and the kestrel tmux pane.
  - Other testers were driving the same fleet at the same time, so states changed between questions. Each answer is checked against the state at its own send time.

**Fleet at the start (01:46:23):**
- kestrel: waiting on a permission prompt for 73 min. It wants to run Bash `./deploy.sh --dry-run`; the pane shows "Do you want to proceed?".
- beacon: waiting on AskUserQuestion for 73 min: "Which database should beacon use to store check results?" (SQLite / Postgres / Redis).
- vibepet: idle at its prompt, 45 min after its last answer.
- atlas: idle (stopped).
- delta, ember: exited.

Home's Now list showed **"No live sessions."** (shot 02).

---

## F1: first token ("what's my agent doing?")

**Steps:** click Net → Home opens with the caret in the composer → type `what's my agent doing?` → Enter. Repeated 3× in one conversation (01:47:08–01:47:20, load 2.95–3.46).

| send | Enter → user bubble + typing painted | Enter → first visible model text | Enter → complete | DOM updates after the first text |
|---|---|---|---|---|
| 1 | 16 ms | 2494 ms | 2494 ms | 0 |
| 2 | 14 ms | 2208 ms | 2208 ms | 0 |
| 3 | 18 ms | 2284 ms | 2284 ms | 0 |
| **median** | **16 ms** | **2284 ms** | **2284 ms** | **0** |

- **Streaming:** no. Every reply appears all at once. Until then a fixed ticker cycles "reading the repo… / checking your agents / thinking…" (shot 03).
- **All 14 successful real-engine sends in this pack** (F1, F2, F5, exploration):
  - first visible text: median **3198 ms**, p90 4282 ms, p95 6955 ms;
  - 0 incremental updates in any reply.
- **Where the time goes:** from the wrapper (n=11), each send spawns a fresh `claude` process.
  - Process overhead outside the CLI's own timer: median 1059 ms (906–1465).
  - API time (`duration_api_ms`): median 2079 ms.
  - Enter → process spawned: median 38 ms, p95 217 ms (n=14).
- **Quick ask instead of typing:** the "What's my agent doing?" chip (which adds one session's transcript to the context) took 4282 ms from click to reply (n=1, 02:04:10, load 6.1–6.5; shots 31–32).
  - Quick asks are shown only before the first message. After that they are gone until the app restarts (shot 04 vs 16).
- **Truth vs. replies (01:47:08 snapshot):**
  - Reply 1: "No agents are active right now, and I'm not seeing a repo either…" (shot 04).
  - Reply 2: "Still nothing active—no agents running…".
  - Reply 3: "Same as before—no agents running, no repo detected. Nothing's changed since you last asked."
  - "No agents active/running" is **false**: 4 sessions were alive, 2 of them blocked on the user (kestrel 74 min, beacon 74 min).
  - "Nothing's changed" is true.
  - The context the app sends for free chat at that moment is `Agents: none active.` / `Repo: none detected.`
- **Result:** FAIL (first token 2.3 s, no streaming, and every answer says nothing is running).

## F2: claims about the sessions

**Procedure:** one conversation. Each question was typed and sent with Enter, with a truth snapshot within ±10 s. The context block the app sent was captured verbatim; it carries only fleet data. Shots 17–20 and 22.

Verdicts: **T** = true, **F** = false, **U** = unverifiable. "T (pet's view)" = a true statement about what the pet was told, while the fleet says otherwise.

### Q1, 01:52:44: "what is each of my sessions doing right now?"
- **First token:** 3204 ms (load 2.7–2.9).
- **Truth:**
  - kestrel: permission prompt, 79.7 min.
  - beacon: AskUserQuestion, 79.7 min.
  - vibepet: idle at its prompt, 51.6 min.
  - atlas: idle.
  - ember: /loop between fires. Its last fire ended 01:48:23, so it had been idle 261 s. It held 1 live cron job and fired again at 01:53:06.
  - delta: exited.
- **Context sent:** `Agents: ember=ready for 38s.` plus ember's repo (clean).
- **Reply:** "Just one: ember, sitting idle and ready for the last 38 seconds. Repo's clean, nothing queued up for it right now."

| claim | verdict | evidence |
|---|---|---|
| "Just one" session | **F** | 5 live: kestrel, beacon, vibepet, atlas, ember |
| ember is idle | T | registry idle |
| "for the last 38 seconds" | **F** | idle 261 s. 38 s = time since this app instance launched |
| "Repo's clean" | T | `git status --porcelain` empty in ember's repo |
| "nothing queued up for it" | **F** | a /loop job was scheduled. Next fire 01:53:06, 22 s later (`run ./tick.sh`, tick 26) |

### Q2, 01:53:28: "what does kestrel need from me?"
- **First token:** 3191 ms (load 2.1–2.9).
- **Truth:** kestrel is waiting for approval to run `./deploy.sh --dry-run`. Registry `waiting / permission prompt` for 80.6 min; the pane shows "Do you want to proceed?".
- **Context:** `Agents: ember=ready for 82s.`
- **Reply:** "There's no kestrel in your current context—just ember, which is idle and ready. Might be a different session or a mix-up."

| claim | verdict | evidence |
|---|---|---|
| no kestrel in the context | T (pet's view) | captured context |
| "just ember" | **F** | 5 live sessions |
| ember idle | T | its fire ended 01:53:08 |
| "Might be a different session or a mix-up" | **F** | kestrel is in this fleet and has needed the user's approval for 80 min |
| (the question: what kestrel needs) | **not answered** | should be: approve `./deploy.sh --dry-run` |

### Q3, 01:53:33: "is delta done?"
- **First token:** 2981 ms.
- **Truth:** delta's claude exited at 00:39:32 (`/exit`). Its last turn (00:23:02) ended "rejected" after a subagent's Bash call was rejected.
- **Context:** `Agents: ember=ready for 87s.`
- **Reply:** "No delta here either—only ember shows up in your context, and it's idle and ready."

| claim | verdict | evidence |
|---|---|---|
| "No delta here" | T | delta is not running |
| only ember in the context | T (pet's view) | captured context; 5 other sessions were alive |
| ember idle | T | registry idle |
| (the question) | **not answered** | delta exited 74 min earlier; its last task ended with a rejected tool call |

### Q4, 01:54:17: "what did atlas change?"
- **First token:** 3651 ms (load 3.3).
- **Truth:** atlas restarted `./build.sh` at 01:53:55 (busy, build.sh child). It has never edited a file: 7 Bash calls and 0 Edit/Write in its transcript. Its repo is clean.
- **Context:** `Agents: atlas=working for 23s, vibepet=ready for 26s, ember=ready for 131s.` The repo block is **ember's**, not atlas's.
- **Reply:** "Atlas is still working (23s so far), and I don't have diff details yet since it hasn't finished. Want me to let you know once it wraps up?"

| claim | verdict | evidence |
|---|---|---|
| atlas still working | T | registry busy, build.sh running |
| "23s so far" | T | started 22 s before |
| no diff details | T (pet's view) | only ember's repo is in the context |
| "since it hasn't finished" | **F** | atlas changes no files, finished or not. The diff is missing because chat reads one other repo |
| "let you know once it wraps up" | U | an offer chat has no mechanism for |

**F2 totals (Q1–Q4):** 17 claims: 7 T, 3 T (pet's view), 6 F, 1 U. None of the four questions got the answer the fleet supports.

**More answers checked during exploration (same method):**

1. **01:55:11 "which session needs me first?"**
   - **Truth:** kestrel had just been re-armed and was waiting on a permission prompt (37 s). beacon: AskUserQuestion (37 s). vibepet: done (its turn ended 01:55:03). atlas: build.sh running. ember: loop idle.
   - **Context:** `vibepet=ready for 80s, beacon=working for 29s, kestrel=working for 32s, atlas=working for 77s, ember=ready for 185s`.
   - **Reply:** "Right now vibepet and ember are both ready and waiting on you — vibepet's been sitting longest, about 80 seconds. Beacon, kestrel, and atlas are all still working, so nothing needed from you there yet."
   - **Verdicts:**
     - vibepet waiting on you: T.
     - ember waiting on you: F (a loop between fires).
     - vibepet sitting longest, ~80 s: F (its last answer was 8 s earlier; ember had been idle longer).
     - beacon working: F.
     - kestrel working: F.
     - atlas working: T.
     - "nothing needed from you there": **F** (two sessions blocked on the user).
   - **Tally:** 2 T / 5 F.
2. **02:04:10, Quick ask "What's my agent doing?"**
   - **Truth:** kestrel waiting on a permission prompt (20 s). It had asked "Should the deploy script have unit tests?" before the user re-prompted it.
   - **Reply:** "Kestrel asked whether the deploy script needs unit tests, then you told it to just rerun ./deploy.sh --dry-run — it's currently running that. Atlas and delta are both idle and ready. It doesn't need you right now, but it's still waiting on an answer to the test question…"
   - **Verdicts:**
     - asked about tests: T.
     - re-prompted: T.
     - "currently running that": **F** (waiting on approval, no tool process).
     - atlas and delta idle: T, T.
     - "doesn't need you right now": **F**.
     - "still waiting on an answer to the test question": **F** (superseded).
   - **Tally:** 4 T / 3 F. The context held one session's transcript (kestrel = most recent) and no mention of beacon or vibepet, both also waiting.
3. **02:04:49 "what does beacon need from me?"** (beacon on AskUserQuestion for 10 min)
   - **Reply:** "There's no agent named beacon in what I can see — just kestrel, atlas, and delta. Did you mean one of those, or is beacon running somewhere else?"
   - **Verdicts:** "no agent named beacon in what I can see" T (pet's view); "just kestrel, atlas, and delta" **F** (beacon and vibepet were also alive); "running somewhere else?" **F**. It denies a session that has been waiting on the user's database choice for 10 min.
4. **02:12:19 "are any two of my sessions about to edit the same file?"**
   - **Reply:** "No agents are active right now…".
   - **Verdicts:** "No agents are active" **F**: kestrel waited on approval (8.5 min) and beacon on its question (17.6 min), and vibepet had just been prompted. "Only the atlas repo shows, and it's clean" T.

**Result:** FAIL. Across the 8 answers checked (Q1–Q4 + 4 above), 17 claims are false. False claims fall into two kinds:
1. Sessions that wait on the user are called "working / nothing needed" or don't exist.
2. Ages are wrong.

## F3: error states (fault injection)

| state | how | what the user sees | time to feedback | composer / message afterwards | tells the user what to do? | shots |
|---|---|---|---|---|---|---|
| no engine | `claude` not findable: `VIBEPET_CLAUDE_BIN=/nonexistent`, `HOME` → an empty dir, launchd `PATH`, no key | Home opens to a key form, with focus in its password field: "Chat uses your Claude Code login. No `claude` here? Paste an Anthropic API key instead…". The composer, messages and the whole command bar are hidden. Typing `/today` goes into the key field. The header says "api key" although there is none | 922 ms from click | no composer at all; Esc + reopen gives the same form | partly: it says paste a key; no install / login action | 23 |
| offline | `ANTHROPIC_BASE_URL=http://127.0.0.1:9` (connection refused) | "thinking…" for 90 s, then "That didn't work: claude timed out" | 90 036 ms | composer empty; the message stays as a bubble with no retry | **no**: nothing says offline, nothing is queued, no action | 24, 25 |
| 429 | local server: 429 + `retry-after: 23` + Anthropic `rate_limit_error` JSON | "thinking…" for 90 s, then the same "That didn't work: claude timed out" | 90 068 ms | same | **no**: the copy says timed out, not rate limited; no countdown or retry | 26, 27 |
| invalid API key | `ANTHROPIC_API_KEY=<invalid>` | "That didn't work: API key is invalid." | 168 ms | same; the key form is not offered | **no** action | 28 |

- **429 detail:** the server log shows the CLI retried on the server's schedule: `POST /v1/messages` at +0.6 s, +23.6 s, +46.6 s and +69.7 s. The app killed it at 90.0 s, before the 5th try. The CLI wrote nothing to stdout in either the offline or the 429 run.
- **Result:** FAIL. Two different causes produce the same misleading "timed out" after 1.5 minutes, and no state offers a primary action.

## F4: history across restart

- **Steps:** 3 messages + 3 replies + 9 `/today` notes in one conversation (15 bubbles, scrolled to 108 px; shot 15) → quit the app → relaunch with the same profile → click Net.
- **Result:** the message list is **empty**. Quick asks are back, scroll is 0, and the panel is "fresh" (shot 16). The profile holds no chat data: `state.json` keys contain no chat or history field, and no other file holds it.
- **Within one run:** closing (Esc) and reopening the panel keeps the scroll (108.5 → 108.5 px).
- **Result:** FAIL across restart, pass across panel close/reopen.

## F5: command routing

| member, truth | typed | reply | did it reach the session? | result |
|---|---|---|---|---|
| vibepet (leased): idle at its prompt for 13 min, transcript 128 lines, mtime 01:55:03 | `tell the vibepet session to run its tests` (02:08:00) | "I can't send commands to agents, and there's no session called "vibepet" anyway — only kestrel, atlas, and delta. Did you mean one of those?" | **no.** 20 s later: 128 lines, same mtime, registry idle, no test run | FAIL |
| kestrel (leased): permission prompt for `./deploy.sh --dry-run`, 9.5 min, transcript 252 lines | `@kestrel approve` (02:12:49) | "I can't send approvals to agents, and there's no kestrel in what I can see anyway — only vibepet, which is sitting ready." | **no.** 25 s later: 252 lines, same mtime, registry still waiting, pane still "Do you want to proceed? ❯ 1. Yes" | FAIL |

- **What else the composer offers:**
  - No `@` picker.
  - `/reply @kestrel yes`, `/approve @kestrel` and `/new` each answer "Unknown command … Type / to see them." (shot 38).
  - Replies carry no action buttons; the only button ever rendered in a reply is "copy" on code blocks.
- **Context vs. reply:** for the vibepet send, the context said `Agents: none active.`. The "kestrel, atlas, and delta" in the reply came from earlier turns of the conversation.
- **Re-arm:** both members were still in state (no-op re-arms) and both leases were released.

## F6: keyboard

| check | result |
|---|---|
| open chat by keyboard | **not possible.** No shortcut opens chat (the global key is a jump key and is off here). Opening takes a click on Net: 222 ms (n=5) from pointerup to panel, because a single click waits 220 ms for a possible double-click. A double-click opens it in 0–1 ms after the 2nd click (n=3) |
| focus on open | caret in the composer on every open checked (12/12) |
| Enter sends | yes, on every send |
| Shift+Enter | **submits.** `/today` + Shift+Enter posted the note. The composer is a single-line `<input>` (shot 08) |
| Esc closes | yes, same frame (0 ms, n=3) |
| Esc while a reply is pending | **closes the panel.** The request keeps running, and the reply later appears as a speech bubble cut to "There's no agent named beacon in what I can see — just kestr…" (shots 33, 34) |
| ↑ in an empty composer | nothing |
| ⌘N, ⌘K, ⌘1 | nothing |
| slash menu | `/` lists 8 commands (shot 10). ↓ selects nothing; Tab moves focus to the Send button; Esc closes the whole panel and leaves `/` in the composer |
| `@` | plain text, no picker (shot 09) |
| keyboard copy of a code block (⌘⇧C) | nothing. The copy button works with the mouse |
| second message while a reply is pending | typed + Enter: the composer clears and the text is **gone**. It is not shown, not queued, and has no notice (shot 21; the transcript of sends shows only the first) |

**Result:** FAIL (no keyboard open, Shift+Enter submits, slash menu not keyboard-driven, Esc doesn't stop a pending reply, typed text lost while busy).

## F7: the benchmark bars

| bar | result | evidence |
|---|---|---|
| B1.1 Enter → user message + typing indicator ≤ 50 ms p95 | **PASS** | in DOM: median 1 ms; painted: median 19 ms, p95 44 ms (n=17) |
| B1.2 first token, API-key path, p50 ≤ 1.5 s | not measured | no valid key; the invalid-key run fails in 168 ms |
| B1.3 first token, Claude-login path, p50 ≤ 2.0 s, p95 ≤ 3.5 s | **FAIL** | p50 3198 ms, p95 6955 ms (n=14); F1 alone: median 2284 ms (n=3) |
| B1.4 context build ≤ 150 ms p95 | **FAIL** (narrow) | Enter → process spawn: median 38 ms, p95 217 ms (n=14). The worst sample is the first send of a fresh instance |
| B1.5 model fallback ≤ 1 extra round trip, first time only | **FAIL** | the profile's model set to an unavailable id: every send first spawns with it and fails (1545 ms, 1665 ms), then re-spawns on the CLI default. The answer came from `claude-opus-5-5` with no note to the user. Send 2 repeated the failed attempt (5090 ms, 4637 ms to first token; shot 36) |
| B2.1 ≥ 5 DOM updates/s while streaming | **FAIL** | 0 incremental updates in 14 replies |
| B2.2 markdown while streaming | **FAIL** | no streaming. Finished replies render code blocks only. Lists and links stay raw ("- [kestrel](https://vibepet.net) — working"), and the block's language label is lost ("code" instead of bash) (shot 35) |
| B2.3 autoscroll unless scrolled up > 40 px, plus a "new" pill | **FAIL** | scrolled up to 37.5 px while waiting; the reply moved the view to 226.5 px. No pill |
| B2.4 stop ≤ 200 ms without closing the panel | **FAIL** | Esc closes the panel; no stop control; the request runs to completion (shots 33, 34) |
| B2.5 "cut off · Continue" on max_tokens | not reproduced | no truncated reply occurred; no continue control exists anywhere in the UI |
| B3.1 survives restart | **FAIL** | F4 (shots 15, 16) |
| B3.2 scroll survives close/reopen and restart | **partial** | close/reopen kept 108.5 px; a restart loses everything |
| B3.3 ⌘N or /new, history list | **FAIL** | ⌘N nothing; `/new` → "Unknown command" (shot 38); no list |
| B3.4 search | **FAIL** | no history to search |
| B3.5 stated retention, clear action | **FAIL** | neither exists |
| B3.6 prompt caching, ≥ 50 % cache reads from turn 3 | **FAIL** | 13 successful sends with the CLI result captured: `cache_read_input_tokens` was 0 in every one, including turns 2–6 of a conversation. Each send over ~1k tokens wrote 928–1780 cache tokens that were never read. Cost per send: $0.0024 for the one prompt under 1k tokens, $0.0046–0.0076 for the rest |
| B4 copy table + B4.1 | **FAIL** | no-engine, offline, 429 and invalid key all screenshot-verified (F3). None matches the pattern; offline and 429 both say "claude timed out" |
| B4.2 failed text kept in the composer or retryable | **FAIL** | the composer is cleared; the bubble has no retry. With no engine, the composer is hidden |
| B5.1 `@` picker | **FAIL** | shot 09 |
| B5.2 attachment chips | **FAIL** | none |
| B5.3 "What Net sees" | **FAIL** | the footer says only "Via Claude Code · sends message + repo context". The user never sees that the pet sent `Agents: none active.` while 5 sessions were alive |
| B5.4 a mentioned session's transcript + diff | **FAIL** | "what did atlas change?" got ember's repo; the Quick ask reads only the most recent session |
| B5.5 free chat gets every live session with phase, ask and title | **FAIL** | free chat gets `name=phase for Ns` for the sessions Home lists, with no ask and no title. Sessions waiting on the user for minutes are missing (F2) |
| B6.1 `/reply @s`, `/approve @s` | **FAIL** | "Unknown command" (shot 38); F5 |
| B6.2 [Send to session] on replies | **FAIL** | no reply has an action except "copy" |
| B6.3 inline permission card | **FAIL** | kestrel sat on a permission prompt for 80 min; chat never showed it |
| B6.4 every send/approve result shown | **FAIL** | nothing is ever sent from chat (F5) |
| B7.1 hotkey opens chat with focus ≤ 150 ms | **FAIL** | no such key; click path 222 ms |
| B7.2 ↵ / ⇧↵ / ↑ / ⌘R / ⌘N / ⌘K / Esc | **FAIL** | only ↵ and Esc (close) work; ⇧↵ submits |
| B7.3 keyboard slash and `@` menus | **FAIL** | F6 |
| B7.4 ⌘1–⌘9 act on the Nth session | **FAIL** | ⌘1 does nothing |
| B7.5 keyboard copy of code | **FAIL** | ⌘⇧C does nothing |
| B8.1 Now list shows all sessions up to 15, grouped | **FAIL** | with 5 live sessions, Home showed 0–5 rows depending on age. "No live sessions." at 01:46 and 02:08, while kestrel and beacon waited (shots 02, 37) |
| B8.2 unread / needs-me filter | **FAIL** | no filter in Home or chat |
| B8.3 chat summarises all sessions | **FAIL** | Q1: "Just one: ember" with 5 alive |
| B8.4 Collision Radar card | **FAIL** | no card; asked directly, chat answered "No agents are active right now…" (shot 39) |

**Score:** 1 pass, 1 partial, 3 not measured or not reproduced, 34 fail.

## Exploration (a person running 5–15 sessions)

1. **Typing the first question into the key field saves it as your API key.**
   - **Setup:** a fresh profile with no `claude`, which opens with focus in the password field.
   - **Steps:** type `what's my agent doing?` → Enter.
   - **Result:** "Key saved. Chat will use it.", with no validation; the header reads "api key". Every send after that fails "That didn't work: invalid x-api-key" (shots 29, 30). Nothing points back to the key form.
2. **A message sent while Net is thinking disappears.** See F6 (shot 21).
3. **Esc to stop a reply instead hides the panel.** The answer pops up later as a speech bubble cut at 140 characters (shots 33, 34).
4. **Stale answers.** Chat answers from earlier turns over its fresh context:
   - The context said `Agents: none active.`; the reply named "kestrel, atlas, and delta".
   - Ages restart when the app launches: "ready for the last 38 seconds" for a session idle 261 s; "atlas/delta for 17s" when they had been idle 72 s and 200 s.
5. **The wait gives no information.** For 90 s offline or rate-limited, the ticker says "thinking…" (shots 24, 26).
6. **No way to see why chat is wrong.** The user can't see the context, and the Home list ("No live sessions.") agrees with the chat. Nothing on screen hints that kestrel and beacon are waiting.
7. **Default Electron app menu.** View › Reload ⌘R, File › Close Window ⌘W, Quit ⌘Q, zoom and full screen are all installed on the pet window (`Menu.getApplicationMenu()`).
   - In this harness the window never becomes key, so ⌘R and ⌘W pressed in the composer did nothing. The marker survived both a CDP key press and `sendInputEvent`.
   - Not counted as a finding: it could not be reproduced here.

## Fleet changes during this pack

Other testers re-armed kestrel and beacon (01:54:39 and 02:03:48), vibepet, atlas (01:53:53), delta, and ember's loop (started 01:48, exited 01:59:35). This pack changed no fleet state: the two F5 messages never reached a session, and both re-arms were no-ops.
