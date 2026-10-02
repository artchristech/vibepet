// Phase G — are chip clicks reliable? Home's #now is rebuilt (innerHTML) on every 3 s tick while open. 60 human-speed
// clicks (150 ms press) on a chip's Open at random moments; each must reach shell.openExternal (stubbed: records only).
'use strict';
const L = require('./lib');
const { sleep } = L;
(async () => {
  const ctx = await L.start({ phase: 'G' });
  const { R, v } = ctx; R.truth0 = L.fleetTruth();
  let s;
  try {
    await ctx.openHome(); await sleep(600);
    s = await L.nodeServer({ cwd: L.repo('vibepet'), port: 47191, title: 'click target' });
    await ctx.waitFooter(f => f.some(x => x.port === 47191), s.listenAt, 45e3); await sleep(500);
    const res = [];
    for (let i = 0; i < 60; i++) {
      await sleep(200 + Math.round(Math.random() * 700));
      const box = await v.win.evaluate(() => { const b = document.querySelector('#now .srv[data-port="47191"] button[data-do=open]'); if (!b) return null; b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      if (!box) { res.push({ i, skipped: true }); continue; }
      const renders0 = await v.win.evaluate(() => window.__s6.renders);
      const since = Date.now();
      await v.win.mouse.move(box.x, box.y); await v.win.mouse.down(); await sleep(150); await v.win.mouse.up();
      await sleep(350);
      const n = (await ctx.calls(since, 'openExternal')).length;
      const renders1 = await v.win.evaluate(() => window.__s6.renders);
      res.push({ i, ok: n === 1, calls: n, rerenderedDuringPress: renders1 > renders0 });
    }
    const done = res.filter(r => !r.skipped);
    R.clicks = { n: done.length, delivered: done.filter(r => r.ok).length, dropped: done.filter(r => !r.ok).length, droppedWithRerender: done.filter(r => !r.ok && r.rerenderedDuringPress).length, rerenderOverlaps: done.filter(r => r.rerenderedDuringPress).length };
    ctx.note({ step: 'clicks', ...R.clicks });
  } catch (e) { console.error('PHASE G ERROR', e); R.error = String(e.stack || e); }
  finally {
    try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {}
    await sleep(500); R.leftovers = L.listeners(47191);
    const r = await ctx.finish(); console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers)); process.exit(0);
  }
})();
