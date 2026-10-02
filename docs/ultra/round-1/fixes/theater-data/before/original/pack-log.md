# S5 Theater replay: flow log

## Setup

- **App:** vibepet, launched from its checkout through the test launcher. It watches only the isolated fleet root and uses its own profile. Global hotkeys are off. In test mode, windows open without taking the OS focus.
- **When:** 2026-10-02, 01:43–02:15 UTC. The Mac's local time is MDT (UTC−6), so 19:43–20:15 local. Replays print local times ("06:32 PM").
- **Machine:** a shared laptop. The 1-minute load average ranged from 2.3 to 9.6 during the run and is recorded next to every timing (`timings.json` → `load`). Timing-critical steps were repeated; the reported value is the median, with n.
- **Input:** real input, as trusted Chromium mouse and key events, on the pet window and the theater windows: clicks, hovers, drags and key presses.
  - Exception: the ⋯ and right-click menus are native macOS menus, which synthetic input cannot reach. When one popped up it was captured, and its "Theater… → session" item was activated in the main process, the same call a hand on the menu makes.
  - Closing a theater window used `window.close()`. The traffic lights and ⌘W are native and can't be driven either. The app menu does bind ⌘W to "Close Window".
- **Timing points:**
  - The click is stamped by the page that received it (wall clock), or by the main process for a menu item.
  - **First frame** is the first animation frame after the replay's header and rail were rendered, measured inside the theater page. The pet page's own clock had drifted 59 ms from the wall clock, so wall-clock stamps are used throughout.
- **Fleet rules followed:** no fleet session was made to take a turn and no keys were sent to any session. The truth came from `fleet.js status --json` and from reading the fleet transcripts. Two read-only pane captures (`vp-kestrel`, `vp-atlas`) confirmed what a dialog showed.
- **Members changed during the run:** other testers re-armed several members at about 01:48–01:54Z and 02:01Z. Every check below names the member's true state at that moment.

### Fleet truth

| member | 01:43:41Z (start) | 01:55:27Z | 02:10Z | 02:15:27Z (end) |
|---|---|---|---|---|
| kestrel | approval: registry `waiting (permission prompt)` since 00:32:53Z, pane "Do you want to proceed?" for `./deploy.sh --dry-run`; transcript tail = user prompt (the tool call is not written while the dialog is up) | approval (re-armed 01:54:39Z, same shape) | approval, waiting 411 s | approval |
| beacon | question: `waiting (input needed)` since 00:32:56Z, AskUserQuestion pending, tail = user prompt | question (re-armed) | question, waiting 959 s | question |
| vibepet | done: `idle` since 01:01:01Z, tail end_turn | done | idle 937 s | done |
| atlas | claude idle, its build interrupted at 22:45Z | **working**: `busy`, `./build.sh` running since 01:53:55Z (pane: batch 14/54 at ~01:56Z) | idle 464 s (build over) | idle |
| delta | claude exited; transcript with 33 subagent files | exited | idle 592 s (a fan-out ran ~02:01Z) | idle |
| ember | claude exited; /loop transcript | **loop**: resumed 01:48Z, fires every ~285 s (01:53:07Z, 01:57:5xZ, 01:59:35Z) | exited | exited |

## Entry points to a replay

| # | entry point | clicks | available for |
|---|---|---|---|
| a | Home row ▶ | 2 (Net, ▶) | only sessions in Home's live list |
| b | hover list (roster) ▶: hover Net, hover the row, ▶ | 1 | same live list |
| c | `/replay <name>` in the Home input | Net, type, Enter | same live list |
| d | ⋯ → Theater… → session | 4 (Net, ⋯, Theater…, session) | every transcript touched in the last 12 h |
| e | right-click Net → Theater… → session | 3 | same as d |

## F1: open a replay for every member from every entry point; time to first frame

| step | member, true state | expected | actual | result |
|---|---|---|---|---|
| F1.1 Home row ▶, 01:44Z: click Net → Home | kestrel approval 66 min; beacon question 66 min; vibepet done 42 min; atlas idle | a row with ▶ for each live session, the two that wait on me first | "No live sessions. Start Claude Code anywhere and I'll pick it up." 0 rows, no ▶ anywhere (`01-F1-home-no-rows.png`). Home opened 424 ms after the click | **FAIL** |
| F1.1b same at 02:10Z | kestrel approval 411 s; beacon question 959 s; vibepet done 937 s; atlas idle 464 s; delta idle 592 s | 5 rows with ▶ | 0 rows, same copy (`40-F1-home-rows-now.png`) | **FAIL** |
| F1.2 `/replay kestrel` (then beacon, vibepet, atlas, delta, ember), 01:44Z | as F1.1 | each opens that session's replay; its transcript exists, and Theater… listed it one minute later | "No session matches “kestrel”." and the same for all six; no window opened (`02-F1-replay-cmd-hint.png`, `03-F1-replay-cmd-no-match.png`) | **FAIL** |
| F1.3 ⋯ → Theater…, 01:45Z | all | a list of recent sessions, each clearly named, with a true age | 8 entries (verbatim below). Two ember entries show raw markup. kestrel and atlas read "3m" although their last records were 73 min and 3 h old | **FAIL** (labels) |
| F1.3b open each of the 8 from Theater…, 3 times each, closing the window between opens | all | a replay with beats in ≤ 150 ms | all 24 opened with beats. First frame median **134 ms** (n=24, 102–266). Per session: kestrel 150, atlas 116, beacon 132, vibepet 163, **delta 200**, ember 135, ember (previous session) 131, kestrel (previous) 114. Over all 8 delta opens, median **192 ms** (151–313) | PASS, delta slow |
| F1.4 Home row ▶, 01:52Z: ember had just come back as a row ("ember · done 4m ago ▶ ◎") | ember: loop, idle between fires | replay | opened. Median **130 ms** (n=5, 114–245; 245 = the first open after a pause) (`25-F1-ember-row-replay.png`, `26-F1-ember-theater.png`) | PASS |
| F1.5 hover-list ▶, 01:55–01:57Z: 5 rows (ember, vibepet, beacon, kestrel, atlas), 3 opens each | as 01:55Z | a visible ▶ per row | ▶ is invisible until the row itself is hovered, a 13×15 px target (`27-F1-roster-hover.png` shows no ▶, `28-F1-roster-row-hover.png` shows it on hover). First frame median **147 ms** (n=15, 114–214) | PASS, discoverability |
| F1.6 `/replay vibepet`, 02:14Z: vibepet was in the live list at that moment | vibepet done | replay | median **135 ms** (n=3). A bare `/replay` opened the top session, vibepet (`42-F1-replay-cmd-bare.png`) | PASS |
| F1.7 right-click Net | — | menu with Theater… | native menu 16 ms after the right-click; same 8 entries; the delta item opened delta | PASS |
| F1.8 the ⋯ menu itself | — | ≤ 150 ms | ⋯ click → menu shown 11 ms median (n=5); building the 8-entry Theater… list takes 8.8 ms in main (n=7) | PASS |

Theater… entries, verbatim, at 01:45Z:
1. `Deploy.sh dry run  · kestrel · 3m`
2. ``Run exactly `./build.sh` with the Bash tool in the  · atlas · 3m``
3. `Beacon database choice  · beacon · 19m`
4. `Read package.json and tell me in one plain sentenc  · vibepet · 20m`
5. `Reconcile the three shards in parallel. In ONE mes  · delta · 1h`
6. `<command-message>loop</command-message> <command-n  · ember · 1h`
7. `<command-message>loop</command-message> <command-n  · ember · 5h`
8. ``Run exactly `./deploy.sh --dry-run` with the Bash   · kestrel · 6h``

Age truth:
- **kestrel:** last record 00:32:51Z. The file's mtime moved to 01:41:29Z with no change in size (415 040 B before and after).
- **atlas:** last record 22:45:12Z. Its mtime also moved to 01:41:29Z, size unchanged (306 875 B).

## F2: fidelity, the replay against the transcript

**Method.**
- **Automated pass:** an independent read of each transcript (prompts including /commands, assistant text, tool calls, results, and every subagent file) was compared with every beat the open replay holds. It checked order, kind and timestamp (to the ms).
- **Real-UI pass:** for 12 beats per replay, spread evenly from first to last (4 for the 4-beat session), the replay was paused with Space and the scrub bar was clicked at the beat's position. The stage then showed the beat, and its kind label, local time, "+offset" and text were read and compared with the transcript event.

| replay (session) | beats | in the transcript, same order and time | UI spot checks that match | what is wrong |
|---|---|---|---|---|
| kestrel (current) | 47 | 47/47 | 12/12 | the 20 calls the user rejected show **"✕ EXIT"** (`05-F1-kestrel-playing.png`) |
| atlas | 15 | 15/15 | 12/12 | — |
| beacon | 25 | 25/25 | 12/12 | each AskUserQuestion shows as **"LOOK · AskUserQuestion"**. The question ("Which database should beacon use to store check results?") and its options (SQLite / Postgres / Redis) appear nowhere, not even in the detail panel ("output · failed") (`37-…-stage.png`, `38-…-pinned.png`) |
| vibepet | 44 | 25/25, **plus 19 beats that are not in the session** | **6/12** | 19 "MILESTONE" beats for git commits the session never made (483d5e8 … c2b5c0a), made by other processes in the same repo during the session's hours. The session's only tool call is one Read. Header **"Session start"** instead of its first prompt; stats "19 commits" (`15-F2-vibepet-beat23.png`, `16-F2-vibepet-beat43.png`) |
| delta | 136 | 136/136; 33 lanes for 33 subagent files | 12/12 | branch numbers follow file names, not spawn order: the first fan-out (02:41 PM) is "branch 14, 7, 8", the second "27, 28, 25" (`08-F1-delta-playing.png` "general-purpose · branch 7") |
| ember (current) | 47 | 47/47 | 12/12 | 19 scheduled /loop fires and 26 hidden loop prompts have no beat or marker. Chapters are "/loop 5m run ./tick.sh" plus 6 × "/exit", so ticks after each resume play under a chapter called "/exit" (`19-F2-ember-beat25.png`) |
| ember (previous) | 22 | 22/22 | 12/12 | same loop markers missing |
| kestrel (previous) | 4 | 4/4 | 4/4 | — |

UI spot checks: **82 of 88 match** on kind, local time, offset and text. All 6 misses are vibepet's foreign commit beats. Shots of a middle beat and the last beat of each replay: `09`–`24`.

### The end of a live session's replay

| member, truth at open | expected last frame | actual | result |
|---|---|---|---|
| kestrel, waiting on approval of `./deploy.sh --dry-run` (pane: "This command requires approval / Do you want to proceed?") | says it is waiting on me, and for what | ends on "PROMPT 06:32 PM · Run exactly `./deploy.sh --dry-run` again…". Nothing about the open dialog (`06-F2-kestrel-end.png`) | **FAIL** |
| atlas, `./build.sh` running for 2 min (pane: batch 14/54) | says the command is still running | ends on "COMMAND · Run build script · `./build.sh`" with an empty terminal, no verdict, no "running" mark; looks like a finished command with no output (`30-F2-atlas-live-end.png`, `35-F3-atlas-end-of-replay.png`) | **FAIL** |
| beacon, AskUserQuestion pending | shows the pending question | ends on its prompt (`14-F2-beacon-beat24.png`) | **FAIL** |

## F3: controls

On atlas (15 beats), kestrel (47–53), delta (136) and ember (47–49). Input-to-response times were measured inside the page.

| control | expected | actual | result |
|---|---|---|---|
| ▶/❚❚ click, Space | toggles | toggles; 0.4–6 ms. Space right after clicking ▶ (the button keeps focus) toggles once | PASS |
| 1/2/3 keys, 1×/4×/16× buttons | speed changes | ≤ 0.7 ms. Measured rate 1.00× at 1× and 4.03× at 4× (virtual ms per real ms; the chapter card pauses the clock) | PASS |
| ← / → | previous/next beat | 1→2→3→4, then ← to 3; 1.2–2.4 ms | PASS |
| [ / ] | chapter start / next chapter | ] 3→5; [ 5→3, then 3→0; 1.0–1.6 ms | PASS |
| scrub drag 20 % → 60 % | lands at 60 % | 0.600 of the duration | PASS |
| click a beat on the rail | seek + detail panel | seeks and pins, 1.3 ms (`32-F3-atlas-pinned.png`) | PASS |
| Esc; re-click the beat; ✕ | detail closes | Esc closes it (0.1 ms) and re-click toggles it. **The panel's ✕ is outside the 1280 px window:** panel 996–1366 px, ✕ 1329–1353 px (`34-F3-atlas-pin-clipped.png`, `38-…-pinned.png`); it can only be reached by scrolling the page | **FAIL** |
| play to the end at 16× | stops at the end | stopped on the last beat, ▶ shown, "1:09 / 1:09" (`35-F3-atlas-end-of-replay.png`); ▶ again restarts at 0:00 | PASS |
| ▶ after dragging to the visible end | restarts | the clock already read "1:09 / 1:09" (164 ms short), so ▶ played 164 ms and stopped, as if nothing happened. A second ▶ restarted | polish |
| End / Home / PageDown | jump to the latest or first moment | nothing happens; ⌘→ acts like → | **FAIL** (no way to "now") |
| reopen a replay that is still open (ember ▶ at 02:01:57Z, after fires at 01:57 and 01:59) | shows the session as it is now | the old window came forward unchanged: 49 beats ending 19:53:08, while the session had 52 ending 19:59:35. No refresh happened and there is no refresh control (`36-F3-ember-reopen-stale.png`) | **FAIL** |
| window at its minimum size, 820×520 | everything reachable | the page still lays out 1400 px wide. The scrub bar runs to x=1046, the clock sits at 1060–1148 and the stats are off-screen, so the last 22 % of the timeline (the newest events) can't be clicked and the clock isn't visible (`39-X-kestrel-min-size.png`) | **FAIL** |
| default size 1280×800 with a long first prompt (most sessions) | fits | the page is 1403–1494 px wide. Stats and the chapter label are cut, and the playhead and stage are centred at 701–747 px instead of 640 (`05`, `08`, `30`). A short title (ember's "/loop 5m run ./tick.sh") fits (`36`) | **FAIL** |
| very long sessions | open and play | kestrel 5.7 h real → 3:21 replay (26 chapters), delta 5.3 h → 5:04 (136 beats, 33 lanes), ember 4.7 h → 3:41. All open in ≤ 313 ms and play. Every replay starts at chapter 1 from 5+ h ago, and reaching the latest moment takes a drag to the far right | PASS, friction |
| close | a visible close | there is no in-window close; Esc only closes the detail panel. Closing is left to the traffic lights or ⌘W | note |

## F4: performance

- **Open:** see F1. Every entry point lands at a median of 130–147 ms. delta, with 33 subagent files, has a median of 192 ms (n=8). The main process spends 58 ms (median, n=7) reading and building delta's timeline, against 14–31 ms for the others.
- **Jank while playing:**
  - delta at 4×: 56.1 fps, frame-interval p95 32 ms, max 51–65 ms (n=3 runs of 6–8 s).
  - delta at 16×: p95 18.7–33.4 ms.
  - kestrel at 4×: 58.5 fps, p95 18.6 ms.
  - Load 3.0–6.4.
- **Paused or ended replay:** it keeps redrawing at 59.7 fps although nothing moves.
  - The theater renderer uses 6.5 % of a core (median, n=5).
  - The whole app (browser, GPU and renderer processes) uses 14.7 % with a paused replay open, against 3.0 % with it closed (10 s each, load 4.9).
- **Memory (working set):**
  - 3 s after open: median 178 MB (n=24, 149–203 MB), even for the 4-beat session.
  - After 4 full plays of delta at 16×: 350–377 MB, peak 385 MB.
  - For comparison, the pet window uses 104 MB.

## Exploration (≈10 min, a person with many sessions)

- **Three replays open at once** (beacon, kestrel, vibepet) sit at exactly the same frame: x 80, y 25, 1280×800, on a 1440×900 display. Only the newest is visible. Window titles are "Theater — <repo>", so two kestrel sessions get the same title, and with no Dock icon there is nothing to switch with.
- **The chapter card types over the prompt that is already on stage.** For about 0.3 s, two copies of the prompt overlap at different sizes. This happens on open (`04-F1-kestrel-first.png`) and at every chapter during play (`41-X-kestrel-chapter-card-transition.png`, chapter 2 of 26).
- **Nothing in Theater acts on the session.** There is no jump to its terminal and no approve or reply. Even for kestrel, which waits on an approval, I have to go back to the pet.
- **`/replay` can't be completed from the keyboard.** After "/rep", Tab moves focus to the Send button and ↓ does nothing. Session names are never suggested.
- **The hover list's ▶ is invisible until its row is hovered** (see F1.5).
- **Could not be checked with this fleet:** Home's 8-row cap and the panel fold. Home held 0–1 rows for most of the run, and at most 5 in the hover list.
