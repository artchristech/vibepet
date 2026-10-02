// Phase F2 — a dev server that is still compiling when vibepet first sees it (first responses take seconds)
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const L = require('./lib');
const { sleep } = L;
(async () => {
  const ctx = await L.start({ phase: 'F2' });
  const { R, v } = ctx; R.truth0 = L.fleetTruth();
  let p;
  try {
    await ctx.openHome(); await sleep(600);
    p = spawn(process.execPath, [path.join(L.FX, 'slow2.js'), '47185', 'Next.js app', '20000'], { cwd: L.repo('vibepet'), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let b = ''; p.stdout.on('data', d => b += d); const t0 = Date.now(); while (!/listenAt/.test(b) && Date.now() - t0 < 10e3) await sleep(50);
    const listenAt = JSON.parse(b.match(/\{.*\}/)[0]).listenAt;
    const shown = await ctx.waitFooter(f => f.some(x => x.port === 47185), listenAt, 45e3);
    R.first = { ms: shown && shown.at - listenAt, chip: shown && shown.srv.find(x => x.port === 47185) };
    ctx.note({ step: 'first seen', ...R.first });
    // wait until the compile is long over, plus 3 polls: is the chip ever fixed?
    await sleep(Math.max(0, listenAt + 21000 - Date.now()));
    const pc = (await ctx.polls(0)).length; let w = Date.now(); while ((await ctx.polls(0)).length < pc + 3 && Date.now() - w < 60e3) await sleep(500);
    await sleep(3500);
    const sh = await ctx.shot('F5x', 'compiling-server-open-disabled');
    const g = await L.get('http://localhost:47185/', 3000);
    R.later = { sinceListenS: Math.round((Date.now() - listenAt) / 1000), chip: sh.view.srv.find(x => x.port === 47185), browserAtLocalhost: g.error || `${g.status} ${(g.body.match(/<title>([^<]*)/) || [])[1] || ''}` };
    ctx.note({ step: 'after compile + 3 polls', ...R.later });
  } catch (e) { console.error('PHASE F2 ERROR', e); R.error = String(e.stack || e); }
  finally {
    try { process.kill(-p.pid, 'SIGTERM'); } catch {}
    await sleep(600); R.leftovers = L.listeners(47185);
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers));
    process.exit(0);
  }
})();
