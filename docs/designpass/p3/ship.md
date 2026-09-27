# p3 ship

`node --check main.js renderer/app.js` passes. The recapture launched and captured 15/15 states. Idle is 0.1% CPU at 322 MB (p2 was 298 MB; the AudioContext fix is deferred).

| # | Fix | Status | Files | Why |
|---|---|---|---|---|
| 1 | No-key chat collapses to one row | done | renderer/style.css (end) | The sibling rule hides #msgs, #chips and #chatForm while #keyForm is shown. 14 is now the head, explainer and one input row. |
| 2 | No clipped content in chat | done (partial) | renderer/style.css (.chat-head, #chips, #chatForm flex:none; #msgs.fade mask), renderer/app.js (addMsg scroll, msgs scroll listener) | The chip row no longer slices, and a pet reply opens at its first line. The fade mask applies only when the log is scrolled, so an unscrolled greeting isn't dimmed. The max-height raise (290→320) is skipped because it depends on the deferred head-anchor fix. |
| 3 | Pill tucks under the feet | done | renderer/style.css (#pet z1, #hud z0 / .live z2, padding-bottom +8, ::before top 8px·p, children translateY 8px·p) | The resting shadow paints under the feet and the open pill clears them by about 4px. #hud.live goes to z-index 2 so the buttons stay clickable above the canvas's transparent bottom. zoneRect picks up the +8 through offsetHeight, so there is no JS change. |
| 4 | One fill across the morph | done | renderer/style.css (#hud::before background) | Alpha is .46 at rest and saturates at p .4, so 02 reads as the same charcoal capsule. |
| 5 | Stuck uses one red everywhere | done | renderer/app.js (agentStalled split, show() className, '?' glyph uses LED.stuck), renderer/style.css (#bubble.alert.stuck) | In 11 the bubble ring and dot are now red, matching the LED and glyph. agentStalled no longer plays the needs-you tune. |
| 6 | De-collide Game-mode accessories | done | renderer/app.js (crown at cx-12, top-6; mouth always drawn when working; laptop ly0 cy+5 with 5-row lid) | In 15 the crown now perches on the band clear of the antenna, and the mouth shows above the lid. Watch item: the mouth row sits directly on the lid's top edge. |
