#!/usr/bin/env node
// live-rows observe — $0 to this task and read-only: while another task holds ember's lease and runs its /loop (a fire every
// ~285 s: registry idle → busy → idle, records written), two instances watch the isolated fleet root with Home open, the
// fix (A) and the base it branched from (B). Each renderer timestamps its own row changes (a MutationObserver on #now: no
// poll resolution); the harness reads the members' registry files every 50 ms. Delay = row change − Claude Code's own
// statusUpdatedAt for that flip.
//   node observe.js --fix <checkout> --base <checkout> --out <dir> [--fires 2] [--max 720] [--members ember]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out')), HOME = os.userInfo().homedir, ROOT = path.join(HOME, '.vibepet-ultra', 'root', '.claude');
const HARNESS = '/Users/christopherharris/.vibepet-ultra/wt/r1-live-rows';
const { launch } = require(path.join(HARNESS, 'test/ultra/launch'));
const { SEED, fleetTruth } = require(path.join(HARNESS, 'test/ultra/canon'));
const FL = require(path.join(HARNESS, 'test/fleet/lib'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, 'load ');
const med = xs => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = `[${new Date().toISOString().slice(11, 23)}] ${a.join(' ')}`; console.log(l); fs.appendFileSync(path.join(OUT, 'observe.log'), l + '\n'); };

const OBS = () => {   // in the renderer: every change of a row's signal, stamped when the DOM changed
  if (window.__obs) return;
  const O = window.__obs = { changes: [], last: new Map() };
  const look = () => {
    for (const r of document.querySelectorAll('#now .nr[data-id]')) {
      const sig = ['needs', 'stuck', 'ready', 'running', 'exited'].find(c => r.classList.contains(c)) || null;
      const k = sig + '|' + [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do).filter(d => d === 'approve' || d === 'reply').join('+');
      if (O.last.get(r.dataset.id) !== k) { O.last.set(r.dataset.id, k); O.changes.push({ t: Date.now(), id: r.dataset.id, sig, acts: k.split('|')[1], label: r.querySelector('.nm small')?.textContent || '' }); }
    }
  };
  new MutationObserver(look).observe(document.getElementById('now'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  look();
};

(async () => {
  const fix = path.resolve(arg('--fix')), base = path.resolve(arg('--base')), fires = +arg('--fires', 2), maxS = +arg('--max', 720);
  const names = String(arg('--members', 'ember')).split(',');
  const truth = fleetTruth(path.join(HARNESS, 'test/fleet/fleet.js'));
  const mem = (truth.members || []).filter(m => names.includes(m.name) && m.pid);
  if (!mem.length) throw new Error(`none of ${names} is running`);
  const R = { at: new Date().toISOString(), fix, base, members: mem.map(m => ({ name: m.name, pid: m.pid, sessionId: m.sessionId })), uptime: [uptime()], flips: [], rows: {} };
  const [A, B] = await Promise.all([
    launch({ appDir: fix, root: ROOT, userData: path.join(HOME, '.vibepet-ultra/userdata/r1-live-rows-obsA'), state: SEED, env: { ANTHROPIC_API_KEY: '' } }),
    launch({ appDir: base, root: ROOT, userData: path.join(HOME, '.vibepet-ultra/userdata/r1-live-rows-obsB'), state: SEED, env: { ANTHROPIC_API_KEY: '' } })]);
  try {
    for (const v of [A, B]) { await v.openHome(); await v.win.evaluate(OBS); }
    log(`A (fix) pid ${A.pid}, B (base) pid ${B.pid} · watching ${mem.map(m => m.name).join(', ')} · ${uptime()}`);
    const last = new Map(), t0 = Date.now();
    let busyFlips = 0, doneAt = null;
    while (Date.now() - t0 < maxS * 1000) {
      for (const m of mem) {
        const r = FL.readRegistry(m.pid);
        const k = r ? `${r.status}|${r.statusUpdatedAt}` : 'gone';
        if (last.get(m.name) !== k) {
          if (last.has(m.name)) { R.flips.push({ member: m.name, sessionId: m.sessionId, status: r?.status || null, waitingFor: r?.waitingFor || null, statusUpdatedAt: r?.statusUpdatedAt || null, seenAt: Date.now(), uptime: uptime() }); log(`${m.name}: ${k}`); if (r?.status === 'busy') busyFlips++; }
          last.set(m.name, k);
        }
      }
      if (busyFlips >= fires && !doneAt) doneAt = Date.now();
      if (doneAt && Date.now() - doneAt > 25000) break;   // the fire's idle flip, then a margin
      if (!(await A.homeMode()) && !(await A.openHome().catch(() => null))) log('A: Home closed, reopened');
      if (!(await B.homeMode()) && !(await B.openHome().catch(() => null))) log('B: Home closed, reopened');
      await sleep(50);
    }
    R.rows.A = await A.win.evaluate(() => window.__obs.changes);
    R.rows.B = await B.win.evaluate(() => window.__obs.changes);
    // per flip, per instance: the first row change of that member to what the flip means, after the flip
    const want = f => f.status === 'busy' ? ['running'] : f.status === 'waiting' ? ['needs', 'stuck'] : f.status === 'idle' ? ['ready'] : [];
    R.delays = R.flips.filter(f => f.statusUpdatedAt).map(f => {
      const d = { member: f.member, status: f.status, statusUpdatedAt: f.statusUpdatedAt, uptime: f.uptime };
      for (const [k, rows] of Object.entries(R.rows)) {
        const next = R.flips.find(g => g.member === f.member && g.statusUpdatedAt > f.statusUpdatedAt);
        const c = rows.find(c => c.id === f.sessionId && want(f).includes(c.sig) && c.t >= f.statusUpdatedAt - 50 && (!next || c.t < next.statusUpdatedAt + 3500));
        d[k] = c ? { ms: c.t - f.statusUpdatedAt, sig: c.sig, label: c.label } : null;
      }
      return d;
    });
    R.median = { A: med(R.delays.map(d => d.A?.ms)), B: med(R.delays.map(d => d.B?.ms)) };
    R.uptime.push(uptime());
    for (const d of R.delays) log(`${d.member} → ${d.status}: fix ${d.A ? d.A.ms + ' ms' : 'not seen'} · base ${d.B ? d.B.ms + ' ms' : 'not seen'} · ${d.uptime}`);
    log(`median delay: fix ${R.median.A} ms · base ${R.median.B} ms (n=${R.delays.length})`);
    await A.shot(path.join(OUT, 'observe-A-end.png')).catch(() => {});
  } finally {
    const c = await Promise.all([A.close(), B.close()]);
    R.close = c.map(x => ({ how: x.how, orphans: x.orphans.length }));
    fs.writeFileSync(path.join(OUT, 'observe.json'), JSON.stringify(R, null, 2));
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
