# Command bar: flow log

**What was tested.** The input at the bottom of Net's Home panel ("Ask Net, or type / for commands"). A leading `/` makes it a command bar with 8 commands (`/record`, `/goal <text>`, `/jump <name>`, `/replay <name>`, `/stop <port>`, `/today`, `/setup`, `/settings`). Anything else goes to chat.

**How.**
- Real app, test mode, watching only the fixture fleet: six real Claude Code sessions (Haiku) in tmux, named kestrel, vibepet, atlas, beacon, delta and ember.
- Profile: a returning user (setup done, muted, calm, alerts "Everything"). The system appearance was light.
- Every click and key is a trusted input event (Chromium input pipeline). No IPC shortcuts were used.
- Timings come from event and DOM-mutation timestamps on one wall clock (renderer and main), plus two animation frames for "painted". Medians, n, samples and load averages are in `timings.json`.
- Session 01:47–02:10 UTC on a shared laptop. Load averages ran from 2.7 to 10.4 (noted per step).
- **Ground truth** = `fleet status --json` (Claude Code's own registry: `waiting (permission prompt)`, `waiting (input needed)`, `idle`, `busy`) plus the fleet transcripts. Other testers re-armed fleet members during the session, so the truth is given at every step.

**Test-mode differences** (so the evidence can be read correctly):
- The app never takes OS focus.
- Native dialogs answer themselves "Stop". Clipboard writes are recorded, not performed. Native menus are captured and their items clicked in code.
- The screen-recording toggle is recorded, not run: no screen capture was allowed.
- Chat uses a local stub engine ($0). Its replies say "(stub chat engine)". Flows that reach chat test routing only.
- `/jump` ran for real (process lookup in main). No keystroke reached any terminal.

Result key: **PASS** / **FAIL** / **PARTIAL**.

---

## F1. Opening the command bar (every way the UI offers), time to visible, ×5 each

| # | way in | expected | actual (median of 5) | result |
|---|---|---|---|---|
| 1.1 | single click on Net | bar visible ≤ 150 ms, caret in it | panel painted at **254 ms** after mouse-up (317 ms after mouse-down). It sits hidden for the first 221 ms, a wait for a possible double-click. Caret in the bar at 222 ms. Open animation done at 485 ms. Load 4.1. | FAIL (speed) |
| 1.2 | double click on Net | same | painted at **36 ms**, caret at 1.6 ms. Load 4.0. | PASS |
| 1.3 | right click on Net → native menu → "Open Home" | same | menu shown at 13 ms; panel painted 11 ms after the item click. Load 4.1. | PASS |
| 1.4 | type `/` in the open bar | hint list visible | list painted at 8.6 ms. Load 4.2. | PASS |
| 1.5 | ◎ on a row (Home already open) | bar prefilled and focused | `/goal ` (or `/goal <current goal>`) with caret at 1.0 ms. Load 5.5. But Enter then does nothing, see F2.2b. | PARTIAL |
| 1.6 | a keyboard shortcut | a key opens the bar | none exists. The Setup card's "Keys" row lists only "⌃⌥⌘J jump to who needs you · ⌃⌥⌘R record a short" (shot 17). Every way in is a mouse action on Net. | FAIL |
| 1.7 | menu-bar icon | same as 1.3 | not drivable in test mode. Its right-click is the same native menu as 1.3 ("Open Home"); left-click shows or hides Net. | n/a |

- Shots: `01-F1-single-click-open.png`, `02-F1-slash-list.png`, `24-F1-goal-button-prefills-bar.png`.
- Fleet at 01:47Z: kestrel `waiting (permission prompt)` for 4470 s, beacon `waiting (input needed)` for 4467 s, vibepet `idle` (turn done) for 2781 s. atlas, delta and ember were not running a turn. Home showed "No live sessions. Start Claude Code anywhere and I'll pick it up." (shot 01) while three live sessions existed, two of them waiting on the user.

## F2. Every command, run against the fleet

| # | command | member / truth at the time | expected | actual | result |
|---|---|---|---|---|---|
| 2.1 | `/today` ×5 | n/a | day-book note | "Goals set: 0 · hit: 0 · time drifting: 0m" painted at 21 ms. Five runs leave five identical lines; nothing shows which command produced them (shots 03, 04). Load 3.5. | PASS (copy: see X.5) |
| 2.2 | `/goal kestrel: approve the deploy` | kestrel `waiting (permission prompt)` 4795 s, not shown in Home. ember `idle` (loop), the only row. | goal set on kestrel, or "kestrel not found" | "Goal for ember: kestrel: approve the deploy". The goal landed on ember (shot 09). `set-goal` reached main at 4 ms with ember's id. `/goal` takes no session name: it targets the ◎-picked row, else the top row. | FAIL |
| 2.2a | `/goal` (empty) | ember | reset to the first prompt | "Goal for ember reset to its first prompt." The row then shows no goal at all (ember's first prompt is a `/loop` command). | PARTIAL (copy) |
| 2.2b | ◎ on atlas, then Enter, ×3 | atlas `busy` (build.sh) 391–454 s | the prefilled `/goal …` submits | 3/3 nothing happened: no submit, no note, text left in place, Send arrow grey (shot 26). After one keystroke (space + backspace), Enter submitted. | FAIL |
| 2.3 | `/jump ember`, `/jump emb`, `/jump EMBER`, `/jump` (+3 more) | ember `idle` (loop) 134–163 s, pane `vp-ember:0.0` | focus ember's tmux pane, or say why not in the panel | 7/7 jumps to ember failed. Across the session, **22 of 22** `/jump` runs failed (ember 7, atlas 9, vibepet 3, kestrel 3). Lookup took 141 ms median (100–281). Each run wrote `cd ~/.vibepet-ultra/fleet/<repo> && claude --resume <session id>` to the clipboard: a second claude on a session that is still live. The panel adds no note. The failure line ("ember: couldn't find its terminal — resume command copied") types into the speech bubble at 145 ms. The open panel covers the bubble: panel z-index 3 over bubble z-index 2, and the panel covers the bubble's centre. Shot 05 is at 0.4 s, shot 06 at 2 s, with the bubble fully typed in the DOM: nothing is visible. | FAIL |
| 2.4 | `/replay ember` ×3 | ember | Theater for ember | window at 104 ms, ready at 174 ms ("Theater — ember", 47 beats; shot 07). No note in the panel (shot 08), but a window opening is its own feedback. Load ≈2.9. | PASS |
| 2.5 | `/stop <port>` ×3 (`58570`, `:58637`, `58654`) | fixture HTTP servers started by this test in the vibepet repo; each showed in the footer as "s3 fixture" | server stopped, confirmed in the panel ≤ 1 s | Confirm dialog "Stop node (vibepet) on :58570?" at 60 ms (auto-answered Stop). Process gone at 46 ms. Footer chip gone only at **2.55 s** (2.44–2.76). No note in the panel. "stopped pid 81736" went to the speech bubble under the panel; in 2 of 3 runs it queued behind "node (vibepet) on :… is up" (shot 10). `:port` works. | PARTIAL |
| 2.5b | `/stop 59266`, dialog options recorded | fixture server pid 92488 | finishable from the keyboard | the dialog's buttons are [Stop, Cancel] with **default = Cancel** (defaultId 1, cancelId 1). Enter at the dialog cancels; Stop needs the mouse. | FAIL (keyboard) |
| 2.6 | `/setup` ×3 | n/a | Setup card; bar still usable | Card shown at 0.6 ms. **The bar is gone** while the card shows (shot 17). Focus drops to the page. Tab goes ⋯ → esc → pet buttons. With focus on "Sprout", typing `/today` + Enter **changed the pet to Sprout** (shot 18). Esc, then a click on Net: the card is still there, still no bar. Each choice drops focus again. "Done" took 20 Tab presses. After Done, focus stays on the page, not the bar. | FAIL |
| 2.7 | `/settings` ×3 | n/a | settings | the whole Net menu opens (14 items: Watching…, Localhost, Open Home, Setup…, Theater…, …). "Settings" is item 12, a submenu. Shown at 74 ms. | PARTIAL |
| 2.8 | `/record` ×3 | n/a | toggles a short | the toggle reached main at 0.3 ms. Capture was not run (test rule), so what the real recording shows was not assessed. | n/a |
| 2.9 | unknown: `/approve kestrel`, `/reply beacon Postgres`, `/answer beacon 2`, `/deny kestrel`, `/help`, `/Today`, `/`, `/stop`, `/stop node` | kestrel `waiting (permission prompt)` 228 s, beacon `waiting (input needed)` 227 s | clear copy | "Unknown command /approve. Type / to see them." (same for /reply, /answer, /deny, /help). `/Today` is unknown: commands are case-sensitive. `/` gives "Unknown command /. Type / to see them." `/stop` with no port gives "Nothing listening on ." (shots 19, 22). Note in the DOM at 1.9 ms. Load 9.7–10.4. | FAIL (copy) |

## F3. Targeting: partial, fuzzy, unknown and similar names

| # | input | truth at the time | expected | actual | result |
|---|---|---|---|---|---|
| 3.1 | `/jump kestrel`, `/jump beacon`, `/jump vibepet`, `/replay kestrel` | kestrel `waiting (permission prompt)` 4665 s, beacon `waiting (input needed)` 4662 s, vibepet `idle` (done) 2976 s. None shown in Home. | find the live session | "No session matches “kestrel”." (also beacon, vibepet). The copy is identical to a name that doesn't exist (`/jump zebra`, shot 04). The bar searches only the sessions Home shows. | FAIL |
| 3.2 | `/jump deploy` (kestrel's title "Deploy.sh dry run") | fresh approval wait. At 35–97 s kestrel was in Home (as **running**), and "deploy" matched. At **138 s** (still `waiting (permission prompt)`) its row was gone. | find it | "No session matches “deploy”." (shot 15). beacon (`waiting (input needed)` 137 s) vanished the same way. | FAIL |
| 3.3 | `/replay beacon`, `/replay database` | beacon `waiting (input needed)` 621 s. Same moment: ⋯ → Theater… lists "Beacon database choice · beacon · 10m". | open its replay | "No session matches “beacon”." / "…“database”." (shot 32). Two parts of the app disagree about which sessions exist. | FAIL |
| 3.4 | `/jump` (no name) | kestrel `waiting (permission prompt)` 118 s and beacon `waiting (input needed)` 117 s, both shown as **running**. vibepet `idle` (done). | the session that needs me | jumped to **vibepet**, the done one (shot 14). The default is the top Home row, and the rows misstate who is blocked. | FAIL |
| 3.5 | `/jump e`, `/jump a`, `/replay a`, `/jump run` ×9, `/replay run` | rows: vibepet "Read package.json" (ready), ember (ready), beacon "Beacon database choice", kestrel "Deploy.sh dry run", atlas "Run build.sh" (all three shown as running) | several matches: list them or ask | `e` matched 4 and `a` matched 3; both jumped to vibepet without saying so. `/replay a` opened "Theater — vibepet". "run" matches kestrel and atlas: at 01:55:15Z the bar's own matcher put kestrel first, but every real run from 01:55:38Z to 01:56:18Z (9/9) went to **atlas**. atlas's clock restarts every few seconds (its label reads "atlas · 0s"–"3s" for minutes), which makes it the "newest". `/replay run` opened "Theater — atlas" (shots 11–13). No "N matches" note. | FAIL |
| 3.6 | `/jump emb`, `/jump EMBER` | ember, the only row | partial and case-insensitive | both resolved to ember (then failed as in 2.3) | PASS (matching) |
| 3.7 | `/jump embr` (one letter off) | ember, the only row | "did you mean ember?" | "No session matches “embr”." No suggestion. | FAIL |
| 3.8 | after any failed command | n/a | keep the text to fix the typo | the bar is cleared (input "" after every no-match and unknown command) | FAIL (polish) |

## F4. Keyboard only: autocomplete, history, Esc, Enter, arrows

| # | keys | expected | actual | result |
|---|---|---|---|---|
| 4.1 | `/j` then Tab | Tab completes `/jump ` | Tab moves focus to the Send button; a 2nd Tab reaches the "/jump" hint; Enter fills `/jump ` and returns the caret (3 keys; shot 20) | PARTIAL |
| 4.2 | `/` then ↓ ↓ Enter | ↓ selects a hint, Enter runs or completes it | ↓ does nothing; Enter gives "Unknown command /." | FAIL |
| 4.3 | `/tod` (one hint left: `/today`) then Enter | runs `/today` | "Unknown command /tod."; text cleared | FAIL |
| 4.4 | ↑ in the empty bar ×2, after several commands | recalls the last command | nothing | FAIL |
| 4.5 | Esc while the hint list is open (`/rep`) | Esc dismisses the list first | the whole panel closes in 0.3 ms (shot 21). Reopening keeps the draft `/rep` and its hint (shot 22). | PARTIAL |
| 4.6 | Enter on an empty bar | nothing | nothing | PASS |
| 4.7 | `@`, and `/jump ` with a space | a picker of sessions (or ports for /stop) | nothing: the hint list hides as soon as a space is typed, and `@` opens nothing (shot 33) | FAIL |

## F5. Resolving a block from the command bar without the mouse

| # | attempt | member / truth | expected | actual | result |
|---|---|---|---|---|---|
| 5.1 | `/approve kestrel`, `/deny kestrel` | kestrel `waiting (permission prompt)` 228 s | approved/denied in ≤ 2 keys | "Unknown command /approve." (shot 19) | FAIL |
| 5.2 | `/reply beacon Postgres`, `/answer beacon 2` | beacon `waiting (input needed)` 227 s (AskUserQuestion) | answered | "Unknown command /reply." / "/answer." | FAIL |
| 5.3 | `/jump kestrel` ×3 | kestrel `idle` 132 s, its turn ended with a question ("Should the deploy script have unit tests?"); Home shows it as needs + Reply | land in kestrel's pane | failed 3/3 (135–191 ms). Clipboard got `cd …/fleet/kestrel && claude --resume 13a1427d-…`. Nothing in the panel (shot 28). | FAIL |
| 5.4 | Shift+Tab from the bar to kestrel's Reply | same | ≤ 2 keys | **17 Shift+Tab presses** with 3 rows and 2 servers: messages, each server's ✕ and Open, Today, "● Record a short", then each row's ◎ ✓ ▶ bottom-up, then Reply (shot 27). Rows themselves never take focus, so there is no keyboard "jump to row". The walk stops on "● Record a short", where Enter would start a screen recording. Reply was not sent: another tester held this member. | FAIL |
| 5.5 | Shift+Tab walk with 4 rows | atlas, ember, delta, vibepet | n/a | same shape (shot 23): footer first, then the rows' buttons in reverse order | — |

## X. Exploration (≈10 min): what a person with 5–15 sessions trips on

| # | observation | truth | result |
|---|---|---|---|
| X.1 | Blocked sessions drop out of the bar's reach. Five permission-prompt or AskUserQuestion waits were observed: kestrel ×3, beacon ×2. Each was either missing from Home already, or shown as "running" for about its first 2 minutes and then dropped while still waiting (3.2). Only kestrel's end-of-turn question (from 02:00Z) was shown as needing the user. | kestrel/beacon `waiting (permission prompt)` / `waiting (input needed)` throughout those spans | FAIL |
| X.2 | `jump kestrel` (no slash) went to chat as a message (shot 29): a model turn (seconds; tokens on a real engine), and no "did you mean /jump kestrel?". | kestrel `idle`, question pending | FAIL (polish) |
| X.3 | Command results land in three different places: a note in the panel (`/today`, `/goal`, no-match, unknown), the speech bubble hidden under the panel (`/jump` failure, `/stop` result), or nowhere (`/replay` opens a window, `/settings` a menu). Shots 06 and 27 show bubble text faintly *behind* the panel. | — | FAIL |
| X.4 | The bar's hints promise "/jump <name> go to a session’s tab". With every fleet session in tmux, that never happened (22/22). | — | FAIL |
| X.5 | Notes don't echo the command. A stack of identical "Goals set: 0 …" lines, or several "No session matches" lines, can't be traced back to what was typed (shots 04, 05). | — | FAIL (polish) |
| X.6 | The bar stays put at the bottom of the panel as rows and notes grow. The newest note was fully visible in 7 of 8 checks. Once (shot 09, 3.5 s after `/goal`, when the row above grew a goal line) it sat cut off at the bottom edge of the notes area. | — | PARTIAL |
