export const meta = {
  name: 'vibepet-ultra-round',
  description: 'One ratchet round on vibepet: drive 7 surfaces on the live Haiku fleet, hostile critic + two blind raters, triage, fix each confirmed bug + the lowest surface in its own worktree with gates, merge green to ultra/round-N',
  phases: [
    { title: 'Setup', detail: 'round branch, fleet re-armed, base canon' },
    { title: 'Drive', detail: 'one Playwright driver per surface' },
    { title: 'Critic', detail: 'hostile re-run of every logged bug' },
    { title: 'Score', detail: 'two blind raters per surface' },
    { title: 'Triage', detail: 'dedup, fix tasks, top fix for lowest surface' },
    { title: 'Fix', detail: 'one worktree per task: unit test + recapture + canon' },
    { title: 'Gate', detail: 'skeptical regression judge per fix' },
    { title: 'Merge', detail: 'serial merge into ultra/round-N, revert regressions' },
    { title: 'Ledger', detail: 'REPORT.md score table + bug ledger' },
  ],
}

const N = args.round, PREV = N - 1, PAIRED = N >= 2
const STOP = args.spendStop
const REPO = '/Users/christopherharris/projects/vibepet'
const ULTRA = '/Users/christopherharris/.vibepet-ultra'
const EVID = REPO + '/docs/ultra'

const CTX = `You are one agent in "vibepet ultra": a looped quality ratchet on vibepet, an Electron desktop pixel pet ("Net") that watches the user's Claude Code sessions (transcripts, git trees, localhost ports) and lets them act on those sessions. Target: the best tool for one person running 5-15 Claude Code sessions at once, plus one feature no other tool has (Collision Radar).

PATHS
- REPO = ${REPO} : the user's main checkout. It stays on branch main. Never commit to main; never checkout/switch/reset/stash/clean inside REPO; never touch its untracked files. Make worktrees with: git -C ${REPO} worktree add <path> -b <branch> <base>  (retry if a .lock is busy). node_modules in a worktree = symlink to ${ULTRA}/int/node_modules (already git-excluded); never git add -A blindly - add the files you changed.
- ULTRA = ${ULTRA} : integration worktree ULTRA/int (branch ultra/round-${N}), fix worktrees ULTRA/wt/*, fixture-fleet repos ULTRA/fleet/*, isolated watch root ULTRA/root/.claude, Electron userData ULTRA/userdata/*.
- EVID = ${EVID} : evidence. Untracked in REPO on purpose; never git-add it. Rubric: ${EVID}/rubric.md. Round 0 references: ${EVID}/round-0/ (surface-map.md, fleet.md, fleet-states.md, benchmark.md, ground-truth.md, feature-ranking.md, integration.md, tta-before.md). Harness docs: ${ULTRA}/int/test/ultra/README.md.

HARD RULES
1. No git push. No release (npm run dist, electron-builder, gh release). No site deploy (wrangler, site/).
2. Real transcripts (~/.claude/projects except dirs containing "-vibepet-ultra-fleet-") are READ-ONLY and their text must never be printed, copied, or screenshotted. Launch vibepet only through test/ultra/launch.js with root ${ULTRA}/root/.claude (the isolated fleet root). Never start a screen recording (it captures the user's real screen).
3. The user has ~15 live Claude Code sessions. Never send keys/messages to, signal, or kill any process you did not start. Never write ~/.claude/settings*.json, ~/.claude.json, ~/.claude/sessions/*, ~/.claude/projects/*, or the Keychain.
4. Fleet = real Claude Code sessions on Haiku in tmux (test/fleet/fleet.js; usage in ${EVID}/round-0/fleet.md). Before changing a member's state take its lease (fleet.js lease <member> <owner>), re-arm what you consumed, then release. Stop making fleet sessions take turns once the fleet spend ESTIMATE (the "~$X incl. hidden calls" figure from fleet.js spend) reaches $${STOP}. The budget is tight: kestrel/beacon/vibepet re-arms are cheap (~$0.01-0.02 warm); delta fan-outs cost ~$0.10 each and ember's loop ~$0.17/h - only use them where your brief says so, and pause ember again when done.
5. Test against the live fleet, never mocks. Fault injection at the network boundary is allowed for error states (e.g. ANTHROPIC_BASE_URL pointing at a local server that returns 429; an unreachable proxy for offline). The unit gate is npm test (node --test test/*.test.js).
6. Commits: small, focused; message ends with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
7. The machine is a laptop shared with the user's own work: record the load average (uptime) next to every timing you report; repeat timing-critical measurements and report medians.
Your final answer is data for the orchestrator (structured output), not prose for a human.`

const SURFACES = [
  { id: 'S1', name: 'Net Home panel', rearms: 5, budget: 'Fleet budget: you are the only driver allowed to fan out delta (once, right before its truth-table check) and to start ember (fleet.js rearm ember; pause it when your loop checks are done). Re-arm atlas just before you need it working.', flows: `F1 open: click the pet -> Net Home panel visible; time click->visible (x5, median); close (Esc / click-away) and reopen.
F2 truth table: for each fleet member compare its row (name, state label, ask text, age/since, fan-out gauge, loop info) with fleet.js status --json and its transcript tail -> per member: correct? what's wrong?
F3 priority: does the panel lead with what needs the user (approval, question), ordered by how long each has waited? Is the wait visible?
F4 live latency: lease kestrel, re-arm it (fresh approval prompt) and time from the new tool_use record's timestamp to the row showing it needs approval (poll the DOM every 250 ms); same for beacon (fresh AskUserQuestion) and for a member finishing a turn. Up to 3 trials each within budget.
F5 parked: a member idle > 5 min after finishing - still visible/discoverable? Right for someone juggling 10 sessions?
F6 the other sections: Setup card, localhost, recording render and read well (never start a recording).
F7 geometry: fully on screen, legible, not clipped; light/dark if supported.` },
  { id: 'S2', name: 'Chat', rearms: 3, budget: 'Chat itself must use its REAL engine for F1/F2/F5 (the user\'s own claude login - it is not fleet spend; a fresh userData defaults to its normal model). Do not fan out delta or start ember.', flows: `F1 first token: open chat from the panel; ask "what's my agent doing?" -> time Enter -> first visible model token, and -> complete (x3). Streaming or all at once?
F2 claims: ask "what is each of my sessions doing right now?", "what does kestrel need from me?", "is delta done?", "what did atlas change?". Split each answer into atomic claims; check EVERY claim against the fleet transcripts (jsonl) and fleet status: true / false / unverifiable.
F3 error states by fault injection: no-key (claude CLI not findable + no ANTHROPIC_API_KEY - read how main.js findClaude resolves the binary and defeat it via env, e.g. VIBEPET_CLAUDE_BIN=/nonexistent plus a PATH without claude), offline (ANTHROPIC_BASE_URL=http://127.0.0.1:9 or an unreachable proxy for the claude child), 429 (ANTHROPIC_BASE_URL -> a local server returning 429 + retry-after + Anthropic-style error JSON). Screenshot each; does the copy tell the user exactly what to do?
F4 history across restart: send 2 messages, close the app, relaunch with the same userData -> conversation still there? scroll position?
F5 command routing: lease kestrel; type "@kestrel approve" -> does it reach kestrel (its transcript shows the approved command ran)? Lease vibepet; type "tell the vibepet session to run its tests" -> does vibepet get it (its transcript shows the prompt and a test run)? Re-arm both.
F6 keyboard: open/close by keyboard, Enter sends, Shift+Enter newline, Esc closes, focus.
F7 every bar in ${EVID}/round-0/benchmark.md: pass/fail with evidence.` },
  { id: 'S3', budget: 'Do not fan out delta or start ember.', name: 'Command bar', rearms: 2, flows: `F1 open the command bar every way the UI offers; time to visible (x5).
F2 every command it supports (from UI hints and the code): run each against the fleet; result + latency.
F3 targeting: partial/fuzzy session names, unknown names, similar names; error copy.
F4 keyboard-only: autocomplete, history, Esc, Enter, arrows.
F5 can a block be resolved from the command bar (approve / answer / reply / jump) without the mouse?` },
  { id: 'S4', budget: 'Do not fan out delta or start ember.', name: 'Row actions (jump / approve / reply / replay / goal / done)', rearms: 6, flows: `F1 jump on each member: which terminal/pane gets focus? (fleet runs in tmux; if fleet.js attach exists, open the attached Terminal window first; check the active tmux pane via tmux display-message -p and the frontmost app.) Time + correctness.
F2 approve kestrel (lease): does the approved command actually run (transcript tool_result)? Clicks, latency, feedback on the pet. Re-arm.
F3 answer beacon's AskUserQuestion from the pet (lease): delivered? Re-arm.
F4 reply to a member that ended its turn with a plain question (lease one, prompt it to ask): delivered? Re-arm.
F5 replay: opens Theater on the right session?
F6 goal: set, edit, clear; where shown; persists across restart?
F7 done: what it does; reversible?
F8 actions a 5-15-session user needs but can't find (deny, stop/interrupt, open diff...): list them as bugs (severity by how often they'd bite).` },
  { id: 'S5', name: 'Theater replay', rearms: 0, budget: 'Replays read existing transcripts: never make a fleet session take a turn.', flows: `F1 open replay for each member (incl. delta with subagents, ember's loop, atlas's long Bash) from the row and every other entry point; time to first frame.
F2 fidelity: spot-check >= 10 events per replay against the fleet transcript (order, content, timing, tool names).
F3 controls: play/pause/seek/speed/close, keyboard; end of replay; very long sessions.
F4 performance: open time, jank (frame timestamps), theater window memory.` },
  { id: 'S6', budget: 'Do not fan out delta or start ember.', name: 'Ports / localhost', rearms: 2, flows: `F1 lease a member; start a dev server inside its repo the way that session would (ask the session to run it, or run it with that repo as cwd), e.g. python3 -m http.server <port> or a tiny node server; time until the localhost section shows it, and is it attributed to the right session?
F2 open + stop: does stop kill exactly that server and only it? Feedback?
F3 conflict: a second server on the same port from another member's repo - what does vibepet show?
F4 server exits: time until it disappears.
F5 servers started outside any session; noise filtering.
Clean up every server you started.` },
  { id: 'S7', budget: 'Do not fan out delta or start ember.', name: 'Gestures + global jump key', rearms: 2, hotkey: 'Control+Alt+Command+J', flows: `F1 launch with hotkey Control+Alt+Command+J (launch.js hotkey option); verify it registered (no key-taken banner).
F2 trigger it OS-level first (osascript System Events key code with modifiers); if not permitted, trigger the registered handler through the VIBEPET_TEST hook and say so. Where does it go? In what order does repeated pressing walk the sessions (should be: what needs you, longest-blocked first)? Does it land on the right tmux pane?
F3 gestures: read gesture.js for the supported gestures; perform each on the pet with Playwright mouse moves; recognized? right action? latency? false positives while dragging or clicking the pet?
F4 gesture teaching flows if present (sample / undo / cancel).` },
]

const tok = (n, i) => 'p' + String(((n * 7 + i + 3) * 7919) % 99991)
const s = r => r ? JSON.stringify(r).slice(0, 6000) : '(no result)'
const safe = p => p.catch(e => { log('agent error: ' + (e && e.message)); return null })

const R = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, branch: { type: 'string' }, artifacts: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'artifacts', 'issues'] }
const DRV = { type: 'object', properties: { pack: { type: 'string' }, bugs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, severity: { type: 'string' } }, required: ['id', 'title', 'severity'] } }, timings: { type: 'string' }, summary: { type: 'string' } }, required: ['pack', 'bugs', 'summary'] }
const CRIT = { type: 'object', properties: { confirmed: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, severity: { type: 'string' }, cause: { type: 'string' } }, required: ['id', 'title', 'severity'] } }, rejected: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'verdict'] } }, summary: { type: 'string' } }, required: ['confirmed', 'rejected'] }
const AX = { type: 'object', properties: { correctness: { type: 'number' }, speed: { type: 'number' }, clarity: { type: 'number' }, agency: { type: 'number' }, delight: { type: 'number' }, rationale: { type: 'string' } }, required: ['correctness', 'speed', 'clarity', 'agency', 'delight', 'rationale'] }
const RATE = PAIRED
  ? { type: 'object', properties: { X: AX, Y: AX, top: { type: 'array', items: { type: 'string' } } }, required: ['X', 'Y', 'top'] }
  : { type: 'object', properties: { X: AX, top: { type: 'array', items: { type: 'string' } } }, required: ['X', 'top'] }
const TASKS = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: {
  id: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string', enum: ['bug', 'lowest'] }, surface: { type: 'string' },
  bugIds: { type: 'array', items: { type: 'string' } }, brief: { type: 'string' }, files: { type: 'array', items: { type: 'string' } },
  acceptance: { type: 'string' }, priority: { type: 'number' }, wave: { type: 'number', enum: [1, 2] } }, required: ['id', 'title', 'kind', 'surface', 'bugIds', 'brief', 'acceptance', 'priority', 'wave'] } },
  coverage: { type: 'string' } }, required: ['tasks', 'coverage'] }
const FIX = { type: 'object', properties: { ok: { type: 'boolean' }, branch: { type: 'string' }, tests: { type: 'string' }, recapture: { type: 'string' }, canon: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, left: { type: 'string' } }, required: ['ok', 'branch', 'tests', 'changed'] }
const GATE = { type: 'object', properties: { verdict: { type: 'string', enum: ['green', 'red'] }, reasons: { type: 'array', items: { type: 'string' } }, surfacesWorse: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'reasons'] }
const LEDGER = { type: 'object', properties: { report_md: { type: 'string', description: 'the full updated REPORT.md' }, readme_md: { type: 'string', description: 'round-N/README.md' }, summary: { type: 'string' } }, required: ['report_md', 'readme_md', 'summary'] }
const MERGE = { type: 'object', properties: { merged: { type: 'array', items: { type: 'string' } }, reverted: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } }, tests: { type: 'string' }, canon: { type: 'string' }, head: { type: 'string' }, summary: { type: 'string' } }, required: ['merged', 'reverted', 'skipped', 'tests', 'head'] }

// ---------- prompts ----------
const SETUP = `${CTX}

ROUND ${N} - SETUP.
1. In ${ULTRA}/int: clean tree on ultra/round-${PREV}; git switch -c ultra/round-${N} (if it exists, switch to it). npm test green (< 60 s).
2. If test/fleet/fleet.js lacks lease/release, add them (lease <member> <owner> [--ttl 1800]: atomic mkdir lock under ${ULTRA}/fleet/.leases, stale after ttl; release <member>; status shows holders) with a unit test; commit on ultra/round-${N}.
3. fleet.js status; re-arm kestrel, beacon and vibepet if they are not in their target states (cheap); leave atlas, delta and ember paused - drivers re-arm them just in time (spend stop $${STOP}). For any NEW claude launch, consider env DISABLE_NON_ESSENTIAL_MODEL_CALLS=1 to cut hidden-call overhead (measure; keep it only if states still verify). fleet.js root. Report spend.
4. Base canon: node test/ultra/canon.js --app ${ULTRA}/int --out ${EVID}/round-${N}/canon-base --userdata ${ULTRA}/userdata/r${N}-canon-base
5. mkdir -p ${EVID}/round-${N}/packs ${EVID}/round-${N}/bugs ${EVID}/round-${N}/fixes ${ULTRA}/blind
${args.setupExtra || ''}
Return fleet status, spend, canon assertion summary.`

const driverPrompt = (S, i) => `${CTX}

ROUND ${N} - DRIVE surface ${S.id} "${S.name}". You drive this one surface.
Launch vibepet from ${ULTRA}/int with test/ultra/launch.js: root ${ULTRA}/root/.claude, userData ${ULTRA}/userdata/r${N}-${S.id}, hotkey ${S.hotkey || 'off'}. Read first: your surface's section of ${EVID}/round-0/surface-map.md, ${ULTRA}/int/test/ultra/README.md, ${EVID}/round-0/fleet.md, ${EVID}/rubric.md${S.id === 'S2' ? ', ' + EVID + '/round-0/benchmark.md' : ''}. Ground truth for every check = fleet.js status --json plus the fleet transcripts (fixtures: you may read them).
Known baseline mismatches from Round 0 are listed in ${EVID}/round-0/baseline/notes.md and ${EVID}/REPORT.md section 4 (M1-M15, T1-T3, CH1-CH41). Re-verify those on your surface and log each that still holds as a bug with fresh evidence (cite the M/T/CH id in the title); then hunt for new ones.
${S.budget || ''}
${args.driveExtra || ''}
Run these flows through the REAL UI (clicks, keys, mouse moves; not IPC shortcuts unless a flow says so), timestamping every latency and repeating timing-sensitive steps (median):
${S.flows}
Then explore for ~10 minutes: anything a person running 5-15 sessions would trip on.
Rearm budget: ${S.rearms}.

OUTPUT
- Evidence pack ${EVID}/round-${N}/packs/${S.id}/: log.md (each flow: steps, expected, actual, pass/fail, member + its true state), timings.json ([{flow, step, ms, n}]), shots/NN-<flow>-<step>.png. Never mention round numbers, branch names or fixes inside the pack (raters are blind).
- Then: mkdir -p ${ULTRA}/blind/${tok(N, i)} && cp -R the pack's contents into it.
- Bugs: ${EVID}/round-${N}/bugs/${S.id}.jsonl, one JSON object per line: {"id":"r${N}-${S.id}-NN","surface":"${S.id}","title","severity":"blocker|major|minor|polish","repro":[steps],"expected","actual","evidence":[screenshot paths / timing refs],"member","truth"}. A bug = anything wrong, slower than the rubric's 95 anchors, unclear, or forcing the user to leave the pet. Concrete and reproducible; one root cause = one bug.
Return the pack path, bug ids + titles + severities, headline timings.`

const criticPrompt = (S, i, drv) => `${CTX}

ROUND ${N} - HOSTILE CRITIC for surface ${S.id} "${S.name}". The driver logged bugs in ${EVID}/round-${N}/bugs/${S.id}.jsonl. Driver result: ${s(drv)}
Kill every bug that isn't real. For each: re-run its repro from scratch on a FRESH app (launch.js from ${ULTRA}/int, root ${ULTRA}/root/.claude, userData ${ULTRA}/userdata/r${N}-${S.id}-critic, hotkey ${S.hotkey || 'off'}) against the live fleet, up to 2 attempts. It survives only if you reproduce it yourself with your own screenshot/timing. Find the cause in the code (file:line) and check the claim against the fleet's ground truth.
Verdicts: confirmed | not-reproduced | not-a-bug (behaves as designed AND that design is fine for a 5-15-session user; if the design itself hurts that user, it's confirmed) | duplicate-of:<id>. Rearm budget: ${Math.max(2, Math.ceil(S.rearms / 2))}.
Write ${EVID}/round-${N}/bugs/${S.id}.verdicts.jsonl ({"id","verdict","why","evidence":[...],"cause":"file:line"}). Return confirmed (with cause) and rejected.`

const raterPrompt = (S, i, who) => {
  const cur = `${ULTRA}/blind/${tok(N, i)}`, prev = `${ULTRA}/blind/${tok(PREV, i)}`, xIsCur = (N + i) % 2 === 0
  const v = PAIRED ? `Variant X: ${xIsCur ? cur : prev}\nVariant Y: ${xIsCur ? prev : cur}` : `Variant X: ${cur}`
  return `${CTX}

BLIND RATER ${who} for surface ${S.id} "${S.name}". Score with the rubric at ${EVID}/rubric.md (axes + anchors). You are blind on purpose: do not open anything else under ${EVID} (no round folders, REPORT.md, bug files) and no git history.
${v}
Each variant is an evidence pack (log.md, timings.json, shots/). View every screenshot. You may check claims against the fleet's ground truth (cd ${ULTRA}/int && node test/fleet/fleet.js status --json; fleet transcripts) but do not launch the app.
Score ${PAIRED ? 'each variant' : 'it'} 0-100 on correctness, speed, clarity, agency, delight - strictly against the rubric's anchors - with a 1-2 sentence rationale per axis citing screenshots/timings. Then list the top 3 changes that would most raise this surface's score.`
}

const triagePrompt = (rows, conf, lowest) => `${CTX}

ROUND ${N} - TRIAGE. Confirmed bugs per surface (critic results): ${s(conf)}
Full bug records: ${EVID}/round-${N}/bugs/S*.jsonl + S*.verdicts.jsonl.
Scores this round: ${s(rows)}
Lowest-scoring surface: ${lowest.id} (${lowest.name}); its raters' top changes: ${s(lowest.top)}
Feature context: after this round's fixes, a feature sprint builds and proves the top-3 many-session features from ${EVID}/round-0/feature-ranking.md (1 attention queue: persistent rows, true block age from the Claude Code registry, oldest block first, one order for Home/roster/jump key; 2 "while you were away" digest; 3 loop-aware rows), the chat bar (${EVID}/round-0/benchmark.md) and the Collision Radar. Where confirmed bugs ARE the substance of one of these (e.g. M1/M3/M7/M13/M15 -> attention queue; M8 -> loop-aware rows; chat streaming/errors/history/@session commands), cluster them into one feature-shaped task and fix them properly so the feature becomes real. Don't create tasks for things no confirmed bug calls for (the digest, the radar) - those come next.
${args.triageExtra || ''}
Produce fix tasks:
- Every confirmed bug is covered by exactly one task. Cluster bugs that share a root cause into one task (say which ids). Never drop a confirmed bug.
- Plus exactly one task of kind 'lowest' for ${lowest.id}: the single change most likely to raise its score (from the raters' lists + your read of the code), not already covered by a bug task.
- Each task: short id (kebab, <= 24 chars), title, surface, bugIds, a brief naming the root cause and the intended fix (file:line), likely files, acceptance = the exact recapture that proves it on the live fleet, priority (1 = first), wave: 1 for foundational plumbing other tasks build on (e.g. reading the ~/.claude/sessions registry for needs-you state; tmux pane targeting for jump/approve/reply), 2 for everything else. Wave 2 starts from the merged wave-1 branch, so wave-2 tasks may assume wave-1 behavior exists. Keep wave 1 small.
- Minimize merge conflicts: tasks that must edit the same function should be one task or explicitly ordered.
Write ${EVID}/round-${N}/tasks.json. coverage = one line per confirmed bug id -> task id.`

const fixPrompt = (t, base) => `${CTX}

ROUND ${N} - FIX task ${t.id}: ${t.title} (${t.kind === 'lowest' ? 'top fix for the lowest-scoring surface ' + t.surface : 'confirmed bug(s) ' + t.bugIds.join(', ')}).
Brief: ${t.brief}
Likely files: ${(t.files || []).join(', ')}
Acceptance (your recapture must show this): ${t.acceptance}
Evidence: ${EVID}/round-${N}/bugs/*.jsonl + *.verdicts.jsonl. Map: ${EVID}/round-0/surface-map.md. Claude Code facts the fix may rely on: ${EVID}/round-0/fleet-states.md (registry status/waitingFor flips ~75 ms after a tool_use; the pending tool_use record is often withheld from the transcript while a dialog is open; the registry carries the tmux pane target).
1. git -C ${REPO} worktree add ${ULTRA}/wt/r${N}-${t.id} -b ultra/r${N}/${t.id} ultra/round-${N} ; cd there; ln -s ${ULTRA}/int/node_modules node_modules (no new dependencies unless unavoidable - say why).
2. Fix the root cause in the style of the surrounding code (terse, dense; comment density like its neighbors). No speculative refactors. Anything that types into a terminal must target exactly one verified pane/tab and refuse otherwise.
3. Add or extend a unit test (test/*.test.js, node --test) that fails before and passes after wherever the logic is testable. npm test passes (< 60 s).
4. Recapture against the live fleet from YOUR worktree (launch.js appDir = worktree, userData ${ULTRA}/userdata/r${N}-${t.id}): run the repro, show it fixed (screenshots + timings) in ${EVID}/round-${N}/fixes/${t.id}/after/; copy the original bug evidence into .../before/. Rearm budget 2.
5. node test/ultra/canon.js --app <worktree> --out ${EVID}/round-${N}/fixes/${t.id}/canon --userdata ${ULTRA}/userdata/r${N}-${t.id}-canon : every assertion that passes in ${EVID}/round-${N}/${base} must still pass (if an assertion encodes the old, buggy behavior you fixed, update canon.js and say so).
6. Commit on ultra/r${N}/${t.id}.
Return ok (all gates met), branch, test result, recapture + canon paths, files changed, anything left.`

const gatePrompt = (t, fx, base) => `${CTX}

ROUND ${N} - GATE for fix ${t.id} (${t.title}), branch ultra/r${N}/${t.id}, worktree ${ULTRA}/wt/r${N}-${t.id}. The fixer claims: ${s(fx)}
Verify independently and skeptically:
1. npm test passes in the worktree (run it; time it).
2. The recapture in ${EVID}/round-${N}/fixes/${t.id}/after/ really shows: "${t.acceptance}" (view the screenshots; compare with before/).
3. No other surface got worse: compare ${EVID}/round-${N}/${base}/ with ${EVID}/round-${N}/fixes/${t.id}/canon/ for every surface except ${t.surface} (screenshots + assertion JSON). Live fleet content (ages, counts) may differ between captures - judge layout, correctness, clarity, function. Any surface worse -> red.
4. Read the diff (git -C <worktree> diff ultra/round-${N}...HEAD): flag risk (keystrokes that could land in the wrong pane, privacy leaks, defaults changed when env overrides are unset, swallowed errors).
Green only if all four hold.`

const mergePrompt = (greens, reds, wave, base) => `${CTX}

ROUND ${N} - MERGE wave ${wave}. Green branches, in priority order: ${JSON.stringify(greens)}. Red (do not merge): ${JSON.stringify(reds)}.
In ${ULTRA}/int on ultra/round-${N}: for each green branch in order, git merge --no-ff <branch>; resolve conflicts correctly (read both sides, keep both intents); npm test after each merge; if a merge can't be made green with reasonable effort, abort it and record why.
After all merges: node test/ultra/canon.js --app ${ULTRA}/int --out ${EVID}/round-${N}/canon-merged-w${wave} --userdata ${ULTRA}/userdata/r${N}-canon-merged-w${wave} ; compare with ${base}. If a surface regressed, find the responsible merge (bisect the merge commits), fix it within this round if you can; otherwise git revert -m 1 that merge and record it.
Append to ${EVID}/round-${N}/merge.md. Return merged, reverted, skipped (with reasons), final npm test result, canon status, head commit.`

const ledgerPrompt = d => `${CTX}

ROUND ${N} - LEDGER. Data: ${s(d)} (plus the files under ${EVID}/round-${N}/).
1. Concatenate ${EVID}/round-${N}/bugs/S*.jsonl into ${EVID}/round-${N}/bugs.jsonl (this round's canonical ledger), each line joined with its critic verdict, task id and merged true/false.
2. Run the privacy check: bash ${EVID}/tools/privacy/run.sh (or its documented equivalent) over ${EVID}/round-${N}; note the result.
3. Return - do not write - two documents (a harness guard refuses subagent-written report files; the orchestrator writes them):
   report_md = the full ${EVID}/REPORT.md, updated in place: keep everything from earlier rounds, fill this round's score-table column (rater A, rater B, mean, disagreement${PAIRED ? ', re-scored previous, delta, counted delta' : ''}; round gain), bug-ledger rows (found / confirmed / fixed with ids), branch row (ultra/round-${N} head, merged, reverted, npm test status), fleet spend row (fleet.js spend), and any TTA/feature/chat cells this round's fixes changed (with evidence paths).
   readme_md = ${EVID}/round-${N}/README.md: one page - scores, bugs, fixes merged, what's left.`

const runWave = async (wave, list, base) => {
  if (!list.length) return { greens: [], reds: [], merge: null }
  const fixed = await pipeline(
    list,
    t => safe(agent(fixPrompt(t, base), { label: 'fix ' + t.id, phase: 'Fix', schema: FIX })),
    (fx, t) => fx ? safe(agent(gatePrompt(t, fx, base), { label: 'gate ' + t.id, phase: 'Gate', schema: GATE })).then(g => ({ t, fx, g })) : { t, fx: null, g: { verdict: 'red', reasons: ['fixer failed'] } },
  )
  const greens = fixed.filter(f => f && f.fx && f.fx.ok && f.g && f.g.verdict === 'green').map(f => 'ultra/r' + N + '/' + f.t.id)
  const reds = fixed.filter(f => f && !(f.fx && f.fx.ok && f.g && f.g.verdict === 'green')).map(f => ({ id: f.t.id, why: (f.g && f.g.reasons) || ['fix not ok'] }))
  log(`wave ${wave}: ${greens.length} green, ${reds.length} red`)
  const merge = greens.length ? await safe(agent(mergePrompt(greens, reds, wave, base), { label: 'merge r' + N + ' w' + wave, phase: 'Merge', schema: MERGE })) : null
  return { greens, reds, merge }
}

// ---------- orchestration ----------
phase('Setup')
const setup = await safe(agent(SETUP, { label: 'setup r' + N, phase: 'Setup', schema: R }))
if (!setup || !setup.ok) log('setup reported problems: ' + s(setup))

const perSurface = await pipeline(
  SURFACES,
  (S, _, i) => safe(agent(driverPrompt(S, i), { label: 'drive ' + S.id, phase: 'Drive', schema: DRV })),
  (drv, S, i) => !drv ? { S, i, drv: null, crit: null, ra: null, rb: null } : parallel([
    () => drv.bugs && drv.bugs.length ? agent(criticPrompt(S, i, drv), { label: 'critic ' + S.id, phase: 'Critic', schema: CRIT }) : Promise.resolve({ confirmed: [], rejected: [], summary: 'no bugs logged' }),
    () => agent(raterPrompt(S, i, 'A'), { label: 'rater A ' + S.id, phase: 'Score', schema: RATE }),
    () => agent(raterPrompt(S, i, 'B'), { label: 'rater B ' + S.id, phase: 'Score', schema: RATE }),
  ]).then(([crit, ra, rb]) => ({ S, i, drv, crit, ra, rb })),
)

const m5 = a => a ? (a.correctness + a.speed + a.clarity + a.agency + a.delight) / 5 : null
const r1 = x => x == null ? null : Math.round(x * 10) / 10
const rows = perSurface.filter(Boolean).map(p => {
  const xIsCur = (N + p.i) % 2 === 0
  const pick = (r, cur) => r ? (PAIRED ? ((xIsCur === cur) ? r.X : r.Y) : (cur ? r.X : null)) : null
  const ax = r => r ? { c: r.correctness, s: r.speed, cl: r.clarity, a: r.agency, d: r.delight } : null
  const a = m5(pick(p.ra, true)), b = m5(pick(p.rb, true))
  const mean = a != null && b != null ? (a + b) / 2 : (a != null ? a : b)
  const d = a != null && b != null ? Math.abs(a - b) : null
  const row = { id: p.S.id, name: p.S.name, A: r1(a), B: r1(b), mean: r1(mean), d: r1(d), axesA: ax(pick(p.ra, true)), axesB: ax(pick(p.rb, true)), top: [...((p.ra && p.ra.top) || []), ...((p.rb && p.rb.top) || [])] }
  if (PAIRED) {
    const pa = m5(pick(p.ra, false)), pb = m5(pick(p.rb, false))
    const prev = pa != null && pb != null ? (pa + pb) / 2 : null, dPrev = pa != null && pb != null ? Math.abs(pa - pb) : 0
    const delta = prev != null && mean != null ? mean - prev : null
    const thr = 2 * Math.max(d || 0, dPrev, 1)
    Object.assign(row, { prev: r1(prev), dPrev: r1(dPrev), delta: r1(delta), counted: delta != null && Math.abs(delta) > thr ? r1(delta) : 0, thr: r1(thr) })
  }
  return row
})
const scored = rows.filter(r => r.mean != null)
const lowest = scored.slice().sort((x, y) => x.mean - y.mean)[0]
const gain = PAIRED && scored.length ? r1(scored.reduce((t, r) => t + (r.counted || 0), 0) / scored.length) : null
log('scores: ' + scored.map(r => `${r.id} ${r.mean} (d ${r.d}${PAIRED ? ', counted ' + r.counted : ''})`).join(' | ') + (gain != null ? ` | gain ${gain}` : ''))

const conf = perSurface.filter(Boolean).map(p => ({ surface: p.S.id, confirmed: (p.crit && p.crit.confirmed) || [], rejected: ((p.crit && p.crit.rejected) || []).length, driverBugs: ((p.drv && p.drv.bugs) || []).length }))
const nFound = conf.reduce((t, c) => t + c.driverBugs, 0), nConfirmed = conf.reduce((t, c) => t + c.confirmed.length, 0)
log(`bugs: found ${nFound}, confirmed ${nConfirmed}`)

phase('Triage')
const triage = await safe(agent(triagePrompt(scored.map(r => ({ id: r.id, name: r.name, A: r.A, B: r.B, mean: r.mean, d: r.d, delta: r.delta, counted: r.counted })), conf, lowest || { id: '?', name: '?', top: [] }), { label: 'triage', phase: 'Triage', schema: TASKS }))
const tasks = ((triage && triage.tasks) || []).slice().sort((x, y) => x.priority - y.priority)
log(`${tasks.length} fix tasks (wave 1: ${tasks.filter(t => t.wave === 1).length})`)

const w1 = await runWave(1, tasks.filter(t => t.wave === 1), 'canon-base')
const w2 = await runWave(2, tasks.filter(t => t.wave !== 1), w1.merge ? 'canon-merged-w1' : 'canon-base')

phase('Ledger')
const data = { round: N, scores: scored, gain, found: nFound, confirmed: nConfirmed, conf, tasks: tasks.map(t => ({ id: t.id, wave: t.wave, kind: t.kind, bugIds: t.bugIds, title: t.title })), coverage: triage && triage.coverage,
  wave1: { greens: w1.greens, reds: w1.reds, merge: w1.merge }, wave2: { greens: w2.greens, reds: w2.reds, merge: w2.merge }, setup: setup && setup.summary }
const ledger = await safe(agent(ledgerPrompt(data), { label: 'ledger r' + N, phase: 'Ledger', schema: LEDGER }))
return { ...data, ledgerSummary: ledger && ledger.summary, report_md: ledger && ledger.report_md, readme_md: ledger && ledger.readme_md, allAbove85: scored.length === 7 && scored.every(r => r.mean >= 85) }
