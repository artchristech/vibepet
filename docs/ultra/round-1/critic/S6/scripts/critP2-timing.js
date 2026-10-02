// S6 critic, P2 (r1-S6-04): listen → chip rendered, exit → chip gone, at random moments; the app's refresh interval.
const C = require('./clib'); const fs = require('fs'), path = require('path');
const N = +(process.argv[2] || 10), TAG = process.argv[3] || 'a';
const REPOS = [C.FLEET + '/delta', C.FLEET + '/atlas'], FX = C.OUT + '/scripts/fx';
const R = { flow: 'P2', run: TAG, startedAt: C.iso(), load: [C.load()], trials: [], refresh: [] };
const log = x => { console.log(JSON.stringify(x)); };
(async () => {
  let v, sampling = true;
  const ensureHome = async () => { for (let k = 0; k < 4 && !(await v.homeMode()); k++) { R.homeReopened = (R.homeReopened || 0) + 1; try { await v.openHome({ timeout: 3000 }); } catch (e) { R.homeOpenFail = (R.homeOpenFail || 0) + 1; await C.sleep(1000); } } };
  try {
    R.truthStart = C.truthLine(C.fleetStatus());
    v = await C.start({ fresh: true });
    await v.openHome();
    // refresh clock: the ports cache's `at` as main sees it
    const ats = new Set(); (async () => { while (sampling) { try { const a = (await v.cache()).at; if (a && !ats.has(a)) { ats.add(a); R.refresh.push(a); } } catch {} await C.sleep(150); } })();
    await C.sleep(4000);
    for (let i = 0; i < N; i++) {
      const port = 47410 + i + (TAG === 'b' ? 20 : 0), cwd = REPOS[i % 2];
      await C.sleep(Math.random() * 12e3);
      await ensureHome();
      const s = i % 2 ? C.serve('python3', [FX + '/page.py', String(port), '0.0.0.0', 'trial ' + i], { cwd, tag: 'trial' + i })
                      : C.serve('node', [FX + '/titled.js', String(port), 'trial ' + i], { cwd, tag: 'trial' + i });
      await C.waitListen(s, port);
      const shown = await C.waitFor(async () => (await v.chips()).some(c => c.port === port), 40e3, 50);
      const tShown = Date.now(); const homeOpenAtShow = !!(await v.homeMode());
      const tick = (await v.calls(s.listenAt)).find(c => c.kind === 'tick' && c.servers.some(x => x.startsWith(port + ':')));
      await C.sleep(Math.random() * 12e3);
      await ensureHome();
      C.kill(s); const ex = await C.waitFor(() => s.exitAt, 5e3, 10);
      const gone = await C.waitFor(async () => !(await v.chips()).some(c => c.port === port), 40e3, 50);
      const homeOpenAtGone = !!(await v.homeMode());
      const tickGone = (await v.calls(s.exitAt)).find(c => c.kind === 'tick' && !c.servers.some(x => x.startsWith(port + ':')));
      const t = { i, port, kind: i % 2 ? 'python' : 'node', repo: path.basename(cwd), listenAt: s.listenAt, startMs: shown ? tShown - s.listenAt : null, exitAt: s.exitAt, stopMs: gone ? Date.now() - s.exitAt : null, homeOpenAtShow, homeOpenAtGone, tickStartMs: tick ? tick.at - s.listenAt : null, tickStopMs: tickGone ? tickGone.at - s.exitAt : null, load: C.load() };
      if (!homeOpenAtShow || !homeOpenAtGone) t.invalid = 'Home closed during the trial';
      R.trials.push(t); log(t);
    }
    sampling = false; await C.sleep(300);
    const iv = R.refresh.slice(1).map((a, k) => a - R.refresh[k]);
    const ok = R.trials.filter(t => !t.invalid && t.startMs != null && t.stopMs != null);
    R.summary = { n: ok.length, invalid: R.trials.length - ok.length, startMedian: C.median(ok.map(t => t.startMs)), startMin: Math.min(...ok.map(t => t.startMs)), startMax: Math.max(...ok.map(t => t.startMs)),
      stopMedian: C.median(ok.map(t => t.stopMs)), stopMin: Math.min(...ok.map(t => t.stopMs)), stopMax: Math.max(...ok.map(t => t.stopMs)),
      tickStartMedian: C.median(R.trials.map(t => t.tickStartMs).filter(x => x != null)), tickStopMedian: C.median(R.trials.map(t => t.tickStopMs).filter(x => x != null)), homeReopened: R.homeReopened || 0,
      refreshMedian: C.median(iv), refreshMin: Math.min(...iv), refreshMax: Math.max(...iv), refreshN: iv.length };
    log(R.summary);
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { R.error = String(e.stack || e).slice(0, 1500); log(R.error); }
  finally {
    sampling = false; await C.stopAll();
    if (v) { try { R.close = await v.close(); } catch (e) { R.closeError = String(e).slice(0, 300); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', `critP2-timing-${TAG}.json`), JSON.stringify(R, null, 1));
  }
})();
