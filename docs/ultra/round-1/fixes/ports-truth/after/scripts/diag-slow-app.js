// diagnosis: bc's start shape in the app (7 titled servers, then a slow one answering at 20 s); sample main's view of the slow
// server and its chip every second. Writes nothing but stdout.
const L = require('./rlib');
(async () => {
  const v = await L.start();
  try {
    await v.openHome(); await v.observe();
    const P = []; for (let i = 0; i < 8; i++) P.push(L.nextPort());
    for (let i = 0; i < 7; i++) L.serve('node', [L.FX + '/titled.js', String(P[i]), 'T' + i], { cwd: L.repo(['vibepet', 'delta', 'kestrel'][i % 3]), tag: 't' + i });
    await L.sleep(+(process.argv[2] || 300));
    const slow = L.serve('node', [L.FX + '/slow.js', String(P[7]), 'Next.js app', '20000'], { cwd: L.repo('vibepet'), tag: 'slow' });
    await L.waitListen(slow, P[7]);
    for (let i = 0; i < 30; i++) {
      const m = await v.evalMain((_, port) => { const p = globalThis.__vibepet.require('./ports'), s = p.poll().servers.find(x => x.port === port); return s ? { http: s.http, why: s.why, title: s.title, seen: s.seen, key: s.key } : null; }, P[7]);
      const c = (await v.chips()).find(x => x.port === P[7]);
      console.log(Date.now() - slow.listenAt, 'ready+' + (Date.now() - slow.readyAt), JSON.stringify(m), c ? (c.inactive ? 'chip inactive' : 'chip ACTIVE') : 'chip folded/absent', await v.more());
      if (m?.http && i > 22) break;
      await L.sleep(1000);
    }
  } finally { await L.stopAll(); await v.close(); }
})().catch(e => { console.error(e); process.exit(1); });
