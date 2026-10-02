const L = require('./rlib');
(async () => {
  const v = await L.start();
  try {
    console.log('ready', v.readyMs, L.uptime());
    const m = await v.openHome(); console.log('home', m.mode);
    await v.observe();
    const p1 = L.nextPort(), p2 = L.nextPort();
    const a = L.serve('python3', ['-m', 'http.server', String(p1)], { cwd: L.repo('vibepet'), tag: 'py' });
    const b = L.serve('node', [L.FX + '/titled.js', String(p2), 'Vite + React + TS', 'localhost'], { cwd: L.repo('delta'), tag: 'v6' });
    await L.waitListen(a, p1); await L.waitListen(b, p2);
    const r = await L.waitFor(async () => { const c = await v.chips(); return c.length >= 2 && c.every(x => !x.inactive) && c; }, 15e3);
    console.log(JSON.stringify(await v.chips(), null, 1));
    const rec = await v.rec(); console.log('chip adds', rec.chips.map(c => `${c.kind} ${c.port} +${c.at - (c.port === p1 ? a.listenAt : b.listenAt)}ms`));
    console.log(JSON.stringify((await v.snap()).servers));
    await v.shotTo('smoke-home');
  } finally { console.log(await L.stopAll()); console.log(await v.close()); }
})().catch(e => { console.error(e); process.exit(1); });
