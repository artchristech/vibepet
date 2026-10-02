// S6 critic, P3: Stop feedback and its visibility (05, 09, 10, 16, 18), rows next to chips (14, 15), the fold (06).
const C = require('./clib'); const fs = require('fs'), path = require('path');
const FX = C.OUT + '/scripts/fx', DL = C.FLEET + '/delta', AT = C.FLEET + '/atlas', EM = C.FLEET + '/ember', BC = C.FLEET + '/beacon';
const R = { flow: 'P3', startedAt: C.iso(), load: [C.load()], steps: [] };
const step = (name, data) => { const x = { name, at: C.iso(), load: C.load(), ...data }; R.steps.push(x); console.log(JSON.stringify(x).slice(0, 1300)); return x; };
const evs = async (v, t) => (await v.calls(t)).filter(c => c.kind === 'event').map(c => ({ ms: c.at - t, ...c.data }));
const dlgs = async (v, t) => (await v.calls(t)).filter(c => c.kind === 'dialog').map(c => ({ ms: c.at - t, message: c.message, detail: c.detail, defaultId: c.defaultId }));
async function clickTry(v, sel, kind, since, tries = 3) { for (let i = 0; i < tries; i++) { await v.win.click(sel, { timeout: 3000 }); const c = await C.waitFor(async () => (await v.calls(since)).find(x => x.kind === kind), 1500, 50); if (c) return { call: c.r, tries: i + 1 }; } return { call: null, tries }; }
const cmd = async (v, text) => { await v.win.fill('#chatInput', text); await v.win.press('#chatInput', 'Enter'); };
const notes = v => v.win.evaluate(() => [...document.querySelectorAll('#msgs .note, #chat .note')].map(e => e.innerText).slice(-6));
(async () => {
  let v;
  const ensureHome = async () => { for (let k = 0; k < 4 && !(await v.homeMode()); k++) { try { await v.openHome({ timeout: 3000 }); } catch { await C.sleep(1000); } } };
  try {
    R.truthStart = C.truthLine(C.fleetStatus());
    v = await C.start({ fresh: true });
    await v.openHome();
    const X = C.serve('node', [FX + '/titled.js', '47441', 'X app'], { cwd: DL, tag: 'X' });
    const Y = C.serve('python3', ['-u', '-m', 'http.server', '47442'], { cwd: AT, tag: 'Y' });
    const W = C.serve('node', [FX + '/titled.js', '47444', 'W app'], { cwd: EM, tag: 'W' });
    const B = C.serve('python3', ['-u', '-m', 'http.server', '47445'], { cwd: BC, tag: 'B-beacon' });
    for (const [s, p] of [[X, 47441], [Y, 47442], [W, 47444], [B, 47445]]) await C.waitListen(s, p);
    const all = await C.waitFor(async () => { const c = await v.chips(); return [47441, 47442, 47444, 47445].every(p => c.some(x => x.port === p)) ? c : null; }, 30e3, 200);
    await C.sleep(300);
    const truth = C.truthLine(C.fleetStatus());
    const geo = await v.win.evaluate(() => { const n = document.querySelector('#now'), s = n.querySelector('.srvs'); const nr = n.getBoundingClientRect(), sr = s && s.getBoundingClientRect();
      return { fresh: document.getElementById('chat').classList.contains('fresh'), nowH: n.clientHeight, nowScrollH: n.scrollHeight, rows: n.querySelectorAll('.nr').length, srvsInView: sr ? sr.top >= nr.top && sr.bottom <= nr.bottom : null }; });
    step('rows-vs-chips', { rows: await v.rows(), nowText: (await v.nowText()).slice(0, 300), chips: all && all.r, truth, fold: geo, snapAgents: (await v.snap()).agents });
    await v.snapShot('p3-01-rows-vs-chips');
    C.kill(B);   // beacon's repo: keep it short
    // ---- 05/16: ✕ → Stop on X with Home open
    let t = Date.now(); const rx = await clickTry(v, '#now .srv[data-port="47441"] [data-do=stop]', 'dialog', t);
    const dead = await C.waitFor(() => X.exitAt, 5e3, 10); await C.sleep(400);
    step('05-stop-X', { dialog: rx.call && { message: rx.call.message, detail: rx.call.detail, defaultId: rx.call.defaultId }, xDeadMs: dead && X.exitAt - t, events: await evs(v, t), bubble: await v.bubble(), notes: await notes(v) });
    await v.snapShot('p3-02-after-stop-bubble-behind-panel');
    const goneX = await C.waitFor(async () => !(await v.chips()).some(c => c.port === 47441), 20e3, 50);
    step('05-chip-gone', { msAfterClick: goneX && Date.now() - t });
    // ---- 09: the server exits on its own; ✕ on its still-listed chip
    const Z = C.serve('node', [FX + '/titled.js', '47443', 'Z app', '-', '--exit-after', '1000000'], { cwd: DL, tag: 'Z' });
    await C.waitListen(Z, 47443);
    await C.waitFor(async () => (await v.chips()).some(c => c.port === 47443), 30e3, 100);
    // let it exit right after a refresh, so the stale window is long
    const at0 = (await v.cache()).at; await C.waitFor(async () => (await v.cache()).at !== at0, 20e3, 50); await C.sleep(3500);
    C.kill(Z); await C.waitFor(() => Z.exitAt, 3e3, 10); const zExit = Z.exitAt; await C.sleep(300);
    const zChip = (await v.chips()).find(c => c.port === 47443);
    t = Date.now(); const rz = await clickTry(v, '#now .srv[data-port="47443"] [data-do=stop]', 'dialog', t);
    await C.sleep(600);
    step('09-stop-dead', { chipStillListedMsAfterExit: zChip ? t - zExit : null, chipStillEnabled: zChip && !zChip.disabled, dialog: rz.call && { message: rz.call.message, detail: rz.call.detail }, events: await evs(v, t), bubble: await v.bubble() });
    await v.snapShot('p3-03-stop-on-dead-server');
    const goneZ = await C.waitFor(async () => !(await v.chips()).some(c => c.port === 47443), 20e3, 50);
    step('09-stale-window', { chipGoneMsAfterExit: goneZ && Date.now() - zExit });
    // ---- 18: /stop with no port
    await ensureHome();
    t = Date.now(); await cmd(v, '/stop'); await C.sleep(700);
    const n18 = await notes(v);
    await cmd(v, '/stop 47999'); await C.sleep(700);
    step('18-stop-noarg', { notes: await notes(v), firstNote: n18.slice(-1)[0] });
    await v.snapShot('p3-04-stop-no-arg');
    // ---- 05/16 via /stop <port>
    t = Date.now(); await cmd(v, '/stop 47442'); const dy = await C.waitFor(async () => (await v.calls(t)).find(c => c.kind === 'dialog'), 5e3, 50);
    await C.waitFor(() => Y.exitAt, 5e3, 10); await C.sleep(400);
    step('05-stop-cmd', { dialog: dy && { message: dy.r.message, detail: dy.r.detail }, events: await evs(v, t), bubble: await v.bubble() });
    await v.snapShot('p3-05-after-stop-command');
    // ---- 10: ⋯ → Localhost → Stop at the default alert level
    await ensureHome();
    t = Date.now(); await v.win.click('#homeMore'); await C.sleep(400);
    const cm = await v.clickMenu(['^Localhost', '^:47444', '^Stop']);
    await C.waitFor(() => W.exitAt, 5e3, 10); await C.sleep(1500);
    step('10-menu-stop', { alerts: (await v.snap()).alerts, click: cm, wDeadMs: W.exitAt && W.exitAt - t, dialogs: await dlgs(v, t), events: await evs(v, t), bubble: await v.bubble(), notes: await notes(v) });
    await v.snapShot('p3-06-menu-stop-no-feedback');
    // ---- 10: a listed server exits on its own at the default alert level
    const V = C.serve('node', [FX + '/titled.js', '47446', 'V app'], { cwd: DL, tag: 'V' }); await C.waitListen(V, 47446);
    await C.waitFor(async () => (await v.chips()).some(c => c.port === 47446), 30e3, 100);
    t = Date.now(); C.kill(V);
    const goneV = await C.waitFor(async () => !(await v.chips()).some(c => c.port === 47446), 20e3, 50); await C.sleep(3500);
    step('10-exit-default', { goneMs: goneV && goneV.ms, events: await evs(v, t), bubble: await v.bubble() });
    // ---- 05: alerts = Everything (the Setup card's own IPC), server up/down with Home open
    await v.win.evaluate(() => window.pet.setPrefs({ alerts: 'all' })); await C.sleep(3500);
    await ensureHome();
    t = Date.now(); const U = C.serve('node', [FX + '/titled.js', '47447', 'U app'], { cwd: DL, tag: 'U' }); await C.waitListen(U, 47447);
    const up = await C.waitFor(async () => (await evs(v, t)).find(e => /is up/.test(e.text || '')), 30e3, 100);
    const bUp = await v.bubble();
    await v.snapShot('p3-07-announce-up-home-open');
    await C.sleep(2000); const t2 = Date.now(); C.kill(U);
    const down = await C.waitFor(async () => (await evs(v, t2)).find(e => /went down/.test(e.text || '')), 30e3, 100);
    const bDown = await v.bubble();
    await v.snapShot('p3-08-announce-down-home-open');
    step('05-announce-all', { alerts: (await v.snap()).alerts, up: up && up.r, upMsAfterListen: up && up.r.ms - (U.listenAt - t), bubbleUp: bUp, down: down && down.r, downMsAfterExit: down && down.r.ms - (U.exitAt - t2), bubbleDown: bDown });
    // the same with Home closed (control): is the bubble visible then?
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { step('error', { e: String(e.stack || e).slice(0, 1500) }); }
  finally {
    await C.stopAll();
    R.servers = C.mine.map(s => ({ tag: s.tag, cwd: s.cwd, pid: s.pid, listenAt: s.listenAt, exitAt: s.exitAt, code: s.code, sig: s.sig }));
    if (v) { try { step('close', await v.close()); } catch (e) { step('close-error', { e: String(e).slice(0, 300) }); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', 'critP3-stop.json'), JSON.stringify(R, null, 1));
  }
})();
