# vibepet

**[vibepet.net](https://vibepet.net)** · `curl -fsSL vibepet.net/install | sh`

A pixel desktop pet for vibe coders. Floats on top of everything, click-through except on the pet.

- **Watches Claude Code** (`~/.claude/projects/*.jsonl`): antenna LED = agent status (green working, amber waiting on you, red stuck on a tool/approval). Notifies + bounces when an agent finishes.
- **Eats commits**: follows the repo your active agent is in (or pick one). Commits feed it + XP; big uncommitted diffs make it sweat, >1200 lines = panic.
- **Hover the pet**: the pill lists what each waiting, stuck or finished agent needs (its question, the pending tool call, or the first line of its result). Click a row, or the pet, to jump to that terminal.
- **Subagents count as work**: while an agent fans out (Agent tool or a workflow run), its row in the pill shows a pip per subagent (filled = done, hollow = running) and it stays green, not "stuck" or "done", until they finish (red only if a subagent itself sits on a tool call, e.g. an approval).
- **The jump door**: ⌃⌥⌘J jumps to the agent that needs you; press again within 4 s for the next one. Change it or turn it off under right-click → Jump key (it says "taken" if another app has it). Clicking a "has a question" / "done" notification jumps to that agent too.
- **Lost him? Open vibepet again.** A second launch brings the running pet back on screen and opens its pill.
- **Levels**: blush (L2), sparkle trail (L3), headphones (L4), shades on hover (L5), crown (L7).
- **Chat** (double-click / 💬): Claude with live repo + agent context. Chips: commit msg (copyable), vibe check, what's my agent doing, next step. Key via `ANTHROPIC_API_KEY` or right-click → Set key (keychain-encrypted).

Click = go to the agent that needs you · ⌃⌥⌘J = same, from anywhere · drag = move · right-click = menu · Esc = close chat.

Dev:

```
npm install && npm start      # run
npm run dist                  # build dmg/zip (arm64 + x64)
site/build.sh                 # refresh the site demo from renderer/
```

MIT.
