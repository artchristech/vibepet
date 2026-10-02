// (e) `/stop <port>` typed in Home: chip gone and a panel note ≤1 s after the process exits. n trials (default 10).
const L = require('./rlib'), fs = require('fs');
const N = +(process.argv[2] || 10), REPOS = ['vibepet', 'delta', 'kestrel', 'beacon', 'atlas'];
(async () => {
  const v = await L.start(), out = { what: '/stop <port> typed in the command bar (dialog answered Stop by the harness): exit → chip gone, exit → note', startedAt: new Date().toISOString(), uptimeStart: L.uptime(), trials: [] };
  try {
    await v.openHome(); await v.observe();
    for (let i = 0; i < N; i++) {
      const port = L.nextPort(), s = L.serve('node', [L.FX + '/titled.js', String(port), `Stop me ${i + 1}`], { cwd: L.repo(REPOS[i % REPOS.length]), tag: 'e' + i });
      await L.waitListen(s, port);
      await L.waitFor(async () => (await v.chips()).find(x => x.port === port && !x.inactive), 15e3);
      await L.sleep(Math.random() * 1500);
      const t0 = Date.now();
      await v.win.locator('#chatInput').fill(`/stop ${port}`);
      await v.win.locator('#chatInput').press('Enter');
      // the Stop plans twice (lsof + ps) before it signals: on a loaded Mac the exit can come many seconds after Enter, so wait for the
      // note, then read the chip's removal off the renderer's own record (timed when it happened, whenever we look)
      const note = await L.waitFor(async () => (await v.rec()).notes.find(x => x.at >= t0 && x.text.includes(':' + port)), 30e3, 20);
      await L.waitFor(async () => (await v.rec()).chips.find(x => x.port === port && x.kind === 'remove' && x.at >= t0), 3000, 20);
      const gone = (await v.rec()).chips.find(x => x.port === port && x.kind === 'remove' && x.at >= t0);
      const t = { i: i + 1, port, enterAt: t0, exitAt: s.exitAt, goneAt: gone?.at ?? null, noteAt: note?.r.at ?? null, note: note?.r.text ?? null, load: L.load() };
      t.goneAfterExitMs = t.goneAt && t.exitAt && t.goneAt - t.exitAt; t.noteAfterExitMs = t.noteAt && t.exitAt && t.noteAt - t.exitAt; t.exitAfterEnterMs = t.exitAt && t.exitAt - t0;
      out.trials.push(t); console.log(JSON.stringify(t));
      if (i === 0) await v.shotTo('e-1-stop-command-note');
    }
    const ok = out.trials.filter(t => t.goneAfterExitMs != null && t.noteAfterExitMs != null);
    out.chipGone = L.stats(ok.map(t => t.goneAfterExitMs)); out.note = L.stats(ok.map(t => t.noteAfterExitMs)); out.uptimeEnd = L.uptime();
  } finally { out.fixtures = await L.stopAll(); out.close = await v.close(); fs.writeFileSync(L.OUT + '/' + (process.argv[3] || 'e-stop-cmd') + '.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify({ chipGone: out.chipGone, note: out.note, up0: out.uptimeStart, up1: out.uptimeEnd })); }
})().catch(e => { console.error(e); process.exit(1); });
