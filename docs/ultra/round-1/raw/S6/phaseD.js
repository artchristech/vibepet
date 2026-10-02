// Phase D — F3 conflicts: a second server on the same port from another member's repo.
//  D1 both listen: kestrel's node server on *:47151 (all interfaces, the node default) + beacon's
//     `python3 -m http.server 47151 --bind 127.0.0.1` (macOS lets the more specific bind coexist)
//  D2 true clash: beacon starts a node server on 47152 while kestrel's holds it → EADDRINUSE
//  D3 the dev-server dance: the second server moves to the next port (Vite/Next do this) — same page title, two repos
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lib');
const { sleep } = L;
(async () => {
  const truth0 = L.fleetTruth();
  const ctx = await L.start({ phase: 'D' });
  const { R, v } = ctx; R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  const ours = [];
  const bdir = path.join(L.SP, 'fx', 'beacon-status'); fs.mkdirSync(bdir, { recursive: true });
  fs.writeFileSync(path.join(bdir, 'index.html'), '<!doctype html><title>Beacon status</title><p>beacon</p>');
  try {
    await ctx.openHome(); await sleep(600);
    // ---- D1
    const k1 = await L.nodeServer({ cwd: L.repo('kestrel'), port: 47151, title: 'Kestrel dashboard' }); ours.push(k1);
    const b1 = await L.pyHttp({ cwd: L.repo('beacon'), port: 47151, bind: '127.0.0.1', dir: bdir }); ours.push(b1);
    R.d1 = { kestrel: { pid: k1.pid, address: k1.address }, beacon: { pid: b1.pid, error: b1.error || null }, lsof: L.listeners(47151) };
    ctx.note({ step: 'D1 started', ...R.d1 });
    const both = await ctx.waitFooter(f => f.filter(x => x.port === 47151).length >= 2, Date.now() - 1, 45e3);
    const one = both ? null : (await ctx.view()).srv.filter(x => x.port === 47151);
    await sleep(500);
    const sh1 = await ctx.shot('F3', 'same-port-two-servers');
    const chips = (both ? both.srv : one).filter(x => x.port === 47151).map(x => ({ ...x, owner: x.pid === k1.pid ? 'kestrel (node, *:47151)' : x.pid === b1.pid ? 'beacon (python, 127.0.0.1:47151)' : '?' }));
    R.d1.chips = chips;
    // what each chip's Open reaches: click it, take the URL main would open, fetch it (node resolves localhost like a browser: ::1 first)
    R.d1.opens = [];
    for (const c of chips) {
      const since = Date.now();
      await v.win.click(`#now .srv[data-pid="${c.pid}"][data-port="47151"] button[data-do=open]`); await sleep(400);
      const op = (await ctx.calls(since, 'openExternal'))[0];
      const got = op ? await L.get(op.url) : null;
      R.d1.opens.push({ chip: c.label, owner: c.owner, url: op && op.url, reached: got && ((got.body.match(/<title>([^<]*)/) || [])[1]), remote: got && got.remote });
    }
    R.d1.direct = { v4: await L.get('http://127.0.0.1:47151/'), v6: await L.get('http://[::1]:47151/') };
    for (const k of ['v4', 'v6']) R.d1.direct[k] = R.d1.direct[k].body ? (R.d1.direct[k].body.match(/<title>([^<]*)/) || [])[1] : R.d1.direct[k].error;
    ctx.note({ step: 'D1 chips + opens', chips: R.d1.chips.map(c => [c.label, c.owner]), opens: R.d1.opens, direct: R.d1.direct });
    // /stop 47151: which of the two does the command pick?
    const menu1 = await ctx.menu(); R.d1.menu = menu1 && menu1.localhost;
    L.stopOurs(k1); L.stopOurs(b1); await L.waitDead(k1.pid); await L.waitDead(b1.pid);
    // ---- D2
    const k2 = await L.nodeServer({ cwd: L.repo('kestrel'), port: 47152 }); ours.push(k2);
    const b2 = await L.nodeServer({ cwd: L.repo('beacon'), port: 47152 }); ours.push(b2);
    R.d2 = { kestrel: { pid: k2.pid, address: k2.address }, beacon: { error: b2.error || null, alive: L.alive(b2.pid) } };
    const shown2 = await ctx.waitFooter(f => f.some(x => x.port === 47152), Date.now() - 1, 45e3);
    await sleep(500);
    R.d2.chips = (await ctx.view()).srv.filter(x => x.port === 47152);
    await ctx.shot('F3', 'port-taken-second-fails');
    ctx.note({ step: 'D2', ...R.d2 });
    L.stopOurs(k2); await L.waitDead(k2.pid);
    // ---- D3
    const k3 = await L.nodeServer({ cwd: L.repo('kestrel'), port: 47153, title: 'Vite + React + TS' }); ours.push(k3);
    const b3 = await L.nodeServer({ cwd: L.repo('beacon'), port: 47154, title: 'Vite + React + TS' }); ours.push(b3);
    const shown3 = await ctx.waitFooter(f => [47153, 47154].every(p => f.some(x => x.port === p)), Date.now() - 1, 45e3);
    await sleep(500);
    const sh3 = await ctx.shot('F3', 'next-port-same-title');
    R.d3 = { chips: sh3.view.srv.filter(x => [47153, 47154].includes(x.port)).map(x => ({ label: x.label, owner: x.pid === k3.pid ? 'kestrel' : x.pid === b3.pid ? 'beacon' : '?' })) };
    const menu3 = await ctx.menu(); R.d3.menu = menu3 && menu3.localhost;
    ctx.note({ step: 'D3', ...R.d3 });
  } catch (e) { console.error('PHASE D ERROR', e); R.error = String(e.stack || e); }
  finally {
    for (const s of ours) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {} }
    await sleep(500);
    R.leftovers = [47151, 47152, 47153, 47154].map(p => [p, L.listeners(p)]);
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers));
    process.exit(0);
  }
})();
