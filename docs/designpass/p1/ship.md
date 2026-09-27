# p1 ship log

**Verification**
- `node --check main.js renderer/app.js` passes.
- The recapture launched cleanly: 15/15 states ok, exit 0.
- `userDataSeenByApp` is a temp dir.
- Idle CPU went from 2.7% to 0.2%. Memory went from 310 MB to 323 MB.
- A hit-test probe was run with a temp userData at p=0. The shadow centre resolves to `#hud`. The invisible corner of the layout box resolves to `#stage`, so click-through matches the ink.

| # | Fix | Status | Files | Why |
|---|---|---|---|---|
| 1 | Static LED, one halo per change | done | renderer/app.js | The blink and pulse are gone. There is a 2×2 saturated core in a 4×4 ink bulb, and a 500 ms halo plays only when the resolved signal changes. |
| 2 | Face carries state with Animations off | done | renderer/app.js | `st` is no longer flattened to 'still'. A `moving` flag gates all motion. waiting persists and outranks stalled. Faces: working (eyes down, flat mouth), needs (2×4 eyes, "o" mouth, static !), stuck (existing face + ?), sleeping (static, closed ∪ eyes, no gaze). |
| 3 | One-shape capsule morph with soft resting shadow | done | renderer/style.css | The fill moved to `#hud::before`, sized from p, with radius = h/2 at every step. Alpha is .34 + .58p. The box-shadow only appears above p = .6. `#hud` is pointer-events:none so only the ink is hittable. |
| 4 | Idle cost: loops park, cursor IPC on change | done | main.js, renderer/app.js | Cursor is sent only on change, at 16 ms near the window while moving and 100 ms otherwise. draw() skips unchanged frames. Both loops park to a 10 Hz check, and wake() comes from the cursor/tick/event feeds and mousemove. |
| 5 | Quiet routine finish | done | main.js, renderer/app.js, docs/designpass/states.json | "name is done" shows as a non-alert bubble with no tune. The OS banner is silent and fires only when the window is hidden or the user has been idle more than 60 s. Stalled shows "name needs approval" with amber and a tune, and a banner only when away. states.json 10/11 were re-staged with the new main.js copy. |
| 6 | Remove the nag and the pet-initiated copy | done | main.js, renderer/app.js | The 1-5 am night emit is deleted. The launch greeting fires only when an agent is waiting. The poke stats line is Game-mode only. Copy no longer triggers a bubble. |

## Notes for the next pass
- **10-bubble-done is inconsistent.** It shows the quiet "is done" bubble, but the face and LED show needs-input (amber, !). The app still classifies end_turn as `waiting`. The deferred ready/needs split (status fix #3) resolves this.
- **The bubble still uses the old white/amber hard-shadow style.** The restyle is deferred, and it is the cheapest win for p2.
