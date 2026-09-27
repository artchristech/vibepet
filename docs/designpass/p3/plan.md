# p3 plan: top 6 by lift ÷ effort

Builds on p2 (81.31). The owners sent 15 proposals. One conflict is merged: the status and bubbles axes both proposed "stuck = red", so it ships once as fix 5. The chat max-height raise (290→320) depends on the deferred head-anchor fix reclaiming 46px (the stack is already 530/520), so it is dropped from fix 2.

| # | Fix | Where | States | Axis | Est. lift | Effort |
|---|---|---|---|---|---|---|
| 1 | No-key chat collapses to one row: hide #msgs, #chips and #chatForm while #keyForm is shown | renderer/style.css:95 (new rule after .inline-form p) | 14 | restraint-and-footprint | 70→~82 | 1 line |
| 2 | No clipped content in chat: flex:none on chrome rows, a top fade mask on #msgs, and a pet reply scrolls to its own start | renderer/style.css:73, :75, :85, :90; renderer/app.js:544 | 13, 12, 14 | interruptions-and-bubbles | 13: 66→~86 | 5 lines |
| 3 | Pill tucks under the feet: canvas above the hud (z-index), capsule top edge slides down 8px with p, hit zone +8 | renderer/style.css:20, :46, :50; renderer/app.js:421 (zoneRect b) | 01–04, every resting shadow | reveal-and-hover-feel | +4 | 4 lines |
| 4 | One fill across the morph: front-loaded alpha ramp, so the half state is already charcoal | renderer/style.css:52 | 01–04 | reveal-and-hover-feel | +3 | 1 line |
| 5 | Stuck uses one red everywhere: agentStalled gets alert:'stuck', #bubble.stuck ring and dot use --red, and the '?' glyph uses LED.stuck | renderer/app.js:261, :293, :363-364; renderer/style.css:38 | 11, 07 | status-signalling + interruptions-and-bubbles | 11: 82→~89, 07: 86→88 | 5 lines |
| 6 | De-collide Game-mode accessories: crown perches above the headphone band; laptop drops to cy+5 with a 5-row lid, so the mouth stays visible while working | renderer/app.js:217, :240, :250-257 | 15 | sprite-and-idle | 62→~82 | 8 lines |

## Verification
- `node --check main.js renderer/app.js`
- Recapture to `p3/after/`. Launching is the test, then check the sheet: the pill clears the feet in 01–04, 02 matches 03's fill, 11's ring is red, 13 has no sliced chip row, 14 is one row, and in 15 the crown and band are separate and the mouth shows.

## Deferred
- Chat narrowed to 272px (restraint, 12/13): cheap, but re-wrapping lengthens the 13 transcript. Take it after fix 2 proves the no-clip layout.
- Anchor bubble and chat to the head, -46px plus a chat tail (bubbles, 10–14): it changes the whole vertical stack and needs a recapture on its own. It also unlocks the chat max-height raise.
- Pencil as the primary control, concentric padding, no separator, 40px offset (reveal, 03/04): a larger geometry change that interacts with fix 3's pill placement. Next pass.
- Winner LED 5x5 and pips 4x4 (status, 08): shifts the antenna geometry and the halo. Next pass.
- Static '…' glyph for running (status, 05).
- Drowsy wind-down frame at 5 min (sprite, 01/09): a new state that can't be captured without states.json staging.
- Sleeping pose, dimmed LED and 2x1 mouth (sprite, 09).
- Suspend/close the AudioContext when idle (idle-cost memory).
