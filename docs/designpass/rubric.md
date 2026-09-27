# vibepet designpass rubric (run 0927)

Fixed before the first capture. The critic writes it and the scorers use it as written. Do not edit it mid-run. If the bar looks wrong, record that in the pass report and change it only in a new run.

**Benchmark.** "Codex-pet tier" (90) means matching the *bar* set by OpenAI's Codex desktop pet (https://learn.chatgpt.com/docs/pets) and the macOS Dynamic Island. It never means copying their sprites. Net stays ours. The law is `docs/pet-research.md`:
- The pet stays in peripheral vision.
- The pet shows agent state and has no needs of its own.
- Steady states stay still, and only changes move.
- Motion is critically damped and can be interrupted.
- The reveal follows the cursor's predicted aim.
- Nothing nags, guilts or bounces.
- Game mode and Animations are off by default.

**Scoring.**
- Score each state 0–100 on every axis. The state score is the mean of its axes, and the overall score is the mean of the states.
- Some axes can't be seen in a state (for example, reveal feel in `09-sleeping`). There, score what the shot does show for that axis: the resting footprint, whether the shadow is present, and so on. Do not give a default 75.
- Score the default configuration (`01`–`14`, with Game and Animations off). `15-game-anim-on` is the opt-in contrast state. Score it on the same bar. It shows whether the opt-in mode keeps the calm grammar or breaks it.
- Anchors: 90 = Codex-pet tier. 75 = good and shippable, with one visible miss. 60 = works, but reads as a hobby pet. 40 = actively violates a principle. ≤25 = broken or blank.
- Every score needs a one-line note that names the pixel or element that decided it.

---

## 1. reveal-and-hover-feel
Covers the ground shadow becoming the pill: `01-idle` → `02-hud-half` → `03-hud-full`, `04-hud-aim` (cursor still ~70 px out, moving toward the pet), and the pill's resting form in every other state.

**90.**
- **One container.** At rest the shadow is visibly the same object as the pill: same fill, same centre line, radius = height/2. Half-reveal (`02`) is a larger version of the same capsule, with no second element, crossfade, blur or ghost outline.
- **Contents stay hidden early.** Icons are invisible at half-reveal and never shown squashed or stretched. At full reveal (`03`) they sit at their natural size.
- **Full pill geometry.** The pill has concentric padding (inner radius = outer radius − padding), even left/right margins, and ≥8 px between hit targets. The primary action (chat/new) is the largest control and sits nearest the pet's centre line, with rare actions under ⋯.
- **Placement.** The pill tucks under the pet's feet with a consistent gap. It doesn't overlap the body or float detached.
- **Aim.** `04-hud-aim` is already mostly or fully open before the cursor arrives.
- **Weight.** The shadow at rest reads as a shadow (soft, low contrast, ~pet width). It does not read as a black slab.
- **Code check** (scorer may read `renderer/app.js` hudTarget/hudFrame and `style.css #hud`):
  - A spring with ζ = 1 and response 0.3–0.4 s, retargetable, with no CSS transition on the morph.
  - An aim test plus a dwell/hysteresis fallback.
  - A ≥0.2–0.5 s grace before collapsing.

**60.**
- The pill appears and works, but the shadow reads as a hard black lozenge.
- Half-reveal is just a scaled-up blob: plausible, but the capsule's aspect ratio or radius drifts between steps, so it doesn't read as the same object.
- Icons pop in, or buttons are cramped.
- The aim state is identical to idle, so no prediction is visible.
- Any of these also caps the axis at 60: a visible second element, blur, or overshoot/bounce in the geometry.

## 2. status-signalling
Covers `05-working`, `06-waiting`, `07-stalled`, `08-agents-mixed`, `09-sleeping` and `01-idle` (no agents).

**90.**
- **Glanceable states.** Each agent state reads at 1× in peripheral vision within ~0.5 s, from a *held steady* signal (colour/pose). Working, your-move, stuck and nothing-running are each unmistakable and distinct from one another, including for a colour-weak viewer, because the signal is shape plus colour, not colour alone.
- **Priority.** In `08-agents-mixed` the pet shows the highest-priority state. Codex order is needs-input > blocked > ready > running. Here, stuck/needs-approval and your-move must outrank working, and it must be obvious which one wins.
- **Ready vs needs input.** "Finished, unread" (ready) is distinguishable from "blocked on you" (needs input). If the app merges them into one amber, that's a visible miss.
- **No motion in steady states.** Code check: no LED blink or pulse is allowed. A 2 Hz red blink on `stalled` or a sine pulse on `working` is a violation (WCAG 2.2.2, Bartram).
- **Signal size.** The indicator is big enough to read: an antenna tip of ≥2×2 art pixels (≥8 screen px), not a single dim pixel.
- **Idle.** No agents reads as calm-neutral, not as "off/broken".

**60.**
- The states differ only by a tiny antenna pixel colour that you have to look for.
- The pet's face and pose are identical across working, waiting and stalled.
- Mixed agents show a colour, but you can't tell which agent or state won.
- Stalled still blinks in code.
- Ready and needs-input are indistinguishable.

## 3. sprite-and-idle
Covers the Net sprite in every state, plus `09-sleeping` and `15-game-anim-on`.

**90.**
- **Readability at 1×.**
  - The sprite reads crisply at 1×, with a clean 1-art-px ink outline and no orphan or stray pixels.
  - Shading is consistent from one light source (the highlight and the shade side agree).
  - The feet are grounded on the shadow, and the eyes have a clear focal highlight.
- **Expression.** Each state has an expression that fits it, readable without the LED: working = focused, your move = attentive/looking at you, stuck = concerned, sleeping = eyes shut. Nothing in the expression reads as guilt, hunger or begging.
- **Idle.** Idle is a still, alive frame (eyes track the cursor) that settles down toward sleep. It is not a loop. Sleeping is a static frame with the LED dimmed.
- **Opt-in mode.** `15-game-anim-on` adds cosmetics (crown, headphones, laptop) without muddying the silhouette, clipping the outline or crowding the head.
- **Identity.** Net is clearly its own character and not a Codex sprite clone.

**60.**
- The sprite is readable but generic.
- The same neutral smile appears in every agent state, so the face carries no information.
- There are outline breaks, or accessories that collide (for example, a crown overlapping the antenna, or a laptop hiding the face and mouth).
- Sleeping differs only by a line of eyes.

## 4. interruptions-and-bubbles
Covers `10-bubble-done`, `11-bubble-stalled`, `12-chat`, `13-chat-convo`, `14-chat-nokey`, and the absence of bubbles everywhere else.

**90.**
- **When to speak.** The pet speaks only for a state change that needs the user. Blocked/needs approval earns a bubble. A routine finish is at most a quiet ready signal plus one bubble, and is never duplicated across bubble, sound and OS banner.
- **Bubble layout.**
  - It is anchored to the pet: the tail points at Net's head and the bubble is horizontally centred on it.
  - It is fully inside the window and uses the same type scale as the rest of the UI.
  - Copy is ≤1 line where possible and names the agent and the action ("codex needs approval").
  - The bubble can be dismissed with one click, and the dismissal sticks.
- **Tone.** No exclamation-mark urgency, no "your move!" pressure, no emoji-as-urgency. The alert colour is reserved for needs-input only.
- **Chat.**
  - Chat opens only on explicit user action.
  - The panel shares the pill's visual language: radius, fill and type.
  - There is no clipped content. The first message is visible and the code block's copy button doesn't overlap the code text.
  - Chips are one row or clearly grouped.
  - The empty state is useful.
- **No-key state.** `14-chat-nokey` explains what the key is for and says it stays local (keychain), in one short paragraph. The input has a clear primary action.
- **Trust.** Local-only reading of `~/.claude` is stated somewhere visible.

**60.**
- The bubble works but is off-centre or anchored to the window edge rather than the pet.
- Copy is two lines of prose with "!" or "?" pressure.
- The routine finish uses the same loud amber as a blocker.
- The chat looks like a different app from the pill: square 2 px ink border and drop shadow next to a soft rounded pill.
- The code block's copy button covers the text.
- The top message is scrolled away.
- Chips wrap awkwardly.

## 5. restraint-and-footprint
Covers every state: how much of the screen and attention the pet takes.

**90.**
- **Footprint.** At rest the pet plus shadow takes the smallest footprint that still reads (roughly ≤ 64×64 pt of visible ink). There is no chrome, no panel, and no text until asked.
- **Default states.** Nothing moves or draws the eye in the default steady states (`01`, `05`–`09`). Only the one needs-you transition adds an element.
- **Clickable area.** The window's clickable area matches the visible ink (click-through elsewhere is assumed from code: `setIgnoreMouseEvents` with pixel hit-test).
- **Opt-in mode.** Even `15-game-anim-on` stays within the pet's own silhouette: no confetti fields and no particles escaping the pet.
- **Nothing ever:**
  - nag copy ("feed me", "one more commit, then sleep?")
  - streaks or hunger meters in default mode
  - bounce
  - focus stealing, except when chat is explicitly opened
- **Colour.** The palette is quiet: the one saturated accent is spent on the state that needs the user.

**60.**
- The pet is calm by default, but the resting shadow is heavy.
- Bubbles are wide (≥300 px) and cover the workspace.
- The chat panel is big relative to need (340×290 for a 1-line exchange).
- The opt-in mode adds floating notes and particles outside the silhouette.
- Code still carries night-time nag lines or guilt copy reachable in default mode.

## 6. idle-cost
Scored from `metrics.json` `idle` (captured with defaults, before staging) plus a code read of the render loop. Apply the same score to every state.

**90.**
- Idle CPU ≤ 1% averaged over the 3 s window.
- The renderer doesn't redraw a static frame every rAF: the canvas and HUD loops sleep when nothing changes (the spring has settled, no cursor movement, no animation).
- The 16 ms main-process cursor IPC is throttled or stopped when the cursor is far away or still.
- Memory ≤ 250 MB across all processes.

**75.**
- CPU ≤ 2%, memory ≤ 300 MB.
- There is some always-on rAF, but it is cheap.

**60.**
- CPU is 2–4% at idle, or memory is 300–400 MB.
- Both rAF loops (`draw` + `hudFrame`) run continuously.
- A 60 Hz cursor IPC runs regardless of state.

**≤40.**
- CPU is > 5% idle, or memory is > 450 MB.
