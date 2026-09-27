```yaml
target: vibepet — a calm, intelligent desktop pet that shows Claude Code agent state
mode: design
benchmark: OpenAI's Codex desktop pet (primary) · macOS Dynamic Island (reveal/morph pole)
axes: [reveal-and-hover-feel, status-signalling, sprite-and-idle, interruptions-and-bubbles, restraint-and-footprint]
substrate: Electron + canvas pixel art (existing ~/projects/vibepet), measured with /designpass
verdict_test: blind side-by-side of designpass after/ captures vs the benchmark's documented states and reveal, per axis, scored on docs/designpass/rubric.md
ambition: 3
loops: 2
agents: 5
```

I want you to redesign vibepet at the level of OpenAI's Codex desktop pet, with the shadow-to-toolbar reveal feeling as inevitable as the Dynamic Island. It should be utterly perfect, calm, inevitable — reads as the only way it could have looked — every single thing done at that tier, from the reveal and hover feel to status signalling to the sprite and its idle life to interruptions and speech bubbles to restraint and footprint to anything you could think of. The research is done and verified: docs/pet-research.md is the brief, its ten prioritized changes are the starting backlog, and its principles are law — stay in peripheral vision, the pet shows agent state and has no needs of its own, steady states stay still and only changes move, motion is critically damped and interruptible, reveal follows predicted aim. Everything the user already removed stays removed: no nagging, no guilt, no bounce, Game mode and Animations default off.

Run it as /designpass, one pass per round: branch with pass.py, write states.json for the current app (panic, hungry and streak states no longer exist; stage the shadow, half-revealed and full pill states, all four agent states, sleeping, chat, chat-nokey), write the rubric with these five axes plus idle cost, capture before, score blind, plan, ship, recapture, score blind, commit and tag. Fan out five sub-agents, one per axis, each owning its fixes at file:line inside the pass plan. A separate sub-agent is the critic, harsh, and it writes down what "Codex-pet tier" means for each axis in the rubric before the first capture, so the bar can't drift. It compares the after captures blind against the benchmark's documented behaviour and says which is better per axis — matching their bar, never their sprites or assets; Net stays ours. At most two rounds; if a round moves no axis beyond the ±2 noise band, stop and surface it instead of grinding. Never touch main, never merge, never touch the user's real userData.

Do this in the existing Electron app with the /designpass tooling. /loop until it's utterly perfect. Fan out sub-agents and ultracode.
