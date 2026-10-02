// Phase E — F5: servers outside any session, and noise. Plus what 5–15 sessions trip on: the 8-chip cap, multi-pid and
// multi-port servers, non-HTTP listeners, dev processes, the hover count, and the up/down announcements.
'use strict';
const path = require('path');
const L = require('./lib');
const { sleep } = L;
(async () => {
  const truth0 = L.fleetTruth();
  const ctx = await L.start({ phase: 'E' });
  const { R, v } = ctx; R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  const ours = [], VP = L.repo('vibepet');
  const snapLocal = () => v.evalMain(() => { const s = globalThis.__vibepet.snapshot(); return { servers: s.servers, local: s.local }; });
  try {
    await ctx.openHome(); await sleep(600);
    // a long-running watcher that never listens (a dev process), started first so it is >60 s old later
    const idle = L.idle({ cwd: VP }); R.idlePid = idle.pid; const idleAt = Date.now();
    // E1: servers outside any session's repo
    const o1 = await L.nodeServer({ cwd: '/Users/christopherharris/.vibepet-ultra/s6-outside', port: 47171, title: 'outside app' }); ours.push(o1);
    const o2 = await L.nodeServer({ cwd: path.join(L.FLEET, '_probe'), port: 47172, title: 'probe dir app' }); ours.push(o2);
    // E2–E4: noise inside a session's repo
    const pf = await L.prefork({ cwd: VP, port: 47161, workers: 3, title: 'prefork app' }); ours.push(pf);
    const ins = await L.nodeServer({ cwd: VP, port: 47162, title: 'inspected app', extraArgs: ['--inspect=127.0.0.1:47163'] }); ours.push(ins);
    const raw = await L.rawTcp({ cwd: VP, port: 47164 }); ours.push(raw);
    R.started = { prefork: { master: pf.pid, workers: pf.workers, lsof: L.listeners(47161) }, inspector: { pid: ins.pid, lsof: [L.listeners(47162), L.listeners(47163)] }, raw: { pid: raw.pid }, outside: [o1.pid, o2.pid] };
    ctx.note({ step: 'started', ...R.started });
    const t0 = Date.now();
    const seen = await ctx.waitFooter(f => [47161, 47162, 47163, 47164].every(p => f.some(x => x.port === p)), t0 - 1, 45e3);
    // let two more polls pass so the outside servers had their chance
    const pollsBefore = (await ctx.polls(0)).length; let w = Date.now(); while ((await ctx.polls(0)).length < pollsBefore + 2 && Date.now() - w < 40e3) await sleep(500);
    await sleep(3500);
    const sh1 = await ctx.shot('F5', 'noise-in-footer');
    R.e1 = { outsideListed: sh1.view.srv.filter(x => [47171, 47172].includes(x.port)) };
    R.e2 = { chips: sh1.view.srv.filter(x => x.port === 47161) };
    R.e3 = { chips: sh1.view.srv.filter(x => [47162, 47163].includes(x.port)) };
    R.e4 = { chips: sh1.view.srv.filter(x => x.port === 47164) };
    ctx.note({ step: 'footer with noise', e1: R.e1, e2: R.e2.map ? R.e2 : R.e2, e3: R.e3, e4: R.e4, all: sh1.view.srv.map(x => x.label) });
    // E5: the cap — two more servers
    const n1 = await L.nodeServer({ cwd: VP, port: 47165, title: 'newer app' }); ours.push(n1);
    const n2 = await L.nodeServer({ cwd: L.repo('kestrel'), port: 47166, title: 'newest app' }); ours.push(n2);
    const nAt = Date.now();
    const pc = (await ctx.polls(0)).length; w = Date.now(); while ((await ctx.polls(0)).length < pc + 2 && Date.now() - w < 40e3) await sleep(500);
    await sleep(3500);
    const sh2 = await ctx.shot('F5', 'cap-eight-chips');
    const sl = await snapLocal();
    R.e5 = { chips: sh2.view.srv.map(x => x.label), chipCount: sh2.view.srv.length, snapshotServers: sl.servers.length, localCount: sl.local.servers, newestListed: sh2.view.srv.some(x => x.port === 47166), newerListed: sh2.view.srv.some(x => x.port === 47165), overflowHint: await v.win.evaluate(() => !!document.querySelector('#now .srvs') && /more|\+\d/.test(document.querySelector('#now .srvs').textContent)) };
    ctx.note({ step: 'cap', ...R.e5 });
    // the native list (⋯ → Localhost): servers, dev processes, background tasks
    await sleep(Math.max(0, 62e3 - (Date.now() - idleAt)));   // the watcher is now >60 s old
    await sleep(13e3);   // and one poll later
    const menu = await ctx.menu(); R.menu = menu && menu.localhost;
    ctx.note({ step: 'native Localhost menu', items: R.menu && R.menu.items.map(i => i.label) });
    // E2: Stop on a prefork chip (the first one listed for :47161)
    const pfChips = (await ctx.view()).srv.filter(x => x.port === 47161);
    if (pfChips.length) {
      const victim = pfChips[0].pid, role = victim === pf.pid ? 'master' : pf.workers.includes(victim) ? 'worker' : '?';
      await ctx.setAnswer(0); const since = Date.now();
      await v.win.click(`#now .srv[data-pid="${victim}"][data-port="47161"] button[data-do=stop]`);
      await L.waitDead(victim, 5e3); await sleep(6000);
      const pcs = (await ctx.polls(0)).length; let w2 = Date.now(); while ((await ctx.polls(0)).length < pcs + 1 && Date.now() - w2 < 30e3) await sleep(400);
      await sleep(3500);
      const sh3 = await ctx.shot('F5', 'prefork-after-stop');
      const got = await L.get('http://127.0.0.1:47161/');
      R.e2.stop = { victim, role, dialog: (await ctx.calls(since, 'dialog'))[0], events: (await ctx.calls(since, 'event')).map(c => c.data), stillServing: !got.error, chipsAfter: sh3.view.srv.filter(x => x.port === 47161).map(x => x.pid), respawns: pf.proc.respawns };
      ctx.note({ step: 'prefork stop', ...R.e2.stop });
    }
    // E3: Stop the debugger-port chip — the app's own port goes with it
    if ((await ctx.view()).srv.some(x => x.port === 47163)) {
      const since = Date.now();
      await v.win.click(`#now .srv[data-port="47163"] button[data-do=stop]`);
      await L.waitDead(ins.pid, 5e3); await sleep(800);
      R.e3.stop = { dialog: (await ctx.calls(since, 'dialog'))[0], appPortAlsoGone: !L.alive(ins.pid) && !(await L.get('http://127.0.0.1:47162/')).status, events: (await ctx.calls(since, 'event')).map(c => c.data) };
      ctx.note({ step: 'inspector stop', ...R.e3.stop });
    }
    // E4: the raw TCP chip's Open
    const rawChip = (await ctx.view()).srv.find(x => x.port === 47164);
    R.e4.chip = rawChip || null;
    for (const s of ours) L.stopOurs(s);
    for (const s of ours) await L.waitDead(s.listener || s.pid, 5e3);
    try { process.kill(-idle.pid, 'SIGTERM'); } catch {}
    // E7: Home closed, cursor over Net: the hover pill's localhost line
    await ctx.closeHome(); await sleep(400);
    const hold = await L.nodeServer({ cwd: VP, port: 47168, title: 'hover check' }); ours.push(hold);

    w = Date.now(); while (!((await snapLocal()).servers || []).some(s => s.port === 47168) && Date.now() - w < 30e3) await sleep(300);
    const p = await v.petPoint();
    await v.win.mouse.move(p.x - 60, p.y - 40); await v.win.mouse.move(p.x, p.y, { steps: 6 }); await sleep(900);
    const sh4 = await ctx.shot('F5', 'hover-roster-count');
    R.e7 = { roster: sh4.view.roster };
    ctx.note({ step: 'hover roster', ...R.e7 });
    await v.win.mouse.move(5, 5, { steps: 4 }); await sleep(800);
    L.stopOurs(hold); await L.waitDead(hold.pid, 5e3);
    // E8: alerts → Everything (Setup card, real clicks), then the up / down announcements
    await ctx.openHome(); await sleep(400);
    await v.win.click('#chatInput'); await v.win.type('#chatInput', '/setup', { delay: 15 }); await v.win.press('#chatInput', 'Enter'); await sleep(500);
    await v.win.click('#setup button[data-k=alerts][data-v=all]'); await sleep(400);
    await ctx.shot('F5', 'setup-alerts-everything');
    await v.win.click('#setup button[data-done]'); await sleep(600);
    R.e8 = { alerts: await v.evalMain(() => globalThis.__vibepet.state().alerts) };
    await ctx.closeHome(); await sleep(500);
    let since = Date.now();
    const up = await L.nodeServer({ cwd: VP, port: 47169, title: 'announce check' }); ours.push(up);
    w = Date.now(); let ev = null; while (Date.now() - w < 30e3) { ev = (await ctx.calls(since, 'event')).find(c => c.data.kind === 'localhost'); if (ev) break; await sleep(200); }
    await sleep(900);
    const sh5 = await ctx.shot('F5', 'announce-up-home-closed');
    R.e8.up = { text: ev && ev.data.text, ms: ev ? ev.at - up.listenAt : null, bubble: sh5.view.bubble };
    ctx.timing('F5', 'server up → "is up" announcement (alerts: Everything, Home closed)', R.e8.up.ms, { n: 1 });
    await sleep(6000);
    await ctx.openHome(); await sleep(400);
    since = Date.now(); L.stopOurs(up); const dAt = await L.waitDead(up.pid, 5e3);
    w = Date.now(); ev = null; while (Date.now() - w < 30e3) { ev = (await ctx.calls(since, 'event')).find(c => c.data.kind === 'localhost'); if (ev) break; await sleep(200); }
    await sleep(900);
    const sh6 = await ctx.shot('F5', 'announce-down-home-open');
    R.e8.down = { text: ev && ev.data.text, ms: ev && dAt ? ev.at - dAt : null, bubble: sh6.view.bubble };
    ctx.timing('F5', 'server exit → "went down" announcement (alerts: Everything, Home open)', R.e8.down.ms, { n: 1 });
    ctx.note({ step: 'announcements', ...R.e8 });
    // put the profile back to the default alert level, through the same card
    await v.win.click('#chatInput'); await v.win.type('#chatInput', '/setup', { delay: 15 }); await v.win.press('#chatInput', 'Enter'); await sleep(500);
    await v.win.click('#setup button[data-k=alerts][data-v=done]'); await sleep(300); await v.win.click('#setup button[data-done]'); await sleep(400);
  } catch (e) { console.error('PHASE E ERROR', e); R.error = String(e.stack || e); }
  finally {
    for (const s of ours) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {} }
    try { process.kill(-R.idlePid, 'SIGTERM'); } catch {}
    await sleep(800);
    R.leftovers = [47161, 47162, 47163, 47164, 47165, 47166, 47168, 47169, 47171, 47172].map(p => [p, L.listeners(p)]).filter(x => x[1].length);
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers));
    process.exit(0);
  }
})();
