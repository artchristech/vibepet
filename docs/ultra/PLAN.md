# vibepet ultra — orchestration plan (orchestrator's working notes)

Paths: REPO=~/projects/vibepet (stays on main, untouched) · ULTRA=~/.vibepet-ultra (int worktree, wt/*, fleet/*, root/.claude isolated watch root, userdata/*) · EVID=REPO/docs/ultra (untracked evidence).

Branches: ultra/r0-harness + ultra/r0-fleet → ultra/round-0 (ULTRA/int). Each round N: `git -C ULTRA/int switch -c ultra/round-N` from round N-1's tip; fix branches ultra/rN/<id> in ULTRA/wt/rN-<id> (node_modules → symlink ULTRA/int/node_modules); green ones merge into ultra/round-N. main is never touched.

## Status log
- R0 done (wf_e2fc5d7e-fc8, 5.4 h): ultra/round-0 @ 315952c; npm test 24/24 ~3 s; fleet est. spend $2.57 (guard $4.50). REPORT.md skeleton written by orchestrator (subagents are refused writing report files → ledger returns report_md; orchestrator writes it).
- R1 launched (wf_c7590f39-9cf) with spendStop 3.32; script = scratchpad/round.js (waves: wave 1 foundations → merge → wave 2).
- Revised sequence: feature sprint runs at the START of R2 on ultra/round-2 (branched from round-1), so R2's drive scores R1 fixes + features. Each round's score = code state at the start of that round; a final drive+score-only pass measures the last fixes.

## Sequence
1. R0 (wf_e2fc5d7e-fc8): ground truth (2 miners → reconcile → ranking), harness (npm test gate, VIBEPET_CLAUDE_DIR / VIBEPET_USER_DATA / VIBEPET_HOTKEY, playwright-core launch.js with privacy guard), fleet (6 Haiku tmux members: kestrel=approval, vibepet=done, atlas=working, beacon=AskUserQuestion, delta=fan-out, ember=/loop), surface map, chat benchmark, integrate + canon.js, TTA-before probe, audit + REPORT skeleton.
2. R1a: setup (round-1 branch, fleet leases) → pipeline per surface: driver → [critic, rater A, rater B] → triage (dedup, fix tasks + top fix for lowest surface) → pipeline fix → gate (blind regression judge) → serial merge (tests + canon) → ledger update.
3. R1b feature sprint (on ultra/round-1): Collision Radar; top-3 many-session features (from feature-ranking.md); chat bar (streaming TTFT<1.5s, no-key/offline/429 copy, history persistence, @session commands, claims-vs-jsonl). Each in its own worktree with fleet proofs (TTA before/after, clicks); merge → ultra/round-1.
4. R2..R5: same as R1a, raters pair-score previous vs current packs (blind X/Y). Stop: all surfaces ≥85, or two consecutive rounds gain <2.
5. Final: REPORT.md complete (ledger, score table, TTA before/after, features + proofs, branches), fleet down, spend total.

## Known facts (scouted)
- Claude Code registry ~/.claude/sessions/<pid>.json has status (idle|busy…), statusUpdatedAt, messagingSocketPath (peer protocol 1: notify_idle, reply_across_default_dirs, artifact_yield).
- agents.js: pending tool_use reads 'stalled' only after 90 s idle → TTA floor; 'parked' (end_turn idle > 5 min) dropped from list; AskUserQuestion shows as bare tool name.
- send-to/jump: GUI terminal .app ancestor + Accessibility + System Events keystrokes → nothing works for tmux-hosted sessions.
- chat: `claude -p --output-format json` non-streaming; API-key path non-streaming; history likely in-memory.
- npm test (node --test test/*.test.js) hung on main: content.test.js never finishes; gesture.test.js ~24 s.
- Error-state testing: fault injection at the network boundary is allowed (ANTHROPIC_BASE_URL → local 429 server, unreachable proxy for offline); session data is always the live fleet.
