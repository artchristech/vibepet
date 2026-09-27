# p2 ship log

**Verification**
- `node --check main.js renderer/app.js` passes.
- The recapture launched cleanly: 15/15 states ok, exit 0.
- `userDataSeenByApp` is a temp dir.
- Idle cost is 0.2% CPU and 298 MB, down from 323 MB.
- The contact sheet looks right: every state is distinct and none are blank.

| # | Fix | Status | Files | Why |
|---|---|---|---|---|
| 1 | GPU compositing off | done | main.js | `app.disableHardwareAcceleration()` takes idle memory from 323 MB to 298 MB, under the 300 MB cap but not under 250. CPU is unchanged at 0.2%, and the transparent window still renders. |
| 2 | Bubble as a dark capsule | done | renderer/style.css | It uses the pill fill, a soft shadow, 11px/500 type, an opacity + 4px rise and a small tail. Alert is the same capsule with an amber dot and a 1px amber ring, with no amber slab. The radius is 14px with `pre-line` rather than nowrap, so a multi-agent poke isn't truncated. |
| 3 | Chat panel in the pill's language, sized to its content | done | renderer/style.css, renderer/index.html, renderer/app.js, docs/designpass/states.json | 16px radius in the pill fill, with no ink border or offset shadow. The panel is capped at 290px and otherwise sized to its content. Chips sit on one row with no emoji. The copy button has its own strip above the code. The empty state is fixed, with an honest trust line ("chat sends your message + repo context to Anthropic"). The no-key copy is one sentence, and the env hint is in a tooltip. States 12, 13 and 14 no longer pre-seed "what's up?". |
| 4 | Ready vs needs-input split | done | main.js, renderer/app.js, docs/designpass/states.json | An end_turn ending in `?` is `waiting`; any other end_turn is `ready`. `ready` fires the quiet `agentDone`. `waiting` fires `agentNeeds`, which gives an alert bubble and a banner only when away. The resolver order is needs > stuck > ready > running. Ready shows a mint LED, the content face and a static mint tick, and clears on the first hover or click (`seenReady`). State 10 is re-staged as `ready`. |
| 5 | Intent-gated reveal + 500 ms grace | done | renderer/app.js, docs/designpass/states.json (prelude resets aimHits/still/nearSince) | Distance alone only raises the pill to 0.25, a wider shadow with no icons. It opens fully in the zone, on 2+ aim samples, or on hoverIntent (<6px over 100ms, or a 300ms dwell within 2·NEAR). GRACE is 500. In the captures, 02 is now a slightly grown shadow, and 04 opens fully before arrival. The safe polygon was skipped as redundant because the zone is convex. |
| 6 | LED: calm idle, unlit sleep, priority pips | done | renderer/app.js | Idle is `#8a93b8`, lit and neutral. Sleeping with no signal skips the core. Non-winning agents get static 3×3 pips (1×1 core) stepping left from the bulb. The pips are in the repaint key and play no halo. In 08, the amber bulb has red and green pips beside it. |

## Notes for the next pass
- **13-chat-convo:** the panel hits its 290px cap, so the greeting scrolls off the top. This is expected, but the trust line isn't visible there.
- **Next cheapest win:** concentric pill geometry with a dominant chat button (Deferred #1). 03 and 04 still show `edit | ⋯` with a separator.
