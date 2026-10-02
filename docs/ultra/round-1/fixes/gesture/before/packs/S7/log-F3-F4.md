## F3 — summon gesture: recognized? right action? latency? false positives?

**Supported gesture (gesture.js):**
- One user-trained unistroke shape, 3 samples on the pad, matched with a $1 recognizer against the global cursor stream.
- A looped scribble is compared by its first loop.
- Gate: at least 90 px on the long side, at least 35 px on the short side, path at least 1.6× the box diagonal, at most 3.5 s, starts above 260 px/s, ends after 160 ms still.
- Sensitivity: Low 0.88 / Medium 0.85 (default) / High 0.825.
- Action: toggle. Visible Net hides; hidden Net appears at the stroke's end. 2.5 s lockout after any toggle.
- The trained shape here was a clockwise circle (F4).

**Recognition** (strokes over/around Net; Medium unless noted; load 2.55–3.90):

| stroke | toggled / tries | expected | result |
|---|---|---|---|
| clockwise circle r=110 px, 0.6 s (Net visible) | 3/3 hide; median 200 ms to hide, window gone at 461 ms (shot 15) | hide | PASS |
| same circle (Net hidden) | 3/3 summon at the stroke end; median 202 ms (shot 16) | summon | PASS |
| triple loop clockwise, 1.5 s | 2/2 | match | PASS |
| 2:1 ellipse clockwise | 2/2 | match (same shape, sloppy) | PASS |
| circle at 2.4 s / 4 s | 2/2 / 0/1 | match / no (over 3.5 s) | PASS |
| small circle r=40 (80 px) | 0/2 | no (below the size gate) | PASS, but no hint |
| **counter-clockwise circle** | **0/3** | a circle is a circle; nothing told the user to keep a direction | FAIL |
| Z, zig-zag, straight line, diagonal, L, back-and-forth wiggle, U arc, figure-8 | 0/1–0/2 each | no | PASS |
| **square** 180 px, 0.8 s | **3/3 hide** at Medium; 0/2 at Low (Low still matched circles 2/2 and the ellipse 1/1) | no | FAIL (false positive at the default) |

**False positives while using the pet:**
- **Dragging Net in a loop** (mouse held on Net, 0.9 s): **4/4 hid him** about 198 ms after release: two closed loops, one 0.85-turn loop and one 0.8-turn loop (shots 20 → 21 → 22). Loop drags that end in a straight 140 px run: 0/3 (shot 17). The watcher ignores the mouse button, so any looping drag counts.
- **Clicking Net:** no stroke, no toggle (Home opens as designed).
- **Circle over an open Home panel:** hides Net and closes Home (1/1). A typed draft ("draft: ask kestrel why") survived the hide and summon (shots 18, 19).
- **Summon within the lockout:** re-summon strokes ending 1.35 s and 1.73 s after a gesture hide were ignored silently (Net stayed hidden). One ending at 2.73 s worked.

## F4 — gesture teaching (sample / redo / cancel)

Path: Net → Home → ⋯ → Settings → Gesture → "Record gesture…" (load 1.67–1.75).

| step | expected | actual | result |
|---|---|---|---|
| open the pad | pad + instructions | menu up 43 ms after ⋯, pad 14 ms after the item. "Draw your gesture 3 times on the pad." Redo last disabled (shot 08) | PASS |
| sample 1 (circle) | count down, preview | "Nice — 2 more, same shape." with preview 1 (shot 09), ≤3 ms after release | PASS |
| Redo last | drops the sample | previews cleared, text back to the start (19 ms; shot 10) | PASS |
| a tiny flick | refused, with a hint | "That was tiny — draw it a little bigger." (shot 11) | PASS |
| circle, circle, Z | keep the two that agree | "Two of those match — once more like those." (shot 12) | PASS |
| one more circle | saved, gesture on | "Saved. Hide Net, then move the mouse in that shape to bring him back." 3 previews; closes by itself (2.8 s timer). State: on, Medium, 3 templates; watcher polling (shot 13) | PASS. The copy only mentions bringing him back; the first use hid him |
| Record a new gesture… → 1 sample → Cancel | pad closes; old gesture kept | closed in 25 ms; the same 3 templates; watcher paused while recording, resumed after (shot 14) | PASS |
| Record a new gesture… → 2 samples → Esc | same | closed; old gesture kept; watcher resumed | PASS |

## Exploration (a person running 5–15 sessions)
