// (a) listen → chip, exit → chip gone, over random start/stop moments: n trials (default 12), Home open, servers in fleet repos.
// Writes ../a-timing.json. Latency from the fixture's own LISTENING timestamp, and from the SIGTERM we send (conservative).
const L = require('./rlib'), fs = require('fs');
const N = +(process.argv[2] || 12), REPOS = ['vibepet', 'delta', 'kestrel', 'beacon', 'atlas', 'ember'];
(async () => {
  const v = await L.start(), out = { what: 'listen→chip and exit→chip gone, Home open; random waits U(0,3 s) before each start and each stop', startedAt: new Date().toISOString(), uptimeStart: L.uptime(), trials: [] };
  try {
    await v.openHome(); await v.observe();
    for (let i = 0; i < N; i++) {
      await L.sleep(Math.random() * 3000);
      const port = L.nextPort(), repo = REPOS[i % REPOS.length];
      const s = L.serve('node', [L.FX + '/titled.js', String(port), `Trial ${i + 1}`], { cwd: L.repo(repo), tag: 'a' + i });
      await L.waitListen(s, port);
      const add = await L.waitFor(async () => (await v.rec()).chips.find(c => c.port === port && c.kind === 'add'), 20e3, 25);
      await L.sleep(Math.random() * 3000);
      const killAt = Date.now(); L.kill(s);
      const rm = await L.waitFor(async () => (await v.rec()).chips.find(c => c.port === port && c.kind === 'remove'), 20e3, 25);
      const t = { i: i + 1, port, repo, listenAt: s.listenAt, chipAt: add?.r.at ?? null, killAt, exitAt: s.exitAt, goneAt: rm?.r.at ?? null, load: L.load() };
      t.showMs = t.chipAt && t.chipAt - t.listenAt; t.goneMs = t.goneAt && t.goneAt - killAt; t.goneAfterExitMs = t.goneAt && s.exitAt && t.goneAt - s.exitAt;
      out.trials.push(t); console.log(JSON.stringify(t));
    }
    const ok = out.trials.filter(t => t.showMs != null && t.goneMs != null);
    out.show = L.stats(ok.map(t => t.showMs)); out.gone = L.stats(ok.map(t => t.goneMs));
    out.uptimeEnd = L.uptime();
  } finally { out.fixtures = await L.stopAll(); out.close = await v.close(); fs.writeFileSync(L.OUT + '/' + (process.argv[3] || 'a-timing') + '.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify({ show: out.show, gone: out.gone, up0: out.uptimeStart, up1: out.uptimeEnd })); }
})().catch(e => { console.error(e); process.exit(1); });
