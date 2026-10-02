# vibepet ultra — scoring rubric (fixed for all rounds)

The user: one person running 5–15 Claude Code sessions at once. The question every surface answers: what needs me, in what order, and can I deal with it without leaving the pet?

## Surfaces

| id | surface |
|---|---|
| S1 | Net Home panel (the one-click panel: Now list, Setup card, localhost + recording sections) |
| S2 | Chat |
| S3 | Command bar |
| S4 | Row actions: jump / approve / reply / replay / goal / done |
| S5 | Theater replay |
| S6 | Ports / localhost |
| S7 | Gestures + global jump key |

## Axes (each 0–100)

Score from the evidence pack: screenshots, the flow log, measured timings, and the fleet's ground truth (`fleet status`, transcripts). Don't award points for things the pack doesn't show.

**Correctness.** Does the surface tell the truth about the fleet, and does each action do exactly what it says?
- 95: every fact shown matches the fleet (state, ask text, ages, counts). Every action works. Failures explain themselves.
- 85: one cosmetic inaccuracy. No wrong state, no broken action.
- 70: one member shown in the wrong state, or one action that fails but says so.
- 50: several wrong states, or an action that fails silently or does the wrong thing.
- 30: the core flow is broken.

**Speed.** Measured latency, not perceived.
- 95: a block surfaces ≤ 3 s after it starts. Actions land ≤ 1 s. Panels open ≤ 150 ms. Chat's first token ≤ 1.5 s.
- 85: within 2× of those.
- 70: within 5×.
- 50: detection takes ≥ 30 s, or an action takes ≥ 5 s.
- 30: detection takes ≥ 90 s, or there are timeouts.

**Clarity.** With 10 sessions running, can I tell at a glance what needs me, in what order, and why?
- 95: the needs-me items lead, ordered by urgency, with the exact ask in plain words. Labels are consistent and legible at a glance.
- 85: one hierarchy or copy flaw.
- 70: I have to read every row to find what needs me.
- 50: misleading labels or jargon, or blocked work hides among idle work.
- 30: illegible or contradictory.

**Agency.** Can I act without leaving the pet?
- 95: every block resolves from the surface in ≤ 2 clicks or keys (approve, deny, answer, reply, stop, jump), batched where it makes sense. Works for tmux and GUI terminals.
- 85: one common case needs a jump to the terminal.
- 70: most cases need a jump.
- 50: actions exist but fail for common setups such as tmux.
- 30: view-only.

**Delight.** Craft and character.
- 95: it feels like a pet, not a dashboard. Restrained motion, crisp pixel craft, copy with personality, and at least one "oh, nice" moment.
- 85: polished, with one rough edge.
- 70: competent but generic.
- 50: visual bugs, jank, or noise.
- 30: broken rendering.

## Scores

- Surface score = the mean of the five axes for one rater. The round's surface score = the mean of raters A and B.
- Disagreement on surface s: `d_s = |A_s − B_s|`.
- Round-over-round delta: from round 2 on, raters score the previous pack and the current pack side by side as Variant X / Variant Y, in an order they don't know. `Δ_s = mean(current) − mean(previous re-scored)`. The delta counts only if `|Δ_s| > 2 × max(d_s(current), d_s(previous re-scored), 1)`. Otherwise it is recorded as 0.
- Round gain = the mean over surfaces of counted Δ_s.
- Stop when every surface's round score is ≥ 85, or when two consecutive rounds each gain < 2 points.

## Blindness

Raters see only the surface name and the evidence packs. They don't see the round number, branch names, fix lists, bug-ledger status, the other rater's scores, or earlier scores. Each rater works alone.

## Evidence pack (per surface, per round)

`docs/ultra/round-N/packs/<S#>/`:
- `log.md`: each flow run (steps, expected, actual, pass/fail), with the fleet member and its true state at the time.
- `timings.json`: `[{flow, step, ms, n}]`. Measured, with the median and n for repeated steps.
- `shots/*.png`: named `NN-<flow>-<step>.png`.
