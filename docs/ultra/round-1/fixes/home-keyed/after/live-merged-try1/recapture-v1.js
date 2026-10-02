// home-keyed recapture: Home rows keyed by session, on the live fleet (isolated root), trusted CDP input through test/ultra/launch.js.
// node recapture.js <appDir> <outDir> [userData]   → <outDir>/results.json + PNGs. $0: no fleet member takes a turn; send-to and jump
// are record-only stubs in main (nothing is typed into any terminal), dialogs/shell/clipboard are canon's stubs.
const path = require('path'), os = require('os'), fs = require('fs'), { execSync } = require('child_process');
const [APP, OUT, UD] = process.argv.slice(2);
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), userData = UD || path.join(ULTRA, 'userdata', 'r1-home-keyed');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const R = { app: APP, git: execSync(`git -C ${APP} log -1 --format='%h %s'`).toString().trim(), startedAt: new Date().toISOString(), runs: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
fs.mkdirSync(OUT, { recursive: true });

function stubs({ ipcMain }) {   // after canon's instrument(): send-to and jump answer {ok:false} and only record
  const C = globalThis.__canon, rec = (kind, data = {}) => C.calls.push({ kind, at: Date.now(), ...data });
  for (const ch of ['send-to', 'jump']) { ipcMain.removeHandler(ch); ipcMain.handle(ch, async (_, ...a) => { rec('ipc:' + ch, { args: a }); return { ok: false, why: 'recapture stub' }; }); }
  globalThis.__vibepet.win().on('blur', () => rec('win:blur'));
  return true;
}
async function start() {
  const { launch } = require(path.join(APP, 'test', 'ultra', 'launch.js')), { instrument, SEED } = require(path.join(APP, 'test', 'ultra', 'canon.js'));
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const v = await launch({ appDir: APP, root: path.join(ULTRA, 'root', '.claude'), userData, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  await v.evalMain(instrument); await v.evalMain(stubs);
  v.calls = async (kind, since = 0) => (await v.evalMain(() => globalThis.__canon.calls)).filter(c => (!kind || c.kind === kind) && c.at >= since);
  await v.win.evaluate(() => { window.__ticks = 0; window.pet.on('tick', () => window.__ticks++); });
  v.ev = (f, a) => v.win.evaluate(f, a);
  v.cursor = () => v.evalMain(({ screen }) => { const c = screen.getCursorScreenPoint(), b = globalThis.__vibepet.win().getBounds(); return { x: c.x, y: c.y, inWindow: c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height }; });
  v.ticks = () => v.ev(() => window.__ticks);
  v.nextTick = async () => { const t = await v.ticks(); for (let i = 0; i < 200 && (await v.ticks()) === t; i++) await sleep(25); };
  return v;
}
// rows as Home shows them, and what the panel shows without scrolling (no scroll box between a node and the panel clips it)
const rows = v => v.ev(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id.slice(0, 8), title: r.querySelector('.nm b').textContent, label: r.querySelector('.nm small').textContent,
  sig: ['needs', 'stuck', 'ready', 'running', 'exited'].find(c => r.classList.contains(c)) || null, acts: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) })));
const fold = v => v.ev(() => {
  const chat = document.getElementById('chat');
  const vis = el => { const r = el.getBoundingClientRect(); if (!r.height) return false; for (let p = el.parentElement; p; p = p.parentElement) { if (p === chat || /auto|scroll|hidden/.test(getComputedStyle(p).overflowY)) { const b = p.getBoundingClientRect(); if (r.top < b.top - 1 || r.bottom > b.bottom + 1) return false; } if (p === chat) break; } return true; };
  const rs = [...document.querySelectorAll('#now .nr[data-id]')], foot = [...document.querySelectorAll('#now .nfoot button')];
  return { rows: rs.length, inView: rs.filter(vis).length, needs: rs.filter(r => r.matches('.needs, .stuck')).length, needsInView: rs.filter(r => r.matches('.needs, .stuck') && vis(r)).length,
    footer: foot.map(b => b.textContent.trim()), footerInView: foot.length > 0 && foot.every(vis), msgs: document.querySelectorAll('#msgs .msg').length, fresh: chat.classList.contains('fresh'), panel: Math.round(chat.getBoundingClientRect().height) };
});
const rowSel = (v, title) => v.ev(t => { const r = [...document.querySelectorAll('#now .nr[data-id]')].find(x => x.querySelector('.nm b').textContent === t); return r ? `#now .nr[data-id="${r.dataset.id}"]` : null; }, title);
const box = async (v, sel) => { const b = await v.win.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

async function run1() {   // fold, presses spanning ticks, focus, selection, reply box vs chat bar, keyboard
  const v = await start(), W = v.win, X = R.runs.one = { load: load(), readyMs: v.readyMs, cursor: await v.cursor() };
  try {
    const h = await v.openHome(); await sleep(3400); await W.mouse.move(5, 5); await sleep(300);
    X.home = { openMs: h.ms, rows: await rows(v), snapshot: (await v.evalMain(() => globalThis.__vibepet.snapshot().agents.map(a => a.name))) };
    // (e) every row + the footer, empty chat; then after one note
    X.foldEmpty = { ...(await fold(v)), load: load() }; await v.shot(path.join(OUT, 'e1-fold-empty-chat.png'));
    await W.locator('#now [data-do=today]').click(); await sleep(500); await W.mouse.move(5, 5); await v.nextTick(); await sleep(300);
    X.foldOneNote = { ...(await fold(v)), load: load() }; await v.shot(path.join(OUT, 'e2-fold-one-note.png'));
    log('fold', JSON.stringify(X.foldEmpty), JSON.stringify(X.foldOneNote));
    const titles = X.home.rows.map(r => r.title), byTitle = t => X.home.rows.find(r => r.title === t);
    // (a1) a 3.3 s press on a row button that spans a tick: ◎ (prefills /goal) and ▶ (opens Theater), each on every row in turn
    X.presses = [];
    for (const kind of ['goal', 'replay']) for (let i = 0; i < 5; i++) {
      const title = titles[i % titles.length], sel = `${await rowSel(v, title)} button[data-do=${kind}]`;
      for (let attempt = 0; attempt < 3; attempt++) {
        await v.ev(() => { document.getElementById('chatInput').value = ''; });
        const t0 = Date.now(), k0 = await v.ticks(), p = await box(v, sel), wins = v.windows().length;
        await W.mouse.move(p.x, p.y); await W.mouse.down(); await sleep(3300); await W.mouse.up(); await sleep(kind === 'replay' ? 1500 : 200);
        const ticks = (await v.ticks()) - k0, theater = v.windows().filter(p => /theater\/player\.html$/.test(p.url()));
        const took = kind === 'goal' ? (await v.ev(() => document.getElementById('chatInput').value)).startsWith('/goal') : theater.length > 0 && (await v.calls('ipc:theater', t0)).length > 0;
        for (const th of theater) await th.close().catch(() => {});
        await W.mouse.move(5, 5);
        if (ticks < 1 && attempt < 2) { log('press', kind, title, 'no tick during the hold, retry'); continue; }
        X.presses.push({ kind, row: byTitle(title).label.split(' · ')[0], ticksDuringPress: ticks, took, holdMs: 3300, load: load() });
        log('press', kind, title, 'ticks', ticks, 'took', took); break;
      }
    }
    X.pressesTook = `${X.presses.filter(p => p.took && p.ticksDuringPress >= 1).length}/${X.presses.length}`;
    await v.ev(() => { document.getElementById('chatInput').value = ''; document.getElementById('chatInput').focus(); });
    save();
    // (a2) keyboard focus on a row button: the same element after each of 7 ticks
    await W.keyboard.press('Meta+1'); await W.keyboard.press('Tab');
    await v.ev(() => { window.__f = document.activeElement; });
    const f0 = await v.ev(() => ({ el: document.activeElement.outerHTML.slice(0, 60), row: document.activeElement.closest('.nr')?.querySelector('.nm b').textContent }));
    X.focus = { focused: f0, afterTicks: [], load: load() };
    for (let i = 0; i < 7; i++) { await v.nextTick(); await sleep(150); X.focus.afterTicks.push(await v.ev(() => document.activeElement === window.__f && document.contains(window.__f))); }
    await v.shot(path.join(OUT, 'a2-focus-kept-7-ticks.png'));
    log('focus', JSON.stringify(X.focus));
    await W.keyboard.press('Escape');
    // (a3, a4) drag across kestrel's ask line: text selected, 0 jumps; the selection survives 3+ ticks
    const kt = titles.find(t => byTitle(t).acts.includes('approve')) || titles[0], na = await box(v, `${await rowSel(v, kt)} .na`);
    const tj = Date.now();
    await W.mouse.move(na.b.x + 2, na.y); await W.mouse.down(); await W.mouse.move(na.b.x + 160, na.y, { steps: 10 }); await W.mouse.up();
    const sel0 = await v.ev(() => { window.__sn = getSelection().anchorNode; return String(getSelection()); });
    const k0 = await v.ticks(); await sleep(150);
    await W.mouse.move(5, 5);
    const survived = [];
    for (let i = 0; i < 4; i++) { await v.nextTick(); await sleep(150); survived.push(await v.ev(s => String(getSelection()) === s && getSelection().anchorNode === window.__sn && document.contains(window.__sn), sel0)); }
    X.selection = { row: byTitle(kt).label.split(' · ')[0], text: sel0, ticks: (await v.ticks()) - k0, survivedEachTick: survived, jumps: (await v.calls('ipc:jump', tj)).length, load: load() };
    await v.shot(path.join(OUT, 'a3-selection-kept.png'));
    log('selection', JSON.stringify(X.selection));
    await W.mouse.click(5, 5);
    save();
    // (b) a row's Reply box open; typing in the chat bar at 300 ms/char across 2+ ticks lands only in the chat bar
    const qt = titles.find(t => byTitle(t).acts.includes('reply'));
    X.reply = { row: qt && byTitle(qt).label.split(' · ')[0] };
    if (qt) {
      await W.locator(`${await rowSel(v, qt)} button[data-do=reply]`).click(); await sleep(200);
      X.reply.openedFocus = await v.ev(() => document.activeElement.closest('.nrep') ? 'the reply box (opened by you)' : document.activeElement.id || document.activeElement.tagName);
      await v.shot(path.join(OUT, 'b0-reply-box-open.png'));
      await W.locator('#chatInput').click(); await v.nextTick(); await sleep(2700);
      const k1 = await v.ticks(), t1 = Date.now();
      await W.keyboard.type('what is atlas doing', { delay: 300 });
      X.reply.typingMs = Date.now() - t1; X.reply.ticksWhileTyping = (await v.ticks()) - k1;
      Object.assign(X.reply, await v.ev(() => ({ chatBar: document.getElementById('chatInput').value, replyBox: document.querySelector('#now .nrep input')?.value ?? null, replyBoxOpen: !!document.querySelector('#now .nrep') })), { load: load() });
      await v.shot(path.join(OUT, 'b1-typed-into-chat-bar.png'));
      log('reply', JSON.stringify(X.reply));
      await W.locator('#chatInput').fill(''); await W.locator(`${await rowSel(v, qt)} button[data-do=reply]`).click(); await sleep(200);
    }
    save();
    // (d) keyboard: ⌘1 + ⏎ = the top row's first action; ⌘2 + ⏎ on the approval row = send-to (recorded); ↓/↑; Esc; Tab wraps
    await v.ev(() => document.getElementById('chatInput').focus());
    const kb = X.keys = { load: load() }, tk = Date.now(), b0 = (await v.calls('win:blur')).length;
    const at = () => v.ev(() => { const a = document.activeElement, r = a.closest('#now .nr[data-id]'); return { id: a.id || null, tag: a.tagName, row: r ? [...document.querySelectorAll('#now .nr[data-id]')].indexOf(r) : null, onRow: !!r && a === r, text: (a.dataset.do || a.textContent || '').trim().slice(0, 24) }; });
    await W.keyboard.press('Meta+1'); kb.cmd1 = await at();
    await W.keyboard.press('Enter'); await sleep(250); kb.enterTop = { focus: await at(), replyBoxOpen: await v.ev(() => !!document.querySelector('#now .nrep')), ipc: (await v.calls(null, tk)).filter(c => /^ipc:/.test(c.kind)).map(c => c.kind) };
    await W.keyboard.press('Escape'); kb.escFromReplyBox = await at();
    const ai = X.home.rows.findIndex(r => r.acts[0] === 'approve');
    if (ai >= 0 && ai < 9) { const t2 = Date.now(); await W.keyboard.press(`Meta+${ai + 1}`); kb.cmdN = { n: ai + 1, at: await at() }; await W.keyboard.press('Enter'); await sleep(400);
      kb.enterApproval = (await v.calls('ipc:send-to', t2)).map(c => ({ args: c.args, member: X.home.rows[ai].label.split(' · ')[0] })); }
    await W.keyboard.press('ArrowDown'); kb.down = await at();
    await W.keyboard.press('ArrowUp'); kb.up = await at();
    await W.keyboard.press('Escape'); kb.escFromRow = await at();
    await W.keyboard.press('Tab'); kb.tabFromLast = await at();
    await W.keyboard.press('Shift+Tab'); kb.shiftTabFromFirst = await at();
    kb.blurs = (await v.calls('win:blur')).length - b0; kb.homeOpen = await v.homeMode();
    kb.keysTo = { topRowFirstAction: 2 };
    await v.shot(path.join(OUT, 'd-keyboard-end.png'));
    log('keys', JSON.stringify(kb));
    await v.ev(() => { const b = document.querySelector('#now .nrep'); if (b) b.closest('.nr').querySelector('button[data-do=reply]').click(); });
    X.intercepted = (await v.calls()).map(c => ({ kind: c.kind, args: c.args, at: c.at }));
  } finally { X.close = await v.close(); save(); }
}

async function run2() {   // the pointer resting on the list for 3 min, then an injected reorder; then 15 sessions through the hook
  const v = await start(), W = v.win, X = R.runs.two = { load: load(), readyMs: v.readyMs };
  const boxes = () => v.ev(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => { const b = r.getBoundingClientRect(); return [r.dataset.id.slice(0, 8), +b.left.toFixed(1), +b.top.toFixed(1), +b.width.toFixed(1), +b.height.toFixed(1), r.classList.contains('gone')]; }));
  const changes = (a, b) => a.filter(([id, ...g]) => { const n = b.find(x => x[0] === id); return n && g.slice(0, 4).some((v, i) => Math.abs(v - n[i + 1]) > 0.5); }).map(x => x[0]);
  try {
    await v.openHome(); await sleep(3400);
    const rs = await rows(v), mid = rs[Math.min(2, rs.length - 1)], sel = `#now .nr[data-id^="${mid.id}"] .nm small`;
    const p = await box(v, sel);
    await W.mouse.move(p.x, p.y, { steps: 5 }); await sleep(500);
    X.rest = { on: mid.title, cursorStart: await v.cursor(), load: load(), held: await v.ev(() => holding()) };
    const b0 = await boxes(); let samples = 0, moved = 0, firstMove = null, cursorMoved = 0;
    const t0 = Date.now(), k0 = await v.ticks(), c0 = X.rest.cursorStart;
    while (Date.now() - t0 < 180e3) {
      const b = await boxes(); samples++; const ch = changes(b0, b);
      if (ch.length) { moved++; firstMove ||= { atMs: Date.now() - t0, rows: ch, b }; }
      if (samples % 20 === 0) { const c = await v.cursor(); if (c.x !== c0.x || c.y !== c0.y) cursorMoved++; }
      await sleep(250);
    }
    Object.assign(X.rest, { ms: Date.now() - t0, ticks: (await v.ticks()) - k0, samples, samplesWithAMovedRow: moved, firstMove, realCursorMovedSamples: cursorMoved, cursorEnd: await v.cursor(), loadEnd: load(), startBoxes: b0, endBoxes: await boxes() });
    await v.shot(path.join(OUT, 'c0-rested-3min.png'));
    log('rest', JSON.stringify({ samples, moved, ticks: X.rest.ticks, cursorMoved }));
    save();
    // injected (test hook, main's outgoing ticks rewritten for 15 s): a new needs-you session, the order reversed, one session ended,
    // one flipped to running. The pointer stays put: kept rows must not move; leaving the list must apply the queue order at once
    await v.evalMain(() => { const wc = globalThis.__vibepet.win().webContents; wc.__send ||= wc.send.bind(wc);
      wc.send = (ch, d) => wc.__send(ch, ch === 'tick' && d ? { ...d, agents: [...d.agents.slice(1).reverse().map((a, i) => i === 0 ? { ...a, phase: 'working', kind: 'running', ask: undefined } : a),
        { id: '00000000-feed-4000-8000-000000000001', name: 'injected', title: 'Injected session (test hook)', phase: 'waiting', kind: 'question', since: Date.now() - 5000, ask: 'Injected: which one? (A / B)', goal: null }] } : d);
      globalThis.__vibepet.tick(); });
    const bi = await boxes(); let im = 0, isamples = 0, ifirst = null; const ti = Date.now();
    while (Date.now() - ti < 15e3) { const b = await boxes(); isamples++; const ch = changes(bi, b); if (ch.length) { im++; ifirst ||= { atMs: Date.now() - ti, rows: ch }; } await sleep(250); }
    X.injected = { samples: isamples, samplesWithAMovedRow: im, firstMove: ifirst, before: bi, during: await boxes(), cursor: await v.cursor(), load: load() };
    await v.shot(path.join(OUT, 'c1-injected-while-pointed.png'));
    const ci = await box(v, '#chatInput'), tl = Date.now();
    await W.mouse.move(ci.x, ci.y, { steps: 3 });
    const inQueue = () => v.ev(() => { const dom = [...document.querySelectorAll('#now .nr[data-id]')].map(r => r.dataset.id); return !document.querySelector('#now .nr.gone') && JSON.stringify(dom) === JSON.stringify(byUrgency().map(a => a.id)); });
    let ok = false; while (!(ok = await inQueue()) && Date.now() - tl < 6000) await sleep(10);
    X.injected.release = { ms: Date.now() - tl, inQueueOrder: ok, rows: await rows(v), load: load() };
    await v.shot(path.join(OUT, 'c2-released-queue-order.png'));
    log('injected', JSON.stringify({ samples: isamples, moved: im, release: X.injected.release.ms, ok }));
    await v.evalMain(() => { const wc = globalThis.__vibepet.win().webContents; wc.send = wc.__send; globalThis.__vibepet.tick(); });
    await sleep(3500);
    save();
    // (e) 15 sessions in one tick sent through the test hook: every one gets a row, the footer stays in view
    await W.mouse.move(5, 5); await v.nextTick();
    const n = await v.evalMain(() => { const s = globalThis.__vibepet.snapshot(), real = s.agents, ph = ['working', 'ready', 'working', 'ready', 'waiting'];
      s.agents = [...real, ...Array.from({ length: 15 - real.length }, (_, i) => ({ id: `00000000-fab0-4000-8000-${String(i).padStart(12, '0')}`, name: `extra${i}`, title: `Extra session ${i + 1} (test hook)`,
        phase: ph[i % 5], kind: { working: 'running', ready: 'done', waiting: 'question' }[ph[i % 5]], since: Date.now() - (i + 1) * 97e3, ask: ph[i % 5] === 'waiting' ? `Extra ${i + 1}: which one? (A / B)` : undefined, goal: { text: `Extra goal ${i + 1}`, auto: true, done: false } }))];
      const wc = globalThis.__vibepet.win().webContents; wc.__send ||= wc.send.bind(wc);
      wc.__send('tick', s); wc.send = (ch, d) => ch === 'tick' ? undefined : wc.__send(ch, d);   // hold the live ticks back while it's measured
      return s.agents.length; });
    await sleep(400);
    X.fifteen = { sent: n, ...(await fold(v)), load: load() };
    await v.shot(path.join(OUT, 'e3-fifteen-sessions-hook.png'));
    await v.evalMain(() => { const wc = globalThis.__vibepet.win().webContents; wc.send = wc.__send; });
    log('fifteen', JSON.stringify(X.fifteen));
  } finally { X.close = await v.close(); save(); }
}

(async () => {
  R.loadStart = load(); R.fleetSpendBefore = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim();
  if (!process.env.ONLY || process.env.ONLY === '1') await run1();
  if (!process.env.ONLY || process.env.ONLY === '2') await run2();
  R.loadEnd = load(); R.fleetSpendAfter = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim();
  R.endedAt = new Date().toISOString(); save(); log('done →', OUT);
})().catch(e => { console.error(e); R.error = String(e.stack || e); save(); process.exit(1); });
