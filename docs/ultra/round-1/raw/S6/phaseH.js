// Phase H — the native Localhost menu (⋯ → Localhost → :port → Stop …): same stop, which feedback at the default alert level?
'use strict';
const L = require('./lib');
const { sleep } = L;
(async () => {
  const ctx = await L.start({ phase: 'H' });
  const { R, v } = ctx; R.truth0 = L.fleetTruth();
  let s;
  try {
    await ctx.openHome(); await sleep(600);
    R.alerts = await v.evalMain(() => globalThis.__vibepet.state().alerts);
    s = await L.nodeServer({ cwd: L.repo('vibepet'), port: 47192, title: 'menu target' });
    await ctx.waitFooter(f => f.some(x => x.port === 47192), s.listenAt, 45e3); await sleep(500);
    const m = await ctx.menu();
    R.menu = m && m.localhost && m.localhost.items.find(i => /47192/.test(i.label));
    await ctx.setAnswer(0); const since = Date.now();
    const c = await ctx.clickMenu(['^Localhost', ':47192', '^Stop ']);
    const dead = await L.waitDead(s.pid, 5e3);
    await sleep(2500);
    const gone = await ctx.waitFooter(f => !f.some(x => x.port === 47192), since, 20e3);
    await sleep(1200);
    const sh = await ctx.shot('F2m', 'native-menu-stop-no-feedback');
    R.stop = { clicked: c, dialog: (await ctx.calls(since, 'dialog'))[0], deadMs: dead ? dead - since : null, goneMs: gone ? gone.at - since : null,
      eventsToRenderer: (await ctx.calls(since, 'event')).map(x => x.data), bubble: sh.view.bubble, msgs: sh.view.msgs };
    ctx.note({ step: 'native menu stop', alerts: R.alerts, menuItem: R.menu, ...R.stop });
  } catch (e) { console.error('PHASE H ERROR', e); R.error = String(e.stack || e); }
  finally {
    try { process.kill(-s.proc.pid, 'SIGTERM'); } catch {}
    await sleep(500); R.leftovers = L.listeners(47192);
    const r = await ctx.finish(); console.log('close', JSON.stringify(r.close), 'leftovers', JSON.stringify(R.leftovers)); process.exit(0);
  }
})();
