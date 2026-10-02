# Fleet states: what Claude Code exposes, and when

Round 0, 2026-10-01. Six real Claude Code 2.1.287 sessions on Haiku 4.5 (`claude-haiku-4-5-20251001`, checked in every transcript including subagents), each in its own tmux session (`vp-<name>`, default socket), macOS 24.6. Instrument: `test/fleet/probe.js` on branch `ultra/r0-fleet`. It polls on one wall clock: transcript and registry every 25 ms, `tmux capture-pane` every 50 ms, the claude process tree every 250 ms. It records structure only: record types, stop_reason, tool names, registry fields and process argv.

- Raw recordings: `round-0/raw/probe-*.jsonl` (52 files: 29 arming/trial runs, 21 cancels, 1 approve, 1 idle watch).
- Tables below come from `node test/fleet/timings.js docs/ultra/round-0/raw/probe-*.jsonl`.
- `round-0/fleet-status-all-green.json` is `fleet.js status --json` at 21:54:35Z, when all six members held their states at once.
- `round-0/panes/*.txt` are the six panes at 21:59:56Z.

## Headline for time-to-attention

1. **The registry file `~/.claude/sessions/<pid>.json` is the signal.** Its `status` is `idle`, `busy` or `waiting`. While waiting, `waitingFor` is `"permission prompt"` (approval) or `"input needed"` (AskUserQuestion). `statusUpdatedAt` is the time of the last flip. It is not a heartbeat: atlas showed `busy 436s ago` mid-build, and kestrel/beacon kept `waiting` with one timestamp for over 60 minutes. The flip to `waiting` was the first observable sign in every trial. It landed a median **91 ms** after the tool_use block's own timestamp. The dialog then appeared in the pane a median **127 ms** later. All 25 flips were recorded correctly.
2. **The transcript is not reliable for "needs you".** In **5 of 25** waiting flips the assistant `tool_use` record (and the `thinking` record before it) was **not written while the dialog was on screen**: 3 of 17 approvals and 2 of 8 AskUserQuestions. Claude Code wrote it only when the dialog was resolved, together with the `tool_result`. In the observed cases that was 3.5 s, 57 s and 191 s later. One was **never written**: the live `beacon` question has been pending since 20:55:59Z, and its transcript still ends at the user prompt. When the record is written, it lands within about ±0.5 s of the dialog (median −35 ms for approvals, +54 ms for questions). A transcript-only reader therefore sees "thinking/working" for up to the whole time the session waits on the user, about 1 time in 5.
3. **Waiting for approval vs. tool executing:**
   - *Registry*: decisive. `waiting` + `permission prompt` vs. `busy`.
   - *Transcript*: cannot tell. Both show a pending `tool_use` with no `tool_result`, and the approval case may show nothing (point 2).
   - *Process tree*: decisive for Bash only. Executing means `bash -c source ~/.claude/shell-snapshots/snapshot-zsh-*.sh …` plus the command as children of `claude`, appearing 0.9–1.8 s after the record. Waiting means only `caffeinate -i -t 300`, which claude keeps alive whenever a turn is active, including while it waits. Read, Edit and similar tools never have a child, so a missing child proves nothing in general.
   - *Pane*: decisive. `Do you want to proceed?` vs. `esc to interrupt`.
4. **Done, /loop-idle and never-prompted are all `idle`** in the registry. Done means the last transcript record is an assistant `end_turn` with text, followed by `system:turn_duration`. A /loop session is one whose transcript has a live `CronCreate` job; `<cwd>/.claude/scheduled_tasks.lock` also names the owning pid. **The next fire time is not recorded anywhere**: not in the transcript, the registry or the lock. It must be computed (see the ember row).
5. **Fan-out runs async by default.** In 2.1.287 the Agent tool backgrounds subagents even when the prompt says "foreground". Each `Agent` tool_use gets an immediate `tool_result` with `isAsync`/`status`/`agentId`/`outputFile`. The main transcript reaches `end_turn` 8.5 s after the prompt, while the registry stays `busy` for the whole 2 min 57 s. Subagent progress exists only in `<project>/<sessionId>/subagents/agent-<agentId>.jsonl`. The pane shows `✻ Waiting for 3 background agents to finish`. A transcript-only reader calls this session done three minutes early.
6. **The registry also says where the session lives.** For example `"tmux":"vp-kestrel:@8.%8"` (session:@window.%pane), so jump-to-terminal can target the tmux pane directly. Every fleet session also has `messagingSocketPath` `/tmp/cc-socks/<pid>.sock`, with `peerProtocol` 1 and features `notify_idle`, `reply_across_default_dirs` and `artifact_yield` (6/6 in both status snapshots). No socket was connected to.

## The six states

Medians are over the trials listed under Raw timings.

| member | state | registry | main transcript tail | pane | under `claude` | other / timing |
|---|---|---|---|---|---|---|
| kestrel | approval (Bash `./deploy.sh --dry-run`) | `waiting`, `waitingFor:"permission prompt"`; flips 75 ms (median, n=17) after the tool_use block | `assistant [thinking]`, `assistant [tool_use Bash]` stop_reason `tool_use`, no `tool_result`. In 3/17 trials: nothing after the user prompt + attachments until resolved | `This command requires approval` / `Do you want to proceed?` / `❯ 1. Yes` / `2. Yes, and don't ask again for: ./deploy.sh *` / `3. No` / `Esc to cancel · Tab to amend` | `caffeinate` only | Dialog 173 ms after the flip. **Esc**: registry `idle` and records `tool_result` + `[Request interrupted by user for tool use]` + `system:turn_duration` written ~0.4 s after the key (n=13). **Yes**: `busy` ~0.3 s after Enter, and a withheld tool_use is flushed with its result. **Yes, don't ask again** writes `Bash(./deploy.sh *)` into `.claude/settings.local.json`; `rearm` strips it. |
| vibepet | done | `idle`; flips 52–138 ms after the final text block is generated | `assistant [thinking]`, `assistant [text]` stop_reason `end_turn`, `system:turn_duration`; written 119–217 ms after the flip | empty `❯` (a grey prompt suggestion may sit in the input; it is not typed) | none | Indistinguishable from /loop-idle or a fresh session by registry alone. |
| atlas | working (foreground Bash, 9 min) | `busy`; `statusUpdatedAt` frozen at the flip for the whole run | pending `tool_use Bash` (no `tool_result`); **zero records written during the run** | `⏺ Bash(./build.sh)` / last 4 output lines / `+19 lines (3m 48s · timeout 10m)` / `(ctrl+b ctrl+b (twice) to run in background)` / spinner + `esc to interrupt` | `bash -c source …/shell-snapshots/…` → `sh ./build.sh` → `sleep 10`; first child 1.8 s after the record is written | Registry `busy` came 1.0 s after Enter. Identical on disk to an approval whose record was written; only registry, process tree and pane tell them apart. |
| beacon | question (AskUserQuestion) | `waiting`, `waitingFor:"input needed"`; flips 51 ms after the tool_use block | pending `tool_use AskUserQuestion` (6/8), or **only the user prompt** (2/8; the live fixture has been in this case for over 60 min) | `☐ Database choice` / question / `❯ 1. SQLite` … `4. Type something.` / `5. Chat about this` / `Enter to select · ↑/↓ to navigate · Esc to cancel` | `caffeinate` only | Dialog 106 ms after the flip. Esc gives the same records as for an approval; registry `idle` ~0.2–1.6 s later. |
| delta | fan-out (3 subagents) | `busy` from the prompt to the last subagent's notification (2 min 57 s); no `waitingFor` | 3 × (`assistant [tool_use Agent]` → immediate `tool_result` with `isAsync`), then `end_turn` 8.5 s after the prompt. As each agent finishes: `queue-operation`, then a user record with `turnOrigin:"task_notification"` that starts a new main turn | `✻ Waiting for 3 background agents to finish`, then `⏺ Agent "…" finished · 2m 40s` ×3 | 3 × (`bash -c source …` → `sh ./slow.sh shard-N` → `sleep 10`) | First subagent record 4.7 s after the prompt. Subagent files carry `isSidechain:true` and `agentId`; their first response's stop_reason is `null` (streamed thinking). |
| ember | /loop idle (`/loop 5m run ./tick.sh`) | `idle` between fires; `busy` for 2–13 s per fire | `CronCreate` tool_use `{cron:"*/5 * * * *", recurring:true}` → result `{id, humanSchedule:"Every 5 minutes", recurring, durable:false}`. Per fire: `queue-operation` ×2, `system:scheduled_task_fire {taskId}`, user record (`isMeta`, `scheduledTaskId`, `turnOrigin:"scheduled"`), tool_use Bash, `end_turn`, `system:turn_duration` | `✻ Running scheduled task (Oct 1 3:58pm)` for each fire | none between fires | Lock `<cwd>/.claude/scheduled_tasks.lock` = `{sessionId, pid, procStart, acquiredAt}`. **Next fire**: not recorded. Awake fires of `*/5` came every 284.6–285.9 s (n=6; ≈0.95 × period, never on :00/:05 boundaries). A fire missed while the Mac slept ran right after wake (21:24:40Z and 21:41:27Z, seconds after DarkWakes). `durable:false`: `claude --resume` restores the job and catches up a missed fire at once. `CronCreate` is a deferred tool, so the first /loop turn calls `ToolSearch` first. |

## Timing summary (ms)

| interval | approval (kestrel, kx1/2) | question (beacon) |
|---|---|---|
| prompt Enter → registry `busy` | median 306, p90 1144 (n=17) | 269, p90 782 (n=8) |
| prompt Enter → pane spinner | 458, p90 1410 | 451, p90 923 |
| prompt Enter → user record written | 487, p90 1303 | 360, p90 883 |
| tool_use block timestamp → registry `waiting` | **75**, p90 217, max 653 (n=17) | **51**, p90 121 (n=7) |
| registry `waiting` → dialog visible in pane | **173**, p90 895 (n=17) | **106**, p90 133 (n=8) |
| dialog visible → tool_use record written | **−35**, range −165…+430 (n=14) | **+54**, range −82…+95 (n=6) |
| tool_use record **withheld while the dialog was up** | **3 of 17** (3.5 s, 57 s, 191 s, released by Esc/approve) | **2 of 8** (3 s; one never written, 60+ min) |
| done: final text generated → registry `idle` | 52–138 (n=3) | |
| done: registry `idle` → `end_turn` record written | 119–217 (n=3) | |
| Bash tool_use written → tool child process | 1354–1768 (n=2) | |

Outliers in the raw table are probe stalls, not Claude Code. The machine runs ~15 other sessions; probe.js logs every poll iteration over 150 ms as a `stall` event. Examples: `beacon-arm` saw the registry flip 5.7 s late; `kestrel-trial-7` had a 1.76 s stall; `newdir-kx2` likely too.

## Validity: the Mac slept during round 0

`pmset -g log` shows sleeps from 20:27:59Z to 20:38:41Z (low-power sleep on battery, woken by AC attach), 21:07:29–21:08:52Z (idle), and 21:09:38–21:49:15Z (lid closed; two short DarkWakes at 21:24:38 and 21:41:24). Every process, Claude Code timers included, is frozen while the Mac sleeps.

- `probe-ember-idle-and-firing` (20:26:52–20:38:42Z, "no fire in 709 s") is **invalid**: the machine was asleep for 10.7 of those minutes. The first fire came 2 s after wake.
- ember's 15- and 17-minute fire gaps after 21:09Z are sleep, not Claude Code.
- No approval or question trial overlaps a sleep window.

Later rounds should check `pmset -g log` before trusting any interval over a few seconds. Consider running with the lid open on AC, or `caffeinate -dis` for the length of a run; that is a user decision.

## Raw timings

Columns are wall-clock ms. Sources:
- *gen*: transcript record `timestamp` (Claude Code's clock: block received).
- *reg*: registry `statusUpdatedAt` (Claude Code's clock).
- *written*: when probe.js saw the line appended (25 ms poll).
- *pane*: first `capture-pane` match (50 ms poll).
- *child*: first tool process seen (250 ms poll).

`cancel-N` probes press Esc on the dialog left by `trial-(N-1)` (or by `arm`/`pilot`). Their "send" column is the keypress.
| label | tool | send→reg busy | send→user rec written | tool_use gen→reg waiting | reg waiting→pane dialog | reg waiting→tool_use written | tool_use gen→written | tool_use written→child | send→pane spinner | first subagent rec | end_turn gen→reg idle | reg idle→end_turn written |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| atlas-arm | Bash | 1025 | 1656 |  |  |  | 342 | 1768 | 1351 |  |  |  |
| beacon-arm | AskUserQuestion | 3110 | 11126 | 131 | 5818 | 5736 | 5867 |  | 3361 |  |  |  |
| beacon-cancel-10 | - |  | 1116 |  |  |  |  |  |  |  |  |  |
| beacon-cancel-11 | - |  | 370 |  |  |  |  |  |  |  |  |  |
| beacon-cancel-5 | - |  | 284 |  |  |  |  |  |  |  |  |  |
| beacon-cancel-6 | AskUserQuestion |  | 121 |  |  |  | 3113 |  |  |  |  |  |
| beacon-cancel-7 | - |  | 357 |  |  |  |  |  |  |  |  |  |
| beacon-cancel-8 | - |  | 299 |  |  |  |  |  |  |  |  |  |
| beacon-cancel-9 | - |  | 374 |  |  |  |  |  |  |  |  |  |
| beacon-trial-10 | AskUserQuestion | 113 | 202 | 37 | 25 | 120 | 157 |  | 242 |  |  |  |
| beacon-trial-11 | - | 226 | 286 |  | 72 |  |  |  | 328 |  |  |  |
| beacon-trial-5 | - | 114 | 182 |  | 71 |  |  |  | 189 |  |  |  |
| beacon-trial-6 | AskUserQuestion | 269 | 360 | 77 | 133 | 162 | 239 |  | 451 |  |  |  |
| beacon-trial-7 | AskUserQuestion | 228 | 281 | 121 | 58 | 112 | 233 |  | 254 |  |  |  |
| beacon-trial-8 | AskUserQuestion | 782 | 883 | 46 | 127 | 116 | 162 |  | 923 |  |  |  |
| beacon-trial-9 | AskUserQuestion | 350 | 475 | 51 | 106 | 173 | 224 |  | 519 |  |  |  |
| delta-arm | Agent | 344 | 495 |  |  |  | 1650 | 1354 | 373 | 4668 |  |  |
| ember-arm | ToolSearch | 1651 | 2395 |  |  |  | 1095 |  | 1753 |  | 116 | 217 |
| ember-idle-and-firing | - |  |  |  |  |  |  |  |  |  |  |  |
| kestrel-approval-pilot | - | 669 | 879 |  | 17 |  |  |  | 919 |  |  |  |
| kestrel-approve-once | Bash | 307 |  |  |  |  | 56996 |  | 746 |  | 138 | 135 |
| kestrel-arm | Bash | 1163 | 1586 | 653 | 243 | 202 | 855 |  | 1558 |  |  |  |
| kestrel-cancel-1 | - |  | 836 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-10 | - |  | 409 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-11 | - |  | 327 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-12 | - |  | 288 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-13 | - |  | 378 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-2 | - |  | 791 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-3 | - |  | 298 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-4 | - |  | 1423 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-5 | - |  | 155 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-6 | Bash |  | 390 |  |  |  | 3578 |  |  |  |  |  |
| kestrel-cancel-7 | - |  | 1900 |  |  |  |  |  |  |  |  |  |
| kestrel-cancel-8 | Bash |  | 430 |  |  |  | 190633 |  |  |  |  |  |
| kestrel-cancel-9 | - |  | 426 |  |  |  |  |  |  |  |  |  |
| kestrel-trial-1 | Bash | 847 | 873 | 255 | 203 | 261 | 516 |  | 903 |  |  |  |
| kestrel-trial-10 | Bash | 205 | 233 | 137 | 105 | 535 | 672 |  | 271 |  |  |  |
| kestrel-trial-11 | Bash | 138 | 261 | 96 | 173 | 131 | 227 |  | 305 |  |  |  |
| kestrel-trial-12 | Bash | 376 | 487 | 52 | 95 | 124 | 176 |  | 458 |  |  |  |
| kestrel-trial-13 | Bash | 213 | 240 | 75 | 32 | 142 | 217 |  | 277 |  |  |  |
| kestrel-trial-2 | Bash | 306 | 598 | 67 | 546 | 455 | 522 |  | 644 |  |  |  |
| kestrel-trial-3 | Bash | 1223 | 1303 | 217 | 895 | 730 | 947 |  | 1410 |  |  |  |
| kestrel-trial-4 | Bash | 509 | 777 | 40 | 36 | 158 | 198 |  | 897 |  |  |  |
| kestrel-trial-5 | - | 94 | 131 |  | 86 |  |  |  | 142 |  |  |  |
| kestrel-trial-6 | Bash | 171 | 217 | 58 | 255 | 210 | 268 |  | 231 |  |  |  |
| kestrel-trial-7 | - | 283 | 353 |  | 1470 |  |  |  | 364 |  |  |  |
| kestrel-trial-8 | Bash | 138 | 223 | 60 | 155 | 120 | 180 |  | 257 |  |  |  |
| kestrel-trial-9 | Bash | 351 | 520 | 107 | 303 | 217 | 324 |  | 568 |  |  |  |
| newdir-kx1 | Bash | 1144 | 3245 | 91 | 43 | 247 | 338 |  | 1561 |  |  |  |
| newdir-kx2 | Bash | 277 | 438 | 198 | 1560 | 1483 | 1681 |  | 338 |  |  |  |
| vibepet-arm | Read | 512 | 697 |  |  |  | 211 |  | 593 |  | 52 | 119 |

| trial | waitingFor | tool_use gen→reg waiting | reg waiting→pane dialog | pane dialog→tool_use written | record written while dialog up |
|---|---|---|---|---|---|
| beacon-arm | (not logged) | 131 | 5818 | -82 | yes |
| beacon-trial-5 | input needed | 18 | 71 | 3024 | NO - written 3 s after the flip, during beacon-cancel-6 |
| beacon-trial-6 | input needed | 77 | 133 | 29 | yes |
| beacon-trial-7 | input needed | 121 | 58 | 54 | yes |
| beacon-trial-8 | input needed | 46 | 127 | -11 | yes |
| beacon-trial-9 | input needed | 51 | 106 | 67 | yes |
| beacon-trial-10 | input needed | 37 | 25 | 95 | yes |
| beacon-trial-11 | input needed |  | 72 |  | NO - not written within the 4 s probe window, never seen later |
| kestrel-approval-pilot | (not logged) | 31 | 17 | 56948 | NO - written 57 s after the flip, during kestrel-approve-once |
| kestrel-arm | (not logged) | 653 | 243 | -41 | yes |
| kestrel-trial-1 | (not logged) | 255 | 203 | 58 | yes |
| kestrel-trial-2 | (not logged) | 67 | 546 | -91 | yes |
| kestrel-trial-3 | (not logged) | 217 | 895 | -165 | yes |
| kestrel-trial-4 | (not logged) | 40 | 36 | 122 | yes |
| kestrel-trial-5 | permission prompt | 20 | 86 | 3472 | NO - written 4 s after the flip, during kestrel-cancel-6 |
| kestrel-trial-6 | permission prompt | 58 | 255 | -45 | yes |
| kestrel-trial-7 | permission prompt | 20 | 1470 | 189143 | NO - written 191 s after the flip, during kestrel-cancel-8 |
| kestrel-trial-8 | permission prompt | 60 | 155 | -35 | yes |
| kestrel-trial-9 | permission prompt | 107 | 303 | -86 | yes |
| kestrel-trial-10 | permission prompt | 137 | 105 | 430 | yes |
| kestrel-trial-11 | permission prompt | 96 | 173 | -42 | yes |
| kestrel-trial-12 | permission prompt | 52 | 95 | 29 | yes |
| kestrel-trial-13 | permission prompt | 75 | 32 | 110 | yes |
| newdir-kx1 | (not logged) | 91 | 43 | 204 | yes |
| newdir-kx2 | (not logged) | 198 | 1560 | -77 | yes |
