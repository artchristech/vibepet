// home-feedback recapture: every message lands where you look, on the live fleet (isolated root), trusted CDP input through
// test/ultra/launch.js. node recapture.js <appDir> <outDir> [userData]  → <outDir>/results.json + PNGs.
// $0: no fleet member takes a turn. Jumps are the real IPC (no tmux client may be attached: checked before every jump, the run
// refuses otherwise), so they fail with main's reason; dialogs, shell and clipboard are canon's stubs; the only process stopped
// is the fixture server this script starts. Two checks use the test hook on main's outgoing ticks (said where they do):
// an untitled row (the live fleet has none) and an empty queue (two members always need you).
const path = require('path'), os = require('os'), fs = require('fs'), { execSync, spawn } = require('child_process');
const [APP, OUT, UD] = process.argv.slice(2);
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), userData = UD || path.join(ULTRA, 'userdata', 'r1-home-feedback');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const med = a => { const s = [...a].filter(x => x != null).sort((x, y) => x - y); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; };
const R = { app: APP, git: execSync(`git -C ${APP} log -1 --format='%h %s'`).toString().trim(), startedAt: new Date().toISOString(), userData };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
fs.mkdirSync(OUT, { recursive: true });
const shotPath = n => path.join(OUT, n);
function noClients() {   // a jump with an attached client would switch it: refuse to run then
  const out = execSync('tmux list-clients -F "#{client_session}" 2>/dev/null || true').toString().trim();
  if (out) throw new Error(`a tmux client is attached (${out.split('\n').length}): refusing to jump`);
  return true;
}
const { launch, decodePng } = require(path.join(APP, 'test', 'ultra', 'launch.js'));
const { instrument, SEED } = require(path.join(APP, 'test', 'ultra', 'canon.js'));

function hook() {   // after canon's instrument(): every tick main sends passes here, as is unless a check asks otherwise
  const wc = globalThis.__vibepet.win().webContents, X = globalThis.__hf = { dropNeeds: false, untitle: null, hold: false };
  wc.__send ||= wc.send.bind(wc);
  wc.send = (ch, d) => {
    if (ch === 'tick' && X.hold) return;   // held while an element is shot: a re-render resets the list's scroll
    if (ch !== 'tick' || !d || (!X.dropNeeds && !X.untitle)) return wc.__send(ch, d);
    let agents = d.agents;
    if (X.dropNeeds) agents = agents.filter(a => a.phase !== 'waiting' && a.phase !== 'stalled');
    if (X.untitle) agents = agents.map(a => a.name === X.untitle ? { ...a, title: undefined } : a);
    return wc.__send(ch, { ...d, agents });
  };
  return true;
}
// what the page shows: rows, the bubble (and what is on top at its centre), the pill
const PAGE = () => {
  const $ = id => document.getElementById(id), b = $('bubble'), br = b.getBoundingClientRect(), cs = getComputedStyle(b);
  const at = br.width > 1 && cs.display !== 'none' ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
  const who = el => !el ? null : el.id ? '#' + el.id : el.closest('[id]') ? `${el.tagName.toLowerCase()} in #${el.closest('[id]').id}` : el.tagName.toLowerCase();
  return {
    bubble: { text: b.textContent, cls: b.className, display: cs.display, position: cs.position, zIndex: cs.zIndex, rect: [br.left, br.top, br.width, br.height].map(Math.round),
      atCentre: who(at), onTop: !!at && (at === b || b.contains(at)), chatTop: Math.round($('chat').getBoundingClientRect().top), homeOpen: !$('chat').classList.contains('hidden') },
    rows: [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, label: r.querySelector('.nm b')?.textContent, state: r.querySelector('.nm small')?.textContent,
      gauge: r.querySelector('.nfo')?.textContent || null, pips: r.querySelector('.nfo') ? [r.querySelectorAll('.nfo u.f').length, r.querySelectorAll('.nfo u:not(.f)').length] : null,
      ask: r.querySelector('.na')?.textContent || null, note: r.querySelector('.nnote')?.textContent || null })),
    pill: { open: !$('roster').classList.contains('hidden'), rows: [...$('roster').querySelectorAll('button[data-id]')].map(r => ({ id: r.dataset.id, label: r.querySelector('b')?.textContent,
      note: r.querySelector('.nnote')?.textContent || null })) },
    pending: pending().map(a => a.name),
  };
};
const page = v => v.win.evaluate(PAGE);
const byName = async (v, name) => (await v.evalMain(() => globalThis.__vibepet.snapshot().agents.map(a => ({ id: a.id, name: a.name, title: a.title || null, phase: a.phase })))).find(a => a.name === name);
// timestamps in the page itself: the press (pointerdown on the row) and the first frame a note shows in that row
const ARM = id => {
  window.__t = { down: null, note: null, bubble: null };
  const row = () => document.querySelector(`#now .nr[data-id="${id}"]`);
  document.addEventListener('pointerdown', () => { window.__t.down ??= performance.timeOrigin + performance.now(); }, { capture: true, once: true });
  const mo = new MutationObserver(() => {
    if (!window.__t.note && row()?.querySelector('.nnote')) window.__t.note = performance.timeOrigin + performance.now();
    const b = document.getElementById('bubble');   // the failure line's first letter: the bubble shows again after the press
    if (!window.__t.bubble && window.__t.down && b.textContent && !b.classList.contains('hidden')) window.__t.bubble = performance.timeOrigin + performance.now();
    if (window.__t.note && window.__t.bubble) mo.disconnect();
  });
  mo.observe(document.body, { subtree: true, childList: true, characterData: true });
};
// the strongest text pixel of a clip vs the clip's most common colour (its background): the critic's own measure
function strongest(file) {
  const { w, h, rgba } = decodePng(fs.readFileSync(file)), count = new Map();
  for (let i = 0; i < rgba.length; i += 4) { const k = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]; count.set(k, (count.get(k) || 0) + 1); }
  const bgk = [...count].sort((a, b) => b[1] - a[1])[0][0], bg = [bgk >> 16, (bgk >> 8) & 255, bgk & 255];
  const lum = c => { const l = c.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const con = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  let best = { c: 1, px: bg };
  for (let i = 0; i < rgba.length; i += 4) { const px = [rgba[i], rgba[i + 1], rgba[i + 2]], c = con(px, bg); if (c > best.c) best = { c, px }; }
  return { w, h, bg, text: best.px, contrast: +best.c.toFixed(2) };
}
function startServer(cwd) {   // ours: the only process this run may stop; it exits on its own after 5 min
  const code = "const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<!doctype html><title>hf fixture</title><p>home-feedback</p>')});" +
    "s.listen(0,'127.0.0.1',()=>console.log('PORT '+s.address().port));setTimeout(()=>process.exit(0),300e3)";
  const p = spawn(process.execPath, ['-e', code], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  return new Promise((res, rej) => {
    let buf = ''; const t = setTimeout(() => rej(new Error('fixture server: no port in 10 s')), 10e3);
    p.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) { clearTimeout(t); res({ proc: p, pid: p.pid, port: +m[1], cwd }); } });
  });
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

(async () => {
  R.loadStart = load();
  R.fleetSpendBefore = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim().slice(0, 140);
  R.tmuxClientsBefore = noClients() && 0;
  fs.rmSync(userData, { recursive: true, force: true });   // fresh: nothing seen yet
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const v = await launch({ appDir: APP, root: path.join(ULTRA, 'root', '.claude'), userData, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  const hold = on => v.evalMain((_e, on) => { globalThis.__hf.hold = on; }, on);
  const box = async sel => { const l = v.win.locator(sel).first(); await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {}); await sleep(150); return l.boundingBox(); };
  const W = v.win, calls = async (kind, since = 0) => (await v.evalMain(() => globalThis.__canon.calls)).filter(c => (!kind || c.kind === kind) && c.at >= since);
  let server;
  try {
    await v.evalMain(instrument); await v.evalMain(hook);
    R.readyMs = v.readyMs; R.loadAtLaunch = load();
    R.cursor = await v.evalMain(({ screen }) => { const c = screen.getCursorScreenPoint(), b = globalThis.__vibepet.win().getBounds(); return { inWindow: c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height }; });
    const K = await byName(v, 'kestrel'), D = await byName(v, 'delta'), Vp = await byName(v, 'vibepet');
    R.members = { kestrel: K, delta: D, vibepet: Vp };
    // nothing hovered yet: every done row is unread and in the jump walk
    R.pendingAtLaunch = (await page(v)).pending;
    // ---- (a)+(b) Home open (the menu-bar 'Open Home': no hover over Net, which would mark the done rows seen) ----
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('event', { kind: 'openChat' }));
    for (let i = 0; i < 100 && !(await v.homeMode()); i++) await sleep(50);
    await sleep(3500); await W.mouse.move(5, 5);
    const p0 = await page(v);
    R.home = { rows: p0.rows, pending: p0.pending, load: load() };
    await v.shot(shotPath('a0-home.png'));
    R.home.systemDark = await W.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
    log('rows', JSON.stringify(p0.rows.map(r => [r.label, r.state, r.gauge, r.ask && r.ask.slice(0, 30)])));
    // a row jump that fails, 5 times on kestrel: the reason in that row, the toast over the panel, the queue untouched
    R.rowJump = [];
    for (let n = 0; n < 5; n++) {
      noClients();
      await W.evaluate(ARM, K.id);
      const t0 = Date.now(), pb = (await page(v)).pending;
      await W.click(`#now .nr[data-id="${K.id}"] .nm`);
      let st; for (let i = 0; i < 100; i++) { st = await W.evaluate(() => window.__t); if (st.note && st.bubble) break; await sleep(50); }
      const c = (await calls('ipc:jump', t0)).at(-1);
      await sleep(900);   // the bubble types itself out (18 ms a letter)
      const p = await page(v);
      const row = p.rows.find(r => r.id === K.id);
      const ipcEnd = c ? c.at : null;   // canon's spy stamps a call when its handler returns
      R.rowJump.push({ n, result: c?.result, ipcMs: c?.ms, pressToNoteMs: st.note && st.down ? Math.round(st.note - st.down) : null, ipcDoneToNoteMs: st.note && ipcEnd ? Math.round(st.note - ipcEnd) : null,
        pressToBubbleMs: st.bubble && st.down ? Math.round(st.bubble - st.down) : null,
        note: row?.note, bubble: p.bubble, pendingBefore: pb, pendingAfter: p.pending, load: load() });
      log('jump', n, JSON.stringify(R.rowJump.at(-1)).slice(0, 400));
      if (n === 0) await v.shot(shotPath('a1-row-jump-fails-note-and-toast.png'));
      await sleep(6300);   // the note's 6 s, so the next press starts from a row without one
    }
    if (process.env.JUMPS_ONLY) { R.only = 'row jumps (JUMPS_ONLY=1)'; return; }   // a timing repeat: just the 5 failed row jumps
    R.rowJumpSummary = { pressToNoteMedianMs: med(R.rowJump.map(j => j.pressToNoteMs)), ipcMedianMs: med(R.rowJump.map(j => j.ipcMs)), ipcDoneToNoteMedianMs: med(R.rowJump.map(j => j.ipcDoneToNoteMs)),
      noteInRow: R.rowJump.filter(j => j.note).length + '/' + R.rowJump.length, toastOnTop: R.rowJump.filter(j => j.bubble.onTop).length + '/' + R.rowJump.length,
      doneRowsStillPending: R.rowJump.every(j => ['delta', 'atlas', 'vibepet'].every(m => j.pendingAfter.includes(m))) };
    save();
    // a row low in the list: Today's note takes Now's room; jump the lowest row whose head shows: its note scrolls into view
    await W.click('#now [data-do=today]'); await sleep(800); await W.mouse.move(5, 5);
    const low = await W.evaluate(() => { const box = document.getElementById('now').getBoundingClientRect();
      return [...document.querySelectorAll('#now .nr[data-id]')].filter(r => { const b = r.querySelector('.nm b').getBoundingClientRect(); return b.bottom <= box.bottom - 2 && b.top >= box.top; }).map(r => ({ id: r.dataset.id, label: r.querySelector('.nm b').textContent })).pop(); });
    const inView = id => W.evaluate(id => { const L = document.getElementById('now'), n = [...L.querySelectorAll('.nr[data-id]')].find(r => r.dataset.id === id)?.querySelector('.nnote'), box = L.getBoundingClientRect();
      if (!n) return { note: null }; const r = n.getBoundingClientRect(); return { note: n.textContent, inView: r.top >= box.top - 1 && r.bottom <= box.bottom + 1, scrollTop: L.scrollTop }; }, id);
    noClients();
    const bottomBefore = await W.evaluate(id => { const r = [...document.querySelectorAll('#now .nr[data-id]')].find(x => x.dataset.id === id).getBoundingClientRect(), box = document.getElementById('now').getBoundingClientRect(); return { rowBottom: Math.round(r.bottom), listBottom: Math.round(box.bottom) }; }, low.id);
    await W.click(`#now .nr[data-id="${low.id}"] .nm b`);
    let lv; for (let i = 0; i < 100; i++) { lv = await inView(low.id); if (lv.note) break; await sleep(50); }
    await sleep(300); lv = await inView(low.id);
    await v.shot(shotPath('a6-low-row-note-scrolled-into-view.png'));
    await sleep(3300);
    R.lowRow = { row: low.label, before: bottomBefore, atNote: lv, afterATick: await inView(low.id), load: load() };
    log('low row', JSON.stringify(R.lowRow));
    save();
    // 'goal hit': Mark done on delta's goal
    const tg = Date.now();
    await W.click(`#now .nr[data-id="${D.id}"] button[data-do=done]`);
    let pg; for (let i = 0; i < 100; i++) { pg = await page(v); if (/goal hit/.test(pg.bubble.text)) break; await sleep(50); }
    await sleep(700); pg = await page(v);
    R.goalHit = { msToBubble: Date.now() - tg, bubble: pg.bubble, load: load() };
    await v.shot(shotPath('a2-goal-hit-toast.png'));
    log('goal', JSON.stringify(R.goalHit.bubble));
    save();
    // /stop <port> on a fixture server started here, in a fleet repo
    server = await startServer(path.join(ULTRA, 'fleet', 'vibepet'));
    const ts = Date.now(); let listed = false;
    while (Date.now() - ts < 30e3 && !(listed = await W.evaluate(p => !!document.querySelector(`#now .srv[data-port="${p}"]`), server.port))) await sleep(250);
    R.stop = { port: server.port, pid: server.pid, listedAfterMs: Date.now() - ts, listed };
    await sleep(6000);   // let the 'is up' line finish, so the stop line is the one measured
    await W.click('#chatInput'); await W.keyboard.type(`/stop ${server.port}`); const t1 = Date.now(); await W.keyboard.press('Enter');
    let pq; for (let i = 0; i < 200; i++) { pq = await page(v); if (/stopped/.test(pq.bubble.text)) break; await sleep(50); }
    await sleep(500); pq = await page(v);
    const died = await (async () => { for (let i = 0; i < 40; i++) { if (!alive(server.pid)) return Date.now() - t1; await sleep(50); } return null; })();
    Object.assign(R.stop, { dialog: (await calls('dialog', t1)).map(c => c.message), msToBubble: Date.now() - t1, serverDiedMs: died, bubble: pq.bubble, load: load() });
    await v.shot(shotPath('a3-stop-toast.png'));
    log('stop', JSON.stringify(R.stop).slice(0, 400));
    save();
    // (c) the ask line: kestrel's, in light (as this Mac renders) and in dark (emulated), measured on the screenshots
    R.ask = {};
    for (const scheme of ['light', 'dark']) {
      await W.emulateMedia({ colorScheme: scheme }); await sleep(400); await hold(true);
      await v.shot(shotPath(`c1-home-${scheme}.png`));
      const b = await box(`#now .nr[data-id="${K.id}"] .na`);
      const f = shotPath(`c2-ask-kestrel-${scheme}.png`);
      await v.shot(f, { clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
      const css = await W.evaluate(id => getComputedStyle(document.querySelector(`#now .nr[data-id="${id}"] .na`)).color, K.id);
      R.ask[scheme] = { ...strongest(f), cssColor: css, text: (await page(v)).rows.find(r => r.id === K.id).ask };
      const rb = await box(`#now .nr[data-id="${K.id}"]`);
      await v.shot(shotPath(`c3-row-kestrel-${scheme}.png`), { clip: { x: rb.x - 2, y: rb.y - 2, width: rb.width + 4, height: rb.height + 4 } });
      const db = await box(`#now .nr[data-id="${D.id}"]`);
      await v.shot(shotPath(`c4-row-delta-gauge-${scheme}.png`), { clip: { x: db.x - 2, y: db.y - 2, width: db.width + 4, height: db.height + 4 } });
      await hold(false);
    }
    await W.emulateMedia({ colorScheme: null });
    log('ask', JSON.stringify(R.ask));
    // (c) an untitled row: the live fleet has none (vibepet is titled), so the hook drops vibepet's title from main's ticks
    await v.evalMain(() => { globalThis.__hf.untitle = 'vibepet'; globalThis.__vibepet.tick(); });
    await sleep(1200);
    const pu = await page(v), vr = pu.rows.find(r => r.id === Vp.id);
    R.untitled = { via: 'test hook: vibepet tick without its title', row: vr, nameCount: ((vr.label + ' ' + vr.state).match(/vibepet/g) || []).length };
    await hold(true); const vb = await box(`#now .nr[data-id="${Vp.id}"]`);
    await v.shot(shotPath('c5-row-vibepet-untitled-hook.png'), { clip: { x: vb.x - 2, y: vb.y - 2, width: vb.width + 4, height: vb.height + 4 } }); await hold(false);
    await v.evalMain(() => { globalThis.__hf.untitle = null; globalThis.__vibepet.tick(); });
    log('untitled', JSON.stringify(R.untitled));
    save();
    // ---- the pill (Home closed, the pointer resting on Net) ----
    await W.keyboard.press('Escape'); await sleep(500); await W.mouse.move(5, 5); await sleep(1200);
    const pp = await v.petPoint();
    await W.mouse.move(pp.x - 20, pp.y - 20); await W.mouse.move(pp.x, pp.y, { steps: 4 });
    for (let i = 0; i < 60 && !(await page(v)).pill.open; i++) await sleep(50);
    await sleep(400);
    R.pill = { open: (await page(v)).pill.open, load: load() };
    R.pill.replay = await W.evaluate(() => [...document.querySelectorAll('#roster button[data-id] .replay')].map(e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, color: cs.color, rowHovered: e.closest('button').matches(':hover') }; }));
    await v.shot(shotPath('c6-pill-replay-visible.png'));
    // the jump key while the pill is open (main's shortcut handler): the failure note in that pill row
    noClients();
    const th = Date.now();
    await v.evalMain(() => { const w = globalThis.__vibepet.win(); if (!w.isVisible()) w.showInactive(), w.webContents.send('summon'); w.webContents.send('hotkey'); });
    let ph; for (let i = 0; i < 100; i++) { ph = await page(v); if (ph.pill.rows.some(r => r.note)) break; await sleep(50); }
    const hc = (await calls('ipc:jump', th)).at(-1);
    R.pill.hotkey = { jumped: hc && (await v.evalMain((_e, id) => globalThis.__vibepet.snapshot().agents.find(a => a.id === id)?.name, hc.args[0])), result: hc?.result, msToNote: Date.now() - th, rows: ph.pill.rows, bubble: ph.bubble, load: load() };
    await sleep(300); await v.shot(shotPath('a4-pill-hotkey-fail-note.png'));
    // a click on kestrel's pill row: the same
    noClients();
    const kb = await W.locator(`#roster button[data-id="${K.id}"] b`).boundingBox();
    const tk = Date.now();
    await W.mouse.move(kb.x + 10, kb.y + kb.height / 2, { steps: 4 }); await W.mouse.down(); await sleep(40); await W.mouse.up();
    let pk; for (let i = 0; i < 100; i++) { pk = await page(v); if (pk.pill.rows.find(r => r.id === K.id)?.note) break; await sleep(50); }
    R.pill.clickKestrel = { msToNote: Date.now() - tk, row: pk.pill.rows.find(r => r.id === K.id), open: pk.pill.open, result: (await calls('ipc:jump', tk)).at(-1)?.result, load: load() };
    await sleep(300); await v.shot(shotPath('a5-pill-kestrel-row-note.png'));
    log('pill', JSON.stringify(R.pill).slice(0, 600));
    save();
    // ---- (b) an empty queue: the done rows were seen by that hover; the hook holds back the two members that need you ----
    await W.mouse.move(5, 5); await sleep(1500);
    await v.evalMain(() => { globalThis.__hf.dropNeeds = true; globalThis.__vibepet.tick(); });
    await sleep(1200);
    await W.evaluate(() => { window.__said = []; const s = show; show = o => { window.__said.push(o.text); s(o); }; });
    const pe = await page(v);
    const te = Date.now();
    await v.evalMain(() => { const w = globalThis.__vibepet.win(); if (!w.isVisible()) w.showInactive(), w.webContents.send('summon'); w.webContents.send('hotkey'); });
    let pn; for (let i = 0; i < 100; i++) { pn = await page(v); if (/Nobody/.test(pn.bubble.text) && pn.bubble.text.length >= 23) break; await sleep(50); }
    R.empty = { via: 'test hook: ticks without kestrel and beacon (the two that need you)', pendingBefore: pe.pending, msToBubble: Date.now() - te, bubble: pn.bubble, jumps: (await calls('ipc:jump', te)).length, load: load() };
    await v.shot(shotPath('b1-empty-queue-nobody-waiting.png'));
    await sleep(4500);
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey')); await sleep(400);
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey')); await sleep(800);
    R.empty.said = await W.evaluate(() => window.__said); R.empty.jumpsTotal = (await calls('ipc:jump', te)).length;
    // Home open too: the same answer as a toast over the panel
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('event', { kind: 'openChat' })); await sleep(800);
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey'));
    let pn2; for (let i = 0; i < 100; i++) { pn2 = await page(v); if (/Nobody/.test(pn2.bubble.text) && pn2.bubble.text.length >= 23) break; await sleep(50); }
    R.empty.homeOpen = { bubble: pn2.bubble };
    await v.shot(shotPath('b2-empty-queue-home-open-toast.png'));
    await v.evalMain(() => { globalThis.__hf.dropNeeds = false; globalThis.__vibepet.tick(); });
    log('empty', JSON.stringify(R.empty).slice(0, 500));
    R.intercepted = (await calls()).map(c => ({ kind: c.kind, at: c.at, args: c.args, result: c.result, ms: c.ms, message: c.message }));
  } finally {
    if (R.rowJump && !R.rowJumpSummary) R.rowJumpSummary = { pressToNoteMedianMs: med(R.rowJump.map(j => j.pressToNoteMs)), ipcMedianMs: med(R.rowJump.map(j => j.ipcMs)),
      ipcDoneToNoteMedianMs: med(R.rowJump.map(j => j.ipcDoneToNoteMs)), noteInRow: R.rowJump.filter(j => j.note).length + '/' + R.rowJump.length };
    if (server && alive(server.pid)) { try { server.proc.kill(); } catch {} R.stop && (R.stop.killedByScript = true); }
    R.close = await v.close(); R.loadEnd = load();
    R.fleetSpendAfter = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim().slice(0, 140);
    R.endedAt = new Date().toISOString(); save(); log('done →', OUT);
  }
})().catch(e => { console.error(e); R.error = String(e.stack || e); save(); process.exit(1); });
