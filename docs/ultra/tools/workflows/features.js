export const meta = {
  name: 'vibepet-ultra-features',
  description: 'Feature sprint on ultra/round-2: attention queue, away digest, loop-aware rows, chat bar, Collision Radar - planned together, each built in its own worktree with live-fleet proofs, adversarially verified, merged, then TTA-after measured',
  phases: [
    { title: 'Plan', detail: 'one coherent design + per-feature briefs with proofs' },
    { title: 'Build', detail: 'one worktree per feature' },
    { title: 'Verify', detail: 'hostile re-run of each proof' },
    { title: 'Merge', detail: 'serial merge into ultra/round-2' },
    { title: 'Measure', detail: 'TTA after + chat + radar re-proof on the merged branch' },
    { title: 'Report', detail: 'REPORT.md sections 2, 5, 6, 7' },
  ],
}

const STOP = args.spendStop
const REPO = '/Users/christopherharris/projects/vibepet'
const ULTRA = '/Users/christopherharris/.vibepet-ultra'
const EVID = REPO + '/docs/ultra'
const FX = EVID + '/features'

const CTX = `You are one agent in "vibepet ultra": a looped quality ratchet on vibepet, an Electron desktop pixel pet ("Net") that watches the user's Claude Code sessions (transcripts, the ~/.claude/sessions registry, git trees, localhost ports) and lets them act on those sessions. Target: the best tool for one person running 5-15 Claude Code sessions at once, plus one feature no other tool has (Collision Radar). This is the FEATURE SPRINT.

PATHS
- REPO = ${REPO} : the user's main checkout. It stays on branch main. Never commit to main; never checkout/switch/reset/stash/clean inside REPO; never touch its untracked files. Worktrees: git -C ${REPO} worktree add <path> -b <branch> <base>  (retry if a .lock is busy). node_modules in a worktree = symlink to ${ULTRA}/int/node_modules (git-excluded); never git add -A blindly.
- ULTRA = ${ULTRA} : integration worktree ULTRA/int (branch ultra/round-2 for this sprint), feature worktrees ULTRA/wt/f-*, fleet repos ULTRA/fleet/*, isolated watch root ULTRA/root/.claude, userData ULTRA/userdata/*.
- EVID = ${EVID} : evidence (untracked; never git-add). Feature evidence goes in ${FX}/<feature>/. References: ${EVID}/REPORT.md (state of play), ${EVID}/round-0/ (ground-truth.md, feature-ranking.md, benchmark.md, fleet.md, fleet-states.md, surface-map.md, tta-before.md), ${EVID}/round-1/ (bugs, tasks.json, merge.md, README.md), ${EVID}/rubric.md. Harness: ${ULTRA}/int/test/ultra/README.md (launch.js, canon.js, tta.js, watch.js), fleet: test/fleet/fleet.js.

HARD RULES
1. No git push. No release (npm run dist, electron-builder, gh release). No site deploy (wrangler, site/).
2. Real transcripts (~/.claude/projects except dirs containing "-vibepet-ultra-fleet-") are READ-ONLY and their text must never be printed, copied or screenshotted. Launch vibepet only via test/ultra/launch.js with root ${ULTRA}/root/.claude. Never start a screen recording.
3. The user has ~15 live Claude Code sessions. Never send keys/messages to, signal or kill any process you did not start. Never write ~/.claude/settings*.json, ~/.claude.json, ~/.claude/sessions/*, ~/.claude/projects/*, or the Keychain.
4. Fleet = real Claude Code sessions on Haiku in tmux. Take a member's lease before changing its state (fleet.js lease/release); re-arm what you consumed. Stop making fleet sessions take turns once the fleet spend ESTIMATE ("~$X incl. hidden calls" from fleet.js spend) reaches $${STOP}. Budget is tight: kestrel/beacon/vibepet re-arms ~$0.01-0.02 warm; delta fan-out ~$0.10; ember loop ~$0.17/h; a new member's first turn ~$0.03.
5. Test against the live fleet, never mocks (fault injection at the network boundary is fine for error states). Unit gate: npm test (node --test test/*.test.js), < 60 s.
6. Commits small and focused; message ends with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
7. Anything that types into a terminal must target exactly one verified tmux pane (or GUI tab) whose session is in the matching state (registry status/waitingFor), and refuse otherwise - a stray "1" or Enter into the wrong prompt is a real-world harm.
8. Record the load average (uptime) next to every timing; repeat timing-critical measurements; report medians.
Your final answer is data for the orchestrator (structured output), not prose for a human.`

const FEATURES = [
  { id: 'queue', title: 'Attention queue', spec: `Feature #1 by TTA saved (feature-ranking.md: 513 s/day; 92% of the gain is persistence). One ordering everywhere (Home, roster, jump key): sessions that need the user, oldest block first, with the TRUE block age (block start from the registry's statusUpdatedAt / the tool_use timestamp - not detection time, not app launch). Blocked/unanswered sessions never park or vanish while they wait; finished sessions stay discoverable as "ready for a new task" (sunk below needs-you). Fits 15 sessions (compact rows / scroll; nothing capped at 8). Each needs-you row offers the one right action (Approve/Deny for a permission prompt, the options for AskUserQuestion, Reply for a question) that works on tmux sessions. The pet's ambient signal (face/LED/badge count) reflects the queue head.`,
    proof: `TTA after vs before (round-0/tta-before.md) with test/ultra/tta.js, same plans/windows, for: approval (kestrel), AskUserQuestion (beacon), end-turn question, done (vibepet), subagent blocked (delta - at most 1 trial, it costs ~$0.10). Per kind: detect s, actionable s, clicks to resolve, resolvable from pet (verified in the transcript). Plus ordering proof: two blocked members, the older one leads in Home, roster and jump key.` },
  { id: 'digest', title: '"While you were away" digest', spec: `Feature #2. When the user comes back (system idle >= N min via Electron powerMonitor, or no pet interaction and no human prompt to any session for >= N min; N default 10, configurable, env VIBEPET_AWAY_MIN for tests), Net shows one digest: what finished (with the receipt line), what is blocked and for how long (oldest first, each with its action), what failed (red checks), loops that fired, collisions. One click resolves or opens each item; dismissible; never shown twice for the same away spell; quiet if nothing happened.`,
    proof: `On the fleet: let N (test value) pass with no interaction while at least one member blocks (re-arm kestrel) and one finishes (prompt vibepet), then "return" (a real pet click) -> seconds from return to digest visible; every digest line checked against fleet ground truth (no false or missing items); clicks to resolve each blocked item from the digest (verified in the transcript).` },
  { id: 'loops', title: 'Loop-aware rows', spec: `Feature #3. A session that will resume on its own is not "done": /loop (fleet-states.md: fires every ~285 s; the schedule lives in the repo's .claude/scheduled_tasks* - find where Claude Code 2.1.287 records it), ScheduleWakeup (tool input delaySeconds -> next wakeup), background Bash tasks, and async subagents (the Agent tool backgrounds them; the main turn ends while the registry stays busy). Rows say "sleeping - wakes ~14:32" / "waiting on 2 background tasks", count down, and flag "loop stalled" when a wakeup is overdue (e.g. > 1.5x its interval) or a fire ended blocked - which then joins the attention queue.`,
    proof: `On ember (start it: fleet.js rearm ember; pause when done, budget ~30 min of loop): the row's predicted next wakeup vs the actual fire time (error in s, n >= 3 fires); a fire that blocks on approval surfaces as needs-you (seconds); a stalled loop (stop the member's claude) is flagged within its overdue window; zero "done" labels on ember across the run. Before = round-0 behavior ("done Nm ago", hidden after 5 min).` },
  { id: 'chat', title: 'Chat bar', spec: `Chat must beat Raycast AI and Warp's agent panel (benchmark.md). Deliver whatever Round 1 did not already ship, proven: (1) streaming with first visible model token < 1.5 s from Enter (warm, pre-spawned claude stream-json process started when the panel/chat opens, or SSE on the API-key path; measure honestly - first MODEL token, not a local placeholder); (2) no-key, offline and 429 states each tell the user exactly what to do (copy table in benchmark.md; 429 honors retry-after with a countdown; the user's text is never lost); (3) history survives restart (userData; scroll position; bounded size); (4) chat commands sessions: "@kestrel approve" (and deny, answer <option>, reply <text>) and natural language like "tell the vibepet session to run its tests" route into that session through the verified tmux path (rule 7), with visible confirmation of what was sent and to whom, and confirmation that it landed (transcript shows it); ambiguous/unknown targets ask instead of guessing; (5) answers to "what's my agent doing" are built from rich, correct per-session context (registry state, pending ask, last tools, files edited, checks) so every claim matches the transcript.`,
    proof: `(a) TTFT: n >= 10 sends, p50 and p95, Enter -> first visible model token (DOM timestamps), with the engine used. (b) Error states: screenshots + copy for no-key, offline, 429 (fault injection at the network boundary). (c) History: send 3, restart, all present + scroll restored. (d) Routing: "@kestrel approve" -> kestrel's transcript shows the approved command ran; "tell the vibepet session to run its tests" -> vibepet's transcript shows the prompt and a test run; a deliberately ambiguous target asks. (e) Claims: ask "what's my agent doing?" and "what is each session doing?" 3 times; list every atomic claim with true/false against the fleet jsonl.` },
  { id: 'radar', title: 'Collision Radar', spec: `The unique feature: vibepet alone sees every session's transcript, registry state, git tree and ports. Warn on the pet BEFORE (1) two sessions edit the same file, (2) two sessions bind the same port, (3) one session commits on top of another session's uncommitted work. Signals, earliest first: session B Reads a file that session A has uncommitted edits to (Claude must Read before it may Edit - the earliest honest intent signal); B's pending Edit/Write/MultiEdit on that file (registry waiting + the permission dialog text in B's tmux pane via capture-pane when the transcript withholds the pending tool_use, fleet-states.md); B's Bash that binds a port already listening under A (parse --port/-p/PORT=/:N/http.server N and known dev-server defaults); B's git commit / add -A / commit -a while A has dirty, uncommitted files A edited. Precision first: same repo+worktree, distinct live sessions (a session and its own subagents are one), realpath equality, A's edits still uncommitted (git status), port actually listening and owned by another session. Poll shared-repo sessions fast (fs.watch on their transcripts; <= 1 s), everything else on the normal tick. On the pet: a bubble + Home "Radar" section naming both sessions, the file/port/commit, with actions [Hold B] (deny/Esc into B's verified pane), [Tell B] (send B a one-line heads-up through the verified path), [Jump A]/[Jump B]; a quiet "shared tree" marker on rows of sessions sharing a dirty repo. New module (e.g. radar.js) with unit tests over real-shaped transcript lines.`,
    proof: `Fixtures (add members via test/fleet/members.json; budget ~$0.25 total): forge-a and forge-b sharing one repo ULTRA/fleet/forge. (1) Convergence: A edits src/config.js (leave it uncommitted); B (default permission mode) is asked to change the same file -> radar alert timestamp (DOM poll 250 ms) vs B's Edit tool_result timestamp: the alert must come first; lead time per trial, n >= 3. (2) Port: A serves on port P; B is asked to start a server on P -> alert before B's process binds. (3) Commit: A has uncommitted edits; B is asked to commit everything -> alert before B's commit lands (git log timestamp). (4) Zero false alarms: count radar alerts across all other fixtures - the 6 standard members in their own repos, plus negatives: forge-a/forge-b editing DIFFERENT files, and the same file after A commits - over >= 30 min of normal fleet activity: must be 0.` },
]

const s = r => r ? JSON.stringify(r).slice(0, 6000) : '(no result)'
const safe = p => p.catch(e => { log('agent error: ' + (e && e.message)); return null })
const R = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, branch: { type: 'string' }, artifacts: { type: 'array', items: { type: 'string' } }, issues: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'artifacts', 'issues'] }
const PLAN = { type: 'object', properties: { briefs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, brief: { type: 'string' }, files: { type: 'array', items: { type: 'string' } }, already: { type: 'string' }, risks: { type: 'string' }, budget: { type: 'number' } }, required: ['id', 'brief', 'already', 'budget'] } }, layout: { type: 'string' }, order: { type: 'array', items: { type: 'string' } } }, required: ['briefs', 'layout', 'order'] }
const BUILD = { type: 'object', properties: { ok: { type: 'boolean' }, branch: { type: 'string' }, tests: { type: 'string' }, proof: { type: 'string', description: 'the measured proof numbers, before vs after' }, captures: { type: 'array', items: { type: 'string' } }, changed: { type: 'array', items: { type: 'string' } }, left: { type: 'string' }, spend: { type: 'string' } }, required: ['ok', 'branch', 'tests', 'proof', 'captures', 'changed'] }
const VER = { type: 'object', properties: { verdict: { type: 'string', enum: ['proven', 'partial', 'refuted'] }, measured: { type: 'string' }, problems: { type: 'array', items: { type: 'string' } } }, required: ['verdict', 'measured', 'problems'] }
const MERGE = { type: 'object', properties: { merged: { type: 'array', items: { type: 'string' } }, reverted: { type: 'array', items: { type: 'string' } }, skipped: { type: 'array', items: { type: 'string' } }, tests: { type: 'string' }, canon: { type: 'string' }, head: { type: 'string' }, summary: { type: 'string' } }, required: ['merged', 'reverted', 'skipped', 'tests', 'head'] }
const REP = { type: 'object', properties: { report_md: { type: 'string' }, summary: { type: 'string' } }, required: ['report_md', 'summary'] }

const planPrompt = `${CTX}

FEATURE SPRINT - PLAN. Round 1 result: ${s(args.r1)}
1. In ${ULTRA}/int: clean tree on ultra/round-1 (its merged tip); git switch -c ultra/round-2 (or switch to it if it exists). npm test green. node test/ultra/canon.js --app ${ULTRA}/int --out ${FX}/canon-base --userdata ${ULTRA}/userdata/f-canon-base
2. Read the code as merged and the round-1 evidence. For each feature below, state precisely what Round 1 already shipped (with file:line), what is missing, and write the build brief: design, where it lives in the UI, data sources, files, edge cases, the proof scenario with exact fleet steps, and a fleet budget in $ (total for all five <= $${args.sprintBudget}).
3. Design ONE coherent Net Home layout that hosts the queue, digest, loop rows and radar without crowding (15 sessions must fit), so five parallel builders don't collide; name the DOM regions each feature owns. Give a merge order (foundational first).
Features:
${FEATURES.map(f => `- ${f.id}: ${f.title}. ${f.spec}\n  PROOF: ${f.proof}`).join('\n')}
Write ${FX}/plan.md. Return the briefs, the layout and the merge order.`

const buildPrompt = (f, b, layout) => `${CTX}

FEATURE SPRINT - BUILD "${f.title}" (${f.id}).
Spec: ${f.spec}
Proof required: ${f.proof}
Planner's brief (already shipped / design / files / budget $${b ? b.budget : '?'}): ${s(b)}
Shared Net Home layout (stay inside your region): ${layout}
1. git -C ${REPO} worktree add ${ULTRA}/wt/f-${f.id} -b ultra/f/${f.id} ultra/round-2 ; cd there; ln -s ${ULTRA}/int/node_modules node_modules.
2. Build it fully - real, not a facade - in the style of the surrounding code. Unit tests (test/*.test.js) for the logic; npm test green (< 60 s).
3. Run the proof on the live fleet from YOUR worktree (launch.js appDir = worktree, userData ${ULTRA}/userdata/f-${f.id}); save captures + raw timings + a proof.md (before vs after, n, medians, load averages) in ${FX}/${f.id}/. Stay within your fleet budget.
4. node test/ultra/canon.js --app <worktree> --out ${FX}/${f.id}/canon --userdata ${ULTRA}/userdata/f-${f.id}-canon : no assertion that passes in ${FX}/canon-base may fail (update canon.js only where it encodes behavior your feature deliberately changed, and say so); add canon assertions for your feature.
5. Commit on ultra/f/${f.id}.
Return ok, branch, tests, the measured proof (numbers), capture paths, files changed, what's left, fleet spend used.`

const verifyPrompt = (f, bd) => `${CTX}

FEATURE SPRINT - HOSTILE VERIFY "${f.title}" (${f.id}), branch ultra/f/${f.id}, worktree ${ULTRA}/wt/${'f-' + f.id}. Builder's claim: ${s(bd)}
Required proof: ${f.proof}
Re-run the proof yourself on a FRESH instance from that worktree (userData ${ULTRA}/userdata/f-${f.id}-verify) against the live fleet - do not trust the builder's numbers. Try to break it: edge cases from the spec, wrong-pane/wrong-state safety (rule 7), false positives/negatives, restart, 15-session crowding, light/dark. ${f.id === 'chat' ? 'For claims: split every answer into atomic claims and check each against the fleet jsonl yourself.' : ''}${f.id === 'radar' ? 'For radar: repeat the convergence fixture at least twice yourself (alert must precede the second write) and audit every alert raised during your run for false alarms.' : ''} Fleet budget: $${f.id === 'radar' || f.id === 'queue' ? '0.10' : '0.05'}.
Write ${FX}/${f.id}/verify.md. Verdict: proven (every proof point holds), partial (list what fails), refuted.`

const mergePrompt = (list, order) => `${CTX}

FEATURE SPRINT - MERGE into ultra/round-2 (in ${ULTRA}/int). Branches to merge, in this order: ${JSON.stringify(order.filter(id => list.includes(id)).map(id => 'ultra/f/' + id))}.
For each: git merge --no-ff; resolve conflicts correctly (read both sides; keep both features working - they share Net Home regions per ${FX}/plan.md); npm test after each; abort and record any merge you can't make green.
Then node test/ultra/canon.js --app ${ULTRA}/int --out ${FX}/canon-merged --userdata ${ULTRA}/userdata/f-canon-merged ; compare with ${FX}/canon-base and with each feature's canon; fix integration regressions in this sprint, or revert the offending merge (git revert -m 1) and record it.
Write ${FX}/merge.md. Return merged, reverted, skipped (with reasons), tests, canon status, head.`

const measurePrompt = (m, ver) => `${CTX}

FEATURE SPRINT - MEASURE on the merged branch (${ULTRA}/int, ultra/round-2 @ ${m && m.head}). Verify results per feature: ${s(ver)}
1. TTA after: run test/ultra/tta.js with the same plans and windows as round-0/tta-before.md for every block kind (subagent kind: 1 trial, it costs ~$0.10). Write ${EVID}/round-2/tta-after.json and tta-after.md (table: kind -> detect s, actionable s, clicks, resolvable from pet; before vs after).
2. Re-run on the merged build: the radar convergence proof once (alert precedes the second write) and the chat routing proof once ("@kestrel approve" lands), to show the merges kept them working.
Fleet budget $0.40 total. Return the after table and the two re-proofs.`

const reportPrompt = all => `${CTX}

FEATURE SPRINT - REPORT. Results: ${s(all)}
Return (do not write - a harness guard refuses subagent-written report files) report_md = the full ${EVID}/REPORT.md updated in place: keep all existing content; fill section 2 (TTA before -> after, from ${EVID}/round-2/tta-after.md), section 5 (chat bar: each claim with its measured result + evidence path), section 6 (top-3 features shipped: before/after seconds + clicks + proof capture paths), section 7 (Collision Radar: fires-before-write lead times, port + commit proofs, false-alarm count), section 8 (ultra/round-2 row: features merged, head, tests), section 9 (fleet spend after the sprint, fleet.js spend). Mark anything not proven as such - no rounding up.`

// ---------- orchestration ----------
phase('Plan')
const plan = await safe(agent(planPrompt, { label: 'plan', phase: 'Plan', schema: PLAN }))
const briefs = Object.fromEntries(((plan && plan.briefs) || []).map(b => [b.id, b]))
const layout = (plan && plan.layout) || 'no shared layout - keep changes local to your feature and avoid restructuring shared DOM'
const order = (plan && plan.order && plan.order.length ? plan.order : ['queue', 'loops', 'digest', 'radar', 'chat'])

const built = await pipeline(
  FEATURES,
  f => safe(agent(buildPrompt(f, briefs[f.id], layout), { label: 'build ' + f.id, phase: 'Build', schema: BUILD })),
  (bd, f) => bd ? safe(agent(verifyPrompt(f, bd), { label: 'verify ' + f.id, phase: 'Verify', schema: VER })).then(v => ({ f, bd, v })) : { f, bd: null, v: { verdict: 'refuted', measured: '', problems: ['build failed'] } },
)
const ok = built.filter(x => x && x.bd && x.bd.ok && x.v && x.v.verdict !== 'refuted').map(x => x.f.id)
log('verified: ' + built.filter(Boolean).map(x => `${x.f.id}=${x.v && x.v.verdict}`).join(' '))

phase('Merge')
const merge = ok.length ? await safe(agent(mergePrompt(ok, order), { label: 'merge', phase: 'Merge', schema: MERGE })) : null

phase('Measure')
const ver = built.filter(Boolean).map(x => ({ id: x.f.id, verdict: x.v && x.v.verdict, measured: x.v && x.v.measured, problems: x.v && x.v.problems, builderProof: x.bd && x.bd.proof }))
const measure = merge ? await safe(agent(measurePrompt(merge, ver), { label: 'measure', phase: 'Measure', schema: R })) : null

phase('Report')
const all = { plan: plan && { order, layout: layout.slice(0, 1500) }, features: ver, merge, measure }
const rep = await safe(agent(reportPrompt(all), { label: 'report', phase: 'Report', schema: REP }))
return { ...all, report_md: rep && rep.report_md, reportSummary: rep && rep.summary }
