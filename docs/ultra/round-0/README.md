# Round 0: start here

Round 0 built the measuring tools: a harness that drives the real app in isolation, a fleet of six real Claude Code sessions, ground truth mined from the user's own history, and the "before" numbers. **No app behaviour has changed yet.** `ultra/round-0` is `main` 649beb2 plus test-only overrides and tooling. Nothing was pushed, released or deployed. REPO is still on `main` @ 649beb2.

## What exists

| what | where | status at audit (2026-10-02 01:05Z) |
|---|---|---|
| Integration branch | `ultra/round-0` @ `315952c`, worktree `~/.vibepet-ultra/int` | merges `r0-harness`, `r0-fleet` and `r0-tta`, plus canon/watch and the guard fix. `npm test` passes 24/24 in 2.0–3.3 s |
| Harness | `test/ultra/launch.js` (see its README), `smoke.js`, `canon.js`, `watch.js`, `tta.js` | smoke: 3/3 runs, first run and parallel pass with 0 orphans (17.5 s) |
| Overrides | `overrides.js`: `VIBEPET_CLAUDE_DIR`, `VIBEPET_USER_DATA`, `VIBEPET_HOTKEY`, `VIBEPET_TEST` | all unset = shipped behaviour |
| Fixture fleet | `test/fleet/*`, tmux `vp-*`, repos in `~/.vibepet-ultra/fleet/`, watch root `~/.vibepet-ultra/root/.claude` | kestrel (approval), beacon (question) and vibepet (done) are OK. atlas, delta and ember are paused ($0/h) |
| Ground truth | `ground-truth.{md,json}`, `presence.json`, `mineA/B.json`, `reconcile/`, `../tools/` | the two miners agree on 100/100 checks. `ground-truth.json` reproduces exactly except its timestamp |
| Feature ranking | `feature-ranking.{md,json}`, `feature-loops.json`, `feature-selfresume.json` | attention queue ≫ away digest ≈ loop-aware rows ≫ spend burn, batch approve |
| Chat benchmark | `benchmark.md` | bar B1–B8 against Raycast and Warp, plus 41 gaps with file:line |
| Surface map | `surface-map.md` | 7 surfaces, IPC, timers, tmux failure modes |
| Fleet docs | `fleet.md`, `fleet-states.md`, `raw/`, `panes/` | the registry is the reliable signal; 5 of 25 dialogs had their tool_use record withheld |
| Baseline | `baseline/` (`notes.md`, `canon.json`, shots, `watch/`), `canon/` | 15 mismatches, M1–M15 |
| TTA before | `tta-before.{md,json}`, `tta-before/` | 23 trials across 6 block kinds. `tta.js --report` regenerates the same summary |
| Audit | `audit/`: `canon-asfound/`, `canon-tip/`, `smoke/`, `privacy-text.json`, `privacy-png.json` | this audit's own runs |
| Privacy check | `../tools/privacy/run.sh` | text shingles plus local OCR. Prints counts and paths only |

## How to use it

```sh
cd ~/.vibepet-ultra/int
npm test                                                # unit gate, ~3 s
node test/fleet/fleet.js status                          # each member: truth, verdict, spend
node test/fleet/fleet.js spend --note "why"              # appends to docs/ultra/fleet-spend.jsonl
node test/fleet/fleet.js rearm <member...>               # back into state (a turn costs money; refuses at est. $4.50)
node test/ultra/canon.js --app <worktree> --out <dir>    # all 7 surfaces, ~30 s, $0 (stub chat engine)
node test/ultra/canon.js --compare <runA> <runB>
node test/ultra/watch.js --app <worktree> --out <dir> --secs 300
node test/ultra/tta.js ...                               # exact "after" commands: tta-before.md, "Rerun"
~/projects/vibepet/docs/ultra/tools/privacy/run.sh <out dir>   # run before anyone reads new evidence
```

**Fix worktrees.** Create one with `git -C ~/projects/vibepet worktree add ~/.vibepet-ultra/wt/rN-<id> -b ultra/rN/<id> ultra/round-N`, then symlink `node_modules` to `~/.vibepet-ultra/int/node_modules`.

**Before any capture, arm what it needs:**
- delta: within 90 s of the capture;
- vibepet: within 5 min;
- atlas: re-arm when its 9-min build ends.

A fresh pet shows no row for a member whose tool_use record Claude Code withheld. Both standing dialogs are in that state right now (see the as-found run in Audit below).

## Headline numbers

**Ground truth** (the user's 356 sessions, snapshot 2026-10-01 20:00Z):
- **Sessions at once:**
  - live sessions per live minute: median 1, p90 4, max 10;
  - daily peak: median 3, p90 7;
  - 2 or more sessions live in 48% of minutes over the last 30 d;
  - rising: the last 10 daily peaks ran 4 → 10.
- **TTA (north star):** a+b+c blocks, censored at 2 h, n = 380.
  - median **122 s**, p90 **1,647 s**;
  - last 30 d: 181 s / 2,035 s.
- **Present or away:** 60% of waiting happens while the user is present, 38.5% while they type into other sessions. That share is a detection problem the pet can solve.

**TTA before** (the shipped pet against the live fleet): **nothing resolves from the pet on tmux.** Approve and Reply fail ("couldn't find its tab"), and Jump fails on every row.

| block | detect | resolvable from the pet |
|---|---|---|
| approval | none within 240 s in 2/3 trials (record withheld); 92.4 s otherwise | no |
| AskUserQuestion | none in 2/3; 92.7 s, and it offers Approve (the wrong action) | no |
| question at end of turn | **1.3 s** | no |
| done | **2.3 s** | no (a done row has no Reply) |
| /loop fire stalled on approval | none in 5/7; 91–101 s | no |
| subagent blocked | never within 300 s | no |

**Audit:**
- **Guard:** it refuses roots outside `~/.vibepet-ultra`. It now also refuses non-fleet registry files (fixed here: `315952c`).
- **Canon on the tip:** 26/26 with a fresh done row.
- **Canon as found:** 20/22. Home showed **0 rows** while kestrel and beacon needed the user and vibepet was done.
- **Privacy:** no real-transcript prose in the evidence; every screenshot shows only fleet members (OCR of 353 PNGs, 7 viewed).

**Fleet spend:** $1.73 in transcripts, **$2.57 estimated** with hidden calls, of the $5 cap. The guard refuses at $4.50, which leaves **$1.93**.
