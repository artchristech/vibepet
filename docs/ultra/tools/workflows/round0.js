export const meta = {
  name: 'vibepet-ultra-round-0',
  description: 'Round 0: ground truth from real transcripts (numbers only), npm test gate + Playwright harness, Haiku tmux fixture fleet, surface map, chat benchmark, feature ranking, baseline TTA',
  phases: [
    { title: 'Ground truth', detail: 'two independent miners -> reconcile -> feature ranking' },
    { title: 'Harness', detail: 'npm test gate, env isolation, Playwright _electron' },
    { title: 'Fleet', detail: '6 Haiku sessions in tmux, states, spend meter' },
    { title: 'Research', detail: 'surface map + Raycast/Warp chat benchmark' },
    { title: 'Integrate', detail: 'ultra/round-0 branch, canonical capture, baseline' },
    { title: 'Baseline TTA', detail: 'before numbers on the live fleet' },
    { title: 'Audit', detail: 'verify deliverables, Round 0 summary, REPORT skeleton' },
  ],
}

const REPO = '/Users/christopherharris/projects/vibepet'
const ULTRA = '/Users/christopherharris/.vibepet-ultra'
const EVID = REPO + '/docs/ultra'

const CTX = `You are one agent in "vibepet ultra": a looped quality ratchet on vibepet, an Electron desktop pixel pet ("Net") that watches the user's Claude Code sessions (transcripts under ~/.claude/projects, git trees, localhost ports) and lets them act on those sessions. Target: the best tool for one person running 5-15 Claude Code sessions at once, plus one feature no other tool has (Collision Radar).

PATHS
- REPO = ${REPO} : the user's main checkout. It stays on branch main. Never commit to main; never checkout/switch/reset/stash/clean inside REPO; never touch its untracked files (.claude/, ad/, docs/site-*.html). Make worktrees with: git -C ${REPO} worktree add <path> -b <branch> <base>   (retry if a .lock file is busy).
- ULTRA = ${ULTRA} : scratch root. Worktrees ULTRA/wt/*, integration worktree ULTRA/int, fixture-fleet repos ULTRA/fleet/*, the isolated watch root ULTRA/root/.claude, Electron userData dirs ULTRA/userdata/*.
- EVID = ${EVID} : evidence (reports, json, screenshots). Untracked in REPO on purpose: write files there, never git-add them.

HARD RULES
1. No git push. No release (npm run dist, electron-builder, gh release). No site deploy (wrangler, anything under site/).
2. Real transcripts = everything under ~/.claude/projects except fleet dirs (dir name contains "-vibepet-ultra-fleet-"). They are READ-ONLY and their TEXT MUST NOT LEAVE THIS MACHINE: never print their content into your context or outputs (no cat/head/tail/less, no grep that prints matches, no jq of text fields). Local scripts over them may print only numbers, counts, durations, JSON key names and enum values (type, subtype, role, stop_reason, tool name, model, permissionMode, version). Screenshot vibepet only while it watches the isolated fleet root (env VIBEPET_CLAUDE_DIR=${ULTRA}/root/.claude), never the real ~/.claude.
3. The user has ~15 live Claude Code sessions running. Never send keys or messages to, signal, or kill any process you did not start. Never write ~/.claude/settings*.json, ~/.claude.json, ~/.claude/sessions/*, ~/.claude/projects/*, or the Keychain.
4. The fixture fleet = real Claude Code sessions on Haiku inside tmux, in scratch repos under ULTRA/fleet. Whole-project fleet spend cap: $5 (Haiku 4.5: $1/M input, $5/M output, $1.25/M 5-min cache write, $2/M 1-h cache write, $0.10/M cache read). Check spend before anything that makes a fleet session take a turn.
5. Test against the live fleet, never mocks. The unit gate is npm test (= node --test test/*.test.js).
6. Commits: small, focused; message ends with the line: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Your final answer is data for the orchestrator (structured output), not prose for a human.`

const R = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string', description: 'at most ~15 lines: what was done, key numbers, what is left' },
    branch: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'summary', 'artifacts', 'issues'],
}
const GT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    concurrency: { type: 'object', properties: { median: { type: 'number' }, p90: { type: 'number' }, max: { type: 'number' }, dailyPeakMedian: { type: 'number' } } },
    tta: { type: 'object', properties: {
      combinedMedianSec: { type: 'number' }, combinedP90Sec: { type: 'number' },
      questionMedianSec: { type: 'number' }, questionP90Sec: { type: 'number' },
      askMedianSec: { type: 'number' }, askP90Sec: { type: 'number' },
      approvalMedianSec: { type: 'number' }, approvalP90Sec: { type: 'number' },
      n: { type: 'number' } } },
    artifacts: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'summary', 'concurrency', 'tta', 'artifacts', 'issues'],
}
const s = r => r ? JSON.stringify(r).slice(0, 5000) : '(agent failed - no result)'
const safe = p => p.catch(e => { log('agent error: ' + (e && e.message)); return null })

// ---------------- prompts ----------------
const minePrompt = (id, lang, ext) => `${CTX}

TASK - Round 0 ground truth, implementation ${id} (${lang}). Another agent implements the same spec independently in another language; a reconciler will diff your numbers, so follow the definitions exactly and document every judgment call.

Write ${lang} (zero dependencies) at ${EVID}/tools/${id}.${ext} that streams every top-level session transcript ~/.claude/projects/<dir>/<sessionId>.jsonl. Skip dirs whose name contains 'private-tmp' or 'scratchpad' (throwaway workflow/worker sessions) or '-vibepet-ultra-fleet-' (our fixtures); skip <session>/subagents/**. Total is ~5.5 GB over ~530 files, some huge: stream line by line, parse per line, never hold a whole file. Records carry timestamp, type, isSidechain, isMeta, cwd, message.{content, stop_reason, usage, model} and more. Learn the schema WITHOUT reading content: print redacted skeletons where every string value becomes <str:len> except the enum keys allowed by rule 2.

DEFINITIONS
- Human prompt: type=user, not isMeta, not isSidechain, content has no tool_result block, its text (string or text blocks) is non-empty, does not start with '[Request interrupted', and does not start with '<' unless it starts with '<command-'.
- Live span: a session is live between two of its records that are < 30 min apart.

MEASURE
(1) Concurrency: distribution of the number of live sessions per minute over minutes with >= 1 live session (median, p75, p90, max); per-day peak (median, p90); share of live minutes with >= 5 and >= 10 sessions live. All-time and last 30 days (today is 2026-10-01).
(2) Time-to-attention (TTA, the north star) = how long a session waits on the user before they respond:
  a. question: an assistant record with stop_reason end_turn whose last text block, trimmed, ends with '?', to the next human prompt in that session.
  b. ask: a tool_use named AskUserQuestion, to its tool_result.
  c. approval: a tool_use to its tool_result where the wait was a permission prompt. Edit/Write/MultiEdit/NotebookEdit/ExitPlanMode with gap > 2 s count as approval waits (gap = wait). For Bash and other tools find the best signal in the schema (e.g. a duration field in toolUseResult, a rejection marker, permissionMode) - detect markers by regex inside the script, never print them - and document the heuristic and its coverage. Exclude records under permissionMode bypassPermissions.
  d. done-idle (reported separately, not TTA): end_turn without a question, to the next human prompt.
  Report n, median, p75, p90, p99 per class and combined (a+b+c), raw and censored (drop waits > 2 h as 'away' and count them), all-time and last 30 days.
(3) Attention-load facts for the feature ranking: blocks (a+b+c) per live hour per session; per-minute distribution of how many sessions are blocked at once; how often >= 2 sessions are blocked on an identical tool call (same tool + same normalized command or file pattern; compare hashes, never print) at overlapping times; how many sessions use /loop, ScheduleWakeup or CronCreate, and their wakeup intervals; per-session tokens (input, cache write, cache read, output) and approximate $ at list price for the record's model; 'away' gaps (no human prompt in any session for >= 20 min): how many, and how many blocks/finishes pile up during them; how often two live sessions share a cwd or git repo; how often two sessions edited the same file (hashed path) within 30 min of each other; how often a session ran git commit while another live session in the same repo had edits newer than that repo's previous commit.
Write ${EVID}/round-0/${id}.json: every number plus a "methods" object (definitions, heuristics, files/records parsed, skipped, parse errors, runtime). Sanity-check outliers (clock skew, resumed or compacted sessions, duplicate records) with counts. Put the headline numbers in your summary.`

const reconcilePrompt = ms => `${CTX}

TASK - reconcile the Round 0 ground truth. Two independent implementations of one spec:
A (Node): ${EVID}/round-0/mineA.json, script ${EVID}/tools/mineA.js. Agent result: ${s(ms[0])}
B (Python): ${EVID}/round-0/mineB.json, script ${EVID}/tools/mineB.py. Agent result: ${s(ms[1])}
(If one failed, re-implement the missing cross-check yourself, minimally, for the headline metrics.)
Compare every metric. Wherever headline metrics differ by > 5% (TTA median/p90 per class and combined, concurrency median/p90/max, the n's), find the cause by reading both scripts and running count-only diagnostics; fix the wrong one(s) and re-run until they agree or the gap is a documented definitional choice (then pick the more faithful one and say why). Same privacy rule: numbers only.
Write ${EVID}/round-0/ground-truth.json (final numbers + definitions + which implementation) and ${EVID}/round-0/ground-truth.md: one page - how many sessions the user runs at once; TTA median and p90 combined and per class (the north star); what share of waiting is plausibly detection (the user not noticing) vs. the user being away; the attention-load facts. Return the headline numbers in the schema.`

const rankPrompt = gt => `${CTX}

TASK - rank five many-session features by time-to-attention saved for THIS user. Ground truth: ${EVID}/round-0/ground-truth.json and .md (headline: ${s(gt)}). Read how vibepet works today in REPO (agents.js scan/classify: e.g. a pending tool_use only reads 'stalled' after 90 s of transcript silence; 'parked' sessions - idle > 5 min after end_turn - are dropped from the list; main.js send-to/jump need a GUI terminal tab + Accessibility).
Features:
- attention queue sorted by how long each session has been blocked
- batch-approve for identical tool calls across sessions
- a "while you were away" digest
- loop-aware rows that show the next wakeup and flag stalled loops instead of showing idle
- spend burn per session
For each: the mechanism that cuts TTA (detection latency, decision latency, action latency/clicks); seconds saved per block x blocks per day from the data, with the arithmetic shown; confidence; build cost; dependencies (e.g. approve must work for tmux-hosted sessions). Pick the top 3. If the data makes a sixth feature clearly more valuable, say so as an alternative, but the top 3 come from this list unless the data overwhelmingly says otherwise. Write ${EVID}/round-0/feature-ranking.md and put the top 3 (in order) + one line of evidence each in your summary.`

const HARNESS = `${CTX}

TASK - Round 0 harness, on its own branch. Setup: git -C ${REPO} worktree add ${ULTRA}/wt/r0-harness -b ultra/r0-harness main ; work only there; npm install there (own node_modules).
Deliver, with focused commits on ultra/r0-harness:
1. package.json "test": "node --test test/*.test.js". It is the gate and must exit 0 in < 60 s. Today it HANGS: test/content.test.js never finishes (no pass/fail after 25 s) and test/gesture.test.js takes ~24 s. Find the root causes (open handles, timers, child processes, dependence on the real screen/permissions) and fix them properly - fix the code if the code leaks, fix the test if the test is wrong; never delete or skip a test just to go green (if one truly needs a real display or permission, gate it behind an env var and say so).
2. Test-isolation env overrides; behavior identical when unset:
   - VIBEPET_CLAUDE_DIR = the Claude config root vibepet reads (default ~/.claude). Every read of ~/.claude/projects and ~/.claude/sessions in main.js, agents.js, ports.js, theater/, content/ etc. must go through it (grep for homedir and '.claude').
   - VIBEPET_USER_DATA = app.setPath('userData', ...) before the single-instance lock, so parallel test instances never collide.
   - VIBEPET_HOTKEY = an accelerator or 'off' (skip globalShortcut registration) so parallel instances don't fight over the global jump key.
   Unit tests for the overrides (node --test, no Electron needed where possible).
3. Playwright for Electron: devDependency playwright-core (latest). test/ultra/launch.js exporting launch({ appDir = <worktree root>, root, userData, env, hotkey }) -> { app, win (pet window), windows(), shot(file), evalMain(fn, arg), close() } via _electron.launch({ executablePath: require('electron'), args: [appDir], env: { ...process.env, VIBEPET_TEST: '1', VIBEPET_CLAUDE_DIR: root, VIBEPET_USER_DATA: userData, VIBEPET_HOTKEY: hotkey ?? 'off' } }). PRIVACY GUARD: launch() must throw unless root resolves inside ${ULTRA}. Learn the existing hook (VIBEPET_TEST -> globalThis.__vibepet in main.js) and docs/designpass/states.json; ~/.claude/skills/designpass/scripts has a prior Electron capture approach worth borrowing. The pet window is transparent: make screenshots legible (e.g. composite onto a neutral background) and say how.
4. Verify for real: an empty isolated root (mkdir -p ${ULTRA}/root-empty/.claude/projects ${ULTRA}/root-empty/.claude/sessions); launch; wait for the pet; open the Net Home panel with a real click on the pet; screenshot into ${EVID}/round-0/harness/; close cleanly with no orphan Electron processes. Repeat 3x to prove stability. Prove two instances can run at once with different userData.
5. Write test/ultra/README.md (how to launch, env vars, helpers) and ${EVID}/round-0/harness.md (changes, root cause of the hang, evidence).
Do not merge anywhere. Return branch name, what changed, test runtime.`

const FLEET = `${CTX}

TASK - Round 0 fixture fleet: 6 real Claude Code sessions on Haiku, driven through tmux in scratch repos, each held in a distinct state that vibepet must handle. All later testing runs against this fleet.
Setup: brew install tmux if missing (use the default tmux socket, like a real user). Branch: git -C ${REPO} worktree add ${ULTRA}/wt/r0-fleet -b ultra/r0-fleet main . Fleet tooling lives in that worktree under test/fleet/ (zero-dependency Node; commit it). Scratch repos live in ${ULTRA}/fleet/<name> (git init, a few realistic files, an initial commit). Never under /private/tmp or any path containing 'scratchpad' (vibepet ignores those).

MEMBERS (name -> state to hold)
- kestrel -> stuck on an approval: a Bash command that needs permission and is harmless if approved (e.g. a local ./deploy.sh --dry-run that only echoes). So "@kestrel approve" means something later.
- vibepet -> done: a finished turn ending in a plain statement (not a question). This repo is a local clone of REPO at main (git clone ${REPO} ${ULTRA}/fleet/vibepet, then remove the origin remote so nothing can be pushed). Its tests must be runnable there so "tell the vibepet session to run its tests" can work later.
- atlas -> working: a long-running foreground command (e.g. ./build.sh printing progress for ~9 min), allowed without approval via the repo's .claude/settings.json permissions.allow.
- beacon -> asking a question with the AskUserQuestion tool (pending).
- delta -> fanning out: 3 parallel subagents (Task/Agent tool), each running an allowed slow command (~2-3 min).
- ember -> sitting in /loop between wakeups (e.g. /loop 5m run ./tick.sh which appends the time to loop.log), idle between firings.

FLEET TOOL test/fleet/fleet.js
- up [names...]: create missing repos; start each member in tmux (one tmux session per member named vp-<name>; record the tmux target); run claude --model haiku interactively in the repo; get past the folder-trust dialog by reading tmux capture-pane -p and answering; send the state-inducing prompt; WAIT until the state is verified.
- status [--json]: per member - tmux target, claude pid, sessionId, transcript path, Claude Code registry status (~/.claude/sessions/<pid>.json fields status/statusUpdatedAt - read only), the last transcript record kind (pending tool_use + tool name / end_turn / ...), whether the target state holds, spend so far.
- rearm <name>: put one member back into its state the cheapest way. pause [names]: stop the costly members (working/loop/fan-out) without losing transcripts. down: kill all vp-* tmux sessions.
- spend: sum usage over ALL fleet transcripts incl. subagents (~/.claude/projects/*-vibepet-ultra-fleet-*/**/*.jsonl) at Haiku 4.5 prices; append a line to ${EVID}/fleet-spend.jsonl. Every command that makes a session take a turn must refuse at spend >= $4.50.
- root: maintain the isolated watch root ${ULTRA}/root/.claude - projects/<dname> = symlink to each member's ~/.claude/projects/<dname>; sessions/<pid>.json = symlink to each LIVE fleet pid's registry file (fleet pids only - never other sessions; their names are derived from real prompts). Run it automatically after up/rearm.
- Members are data (test/fleet/members.json: name, repo, prompts, target state, verify rule) so later tasks can add members, including two members sharing one repo (needed later for collision fixtures).
- attach (optional): open ONE Terminal.app window with a tmux client, so jump-to-terminal can be tested later. Open no other windows.
Keep per-session context small to save money: try --strict-mcp-config with an empty MCP config and --setting-sources project,local (no user plugins/hooks); measure first-turn cost; document the trade-off. Model must be Haiku: verify the model id in the transcript.

CRITICAL EXPERIMENT (vibepet's time-to-attention depends on it): for each state record what Claude Code exposes and when - registry status value + statusUpdatedAt; the transcript's last records (types, stop_reason, tool names only); the delay between the tool_use record being written and the approval prompt appearing on screen (capture-pane); whether anything reliably distinguishes "waiting for approval" from "tool executing" (registry status? a child process under claude? pane text?); the same for AskUserQuestion, /loop idle (is the next wakeup time recorded anywhere - transcript tool input, registry?), and subagent fan-out. Note whether each fleet session has a messagingSocketPath (do not connect to any socket that isn't a fleet member's). Write ${EVID}/round-0/fleet-states.md: a table plus raw timings.
Finish with all 6 members verified in state at the same time (status all green), then pause any member that burns money while idle-waiting (report $/hour per costly member). Write ${EVID}/round-0/fleet.md (usage, member specs, costs, gotchas). Commit on ultra/r0-fleet. Do not merge. Return spend so far.`

const MAP = `${CTX}

TASK - read-only surface map of vibepet (REPO, branch main) for the agents who will drive and fix it. No code changes.
Surfaces: (1) Net Home panel (one click opens one panel: Now list + chat + command bar; Setup card; localhost + recording sections), (2) chat, (3) command bar, (4) row actions: jump / approve / reply / replay / goal / done, (5) Theater replay, (6) ports/localhost, (7) gestures + the global jump key.
For each surface: how a real user opens and uses it (clicks, keys, gestures); the DOM (ids/classes/selectors in renderer/index.html + renderer/app.js; theater/player.*); IPC channels and main-process handlers (main.js, agents.js, ports.js, gesture.js, goal.js, theater/*, preload.js) with file:line; the data that feeds it (agents.scan/classify phases, ports.poll, git); timers/thresholds that shape timing (90 s stalled, 5 min parked, poll intervals); existing test hooks (VIBEPET_TEST -> globalThis.__vibepet; docs/designpass/states.json prelude); and the failure points you expect when sessions run inside tmux (locateSession/hostApp/focusTty assume a GUI-terminal .app ancestor; send-to types via System Events after focusing a tab and needs Accessibility).
Also: a table of every IPC channel; how windows are created (pet window, panels, theater), sizes/positions, transparency/click-through; how Playwright can reach each window (titles/URLs); what a test must do to open each surface through the real UI.
Write ${EVID}/round-0/surface-map.md. Cite file:line everywhere. Dense working map, not prose.`

const BENCH = `${CTX}

TASK - chat benchmark research. vibepet's chat must beat Raycast AI (AI Chat window, Quick AI) and Warp's agent panel (Agent Mode, managing several agents) on: time to first token; streaming; conversation history persistence; error states (no API key / offline / rate-limited 429 - does each tell the user what to do?); context attachment (@-mentions, choosing what the model sees); commanding/approving agents from the chat; keyboard flow; how they surface several concurrent agents. Use WebSearch/WebFetch (docs, changelogs, reviews). Write ${EVID}/round-0/benchmark.md: per product, what it does (with source URLs), then a concrete, measurable bar list for vibepet chat (e.g. "first token < 1.5 s from Enter to first visible model token", exact error-copy pattern per state, "history survives restart incl. scroll position"). Then read vibepet's current chat (REPO main.js chat / chatViaClaude / buildContext / SYSTEM; renderer/app.js chat code) and list every gap vs. the bar (e.g. it is non-streaming: claude -p --output-format json).`

const integratePrompt = (h, f, m) => `${CTX}

TASK - integrate Round 0 and prove the harness sees the fleet.
Inputs - harness branch result: ${s(h)}
fleet branch result: ${s(f)}
surface map: ${EVID}/round-0/surface-map.md (result: ${s(m)})
1. git -C ${REPO} worktree add ${ULTRA}/int -b ultra/round-0 main ; merge ultra/r0-harness and ultra/r0-fleet (resolve conflicts carefully); npm install in ${ULTRA}/int (this node_modules is shared later: fix worktrees will symlink to it); npm test passes in < 60 s.
2. Make the fleet's vibepet clone run the fixed test script (pull ultra/round-0 from REPO into ${ULTRA}/fleet/vibepet without disturbing its session).
3. node test/fleet/fleet.js status; rearm any member not in state (respect the spend cap); root.
4. Launch vibepet from ${ULTRA}/int via test/ultra/launch.js with VIBEPET_CLAUDE_DIR=${ULTRA}/root/.claude, VIBEPET_USER_DATA=${ULTRA}/userdata/r0-int, VIBEPET_HOTKEY=off. Through the REAL UI (pet -> Net Home panel) confirm it shows exactly the 6 fleet members and nothing else; record the phase/label vibepet gives each member vs. the true state from fleet status. Screenshot pet, panel, each row and its actions into ${EVID}/round-0/baseline/. List every mismatch with evidence in ${EVID}/round-0/baseline/notes.md (e.g. atlas reads 'stalled' while its build runs; kestrel only flagged after 90 s; approve/jump cannot reach tmux panes) - these seed Round 1.
5. Write test/ultra/canon.js: a canonical capture that, against the live fleet, opens each of the 7 surfaces through the real UI (Net Home panel, chat, command bar, row actions, Theater replay, ports/localhost, gestures + jump key) and saves 1-3 named screenshots per surface plus a JSON of functional assertions (panel opens, N rows, chat opens, command bar opens, theater opens for a session, ports section renders, gesture/hotkey path reachable) into an output dir. Usage: node test/ultra/canon.js --app <worktree> --out <dir> [--userdata <dir>]. Must finish in < 3 min and work from any worktree. Run it twice (stable), output to ${EVID}/round-0/canon/. Commit to ultra/round-0.
Write ${EVID}/round-0/integration.md. Return the baseline mismatches in your summary.`

const probePrompt = i => `${CTX}

TASK - measure time-to-attention BEFORE any change ("before" numbers) on the live fleet, through the real UI of vibepet in ${ULTRA}/int (branch ultra/round-0). Integration result: ${s(i)}
For a session that becomes blocked (needs the user), measure:
 (a) detect: seconds from the block's start (the transcript timestamp of the tool_use / question end_turn; also the registry statusUpdatedAt) to the first visible signal on the pet (bubble, badge, row state change);
 (b) actionable: seconds until the pet shows it in a form you can act on without leaving the pet (a row with a working approve/reply/answer action);
 (c) clicks: clicks/keys to resolve it once surfaced, and whether it can be resolved from the pet at all - verify by actually resolving it and checking the fleet transcript (e.g. the approved command really ran).
Block kinds: approval (kestrel), AskUserQuestion (beacon), plain end-turn question (any member, prompted to end with a question), done/finished (vibepet), stalled loop (ember - make a wakeup genuinely stall, e.g. hit an approval), subagent blocked on approval (delta).
Run each kind >= 3 times (rearm between; spend budget for this probe <= $0.60 - check fleet spend first and stop early if needed). Poll the renderer DOM / app state every 250 ms via Playwright (read-only evaluate) to timestamp signals; screenshot each signal. Use launch.js with the isolated root only.
Write ${EVID}/round-0/tta-before.json (raw trials) and ${EVID}/round-0/tta-before.md (table: kind -> detect median, actionable median, clicks, resolvable from pet?). These are the report's "before" numbers: exact and honest; if something can't be resolved from the pet, say so.`

const auditPrompt = all => `${CTX}

TASK - Round 0 audit + summary. Agent results so far: ${s(all)}
Verify every deliverable for real (run things, don't trust summaries):
- ${ULTRA}/int on ultra/round-0 contains harness + fleet tooling + canon.js; npm test passes there in < 60 s (time it).
- node test/fleet/fleet.js status and spend: report member states and total spend.
- launch.js refuses a root outside ${ULTRA}; canon.js runs.
- ${EVID}/round-0 has ground-truth.{json,md}, feature-ranking.md, harness.md, fleet.md, fleet-states.md, surface-map.md, benchmark.md, integration.md, baseline/, canon/, tta-before.{json,md}.
- Privacy: scan EVID json/md for long free-text strings that could be real transcript text (not fleet) and spot-check several PNGs by viewing them - only fleet members may appear.
Fix small gaps yourself; list bigger ones as issues.
Then write ${EVID}/round-0/README.md (one page: what exists, how to use it, headline numbers) and ${EVID}/REPORT.md, the final-report skeleton with Round 0 filled in and later sections marked pending: 1 Ground truth (sessions at once; TTA median/p90 - north star). 2 Time-to-attention before -> after (by block kind: detect s, actionable s, clicks, resolvable from pet). 3 Score table (surface x round: rater A, rater B, disagreement, counted delta). 4 Bug ledger (found / confirmed / fixed by round, with ids). 5 Chat bar (claims-vs-transcript, first token, no-key/offline/429 copy, history across restart, @session commands). 6 Many-session features (ranking; top 3 shipped with before/after seconds + clicks and proof captures). 7 Collision Radar (fires-before-write proof; false alarms). 8 Branches ready to merge (ultra/round-N, contents, test status). 9 Fleet spend.`

// ---------------- orchestration ----------------
phase('Ground truth')
const gtP = parallel([
  () => agent(minePrompt('mineA', 'Node', 'js'), { label: 'miner A (Node)', phase: 'Ground truth', schema: R, effort: 'high' }),
  () => agent(minePrompt('mineB', 'Python 3 stdlib', 'py'), { label: 'miner B (Python)', phase: 'Ground truth', schema: R, effort: 'high' }),
]).then(ms => safe(agent(reconcilePrompt(ms), { label: 'reconcile', phase: 'Ground truth', schema: GT })))
  .then(gt => safe(agent(rankPrompt(gt), { label: 'feature ranking', phase: 'Ground truth', schema: R })).then(rank => ({ gt, rank })))

const harnessP = safe(agent(HARNESS, { label: 'harness', phase: 'Harness', schema: R }))
const fleetP = safe(agent(FLEET, { label: 'fleet', phase: 'Fleet', schema: R }))
const mapP = safe(agent(MAP, { label: 'surface map', phase: 'Research', schema: R, effort: 'high' }))
const benchP = safe(agent(BENCH, { label: 'chat benchmark', phase: 'Research', schema: R, effort: 'high' }))

const intP = Promise.all([harnessP, fleetP, mapP]).then(([h, f, m]) => {
  if (!h || !f) { log('integrate skipped: harness or fleet failed'); return null }
  return safe(agent(integratePrompt(h, f, m), { label: 'integrate', phase: 'Integrate', schema: R }))
})
const probeP = intP.then(i => i ? safe(agent(probePrompt(i), { label: 'TTA before', phase: 'Baseline TTA', schema: R })) : null)

const [g, bench, probe, h, f, m, i] = await Promise.all([gtP, benchP, probeP, harnessP, fleetP, mapP, intP])
const all = { gt: g && g.gt, rank: g && g.rank, harness: h, fleet: f, map: m, bench, integrate: i, probe }
phase('Audit')
const audit = await safe(agent(auditPrompt(all), { label: 'audit', phase: 'Audit', schema: R }))
return { ...all, audit }
