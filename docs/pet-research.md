# vibepet — Pet Interaction & Visual Design Brief

Merged by Spock from three officers: Kirk (bold), Spock (rigorous), Scotty (pragmatic). Research date: 2026-09-27.
Scope: research only. Claims without a source URL are dropped or marked (unverified).

The one-line thesis: **the pet mirrors agent state from the periphery. It moves to the center only when a state change needs you, uses one continuous shape and critically damped motion, and never nags or guilts.**

---

## 1. Top principles (ranked by leverage for vibepet)

1. **Periphery by default, center on demand.** Status is ambient. Only a "needs you" transition pulls attention, and it does so once. The pet should take the smallest possible amount of attention.
   https://calmtech.com/papers/designing-calm-technology · https://people.csail.mit.edu/rudolph/Teaching/weiser.pdf · https://caseorganic.com/post/principles-of-calm-technology/
2. **The pet mirrors agent state; it is not a creature with needs.** Codex Pets are tied to the state of an agent thread and have no persistent internal state (per the third-party dev.to write-up, not OpenAI's docs). Four states in priority order: Needs input > Blocked > Ready (completed, unread) > Running.
   https://learn.chatgpt.com/docs/pets · https://dev.to/mikachu/i-built-a-better-codex-pet-than-openai-did-eib
3. **Steady states are static; only transitions move.** Peripheral motion (moticons) is detected better than colour or shape changes, but faster or more frequent motion raises distraction and irritation. Motion lasting more than 5 s needs a pause control (WCAG 2.2.2). Persistent states hold until the state changes, and one-shot reactions play once. (Note: Codex issue #28995 is NOT support for static steady states; it asks for persistent states to keep *looping* their animation. "Static" is a deliberate divergence from Codex, grounded in Bartram + WCAG + the no-nagging requirement.)
   https://interruptions.net/literature/Bartram-IJHCS03-BW.pdf · https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html
4. **Motion is interruptible and critically damped.** Start from damping 1.0. Use overshoot (about 0.8) only when a gesture carries momentum. Specify springs by response, not duration, and let retargets inherit velocity. Feedback must start within 100 ms.
   https://asciiwwdc.com/2018/sessions/803 · https://developer.apple.com/videos/play/wwdc2023/10158/ · https://www.nngroup.com/articles/response-times-3-important-limits/
5. **Predict intent from the cursor instead of fixed timers.** Use Amazon's menu-aim triangle, with dwell and hysteresis as the fallback. This is what makes the pet feel "intelligent".
   https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown · https://www.nngroup.com/articles/timing-exposing-content/
6. **One morphing container.** Dynamic Island grows the capsule that is already on screen (minimal, then compact, then expanded) rather than crossfading between two elements. Shadow to pill is the same idea.
   https://wwdcnotes.com/documentation/wwdc23-10194-design-dynamic-live-activities/ · https://appleinsider.com/articles/22/10/02/craig-federighi-alan-dye-talk-about-dynamic-islands-creation
7. **Interrupt only when acting beats waiting, and batch the rest.** Use Horvitz's mixed-initiative expected-value rule, deliver at breakpoints, and send one notification per event.
   https://erichorvitz.com/chi99horvitz.pdf · https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/CHI_2007_Iqbal_Horvitz-1.pdf · https://developers.apple.com/design/human-interface-guidelines/components/system-experiences/notifications/
8. **User control: the pet never initiates, and dismissal is trivial and remembered.** This is Clippy's core failure.
   https://xenon.stanford.edu/~lswartz/paperclip/paperclip.pdf · https://www.mentalfloss.com/article/504767/tragic-life-clippy-worlds-most-hated-virtual-assistant
9. **Idle is a slow descent to stillness, not a loop.** Follow the oneko chain.
   https://en.wikipedia.org/wiki/Neko_(software) · https://github.com/winebarrel/Neco
10. **Trust is the product.** A transcript-reading mascot must be visibly local-only. BonziBuddy was adware/spyware and drew a $75k FTC fine.
    https://en.wikipedia.org/wiki/BonziBuddy

---

## 2. Concrete patterns (with numbers)

### Hover / reveal
| Pattern | Numbers | Source |
|---|---|---|
| Acknowledge fast, commit on intent, hide with grace | ack <=100 ms; dwell 300-500 ms; close after >0.5 s outside both trigger and content | https://www.nngroup.com/articles/timing-exposing-content/ |
| Hover delay (e-commerce audit) | 300-500 ms; 60% of sites get it wrong | https://baymard.com/blog/dropdown-menu-flickering-issue |
| Menu-aim triangle (cursor to target's far corners); aiming skips the delay, leaving the triangle cancels instantly | jQuery-menu-aim: 3 tracked locations, 300 ms delay while aiming, 75 px tolerance | https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown · https://raw.githubusercontent.com/kamens/jQuery-menu-aim/master/jquery.menu-aim.js |
| Safe polygon / curved exit path (floating-ui, radix, ariakit) | — | https://mayank.co/blog/hover-triangles/ |
| hoverIntent fallback (cursor slowed below a threshold) | sensitivity 6 px (current default; 7 was an old release), poll 100 ms | https://briancherne.github.io/jquery-hoverIntent/ |
| Hysteresis and forgiveness padding | ~10 px hit padding; ~10 px movement before committing a direction | https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md |
| Fitts's law: primary target big and near; the invisible zone is bigger than the sprite | MT = a + b*log2(2D/W) | https://www.nngroup.com/articles/fitts-law/ |
| Proximity-proportional swell (Dock-like), not binary | ~1.8x max scale is an implementation example, not an Apple spec | https://dev48v.medium.com/i-rebuilt-the-macos-dock-magnify-effect-in-css-js-9fc2b9ec3b6a |
| Codex pet controls sit below the pet (reveal-on-pointer-over and hover-to-drag: unverified; docs only say the pet can be dragged) | 3 icons: pencil (new chat), bell (follow threads), voice | https://learn.chatgpt.com/docs/pets |

### Idle behaviour
- oneko chain: catch the cursor, then sit, groom, paw/scratch, yawn, sleep. Wakes on cursor movement. Activity only decreases over time. Step durations: (unverified). https://github.com/winebarrel/Neco
- Tie idle to time of day, not to user neglect ("sleeps on a day cycle"). https://github.com/superbereza/neko
- Borrow Shimeji's physics (fling, fall, land) but not its roaming or cloning. https://github.com/spyderweb47/Desktop-Virtual-buddy
- Per-behaviour frequency knobs: Shimeji frequency=0; Desktop Goose GooseAggression 1-3, HonkVolume, CanAttackMouse. https://github.com/TigerHix/shimeji-ee/blob/master/conf/behaviors.xml · https://www.gamesradar.com/untitled-goose-game-but-the-goose-wreaks-havoc-on-your-computer/

### Status signalling
- Four states with priority input > blocked > ready > running. "Ready" = completed with unread activity. When it clears is not documented (clears-on-view is an inference, unverified). https://learn.chatgpt.com/docs/pets
- Encode steady states in colour. Encode a transition as one brief motion, then hold. https://interruptions.net/literature/Bartram-IJHCS03-BW.pdf
- Ceilings: auto-started motion lasting >5 s needs pause/stop/hide (WCAG 2.2.2); never flash more than 3 times per second (WCAG 2.3.1, a separate criterion). https://www.w3.org/WAI/WCAG21/Understanding/pause-stop-hide.html · https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html
- Dangling String: activity maps to low-amplitude continuous motion ("a twitch every few seconds" when quiet). https://people.csail.mit.edu/rudolph/Teaching/weiser.pdf
- Treating persistent states as transient reactions ("three cycles... then the slowed idle loop") reads as broken: the pet looks idle while work runs. The issue's own fix is continuous looping; vibepet's fix is a held static colour. https://github.com/openai/codex/issues/28995
- The pet is the entry point: clicking an activity item opens that chat. Global toggle is Option+Space on macOS. https://learn.chatgpt.com/docs/pets · https://penchan.co/en/ai/coding/codex-pets/

### Notifications / interruptions
- Interruption cost: ~23 min average to resume interrupted work (the 23 min 15 s figure comes from a 2006 Gallup interview with Gloria Mark; her CHI 2005 "No Task Left Behind?" paper is the peer-reviewed source and reports a slightly different figure). NOT in the previously cited CHI 2008 paper, which is a lab study finding people compensate for interruptions by working faster at the price of more stress. https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx · https://ics.uci.edu/~gmark/chi08-mark.pdf (speed/stress only)
- Batching 3x/day (n=237, 2 weeks) improved well-being, hourly batching was about the same as control, and turning notifications fully off raised anxiety and FoMO. So batch, don't silence. https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596
- Interruptions at coarse task boundaries cost less. An agent finishing is a natural breakpoint. https://www.microsoft.com/en-us/research/wp-content/uploads/2016/11/CHI_2007_Iqbal_Horvitz-1.pdf
- Mixed-initiative: act only if the expected value beats deferral, and defer to low-attention-cost moments. https://erichorvitz.com/chi99horvitz.pdf
- One notification per thing. Duplicates lead users to disable everything. Use the lowest interruption level (passive / active / time-sensitive / critical). https://developers.apple.com/design/human-interface-guidelines/components/system-experiences/notifications/ · https://sdkdevelopers.meetmarigold.com/docs/ios-interruption-levels
- Expand in place first, with the OS banner as fallback (the Dynamic Island model). https://wwdcnotes.com/documentation/wwdc23-10194-design-dynamic-live-activities/

### Motion (durations, springs)
| Item | Value | Source |
|---|---|---|
| UI spring (not thrown) | zeta = 1.0, response 0.3-0.4 s (omega ≈ 16-21 rad/s) | https://asciiwwdc.com/2018/sessions/803 |
| Momentum / drag-release spring | zeta ≈ 0.8 | https://asciiwwdc.com/2018/sessions/803 |
| Apple values (Kowalski's distillation) | reposition 1.0 / 0.4 s; sheet 0.8 / 0.3 s; press scale 0.97; ~100 ms press feedback | https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md |
| SwiftUI bounce | ~0.3 noticeable; >0.4 exaggerated for UI | https://developer.apple.com/videos/play/wwdc2023/10158/ |
| SwiftUI `.spring()` default | response 0.55 / damping 0.825 (too slow and bouncy for small chrome) | https://developer.apple.com/documentation/swiftui/animation/spring(response:dampingfraction:blendduration:) |
| Momentum projection | v²/(2·decel), or (v/1000)·d/(1-d) with d ≈ 0.998 (0.99 is snappier) | https://asciiwwdc.com/2018/sessions/803 |
| Duration tokens (non-spring) | 50/100/150/200 ms short; 300 ms medium2; emphasized-decelerate cubic-bezier(0.05,0.7,0.1,1.0) | https://m3.material.io/styles/motion/easing-and-duration/tokens-specs |
| Reduced motion | ~200 ms opacity crossfade instead of springs; still frame instead of sprite animation (Codex); drop blur for reduced transparency | https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md · https://learn.chatgpt.com/docs/pets |
| HIG | brief, precise; avoid gratuitous motion and motion on frequent interactions | https://developer.apple.com/design/human-interface-guidelines/foundations/motion |
| Latency limits | 0.1 s / 1 s / 10 s | https://www.nngroup.com/articles/response-times-3-important-limits/ |

vibepet check: the current W = 22 rad/s at zeta = 1 gives response ≈ 2π/22 ≈ 0.29 s, and 99% settle ≈ 6.6/ω ≈ 0.30 s. **That is within Apple's range. Keep it.**

### Sizing / spacing
- Frequent targets big and near; rare or destructive ones (quit, hide) go in the ⋯ menu. https://www.nngroup.com/articles/fitts-law/
- Apple HIG minimum is 44x44 pt for touch. Legacy macOS icon buttons are 24-32 px with >=8 px gaps. vibepet's 40x36 buttons are fine for a pointer; ensure an >=8 px gap or shared padded hit areas. https://developers.apple.com/design/human-interface-guidelines/foundations/accessibility
- Concentric geometry: pill radius = half its height; r_inner = r_outer - padding; even margins. https://wwdcnotes.com/documentation/wwdc23-10194-design-dynamic-live-activities/
- Dynamic Island compact is ~36 pt tall, expanded up to 144 pt, icons ~24 pt. These come from a third-party summary (unverified against the HIG). vibepet's 20 px icons are in line. https://infinum.com/blog/start-designing-for-dynamic-island-and-live-activities/
- The Codex custom spritesheet is 1536x1872 px; per-cell size is (unverified). https://penchan.co/en/ai/coding/codex-pets/

---

## 3. Anti-patterns

| Anti-pattern | Why | Source |
|---|---|---|
| Unsolicited, trigger-based help ("It looks like you're writing a letter") | Breaks the social etiquette of asking permission and leaves the user feeling out of control. Clippy was hidden by default in Office XP and gone by 2007. | https://xenon.stanford.edu/~lswartz/paperclip/paperclip.pdf · https://www.bgr.com/2155953/what-happened-to-clippy-why-microsoft-retired-office-assistant/ |
| Hard to silence (Clippy NoActors folder hack; force-killing Goose) | Users escalate to uninstalling | https://www.mentalfloss.com/article/504767/tragic-life-clippy-worlds-most-hated-virtual-assistant · https://samperson.itch.io/desktop-goose |
| Face as a substitute for competence | The face reads as an interloper; personality has to be earned by being useful | https://thenewstack.io/humanity-vs-clippy-lessons-from-microsofts-failed-virtual-assistant/ |
| Guilt or decay loops (hunger, streaks, diff panic) | Anxiety and compulsive checking (Tamagotchi). Mochi deliberately has no decay penalties. | https://wellcomecollection.org/stories/digital-pets · https://dev.to/mikachu/i-built-a-better-codex-pet-than-openai-did-eib |
| Covert data collection behind a mascot | BonziBuddy: spyware label, FTC fine, dead product | https://en.wikipedia.org/wiki/BonziBuddy |
| Pets that act on the cursor or windows, roam, or clone (Goose, Shimeji) | Fine as a toy; "a nuisance that disrupts productivity" in a work tool | https://www.pcgamer.com/the-horrible-goose-can-now-live-on-your-desktop-and-steal-your-cursor/ · https://pets-therapy.com/desktop-goose-alternatives.html |
| Continuous loops while waiting or working (bounce, blink, endless pulse) | Keeps the pet in the center of attention; the most distracting channel; WCAG 2.2.2. This is vibepet's "nagging" dead end. | https://interruptions.net/literature/Bartram-IJHCS03-BW.pdf · https://caseorganic.com/post/principles-of-calm-technology/ |
| Bouncy overshoot on UI the user didn't throw | Apple's default is bounce 0 ("when you're not sure"); bounce is for playful or end-of-gesture animations, and >0.4 feels exaggerated. (Apple does not strictly "reserve" bounce for momentum.) This is vibepet's "bouncy spring" dead end. | https://developer.apple.com/videos/play/wwdc2023/10158/ |
| Fixed-duration, non-retargetable animations; slow (>300 ms) or blurred morphs | Break direct manipulation. This is vibepet's "blurry slow morph" dead end. | https://asciiwwdc.com/2018/sessions/803 · https://www.nngroup.com/articles/response-times-3-important-limits/ |
| Hover reveal with no intent gate, or instant hide on exit | Accidental opens and flicker; menus feel "flimsy" | https://baymard.com/blog/dropdown-menu-flickering-issue |
| Duplicate channels for one event (bubble + sound + banner, or re-notifying) | Users switch off all notifications | https://developers.apple.com/design/human-interface-guidelines/components/system-experiences/notifications/ |
| Persistent state shown as a transient reaction | The pet lies about status | https://github.com/openai/codex/issues/28995 |
| Turning all alerts off as the "calm" fix | Raised anxiety and FoMO in an RCT | https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596 |

---

## 4. Officer disagreements (one line each)

- **Dwell timer:** Kirk wants trajectory only with no hover-delay timers; Spock and Scotty keep a 300 ms dwell as the fallback alongside the aim test. Resolution: aim test first, dwell only when velocity is near zero.
- **Close grace:** Scotty 450 ms; Spock >500 ms (NN/g); Kirk unspecified. Resolution: ~500 ms plus a safe polygon.
- **"Running" signal:** Kirk wants Dangling-String motion scaled to tool-call rate; Spock wants static green (Bartram, WCAG 2.2.2). Resolution: static by default. (Correction: WCAG's 5 s limit is total duration, not cycle length, so an indefinite "under 5 s cycle" modulation is still continuous motion, which is the nagging dead end. If kept at all, it must be off by default and behind Animations.)
- **Codex state count:** official docs list 4 states (learn.chatgpt.com); a news summary lists 3 (https://biggo.com/news/202605040025_OpenAI_Codex_desktop_pets). The official docs win.
- **Collapse speed:** only Scotty proposes a faster collapse (W = 28); unopposed but unsourced beyond "crisp close".
- **"Finished" OS banner:** Kirk says silent LED unless the user is away; Spock says OS banner only when away or unfocused; Scotty says one per transition, possibly passive. All agree: never duplicated, never repeated.

---

## 5. Prioritized changes for vibepet

| # | Change | Expected effect | Source | Conflicts with current state? |
|---|---|---|---|---|
| 1 | **Kill steady-state motion.** Replace the continuous "working" LED pulse (app.js ~L182, sin(t*5) ≈ 0.8 Hz forever) with static colour. Play one 400-600 ms pulse or hop per state *transition*, and never re-trigger while the state is unchanged. | Removes the "nagging" failure; WCAG 2.2.2 compliant; transitions still register in peripheral vision | https://interruptions.net/literature/Bartram-IJHCS03-BW.pdf (Codex #28995 argues the opposite for Codex, continuous loops, so this is a deliberate divergence) | **Yes**: current pulse loops indefinitely |
| 2 | **Adopt the 4-state priority LED:** needs-input (amber) > stuck (red) > ready/unread (new: dim white or mint that holds until the pet is hovered) > running (green). Show the most urgent state across all sessions. | "Done" persists quietly instead of relying on a missable bubble; multiple sessions collapse to one honest signal | https://learn.chatgpt.com/docs/pets | Partial: adds a new "ready" state; the rest maps onto the existing LED |
| 3 | **Intent-gated reveal:** a <=100 ms micro-acknowledgement (shadow widens or darkens ~10%, p <= 0.25, no icons). Full pill only on a menu-aim triangle/cone hit (2+ samples) or a momentum projection (d = 0.99) landing in the zone. Fallback: hoverIntent (<6 px over 100 ms) or ~300 ms dwell. Keep the pass-by veto (vt > 700 px/s). | Zero perceived latency when aiming, no accidental pills from fly-bys, no phantom reveal from a parked cursor | https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown · https://www.nngroup.com/articles/timing-exposing-content/ · https://briancherne.github.io/jquery-hoverIntent/ | **Yes**: replaces the scalar TTA 0.25 s heuristic (app.js ~L400-413) the background agent is building. Coordinate. |
| 4 | **Close grace + safe polygon:** raise GRACE from 200 ms to ~500 ms. Keep the pill open while the cursor is inside the polygon from cursor to pill corners. | No collapse flicker on diagonal or slow approaches | https://www.nngroup.com/articles/timing-exposing-content/ · https://mayank.co/blog/hover-triangles/ | **Yes**: GRACE = 200 today |
| 5 | **Spring discipline:** keep zeta = 1, W = 22 (≈0.29 s). Retargets inherit velocity. Optional faster collapse (W ≈ 28). zeta ≈ 0.8 only for drag-release of the pet. **Under reduced motion, replace the W = 40 spring with a 200 ms opacity crossfade.** | No overshoot; interruptible; the reduced-motion path actually reduces motion | https://asciiwwdc.com/2018/sessions/803 · https://github.com/emilkowalski/skills/blob/main/skills/apple-design/SKILL.md | **Yes** (reduced-motion only): it currently speeds the spring up |
| 6 | **One-shape morph:** shadow and pill share their centre and bottom edge; pill radius = half its height throughout; animate only transform (scaleX/scaleY) plus shadow alpha into pill fill over the same p; icons fade in during the last ~40% (p > 0.55, already done). No blur. | Reads as one object growing (Dynamic Island), which fixes the "not seamless" dead end; GPU-composited 60 fps | https://wwdcnotes.com/documentation/wwdc23-10194-design-dynamic-live-activities/ | Mostly aligned; remove any blur and any residual two-element crossfade |
| 7 | **Interruption policy:** routine finishes = silent LED ("ready"). OS banner or sound only for needs-input or stuck, or for a finish while the user is away or unfocused. One per session-state, never duplicated across bubble, sound and banner. Keep the 1/20 s cap; add a "digest" option rather than an "off" switch. | Interruptions shrink to the ones worth the ~23 min refocus cost, without the anxiety of full silence | https://erichorvitz.com/chi99horvitz.pdf · https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx · https://www.sciencedirect.com/science/article/abs/pii/S0747563219302596 · https://developers.apple.com/design/human-interface-guidelines/components/system-experiences/notifications/ | **Yes**: agentDone and agentStalled fire bubble + tune (app.js ~L332-333); README promises "notifies + bounces" |
| 8 | **The pet never initiates speech.** Chatter default 0 even in Game mode. Bubbles appear only on click, hover-dwell, or a blocked agent, and every dismissal sticks. Expose calm knobs: chatter 0/low/normal, sound on/off, notification level. | Avoids the Clippy failure directly; users tune intrusiveness instead of quitting | https://xenon.stanford.edu/~lswartz/paperclip/paperclip.pdf · https://github.com/TigerHix/shimeji-ee/blob/master/conf/behaviors.xml | Partial: Game mode chatter exists (default OFF) |
| 9 | **Idle wind-down:** with no agent activity and a still cursor, settle through sit, slow blink, eyes half-closed, sleep (static frame, LED dimmed) over minutes. Wake only on a state change or cursor approach. Gate it behind Animations. | Stillness becomes the "all quiet" signal; personality without periodic motion | https://github.com/winebarrel/Neco · https://en.wikipedia.org/wiki/Neko_(software) | Aligned: extends the existing 15-min sleep rule |
| 10 | **Pet as entry point + trust surface:** clicking the pet jumps to the session that needs you (instead of a "boop"); add a global show/hide shortcut (e.g. Ctrl+Opt+P, avoiding Codex's Option+Space); chat button largest and nearest the pet's centre line with an >=8 px gap; add "reads ~/.claude locally; nothing leaves your machine except chat you send" to the menu and README; remove README claims about bounce-on-finish and ">1200 lines = panic". | Fastest route back to the blocked agent; one-key dismiss; heads off the BonziBuddy association | https://learn.chatgpt.com/docs/pets · https://www.nngroup.com/articles/fitts-law/ · https://en.wikipedia.org/wiki/BonziBuddy | **Yes**: README advertises dead-end mechanics; click is currently a reaction |

---

## Verification notes (Worf, 2026-09-27)

Verdict: **PASS with corrections.** 12 sources checked. None of the checked sources were fabricated. Four claims were misattributed or wrong, and three were over-stated; all seven are corrected above.

Confirmed: Codex docs (4 states and their priority, pencil/bell/voice controls, still frame under reduced motion, Option+Space, 1536x1872 spritesheet); dev.to (no persistent state, Mochi has no decay); Codex #28995 (quote accurate); BonziBuddy ($75k FTC/COPPA fine in 2004, spyware/adware labels); Baymard (300-500 ms, 60%); jQuery-menu-aim (3 locations, 300 ms, tolerance 75); Fitz et al. 2019 (n=237, 2 weeks, 3x/day helps, hourly same as control, off raises anxiety/FoMO); Bartram 2003 (moticons detected better than colour/shape in the periphery, some motion more distracting and irritating); WWDC23 springs (0.3 noticeable, >0.4 exaggerated).

Refuted or corrected:
1. The Mark CHI08 PDF does not contain "23 min 15 s" or "81.9%". The 23:15 figure comes from a Gallup interview, and the CHI 2005 paper is the related peer-reviewed source. Re-sourced; the 81.9% figure was dropped.
2. Codex #28995 was cited as support for static steady states, but the issue asks for persistent states to loop *continuously*. The citation was removed from the support lists, and the choice is now labelled a deliberate divergence.
3. The hoverIntent default sensitivity is 6 px, not 7 (checked against jquery.hoverIntent.js on master).
4. "Apple reserves bounce for momentum" overstates WWDC23. Apple's default is bounce 0, and bounce is also for playful or end-of-gesture animations.
5. The "flash no more than 3/s" rule is WCAG 2.3.1, not 2.2.2.
6. Codex docs don't say when "Ready clears once viewed" happens or that "hover enables drag". Both are marked unverified.
7. The officer resolution "modulation under 5 s cycles" misread WCAG, where the 5 s limit is total duration. It also conflicts with the user's no-nagging requirement, so it was downgraded to off-by-default.

Not checked: asciiwwdc 2018 spring numbers, the Kowalski skill values, Material tokens, the SwiftUI `.spring()` defaults (the Apple docs page didn't render), Horvitz/Iqbal, and the Dynamic Island sources.
