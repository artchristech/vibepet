#!/usr/bin/env node
'use strict';
// vibepet fixture fleet: real Claude Code sessions (Haiku) in tmux, each held in a known state.
//
//   node test/fleet/fleet.js up [names...] [--no-prompt]   create repos, start members, arm + verify
//   node test/fleet/fleet.js status [names...] [--json]     per-member observation + verdict + spend
//   node test/fleet/fleet.js rearm <name...>                put members back into their state (cheapest way)
//   node test/fleet/fleet.js pause [names...]               stop costly members (default: all costly)
//   node test/fleet/fleet.js down [names...]                kill vp-* tmux sessions (default: all of them)
//   node test/fleet/fleet.js spend [--note TEXT]            sum fleet usage, append docs/ultra/fleet-spend.jsonl
//   node test/fleet/fleet.js root                           rebuild the isolated watch root ULTRA/root/.claude
//   node test/fleet/fleet.js send <name> <text...>          type a prompt into a member (spend-guarded)
//   node test/fleet/fleet.js attach [name]                  open ONE Terminal.app window with a tmux client
//   node test/fleet/fleet.js costs [names...]               per-turn cost timeline (prompt / scheduled / task_notification)
//   node test/fleet/fleet.js lease <name> <owner> [--ttl 1800]   take a member before changing its state (exit 3: held)
//   node test/fleet/fleet.js release <name> [owner] [--force]    give it back (with owner: only if that owner holds it)
//
// Members are data: test/fleet/members.json. Everything that can make a session take a turn
// refuses once the fleet spend estimate reaches the stop: $4.50 (cap $5), or lower when the round's budget is
// written to ULTRA/fleet/spend-stop (or VP_SPEND_STOP is set); the lowest wins.
//
// Leases are advisory (atomic mkdir under ULTRA/fleet/.leases, stale after their ttl): status shows holders, and
// rearm / send / pause / up warn when someone else holds a member. Say who you are with --as <owner> or
// VP_LEASE_OWNER=<owner> and they refuse instead.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const L = require('./lib');

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const log = (...a) => console.log(...a);
const ago = (t) => (t ? `${Math.round((Date.now() - t) / 1000)}s ago` : '-');

const CFG = L.loadMembers();
const MEMBERS = CFG.members;
const byName = (n) => { const m = MEMBERS.find(x => x.name === n); if (!m) throw new Error(`unknown member: ${n}`); return m; };
const pick = (names) => (names.length ? names.map(byName) : MEMBERS);

// Before a command changes members' state: a live lease held by someone else is a warning, or a refusal when the
// caller said who it is (--as / VP_LEASE_OWNER) and it is not the holder.
function leaseGate(ms, verb, me) {
  for (const m of ms) {
    const l = L.readLease(m.name);
    if (!l || l.stale || (me && l.owner === me)) continue;
    const msg = `${m.name} is leased by ${l.owner || '(unknown)'} until ${l.expiresAt} (${l.leftSec}s left)`;
    if (me) throw new Error(`refusing ${verb}: ${msg}; you are ${me}`);
    console.error(`fleet: WARNING ${verb}: ${msg}. Take the lease first: fleet.js lease ${m.name} <owner>`);
  }
}

// ---------------------------------------------------------------- repos
const GIT_ENV = L.cleanEnv({ GIT_AUTHOR_NAME: 'vibepet fleet', GIT_AUTHOR_EMAIL: 'fleet@vibepet.invalid', GIT_COMMITTER_NAME: 'vibepet fleet', GIT_COMMITTER_EMAIL: 'fleet@vibepet.invalid' });
function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} in ${cwd}: ${(r.stderr || '').trim()}`);
  return r.stdout;
}
function repoDir(m) { return path.join(L.FLEET, m.repoSpec.dir || m.repo); }
function ensureRepo(m) {
  const dir = repoDir(m), spec = m.repoSpec;
  if (fs.existsSync(path.join(dir, '.git'))) return false;
  if (/(^|\/)private\/tmp\/|scratchpad/.test(dir)) throw new Error(`fleet repo path ${dir} would be ignored by vibepet`);
  fs.mkdirSync(L.FLEET, { recursive: true });
  if (spec.seed) {
    fs.cpSync(path.join(__dirname, spec.seed), dir, { recursive: true });
    git(dir, ['init', '-q', '-b', 'main']);
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', spec.message || `${m.repo}: initial commit`]);
  } else if (spec.clone) {
    git(L.FLEET, ['clone', '-q', '--branch', spec.ref || 'main', spec.clone, dir]);
    if (spec.dropRemotes) for (const r of git(dir, ['remote']).split('\n').filter(Boolean)) git(dir, ['remote', 'remove', r]);
  } else if (spec.worktreeOf) {
    git(path.join(L.FLEET, spec.worktreeOf), ['worktree', 'add', '-q', dir, '-b', spec.branch || m.repo]);
  } else throw new Error(`repo ${m.repo}: needs seed, clone or worktreeOf`);
  log(`  repo ${m.repo}: created at ${dir}`);
  return true;
}

// ---------------------------------------------------------------- tmux + claude launch
function paneShellCmd(name) {
  const fixed = { HOME: L.HOME, USER: process.env.USER || require('os').userInfo().username, LOGNAME: require('os').userInfo().username,
    SHELL: '/bin/bash', PATH: L.PANE_PATH, LANG: 'en_US.UTF-8', COLORTERM: 'truecolor', TMPDIR: process.env.TMPDIR || '/tmp/',
    BASH_SILENCE_DEPRECATION_WARNING: '1', PS1: `vp-${name}$ ` };
  // env -i: nothing from the launching Claude Code session (CLAUDECODE, CLAUDE_CODE_*) reaches the pane;
  // --noprofile --norc: no user aliases/functions (e.g. an aliased `claude`).
  return `exec /usr/bin/env -i ${Object.entries(fixed).map(([k, v]) => `${k}=${q(v)}`).join(' ')} TERM="$TERM" TMUX="$TMUX" TMUX_PANE="$TMUX_PANE" /bin/bash --noprofile --norc`;
}
function ensureTmux(m) {
  if (L.hasSession(m.target)) return false;
  L.tmux(['new-session', '-d', '-s', m.target, '-x', '200', '-y', '50', '-c', m.cwd, paneShellCmd(m.name)]);
  log(`  tmux ${m.target}: started`);
  return true;
}
// Move the ❯ cursor of a Claude Code select menu onto the line matching `re`, then Enter.
async function chooseOption(target, re, tries = 10) {
  for (let i = 0; i < tries; i++) {
    // only the dialog: lines below the last full-width rule (the transcript above may hold '❯ /exit')
    const all = (L.capture(target) || '').split('\n');
    const rule = all.map(l => /^\s*─{20,}\s*$/.test(l)).lastIndexOf(true);
    const lines = all.slice(rule + 1);
    const cur = lines.findIndex(l => /^\s*❯/.test(l));
    const want = lines.findIndex(l => re.test(l));
    if (cur >= 0 && cur === want) { L.sendKeys(target, 'Enter'); return true; }
    L.sendKeys(target, want >= 0 && cur > want ? 'Up' : 'Down'); await L.sleep(300);
  }
  throw new Error(`${target}: could not select option ${re}`);
}
// Start claude in the member's pane (fresh, or --resume of its last session) and get past dialogs.
async function launch(m, ms, { resume = null } = {}) {
  if (L.claudePidOf(m.target)) throw new Error(`${m.name}: claude already running`);
  const d = CFG.defaults || {};
  const env = Object.assign({}, d.env, m.env || {});
  const args = [...(d.args || []), ...(m.args || [])];
  const sid = resume || crypto.randomUUID();
  args.push(resume ? '--resume' : '--session-id', sid);
  const cmd = `cd ${q(m.cwd)} && clear && env ${Object.entries(env).map(([k, v]) => `${k}=${q(v)}`).join(' ')} ${q(L.CLAUDE_BIN)} ${args.map(q).join(' ')}`;
  await L.sendLine(m.target, cmd, { settleMs: 150 });
  const t0 = Date.now();
  let trusted = false;
  while (Date.now() - t0 < 60000) {
    await L.sleep(500);
    const txt = L.capture(m.target) || '';
    if (/Yes, I trust this folder/.test(txt)) { await chooseOption(m.target, /Yes, I trust this folder/); trusted = true; continue; }
    const pid = L.claudePidOf(m.target);
    const reg = L.readRegistry(pid);
    if (pid && reg && reg.status === 'idle' && /^\s*❯/m.test(txt)) {
      Object.assign(ms, { pid, sessionId: reg.sessionId, launchedAt: Date.now(), procStartedAt: reg.startedAt, paused: false });
      ms.sessions = [...new Set([...(ms.sessions || []), reg.sessionId])];
      log(`  ${m.name}: claude pid ${pid} session ${reg.sessionId}${resume ? ' (resumed)' : ''}${trusted ? ' (trust dialog answered)' : ''} in ${Date.now() - t0}ms`);
      return { pid, sessionId: reg.sessionId };
    }
  }
  throw new Error(`${m.name}: claude did not become ready in 60s`);
}

// ---------------------------------------------------------------- observation + verdict
// caffeinate runs whenever a turn is active; Claude Code's own git queries carry core.askPass=.
const TRIVIAL_CHILD = (p) => p.comm === 'caffeinate' || /defunct/.test(p.comm + p.args) || p.args === '' || /-c core\.askPass= /.test(p.args);
// A Bash tool execution = `bash -c source ~/.claude/shell-snapshots/...` under claude, plus its subtree.
const SNAPSHOT_WRAPPER = /\/\.claude\/shell-snapshots\/snapshot-/;
function toolProcsOf(procs) {
  const roots = new Set(procs.filter(p => SNAPSHOT_WRAPPER.test(p.args)).map(p => p.pid));
  const out = []; let grew = true;
  while (grew) { grew = false; for (const p of procs) if (!out.includes(p) && (roots.has(p.pid) || roots.has(p.ppid))) { out.push(p); roots.add(p.pid); grew = true; } }
  return out;
}
function observe(m, ms = {}, rows = L.psTable()) {
  const live = L.hasSession(m.target);
  const pane = live ? L.paneInfo(m.target) : null;
  const pid = live ? L.claudePidOf(m.target, rows) : null;
  const reg = L.readRegistry(pid);
  const sessionId = (reg && reg.sessionId) || ms.sessionId || null;
  const tfile = sessionId ? L.transcriptPath(m, sessionId) : null;
  const recs = tfile ? L.readJsonl(tfile) : [];
  const tail = L.tailState(recs);
  const subs = sessionId ? L.subagentFiles(m, sessionId).map(f => { const r = L.readJsonl(f); return { file: f, mtime: fs.statSync(f).mtimeMs, tail: L.tailState(r) }; }) : [];
  const procs = pid ? L.childProcs(pid, rows).filter(p => !TRIVIAL_CHILD(p)) : [];
  const toolProcs = toolProcsOf(procs);
  const text = live ? (L.capture(m.target) || '') : '';
  return { live, pane, pid, reg, sessionId, tfile, recs, tail, subs, procs, toolProcs, text };
}
// The /loop job of THIS process: a CronCreate after process start with an OK result, not deleted since.
// Cron jobs of the session: CronCreate results (job ids) minus CronDelete'd ones. Session-scoped
// ("durable": false) jobs are RESTORED by `claude --resume`, and a fire missed while the process
// was down is caught up immediately, so a resumed session can own jobs it never created.
function cronJobs(o) {
  const jobs = new Map();
  for (const r of o.recs) {
    const t = r.toolUseResult;
    if (r.type === 'user' && t && typeof t === 'object' && t.humanSchedule && t.id) {
      const use = o.tail.toolUses.find(u => L.contentOf(r).some(c => c.type === 'tool_result' && c.tool_use_id === u.id));
      jobs.set(t.id, { id: t.id, cron: use && use.input.cron, prompt: use && use.input.prompt, createdAt: r.timestamp });
    }
  }
  for (const u of o.tail.toolUses) if (u.name === 'CronDelete' && o.tail.toolResultIds.has(u.id)) jobs.delete(u.input.id || u.input.jobId || u.input.taskId);
  return [...jobs.values()];
}
// The /loop job alive in THIS process: created after process start, or fired after it (restored
// by --resume), or the project's scheduler lock is held by this pid (restored, not fired yet).
function loopJob(o, m) {
  if (!o.reg) return null;
  const since = o.reg.startedAt || 0;
  const jobs = cronJobs(o);
  const live = jobs.filter(j => Date.parse(j.createdAt) >= since
    || o.recs.some(r => r.subtype === 'scheduled_task_fire' && r.taskId === j.id && Date.parse(r.timestamp) >= since));
  if (live.length) {
    const j = live[live.length - 1];
    // Fires do not land on cron boundaries: */5 fired every 284.6-285.5 s (~0.95 x period) in round 0.
    const fires = o.recs.filter(r => r.subtype === 'scheduled_task_fire' && r.taskId === j.id).map(r => Date.parse(r.timestamp));
    const last = fires.length ? Math.max(...fires) : Date.parse(j.createdAt);
    const per = /^\*\/(\d+) \* \* \* \*$/.test(j.cron || '') ? Number(RegExp.$1) * 60000 : null;
    return Object.assign({}, j, { liveJobs: live.length, fires: fires.length, lastFire: fires.length ? L.iso(last) : null, nextFireEstimate: per ? L.iso(last + Math.round(per * 0.95)) : null });
  }
  const lk = m && schedLock(m);
  if (jobs.length && lk && lk.pid === o.pid) return Object.assign({}, jobs[jobs.length - 1], { liveJobs: jobs.length, restored: true });
  return null;
}
// <cwd>/.claude/scheduled_tasks.lock names the process that owns the project's cron jobs.
function schedLock(m) { try { return JSON.parse(fs.readFileSync(path.join(m.cwd, '.claude', 'scheduled_tasks.lock'), 'utf8')); } catch { return null; } }
function evaluate(m, o) {
  const v = m.verify || {}, checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  add('tmux', o.live, o.live ? m.target : 'no tmux session');
  add('claude', !!o.pid, o.pid ? `pid ${o.pid}` : 'claude not running');
  const want = (CFG.defaults || {}).expectModel;
  const bad = o.tail.models.filter(x => want && !x.includes(want));
  for (const s of o.subs) for (const x of s.tail.models) if (want && !x.includes(want)) bad.push(x);
  add('model', bad.length === 0, bad.length ? `unexpected ${[...new Set(bad)].join(',')}` : (o.tail.models[0] || 'no responses yet'));
  if (v.registry) for (const [k, want] of Object.entries(v.registry)) {
    const got = o.reg ? o.reg[k] : undefined;
    add(`registry.${k}`, Array.isArray(want) ? want.includes(got) : got === want, `${got === undefined ? '∅' : got}`);
  }
  if (v.pane) add('pane', new RegExp(v.pane, 'm').test(o.text), v.pane);
  if (v.paneAlso) add('paneAlso', new RegExp(v.paneAlso, 'm').test(o.text), v.paneAlso);
  if (v.paneNot) add('paneNot', !new RegExp(v.paneNot, 'm').test(o.text), v.paneNot);
  if (v.child) { const n = o.procs.filter(p => new RegExp(v.child).test(p.args)).length; add('child', n >= (v.childCount || 1), `${n} × /${v.child}/`); }
  if (v.noChild) add('noChild', o.toolProcs.length === 0, o.toolProcs.map(p => p.comm).join(',') || 'no tool process');
  if (v.last) add('last', o.tail.kind === v.last, o.tail.kind);
  if (v.notQuestion) add('notQuestion', o.tail.lastAsstText && !o.tail.lastAsstText.trim().endsWith('?'), o.tail.lastAsstText ? (o.tail.lastAsstText.trim().endsWith('?') ? 'ends with ?' : 'statement') : 'no text');
  if (v.noPending) add('noPending', o.tail.pending.length === 0, o.tail.pending.map(p => p.name).join(',') || 'none');
  if (v.pending) {
    const n = o.tail.pending.filter(p => new RegExp(v.pending).test(p.name)).length;
    add('pending', n === (v.pendingCount || 1), `${n} × ${v.pending}`);
  }
  if (v.subagents) {
    const since = o.reg && o.reg.statusUpdatedAt ? o.reg.statusUpdatedAt - 5000 : 0;
    const active = o.subs.filter(s => s.mtime >= since && s.tail.kind !== 'end_turn');
    add('subagents', active.length >= v.subagents.count, `${active.length} active of ${o.subs.length}`);
  }
  if (v.loop) { const j = loopJob(o, m); add('loop', !!j && j.liveJobs === 1, j ? `job ${j.id} cron ${j.cron}${j.liveJobs > 1 ? ` (${j.liveJobs} live jobs!)` : ''}${j.restored ? ' (restored)' : ''}` : 'no live cron job in this process'); }
  if (v.loopLock) { const lk = schedLock(m); add('loopLock', !!lk && lk.pid === o.pid, lk ? `lock pid ${lk.pid}` : 'no .claude/scheduled_tasks.lock'); }
  return { ok: checks.every(c => c.ok), checks };
}
function memberSpend(m, ms) {
  let resps = [];
  for (const sid of ms.sessions || (ms.sessionId ? [ms.sessionId] : [])) {
    resps = resps.concat(L.responsesOf(L.readJsonl(L.transcriptPath(m, sid))));
    for (const f of L.subagentFiles(m, sid)) resps = resps.concat(L.responsesOf(L.readJsonl(f)));
  }
  return L.tokenSums(resps).usd;
}

// ---------------------------------------------------------------- arming
async function waitFor(m, ms, secs, label) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < secs * 1000) {
    const o = observe(m, ms);
    last = evaluate(m, o);
    if (last.ok) { log(`  ${m.name}: ${label} verified in ${((Date.now() - t0) / 1000).toFixed(1)}s`); return true; }
    await L.sleep(500);
  }
  log(`  ${m.name}: ${label} NOT verified after ${secs}s: ${last.checks.filter(c => !c.ok).map(c => `${c.name}=${c.detail}`).join('; ')}`);
  return false;
}
async function waitIdle(m, ms, secs = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < secs * 1000) { const r = L.readRegistry(L.claudePidOf(m.target)); if (!r || r.status === 'idle') return true; await L.sleep(300); }
  return false;
}
// Cheapest path back into the member's state. Returns true when verified.
async function arm(m, st, { prompt = true } = {}) {
  const ms = st.members[m.name] = st.members[m.name] || {};
  ensureRepo(m);
  ensureTmux(m);
  let o = observe(m, ms);
  if (o.pid && evaluate(m, o).ok) { log(`  ${m.name}: already in state '${m.state}'`); ms.paused = false; saveStateMerged(st); return true; }
  if (!o.pid) {
    L.assertBudget(`launch ${m.name}`);
    let resume = ms.sessionId && fs.existsSync(L.transcriptPath(m, ms.sessionId)) ? ms.sessionId : null;
    // A loop member resumes only if its session holds exactly one job (restored + caught up on
    // resume); zero or duplicate jobs -> fresh session + /loop, so it never fires twice.
    if (resume && m.verify && m.verify.loop && cronJobs(o).length !== 1) resume = null;
    await launch(m, ms, { resume });
    saveStateMerged(st);
    if (resume && m.verify && m.verify.loop && (await waitFor(m, ms, 20, `restored loop`))) { ms.verifiedAt = Date.now(); ms.paused = false; saveStateMerged(st); return true; }
  }
  if (!prompt) return true;
  o = observe(m, ms);
  if (o.reg && o.reg.status !== 'idle') {
    // busy / waiting in the wrong state: Esc cancels a dialog or interrupts a turn (no API call).
    L.sendKeys(m.target, 'Escape'); await L.sleep(400);
    if (!(await waitIdle(m, ms, 20))) { L.sendKeys(m.target, 'Escape'); await waitIdle(m, ms, 20); }
  }
  if (m.name === 'kestrel' || (m.verify && m.verify.registry && m.verify.registry.waitingFor === 'permission prompt')) dropRememberedApprovals(m);
  L.assertBudget(`prompt ${m.name}`);
  const hasHistory = observe(m, ms).tail.kind !== 'empty';
  const text = hasHistory && m.rearmPrompt ? m.rearmPrompt : m.prompt;
  ms.armedAt = Date.now(); ms.armPrompt = text === m.prompt ? 'prompt' : 'rearmPrompt';
  await L.sendLine(m.target, text);
  saveStateMerged(st);
  const ok = await waitFor(m, ms, m.timeoutSec || 120, `state '${m.state}'`);
  ms.verifiedAt = ok ? Date.now() : null;
  if (ok) ms.paused = false;   // an Esc-paused member (claude still running) is armed again
  saveStateMerged(st);
  return ok;
}
// "Yes, and don't ask again" writes an allow rule to .claude/settings.local.json; strip it so the
// approval member keeps asking. Only touches the fleet repo's own local settings.
function dropRememberedApprovals(m) {
  const f = path.join(m.cwd, '.claude', 'settings.local.json');
  let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return; }
  const allow = (j.permissions && j.permissions.allow) || [];
  const keep = allow.filter(r => !/deploy\.sh/.test(r));
  if (keep.length !== allow.length) { j.permissions.allow = keep; fs.writeFileSync(f, JSON.stringify(j, null, 2) + '\n'); log(`  ${m.name}: removed remembered approval rule(s)`); }
}
function saveStateMerged(st) { const cur = L.loadState(); cur.members = Object.assign(cur.members || {}, st.members); L.saveState(cur); }

// ---------------------------------------------------------------- isolated watch root
function buildRoot() {
  const projDir = path.join(L.ROOT, 'projects'), sessDir = path.join(L.ROOT, 'sessions');
  fs.mkdirSync(projDir, { recursive: true }); fs.mkdirSync(sessDir, { recursive: true });
  const wantProj = new Set(), wantSess = new Set();
  const rows = L.psTable();
  for (const m of MEMBERS) {
    const src = path.join(L.PROJECTS, m.dname);
    if (fs.existsSync(src)) wantProj.add(m.dname);
    const pid = L.hasSession(m.target) ? L.claudePidOf(m.target, rows) : null;
    if (pid && fs.existsSync(path.join(L.SESSIONS, pid + '.json'))) wantSess.add(pid + '.json');
  }
  for (const e of fs.readdirSync(projDir)) if (!wantProj.has(e)) fs.rmSync(path.join(projDir, e), { force: true, recursive: false });
  for (const e of fs.readdirSync(sessDir)) if (!wantSess.has(e)) fs.rmSync(path.join(sessDir, e), { force: true });
  for (const d of wantProj) { const p = path.join(projDir, d); if (!fs.existsSync(p)) fs.symlinkSync(path.join(L.PROJECTS, d), p); }
  for (const s of wantSess) { const p = path.join(sessDir, s); try { fs.unlinkSync(p); } catch {} fs.symlinkSync(path.join(L.SESSIONS, s), p); }
  return { root: L.ROOT, projects: [...wantProj], sessions: [...wantSess] };
}

// ---------------------------------------------------------------- spend
function claudeJsonLastCosts() {
  // ~/.claude.json is read-only here; only fleet project entries are looked at, only numbers kept.
  let j; try { j = JSON.parse(fs.readFileSync(path.join(L.HOME, '.claude.json'), 'utf8')); } catch { return {}; }
  const out = {};
  for (const [cwd, p] of Object.entries(j.projects || {})) if (L.isFleetDname(L.dname(cwd)) && typeof p.lastCost === 'number') out[path.basename(cwd)] = { lastCost: p.lastCost, lastSessionId: p.lastSessionId };
  return out;
}
function spendReport(note) {
  const sp = L.fleetSpend();
  sp.claudeJsonLastCost = claudeJsonLastCosts();
  L.appendSpendLog(sp, note);
  return sp;
}
const budgetGuard = L.assertBudget;

// ---------------------------------------------------------------- commands
async function cmdStatus(names, json) {
  const st = L.loadState(), rows = L.psTable(), out = [];
  for (const m of pick(names)) {
    const ms = st.members[m.name] || {};
    const o = observe(m, ms, rows), ev = evaluate(m, o);
    const r = o.reg || {};
    out.push({
      name: m.name, state: m.state, ok: ev.ok, paused: !!ms.paused, target: o.pane ? o.pane.pane : null, tty: o.pane ? o.pane.tty : null,
      pid: o.pid, sessionId: o.sessionId, transcript: o.tfile,
      registry: o.reg ? { status: r.status, waitingFor: r.waitingFor, statusUpdatedAt: r.statusUpdatedAt, messagingSocketPath: r.messagingSocketPath, tmux: r.tmux, name: r.name } : null,
      last: { kind: o.tail.kind, pending: o.tail.pending.map(p => p.name), stopReason: o.tail.stopReason, lastTs: o.tail.lastTs },
      subagents: o.subs.map(s => ({ kind: s.tail.kind, pending: s.tail.pending.map(p => p.name), mtime: s.mtime })),
      procs: o.procs.map(p => p.comm + ' ' + p.args.slice(0, 60)), toolProcs: o.toolProcs.length,
      loop: m.verify && m.verify.loop ? loopJob(o, m) : undefined,
      checks: ev.checks, spendUsd: Math.round(memberSpend(m, ms) * 1e4) / 1e4,
      lease: L.readLease(m.name),
    });
  }
  const sp = L.fleetSpend();
  const res = { at: L.iso(), allOk: out.every(x => x.ok), members: out, spend: { transcriptsUsd: sp.total.usd, estimateWithHiddenUsd: L.estimateUsd(sp), stop: sp.refuseAt, cap: L.SPEND_CAP } };
  if (json) { log(JSON.stringify(res, null, 2)); return res; }
  for (const x of out) {
    const reg = x.registry ? `${x.registry.status}${x.registry.waitingFor ? '(' + x.registry.waitingFor + ')' : ''} ${ago(x.registry.statusUpdatedAt)}` : '-';
    log(`${x.ok ? 'OK  ' : x.paused ? 'PAUS' : 'FAIL'} ${x.name.padEnd(8)} ${x.state.padEnd(9)} ${String(x.target || '-').padEnd(13)} pid ${String(x.pid || '-').padEnd(6)} sess ${(x.sessionId || '-').slice(0, 8)}  reg ${reg.padEnd(34)} last ${x.last.kind}${x.last.pending.length ? '[' + x.last.pending.join(',') + ']' : ''}  $${x.spendUsd.toFixed(4)}${x.paused ? '  (paused)' : ''}${x.lease ? `  [lease: ${L.leaseLabel(x.lease)}]` : ''}`);
    if (!x.ok) log(`       failing: ${x.checks.filter(c => !c.ok).map(c => `${c.name}=${c.detail}`).join('; ')}`);
  }
  log(`fleet spend: $${res.spend.transcriptsUsd.toFixed(4)} in transcripts, ~$${res.spend.estimateWithHiddenUsd.toFixed(4)} incl. hidden calls (stop $${res.spend.stop}, cap $${L.SPEND_CAP})  ${res.allOk ? 'ALL GREEN' : 'NOT ALL GREEN'}`);
  return res;
}
// Per-turn cost timeline of a member's sessions: what each prompt / scheduled fire / task
// notification cost, plus each subagent transcript. Basis for the $/hour figures.
function turnCosts(m, ms) {
  const turns = [], subs = [];
  for (const sid of ms.sessions || (ms.sessionId ? [ms.sessionId] : [])) {
    const recs = L.readJsonl(L.transcriptPath(m, sid));
    let cur = null;
    const seen = new Set();
    for (const r of recs) {
      if (r.type === 'user' && !r.isMeta && !L.contentOf(r).some(c => c.type === 'tool_result') || (r.type === 'user' && (r.scheduledTaskId || r.turnOrigin === 'task_notification'))) {
        if (cur && r.turnOrigin === 'task_notification' && cur.origin === 'task_notification' && Date.parse(r.timestamp) - Date.parse(cur.start) < 3000) continue;
        cur = { session: sid.slice(0, 8), start: r.timestamp, origin: r.scheduledTaskId ? 'scheduled' : (r.turnOrigin || 'prompt'), responses: 0, usd: 0 };
        turns.push(cur);
      }
      if (r.type === 'assistant' && r.message && r.message.usage && r.message.model !== '<synthetic>' && cur) {
        const id = r.message.id; if (seen.has(id)) continue; seen.add(id);
        const resp = L.responsesOf(recs.filter(x => x.type === 'assistant' && x.message && x.message.id === id))[0];
        cur.responses++; cur.usd += L.usageCost(resp.model, resp.usage); cur.end = r.timestamp;
      }
    }
    for (const f of L.subagentFiles(m, sid)) {
      const rr = L.readJsonl(f), rs = L.responsesOf(rr), ts = rr.filter(x => x.timestamp).map(x => x.timestamp);
      subs.push({ file: path.basename(f), responses: rs.length, usd: L.tokenSums(rs).usd, first: ts[0], last: ts[ts.length - 1] });
    }
  }
  for (const t of turns) t.usd = Math.round(t.usd * 1e6) / 1e6;
  return { turns, subs };
}
async function cmdUp(names, { prompt }) {
  const st = L.loadState();
  st.members = st.members || {};
  let ok = true;
  for (const m of pick(names)) { log(`[${m.name}] ${m.state}`); ok = (await arm(m, st, { prompt })) && ok; }
  const r = buildRoot(); log(`root: ${r.projects.length} projects, ${r.sessions.length} live sessions`);
  return ok;
}
async function cmdPause(names) {
  const st = L.loadState();
  const list = names.length ? names.map(byName) : MEMBERS.filter(m => m.costly);
  for (const m of list) {
    const ms = st.members[m.name] = st.members[m.name] || {};
    const pid = L.hasSession(m.target) ? L.claudePidOf(m.target) : null;
    if (!pid) { log(`  ${m.name}: not running`); ms.paused = true; continue; }
    const reg = L.readRegistry(pid);
    const wasBusy = !!reg && reg.status !== 'idle';
    if (wasBusy) { L.sendKeys(m.target, 'Escape'); await L.sleep(500); await waitIdle(m, ms, 8); }
    // Esc interrupts a foreground tool, but async subagents (Agent tool default in 2.1.x) and a
    // /loop cron job live on inside the process: exit claude. The transcript stays; rearm resumes it.
    const after = L.readRegistry(pid);
    if ((m.verify && m.verify.loop) || (after && after.status !== 'idle')) {
      await L.sendLine(m.target, '/exit', { settleMs: 300 });
      const t0 = Date.now();
      while (L.claudePidOf(m.target) && Date.now() - t0 < 20000) {
        await L.sleep(400);
        // background agents still running -> "1. Exit and stop tasks" confirmation
        if (/Exit and stop tasks/.test(L.capture(m.target) || '')) await chooseOption(m.target, /Exit and stop tasks/);
      }
      if (L.claudePidOf(m.target)) { L.sendKeys(m.target, 'C-c'); await L.sleep(500); L.sendKeys(m.target, 'C-c'); await L.sleep(1500); }
      const left = descendantsOfPane(m).filter(p => /\.sh$|sleep/.test(p.comm));
      log(`  ${m.name}: claude exited (session ${ms.sessionId})${left.length ? `; ${left.length} tool processes outlived it` : ''}`);
    } else log(`  ${m.name}: ${wasBusy ? 'interrupted, idle' : 'already idle'} (claude kept running: no API calls while idle)`);
    Object.assign(ms, { paused: true, pausedAt: Date.now() });
  }
  saveStateMerged(st);
  buildRoot();
}
function descendantsOfPane(m) { const info = L.paneInfo(m.target); return info ? L.descendants(info.panePid).map(p => ({ pid: p.pid, comm: path.basename(p.comm) })) : []; }
function cmdDown(names) {
  const list = names.length ? names.map(n => byName(n).target) : L.fleetSessions();
  for (const s of list) { L.assertOurs(s); if (L.tmux(['kill-session', '-t', '=' + s], { allowFail: true }) !== null) log(`  killed ${s}`); }
  buildRoot();
}
async function cmdSend(name, text) {
  const m = byName(name);
  budgetGuard(`send to ${name}`);
  if (!L.claudePidOf(m.target)) throw new Error(`${name}: claude not running`);
  await L.sendLine(m.target, text);
  log(`  sent to ${m.target}`);
}
function cmdAttach(name) {
  const m = byName(name || MEMBERS[0].name);
  if (!L.hasSession(m.target)) throw new Error(`${m.target} not running`);
  const cmd = `${L.TMUX} attach -t ${m.target}`;
  // One window only: if Terminal is not running, `do script` would add a second window to the
  // default one Terminal opens at launch, so reuse that one.
  const running = spawnSync('/usr/bin/pgrep', ['-xq', 'Terminal']).status === 0;
  const script = running
    ? `tell application "Terminal" to do script "${cmd}"`
    : `tell application "Terminal"\nactivate\ndelay 1\ndo script "${cmd}" in window 1\nend tell`;
  const r = spawnSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('osascript: ' + r.stderr);
  log(`  Terminal.app window attached to ${m.target}`);
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  // options that take a value (--ttl 1800 or --ttl=1800); their values are not positional
  const VALUED = new Set(['--ttl', '--as', '--note']);
  const opts = {}, pos = [], flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i], eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0 && VALUED.has(a.slice(0, eq))) opts[a.slice(0, eq)] = a.slice(eq + 1);
    else if (VALUED.has(a)) opts[a] = rest[++i];
    else if (a.startsWith('--')) flags.add(a);
    else pos.push(a);
  }
  const me = opts['--as'] || process.env.VP_LEASE_OWNER || null;
  switch (cmd) {
    case 'up': leaseGate(pick(pos), 'up', me); process.exitCode = (await cmdUp(pos, { prompt: !flags.has('--no-prompt') })) ? 0 : 1; break;
    case 'status': { const r = await cmdStatus(pos, flags.has('--json')); process.exitCode = r.allOk ? 0 : 1; break; }
    case 'rearm': { if (!pos.length) throw new Error('rearm <name...>'); leaseGate(pos.map(byName), 'rearm', me); const st = L.loadState(); let ok = true; for (const m of pos.map(byName)) { log(`[${m.name}] rearm`); ok = (await arm(m, st)) && ok; } buildRoot(); process.exitCode = ok ? 0 : 1; break; }
    case 'pause': leaseGate(pos.length ? pos.map(byName) : MEMBERS.filter(m => m.costly), 'pause', me); await cmdPause(pos); break;
    case 'lease': {
      const [name, owner] = pos;
      if (!name || !owner) throw new Error('lease <name> <owner> [--ttl SECONDS]');
      byName(name);
      const r = L.acquireLease(name, owner, { ttlSec: opts['--ttl'] != null ? Number(opts['--ttl']) : L.LEASE_TTL_SEC });
      if (r.ok) log(`  ${name}: lease ${r.action} by ${owner} for ${r.lease.ttlSec}s (until ${r.lease.expiresAt})${r.broke ? `; broke the stale lease of ${r.broke.owner || '(unknown)'} from ${r.broke.at}` : ''}`);
      else log(`  ${name}: ${r.action === 'held' ? 'held' : r.action} by ${r.lease ? r.lease.owner || '(unknown)' : '?'} since ${r.lease ? r.lease.at : '?'} (${r.lease ? r.lease.leftSec : '?'}s left); not taken`);
      process.exitCode = r.ok ? 0 : 3;
      break;
    }
    case 'release': {
      const [name, owner] = pos;
      if (!name) throw new Error('release <name> [owner] [--force]');
      byName(name);
      const r = L.releaseLease(name, { owner: owner || null, force: flags.has('--force') });
      if (r.action === 'released') log(`  ${name}: released (was ${r.lease.owner || '(unknown)'} since ${r.lease.at})`);
      else if (r.action === 'free') log(`  ${name}: not leased`);
      else log(`  ${name}: not released: held by ${r.lease ? r.lease.owner || '(unknown)' : '?'}${r.action === 'changed' ? ' (changed while releasing)' : ''}; --force to take it anyway`);
      process.exitCode = r.ok ? 0 : 3;
      break;
    }
    case 'down': cmdDown(pos); break;
    case 'spend': {
      const i = rest.indexOf('--note'); const sp = spendReport(i >= 0 ? rest[i + 1] : undefined);
      log(`fleet spend: transcripts $${sp.total.usd.toFixed(4)} at Haiku 4.5 prices; estimate incl. hidden calls $${sp.estimate.toFixed(4)} (cost-state of ${sp.hidden.sessionsWithCostState} exited sessions $${sp.hidden.costStateUsd} vs their transcripts $${sp.hidden.transcriptUsdCovered} = +${Math.round((sp.hidden.observedOverhead || 0) * 100)}%; applied +${Math.round(sp.hidden.appliedOverhead * 100)}% to the rest); stop $${sp.refuseAt} (${L.spendStop().from}), cap $${L.SPEND_CAP}; ${sp.total.responses} responses; models ${JSON.stringify(sp.models)}`);
      for (const [d, v] of Object.entries(sp.byDir)) log(`  ${d.replace(/^.*-vibepet-ultra-fleet-/, '').padEnd(10)} $${v.usd.toFixed(4)}  resp ${v.responses}  in ${v.input} out ${v.output} cw1h ${v.cacheWrite1h} cw5m ${v.cacheWrite5m} cr ${v.cacheRead}  files ${v.files}${v.costStateUsd ? `  cost-state $${v.costStateUsd.toFixed(4)}` : ''}`);
      if (Object.keys(sp.claudeJsonLastCost).length) log(`  ~/.claude.json lastCost (last exited session per repo, incl. hidden calls): ${JSON.stringify(sp.claudeJsonLastCost)}`);
      log(`  logged to ${path.join(L.EVID, 'fleet-spend.jsonl')}`);
      break;
    }
    case 'root': { const r = buildRoot(); log(JSON.stringify(r, null, 2)); break; }
    case 'send': {   // the text is everything after the name, verbatim (flags like --dry-run included); only --as is taken out
      const words = rest.filter((a, i) => !(a === '--as' || a.startsWith('--as=') || (i > 0 && rest[i - 1] === '--as')));
      leaseGate([byName(words[0])], 'send', me);
      await cmdSend(words[0], words.slice(1).join(' '));
      break;
    }
    case 'attach': cmdAttach(pos[0]); break;
    case 'costs': { const st = L.loadState(); for (const m of pick(pos)) { const c = turnCosts(m, st.members[m.name] || {}); log(`[${m.name}]`); for (const t of c.turns) log(`  ${t.start} ${t.session} ${t.origin.padEnd(17)} resp ${String(t.responses).padStart(2)}  $${t.usd.toFixed(5)}`); for (const x of c.subs) log(`  subagent ${x.file} ${x.first}..${x.last} resp ${x.responses} $${x.usd.toFixed(5)}`); } break; }
    default:
      log('usage: fleet.js up|status|rearm|pause|down|spend|root|send|attach|costs|lease|release  (see header)'); process.exitCode = 2;
  }
})().catch(e => { console.error('fleet:', e.message); process.exitCode = 1; });
