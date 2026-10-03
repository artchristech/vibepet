#!/usr/bin/env node
// test/ultra/tta.js — time-to-attention on the LIVE fixture fleet, through the real UI.
//
// For a fleet session that starts needing you, it measures:
//   detect      seconds from the block's start (transcript timestamp of the tool_use / end_turn; also the registry's
//               statusUpdatedAt) to the first signal you can see on the pet: bubble, LED, face (Home closed), or the
//               Home row (a second instance keeps Home open)
//   actionable  seconds until the pet offers an action for it in a row (Approve / Reply), and whether that action
//               really works (it is pressed, then the fleet session is checked: did the command run, did the text land)
//   clicks      clicks and keys spent on the pet to resolve it, and whether it can be resolved from the pet at all
//
//   node test/ultra/tta.js --app <worktree> --out <dir> --plan approval:3,askuser:3 [--quiet kestrel,beacon]
//        [--interleave] [--budget 0.60] [--poll 250]       trials append to <out>/trials.jsonl (numbers continue)
//   node test/ultra/tta.js --report <dir> [--json FILE] [--full]   summary per kind (censored medians); --full adds
//        the raw trials and each invocation's setup
//   node test/ultra/tta.js --smoke --out <dir>            launch + instrument + probe both instances, no fleet driving
//
// Kinds (member): approval (kestrel: Esc, re-prompt), askuser (beacon: AskUserQuestion, same), question (vibepet: an
// end_turn that asks), done (vibepet: an end_turn statement; with --interleave each done prompt answers the question),
// loop (ember: its own `/loop 5m run ./tick.sh`, with an `ask` rule for ./tick.sh in .claude/settings.local.json so every
// fire stalls on an approval; the trial starts at the fire; teardown approves in the terminal, because a session whose
// fires get rejected stops calling the tool; the rule is removed and ember exited at the end), subagent (delta: one
// general-purpose subagent runs `touch shards/.probe`, which needs approval; its dialog opens in delta's terminal).
// --quiet dismisses (Esc) the named members' standing dialogs first: the LED and face are shared by every session.
//
// Two instances of the app under test (--app), both on the isolated fleet root: A keeps Home closed (the pet as it
// sits on the desktop; its bubble, LED and face are the ambient signal; resolution attempts happen here: click Net,
// press the row's action), B keeps Home open (the rows). Both are polled read-only every --poll ms.
//
// Safety: launch()'s privacy guard (isolated root + userData under ~/.vibepet-ultra). canon's instrument() in main:
// dialogs answer themselves, the clipboard / openExternal only record, jump and send-to are spied. Sounds are recorded
// in the renderer instead of played (AudioContext stub) — the instances run unmuted, as shipped, without beeping at
// whoever sits at this Mac. Approve / Reply are pressed only when the session's terminal is not a GUI app. Fleet
// sessions are driven only through test/fleet/lib.js (vp-* tmux targets, fleet transcripts and registry files only),
// and every prompt is spend-guarded: --budget caps this probe's estimated spend (hidden calls included).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const HERE = path.resolve(__dirname, '..', '..');
const L = require('../fleet/lib');
const ULTRA = L.ULTRA;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = k => argv.includes(k);
const iso = t => new Date(t).toISOString();
const r1 = x => x == null ? null : Math.round(x / 100) / 10;   // ms → s, 0.1 s

// ---------------------------------------------------------------- kinds
const QPROMPT = 'Ask me one short yes/no question about this project, for example whether you should add a test. Reply with only that question, ending with a question mark. Do not read files or run commands.';
const SUBPROMPT = 'Start exactly one general-purpose subagent with the Agent tool. Its only task: run exactly `touch shards/.probe` with the Bash tool, then reply with the single word done; if the command is rejected or denied, reply with the single word rejected and stop. Do not run anything yourself and do not start any other subagent.';
const KINDS = {
  approval: { member: 'kestrel', windowSec: 240, want: 'approve', block: 'waiting', label: 'approval (Bash permission prompt)' },
  askuser: { member: 'beacon', windowSec: 240, want: 'reply', block: 'waiting', answer: 'SQLite', label: 'AskUserQuestion (multiple choice)' },
  question: { member: 'vibepet', windowSec: 120, want: 'reply', block: 'question', answer: 'yes', label: 'plain end-turn question' },
  done: { member: 'vibepet', windowSec: 120, want: 'reply', block: 'statement', label: 'done (end-turn statement)' },
  loop: { member: 'ember', windowSec: 200, want: 'approve', block: 'waiting', label: '/loop wakeup stalled on an approval' },
  subagent: { member: 'delta', windowSec: 300, want: 'approve', block: 'waiting', label: 'subagent blocked on approval' },
};
const LOOP_ASK = JSON.stringify({ permissions: { ask: ['Bash(./tick.sh)', 'Bash(./tick.sh:*)', 'Bash(./tick.sh *)'] } }, null, 2) + '\n';   // ember's ./tick.sh asks first
const SIG = { waiting: 'needs', stalled: 'stuck', ready: 'ready', working: 'running' };
const ATTN = new Set(['needs', 'stuck', 'ready']);

// ---------------------------------------------------------------- fleet (through lib.js only: vp-* targets, fleet files)
const CFG = L.loadMembers();
const member = name => { const m = CFG.members.find(x => x.name === name); if (!m) throw new Error(`no member ${name}`); return m; };
const FLEET_JS = path.join(HERE, 'test', 'fleet', 'fleet.js');
function fleetNow(m, { transcript = true, pane = true } = {}) {
  const pid = L.claudePidOf(m.target), reg = L.readRegistry(pid);
  const o = { at: Date.now(), pid, sid: reg?.sessionId || null, status: reg?.status || null, waitingFor: reg?.waitingFor || null, statusAt: reg?.statusUpdatedAt || null };
  if (pane) { const txt = L.capture(m.target) || ''; o.dialog = /Do you want to proceed\?/.test(txt); o.select = /Enter to select/.test(txt); }
  if (transcript && o.sid) {
    const recs = L.readJsonl(L.transcriptPath(m, o.sid)), t = L.tailState(recs);
    o.tail = { kind: t.kind, lastTs: t.lastTs, pending: t.pending.map(p => ({ id: p.id, name: p.name, ts: p.ts })), endsWithQ: t.lastAsstText ? t.lastAsstText.trim().endsWith('?') : null, stop: t.stopReason };
    o.records = recs.length;
    o.subs = L.subagentFiles(m, o.sid).map(f => { const rr = L.readJsonl(f), tt = L.tailState(rr); let st = null; try { st = fs.statSync(f); } catch {}
      return { file: path.basename(f), kind: tt.kind, pending: tt.pending.map(p => ({ id: p.id, name: p.name, ts: p.ts })), mtime: st?.mtimeMs || null, size: st?.size || null }; });
    o._recs = recs;
  }
  return o;
}
const strip = o => { if (!o) return o; const { _recs, ...rest } = o; return rest; };
function toolResultFor(recs, id) {
  for (const r of recs || []) if (r.type === 'user') for (const c of L.contentOf(r)) if (c.type === 'tool_result' && c.tool_use_id === id) return { at: r.timestamp, isError: !!c.is_error, interrupted: /interrupted by user|doesn't want to proceed/i.test(JSON.stringify(c.content || '')) };
  return null;
}
function userTextAfter(recs, t) {   // structure only: did a human-typed user record land after t (no text kept)
  return (recs || []).some(r => r.type === 'user' && !r.isMeta && Date.parse(r.timestamp) >= t && !L.contentOf(r).some(c => c.type === 'tool_result') && L.contentOf(r).some(c => c.type === 'text' && !/^\s*</.test(c.text || '')));
}
function runFleet(args) {   // async: the poller must keep running while fleet.js waits on a member
  return new Promise(res => {
    const p = spawn(process.execPath, [FLEET_JS, ...args], { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
    p.on('close', code => res({ code, out: out.trim().split('\n').slice(-12).join('\n') }));
  });
}
function spendNow(note) { const sp = L.fleetSpend(); if (note && !flag('--smoke')) L.appendSpendLog(sp, note); return { usd: sp.total.usd, est: sp.estimate, at: sp.at }; }
// the GUI app a process runs under (first .app ancestor), or null: a tmux pane has none. Same check as canon's --act.
function guiHost(pid) {
  const rows = new Map(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n')
    .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => [+m[1], { ppid: +m[2], comm: m[3] }]));
  if (!rows.has(pid)) return 'unknown (no such pid)';
  for (let p = rows.get(pid).ppid, n = 0; p > 1 && n < 24; p = rows.get(p)?.ppid, n++) {
    const m = (rows.get(p)?.comm || '').match(/^(.*?\.app)\/Contents\//);
    if (m) return path.basename(m[1]);
  }
  return null;
}

// ---------------------------------------------------------------- renderer + main probes (read-only)
const PROBE = () => {
  const $ = id => document.getElementById(id), b = $('bubble');
  const vis = el => {
    if (!el) return 'none';
    const cs = getComputedStyle(el);
    if (el.classList.contains('hidden') || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return 'hidden';
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return 'hidden';
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
    return top && (top === el || el.contains(top)) ? 'visible' : 'occluded';
  };
  const box = $('now').getBoundingClientRect();
  return {
    t: Date.now(),
    bubble: { state: vis(b), text: (b.textContent || '').slice(0, 140), cls: b.className },
    led: agentSignals()[0] || 'none', face: baseState(performance.now()), hovering,
    home: !$('chat').classList.contains('hidden'),
    queue: pending().map(a => a.id),
    sounds: window.__tta ? window.__tta.sounds.length : null,
    agents: ((snap && snap.agents) || []).map(a => ({ id: a.id, name: a.name, title: a.title || null, phase: a.phase, since: a.since, ask: a.ask ? String(a.ask).slice(0, 80) : null,
      fan: a.fanout ? [a.fanout.open, a.fanout.total, a.fanout.stuck] : null })),
    rows: [...document.querySelectorAll('#now .nr[data-id]')].map(r => { const rb = r.getBoundingClientRect(); return {
      id: r.dataset.id, sig: ['needs', 'stuck', 'ready', 'running'].find(c => r.classList.contains(c)) || null, label: r.querySelector('.nm small')?.textContent || '',
      ask: (r.querySelector('.na')?.textContent || '').slice(0, 80) || null, actions: [...r.querySelectorAll('.nb button[data-do]')].map(x => x.dataset.do),
      aboveFold: rb.top >= box.top - 1 && rb.bottom <= box.bottom + 1 }; }),
  };
};
const MAINPROBE = electron => ({ notes: globalThis.__vibepet.notes.length, idleSec: electron.powerMonitor.getSystemIdleTime(), muted: globalThis.__vibepet.state().muted, alerts: globalThis.__vibepet.state().alerts });
// sounds are recorded, not played: installed before the instance is unmuted, so no real AudioContext ever exists
const AUDIO_STUB = () => {
  if (window.__tta) return { already: true };
  const T = window.__tta = { sounds: [] };
  const Fake = function () {
    return { currentTime: 0, destination: {},
      createOscillator: () => { const o = { type: '', frequency: { value: 0 }, connect: x => x, start: () => T.sounds.push({ t: Date.now(), f: o.frequency.value }), stop: () => {} }; return o; },
      createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: x => x }) };
  };
  window.AudioContext = Fake; window.webkitAudioContext = Fake;
  return { realContext: typeof actx !== 'undefined' && !!actx };
};
const timeout = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`${what}: no answer in ${ms} ms`); })]);

// ---------------------------------------------------------------- run
async function run() {
  const appDir = path.resolve(arg('--app', path.join(ULTRA, 'int'))), out = path.resolve(arg('--out'));
  const root = path.resolve(arg('--root', path.join(ULTRA, 'root', '.claude'))), pollMs = +arg('--poll', 250), budget = +arg('--budget', 0.6);
  const plan = String(arg('--plan', '')).split(',').filter(Boolean).flatMap(x => { const [k, n] = x.split(':'); if (!KINDS[k]) throw new Error(`unknown kind ${k}`); return Array.from({ length: +(n || 3) }, (_, i) => ({ kind: k, n: i + 1 })); });
  { let prior = []; try { prior = fs.readFileSync(path.join(out, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
    for (const p of plan) p.n += prior.filter(t => t.kind === p.kind).length; }
  if (flag('--interleave')) plan.sort((a, b) => a.n - b.n || Object.keys(KINDS).indexOf(a.kind) - Object.keys(KINDS).indexOf(b.kind));
  fs.mkdirSync(out, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const log = (...a) => { const l = `[${new Date().toISOString().slice(11, 23)}] ${a.join(' ')}`; console.log(l); fs.appendFileSync(path.join(out, 'run.log'), l + '\n'); };

  // budget: this probe's spend counts from the first invocation's estimate (kept in out/budget.json)
  const bf = path.join(out, 'budget.json');
  let B; try { B = JSON.parse(fs.readFileSync(bf, 'utf8')); } catch { B = { startEst: spendNow('tta-before: probe start').est, startAt: iso(Date.now()), budget }; fs.writeFileSync(bf, JSON.stringify(B, null, 2)); }
  const spent = () => spendNow().est - B.startEst;
  const sp0 = spendNow(`tta-before: invocation start (${plan.map(p => p.kind + p.n).join(' ')})`);
  log(`plan ${plan.map(p => `${p.kind}#${p.n}`).join(' ')} · spend est $${sp0.est.toFixed(4)} · this probe so far $${(sp0.est - B.startEst).toFixed(4)} of $${budget}`);

  const { launch } = require('./launch');
  const { instrument, SEED } = require('./canon');
  let git = null; try { git = execFileSync('git', ['-C', appDir, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim() + ' @ ' + execFileSync('git', ['-C', appDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
  // shipped defaults for what reaches you: alerts 'done' (blocked + finished), sound + banners on (banners are recorded
  // in test mode, never posted). Start muted only until the audio stub is in, then unmute.
  const state = { ...SEED, alerts: 'done', muted: true };
  const env = { ANTHROPIC_API_KEY: '' };
  const [A, Bi] = await Promise.all([launch({ appDir, root, state, env }), launch({ appDir, root, state, env })]);
  const I = { A, B: Bi };
  const setup = {};
  for (const [k, v] of Object.entries(I)) {
    setup[k] = { pid: v.pid, readyMs: v.readyMs, instrument: await v.evalMain(instrument), audio: await v.win.evaluate(AUDIO_STUB) };
    if (setup[k].audio.realContext) throw new Error(`${k}: a real AudioContext already exists; refusing to unmute`);
    setup[k].prefs = await v.evalMain(() => { const s = globalThis.__vibepet.state(); s.muted = false; globalThis.__vibepet.tick(); return { muted: s.muted, alerts: s.alerts, feel: s.feel, animations: s.animations }; });
  }
  await I.B.openHome();
  const meta = { app: appDir, git, root, startedAt: iso(Date.now()), pollMs, setup, perms: await I.A.evalMain(() => globalThis.__vibepet.snapshot().perms).catch(() => null), prefs: setup.A.prefs };
  fs.writeFileSync(path.join(out, `meta-${Date.now()}.json`), JSON.stringify({ ...meta, plan }, null, 2));
  log(`instances A pid ${A.pid} (Home closed), B pid ${Bi.pid} (Home open) · app ${git} · perms ${JSON.stringify(meta.perms)}`);

  // ---------------- poller: both instances, read-only, every pollMs; keeps the samples of the active trial
  let active = null, stopPoll = false, reopenB = 0, pollErrors = 0;
  const shotQ = []; let shotBusy = false;
  async function shotWorker() {
    if (shotBusy) return; shotBusy = true;
    try { while (shotQ.length) { const s = shotQ.shift(); if (s.delay) await sleep(s.delay); try { await I[s.inst].shot(s.file); s.trial.shots.push({ file: path.relative(out, s.file), at: Date.now(), label: s.label }); } catch (e) { s.trial.shots.push({ file: null, label: s.label, error: e.message.split('\n')[0] }); } } }
    finally { shotBusy = false; }
  }
  const shoot = (trial, inst, label, delay = 0) => { if (!trial) return; const file = path.join(out, 'shots', `${trial.kind}-${trial.n}`, `${Math.max(0, (Date.now() - trial.trigger) / 1000).toFixed(1).padStart(5, '0')}s-${inst}-${label}.png`); shotQ.push({ trial, inst, label, file, delay }); shotWorker(); };
  async function poll() {
    while (!stopPoll) {
      const t = Date.now();
      try {
        const [a, b, ma] = await timeout(Promise.all([I.A.win.evaluate(PROBE), I.B.win.evaluate(PROBE), I.A.evalMain(MAINPROBE)]), 4000, 'poll');
        if (active) onSample(active, a, b, ma);
        if (!b.home && !(active && active.attempting)) { reopenB++; await I.B.openHome().catch(() => {}); }
      } catch (e) { pollErrors++; if (pollErrors % 20 === 1) log(`poll error: ${e.message.split('\n')[0]}`); }
      await sleep(Math.max(0, pollMs - (Date.now() - t)));
    }
  }
  // first-seen bookkeeping per channel for the trial's member (by session id, else by name). A signal counts only if it
  // is new since the trigger (the phase's `since`, the bubble's own appearance) and is the kind's own signal.
  const EXPECT = { approval: ['stuck', 'needs'], askuser: ['needs', 'stuck'], question: ['needs', 'stuck'], done: ['ready'], loop: ['stuck', 'needs'], subagent: ['stuck', 'needs'] };
  const BUBBLE = { done: /is done/ };
  const BUBBLE_BLOCK = /needs approval|blocked on approval|has a question|waiting on you|waited on your answer/;
  function mine(trial, list) { return list.find(x => x.id === trial.sid) || (trial.sid ? null : list.find(x => x.name === trial.name)) || null; }
  function onSample(trial, a, b, ma) {
    const t = a.t, F = trial.first, ag = mine(trial, a.agents), bg = mine(trial, b.agents), row = mine(trial, b.rows.map(r => ({ ...r, name: (b.agents.find(x => x.id === r.id) || {}).name })));
    if (!trial.sid && ag) trial.sid = ag.id;
    const names = [trial.name, ag?.title].filter(Boolean);
    const says = s => s.state !== 'hidden' && s.state !== 'none' && names.some(n => s.text.includes(n));
    const sigA = ag ? SIG[ag.phase] || ag.phase : 'absent', sigB = row ? row.sig : (bg ? 'off-list' : 'absent');
    // a bubble's own episode: it counts from the sample it (re)appeared with new text
    for (const [k, s] of [['A', a.bubble], ['B', b.bubble]]) {
      const key = s.state === 'hidden' || s.state === 'none' ? '' : s.cls + '|' + s.text.slice(0, 12);
      if (key !== trial.bub[k].key) trial.bub[k] = { key, start: t };
    }
    // the LED and face are shared by every session: they count only if they CHANGED after the trigger
    if (a.led !== trial.ledVal) { trial.ledVal = a.led; trial.ledChangedAt = t; }
    if (a.face !== trial.faceVal) { trial.faceVal = a.face; trial.faceChangedAt = t; }
    // compact timeline of what changed
    const sig = JSON.stringify([sigA, ag?.since, a.led, a.face, a.bubble.state, says(a.bubble) ? a.bubble.text.slice(0, 60) : '', a.home, sigB, row ? row.actions.join('+') : '', b.bubble.state, says(b.bubble) ? 1 : 0, a.queue.indexOf(trial.sid), ma.notes, a.sounds, ag?.fan || null, row?.label || '']);
    if (sig !== trial.lastSig) { trial.lastSig = sig; trial.timeline.push({ t, A: { phase: ag?.phase || null, since: ag?.since || null, sig: sigA, led: a.led, face: a.face, bubble: a.bubble.state, bubbleText: says(a.bubble) ? a.bubble.text : null, bubbleCls: a.bubble.cls, home: a.home, queuePos: a.queue.indexOf(trial.sid), notes: ma.notes, sounds: a.sounds, idleSec: ma.idleSec, fan: ag?.fan || null, ask: ag?.ask || null, hovering: a.hovering },
      B: { sig: sigB, since: bg?.since || null, actions: row?.actions || null, label: row?.label || null, aboveFold: row?.aboveFold ?? null, bubble: b.bubble.state, bubbleSays: says(b.bubble), home: b.home } }); }
    // phase segments of the member (A's snapshot)
    const ph = ag ? ag.phase : 'absent', segs = trial.phases, last = segs[segs.length - 1];
    if (!last || last.phase !== ph) segs.push({ phase: ph, from: t, to: t }); else last.to = t;
    if (t < trial.trigger || trial.attempting || trial.attemptAt) return;   // only what the block itself caused
    const exp = EXPECT[trial.kind], fresh = x => x && x.since >= trial.trigger - 100;
    const bubbleRe = BUBBLE[trial.kind] || BUBBLE_BLOCK;
    const set = (k, extra) => { if (F[k]) return false; F[k] = { t, ...extra }; return true; };
    // a bubble types itself out (18 ms a letter): it is seen from its first letters, judged on its full text
    if (says(a.bubble) && trial.bub.A.start >= trial.trigger && bubbleRe.test(a.bubble.text) && set('bubbleA', { text: a.bubble.text, cls: a.bubble.cls, start: trial.bub.A.start })) shoot(trial, 'A', 'bubble', 700);
    if (says(a.bubble) && trial.bub.A.start >= trial.trigger && t - trial.bub.A.start > 1500 && !bubbleRe.test(a.bubble.text)) set('otherBubbleA', { text: a.bubble.text });
    if (fresh(ag) && exp.includes(sigA) && a.led === sigA && trial.ledChangedAt >= trial.trigger && set('ledA', { led: a.led })) shoot(trial, 'A', `led-${a.led}`);
    if (fresh(ag) && exp.includes(sigA) && ['alert', 'waiting', 'stalled', 'ready'].includes(a.face) && trial.faceChangedAt >= trial.trigger) set('faceA', { face: a.face });
    if (fresh(ag) && exp.includes(sigA)) set('phaseA', { phase: ag.phase, ask: ag.ask });
    if (fresh(ag) && ATTN.has(sigA) && !exp.includes(sigA)) set('wrongA', { phase: ag.phase, ask: ag.ask });
    if (fresh(ag) && (ag.phase === 'stalled' || ag.phase === 'waiting')) set('offerA', { action: ag.phase === 'stalled' ? 'approve' : 'reply', phase: ag.phase });
    if (fresh(bg) && row && exp.includes(row.sig) && set('rowB', { sig: row.sig, label: row.label, actions: row.actions, aboveFold: row.aboveFold, ask: row.ask })) shoot(trial, 'B', `row-${row.sig}`);
    if (fresh(bg) && row && (row.actions.includes('approve') || row.actions.includes('reply')) && set('offerB', { actions: row.actions })) shoot(trial, 'B', `offer-${row.actions.filter(x => x === 'approve' || x === 'reply').join('+')}`);
    if (says(b.bubble) && trial.bub.B.start >= trial.trigger && bubbleRe.test(b.bubble.text)) set('bubbleB', { state: b.bubble.state, text: b.bubble.text, start: trial.bub.B.start });
    if (ma.notes > trial.notes0) set('bannerA', { notes: ma.notes, idleSec: ma.idleSec });
    if (a.sounds > trial.sounds0) set('soundA', { sounds: a.sounds });
    if (fresh(ag) && a.queue[0] === trial.sid) set('queueHeadA', {});
    if (trial.seenAgent && !ag) set('goneA', { lastPhase: trial.lastPhase });
    if (ag) { trial.seenAgent = true; trial.lastPhase = ag.phase; }
  }
  const poller = poll();
  if (flag('--smoke')) {   // no fleet driving: setup + probes + one shot each, then close
    try {
      await sleep(4000);
      const [a, b, ma] = await Promise.all([I.A.win.evaluate(PROBE), I.B.win.evaluate(PROBE), I.A.evalMain(MAINPROBE)]);
      log('smoke A ' + JSON.stringify({ led: a.led, face: a.face, home: a.home, bubble: a.bubble.state, sounds: a.sounds, agents: a.agents.map(x => `${x.name}:${x.phase}`), queue: a.queue.length }));
      log('smoke B ' + JSON.stringify({ home: b.home, rows: b.rows.map(r => `${r.sig}:${r.actions.join('+')}:${r.aboveFold}`), bubble: b.bubble.state }));
      log('smoke main ' + JSON.stringify(ma));
      await I.A.shot(path.join(out, 'smoke-A.png')); await I.B.shot(path.join(out, 'smoke-B.png'));
    } finally { stopPoll = true; await poller.catch(() => {}); const c = await Promise.all([I.A.close(), I.B.close()]); log('smoke closed ' + JSON.stringify(c.map(x => [x.how, x.orphans.length]))); }
    return;
  }

  // ---------------- pet-side resolution attempt (instance A): click Net, press the row's action, verify on the fleet
  async function attempt(trial, m, K) {
    const W = I.A.win, R = { clicks: 0, keys: 0, steps: [] }, sel = id => `#now .nr[data-id="${id}"]`;
    const calls = () => I.A.evalMain(() => globalThis.__canon.calls);
    const waitCall = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = (await calls()).filter(x => x.at >= t && x.kind === kind); if (c.length) return c[0]; if (Date.now() > end) return null; await sleep(100); } };
    const lastNote = () => W.evaluate(() => { const n = [...document.querySelectorAll('#msgs .msg.note')]; return n.length ? n[n.length - 1].textContent.slice(0, 160) : null; });
    // a loaded Mac (load average > 100 seen) can make Playwright's actionability wait time out while Home re-renders
    // every tick: retry, then click where the button is (still a trusted mouse click), and say so in the steps
    const press = async (selector, what) => {
      for (let i = 0; i < 3; i++) {
        try { await W.locator(selector).click({ timeout: 8000, force: i > 0 }); if (i) R.steps.push({ step: `${what}: clicked on try ${i + 1}${i ? ' (force)' : ''}` }); return true; }
        catch (e) { R.steps.push({ step: `${what}: try ${i + 1} failed: ${e.message.split('\n')[0].slice(0, 80)}` }); }
      }
      return false;
    };
    trial.attempting = true; trial.attemptAt = Date.now();
    try {
      if (await I.A.homeMode()) { await I.A.clickPet(); await sleep(500); }
      let h = await I.A.openHome({ timeout: 20e3 }).catch(e => ({ error: e.message.split('\n')[0] }));
      if (h.error) { R.clicks++; R.steps.push({ step: 'click Net', error: h.error }); await sleep(1000); if (await I.A.homeMode()) h = { ms: null, mode: await I.A.homeMode() }; else h = await I.A.openHome({ timeout: 30e3 }); }
      R.clicks++; R.steps.push({ step: 'click Net', homeMs: h.ms, mode: h.mode });
      shoot(trial, 'A', 'attempt-home'); await sleep(400);
      const rows = await W.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, sig: ['needs', 'stuck', 'ready', 'running'].find(c => r.classList.contains(c)) || null,
        label: r.querySelector('.nm small')?.textContent || '', ask: (r.querySelector('.na')?.textContent || '').slice(0, 80) || null, actions: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) })));
      const row = rows.find(r => r.id === trial.sid) || null;
      R.row = row; R.rowsShown = rows.length; R.rowIndex = row ? rows.indexOf(row) : -1;
      if (!row) { R.result = 'no row for this session in Home'; return R; }
      const fl = fleetNow(m, { transcript: false });
      const host = fl.pid ? guiHost(fl.pid) : 'no pid';
      R.offered = row.actions.filter(x => x === 'approve' || x === 'reply');
      const action = row.actions.includes(K.want) ? K.want : row.actions.includes('approve') ? 'approve' : row.actions.includes('reply') ? 'reply' : null;
      R.action = action; R.wanted = K.want;
      if (!action) R.result = `no ${K.want === 'reply' ? 'Reply' : 'Approve'} on its row (actions: ${row.actions.join(' ') || 'none'})`;
      else if (host) R.result = `refused: its terminal is ${host}, a keystroke could land in a real window`;
      else {
        const tc = Date.now();
        if (action === 'approve') { if (!(await press(`${sel(row.id)} button[data-do=approve]`, 'Approve'))) throw new Error('could not click Approve'); R.clicks++; R.steps.push({ step: 'click Approve' }); }
        else {
          if (!(await press(`${sel(row.id)} button[data-do=reply]`, 'Reply'))) throw new Error('could not click Reply'); R.clicks++; R.steps.push({ step: 'click Reply' });
          const form = await W.waitForSelector(`${sel(row.id)} form.nrep input`, { timeout: 3000 }).then(() => true).catch(() => false);
          R.steps.push({ step: 'reply form', open: form });
          if (form) { const text = K.answer || 'yes'; await W.locator(`${sel(row.id)} form.nrep input`).pressSequentially(text, { delay: 30 }); R.keys += text.length; await W.locator(`${sel(row.id)} form.nrep input`).press('Enter'); R.keys++; R.steps.push({ step: `typed "${text}" + Enter` }); }
        }
        const c = await waitCall(tc, 'ipc:send-to', 15000);
        R.sendTo = c ? { result: c.result, ms: c.ms } : null;
        await sleep(700); R.note = await lastNote(); shoot(trial, 'A', `attempt-${action}`);
      }
      // did it land? the fleet session itself is the judge
      await sleep(3000);
      const after = fleetNow(m);
      const pend = trial.block?.pendingId;
      R.fleetAfter = { status: after.status, waitingFor: after.waitingFor, dialog: after.dialog, select: after.select, toolResult: pend ? toolResultFor(after._recs, pend) : null,
        subToolResult: trial.block?.subPendingId ? (() => { for (const s of L.subagentFiles(m, after.sid)) { const r = toolResultFor(L.readJsonl(s), trial.block.subPendingId); if (r) return r; } return null; })() : null,
        newUserPrompt: userTextAfter(after._recs, trial.attemptAt) };
      R.resolved = K.block === 'waiting' ? !!(R.fleetAfter.toolResult || R.fleetAfter.subToolResult) || (trial.block?.regStatus === 'waiting' && after.status !== 'waiting' && !after.dialog && !after.select) : R.fleetAfter.newUserPrompt;
      // the row's other route: a click on its body = jump to its terminal
      if (!R.resolved) {
        const tj = Date.now();
        await press(`${sel(row.id)} .nm`, 'row (jump)'); R.clicks++;
        const j = await waitCall(tj, 'ipc:jump', 8000), clip = (await calls()).filter(x => x.at >= tj && x.kind === 'clipboard').length;
        R.jump = j ? { result: j.result, ms: j.ms, clipboardWrites: clip } : null;
        await sleep(600); shoot(trial, 'A', 'attempt-jump');
      }
      if (trial.kind === 'done') {   // reading what it said without leaving the pet: ▶ opens Theater on this session
        const rr = await W.evaluate(id => !!document.querySelector(`#now .nr[data-id="${id}"] button[data-do=replay]`), row.id).catch(() => false);
        if (rr) {
          if (!(await I.A.homeMode())) await I.A.openHome().catch(() => {});
          const opened = I.A.app.waitForEvent('window', { timeout: 15e3, predicate: p => /theater\/player\.html$/.test(p.url()) });
          await W.locator(`${sel(row.id)} button[data-do=replay]`).click().catch(() => {});
          const th = await opened.catch(() => null);
          R.theater = { opened: !!th };
          if (th) { await th.waitForLoadState('load').catch(() => {}); const st = await th.waitForFunction(() => { const n = document.querySelectorAll('#beats .b').length; return n > 0 ? { beats: n } : null; }, null, { timeout: 10e3 }).then(x => x.jsonValue()).catch(() => null);
            R.theater.beats = st?.beats || 0; await sleep(2600); try { await I.A.shot(path.join(out, 'shots', `${trial.kind}-${trial.n}`, 'theater.png'), { page: th }); } catch {} await th.close().catch(() => {}); }
        }
      }
      return R;
    } catch (e) { R.error = e.message.split('\n')[0]; return R; }
    finally {
      try { if (await I.A.homeMode()) await I.A.clickPet(); await I.A.win.mouse.move(4, 4); } catch {}
      await sleep(600); trial.attempting = false;
    }
  }

  // ---------------- per-kind fleet steps
  const settingsLocal = path.join(L.FLEET, 'ember', '.claude', 'settings.local.json');
  const PREP = {};
  async function escIfWaiting(m, why) {
    const f = fleetNow(m, { transcript: false });
    if (f.status !== 'waiting') return false;
    L.sendKeys(m.target, 'Escape'); log(`  ${m.name}: Esc (${why})`);
    for (let i = 0; i < 40; i++) { await sleep(250); const g = fleetNow(m, { transcript: false, pane: false }); if (g.status === 'idle') return true; }
    return true;
  }
  async function waitIdle(m, secs) { for (let i = 0; i < secs * 4; i++) { const f = fleetNow(m, { transcript: false, pane: false }); if (f.status === 'idle') return true; await sleep(250); } return false; }
  async function guard(what, need) {
    const s = spent();
    if (s + need > budget) throw new Error(`budget: ${what} would take this probe past $${budget} (spent ~$${s.toFixed(4)} est., needs ~$${need})`);
    L.assertBudget(what);
  }
  // returns the trigger time; the block is then looked for in the fleet
  async function trigger(trial, m, K) {
    if (trial.kind === 'approval' || trial.kind === 'askuser') {
      await escIfWaiting(m, 'clear the previous dialog first'); await waitIdle(m, 20);
      if (trial.kind === 'approval') { const f = path.join(m.cwd, '.claude', 'settings.local.json'); try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); const al = j.permissions?.allow || []; if (al.some(r => /deploy\.sh/.test(r))) throw new Error('kestrel has a remembered deploy.sh approval: run fleet.js rearm kestrel'); } catch (e) { if (/remembered/.test(e.message)) throw e; } }
      await sleep(3000);
      await guard(`prompt ${m.name}`, 0.02);
      trial.trigger = Date.now(); await L.sendLine(m.target, m.rearmPrompt); return trial.trigger;
    }
    if (trial.kind === 'question' || trial.kind === 'done') {
      await waitIdle(m, 60); await sleep(2000);
      await guard(`prompt ${m.name}`, 0.02);
      trial.trigger = Date.now(); await L.sendLine(m.target, trial.kind === 'question' ? QPROMPT : m.rearmPrompt); return trial.trigger;
    }
    if (trial.kind === 'loop') {
      if (!PREP.loop) {   // ember's own 5-minute loop, unchanged, but ./tick.sh now asks first: every fire stalls on an approval
        let prev = null; try { prev = fs.readFileSync(settingsLocal, 'utf8'); } catch {}
        if (prev === LOOP_ASK) prev = null;   // written by hand for a resumed run: still ours to remove
        PREP.loop = { prev };
        fs.mkdirSync(path.dirname(settingsLocal), { recursive: true });
        fs.writeFileSync(settingsLocal, LOOP_ASK);
        log('  ember: ask rule for ./tick.sh written to .claude/settings.local.json (restored after the loop trials)');
        await guard('resume ember', 0.04);
        trial.trigger = Date.now();
        if (!L.claudePidOf(m.target)) { const r = await runFleet(['up', 'ember', '--no-prompt']); log(`  ember: fleet.js up --no-prompt → exit ${r.code}\n${r.out.split('\n').map(l => '    ' + l).join('\n')}`);
          // up gives up when the caught-up fire is already waiting on its approval: the root still needs the new pid's registry
          if (r.code) { const r2 = await runFleet(['root']); log(`  ember: fleet.js root → exit ${r2.code}`); } }
        return trial.trigger;
      }
      await escIfWaiting(m, 'clear the previous stalled fire');
      await guard('next ember fire', 0.02);
      return (trial.trigger = Date.now());   // the trigger is ember's own next fire (~285 s after the last one)
    }
    if (trial.kind === 'subagent') {
      if (!PREP.subagent) { PREP.subagent = true; if (!L.claudePidOf(m.target)) { await guard('resume delta', 0.03); const r = await runFleet(['up', 'delta', '--no-prompt']); log(`  delta: fleet.js up --no-prompt → exit ${r.code}\n${r.out.split('\n').map(l => '    ' + l).join('\n')}`); } }
      await escIfWaiting(m, 'clear the previous dialog first');
      if (!(await waitIdle(m, 240))) log('  delta: still busy after 240 s');
      await sleep(3000);
      await guard(`prompt ${m.name}`, 0.06);
      trial.trigger = Date.now(); await L.sendLine(m.target, SUBPROMPT); return trial.trigger;
    }
    throw new Error(`no trigger for ${trial.kind}`);
  }
  // the block: when did the session start needing you, by the registry and by the transcript
  async function findBlock(trial, m, K, maxSec) {
    const end = Date.now() + maxSec * 1000;
    while (Date.now() < end) {
      const f = fleetNow(m, { transcript: trial.kind === 'subagent', pane: trial.kind === 'subagent' });
      if (trial.kind === 'loop' && f.status === 'busy' && f.statusAt > trial.trigger && !trial.fireAt) {
        trial.fireAt = f.statusAt; trial.waitedForFireS = r1(f.statusAt - trial.trigger);
        trial.trigger = f.statusAt; trial.first = {}; trial.ledChangedAt = trial.faceChangedAt = 0;   // only what this fire causes
      }
      if (trial.kind === 'subagent' && f.status !== 'waiting' && f.dialog && (f.subs || []).some(s => s.pending.length && s.mtime > trial.trigger)) return blockFrom(trial, m, K, { ...f, statusAt: null, status: f.status + '+dialog' });
      if (f.statusAt && f.statusAt > trial.trigger - 500) {
        if (K.block === 'waiting' && f.status === 'waiting') return blockFrom(trial, m, K, f);
        if ((K.block === 'question' || K.block === 'statement') && f.status === 'idle') return blockFrom(trial, m, K, f);
      }
      await sleep(trial.kind === 'subagent' ? 600 : 250);
    }
    return null;
  }
  async function blockFrom(trial, m, K, f0) {
    await sleep(1500);   // the record lands right after the flip (or is withheld while a dialog is up)
    const f = fleetNow(m), b = { regStatus: f0.status, waitingFor: f0.waitingFor, regAt: f0.statusAt, pid: f.pid, sid: f.sid };
    const pend = f.tail?.pending?.[f.tail.pending.length - 1];
    if (trial.kind === 'subagent') {
      const sp = (f.subs || []).filter(s => s.pending.length).sort((x, y) => (y.mtime || 0) - (x.mtime || 0))[0];
      if (sp) { const p = sp.pending[sp.pending.length - 1]; Object.assign(b, { subFile: sp.file, subPendingId: p.id, subPendingTool: p.name, recordAt: Date.parse(p.ts) || null }); }
      b.mainTail = f.tail?.kind; b.subagents = (f.subs || []).length;
    } else if (K.block === 'waiting') {
      if (pend) Object.assign(b, { pendingId: pend.id, pendingTool: pend.name, recordAt: Date.parse(pend.ts) || null });
      else b.withheld = true;   // Claude Code holds the tool_use record back while the dialog is up (fleet-states.md)
    } else {
      const recs = f._recs || [], last = [...recs].reverse().find(r => r.type === 'assistant' && r.message && r.message.stop_reason === 'end_turn');
      Object.assign(b, { recordAt: last ? Date.parse(last.timestamp) : null, endsWithQ: f.tail?.endsWithQ, tailKind: f.tail?.kind });
    }
    b.dialog = f.dialog; b.select = f.select;
    return b;
  }
  async function teardown(trial, m, K, isLast) {
    const T = { };
    if (trial.kind === 'approval' && trial.n === 2) {
      // control: approve in the terminal (what Approve should have done) — proves the check below sees a real approval
      const f = fleetNow(m, { transcript: false });
      if (f.status === 'waiting' && f.dialog) {
        await guard('control approval on kestrel', 0.01);
        const t = Date.now(); L.sendKeys(m.target, 'Enter'); T.control = 'Enter on "1. Yes" in its tmux pane';
        await sleep(4000); await waitIdle(m, 60);
        const g = fleetNow(m); T.controlResult = { status: g.status, toolResult: trial.block?.pendingId ? toolResultFor(g._recs, trial.block.pendingId) : null, ms: Date.now() - t };
        if (!T.controlResult.toolResult) { const tu = g.tail?.toolUses; T.controlResult.note = 'withheld id: matched by the newest Bash tool_result'; const last = [...(g._recs || [])].reverse().find(r => r.type === 'user' && L.contentOf(r).some(c => c.type === 'tool_result')); if (last) T.controlResult.toolResult = { at: last.timestamp, isError: L.contentOf(last).some(c => c.is_error) }; }
        return T;
      }
    }
    if (trial.kind === 'loop' && !flag('--loop-esc')) {
      // approve in the terminal (./tick.sh only appends the time to loop.log): a fire whose call was rejected teaches the
      // session to stop calling it (seen: the fire after two rejections ended with text, no tool call, so it never stalled)
      const f = fleetNow(m, { transcript: false });
      if (f.status === 'waiting' && f.dialog) { L.sendKeys(m.target, 'Enter'); T.approvedInTerminal = true; await sleep(1500); T.idle = await waitIdle(m, 60); }
      return T;
    }
    if (K.block === 'waiting') {
      T.esc = await escIfWaiting(m, 'end of trial');
      if (trial.kind === 'subagent') { T.idle = await waitIdle(m, 120); }
    }
    return T;
  }

  // ---------------- a quiet fleet: the standing fixture dialogs (kestrel, beacon) would hold the shared LED red
  for (const n of String(arg('--quiet', '')).split(',').filter(Boolean)) { const m = member(n); if (await escIfWaiting(m, 'quiet the fleet before the trials')) await waitIdle(m, 20); }
  if (arg('--quiet')) await sleep(6000);

  // ---------------- trials
  const rawF = path.join(out, 'trials.jsonl');
  let stopReason = null;
  try {
    for (const p of plan) {
      const K = KINDS[p.kind], m = member(K.member);
      const isLast = !plan.slice(plan.indexOf(p) + 1).some(x => x.kind === p.kind);
      const f0 = fleetNow(m, { transcript: false });
      const trial = { kind: p.kind, label: K.label, n: p.n, member: m.name, name: m.name, sid: f0.sid, pid: f0.pid, trigger: Infinity, bub: { A: { key: '', start: 0 }, B: { key: '', start: 0 } }, first: {}, phases: [], timeline: [], shots: [], app: git };
      log(`== ${p.kind} #${p.n} (${m.name}) · status ${f0.status}${f0.waitingFor ? '/' + f0.waitingFor : ''}`);
      try { trial.spendBefore = spendNow(); } catch {}
      try {
        // baseline counters before the trigger
        const [a0, ma0] = await Promise.all([I.A.win.evaluate(PROBE), I.A.evalMain(MAINPROBE)]);
        trial.notes0 = ma0.notes; trial.sounds0 = a0.sounds; trial.ledVal = a0.led; trial.faceVal = a0.face; trial.ledChangedAt = trial.faceChangedAt = 0; trial.baseline = { led: a0.led, face: a0.face, agents: a0.agents.map(x => `${x.name}:${x.phase}`) };
        active = trial;
        trial.trigger = await trigger(trial, m, K);
        trial.triggerAt = iso(trial.trigger);
        const b = await findBlock(trial, m, K, trial.kind === 'loop' ? 600 : trial.kind === 'subagent' ? 120 : 90);
        if (!b) { trial.block = null; trial.error = 'the session never reached the blocked state'; log('  no block: ' + JSON.stringify(strip(fleetNow(m, { transcript: true })).tail)); }
        else {
          trial.block = b; trial.sid = b.sid || trial.sid; trial.pid = b.pid || trial.pid;
          trial.t0reg = b.regAt || null; trial.t0rec = b.recordAt || null; { const ts = [b.regAt, b.recordAt].filter(Boolean); trial.t0 = ts.length ? Math.min(...ts) : trial.trigger; }
          log(`  block: reg ${b.regStatus}${b.waitingFor ? '/' + b.waitingFor : ''} at +${r1(b.regAt - trial.trigger)} s · record ${b.recordAt ? '+' + r1(b.recordAt - trial.trigger) + ' s' : b.withheld ? 'withheld' : '-'}${b.subPendingTool ? ' (subagent ' + b.subPendingTool + ')' : ''}${b.pendingTool ? ' ' + b.pendingTool : ''}${K.block === 'question' ? ' endsWithQ ' + b.endsWithQ : ''}`);
          if (K.block === 'question' && !b.endsWithQ) trial.invalid = 'the turn did not end with a question';
          if (K.block === 'statement' && b.endsWithQ) trial.invalid = 'the turn ended with a question, not a statement';
          // observe until the pet has both signalled and offered its action (+3 s), or the window ends
          const until = trial.t0 + K.windowSec * 1000;
          let settleFrom = null;
          while (Date.now() < until) {
            const F = trial.first, signalled = F.bubbleA || F.ledA || F.faceA, offered = F.offerA || F.offerB;
            const enough = K.block === 'statement' ? signalled && F.rowB : signalled && offered && F.rowB;
            if (enough && !settleFrom) settleFrom = Date.now();
            if (settleFrom && Date.now() - settleFrom > 3000) break;
            const f = fleetNow(m, { transcript: false, pane: false });
            if (K.block === 'waiting' && b.regStatus === 'waiting' && f.status !== 'waiting') { trial.leftBlockAt = Date.now(); trial.leftBlockTo = f.status; log(`  the session left its block on its own (${f.status})`); break; }
            await sleep(500);
          }
          trial.windowEnd = Date.now();
          trial.attempt = await attempt(trial, m, K);
          log(`  attempt: ${JSON.stringify({ clicks: trial.attempt.clicks, keys: trial.attempt.keys, action: trial.attempt.action, sendTo: trial.attempt.sendTo?.result, result: trial.attempt.result, resolved: trial.attempt.resolved, jump: trial.attempt.jump?.result?.ok })}`);
        }
        trial.teardown = await teardown(trial, m, K, isLast);
      } catch (e) { trial.error = e.message.split('\n')[0]; log(`  ERROR ${trial.error}`); if (/^budget:/.test(trial.error)) stopReason = trial.error; }
      active = null; await sleep(300);
      while (shotBusy || shotQ.length) await sleep(200);
      try { trial.spendAfter = spendNow(); trial.spentUsdEst = +(trial.spendAfter.est - trial.spendBefore.est).toFixed(4); } catch {}
      const F = trial.first, rel = x => x && trial.t0 ? r1(x.t - trial.t0) : null, relReg = x => x && trial.t0reg ? r1(x.t - trial.t0reg) : null;
      if (F.bubbleA && F.bubbleA.start) F.bubbleA = { ...F.bubbleA, judgedAt: F.bubbleA.t, t: F.bubbleA.start };   // seen from its first letters
      trial.preT0 = {};   // a "first" signal from before the block began belongs to something else (the previous teardown): dropped
      if (trial.t0) for (const [k, v] of Object.entries(F)) if (v && v.t < trial.t0 - 300) { trial.preT0[k] = { ...v, s: r1(v.t - trial.t0) }; delete F[k]; }
      trial.result = {
        t0: trial.t0 ? iso(trial.t0) : null, t0From: trial.t0 ? (trial.t0 === trial.t0rec ? 'transcript' : 'registry') : null,
        detectAmbientS: rel([F.bubbleA, F.ledA, F.faceA].filter(Boolean).sort((a, b) => a.t - b.t)[0]),
        detectAmbientRegS: relReg([F.bubbleA, F.ledA, F.faceA].filter(Boolean).sort((a, b) => a.t - b.t)[0]),
        bubbleS: rel(F.bubbleA), ledS: rel(F.ledA), faceS: rel(F.faceA), rowS: rel(F.rowB), rowRegS: relReg(F.rowB), offerS: rel(F.offerA || F.offerB), offerAction: F.offerA?.action || F.offerB?.actions?.join('+') || null,
        bannerS: rel(F.bannerA), soundS: rel(F.soundA), goneS: rel(F.goneA), phaseS: rel(F.phaseA), queueHeadS: rel(F.queueHeadA),
        wrong: F.wrongA ? { s: rel(F.wrongA), phase: F.wrongA.phase } : null, otherBubble: F.otherBubbleA ? { s: rel(F.otherBubbleA), text: F.otherBubbleA.text } : null,
        actionWorks: trial.attempt ? !!trial.attempt.resolved : null, clicks: trial.attempt?.clicks ?? null, keys: trial.attempt?.keys ?? null,
      };
      trial.phases = trial.phases.map(s => ({ phase: s.phase, from: trial.t0 ? r1(s.from - trial.t0) : null, to: trial.t0 ? r1(s.to - trial.t0) : null }));
      delete trial.lastSig; delete trial.attempting;
      fs.appendFileSync(rawF, JSON.stringify(trial) + '\n');
      log(`  result ${JSON.stringify(trial.result)} · spent ~$${trial.spentUsdEst}`);
      if (stopReason) break;
    }
  } finally {
    stopPoll = true; await poller.catch(() => {});
    if (PREP.loop) {   // ember back to how it was: its own rule set, claude exited (fleet.js pause)
      const m = member('ember');
      await escIfWaiting(m, 'end of loop trials').catch(() => {});
      try { if (PREP.loop.prev == null) fs.rmSync(settingsLocal, { force: true }); else fs.writeFileSync(settingsLocal, PREP.loop.prev); log('  ember: settings.local.json restored'); } catch (e) { log('  ember: restore failed ' + e.message); }
      const r = await runFleet(['pause', 'ember']); log(`  ember: fleet.js pause → exit ${r.code}`);
    }
    if (PREP.subagent) { const r = await runFleet(['pause', 'delta']); log(`  delta: fleet.js pause → exit ${r.code}`); }
    const closed = await Promise.all([I.A.close(), I.B.close()]);
    const sp1 = spendNow(`tta-before: invocation end (${plan.map(p => p.kind + p.n).join(' ')})`);
    log(`closed ${closed.map(c => `${c.how}/${c.orphans.length} orphans`).join(', ')} · B reopened ${reopenB}× · poll errors ${pollErrors} · spend est $${sp1.est.toFixed(4)} · this probe $${(sp1.est - B.startEst).toFixed(4)} of $${budget}${stopReason ? ' · STOPPED: ' + stopReason : ''}`);
  }
}

// ---------------------------------------------------------------- report: medians per kind
// A signal that never came within the trial's window is censored there (it came later, or never): a median that lands on
// one is reported as null with `notWithinWindow`, never as a number.
function report(dir) {
  const trials = fs.readFileSync(path.join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const med = xs => { const v = xs.map(x => x == null ? Infinity : x).sort((a, b) => a - b); if (!v.length) return null; const h = v.length >> 1, m = v.length % 2 ? v[h] : (v[h - 1] + v[h]) / 2; return Number.isFinite(m) ? Math.round(m * 10) / 10 : null; };
  const medSeen = xs => med(xs.filter(x => x != null));
  for (const t of trials) if (t.result) for (const [k, v] of Object.entries(t.result)) if (typeof v === 'number' && /S$/.test(k) && v < -0.3) { (t.preT0 ||= {})[k] = v; t.result[k] = null; }
  const by = {};
  for (const t of trials) (by[t.kind] ||= []).push(t);
  const kinds = {};
  for (const [k, ts] of Object.entries(by)) {
    const ok = ts.filter(t => !t.error && !t.invalid && t.block), R = t => t.result || {};
    const act = t => t.attempt || {};
    const actionClicks = t => { const a = act(t); return a.clicks == null ? null : a.clicks - (a.jump ? 1 : 0); };   // the jump fallback is reported apart
    const detect = ok.map(t => R(t).detectAmbientS), row = ok.map(t => R(t).rowS), offer = ok.map(t => R(t).offerS);
    kinds[k] = {
      label: KINDS[k]?.label, member: KINDS[k]?.member, trials: ts.length, valid: ok.length, windowSec: KINDS[k]?.windowSec,
      excluded: ts.filter(t => !ok.includes(t)).map(t => ({ n: t.n, why: t.error || t.invalid || 'no block' })),
      transcriptWithheld: ok.filter(t => t.block.withheld).length,
      detected: detect.filter(x => x != null).length,
      detectS: detect, detectMedianS: med(detect), detectMedianSeenS: medSeen(detect), detectNotWithinWindow: med(detect) == null && detect.length > 0,
      detectRegS: ok.map(t => R(t).detectAmbientRegS),
      bubbleS: ok.map(t => R(t).bubbleS), bubbleText: [...new Set(ok.map(t => t.first?.bubbleA?.text).filter(Boolean))], ledS: ok.map(t => R(t).ledS), bannerS: ok.map(t => R(t).bannerS),
      rowS: row, rowMedianS: med(row), rowSig: [...new Set(ok.map(t => t.first?.rowB?.sig).filter(Boolean))], rowLabel: [...new Set(ok.map(t => t.first?.rowB?.label).filter(Boolean))],
      offerS: offer, offerMedianS: med(offer), offerAction: [...new Set(ok.map(t => R(t).offerAction).filter(Boolean))],
      actionWorks: ok.map(t => R(t).actionWorks), works: ok.filter(t => R(t).actionWorks).length,
      actionableMedianS: med(ok.map(t => R(t).actionWorks ? R(t).offerS : null)),
      actionClicks: ok.map(actionClicks), keys: ok.map(t => act(t).keys ?? null),
      attempts: ok.map(t => ({ n: t.n, action: act(t).action || null, result: act(t).sendTo ? act(t).sendTo.result : act(t).result || act(t).error || null, note: act(t).note || null,
        sessionAfter: act(t).fleetAfter ? { status: act(t).fleetAfter.status, waitingFor: act(t).fleetAfter.waitingFor, toolResult: !!act(t).fleetAfter.toolResult, newUserPrompt: act(t).fleetAfter.newUserPrompt } : null,
        jump: act(t).jump ? act(t).jump.result : null, theater: act(t).theater || null })),
      wrong: ok.map(t => R(t).wrong).filter(Boolean), goneS: ok.map(t => R(t).goneS),
      spentUsdEst: +ts.reduce((s, t) => s + (t.spentUsdEst || 0), 0).toFixed(4),
    };
  }
  return { dir, trials: trials.length, kinds };
}

if (require.main === module && flag('--report')) {
  const dir = path.resolve(arg('--report')), r = report(dir);
  if (flag('--full')) {   // the raw trials and each invocation's setup ride along: one self-contained file
    r.meta = fs.readdirSync(dir).filter(f => /^meta-\d+\.json$/.test(f)).sort().map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    try { r.budget = JSON.parse(fs.readFileSync(path.join(dir, 'budget.json'), 'utf8')); } catch {}
    r.trialsRaw = fs.readFileSync(path.join(dir, 'trials.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  if (arg('--json')) fs.writeFileSync(path.resolve(arg('--json')), JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
} else if (require.main === module) {
  if (!arg('--out') || (!arg('--plan') && !flag('--smoke'))) { console.error('usage: node test/ultra/tta.js --app <worktree> --out <dir> --plan approval:3,askuser:3[,...] [--interleave] [--budget 0.60] [--poll 250]'); process.exit(2); }
  run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { KINDS, report };
