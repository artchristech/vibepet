# p6 ship

`node --check` passes on agents.js, main.js, preload.js and renderer/app.js. The recapture (rerun after the last agents.js edit) captured 21/21 states (idle 0.3% CPU, 323 MB). `node test/receipt.test.js`, `node test/fanout.test.js` and `node test/agents.test.js` pass. The real `~/Library/Application Support/vibepet` mtime was 1790544640 before and after every launch.

| # | Feature | Status | Files |
|---|---|---|---|
| P5 | Receipt line: what the turn touched, and whether it's green | done | agents.js (`CHECK_RE`, `receipt`, `foldReceipt`, `classify` → `out().receipt`, `kidPhase` `k.rc`, `fanout(file, turnAt, rc)`, `scan`), main.js (`snapshot` only), renderer/app.js (`renderRoster`, `rcLine`, roster onclick), renderer/style.css (`#roster span.w`, `.rc`), states.json `19-roster-receipt`, test/receipt.test.js, test/receipt-real.js |
| P6 | Chat without a key, using the user's own `claude` login | done | main.js (`findClaude`, `chat-via`, `runClaude`, `chatViaClaude`, keyless branch in `chat`), preload.js (`chatVia`), renderer/app.js (`openChat`), renderer/index.html (keyForm clause), states.json (12/13 pin `chat-via` to 'key', 14 to null, new `20-chat-via-claude`) |

## Evidence
- P5-2: fixtures a–i pass. (a) 2 files, +4 −2, ok, not stale. (b) ok:false, exit 1. (c) stale. (d) check undefined. (e) ok undefined, so no chip. (f) `rm -rf build && mkdir build` doesn't match, and `cd x && pnpm run test` does. The test also covers 12 more positive and 6 negative commands. (g) records before the second prompt are ignored. (h) truncated. (i) the child's 3 files plus the parent's README fold to 4 files, with ✓ cargo test.
- P5-3: on a second `scan()` with unchanged stats, the child jsonl wasn't opened and the parent was opened once, same as before receipts.
- P5-4: `grep receipt` hits main.js:212 (snapshot) and renderer/app.js in renderRoster/rcLine and the roster click handler only.
- P5-5: state 19 shows a waiting row with `2 files – edited afte…` and a ready row with `3 files ✓ npm tes…`. The pet body bbox is (256,736)–(463,919) in both 17 and 19.
- P5-6: the diff adds no setInterval, requestAnimationFrame, animation or @keyframes.
- P5-7: `node test/receipt-real.js` (read-only, throwaway Map) printed 5 live sessions. Examples: `Vibepet capabilities table · 5 files · node --check renderer/ap · ok · stale`. `CD faucet … · ready · xcodebuild (run_in_background) · ok undefined` → no chip, which is correct. A human still needs to spot-check 3 sessions.
- P6-2: I ran the exact argv by hand from `$TMPDIR/vibepet-chat` with `User: say hi` on stdin. It exited 0 with `is_error:false`, result "*blinks pixel eyes* Hi there!". **`--setting-sources ''` was accepted**, so the fallback isn't used. The ~/.claude/projects dir count stayed 104 → 104.
- P6-3: see "Real run" below.
- P6-4: across harness chats, the projects dir count stayed 104 → 104. No `vibepet-chat` project dir appeared, there were 0 jsonl files under `$TMPDIR/vibepet-chat`, and no roster row was added.
- P6-5: with `VIBEPET_CLAUDE_BIN=/nonexistent`, `PATH=/usr/bin:/bin` and a temp HOME, `chatVia` returned null. The key form shows with the old first message, `chat` returns `{error:'nokey'}`, and no spawn happens.
- P6-6: with the stub printing `{"is_error":true,"result":"Invalid API key · Please run /login"}`, the key form appeared after the vibe check. No crash.
- P6-7: `fs.accessSync` on candidate paths ran 0 times at idle. Across two chat opens, `findClaude` ran exactly once: 1 probe with the stub, or 5 probes + 1 zsh when nothing is found.
- P6-8: the fetch/x-api-key lines are unchanged in `git diff main.js`. The only change to the `chat` handler is its first `if (!key)` line.
- P6-9: no new setInterval. The one setTimeout is the 90 s kill for the spawned process.

## Deviations
- `cmd` is the first line of the command **from the matched runner**, so `cd /x/app && pnpm run test` shows `pnpm run test…` and not `cd /x/app …`. `full` is the whole command, and a chip click copies that.
- Results that aren't a verdict leave `ok` undefined, so no chip shows: a user-rejected tool, an interrupt, or `run_in_background`. Edits whose tool_result is_error (rejected or failed) aren't counted as touched files.
- A child's receipt covers its whole tail (the child is the turn), so `truncated` for a child only comes from the parent.
- Row 2 of a receipt row is a flex line. The ask keeps ≥45% of the width, and the receipt ellipsises after that. The title tooltip holds the full file list, +add −del, the command and the exit code.
- `chat-via` uses `hasKey()` rather than `getKey()`, so opening chat never triggers a keychain prompt.
- Auth detection also accepts a non-JSON "log in" message on stdout. A usage-limit result (`You've hit your session limit…`) shows as an ordinary error line, not the key form.
- If `claude` isn't found, that null is cached until relaunch. The keyForm copy says "sign in to Claude Code (`claude`) and restart me".

## Try it
- Unset ANTHROPIC_API_KEY, clear the key (⋯ → Change API key…, save empty), and double-click the pet. The chat opens with "using your Claude Code login", and the vibe-check chip answers through `claude -p`.
- Have an agent edit a couple of files and run `npm test`, then hover the pet when it's done. The row reads `2 files ✓ npm test 1m ago`. Edit once more and it reads `– edited after npm test`. Click the chip to copy the command.
- `node test/receipt.test.js` · `node test/receipt-real.js 12`
