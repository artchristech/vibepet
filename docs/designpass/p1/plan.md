# p1 plan: top 6 fixes, ranked by expected lift ÷ effort

Baseline 60.51. The five axis owners proposed 15 fixes. This plan keeps six of them after merging the overlaps; the rest are under Deferred.

## 1. Static, legible antenna LED; one pulse per change
- **Axis:** status-signalling (also idle-cost)
- **States:** 01, 05-11
- **Where:** `renderer/app.js:179-184`, plus new `lastSig`/`haloUntil` next to `:93`.
- **What changes:**
  - Remove the 2 Hz stalled blink (`:181`) and the working sine (`:182`).
  - Drop the white 1×1 and the 35% wash (`:184`).
  - The new bulb is a 4×4 with an OUT ring around a 2×2 core (8 screen px) at full saturation. Colours: needs `#ffcf3f`, stuck `#ff5c6c`, running `#3fe08f`, none `#59607a`.
  - When the resolved signal changes, one 500 ms decaying halo plays. It never repeats while the signal holds and is skipped under reduced motion.
- **Conflict:** the proposed top-left white highlight is dropped. On a 2×2 core it is 25% of the signal and brings back the pinkish wash.

## 2. The face carries agent state with Animations off; steady states are static
- **Axes:** sprite-and-idle + status-signalling
- **States:** 05-11, 09
- **Merged from:** status fix #2, sprite fix #1, and the static-sleep part of sprite fix #2. All three edit the same `app.js:100` override.
- **Where:** `renderer/app.js:71-80` (`baseState`), `:100`, `:112-122`, `:194`, `:197`, `:201-224`, `:227`, `:237`.
- **What changes:**
  - `st` keeps its semantic value. A `moving` flag (Animations on, or exiting) gates bob/squash, sleep breathing, blink, laptop and typing.
  - `waiting` persists after the 8 s alert window and outranks stalled (needs > stuck > running).
  - Working: eyes down with a flat focused mouth, and no laptop when still.
  - Needs-input: eyes track the cursor as tall 2×4 pupils with a catchlight, a small "o" mouth, and a static amber "!" (the 3 Hz flicker at `:237` is removed).
  - Stuck: worried eyes, wavy mouth and a static "?".
  - Sleeping: no gaze, closed ∪ eyes, no breathing.
- **Conflict:** needs-input eyes "look up" (status owner) vs "on the cursor" (sprite owner). Resolved as **track the cursor**, because the rubric says "looking at you". The eyes use sprite's symmetric 2×4 instead of the asymmetric 3×4.

## 3. One-shape capsule morph; the resting shadow reads as a shadow
- **Axes:** reveal-and-hover-feel + restraint
- **States:** all, most visible in 01-04
- **Merged from:** reveal fixes #1 and #2, which both edit the same new `::before`.
- **Where:** `renderer/style.css:42-47`.
- **What changes:**
  - Remove the non-uniform `scale()` on `#hud`.
  - The fill moves to `#hud::before`, sized directly from `--p` (64×10 → the full box). It keeps radius = height/2, the same centre line and the same top edge at every p.
  - Fill alpha rides p (`.34 + .58p`). The box-shadow stays at 0 until p > .6.
  - `#hud` itself gets `pointer-events:none` and the `::before` gets `auto`, so the invisible layout box never becomes a click target. The ink stays equal to the hit area.

## 4. Idle cost: loops park when settled; cursor IPC only on change
- **Axis:** idle-cost (all states)
- **Where:** `main.js:384-389`; `renderer/app.js:250-251`, `:414-426`, `:318-319`.
- **What changes:**
  - Main process: send `cursor` only when the window-relative point changes. Poll every 16 ms while the cursor is near the window and moving, and every 100 ms otherwise.
  - Renderer: `draw()` computes a frame key and skips the repaint when nothing changed.
  - Both loops drop from rAF to a 10 Hz check once settled. `wake()` from the cursor/tick/event feeds resumes rAF at once.
- **Conflict:** the owner proposed stopping the loops entirely. They park to a 10 Hz key check instead, for two reasons: capture freezes the cursor/tick IPC, and state scripts mutate globals directly, so a fully stopped loop would never see them. The real app also wakes instantly through IPC.

## 5. A routine finish is one quiet channel; amber and sound are for needs-you
- **Axis:** interruptions-and-bubbles
- **States:** 10, 11
- **Where:** `main.js:83`, `main.js:163-170`; `renderer/app.js:332-333`.
- **What changes:**
  - agentDone:
    - Shows the bubble "`name` is done" for 4 s, with no alert styling and no tune.
    - Sends the OS banner only when the window is hidden or the user has been idle for more than 60 s. The banner is silent and reads "`who` done".
  - agentStalled:
    - Shows "`name` needs approval" with the amber alert and the short tune.
    - Sends an OS banner only when the user is away.
- `states.json` 10/11 are re-staged with the new main.js copy, so the staged event mirrors what the app emits.

## 6. Remove the nag and the pet-initiated copy reachable in default mode
- **Axis:** restraint-and-footprint (all default states)
- **Where:** `main.js:244,252-256`; `renderer/app.js:324-327`, `:466`, `:499`, `:339`.
- **What changes:**
  - Delete the 1-5 am "one more commit, then sleep?" emit.
  - The launch greeting speaks only when an agent is waiting.
  - The poke stats line appears only in Game mode.
  - After a copy, the button label changes and no bubble appears.

## Deferred
- **Intent gate: proximity capped at 0.22, plus aim ×2 frames and a 300 ms dwell** (reveal fix #3). The recipe is medium effort and moves only 02 and 04. It also interacts with fix 4's parking. It belongs in the next pass.
- **Split "ready" from "needs input" in `classify()` and add a `06b-ready` state** (status fix #3). This adds a captured state, which breaks the within-pass before/after comparability, and it needs a main.js heuristic on '?'. Next pass.
- **Bubble restyle in the pill language** (interruptions fix #2). This is CSS only and cheap, but it is outside the top 6. It is the first candidate for p2.
- **Chat clipping: copy button padding, `scrollIntoView`, one-row chips** (interruptions fix #3). It moves 12-14 only.
- **Integer 3× scale to shrink the resting ink** (restraint fix #3). It needs the hit-test, gaze and zone math re-derived. The risk is high relative to one pass.
- **Cosmetics collision: crown, headphones, laptop** (sprite fix #3). It moves only state 15, which is opt-in.
- **Drowsy wind-down state at 5-15 min** (the rest of sprite fix #2). No state is staged for it, so it can't move a score this pass.
