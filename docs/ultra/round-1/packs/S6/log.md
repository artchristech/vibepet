# S6 Ports / localhost: flow log

**Setup.** The real app was launched through the test harness against the isolated fleet root (six real Claude Code sessions on Haiku in tmux), with its own profile, the global hotkey off, sounds muted and the alert level at its default ("+ Finished").

**How it was driven.**
- Home was opened with a real click on Net.
- Chips (Open / ✕) were clicked with trusted Playwright clicks. The command bar was typed into. The ⋯ menu was clicked and its native menu captured as data.
- Native confirm dialogs can't be clicked through CDP. A stub recorded each dialog's text and answered Stop or Cancel.
- `shell.openExternal` was recorded instead of opening a browser. The harness then fetched the recorded URL to see which server it reaches.

**Servers.** All servers were started by this drive with a fleet member's repo as their cwd, the way a session runs them:
- kestrel's own `npm start`;
- `python3 -m http.server`;
- small node servers.

One server was started by the vibepet session itself.

**Rules followed.**
- Every server started was stopped. Nothing else was signalled.
- Each timing has the 1-minute load average next to it in `timings.json`.
- No sleep or wake happened during the run (01:48–02:20Z; the last wake was at 21:49Z, four hours earlier).

Truth column: `fleet.js status` at the start and end of each flow: member → state (registry status / last transcript record).

---

## F1: a server starts in a session's repo. How long until Home shows it, and is it attributed to the right session?

**Truth (01:49–02:02Z):**
- kestrel: approval, registry `waiting (permission prompt)`.
- beacon: question, `waiting (input needed)`.
- vibepet: done, `idle` / end_turn.

kestrel and beacon had no Home row during this flow. Home listed only "ember · done" (shots 01, 02, 04).

| step | expected | actual | result |
|---|---|---|---|
| 1. Home open, no servers (01) | footer with Record / Today only | as expected | pass |
| 2. `PORT=47101 npm start` in kestrel's repo (kestrel's README dev command) | chip within ≤3 s, naming kestrel | `:47101 node (kestrel)` after **10.3 s** (02) | slow |
| 3. `python3 -m http.server 47102` in beacon's repo | chip naming beacon | `:47102 Directory listing for /` after 10.3 s (04). Nothing on the chip says beacon; the page title replaced the repo | **fail** |
| 4. Six back-to-back trials, alternating kestrel `npm start` / beacon `http.server` | ≤3 s | 10.3, 10.3, 8.8, 9.1, 11.0, 9.2 s (median 9.8 s). Each start fell right after a refresh | slow |
| 5. Eight trials started at random moments (vibepet repo, node and http.server) | ≤3 s | 4.4, 11.5, 15.0, 9.8, 7.7, 5.0, 13.6, 3.8 s (**median 8.7 s**). The app refreshes the list every **12.0 s** (n=33) | **fail** (speed) |

### F1 done by a session: the vibepet session starts its own server

**Truth:**
- vibepet: done → working (my prompt) → `waiting (permission prompt)` 3.4 s later → done again (`idle` / end_turn) at 01:53:50Z.
- kestrel: approval.
- beacon: question.

| step | expected | actual | result |
|---|---|---|---|
| 1. Prompted vibepet to serve its folder: `python3 -m http.server 47120 --bind 127.0.0.1` with Bash `run_in_background` | — | it asked permission. Home showed its row as `running · 3s`, with no Approve, while it waited (06). "Yes" was answered in its tmux pane | — |
| 2. The server listens at 01:53:50.948Z. Process chain: Python ← bash ← the vibepet session's `claude` | chip naming the vibepet session | `:47120 Directory listing for /` after **3.3 s** (07). The vibepet row ("Read package.json · vibepet · done just now") and the chip are not linked in any way | **fail** (attribution) |
| 3. ⋯ → native menu → Localhost | the server and the session's background task, named | `:47120  Directory listing for /  · 1m` → submenu `http.server (vibepet) — ~/.vibepet-ultra/fleet/vibepet`. Background tasks: `● bhl322btn · vibepet · 1m` and `● bfh36401z · atlas · 1m`. These are raw task ids; the session's own description was "Start HTTP server on port 47120" | **fail** |
| 4. Two more members came back into Home (5 rows) | the localhost section stays reachable | both chips are below the Now list's fold. The list box is 367 px tall with 419 px of content, and neither chip is in view (08) | **fail** |

## F2: Open and Stop. Does Stop kill exactly that server, and only it? What feedback?

**Truth:** vibepet done; kestrel approval; beacon question.

kestrel was re-armed by another tester at about 02:04Z. Its row read `running · 15s` while its registry said `waiting (permission prompt)`.

| step | expected | actual | result |
|---|---|---|---|
| 1. vibepet's server, click its chip (Open) | opens that server | `http://localhost:47120` was requested 53 ms after the click. Fetching it returned that server's listing (200) | pass |
| 2. ✕ on the same chip | confirm, then exactly that process dies; clear feedback | Dialog "Stop http.server (vibepet) on :47120?", detail "pid 84496", default button Cancel. On Stop, Python was dead in **53 ms** and the vibepet `claude` stayed alive. The chip was gone 2.5 s later. The only message, "stopped pid 84496", was drawn behind the open panel (09: faint text behind the composer) | kill **pass** / feedback **fail** |
| 3. What the session saw | — | its transcript got a task notification "Background command "Start HTTP server on port 47120" failed with exit code 143". The session took a turn and answered "The HTTP server failed to start with exit code 143." The pet's dialog never said the server was the session's background task | **fail** (clarity) |
| 4. Three servers up: vibepet site preview (`http.server --directory site` :47141), node behind `sh -c` (:47142), kestrel `npm start` (:47143) (11) | 3 chips | `:47141 vibepet — a desktop pet for p…` (title cut off), `:47142 node (vibepet)`, `:47143 node (kestrel)` | pass |
| 5. Open on :47141 | the site preview | `http://localhost:47141` 26 ms after the click, reaching the site preview (title matches) | pass |
| 6. ✕ on :47142, Cancel | nothing dies | nothing died, no message | pass |
| 7. ✕ on :47142, Stop | only :47142 dies | node dead in **43 ms**, its `sh -c` wrapper exited (143), :47141 and :47143 untouched. The chip was gone after 3.2 s. The message "stopped pid 83402" was behind the panel (12) | kill **pass** / feedback **fail** |
| 8. :47141 exits on its own, then 0.3 s later ✕ on its still-listed chip | the pet sees it is already gone | Dialog "Stop http.server (vibepet) on :47141?" appeared. Stop → "couldn't stop pid 83400: ESRCH", behind the panel (13). The chip vanished 3.8 s after the exit | **fail** |
| 9. Command bar `/stop 47999`, then `/stop` | a helpful note | "Nothing listening on 47999." and "Nothing listening on ." (14) | `/stop` alone: **fail** (copy) |
| 10. `/stop 47143` + Enter | same dialog, kill | "Stop node (kestrel) on :47143?". Node dead in 281 ms, `npm` exited, chip gone after 3.5 s. "stopped pid 83469" was behind the panel (15) | kill **pass** / feedback **fail** |
| 11. ⋯ → Localhost → `:47192 menu target · 0m` → "Stop node (pid 63602)…" | kill + feedback | Dialog "Stop node (vibepet) on :47192?". Dead in 19 ms, chip gone after 2.0 s. **No message of any kind**: no event reached the pet at the default alert level (29) | **fail** |
| 12. 60 human-speed clicks (150 ms press) on a chip's Open at random moments | 60 opens | **58** opens. 2 clicks were lost, both pressed while Home rebuilt itself on its 3 s tick | **fail** |

## F3: a second server on the same port from another member's repo

**Truth:** kestrel approval (`waiting (permission prompt)`); beacon question (`waiting (input needed)`).

| step | expected | actual | result |
|---|---|---|---|
| 1. kestrel: node "Kestrel dashboard" on `*:47151` (node's default bind). beacon: `python3 -m http.server 47151 --bind 127.0.0.1` serving "Beacon status". Both listen (lsof: `*:47151`, `127.0.0.1:47151`) | two chips, one per repo, each opening its own server | two identical chips, `:47151 Beacon status` and `:47151 Beacon status` (16). The kestrel chip carries beacon's title. Open on **either** chip requests `http://localhost:47151`, which reaches **Kestrel dashboard** (localhost resolves to ::1 first). Beacon's server can't be opened from the pet | **fail** |
| 2. kestrel node on `*:47152`, then beacon node on 47152 | the holder is shown | beacon's server exits with EADDRINUSE. Home shows one chip, `:47152 node (kestrel)`: the true holder, named by repo (17). Nothing hints that beacon's start failed | pass |
| 3. The dev-server dance: the second server takes the next port (Vite / Next do this). kestrel :47153 and beacon :47154, both titled "Vite + React + TS" | chips that say whose is whose | `:47153 Vite + React + TS` and `:47154 Vite + React + TS` (18). The repo appears only one level deep in the native submenu (`node (kestrel) — ~/.vibepet-ultra/fleet/kestrel`) | **fail** |

## F4: the server exits. Time until it disappears

**Truth:** as in F1.

| step | expected | actual | result |
|---|---|---|---|
| 1. Ctrl-C (SIGINT to the process group) six times, each soon after the chip appeared | chip gone ≤3 s | 9.3, 10.6, 9.2, 10.8, 8.1, 8.5 s (median 9.2 s). Shot 03 shows kestrel's chip gone | slow |
| 2. Exit at random moments ×8 | ≤3 s | 15.4, 10.4, 7.3, 11.4, 11.6, 4.5, 10.5, 13.4 s (**median 11.0 s**) | **fail** (speed) |
| 3. Any notice that a server went away (default alerts) | "X went down" | nothing. The chip just disappears. While it lingers, its ✕ and Open still act on the dead server (F2 step 8) | **fail** |
| 4. Alerts set to "Everything" via `/setup` → Alerts → Everything → Done (23), then exit a server with Home open | visible notice | "node (vibepet) on :47169 went down" 3.5 s after the exit (n=1), drawn behind the open panel (25) | **fail** (hidden) |

## F5: servers outside any session; noise filtering

**Truth:** kestrel approval, beacon question, vibepet done (`idle`, last turn 01:55Z), all live.

Home's Now list said "No live sessions. Start Claude Code anywhere and I'll pick it up." next to chips from those sessions' repos (19, 20).

| step | expected | actual | result |
|---|---|---|---|
| 1. Node servers in `~/.vibepet-ultra/s6-outside` (:47171) and in a fleet dir no watched session uses (:47172) | not listed | not listed across 3 refreshes | pass |
| 2. A prefork server (master + 3 workers sharing 127.0.0.1:47161, the gunicorn shape) | one chip | **four** identical chips `:47161 prefork app` (19) | **fail** |
| 3. ✕ on the first prefork chip (the master) | server stops | "Stop Python (vibepet) on :47161?" → the whole server stopped | pass |
| 4. ✕ on a worker chip (second prefork server, :47184 "gunicorn app") | the server stops, or the dialog says it won't | "Stop gunicorn (vibepet) on :47184?" → that worker died and the master replaced it 20 ms later. The server kept answering; still 4 chips (27). The only message, "stopped pid 47120", was behind the panel | **fail** |
| 5. A node app with a debugger port (app :47162, `--inspect` :47163) | one entry, or clear which port Stop ends | two chips. ✕ on the **:47163** chip asked "Stop node (vibepet) on **:47162**?" and both ports died | **fail** |
| 6. A TCP listener that never speaks HTTP (:47164) | chip that says it isn't a web page | `:47164 node (vibepet)` with Open disabled. It looks exactly like an enabled chip and its tooltip still says "Open" | **fail** (polish) |
| 7. Ten servers up | all reachable, or "+2 more" | exactly **8** chips, in port order. The newest (`:47166 newest app`, kestrel) and another tester's server (:58308) are missing, with no hint (20). The hover count and the native menu say 10 | **fail** |
| 8. A non-listening `node` watcher in the vibepet repo, older than 60 s | visible somewhere | only in the native menu ("Dev processes · node · vibepet · 1m") and the hover count ("1 dev proc") | pass (secondary) |
| 9. Home closed, cursor on Net | count of servers | the pill shows `⌂ 1 server` (22) | pass |
| 10. Alerts "Everything", Home closed, a server starts | visible "is up" | "node (vibepet) on :47169 is up · node (vibepet) on :47168 went down" 5.1 s after listen. It merged two unrelated servers into one line. It went to the bubble while the hover pill was open, which hides the bubble (24 shows only the pill) | **fail** |
| 11. Server ages in the native menu | true process ages | `· 1m` for a 70 s-old server, `· 20m` for a 20-minute one: true (taken from the process, not from when the pet started) | pass |
| 12. The filter on this Mac's real listeners: counts only, using the same rules with no isolated root | — | 56 listening sockets → 51 chips. Home would show 8. 14 of the 51 are bound to `[::1]` only | — |

## Exploration: common dev-server shapes

**Truth:** kestrel approval, beacon question (busy for a moment at 02:13Z), vibepet done.

| step | expected | actual | result |
|---|---|---|---|
| 1. Node `listen(port, 'localhost')`, which binds `[::1]` only on this Mac. This is Vite's default host; several of this Mac's own dev servers are bound the same way | chip with title, Open works | `:47181 node (vibepet)` with **Open disabled** (26). A browser at `http://localhost:47181` gets 200 "Vite + React + TS". The pet's title probe goes to 127.0.0.1 and is refused | **fail** |
| 2. A local HTTPS dev server (:47183) | Open https | `:47183 node (vibepet)`, Open disabled (26) | **fail** |
| 3. A server that is still compiling when first seen (every request waits until 20 s after start, then is instant, like a Next.js first build) | chip corrects itself once the server answers | first seen 13.0 s after listen with Open disabled and label `node (vibepet)`. **50 s** after listen, three refreshes later, it was unchanged (28), while `http://localhost:47185` gave 200 "Next.js app" | **fail** |
| 4. The next-port case (F3 step 3) and the python title (F1 step 3) | — | see above | — |

## Members and actions used

- One prompt to the vibepet session (F1 done by a session). It ended back in its done state (`idle` / end_turn).
- All other servers ran with a member repo as cwd only. kestrel's and beacon's sessions were never typed into.
- Every server started here was stopped. No test listener remained on 47101–47192 at the end.
