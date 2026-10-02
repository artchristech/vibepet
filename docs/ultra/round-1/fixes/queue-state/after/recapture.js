#!/usr/bin/env node
// queue-state recapture ($0: no fleet member takes a turn). Runs the app from the fix worktree against the isolated fleet
// root, as held, and records: (launch) who needs you in the first snapshot + how long after the launch call; (a) Home rows
// vs the registry (signal, ask, options, label, since vs statusUpdatedAt); (c) /jump vibepet, /jump beacon, /replay kestrel
// and two hotkey presses (ipc args); (d) quit + relaunch twice with the same userData: every since/label unchanged.
//   node recapture.js --app <worktree> --out <dir> --userdata <dir>
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { execFileSync } = require('child_process');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const APP = path.resolve(arg('--app')), OUT = path.resolve(arg('--out')), UD = path.resolve(arg('--userdata'));
const ROOT = path.join(os.userInfo().homedir, '.vibepet-ultra', 'root', '.claude');
const { launch } = require(path.join(APP, 'test/ultra/launch'));
const { instrument, SEED, fleetTruth } = require(path.join(APP, 'test/ultra/canon'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim();
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
fs.mkdirSync(OUT, { recursive: true });

const R = { app: APP, at: new Date().toISOString(), uptime: [uptime()], runs: [] };
R.fleet = fleetTruth(path.join(APP, 'test/fleet/fleet.js'));
const bySid = new Map((R.fleet.members || []).map(m => [m.sessionId, m])), sid = n => (R.fleet.members || []).find(m => m.name === n)?.sessionId;
const NEEDS = ['approval', 'question', 'plan', 'input'];

async function one(n, act) {
  const run = { n, uptimeBefore: uptime() }, t0 = Date.now();
  const v = await launch({ appDir: APP, root: ROOT, userData: UD, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  run.launchMs = Date.now() - t0; run.readyMs = v.readyMs;
  // the first snapshot (launch() returns once the renderer has one); then poll until kestrel + beacon read needs-you
  const s0 = await v.evalMain(() => globalThis.__vibepet.snapshot());
  run.first = (s0.agents || []).map(a => ({ member: bySid.get(a.id)?.name || a.name, kind: a.kind, phase: a.phase }));
  let needAt = null;
  for (let i = 0; i < 40 && needAt === null; i++) {
    const s = i ? await v.evalMain(() => globalThis.__vibepet.snapshot()) : s0;
    const k = (s.agents || []).filter(a => [sid('kestrel'), sid('beacon')].includes(a.id) && NEEDS.includes(a.kind));
    if (k.length === 2) needAt = Date.now() - t0; else await sleep(250);
  }
  run.needsAfterLaunchCallMs = needAt; run.needsAfterReadyMs = needAt === null ? null : needAt - run.launchMs;
  // the jump key's queue before anything is hovered (done rows still unseen): needs you, then done, one order
  run.pendingBeforeHover = (await v.win.evaluate(() => pending().map(a => a.id))).map(id => bySid.get(id)?.name || id);
  await v.evalMain(instrument);
  await v.openHome(); await sleep(3300);   // one tick with Home open
  const readAt = Date.now();
  const [rows, snap] = await Promise.all([
    v.win.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, cls: r.className, tl: r.querySelector('.tl')?.style.background || null,
      label: r.querySelector('.nm small')?.textContent || '', ask: r.querySelector('.na')?.textContent || null, actions: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) }))),
    v.evalMain(() => globalThis.__vibepet.snapshot().agents),
  ]);
  const pend = await v.win.evaluate(() => pending().map(a => a.id));
  const sa = new Map(snap.map(a => [a.id, a]));
  run.rows = rows.map(r => { const a = sa.get(r.id) || {}, m = bySid.get(r.id), st = m?.registry?.statusUpdatedAt;
    return { member: m?.name || a.name, ...r, kind: a.kind, since: a.since, options: a.options || null, alive: a.alive, pid: a.pid, term: a.term,
      statusUpdatedAt: st || null, sinceMinusRegistryMs: st ? a.since - st : null, trueAgeS: st ? Math.round((readAt - st) / 1000) : null }; });
  run.order = { snapshot: snap.map(a => bySid.get(a.id)?.name || a.name), home: rows.map(r => bySid.get(r.id)?.name || r.id), pending: pend.map(id => bySid.get(id)?.name || id) };
  await v.shot(path.join(OUT, `run${n}-home.png`));
  if (act) {
    const calls = () => v.evalMain(() => globalThis.__canon.calls);
    const since = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = (await calls()).filter(x => x.at >= t && x.kind === kind); if (c.length || Date.now() > end) return c; await sleep(100); } };
    run.commands = [];
    for (const [cmd, kind] of [['/jump vibepet', 'ipc:jump'], ['/jump beacon', 'ipc:jump'], ['/replay kestrel', 'ipc:theater']]) {
      if (!(await v.homeMode())) await v.openHome();
      const t = Date.now();
      await v.win.locator('#chatInput').fill(cmd); await v.win.locator('#chatInput').press('Enter');
      const c = (await since(t, kind))[0];
      const id = c ? (kind === 'ipc:jump' ? c.args[0] : c.id) : null;
      run.commands.push({ cmd, ipc: kind, arg: id, member: id ? bySid.get(id)?.name || null : null, expect: cmd.split(' ')[1], ok: !!id && bySid.get(id)?.name === cmd.split(' ')[1] });
      await sleep(700);
      for (const w of v.windows()) if (/theater\/player\.html$/.test(w.url())) {   // the Theater window /replay opened: its beats, then the shot
        run.theater = await w.waitForFunction(() => document.querySelectorAll('#beats .b').length > 0 && { beats: document.querySelectorAll('#beats .b').length, title: (document.getElementById('title')?.textContent || '').slice(0, 60) }, null, { timeout: 15e3 }).then(h => h.jsonValue()).catch(() => null);
        await sleep(2600); await v.shot(path.join(OUT, `run${n}-theater-kestrel.png`), { page: w }).catch(() => {}); await w.close().catch(() => {});
      }
      await v.shot(path.join(OUT, `run${n}-${cmd.replace(/\W+/g, '-').replace(/^-/, '')}.png`));
    }
    // the jump key: main's shortcut handler sends 'hotkey'; a second press within 4 s walks on
    const q = await v.win.evaluate(() => pending().map(a => a.id));
    const t = Date.now();
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey'));
    const c1 = (await since(t, 'ipc:jump', 6000))[0], t2 = Date.now();
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey'));
    const c2 = (await since(t2, 'ipc:jump', 6000))[0];
    run.hotkey = { queue: q.map(id => bySid.get(id)?.name || id), presses: [c1, c2].map(c => c ? bySid.get(c.args[0])?.name || c.args[0] : null), gapMs: t2 - t };
    await v.shot(path.join(OUT, `run${n}-hotkey.png`));
  }
  run.close = await v.close();
  run.uptimeAfter = uptime();
  return run;
}

(async () => {
  for (let n = 1; n <= 3; n++) R.runs.push(await one(n, n === 1));
  // (d) relaunch: since per member identical across runs (it's read off Claude Code's clock), labels agree within a tick
  const per = {};
  for (const r of R.runs) for (const row of r.rows) (per[row.member] ||= []).push({ run: r.n, since: row.since, label: row.label });
  R.relaunch = Object.fromEntries(Object.entries(per).map(([m, xs]) => [m, { since: xs.map(x => x.since), spreadMs: Math.max(...xs.map(x => x.since)) - Math.min(...xs.map(x => x.since)), labels: xs.map(x => x.label) }]));
  R.uptime.push(uptime());
  fs.writeFileSync(path.join(OUT, 'recapture.json'), JSON.stringify(R, null, 2));
  const r1 = R.runs[0];
  console.log('launch→needs (kestrel+beacon) ms after launch call:', R.runs.map(r => r.needsAfterLaunchCallMs), 'after ready:', R.runs.map(r => r.needsAfterReadyMs), 'first snapshot:', JSON.stringify(r1.first));
  for (const row of r1.rows) console.log(' ', String(row.member).padEnd(8), row.cls.padEnd(10), String(row.kind).padEnd(9), row.label.padEnd(28), 'since-reg', row.sinceMinusRegistryMs, '|', row.ask || '', row.options ? JSON.stringify(row.options.map(o => o.label)) : '', row.actions.join(','));
  console.log('order', JSON.stringify(r1.order), 'pending before hover', JSON.stringify(r1.pendingBeforeHover));
  console.log('commands', JSON.stringify(r1.commands));
  console.log('hotkey', JSON.stringify(r1.hotkey));
  console.log('relaunch spread ms', JSON.stringify(Object.fromEntries(Object.entries(R.relaunch).map(([m, x]) => [m, x.spreadMs]))));
  console.log('closes', JSON.stringify(R.runs.map(r => ({ how: r.close.how, orphans: r.close.orphans.length }))));
})().catch(e => { console.error(e); process.exit(1); });
