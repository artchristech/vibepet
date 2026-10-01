#!/usr/bin/env node
// test/ultra/watch.js — what vibepet shows for each fleet session vs. what the session is really doing, over time.
// Launches the real app (isolated, like canon.js), opens the Net Home panel with a real click and keeps it open, then
// every --every seconds records, on one clock:
//   truth  per live fleet session: Claude Code's registry (root/sessions/<pid>.json → status, waitingFor), the fleet
//          member it belongs to, and how many tool processes (build.sh / slow.sh / deploy.sh …) run under its pid
//   ui     per Home row: its signal (needs / stuck / ready / running) and label, plus the snapshot's phase and fan-out
// and writes timeline.jsonl + summary.json (per member: the segments of (truth, ui), and how long each truth change took
// to show). Rows of sessions that are not live fleet sessions are kept as `extra`.
//
//   node test/ultra/watch.js [--app <worktree>] --out <dir> [--secs 300] [--every 2] [--userdata <dir>] [--root DIR]
//
// Read-only on the fleet: it never types into, signals or prompts a session. Drive the fleet from another shell
// (test/fleet/fleet.js rearm …) while this runs. Only numbers, enums and fleet-session labels are recorded.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SEED, instrument } = require('./canon');

const ULTRA = path.join(os.userInfo().homedir, '.vibepet-ultra');
const HERE = path.resolve(__dirname, '..', '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const TOOL_RE = /\b(build|slow|deploy|tick)\.sh\b/;

// the fleet's truth, straight from Claude Code's registry files linked into the isolated root (fleet pids only)
function truth(root) {
  const sdir = path.join(root, 'sessions'), out = [];
  let names = []; try { names = fs.readdirSync(sdir).filter(n => /^\d+\.json$/.test(n)); } catch {}
  let fstate = {}; try { fstate = JSON.parse(fs.readFileSync(path.join(ULTRA, 'fleet', '.fleet-state.json'), 'utf8')).members || {}; } catch {}
  const byPid = new Map(Object.entries(fstate).map(([n, m]) => [m.pid, n]));
  let ps = []; try { ps = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], cmd: m[3] })); } catch {}
  const kids = new Map(); for (const p of ps) { if (!kids.has(p.ppid)) kids.set(p.ppid, []); kids.get(p.ppid).push(p); }
  for (const n of names) {
    let r; try { r = JSON.parse(fs.readFileSync(path.join(sdir, n), 'utf8')); } catch { continue; }
    const pid = +n.slice(0, -5);
    if (!ps.some(p => p.pid === pid)) continue;   // a stale link: that claude has exited
    let tools = 0; const q = [...(kids.get(pid) || [])];   // descendants of a FLEET claude only: their command lines are fleet scripts
    while (q.length) { const p = q.shift(); if (TOOL_RE.test(p.cmd)) tools++; q.push(...(kids.get(p.pid) || [])); }
    const member = byPid.get(pid) || (r.cwd ? path.basename(r.cwd) : null);
    out.push({ member, pid, sessionId: r.sessionId, status: r.status || null, waitingFor: r.waitingFor || null, statusAt: r.statusUpdatedAt || null, tools });
  }
  return out;
}
const truthClass = t => !t ? 'gone' : t.status === 'waiting' ? (/permission/.test(t.waitingFor || '') ? 'approval' : /input/.test(t.waitingFor || '') ? 'question' : 'waiting') : t.status === 'busy' ? (t.tools ? 'busy+tool' : 'busy') : t.status || '?';
const uiClass = u => !u ? 'hidden' : u.sig || u.phase || '?';

async function main() {
  const out = path.resolve(arg('--out', path.join(ULTRA, 'shots', `watch-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
  const appDir = path.resolve(arg('--app', HERE)), root = path.resolve(arg('--root', path.join(ULTRA, 'root', '.claude')));
  const secs = +arg('--secs', 300), every = +arg('--every', 2);
  fs.mkdirSync(out, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const { launch } = require('./launch');
  const v = await launch({ appDir, root, userData: arg('--userdata') ? path.resolve(arg('--userdata')) : undefined, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  await v.evalMain(instrument);   // a stray real click on this instance must not reach the clipboard, a dialog or a browser
  const T0 = Date.now(), lines = [], f = path.join(out, 'timeline.jsonl');
  fs.writeFileSync(f, '');
  let opens = 0;
  try {
    await v.openHome(); opens++;
    while (Date.now() - T0 < secs * 1000) {
      const t = Date.now();
      if (!(await v.homeMode())) { await v.openHome().catch(() => {}); opens++; }
      const [rows, snap] = await Promise.all([
        v.win.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, sig: ['needs', 'stuck', 'ready', 'running'].find(c => r.classList.contains(c)) || null, label: r.querySelector('.nm small')?.textContent || '', ask: (r.querySelector('.na')?.textContent || '').slice(0, 60) || null }))),
        v.evalMain(() => (globalThis.__vibepet.snapshot().agents || []).map(a => ({ id: a.id, name: a.name, phase: a.phase, since: a.since, fan: a.fanout ? [a.fanout.open, a.fanout.total, a.fanout.stuck] : null }))),
      ]);
      const tr = truth(root), sa = new Map(snap.map(a => [a.id, a]));
      const line = { t: t - T0, at: new Date(t).toISOString(), truth: tr, ui: rows.map(r => ({ ...r, name: sa.get(r.id)?.name || null, phase: sa.get(r.id)?.phase || null, fan: sa.get(r.id)?.fan || null })),
        hiddenPhases: snap.filter(a => !rows.some(r => r.id === a.id)).map(a => ({ id: a.id, name: a.name, phase: a.phase })) };
      lines.push(line); fs.appendFileSync(f, JSON.stringify(line) + '\n');
      await sleep(Math.max(0, every * 1000 - (Date.now() - t)));
    }
  } finally { var closed = await v.close(); }
  // per member: segments of (truth class, ui class), and how long each truth change took to show in Home
  const members = {};
  for (const L of lines) {
    const seen = new Set();
    for (const t of L.truth) {
      const u = L.ui.find(r => r.id === t.sessionId), k = t.member || t.sessionId.slice(0, 8);
      seen.add(t.sessionId);
      const m = members[k] ||= { segments: [], changes: [] }, cur = { truth: truthClass(t), ui: uiClass(u), label: u?.label || null, fan: u?.fan || null };
      const last = m.segments[m.segments.length - 1];
      if (!last || last.truth !== cur.truth || last.ui !== cur.ui) m.segments.push({ from: L.t, to: L.t, ...cur }); else { last.to = L.t; last.label = cur.label; last.fan = cur.fan; }
    }
    for (const u of L.ui) if (!seen.has(u.id)) { const k = `extra:${u.name || u.id.slice(0, 8)}`; const m = members[k] ||= { segments: [] }; const last = m.segments[m.segments.length - 1];
      if (!last || last.ui !== uiClass(u)) m.segments.push({ from: L.t, to: L.t, truth: 'not a live fleet session', ui: uiClass(u), label: u.label }); else last.to = L.t; }
  }
  // detection latency: a truth change at t1 → the first sample at or after it whose Home row says the matching thing
  const WANT = { approval: ['stuck', 'needs'], question: ['needs'], 'busy+tool': ['running'], busy: ['running'], idle: ['ready', 'hidden'] };
  for (const [k, m] of Object.entries(members)) {
    if (!m.changes) continue;
    let prev = null;
    for (let i = 0; i < m.segments.length; i++) {
      const s = m.segments[i];
      if (s.truth !== prev && prev !== null) {
        const want = WANT[s.truth], hit = want && m.segments.slice(i).find(x => x.truth === s.truth && want.includes(x.ui));
        m.changes.push({ at: s.from, to: s.truth, shownAs: want ? (hit ? hit.ui : null) : undefined, afterMs: hit ? hit.from - s.from : null });
      }
      prev = s.truth;
    }
  }
  const summary = { app: appDir, root, startedAt: new Date(T0).toISOString(), secs, every, samples: lines.length, homeOpens: opens, close: closed, members };
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  for (const [k, m] of Object.entries(members)) {
    console.log(k);
    for (const s of m.segments) console.log(`  ${(s.from / 1000).toFixed(0).padStart(4)}–${(s.to / 1000).toFixed(0).padEnd(4)}s  truth ${s.truth.padEnd(10)} ui ${s.ui.padEnd(8)} ${s.label || ''}${s.fan ? ` fan ${s.fan.join('/')}` : ''}`);
  }
  console.log(`${lines.length} samples → ${out}  (close ${closed.how}, orphans ${closed.orphans.length})`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { truth, truthClass };
