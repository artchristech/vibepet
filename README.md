# vibepet

**[vibepet.net](https://vibepet.net)** · `curl -fsSL vibepet.net/install | sh`

A pixel desktop pet for vibe coders. Floats on top of everything, click-through except on the pet.

- **Watches Claude Code** (`~/.claude/projects/*.jsonl`): antenna LED = agent status (green working, amber waiting on you, red stuck on a tool/approval). Notifies + bounces when an agent finishes. Reply within 60s = "quick draw" XP.
- **Eats commits**: follows the repo your active agent is in (or pick one). Commits feed it + XP; big uncommitted diffs make it sweat, >1200 lines = panic.
- **Levels**: blush (L2), sparkle trail (L3), headphones (L4), shades on hover (L5), crown (L7). Commit streak 🔥.
- **Chat** (double-click / 💬): Claude with live repo + agent context. Chips: commit msg (copyable), vibe check, what's my agent doing, next step. Key via `ANTHROPIC_API_KEY` or right-click → Set key (keychain-encrypted).

Click = pet · drag = move · right-click = menu · Esc = close chat.

Dev:

```
npm install && npm start      # run
npm run dist                  # build dmg/zip (arm64 + x64)
site/build.sh                 # refresh the site demo from renderer/
```

MIT.
