// Phase C — F2 open + stop with several servers up: does ✕ kill exactly that server and only it? Cancel kills nothing?
// What feedback? Plus: Stop on a row whose server already died (stale until the next poll), and the /stop command.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const L = require('./lib');
const { sleep } = L;
(async () => {
  const truth0 = L.fleetTruth();
  const ctx = await L.start({ phase: 'C' });
  const { R, v } = ctx; R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  const ours = [];
  try {
    await ctx.openHome(); await sleep(600);
    // three servers: two in the vibepet repo (its site preview; a node server behind a `sh -c` wrapper, like `npm run`),
    // one in kestrel's repo (kestrel's own `npm start`)
    const s1 = await L.pyHttp({ cwd: L.repo('vibepet'), port: 47141, dir: 'site' }); s1.name = 'vibepet site preview'; ours.push(s1);
    const wrap = spawn('/bin/sh', ['-c', `exec 3>&1; ${process.execPath} ${path.join(L.FX, 'server.js')} 47142 '' '' 900000; echo wrapper-saw-exit $?`], { cwd: L.repo('vibepet'), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let wbuf = ''; wrap.stdout.on('data', d => wbuf += d);
    let t0 = Date.now(); while (!/listenAt/.test(wbuf) && Date.now() - t0 < 10e3) await sleep(50);
    const s2 = { proc: wrap, port: 47142, listener: L.listeners(47142)[0].pid, wrapper: wrap.pid, cwd: L.repo('vibepet'), name: 'node behind sh -c' }; ours.push(s2);
    const s3 = await L.npmStart({ cwd: L.repo('kestrel'), port: 47143 }); s3.name = 'kestrel npm start'; ours.push(s3);
    R.servers = ours.map(s => ({ name: s.name, port: s.port, listener: s.listener, wrapper: s.wrapper || s.pid }));
    const all = await ctx.waitFooter(f => [47141, 47142, 47143].every(p => f.some(x => x.port === p)), Date.now() - 1, 60e3);
    ctx.note({ step: 'all three listed', at: all && L.iso(all.at), srv: all && all.srv });
    await sleep(500);
    await ctx.shot('F2', 'three-servers');
    // Open on the site preview
    let since = Date.now();
    await v.win.click('#now .srv[data-port="47141"] button[data-do=open]'); await sleep(400);
    const op = (await ctx.calls(since, 'openExternal'))[0];
    const got = op ? await L.get(op.url) : null;
    R.open = { url: op && op.url, ms: op ? op.at - since : null, got: got && { status: got.status, remote: got.remote, title: (got.body.match(/<title>([^<]*)/) || [])[1] } };
    ctx.note({ step: 'open site preview', ...R.open });
    ctx.timing('F2', 'click Open → shell.openExternal called', R.open.ms, { n: 1 });
    // ✕ then Cancel: nothing may die
    await ctx.setAnswer(1); since = Date.now();
    await v.win.click('#now .srv[data-port="47142"] button[data-do=stop]'); await sleep(1500);
    const dCancel = (await ctx.calls(since, 'dialog'))[0];
    R.cancel = { dialog: dCancel, alive: ours.map(s => [s.port, L.alive(s.listener)]), events: (await ctx.calls(since, 'event')).map(c => c.data) };
    ctx.note({ step: '✕ then Cancel', ...R.cancel });
    // ✕ then Stop on the wrapped node server: only its listener dies (and its wrapper with it); the other two live
    await ctx.setAnswer(0); since = Date.now();
    await v.win.click('#now .srv[data-port="47142"] button[data-do=stop]');
    const dead2 = await L.waitDead(s2.listener, 10e3);
    const gone2 = await ctx.waitFooter(f => !f.some(x => x.port === 47142), since, 30e3);
    await sleep(250);
    const sh2 = await ctx.shot('F2', 'after-stop-wrapped');
    await sleep(1500);
    R.stop2 = { dialog: (await ctx.calls(since, 'dialog'))[0], deadMs: dead2 ? dead2 - since : null, goneMs: gone2 ? gone2.at - since : null,
      wrapperAlive: L.alive(s2.wrapper), wrapperOut: wbuf.trim().split('\n').slice(-1)[0], others: [s1, s3].map(s => [s.port, L.alive(s.listener)]), events: (await ctx.calls(since, 'event')).map(c => c.data), bubble: sh2.view.bubble };
    ctx.note({ step: '✕ then Stop (wrapped node)', ...R.stop2 });
    ctx.timing('F2', 'click ✕ (Stop) → listener dead', R.stop2.deadMs, { n: 1 });
    ctx.timing('F2', 'click ✕ (Stop) → chip gone', R.stop2.goneMs, { n: 1 });
    // a stale row: the site preview dies on its own; before the next poll, the user clicks its ✕
    const killAt = Date.now(); L.stopOurs(s1, 'SIGTERM'); await L.waitDead(s1.listener, 5e3);
    await sleep(300);
    const stillListed = (await ctx.view()).srv.some(x => x.port === 47141);
    since = Date.now();
    if (stillListed) {
      await v.win.click('#now .srv[data-port="47141"] button[data-do=stop]'); await sleep(1200);
      const sh3 = await ctx.shot('F2', 'stop-on-dead-server');
      R.stale = { stillListed, dialog: (await ctx.calls(since, 'dialog'))[0], events: (await ctx.calls(since, 'event')).map(c => c.data), bubble: sh3.view.bubble };
    } else R.stale = { stillListed };
    const gone1 = await ctx.waitFooter(f => !f.some(x => x.port === 47141), killAt, 30e3);
    R.stale.listedForMs = gone1 ? gone1.at - killAt : null;
    ctx.note({ step: 'stop on a server that already exited', ...R.stale });
    // the command bar: /stop <port>
    const typeCmd = async text => { await v.win.click('#chatInput'); await v.win.fill('#chatInput', ''); await v.win.type('#chatInput', text, { delay: 15 }); await v.win.press('#chatInput', 'Enter'); };
    since = Date.now(); await typeCmd('/stop 47999'); await sleep(800);
    R.cmdNone = { msgs: (await ctx.view()).msgs, dialogs: (await ctx.calls(since, 'dialog')).length };
    since = Date.now(); await typeCmd('/stop'); await sleep(800);
    R.cmdEmpty = { msgs: (await ctx.view()).msgs, dialogs: (await ctx.calls(since, 'dialog')).length };
    await ctx.shot('F2', 'stop-command-notes');
    since = Date.now(); await typeCmd('/stop 47143');
    const dead3 = await L.waitDead(s3.listener, 10e3);
    const gone3 = await ctx.waitFooter(f => !f.some(x => x.port === 47143), since, 30e3);
    await sleep(1500);
    R.cmdStop = { dialog: (await ctx.calls(since, 'dialog'))[0], deadMs: dead3 ? dead3 - since : null, goneMs: gone3 ? gone3.at - since : null, npmAlive: L.alive(s3.pid), events: (await ctx.calls(since, 'event')).map(c => c.data), msgs: (await ctx.view()).msgs };
    ctx.note({ step: '/stop 47143', ...R.cmdStop, none: R.cmdNone, empty: R.cmdEmpty });
    ctx.timing('F2', '/stop <port> + Enter (Stop) → listener dead', R.cmdStop.deadMs, { n: 1 });
    await ctx.shot('F2', 'after-stop-command');
  } catch (e) { console.error('PHASE C ERROR', e); R.error = String(e.stack || e); }
  finally {
    for (const s of ours) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {} }
    await sleep(500);
    R.leftovers = [47141, 47142, 47143].map(p => [p, L.listeners(p)]);
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers));
    process.exit(0);
  }
})();
