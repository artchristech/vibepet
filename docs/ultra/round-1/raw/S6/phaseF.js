// Phase F — exploration: real dev-server shapes a person with 5–15 sessions runs every day.
//  v6   node listen(port, 'localhost') → binds [::1] only on this Mac (Vite's default host; the user's own 51xx/52xx dev
//       servers are bound exactly like this right now)
//  slow first response 3 s (Next.js-style compile on first hit), then instant
//  tls  local HTTPS dev server (mkcert-style)
//  pf   prefork server (gunicorn shape): ✕ on a worker chip
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const L = require('./lib');
const { sleep } = L;
const VP = L.repo('vibepet');
function fx(file, args, cwd) {
  const p = spawn(process.execPath, [path.join(L.FX, file), ...args], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((res, rej) => { let b = ''; const t = setTimeout(() => rej(new Error(file + ' no listen')), 10e3);
    p.stdout.on('data', d => { b += d; const m = b.match(/\{"listenAt".*\}/); if (m) { clearTimeout(t); const j = JSON.parse(m[0]); res({ proc: p, pid: p.pid, listener: p.pid, listenAt: j.listenAt, port: j.port }); } }); });
}
(async () => {
  const truth0 = L.fleetTruth();
  const ctx = await L.start({ phase: 'F' });
  const { R, v } = ctx; R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  const ours = [];
  try {
    await ctx.openHome(); await sleep(600);
    const v6 = await L.nodeServer({ cwd: VP, port: 47181, host: 'localhost', title: 'Vite + React + TS' }); ours.push(v6);
    const slow = await fx('slow.js', ['47182', 'Next.js app', '3000'], VP); ours.push(slow);
    const tls = await fx('https.js', ['47183', 'secure app'], VP); ours.push(tls);
    const pf = await L.prefork({ cwd: VP, port: 47184, workers: 3, title: 'gunicorn app' }); ours.push(pf);
    R.binds = { v6: L.listeners(47181), slow: L.listeners(47182), tls: L.listeners(47183), pf: L.listeners(47184) };
    ctx.note({ step: 'started', binds: R.binds, v6address: v6.address });
    const t0 = Date.now();
    const all = await ctx.waitFooter(f => [47181, 47182, 47183, 47184].every(p => f.some(x => x.port === p)), t0 - 1, 45e3);
    ctx.note({ step: 'all listed', at: all && L.iso(all.at) });
    // two more polls: does anything get re-probed (the slow one is warm after 3 s)?
    const pc = (await ctx.polls(0)).length; let w = Date.now(); while ((await ctx.polls(0)).length < pc + 2 && Date.now() - w < 40e3) await sleep(500);
    await sleep(3500);
    const sh = await ctx.shot('F5x', 'dev-server-shapes');
    const chip = p => sh.view.srv.filter(x => x.port === p).map(x => ({ label: x.label, disabled: x.disabled }));
    const tip = await v.win.evaluate(() => [...document.querySelectorAll('#now .srv button[data-do=open][disabled]')].map(b => b.title));
    // what a browser gets at the URL Open would use
    const reach = async (p, scheme = 'http') => { const g = await L.get(`${scheme}://localhost:${p}/`, 4000); return g.error ? 'error ' + g.error : `${g.status} ${(g.body.match(/<title>([^<]*)/) || [])[1] || ''}`; };
    R.chips = {
      v6: { chip: chip(47181), browserAtLocalhost: await reach(47181), probeTarget127: await (async () => { const g = await L.get('http://127.0.0.1:47181/'); return g.error || g.status; })() },
      slow: { chip: chip(47182), browserAtLocalhost: await reach(47182) },
      tls: { chip: chip(47183), httpAtLocalhost: await reach(47183) },
      pf: { chip: chip(47184) },
      disabledTooltips: tip,
    };
    ctx.note({ step: 'chips vs reality', ...R.chips });
    // ✕ on a prefork worker chip (not the master)
    const pfChips = sh.view.srv.filter(x => x.port === 47184);
    const worker = pfChips.find(x => pf.workers.includes(x.pid));
    if (worker) {
      await ctx.setAnswer(0); const since = Date.now();
      await v.win.click(`#now .srv[data-pid="${worker.pid}"][data-port="47184"] button[data-do=stop]`);
      await L.waitDead(worker.pid, 5e3);
      const pc2 = (await ctx.polls(0)).length; let w2 = Date.now(); while ((await ctx.polls(0)).length < pc2 + 1 && Date.now() - w2 < 30e3) await sleep(400);
      await sleep(3500);
      const sh2 = await ctx.shot('F5x', 'worker-stopped-server-still-up');
      const g = await L.get('http://127.0.0.1:47184/');
      R.worker = { victim: worker.pid, dialog: (await ctx.calls(since, 'dialog'))[0], events: (await ctx.calls(since, 'event')).map(c => c.data), respawns: pf.proc.respawns,
        chipsAfter: sh2.view.srv.filter(x => x.port === 47184).map(x => x.pid), serverStillAnswers: !g.error, bubble: sh2.view.bubble };
      ctx.note({ step: 'worker stop', ...R.worker });
    }
  } catch (e) { console.error('PHASE F ERROR', e); R.error = String(e.stack || e); }
  finally {
    for (const s of ours) { try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {} }
    await sleep(800);
    R.leftovers = [47181, 47182, 47183, 47184].map(p => [p, L.listeners(p)]).filter(x => x[1].length);
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers));
    process.exit(0);
  }
})();
