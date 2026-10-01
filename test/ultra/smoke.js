#!/usr/bin/env node
// test/ultra/smoke.js — prove the harness on the real app: N sequential runs (launch → Net drawn → a real click opens
// Home → screenshots → clean close, no orphan processes), one first-run profile (the Setup card), and two instances at
// once with different userData. Writes PNGs + smoke.json to --out; exits 1 if any check fails.
//
//   node test/ultra/smoke.js [--root DIR] [--out DIR] [--runs 3] [--no-parallel] [--no-first-run]
//
// --root defaults to ~/.vibepet-ultra/root-empty/.claude (created empty if missing); it must pass launch()'s privacy
// guard like any other root. --out defaults to ~/.vibepet-ultra/shots/smoke-<time>.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, ULTRA } = require('./launch');

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(k);
const root = path.resolve(arg('--root', path.join(ULTRA, 'root-empty', '.claude')));
const out = path.resolve(arg('--out', path.join(ULTRA, 'shots', `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`)));
const runs = +arg('--runs', 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (root === path.join(ULTRA, 'root-empty', '.claude')) for (const d of ['projects', 'sessions']) fs.mkdirSync(path.join(root, d), { recursive: true });
fs.mkdirSync(out, { recursive: true });

// the frontmost app (read-only, LaunchServices): an instance under test must never take it
function front() {
  try {
    const asn = execFileSync('/usr/bin/lsappinfo', ['front'], { encoding: 'utf8' }).trim();
    return execFileSync('/usr/bin/lsappinfo', ['info', '-only', 'name', asn], { encoding: 'utf8' }).replace(/^.*?=\s*"?|"?\s*$/g, '') || null;
  } catch { return null; }
}
// pids of live processes whose command line names one of `dirs` (this run's userData dirs; other harness users' aren't ours)
const used = [];
function leftovers(dirs = used) {
  return execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n')
    .filter(l => dirs.some(d => l.includes(d)) && !l.includes('test/ultra/smoke.js')).map(l => +l.trim().split(/\s+/)[0]);
}

const results = { root, out, startedAt: new Date().toISOString(), runs: [], firstRun: null, parallel: null, failures: [] };
const check = (ok, what) => { if (!ok) results.failures.push(what); return ok; };

async function one(name, opts, { home = true } = {}) {
  const r = { name, frontBefore: front() };
  const v = await launch({ root, ...opts });
  used.push(v.userData);
  try {
    Object.assign(r, { pid: v.pid, userData: path.relative(ULTRA, v.userData), readyMs: v.readyMs, processes: v.processes().length });
    // shorts are recorded into the profile, never the user's ~/Movies/Vibepet (whose recordings it must not see)
    r.recordings = path.relative(v.userData, await v.evalMain(() => globalThis.__vibepet.require('./content').ROOT));
    check(r.recordings === 'recordings', `${name}: recordings dir outside its profile (${r.recordings})`);
    await v.shot(path.join(out, `${name}-idle.png`));
    if (home) {
      r.home = await v.openHome();
      await v.shot(path.join(out, `${name}-home.png`));
      await sleep(1000);
      r.home.stillOpenAfter1s = (await v.homeMode()) === r.home.mode;   // nothing (a blur, a stray tick) closed it
      check(r.home.stillOpenAfter1s, `${name}: Home closed by itself`);
    }
    r.notes = (await v.evalMain(() => globalThis.__vibepet.notes.length));   // OS banners it would have posted
    r.frontAfter = front();
    check(r.frontAfter === r.frontBefore || r.frontAfter === null, `${name}: frontmost app changed ${r.frontBefore} → ${r.frontAfter}`);
  } finally { r.close = await v.close(); }
  check(r.close.how === 'quit', `${name}: close ${r.close.how}`);
  check(!r.close.orphans.length, `${name}: orphans ${JSON.stringify(r.close.orphans)}`);
  return r;
}

(async () => {
  const t0 = Date.now();
  results.harnessProcsBefore = leftovers([path.join(ULTRA, 'userdata') + path.sep]).length;   // anyone's: informational
  // 1. N sequential runs as a returning user (setup done): idle → click → Home (Now + chat) → close
  for (let i = 1; i <= runs; i++) {
    const r = await one(`run-${i}`, { state: { setupDone: true } });
    check(r.home?.mode === 'now', `run-${i}: Home mode ${r.home?.mode}`);
    results.runs.push(r);
    console.log(`run ${i}: ready ${r.readyMs} ms, home '${r.home?.mode}' in ${r.home?.ms} ms, close ${r.close.how} in ${r.close.ms} ms, ${r.close.procs} procs, orphans ${r.close.orphans.length}`);
  }
  // 2. a first run (fresh profile): the same click opens Home on the Setup card
  if (!flag('--no-first-run')) {
    const r = results.firstRun = await one('first-run', {});
    check(r.home?.mode === 'setup', `first-run: Home mode ${r.home?.mode}`);
    console.log(`first run: home '${r.home?.mode}', orphans ${r.close.orphans.length}`);
  }
  // 3. two instances at once, different userData: both up together, both answer a click, both close clean
  if (!flag('--no-parallel')) {
    const p = results.parallel = {};
    const both = await Promise.allSettled(['a', 'b'].map(() => launch({ root, state: { setupDone: true } })));
    const [a, b] = both.map(x => x.value);
    if (both.some(x => x.status === 'rejected')) { await Promise.all([a, b].filter(Boolean).map(v => v.close())); throw both.find(x => x.reason).reason; }
    used.push(a.userData, b.userData);
    try {
      const paths = await Promise.all([a, b].map(v => v.evalMain(() => globalThis.__vibepet.paths.userData)));
      Object.assign(p, { pids: [a.pid, b.pid], userData: paths.map(u => path.relative(ULTRA, u)), readyMs: [a.readyMs, b.readyMs] });
      const ps = execFileSync('/bin/ps', ['-o', 'pid=', '-p', `${a.pid},${b.pid}`], { encoding: 'utf8' }).trim().split(/\s+/).map(Number);
      p.bothAlive = ps.includes(a.pid) && ps.includes(b.pid);
      check(p.bothAlive && a.pid !== b.pid, 'parallel: both mains alive at once');
      check(paths[0] !== paths[1], 'parallel: distinct userData');
      p.home = await Promise.all([a, b].map(v => v.openHome()));
      await a.shot(path.join(out, 'parallel-a-home.png')); await b.shot(path.join(out, 'parallel-b-home.png'));
      check(p.home.every(h => h.mode === 'now'), `parallel: Home modes ${p.home.map(h => h.mode)}`);
    } finally { p.close = await Promise.all([a.close(), b.close()]); }
    check(p.close.every(c => c.how === 'quit' && !c.orphans.length), `parallel: close ${JSON.stringify(p.close)}`);
    console.log(`parallel: pids ${p.pids}, both alive ${p.bothAlive}, homes ${p.home?.map(h => h.mode)}, orphans ${p.close.map(c => c.orphans.length)}`);
  }
  await sleep(1000);
  results.leftoversAfter = leftovers();
  check(!results.leftoversAfter.length, `leftover harness processes after the run: ${results.leftoversAfter}`);
  results.ms = Date.now() - t0;
  fs.writeFileSync(path.join(out, 'smoke.json'), JSON.stringify(results, null, 2));
  console.log(`${results.failures.length ? 'FAIL' : 'ok'} in ${(results.ms / 1000).toFixed(1)} s → ${out}${results.failures.length ? '\n  ' + results.failures.join('\n  ') : ''}`);
  process.exit(results.failures.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
