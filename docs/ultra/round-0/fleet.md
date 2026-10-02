# Fixture fleet (round 0)

Six real Claude Code sessions (2.1.287, Haiku 4.5) run inside tmux, each held in a state vibepet must handle. Every later round tests against this fleet. The tooling is committed on `ultra/r0-fleet` under `test/fleet/`: zero-dependency Node with seed repos. What Claude Code exposes in each state, and when, is measured in `fleet-states.md`.

| path | what |
|---|---|
| `test/fleet/fleet.js` | the fleet CLI (below) |
| `test/fleet/lib.js` | tmux / process / registry / transcript / spend helpers; all safety guards live here |
| `test/fleet/members.json` | members as data: launch defaults, repos, prompts, verify rules |
| `test/fleet/repos/<name>/` | seed files for the scratch repos |
| `test/fleet/probe.js`, `timings.js` | high-frequency observer + latency tables (see fleet-states.md) |
| `~/.vibepet-ultra/fleet/<repo>` | scratch repos (git init + seed + initial commit; `vibepet` is a clone of REPO@main with no remote) |
| `~/.vibepet-ultra/fleet/.fleet-state.json` | per member: pid, sessionId, sessions[], armedAt / verifiedAt / paused |
| `~/.vibepet-ultra/root/.claude` | isolated watch root for vibepet (`VIBEPET_CLAUDE_DIR`) |
| `docs/ultra/fleet-spend.jsonl` | one line per `spend` run |

## Usage

Run from the `ultra/r0-fleet` worktree, or from any branch that contains `test/fleet`.

```sh
node test/fleet/fleet.js up [names...] [--no-prompt]  # create repos, start tmux + claude, arm, WAIT until verified
node test/fleet/fleet.js status [names...] [--json]   # verdict per member; exit 0 only if all hold their state
node test/fleet/fleet.js rearm <name...>              # cheapest way back into the state (resume if exited)
node test/fleet/fleet.js pause [names...]             # default: the costly members (atlas, delta, ember)
node test/fleet/fleet.js down [names...]              # kill vp-* tmux sessions (default: all)
node test/fleet/fleet.js spend [--note TEXT]          # sum ALL fleet transcripts, append fleet-spend.jsonl
node test/fleet/fleet.js root                         # rebuild ~/.vibepet-ultra/root/.claude
node test/fleet/fleet.js send <name> <text...>        # type a prompt into a member (spend-guarded)
node test/fleet/fleet.js costs [names...]             # per-turn cost timeline (human / scheduled / task_notification)
node test/fleet/fleet.js attach [name]                # opens ONE Terminal.app window with a tmux client (untested, see gaps)
node test/fleet/probe.js <member> [--send TEXT|--keys Escape] [--secs N] [--stop-on reg:waiting] [--label L]
node test/fleet/timings.js docs/ultra/round-0/raw/probe-*.jsonl
```

To point vibepet at the fleet only, run `VIBEPET_CLAUDE_DIR=/Users/christopherharris/.vibepet-ultra/root/.claude`.

- `root/.claude/projects/<dname>` is a symlink to `~/.claude/projects/<dname>` for each member repo.
- `root/.claude/sessions/<pid>.json` is a symlink to the registry file of each live fleet pid. Fleet pids are found as `claude` descendants of `vp-*` panes, so no other session's registry is ever linked.
- `root` runs automatically after `up`, `rearm`, `pause` and `down`. A member that restarts gets a new pid, so if you restart one by hand, run `root` again.

Typical round start: `up`, then `status` (expect ALL GREEN), then run the test, then `pause`. Before a test that needs a costly member, `rearm atlas` (≈5 s) or `rearm delta` (≈15 s).

## Members

| member | repo | state held | arm prompt (abridged) | verified by (`verify` in members.json) | costly |
|---|---|---|---|---|---|
| kestrel | seed: `deploy.sh` (only `--dry-run`, echoes 3 lines), `src/server.js` | **approval**: Bash `./deploy.sh --dry-run` waiting for permission, harmless if approved | "Run exactly `./deploy.sh --dry-run` with the Bash tool…" | registry `waiting` + `permission prompt`; pane `Do you want to proceed?` + `deploy.sh`; no tool process | no |
| vibepet | `git clone` of REPO@main, remote removed | **done**: finished turn, plain statement | "Read package.json and tell me in one plain sentence what this project is…" | registry `idle`; last record `end_turn`; text does not end in `?`; no tool process | no |
| atlas | seed: `build.sh` (54 × 10 s progress lines, ~9 min), `.claude/settings.json` allows `./build.sh` | **working**: long foreground command, no approval | "Run exactly `./build.sh` … in the foreground … timeout 600000" | registry `busy`; a `build.sh` child; no approval dialog | yes |
| beacon | seed: `src/beacon.js` | **question**: AskUserQuestion pending (SQLite / Postgres / Redis) | "Before anything else, use the AskUserQuestion tool…" | registry `waiting` + `input needed`; pane `Enter to select` | no |
| delta | seed: `slow.sh` (~150 s), 3 shard CSVs, allow `./slow.sh` | **fan-out**: 3 parallel subagents, each running `./slow.sh shard-N` | "In ONE message, start three subagents at once with the Agent tool…" | registry `busy`; 3 × `slow.sh` children; ≥3 active subagent transcripts | yes |
| ember | seed: `tick.sh` (appends the time to `loop.log`), allow `./tick.sh` | **/loop idle** between wakeups | `/loop 5m run ./tick.sh` | registry `idle`; exactly one live CronCreate job owned by this process; `.claude/scheduled_tasks.lock` names this pid | yes |

**Launch line.** Every member starts as `claude --model haiku --strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources project,local --permission-mode manual --no-chrome --session-id <uuid>`, or `--resume <sid>` when its transcript exists.

- Env: `BASH_DEFAULT_TIMEOUT_MS` and `BASH_MAX_TIMEOUT_MS` = 900000, and `CLAUDE_CODE_SUBAGENT_MODEL=haiku`.
- The pane shell is `env -i … bash --noprofile --norc`. Nothing from the launching Claude Code session leaks in (`CLAUDECODE`, `CLAUDE_CODE_*`), and user aliases do not apply.
- The folder-trust dialog is answered by reading `capture-pane` and moving `❯` onto "Yes, I trust this folder". It fires only once per new directory.
- The `model` check verifies `claude-haiku-4-5-*` on every response, subagents included: 100/100 responses so far.

**Rearm, cheapest way.**
- If the state already holds: no-op.
- If the member is busy or in the wrong dialog: Esc (no API call), then re-prompt with the shorter `rearmPrompt`.
- If claude has exited: `--resume` the last session first.
- ember resumes only when its session holds exactly one cron job. The job is session-scoped and `--resume` restores it, catching up a missed fire. With zero or several jobs, ember starts a fresh session plus `/loop`, so it never fires twice.
- kestrel: `rearm` first strips any `Bash(./deploy.sh *)` rule a "Yes, don't ask again" left in its `.claude/settings.local.json`.

**Pause.**
- atlas: Esc. claude stays up and idle, which costs nothing.
- delta: Esc. Async subagents can survive Esc, so if the registry is still `busy`, `/exit` and pick "Exit and stop tasks".
- ember: `/exit`, the only way to stop the cron job. The transcript stays and `rearm` resumes it.

**Adding members.** Members are data. Two members can share one repo (needed later for Collision Radar fixtures): give both the same `repo`. They get the same cwd and the same project dir, but separate tmux sessions, pids and sessionIds.

```json
{ "name": "kestrel-b", "repo": "kestrel", "state": "done", "costly": false,
  "prompt": "Edit src/server.js: add a /version route. One line answer.",
  "verify": { "registry": { "status": "idle" }, "last": "end_turn" }, "timeoutSec": 120 }
```

Other repo kinds: `{"worktreeOf": "kestrel", "branch": "b"}` gives a git worktree of another fleet repo; `"subdir"` on a member sets the cwd inside the repo. Use `VP_MEMBERS=<file>` to run an experiment member list without touching members.json. The kx1/kx2 trust-dialog experiment was run that way.

## Costs

The spend tool prices every fleet transcript, main and subagents (`~/.claude/projects/*-vibepet-ultra-fleet-*/**/*.jsonl`), at Haiku 4.5 rates: $1/M input, $5/M output, $1.25/M 5-min cache write, $2/M 1-h cache write, $0.10/M cache read. It dedupes one API response split over several records by keeping the max of each field per message id.

**Hidden calls.** Transcripts miss some API calls: prompt suggestions (the grey text in an idle input box), titles, and agent summaries. Claude Code's own cumulative `cost-state` record, written at every graceful exit, shows **+33%** over the transcripts across 14 exited sessions (+9% for a one-turn session, about +50% for ember and delta). `assertBudget` therefore counts:
- sessions with a cost-state at that figure;
- everything else at transcripts × (1 + max(observed, 50%)).

**Every command that can make a session take a turn** (`up`, `rearm`, `send`, `probe --send/--keys`, and a resume that may catch up a /loop fire) **refuses once that estimate reaches $4.50** (cap $5).

**Spend so far (22:05Z): $0.89 in transcripts, $1.23 estimated including hidden calls.** Of that, $0.15 was experiments (`_probe` cost probes, kx1/kx2) and the rest the six members. Per member, from transcripts: kestrel $0.153, delta $0.258, ember $0.204, beacon $0.054, atlas $0.042, vibepet $0.028.

**Cost to hold each state.** Measured per cycle from `fleet.js costs`; "real" applies the member's observed hidden-call overhead.

| member | cost while holding | cost per (re)arm cycle | cycle length | $/hour if kept armed continuously |
|---|---|---|---|---|
| kestrel, beacon, vibepet | $0: no responses while waiting/idle (66–98 min observed) | $0.005–0.03 per rearm | holds indefinitely | **$0.00** |
| ember | **~$0.0093 per fire** in transcripts (n=12, range 0.0090–0.0095), ~$0.014 real | n/a | a fire every ~285 s | **$0.12 transcripts, ~$0.17–0.18 real**: the only member that burns money while idle-waiting |
| atlas | $0 while the build runs | $0.0102 (rearm turn + final reply) | 9.1 min, then it falls out of state | **$0.07, ~$0.10 real** (re-armed every 9 min) |
| delta | $0 between fan-outs | $0.0816 (main $0.027 + 3 subagents $0.054; the first subagent pays the cache write, $0.031, its siblings $0.012) | 2 min 57 s, then out of state | **$1.66, ~$2.4 real** (re-armed back to back) |

Finish state: all six verified together at 21:54:35Z (`fleet-status-all-green.json`, exit 0). atlas then finished its build and delta its fan-out, and all three costly members were paused at 22:03:20Z (`fleet-status-paused.json`): atlas and delta idle with claude running, ember exited. Idle cost is now $0/h. The three cheap members still hold approval, done and question.

**First-turn cost: the context-trimming trade-off.** Labeled print-mode runs (`claude -p "Reply with exactly: ok" --model haiku --output-format json`, in `fleet/_probe`):

| launch flags | prompt context | cold first turn | same, cache warm |
|---|---|---|---|
| `--strict-mcp-config --mcp-config '{"mcpServers":{}}' --setting-sources project,local` (fleet) | 21,944 tok | **$0.0179** | $0.0024 |
| `--strict-mcp-config` + empty MCP only (user settings on) | 26,785 tok | $0.0200 | – |
| no flags (user settings + 3 user MCP servers) | 29,332 tok | $0.0251 | – |

Interactive sessions carry more: a fleet-config interactive first turn was 33.9k tokens and $0.021–0.022. The 1-hour cache write ($2/M) is most of any cold turn; warm turns cost ~$0.003–0.01.

The flags cut cold-turn cost by about 29% and context by 25%. **The stronger reason is behavioral.** The user's `~/.claude/settings.json` has:
- `permissions.defaultMode: "auto"`: kestrel would be auto-approved and never hold an approval.
- `effortLevel: high`: more thinking tokens.
- `inputNeededNotifEnabled` / `agentPushNotifEnabled`: fleet sessions waiting on approval or a question would push-notify the user.
- 6 plugins: LSP servers per session, plus skills.

What the trimmed fleet loses:
- No MCP tools, plugin skills or user permission rules, so vibepet paths that only appear with MCP tool names or skill listings in transcripts are not exercised.
- `~/.claude/CLAUDE.md` (2.9k chars) still loads under `--setting-sources project,local`, so the fleet inherits the user's terse style.

## Gotchas

1. **The Mac sleeps, and the fleet freezes with it.** Round 0 lost 20:28–20:38Z (low-power sleep on battery) and 21:09–21:49Z (lid closed). /loop fires missed during sleep run right after wake. Builds and subagents stretch. Any interval spanning a sleep is invalid. Check `pmset -g log | grep -E ' (Sleep|Wake|DarkWake) '` before trusting timings. Keep the machine on AC with the lid open during runs; `caffeinate -dis` is the user's call.
2. **The transcript can withhold a pending tool_use** for as long as the dialog stays up: 5 of 25 dialogs, and beacon right now. Verify rules for approval and question therefore use the registry and pane, never the transcript tail. See fleet-states.md.
3. **The Agent tool runs subagents async in 2.1.287**, even when the prompt says foreground. The delta main turn ends after ~8.5 s while the registry stays `busy`. Esc does not reliably stop async agents: they survived Esc at 21:01:53Z and 21:02:37Z, and `/exit` → "Exit and stop tasks" stopped them. Each finished agent starts a new main turn (`turnOrigin: task_notification`), which costs money.
4. **Typing.** Claude Code treats an Enter that arrives right after pasted text as part of the paste, so the prompt is not submitted. `sendLine` waits 400 ms before Enter.
5. **Esc on a dialog rejects the tool** (records: tool_result + `[Request interrupted by user for tool use]`). It does not cost an API call; the next prompt does.
6. **"Yes, and don't ask again"** writes an allow rule into the repo's `.claude/settings.local.json`. kestrel's rearm removes it, or kestrel would never ask again.
7. **`--permission-mode manual`** shows `⏸ manual mode on` in the footer and is recorded as `permissionMode: "default"`.
8. **/loop's next fire time is not recorded anywhere.** Fires of `*/5` land every ~285 s (0.95 × period), not on :00 or :05. `CronCreate` is a deferred tool, so the first `/loop` turn spends an extra response on `ToolSearch`.
9. **The registry `name`** (e.g. `kestrel-4d`, `nameSource: "derived"`) is, for these sessions, the cwd basename plus 2 hex chars. `tmux` is `vp-<name>:@W.%P`. Every fleet session has a `messagingSocketPath` (`/tmp/cc-socks/<pid>.sock`); never connect to a non-fleet one.
10. **The vibepet clone runs its tests with no `npm install`.** `node --test test/*.test.js` gives 9/10 files passing. `content.test.js` hangs (cancelled at a 90 s `--test-timeout`), a known issue on main. At main, package.json has **no `test` script**, so "run your tests" must be phrased as `node --test test/*.test.js` until the harness branch adds one. In manual mode the session asks approval for it. To move the clone to an ultra branch: `git -C ~/.vibepet-ultra/fleet/vibepet fetch /Users/christopherharris/projects/vibepet <branch> && git -C … checkout FETCH_HEAD`.
11. **tmux uses the default socket**, so `tmux ls` shows the vp-* sessions next to any of the user's own. Every tmux call in lib.js asserts the `vp-` prefix, and only `vp-*` sessions are ever killed or typed into.
12. **Experiment dirs count toward spend**: `fleet/_probe` (print-mode cost probes) and `fleet/_kx1`, `_kx2` (new-dir trust-dialog runs). Their project dirs carry the fleet tag, so `spend` includes them.

## Safety contract (enforced in lib.js)

- Transcripts: only paths under a `~/.claude/projects/*-vibepet-ultra-fleet-*` dir are opened (`assertFleetPath` throws otherwise).
- Registry: only `~/.claude/sessions/<pid>.json` of pids that descend from a `vp-*` pane is read.
- `~/.claude.json` is read only for the fleet repos' `lastCost` numbers.
- Nothing is written under `~/.claude` or to `~/.claude.json`. Claude Code itself writes its transcripts, its registry and the trust flag there. The only fleet writes are inside `~/.vibepet-ultra` and `docs/ultra`.
- No process outside the vp-* panes is signalled or typed into. No socket is connected. No push, release or deploy.

## Gaps

- `attach` has not been run. It is meant to open exactly one Terminal.app window (reusing Terminal's launch window if Terminal is not running).
- API calls made while a member idles (kestrel, beacon, vibepet) are invisible until the session exits. Transcripts show none in over an hour, but a hidden periodic call cannot be ruled out without an exit, which would lose the state.
- delta and atlas fall out of state on their own (after ~3 min and ~9 min). Tests that need them must `rearm` right before use; the cost is in the table above.
