// S6 critic, P1: labels/attribution (01), bind address + scheme (02), compiling server (03), disabled style (17),
// prefork + debugger port (08), cap of 8 (07). Fresh app, isolated fleet root, servers with a fleet repo as cwd.
const C = require('./clib'); const fs = require('fs'), path = require('path'), http = require('http'); const { execFileSync } = require('child_process');
const SP = '/private/tmp/claude-501/-Users-christopherharris-projects/2aec191f-bd46-4d22-b2da-e8c859fd18a3/scratchpad';
const VP = C.FLEET + '/vibepet', DL = C.FLEET + '/delta', FX = C.OUT + '/scripts/fx';
const R = { flow: 'P1', startedAt: C.iso(), load: [C.load()], steps: [] };
const step = (name, data) => { const x = { name, at: C.iso(), load: C.load(), ...data }; R.steps.push(x); console.log(JSON.stringify(x).slice(0, 1200)); return x; };
const get = (host, port, proto = 'http') => new Promise(res => { const mod = proto === 'https' ? require('https') : http;
  const q = mod.get({ host, port, path: '/', timeout: 3000, rejectUnauthorized: false }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res({ status: r.statusCode, title: (s.match(/<title>([^<]*)/) || [])[1] })); });
  q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', e => res({ error: e.code || e.message })); });
const curl = url => { try { return execFileSync('curl', ['-sk', '--max-time', '3', url], { encoding: 'utf8' }).match(/<title>([^<]*)/)?.[1] || '(no title)'; } catch (e) { return 'curl error ' + e.status; } };
const lsofPort = p => C.listening(p).filter(l => l[0] === 'p' || l[0] === 'n');
async function chipsFor(v, ports, ms = 30e3) { return C.waitFor(async () => { const c = await v.chips(); return ports.every(p => c.some(x => x.port === p)) ? c : null; }, ms, 200); }
async function clickTry(v, sel, kind, since, tries = 3) { for (let i = 0; i < tries; i++) { await v.win.click(sel); const c = await C.waitFor(async () => (await v.calls(since)).find(x => x.kind === kind), 1500, 50); if (c) return { call: c.r, tries: i + 1 }; } return { call: null, tries }; }
(async () => {
  let v;
  try {
    R.truthStart = C.truthLine(C.fleetStatus());
    v = await C.start({ fresh: true });
    const h = await v.openHome(); step('home', { mode: h.mode, rows: await v.rows(), chips: await v.chips() });
    await v.snapShot('p1-00-home');
    // ---- 01: labels and attribution
    const a = C.serve('python3', ['-u', '-m', 'http.server', '47302'], { cwd: VP, tag: 'py-vibepet' });
    const b = C.serve('node', [FX + '/titled.js', '47353', 'Vite + React + TS'], { cwd: VP, tag: 'vite-vibepet' });
    const c = C.serve('node', [FX + '/titled.js', '47354', 'Vite + React + TS'], { cwd: DL, tag: 'vite-delta' });
    for (const [s, p] of [[a, 47302], [b, 47353], [c, 47354]]) await C.waitListen(s, p);
    const ch1 = await chipsFor(v, [47302, 47353, 47354]);
    step('01-chips', { chips: ch1 && ch1.r, cache: (await v.cache()).servers.filter(s => [47302, 47353, 47354].includes(s.port)), snapServers: (await v.snap()).servers });
    await v.snapShot('p1-01-labels-two-repos');
    for (const s of [a, b, c]) C.kill(s);
    // ---- 02: [::1]-only, shared port, HTTPS, raw TCP (17 disabled style)
    const d = C.serve('node', [FX + '/titled.js', '47381', 'Vite + React + TS', 'localhost'], { cwd: VP, tag: 'v6only' });
    const e1 = C.serve('node', [FX + '/titled.js', '47351', 'Delta dashboard'], { cwd: DL, tag: 'star-delta' });
    await C.waitListen(e1, 47351); await C.sleep(300);
    const e2 = C.serve('python3', [FX + '/page.py', '47351', '127.0.0.1', 'Vibepet status'], { cwd: VP, tag: 'v4-vibepet' });
    const f = C.serve('node', [FX + '/https.js', '47383', SP + '/s6crit-key.pem', SP + '/s6crit-cert.pem', 'Secure app'], { cwd: VP, tag: 'https' });
    const g = C.serve('node', [FX + '/tcp.js', '47364'], { cwd: VP, tag: 'tcp' });
    const ok = C.serve('node', [FX + '/titled.js', '47382', 'Next.js app', '127.0.0.1'], { cwd: VP, tag: 'enabled-ref' });
    for (const [s, p] of [[d, 47381], [e2, 47351], [f, 47383], [g, 47364], [ok, 47382]]) await C.waitListen(s, p);
    await C.sleep(500);
    step('02-binds', { l47381: lsofPort(47381), l47351: lsofPort(47351), l47383: lsofPort(47383), e2out: e2.out.slice(0, 200), e2exit: e2.exitAt });
    step('02-direct', { v6_localhost: await get('localhost', 47381), v6_127: await get('127.0.0.1', 47381), v6_curl: curl('http://localhost:47381/'),
      shared_127: await get('127.0.0.1', 47351), shared_v6: await get('::1', 47351), shared_localhost_node: await get('localhost', 47351), shared_localhost_curl: curl('http://localhost:47351/'),
      https_https: await get('127.0.0.1', 47383, 'https'), https_http: await get('127.0.0.1', 47383) });
    const ch2 = await chipsFor(v, [47381, 47351, 47383, 47364, 47382]);
    await C.sleep(3200);
    const chips2 = await v.chips();
    step('02-chips', { chips: chips2, cache: (await v.cache()).servers.filter(s => [47381, 47351, 47383, 47364, 47382].includes(s.port)) });
    // disabled vs enabled style (17)
    const sty = await v.win.evaluate(() => { const pick = p => { const b = document.querySelector(`#now .srv[data-port="${p}"] [data-do=open]`); if (!b) return null; const s = getComputedStyle(b);
      return { disabled: b.disabled, title: b.title, color: s.color, bg: s.backgroundColor, border: s.borderColor, opacity: s.opacity, cursor: s.cursor, textDecoration: s.textDecorationLine }; };
      return { v6only: pick(47381), https: pick(47383), tcp: pick(47364), enabled: pick(47382) }; });
    step('17-style', sty);
    await v.snapShot('p1-02-bind-scheme-shapes');
    // hover the disabled chip: tooltip text
    // Open on each :47351 chip (two pids)
    const t2 = Date.now(), opens = [];
    for (const s of chips2.filter(x => x.port === 47351)) {
      const since = Date.now(); const r = await clickTry(v, `#now .srv[data-pid="${s.pid}"][data-port="47351"] [data-do=open]`, 'openExternal', since);
      opens.push({ pid: s.pid, label: s.label, url: r.call && r.call.url, tries: r.tries, reaches_node: r.call ? await get('localhost', 47351) : null, reaches_curl: r.call ? curl(r.call.url) : null });
    }
    // Open on the disabled [::1] chip and the https chip: does anything happen?
    const t3 = Date.now();
    for (const p of [47381, 47383]) { try { await v.win.click(`#now .srv[data-port="${p}"] [data-do=open]`, { timeout: 1500, force: true }); } catch (e) { opens.push({ port: p, clickError: String(e.message).split('\n')[0] }); } }
    await C.sleep(800);
    step('02-opens', { opens, pids: { e1: e1.pid, e2: e2.pid }, disabledClicks: (await v.calls(t3)).filter(x => x.kind === 'openExternal') });
    for (const s of [d, e1, e2, f, g, ok]) C.kill(s);
    // ---- 03: compiling server
    const sl = C.serve('node', [FX + '/slow.js', '47385', 'Next.js app', '20000'], { cwd: VP, tag: 'slow' });
    await C.waitListen(sl, 47385); const L0 = sl.listenAt;
    const seen = await C.waitFor(async () => (await v.chips()).find(x => x.port === 47385), 30e3, 100);
    step('03-first-seen', { msAfterListen: Date.now() - L0, chip: seen && seen.r });
    const samples = [];
    while (Date.now() - L0 < 56e3) { await C.sleep(4000); const ch = (await v.chips()).find(x => x.port === 47385); samples.push({ s: +((Date.now() - L0) / 1000).toFixed(1), label: ch && ch.label, disabled: ch && ch.disabled }); }
    const direct = await get('localhost', 47385), direct4 = await get('127.0.0.1', 47385);
    // native menu: Open item for it
    const tm = Date.now(); await v.win.click('#homeMore'); await C.sleep(400);
    const m = await v.menuData(); const loc = m && m.find(i => /^Localhost/.test(i.label || '')); const item = loc && loc.sub.find(i => /^:47385/.test(i.label || ''));
    step('03-after-56s', { samples, direct, direct4, menuItem: item, cache: (await v.cache()).servers.find(s => s.port === 47385) });
    await v.snapShot('p1-03-compiling-server-56s');
    C.kill(sl);
    // ---- 08: prefork + debugger port
    const pf = C.serve('python3', [FX + '/prefork.py', '47384', 'Prefork app', '3'], { cwd: VP, tag: 'prefork' });
    const ins = C.serve('node', ['--inspect=127.0.0.1:47363', FX + '/titled.js', '47362', 'Inspected app'], { cwd: VP, tag: 'inspect' });
    await C.waitListen(pf, 47384); await C.waitListen(ins, 47362);
    await C.sleep(400);
    const ch8 = await C.waitFor(async () => { const c = await v.chips(); return c.filter(x => x.port === 47384).length >= 4 && c.some(x => x.port === 47363) ? c : null; }, 30e3, 200);
    step('08-chips', { chips: (ch8 && ch8.r) || await v.chips(), masterPid: pf.pid, inspectPid: ins.pid, l47384: lsofPort(47384), l47362: lsofPort(47362), l47363: lsofPort(47363) });
    await v.snapShot('p1-08-prefork-inspect');
    const worker = (ch8 ? ch8.r : await v.chips()).find(x => x.port === 47384 && x.pid !== pf.pid);
    const tw = Date.now();
    const rw = await clickTry(v, `#now .srv[data-pid="${worker.pid}"][data-port="47384"] [data-do=stop]`, 'dialog', tw);
    await C.sleep(1500);
    const afterW = await get('127.0.0.1', 47384);
    step('08-stop-worker', { worker: worker.pid, dialog: rw.call, events: (await v.calls(tw)).filter(x => x.kind === 'event').map(x => x.data), serverStillAnswers: afterW, respawn: pf.out.split('\n').filter(l => /RESPAWN/.test(l)), l47384: lsofPort(47384) });
    await C.sleep(13000);
    step('08-after-refresh', { chips47384: (await v.chips()).filter(x => x.port === 47384) });
    const ti = Date.now();
    const ri = await clickTry(v, `#now .srv[data-port="47363"] [data-do=stop]`, 'dialog', ti);
    await C.sleep(1200);
    step('08-stop-inspector-chip', { dialog: ri.call, l47362: lsofPort(47362), l47363: lsofPort(47363), insExit: ins.exitAt && ins.exitAt - ti, events: (await v.calls(ti)).filter(x => x.kind === 'event').map(x => x.data) });
    C.kill(pf); C.kill(ins); await C.sleep(800);
    // ---- 07: cap of 8 (ten servers, the newest on the highest port)
    const ten = [];
    for (let i = 0; i < 10; i++) { const p = 47391 + i; ten.push([C.serve('node', [FX + '/titled.js', String(p), i === 9 ? 'Newest app' : `app ${i + 1}`], { cwd: i % 2 ? DL : VP, tag: 'ten' + i }), p]); await C.waitListen(ten[i][0], p); await C.sleep(150); }
    await C.sleep(13000);
    const ch7 = await C.waitFor(async () => { const s = await v.snap(); return s.local.servers >= 10 ? s : null; }, 30e3, 300);
    await C.sleep(3500);
    const foot = await v.win.evaluate(() => document.querySelector('#now .nfoot')?.innerText.replace(/\s+/g, ' '));
    step('07-cap', { chips: (await v.chips()).map(x => x.label), snapLocal: (await v.snap()).local, footText: foot, hasMore: /more/i.test(foot || '') });
    await v.snapShot('p1-07-cap-eight');
    R.truthEnd = C.truthLine(C.fleetStatus());
  } catch (e) { step('error', { e: String(e.stack || e).slice(0, 1500) }); }
  finally {
    await C.stopAll();
    R.servers = C.mine.map(s => ({ tag: s.tag, cmd: s.cmd.replace(C.OUT, '…'), cwd: s.cwd, pid: s.pid, listenAt: s.listenAt, exitAt: s.exitAt, code: s.code, sig: s.sig }));
    if (v) { try { step('close', await v.close()); } catch (e) { step('close-error', { e: String(e).slice(0, 300) }); } }
    R.endedAt = C.iso(); R.load.push(C.load());
    fs.writeFileSync(path.join(C.OUT, 'raw', 'critP1-shapes.json'), JSON.stringify(R, null, 1));
  }
})();
