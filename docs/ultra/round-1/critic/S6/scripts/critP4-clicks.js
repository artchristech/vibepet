// S6 critic, P4 (r1-S6-13): N human-speed presses (150 ms) on a chip's Open at random moments; count the opens.
const C = require('./clib'); const fs = require('fs'), path = require('path');
const N = +(process.argv[2] || 60), TAG = process.argv[3] || 'a', PORT = 47451 + (TAG === 'b' ? 1 : 0);
const R = { flow: 'P4', run: TAG, startedAt: C.iso(), load: [C.load()], clicks: [] };
(async () => {
  let v;
  const ensureHome = async () => { for (let k = 0; k < 4 && !(await v.homeMode()); k++) { R.homeReopened = (R.homeReopened || 0) + 1; try { await v.openHome({ timeout: 3000 }); } catch { await C.sleep(1000); } } };
  try {
    R.truthStart = C.truthLine(C.fleetStatus());
    v = await C.start({ fresh: true });
    await v.openHome();
    const s = C.serve('node', [C.OUT + '/scripts/fx/titled.js', String(PORT), 'Click target'], { cwd: C.FLEET + '/delta', tag: 'target' });
    await C.waitListen(s, PORT);
    await C.waitFor(async () => (await v.chips()).some(c => c.port === PORT && !c.disabled), 30e3, 100);
    for (let i = 0; i < N; i++) {
      await ensureHome();
      await C.sleep(300 + Math.random() * 1200);
      const box = await v.win.evaluate(p => { const b = document.querySelector(`#now .srv[data-port="${p}"] [data-do=open]`); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, PORT);
      if (!box) { R.clicks.push({ i, skipped: 'no chip' }); continue; }
      const t0 = Date.now();
      await v.win.mouse.move(box.x, box.y); const td = Date.now(); await v.win.mouse.down(); await C.sleep(150); await v.win.mouse.up(); const tu = Date.now();
      const got = await C.waitFor(async () => (await v.calls(t0)).find(c => c.kind === 'openExternal'), 1200, 40);
      const ticks = (await v.calls(td - 50)).filter(c => c.kind === 'tick' && c.at <= tu).map(c => c.at - td);
      R.clicks.push({ i, opened: !!got, downToUp: tu - td, tickDuringPress: ticks.filter(x => x >= -5 && x <= tu - td), load: C.load() });
      await C.sleep(150);
    }
    const done = R.clicks.filter(c => !c.skipped);
    R.summary = { n: done.length, opened: done.filter(c => c.opened).length, lost: done.filter(c => !c.opened).length,
      lostWithTickDuringPress: done.filter(c => !c.opened && c.tickDuringPress.length).length, openedWithTickDuringPress: done.filter(c => c.opened && c.tickDuringPress.length).length, homeReopened: R.homeReopened || 0 };
    console.log(JSON.stringify(R.summary));
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { R.error = String(e.stack || e).slice(0, 1500); console.log(R.error); }
  finally {
    await C.stopAll();
    if (v) { try { R.close = await v.close(); } catch (e) { R.closeError = String(e).slice(0, 300); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', `critP4-clicks-${TAG}.json`), JSON.stringify(R, null, 1));
  }
})();
