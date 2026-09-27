# p2 plan: top 6 fixes, ranked by expected lift ÷ effort

Baseline is p1/after (75.18). The five axis owners proposed 15 fixes. The six below merge the ones that edit the same lines. The rest are under Deferred.

## 1. Drop GPU compositing so idle memory fits under the cap
- **Axis:** idle-cost (applies to all 15 states), restraint-and-footprint
- **Where:** `main.js:12`, before `app.whenReady` at `:447`.
- **Change:** add `app.disableHardwareAcceleration()`. The window is a 224×208 pixelated canvas plus one CSS capsule, so the GPU process costs memory and gives nothing back.
- **Expected:** `metrics.json` memMB goes from 323 to ≤300, and CPU stays ≤1%.
- **Why first:** one line of code, and the lift lands on all 15 states.

## 2. Bubble joins the pill's language as a dark capsule
- **Axes:** interruptions-and-bubbles, restraint-and-footprint
- **States:** 10-bubble-done, 11-bubble-stalled
- **Where:** `renderer/style.css:24-38`.
- **Change:**
  - Fill is rgba(18,18,20,.92) with `--text` colour, no border, no hard offset shadow, and a soft `0 2px 10px` shadow.
  - Type is 11px/500.
  - A 160 ms opacity + 4px rise replaces the steps(3) scale pop.
  - The tail is an 8×5 triangle in the same fill.
  - Alert keeps the dark capsule and adds a 6px amber dot and a 1px inset amber ring, so there is no amber slab.
- **Conflict resolved:** the owner asked for `nowrap` + ellipsis and a 999px radius. A poke that lists several agents joins them with `\n`, and nowrap would truncate those lines. Resolution: radius 14px, which is at least h/2 of a one-line bubble so a single line still reads as a capsule; `pre-line` is kept; max-width is 300px.

## 3. Chat panel in the pill's language, sized to its content
- **Axes:** interruptions-and-bubbles, restraint-and-footprint
- **States:** 12-chat, 13-chat-convo, 14-chat-nokey
- **Merged from:** interruptions #2, interruptions #3 and restraint #1. They are the same component and the same `style.css:66-91` block.
- **Where:** `renderer/style.css:66-91`, `renderer/index.html:18,27-30`, `renderer/app.js:508,533-536`.
- **Change:**
  - The panel is the pill fill with a 16px radius and a soft shadow, and no ink border or offset shadow.
  - `max-height: 290px` with `#msgs {flex: 0 1 auto; min-height: 0}`, so the panel sizes to its content.
  - Chips have no emoji, sit on one row with no wrap, and are pill-shaped.
  - The copy button sits in its own 22px strip above the code, so it no longer covers text.
  - The empty state is fixed and useful, and includes an honest trust line.
  - The no-key copy is one short sentence; the env hint moves to the tooltip.
- **Honesty correction:** the owner's line "only what you send here leaves your machine" is false. Chat also sends repo context, the diff and the agent transcript (`main.js:304-323`). The copy now says "chat sends your message + repo context to Anthropic".
- **States.json:** 12, 13 and 14 were pre-seeding "what's up?". They now just call `openChat()`, so the real empty state is what gets captured.

## 4. Split "ready" (finished, unread) from "needs input"
- **Axis:** status-signalling (also interruptions)
- **States:** 06-waiting, 08-agents-mixed, 10-bubble-done
- **Where:**
  - `main.js:125-126` (classify), `:165-172` (transition)
  - `renderer/app.js:71-85` (agentsIn, baseState, resolver, LED), `:251-253` (glyph slot), `:353` (event), `:384` (chip), `:444-445` (hover marks seen), `:481` (poke marks seen)
  - `docs/designpass/states.json` 10
- **Change:**
  - An end_turn whose text ends in `?` is `waiting`. Any other end_turn is `ready`.
  - `working|stalled → ready` fires the quiet `agentDone`. `→ waiting` fires `agentNeeds`, which is an alert bubble and a banner only when away.
  - The resolver order is needs > stuck > ready > running.
  - Ready shows a mint LED `#9ff5d6`, the content idle face and a static mint tick glyph.
  - Ready clears the first time the pet is hovered or clicked after its `since` (`seenReady` set).

## 5. Intent-gated reveal with a 500 ms close grace
- **Axis:** reveal-and-hover-feel (also restraint)
- **States:** 01, 02-hud-half, 03, 04-hud-aim (04 must stay fully open)
- **Merged from:** reveal #1 and #2. Both rewrite `hudTarget`.
- **Where:** `renderer/app.js:403-433`.
- **Change:**
  - Distance alone only raises the pill to a micro-acknowledgement, `0.25·(1−smooth)`. At that level the shadow widens and there are no icons.
  - The pill opens fully in any of these cases:
    - the cursor is inside the zone or on the pet's ink;
    - the TTA aim projection hits on 2 or more consecutive cursor samples (`aimHits`);
    - hoverIntent: the cursor is within 2·NEAR and moves less than 6 px over 100 ms, or dwells there for 300 ms.
  - The pass-by veto, the heading-away damping and the hysteresis are kept.
  - `GRACE` goes from 200 to 500.
- **Conflict resolved:** the safe polygon is skipped as redundant. The zone is the bounding rectangle of body + pill, which is convex, so every body→⋯ path already stays inside it (d = 0). A triangle hold capped at GRACE is also strictly weaker than the unconditional 500 ms grace.

## 6. LED tells the whole agent picture: calm idle, unlit sleep, priority pips
- **Axes:** status-signalling, sprite-and-idle
- **States:** 01, 08-agents-mixed, 09-sleeping (02-04 and 12-14 share the idle LED)
- **Merged from:** status #2 (pips), status #3 and the LED half of sprite #1. All three edit `app.js:85,200-201`.
- **Change:**
  - `LED.none` becomes `#8a93b8`, a calm lit neutral.
  - When sleeping with no signal, the core is skipped so the bulb is unlit.
  - Every non-winning agent signal (up to 3) is drawn as a static 3×3 ink pip with a 1×1 colour core. The pips step left from the bulb in priority order.
  - Only the winner changing plays the halo. The pips are in the repaint key and never animate.
- **Conflict resolved:** sprite wanted a dim `#3a3f55` core for sleep, status wanted it unlit. Unlit was chosen because `#3a3f55` next to OUT is indistinguishable at 1×.
- **Pip size:** pips are 3×3 rather than 2×2+outline, because the outlined version would be the same 4×4 as the bulb and would lose the big-vs-small read.

## Deferred
- **Concentric pill geometry and dominant primary** (reveal #3, `style.css:45,59,63`, `index.html:39-40`): cheap and +4-6 on 03/04. First in line for p3.
- **Opt-in cosmetics off the face** (sprite #3, `app.js:192-194,209,242-248`): only moves 15-game-anim-on, an opt-in state.
- **Drowsy wind-down stage** (sprite #2): adds a new state and a new capture. Research #9 says to gate it behind Animations, which conflicts with the owner's always-on held frame. Revisit it with that gate.
- **Sleep emitters gated behind Animations** (the emitter half of sprite #1): already a no-op. `spawn()` returns early when `!snap.animations` (`app.js:47`), so no particles and no rAF loop.
- **Settings menu relabel and grouping** (restraint #3, `main.js:416-443`): not captured. "hunger" is still accurate in Game mode, where fuel decays (`main.js:48`, `app.js:78`). The trust line lands in the chat empty state instead (fix 3).
