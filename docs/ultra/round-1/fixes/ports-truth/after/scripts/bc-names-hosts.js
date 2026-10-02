// (b) chips name their session: python3 -m http.server in the vibepet repo; two 'Vite + React + TS' servers in two repos.
// (c) a [::1]-only server and an HTTPS server show their titles with Open enabled, Open records the right URL (fetched back: same
// title); two servers on one port each open their own; a server that answers 20 s after listening gets title + Open ≤5 s after.
// Writes ../bc-names-hosts.json + shots.
const L = require('./rlib'), fs = require('fs'), path = require('path'), http = require('http'), https = require('https');
const { execFileSync } = require('child_process');
const fetchTitle = url => new Promise(res => { const q = (url.startsWith('https') ? https : http).get(url, { rejectUnauthorized: false, timeout: 5000 }, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res((s.match(/<title>([^<]*)<\/title>/i) || [])[1] || null)); }); q.on('error', e => res('ERR ' + e.code)); q.on('timeout', () => q.destroy()); });
(async () => {
  const tls = fs.mkdtempSync('/private/tmp/claude-501/-Users-christopherharris-projects/2aec191f-bd46-4d22-b2da-e8c859fd18a3/scratchpad/tls-');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', tls + '/k.pem', '-out', tls + '/c.pem', '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  const v = await L.start(), out = { startedAt: new Date().toISOString(), uptimeStart: L.uptime(), servers: {} };
  const P = {}; for (const k of ['py', 'viteA', 'viteB', 'v6', 'tls', 'shared', 'slow']) P[k] = L.nextPort();
  try {
    await v.openHome(); await v.observe();
    const S = {
      py: L.serve('python3', ['-m', 'http.server', String(P.py)], { cwd: L.repo('vibepet'), tag: 'py' }),
      viteA: L.serve('node', [L.FX + '/titled.js', String(P.viteA), 'Vite + React + TS'], { cwd: L.repo('vibepet'), tag: 'viteA' }),
      viteB: L.serve('node', [L.FX + '/titled.js', String(P.viteB), 'Vite + React + TS'], { cwd: L.repo('delta'), tag: 'viteB' }),
      v6: L.serve('node', [L.FX + '/titled.js', String(P.v6), 'Vite on [::1]', 'localhost'], { cwd: L.repo('vibepet'), tag: 'v6' }),
      tls: L.serve('node', [L.FX + '/https.js', String(P.tls), tls + '/k.pem', tls + '/c.pem', 'Secure dev app'], { cwd: L.repo('vibepet'), tag: 'tls' }),
      sharedK: L.serve('node', [L.FX + '/titled.js', String(P.shared), 'Kestrel dashboard'], { cwd: L.repo('kestrel'), tag: 'sharedK' }),
    };
    await L.waitListen(S.sharedK, P.shared);
    S.sharedB = L.serve('python3', [L.FX + '/page.py', String(P.shared), '127.0.0.1', 'Beacon status'], { cwd: L.repo('beacon'), tag: 'sharedB' });
    S.slow = L.serve('node', [L.FX + '/slow.js', String(P.slow), 'Next.js app', '20000'], { cwd: L.repo('vibepet'), tag: 'slow' });
    for (const [k, s] of Object.entries(S)) await L.waitListen(s, k.startsWith('shared') ? P.shared : P[k]);
    out.binds = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, L.listening(p).filter(l => l[0] === 'n').map(l => l.slice(1))]));
    // the slow one is listening but answers only at READY_AT: its chip shows, inactive, saying why
    const slowIn = await L.waitFor(async () => (await v.snap()).servers.find(c => c.port === P.slow), 15e3);
    out.slowFirst = { snapshot: slowIn?.r, chip: (await v.chips()).find(c => c.port === P.slow) || 'folded', msAfterListen: (await v.rec()).chips.find(c => c.port === P.slow && c.kind === 'add')?.at - S.slow.listenAt };
    await L.waitFor(async () => { const c = (await v.snap()).servers; return [P.py, P.viteA, P.viteB, P.v6, P.tls].every(p => c.some(x => x.port === p && x.http)) && c.filter(x => x.port === P.shared).length === 2; }, 20e3);
    out.foldedFirst = { chips: (await v.chips()).map(c => c.label), more: await v.more() };
    if (await v.more()) await v.win.locator('#now .srvmore').click();   // 8 servers: Home shows 6 and '+2 more'; open the full list
    await L.sleep(300);
    out.chipsEarly = await v.chips();
    await v.shotTo('bc-1-names-hosts-slow-waiting'); await v.shotFoot('bc-1-footer');
    // Open each: what URL it hands the browser, and whose page that URL serves
    out.opens = [];
    for (const c of out.chipsEarly.filter(c => c.port !== P.slow && Object.values(P).includes(c.port))) {   // ours only (another tester's fixture may be listed too)
      const t0 = Date.now();
      await v.win.locator(`#now .srv[data-key="${c.key}"] button[data-do=open]`).click({ timeout: 5000 });
      const call = (await L.waitFor(async () => (await v.calls(t0)).find(x => x.kind === 'openExternal'), 5000))?.r;
      out.opens.push({ port: c.port, chip: c.label, url: call?.url || null, servesTitle: call ? await fetchTitle(call.url) : null });
    }
    // the slow server: Open turns active once it answers (READY_AT, its own clock = this machine's)
    out.slowTrace = [];   // main's view of the slow server while we wait (http, why, title), and its chip, every ~2 s
    const act = await L.waitFor(async () => { const r = await v.rec(), a = r.chips.find(c => c.port === P.slow && c.kind === 'active');
      if (!out.slowTrace.length || Date.now() - out.slowTrace.at(-1).at > 2000) { const m = (await v.snap()).servers.find(x => x.port === P.slow), c = (await v.chips()).find(x => x.port === P.slow);
        out.slowTrace.push({ at: Date.now(), msAfterReady: Date.now() - S.slow.readyAt, main: m ? { http: m.http, why: m.why, name: m.name } : null, chip: c ? (c.inactive ? 'inactive' : 'active') : 'folded' }); }
      return a; }, 40e3, 50);
    out.slow = { listenAt: S.slow.listenAt, readyAt: S.slow.readyAt, activeAt: act?.r.at ?? null, msAfterReady: act ? act.r.at - S.slow.readyAt : null, load: L.load() };
    out.chipsLate = await v.chips();
    { const c = out.chipsLate.find(x => x.port === P.slow), t0 = Date.now(); await v.win.locator(`#now .srv[data-key="${c.key}"] button[data-do=open]`).click({ timeout: 5000 });
      const call = (await L.waitFor(async () => (await v.calls(t0)).find(x => x.kind === 'openExternal'), 5000))?.r; out.opens.push({ port: c.port, chip: c.label, url: call?.url || null, servesTitle: call ? await fetchTitle(call.url) : null }); }
    await v.shotTo('bc-2-slow-answered'); await v.shotFoot('bc-2-footer');
    out.snapServers = (await v.snap()).servers;
    out.ports = P; out.uptimeEnd = L.uptime();
  } finally { out.fixtures = await L.stopAll(); out.close = await v.close(); fs.rmSync(tls, { recursive: true, force: true });
    fs.writeFileSync(L.OUT + '/' + (process.argv[2] || 'bc-names-hosts') + '.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify({ chips: out.chipsLate?.map(c => c.label + (c.inactive ? ' [inactive]' : '')), opens: out.opens, slow: out.slow, slowFirst: out.slowFirst }, null, 1)); }
})().catch(e => { console.error(e); process.exit(1); });
