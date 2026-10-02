# Round 1 · merge wave 1 (2026-10-02, ~01:47–02:05 local)

Integration worktree `~/.vibepet-ultra/int`, branch `ultra/round-1`, base `37ba577`. Order as given: queue-state, then tmux-reach. home-keyed is red, so it was not merged.

## Merges

| # | merge commit | branch (tip) | conflicts | npm test after merge |
|---|---|---|---|---|
| 1 | `9d325d0` | `ultra/r1/queue-state` (`ab8ce69`) | none. The tree `8acf967` is identical to ab8ce69's | 40/40, 11.3 s (load 391→388) |
| 2 | `8e5fe27` | `ultra/r1/tmux-reach` (`dadb52f`) | `package.json` "files": each branch adds one module (`registry.js`, `tmux.js`). Both kept | 51/51, 3 runs: 12 s (load 422→449), 15.2 s (load 415→392), 17.0 s (load 392→338). Median 15.2 s |

HEAD = `8e5fe27`, working tree clean, nothing pushed.

Review of the auto-merged `agents.js` and `main.js`: the hunks don't overlap, and the meaning holds together.
- queue-state's `unstick()` calls `locateSession()` and reads only `.pid`. tmux-reach now also returns `.reg`, which doesn't affect it. unstick runs only for sessions with no registry entry (`alive === null`).
- tmux-reach's `send-to` and `jump` take the pane from `locateSession().reg.tmux`. queue-state didn't touch either handler.
- The renderer's `pet.sendTo(id, text|null)` callers still work with tmux-reach's preload change, which also accepts an object.

Duplication left in place as a follow-up, because it does no harm:
- two tmux binary resolvers: `registry.js tmuxBin()` and `tmux.js tmuxBin`
- two registry readers: `registry.read()` for each tick, and `agents.js regOf()` for each click

## Canon: merged build vs canon-base

`node test/ultra/canon.js --app ~/.vibepet-ultra/int --out round-1/canon-merged-w1 --userdata ~/.vibepet-ultra/userdata/r1-canon-merged-w1`. The two repeats (`-r2`, `-r3`) used fresh userData directories.

| run | result | time | load (uptime) | close |
|---|---|---|---|---|
| canon-merged-w1 | ok 29/29 | 101.3 s | 473 → 540 | quit 10.8 s, 0 orphans |
| canon-merged-w1-r2 | ok 29/29 | 55.8 s | 337 → 347 | quit 1.8 s, 0 orphans |
| canon-merged-w1-r3 | ok 29/29 | 43.1 s | 347 → 351 | quit 2.3 s, 0 orphans |

The median run took 55.8 s. Base took 21.1 s at load about 3, so the difference is machine load, not the build.

- Rows in all 3 runs: `beacon:needs kestrel:needs delta:ready atlas:ready vibepet:ready`.
- Truth mismatches: 0. canon-base had 3, all "missing": kestrel, vibepet and beacon had no row.
- Fleet: 3/6 in state, the same as base (atlas, delta and ember are paused). The fleet didn't change during any run. Spend stayed at $3.3093, because every run used `--act` off and the stub chat.
- Assertions went from 20/22 to 29/29. Base's two failures, `rows/anyRow` and `theater/replayButton`, can now be checked, and the checks that replace them pass: rowsInSnapshotOrder, goalPrefill/Set/Done, replyForm, jumpRuns:delta, theater opens/hasBeats, hotkeyWalks.
  - The compare reports the base failures as `false → null` because queue-state's canon.js renamed or replaced them.
- Compare files: `canon-merged-w1-compare.json` (vs base) and `canon-merged-w1-vs-queue-state.json` (vs `fixes/queue-state/gate/canon2`).

Surface by surface, no surface regressed:
- **1-home**: base showed "No live sessions" and 0 rows. Merged shows 5 rows in one queue order. The needs-you rows show their ask: `Bash: ./deploy.sh --dry-run` with Approve, and beacon's question with "(SQLite / Postgres / Redis)" and Reply. Labels carry true ages.
- **2-chat**: the stub reply now lists every session with its kind, true age and ask.
- **3-command**: the slash menu and `/today` behave as at base. The shots differ only because rows now sit above them.
- **4-rows and 5-theater**: base had no row to act on. The merged build passes goal, reply and jump, and ▶ opens Theater with 149 beats.
- **6-ports**: the footer chip is listed, Open is recorded, and Stop confirms and kills the server, all as at base.
  - In run 1 the `6-ports/footer.png` clip caught chat text (26% of pixels changed). r2 and r3 match queue-state's gate shot (1.2% / <0.1%).
  - So it's a clip-timing artifact under load 470–540. The likely cause: base's `renderHome` rebuilds `#now` on every tick, which resets the scroll between `scrollIntoViewIfNeeded` and the capture.
- **7-keys**: the hotkey walks beacon then kestrel, and gesture saves 3 templates. The base fleet had nothing pending.

## Bisect (each merge commit)

I ran canon on merge 1's tree, using `~/.vibepet-ultra/wt/r1-queue-state` @ `ab8ce69` (tree `8acf967`, the same as `9d325d0`). Output is in `canon-merged-w1-bisect-m1`, at load 302 → 893.
- Result: 28/29. The one failure is `run/cleanClose`: quit timed out after 26.7 s at load 893, and launch.js SIGKILLed one Electron orphan. That build is not the merged one, and all 3 merged runs closed cleanly.
- Every shot matches merged except `4-rows/jump` (21%) and `7-keys/hotkey` (19%). These are tmux-reach's fix:
  - Merge 1 alone copies `cd … && claude --resume <id>` for a **live** tmux session (clipboard writes: 1). The bubble says "resume command copied".
  - Merge 2 returns `{ok:false, why:'no terminal is attached to tmux session vp-delta', attach:'tmux attach -t vp-delta'}` with 0 clipboard writes.
  - Jump time on the merged build, no client attached: 1707 / 1531 / 524 ms, median 1531 ms (load 350–540).
- Merged `2-chat/sending` shows an 11% shift against the old queue-state gate, a 7 px move of the panel. Merge 1 shows the same shift on its own `1-home/panel` (13.9%) at today's load. It comes from the ghost bubble's timing, not from code. The home-keyed gate saw the same thing.

**Canon status: no regression and no revert.** Merged 29/29 in 3 of 3 runs, against base 20/22.

## Skipped

- `ultra/r1/home-keyed`: red at its gate. The sticky needs-you stack has no size limit, so in heavy states (15 agents with 4–5 needs, after a note or with the slash menu open) 10–12 of 15 rows can never be scrolled into view. Base reached 8. Not merged, as instructed. The gate's suggested fix: rows stay sticky only while the stack fits, with about two rows held in reserve.

## Follow-ups (not regressions; for wave 2)

1. `renderer/app.js jumpTo()` ignores `r.why` and `r.attach` and always says "couldn't find its terminal". tmux-reach now returns the exact reason and the attach command. This is the live-rows / row-actions contract: show `r.why` on failure.
2. In light mode the ask line, `.na { color:#ffd98a }`, has no override in the `prefers-color-scheme: light` block. On the cream needs row it reads at about 1.2:1 contrast, and it holds the approval command and the question choices. This is base CSS, visible now that rows render (home-feedback / row-actions).
3. With 5 rows, `aboveFold` = 4, and the Record/Today/localhost footer sits below the fold inside `#now`. This is base layout and was home-keyed's scope (red, so still open).
4. The duplicated tmux resolver and registry reader noted above.
