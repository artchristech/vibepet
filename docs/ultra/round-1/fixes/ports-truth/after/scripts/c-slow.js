// (c) a server that answers only 20 s after it starts listening (a first compile): title + Open ≤5 s after it answers.
// n slow servers (default 10), started at random moments U(0,6 s) in fleet repos; Home open with the full list unfolded.
const L = require('./rlib'), fs = require('fs');
const N = +(process.argv[2] || 10), REPOS = ['vibepet', 'delta', 'kestrel', 'beacon', 'atlas'];
(async () => {
  const v = await L.start(), out = { what: 'slow.js PORT title 20000: every request waits until 20 s after start; ready = its READY_AT; active = Open no longer aria-disabled', startedAt: new Date().toISOString(), uptimeStart: L.uptime(), trials: [] };
  try {
    await v.openHome(); await v.observe();
    const S = [];
    for (let i = 0; i < N; i++) { await L.sleep(Math.random() * 600); const port = L.nextPort(); S.push({ port, s: L.serve('node', [L.FX + '/slow.js', String(port), `Compiled app ${i + 1}`, '20000'], { cwd: L.repo(REPOS[i % REPOS.length]), tag: 'slow' + i }) }); }
    for (const x of S) await L.waitListen(x.s, x.port);
    // unfold once the list has outgrown Home's six chips
    await L.waitFor(async () => { const m = await v.more(); if (m && /more/.test(m)) await v.win.locator('#now .srvmore').click().catch(() => {}); return (await v.chips()).filter(c => S.some(x => x.port === c.port)).length >= N; }, 20e3, 200);
    await L.sleep(500); await v.shotFoot('c-1-slow-servers-waiting');
    // also when main's snapshot first has each answering (what its chip shows): the pet window losing focus to another app closes
    // Home and freezes the chips; then Home is opened again and that is noted
    const mainAt = {}; out.reopened = [];
    const done = await L.waitFor(async () => {
      if (!(await v.homeMode())) { out.reopened.push(Date.now()); await v.openHome().catch(() => {}); }
      const sv = (await v.snap()).servers, t = Date.now(); for (const x of S) if (!mainAt[x.port] && sv.some(s => s.port === x.port && s.http)) mainAt[x.port] = t;
      const r = await v.rec(); return S.every(x => r.chips.some(c => c.port === x.port && c.kind === 'active')) && r; }, 60e3, 100);
    const rec = done ? done.r : await v.rec();
    for (const x of S) { const a = rec.chips.find(c => c.port === x.port && c.kind === 'active'), add = rec.chips.find(c => c.port === x.port && c.kind === 'add');
      out.trials.push({ port: x.port, listenAt: x.s.listenAt, readyAt: x.s.readyAt, firstShownInactive: add ? !add.on : null, activeAt: a?.at ?? null, msAfterReady: a ? a.at - x.s.readyAt : null,
        mainHttpAt: mainAt[x.port] ?? null, mainMsAfterReady: mainAt[x.port] ? mainAt[x.port] - x.s.readyAt : null }); }
    await v.shotFoot('c-2-slow-servers-answered');
    out.chips = (await v.chips()).filter(c => S.some(x => x.port === c.port)).map(c => c.label + (c.inactive ? ' [inactive]' : ''));
    const ok = out.trials.filter(t => t.msAfterReady != null);
    out.afterReady = L.stats(ok.map(t => t.msAfterReady)); out.mainAfterReady = L.stats(out.trials.filter(t => t.mainMsAfterReady != null).map(t => t.mainMsAfterReady)); out.uptimeEnd = L.uptime();
  } finally { out.fixtures = await L.stopAll(); out.close = await v.close(); fs.writeFileSync(L.OUT + '/c-slow.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify({ afterReady: out.afterReady, mainAfterReady: out.mainAfterReady, reopened: out.reopened?.length, firstInactive: out.trials.map(t => t.firstShownInactive), up0: out.uptimeStart, up1: out.uptimeEnd })); }
})().catch(e => { console.error(e); process.exit(1); });
