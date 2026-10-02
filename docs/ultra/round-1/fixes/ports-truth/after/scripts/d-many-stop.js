// (d) 10 servers all reachable from Home ('+N more'); a prefork server (master + 3 workers) is one chip and Stop ends it (port
// free, no respawn); Stop on a stale chip → 'That server had already stopped' and the chip goes; Stop from the Localhost menu and
// an external kill each produce a line at the default alert level. Writes ../d-many-stop.json + shots.
const L = require('./rlib'), fs = require('fs');
const { execFileSync } = require('child_process');
const groupAlive = pgid => execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8' }).split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(c => c[1] === pgid).map(c => c[0]);
(async () => {
  const v = await L.start(), out = { startedAt: new Date().toISOString(), uptimeStart: L.uptime() };
  try {
    await v.openHome(); await v.observe();
    out.alerts = (await v.snap()).alerts;
    // ten servers: a prefork one, a node app with its debugger port (two ports, one process), a raw TCP listener, six titled pages
    const P = { pre: L.nextPort(), app: L.nextPort(), dbg: L.nextPort(), tcp: L.nextPort() }, S = {};
    S.pre = L.serve('python3', [L.FX + '/prefork.py', String(P.pre), 'Prefork app', '3'], { cwd: L.repo('vibepet'), tag: 'pre' });
    S.app = L.serve('node', [`--inspect=127.0.0.1:${P.dbg}`, L.FX + '/titled.js', String(P.app), 'Inspected app'], { cwd: L.repo('vibepet'), tag: 'app' });
    S.tcp = L.serve('node', [L.FX + '/tcp.js', String(P.tcp)], { cwd: L.repo('kestrel'), tag: 'tcp' });
    ['delta', 'kestrel', 'beacon', 'atlas', 'ember', 'vibepet'].forEach((r, i) => { const p = P['t' + i] = L.nextPort(); S['t' + i] = L.serve('node', [L.FX + '/titled.js', String(p), `${r} page ${i + 1}`], { cwd: L.repo(r), tag: 't' + i }); });
    for (const k of Object.keys(S)) await L.waitListen(S[k], P[k]);
    const all = Object.values(P);
    const shown = await L.waitFor(async () => { const s = (await v.snap()).servers; return all.every(p => s.some(x => x.port === p)) && s; }, 30e3);
    await L.sleep(400);
    out.snapCount = shown?.r.length; out.folded = { chips: (await v.chips()).map(c => c.label), more: await v.more() };
    await v.shotTo('d-1-ten-folded'); await v.shotFoot('d-1-footer-folded');
    await v.win.locator('#now .srvmore').click();
    await L.sleep(300);
    const open = await v.chips();
    out.expanded = { chips: open.map(c => c.label + (c.inactive ? ` [inactive: ${c.title}]` : '')), allReachable: all.every(p => open.some(c => c.port === p)), more: await v.more() };
    await v.shotTo('d-2-ten-expanded'); await v.shotFoot('d-2-footer-expanded');
    // prefork: one chip; ✕ → the dialog names its port; the group ends; nothing respawns
    const preChips = open.filter(c => c.port === P.pre), preSnap = (await v.snap()).servers.find(s => s.port === P.pre);
    out.prefork = { chips: preChips.map(c => c.label), pgid: S.pre.pid, groupBefore: groupAlive(S.pre.pid).length };
    let t0 = Date.now();
    await v.win.locator(`#now .srv[data-key="${preChips[0].key}"] button[data-do=stop]`).click();
    const note = await L.waitFor(async () => (await v.rec()).notes.find(n => n.at >= t0 && /Stopped|stop/.test(n.text)), 10e3);
    out.prefork.dialog = (await v.calls(t0)).find(c => c.kind === 'dialog');
    out.prefork.note = note?.r.text; out.prefork.noteMs = note ? note.r.at - t0 : null;
    await L.sleep(1500);
    out.prefork.after = { portListeners: L.listening(P.pre).length, groupLeft: groupAlive(S.pre.pid), respawnLines: (S.pre.out.match(/RESPAWN/g) || []).length, chipStill: (await v.chips()).some(c => c.port === P.pre) };
    await v.shotTo('d-3-prefork-stopped');
    // the debugger chip: its dialog names both ports; both chips go
    const dbgChip = (await v.chips()).find(c => c.port === P.dbg);
    out.debugger = { chip: dbgChip?.label, appChip: (await v.chips()).find(c => c.port === P.app)?.label };
    t0 = Date.now();
    await v.win.locator(`#now .srv[data-key="${dbgChip.key}"] button[data-do=stop]`).click();
    const dn = await L.waitFor(async () => (await v.rec()).notes.find(n => n.at >= t0), 10e3);
    out.debugger.dialog = (await v.calls(t0)).find(c => c.kind === 'dialog');
    out.debugger.note = dn?.r.text;
    await L.sleep(800);
    out.debugger.after = { chips: (await v.chips()).filter(c => c.port === P.dbg || c.port === P.app).map(c => c.label), listeners: L.listening(P.app).length + L.listening(P.dbg).length };
    // stale chip: the server dies (SIGKILL), ✕ pressed right after; no dialog, the truth, the chip goes
    out.stale = [];
    for (let i = 0; i < 6 && out.stale.filter(x => x.landedStale).length < 3; i++) {
      const port = L.nextPort(), s = L.serve('node', [L.FX + '/titled.js', String(port), 'Soon gone'], { cwd: L.repo('delta'), tag: 'stale' + i });
      await L.waitListen(s, port);
      const c = (await L.waitFor(async () => (await v.chips()).find(x => x.port === port && !x.inactive), 15e3))?.r;
      await L.sleep(1100 + Math.random() * 400);   // just after a netstat beat, so the chip is still up when ✕ lands
      t0 = Date.now(); L.kill(s, 'SIGKILL');
      const clicked = await v.win.locator(`#now .srv[data-key="${c.key}"] button[data-do=stop]`).click({ timeout: 800 }).then(() => Date.now(), () => null);
      const n = clicked && await L.waitFor(async () => (await v.rec()).notes.find(x => x.at >= t0), 6000);
      const gone = await L.waitFor(async () => (await v.rec()).chips.find(x => x.port === port && x.kind === 'remove'), 6000);
      const calls = await v.calls(t0);
      out.stale.push({ port, killAt: t0, clickAt: clicked, landedStale: !!(clicked && s.exitAt && clicked >= s.exitAt && (!gone || gone.r.at > clicked)), note: n?.r.text ?? null, dialog: calls.some(x => x.kind === 'dialog'), chipGoneMsAfterKill: gone ? gone.r.at - t0 : null });
      if (i === 0) await v.shotTo('d-4-stale-stop');
    }
    // Localhost menu → Stop, at the default alert level: a line reaches the pet
    { const port = L.nextPort(), s = L.serve('node', [L.FX + '/titled.js', String(port), 'Menu target'], { cwd: L.repo('beacon'), tag: 'menu' });
      await L.waitListen(s, port); await L.waitFor(async () => (await v.chips()).find(x => x.port === port && !x.inactive), 15e3);
      t0 = Date.now(); await v.win.locator('#homeMore').click();
      await L.waitFor(async () => (await v.calls(t0)).find(x => x.kind === 'menuPopup'), 5000);
      const menuLocal = (await v.menuData()).find(i => /^Localhost/.test(i.label || ''));
      const clicked = await v.clickMenu(['^Localhost', `^:${port} `, '^Stop ']);
      const ev = await L.waitFor(async () => (await v.calls(t0)).find(x => x.kind === 'event' && x.data.kind === 'localhost'), 8000);
      out.menuStop = { alerts: (await v.snap()).alerts, clicked, menuEntry: menuLocal?.sub?.find(i => (i.label || '').startsWith(':' + port))?.sub?.map(i => [i.label, i.enabled]), dialog: (await v.calls(t0)).find(x => x.kind === 'dialog'), event: ev?.r.data ?? null, exited: s.exitAt != null }; }
    // a server killed from outside, at the default alert level: one quiet line
    { const port = L.nextPort(), s = L.serve('node', [L.FX + '/titled.js', String(port), 'Crashy app'], { cwd: L.repo('kestrel'), tag: 'crash' });
      await L.waitListen(s, port); await L.waitFor(async () => (await v.chips()).find(x => x.port === port && !x.inactive), 15e3);
      t0 = Date.now(); L.kill(s);
      const ev = await L.waitFor(async () => (await v.calls(t0)).find(x => x.kind === 'event' && x.data.kind === 'localhost'), 8000);
      out.externalKill = { alerts: (await v.snap()).alerts, event: ev?.r.data ?? null, msAfterKill: ev ? ev.r.at - t0 : null }; }
    await v.shotTo('d-5-after-menu-and-kill');
    out.ports = P; out.uptimeEnd = L.uptime();
  } finally { out.fixtures = await L.stopAll(); out.close = await v.close(); fs.writeFileSync(L.OUT + '/d-many-stop.json', JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ folded: out.folded, expanded: out.expanded, prefork: out.prefork, debugger: out.debugger, stale: out.stale, menuStop: out.menuStop, externalKill: out.externalKill }, null, 1)); }
})().catch(e => { console.error(e); process.exit(1); });
