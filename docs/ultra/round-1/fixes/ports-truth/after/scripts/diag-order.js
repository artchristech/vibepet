// diagnosis: the order Home lists servers in, and why (sid, seen, age), after six start at once and two more a moment later
const L = require('./rlib');
(async () => {
  const v = await L.start();
  try {
    await v.openHome(); await v.observe();
    const P = []; for (let i = 0; i < 8; i++) P.push(L.nextPort());
    for (let i = 0; i < 6; i++) L.serve('node', [L.FX + '/titled.js', String(P[i]), 'First' + i], { cwd: L.repo(['vibepet', 'delta', 'kestrel'][i % 3]), tag: 'a' + i });
    await L.sleep(1500);
    for (let i = 6; i < 8; i++) L.serve('node', [L.FX + '/titled.js', String(P[i]), 'Later' + i], { cwd: L.repo('vibepet'), tag: 'b' + i });
    await L.sleep(4000);
    const m = await v.evalMain(() => { const p = globalThis.__vibepet.require('./ports'), c = p.poll(); return c.servers.map(s => ({ port: s.port, sid: !!s.sid, seen: s.seen, age: s.age, title: s.title })); });
    const t0 = Math.min(...m.map(s => s.seen || Infinity));
    console.log(JSON.stringify(m.map(s => [s.port, s.title, s.sid, s.seen - t0, s.age])));
    console.log('snapshot order', JSON.stringify((await v.snap()).servers.map(s => s.port + ' ' + s.name)));
    console.log('ours', JSON.stringify(P));
  } finally { await L.stopAll(); await v.close(); }
})().catch(e => { console.error(e); process.exit(1); });
