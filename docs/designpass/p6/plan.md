# p6 plan

## P5 · Receipt line (what the turn touched, and whether it's green)
- agents.js: `CHECK_RE` + `receipt(lines, turnAt, side, fallback)` after `humanAt` (~l.53). `classify()` (l.56–90): remember `fallback`, attach `receipt` to every `out()` from the lines it already read. `kidPhase()` (l.101): cache the child's receipt in `k.rc`. `fanout(file, turnAt, rc)` (l.111): fold counted children into `fo.receipt` (union files, latest check by `at`, stale if any edit after it). `scan()` (l.163–169): `receipt: fo?.receipt || c.receipt`.
- main.js `snapshot()` (l.211): pass `receipt` through, files as an array.
- renderer/app.js `renderRoster()` (l.422): ready + waiting rows get `<small class="rc">`, text `[≥]N files` + verdict chip `<var>`. Title = files ≤12 (+N), +add −del, full cmd, exit. Roster onclick (l.446): a chip click copies `full`; no jump, no markSeen.
- renderer/style.css: `.rc` 10px tabular-nums .55; `var.ok` green, `var.bad` red, `var.stale` 45% grey. Row 2 becomes a flex line (ask ellipsis + rc), height unchanged. No animation.
- states.json: `19-roster-receipt` (ready ✓ row + waiting stale row).
- test/receipt.test.js: fixtures a–i; cache check (0 extra readTail on unchanged stats); test/receipt-real.js read-only printer.

Acceptance: node --check; receipt tests a–i; 0 extra reads; grep 'receipt' limited to snapshot/renderRoster/click; state 19 pet rect = 17; no new timers/rAF/CSS animation; real-data printer writes nothing.

## P6 · Chat without a key: the user's own `claude` login
- main.js: `findClaude()` lazy + cached (env hook, 4 paths via accessSync X_OK, then `zsh -lc 'command -v claude'` 3 s). `ipcMain.handle('chat-via')` → 'key' | 'claude' | null. `chat` handler (l.278): keyless branch spawns `claude -p --no-session-persistence --tools '' --setting-sources '' --strict-mcp-config --output-format json --model <m> --system-prompt <SYSTEM+ctx>` in `os.tmpdir()/vibepet-chat`, 90 s timeout, transcript on stdin, one in flight, auth errors → `{error:'nokey'}`, unparsable non-zero → retry once without `--model`.
- preload.js: `chatVia`.
- renderer/app.js `openChat()` (l.582): key form only when `chatVia() === null`; 'claude' → first message notes the login.
- renderer/index.html keyForm `<p>`: one clause about signing in to Claude Code.
- states.json: 12/13 pin chat-via to 'key', 14 to null; new `20-chat-via-claude`.

Acceptance: hand-run argv (done: exit 0, is_error:false, `--setting-sources ''` accepted, projects dir count 104→104); no-key vibe check returns text; no jsonl/roster row; missing binary → key form, no spawn; stub auth error → key form; findClaude 0× at idle, 1× across two opens; key path untouched; no new setInterval.
