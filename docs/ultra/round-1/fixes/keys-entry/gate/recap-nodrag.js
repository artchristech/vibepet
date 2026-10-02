// keys-entry recapture: keyboard-first entry, on the live fleet's isolated root, trusted CDP input through test/ultra/launch.js.
// node recapture.js <appDir> <outDir> [parts=a,b,c,d] [n=7]   → <outDir>/results.json + PNGs
// $0: nothing is typed into any terminal and no fleet member takes a turn. jump/send-to are record-only stubs, dialogs/shell/
// clipboard are canon's stubs, chat goes to a local stub engine (only commands are typed). No OS-level key press or click.
//  a  click on Net (CDP): a single click → panel painted; a double click opens once and stays; the next single click closes
//  b  the Open Home key's handler run in main (__vibepet.press('home'), as canon runs the jump key's): Home + caret in the bar
//  c  two instances, different userData, one jump key + one Open Home key (⌃⌥⌘F19 / ⌃⌥⌘F18: nothing holds them and no
//     keyboard here has them): the second reads 'taken' in its menu and Setup's Keys row; then ⌥⌘J and Off through its menu
//     (globalShortcut.register stubbed first, so ⌥⌘J never reaches the OS); the holder quits → the second takes its key over
//  d  /setup from the keyboard: the bar stays, Tab cycles the card + bar, focus survives 3 ticks, '/today' ⏎ runs and the pet
//     stays, Esc ends setup (next open = the Now list), Done hands the caret back to the bar
const path = require('path'), os = require('os'), fs = require('fs'), { execSync } = require('child_process');
const [APP, OUT, PARTS = 'a,b,c,d', N = '7'] = process.argv.slice(2);
const n = +N, parts = new Set(PARTS.split(','));
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), ROOT = path.join(ULTRA, 'root', '.claude'), HARNESS = path.join(ULTRA, 'wt', 'r1-keys-entry', 'test', 'ultra');
const { launch } = require(path.join(HARNESS, 'launch.js')), { instrument, clickMenu, SEED } = require(path.join(HARNESS, 'canon.js'));
const UD = tag => path.join(ULTRA, 'userdata', `r1-keys-entry-${path.basename(OUT)}-${tag}`);
const STUB = path.join(__dirname, '..', 'stub-claude.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? +(s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2).toFixed(1) : null; };
const r1 = x => x == null ? null : +x.toFixed(1);
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
fs.mkdirSync(OUT, { recursive: true });
const R = { app: APP, git: execSync(`git -C ${APP} log -1 --format='%h %s'`).toString().trim(), startedAt: new Date().toISOString(), n, parts: [...parts] };
const resFile = path.join(OUT, 'results.json');
try { Object.assign(R, { ...JSON.parse(fs.readFileSync(resFile, 'utf8')), ...R }); } catch {}   // a part redone keeps the others
const save = () => fs.writeFileSync(resFile, JSON.stringify(R, null, 2));

function stubs({ ipcMain, screen }) {   // after canon's instrument(): jump and send-to only record, nothing reaches a terminal
  const C = globalThis.__canon, rec = (kind, data = {}) => C.calls.push({ kind, at: Date.now(), ...data });
  for (const ch of ['send-to', 'jump']) { ipcMain.removeHandler(ch); ipcMain.handle(ch, async (_, ...a) => { rec('ipc:' + ch, { args: a }); return { ok: false, why: 'recapture stub' }; }); }
  // GATE: the drag-follow reads the REAL OS cursor (screen.getCursorScreenPoint) while a CDP button is down, so a person
  // moving their own mouse drags the test pet mid-click. Record-only drag handlers isolate that confound; the renderer's
  // click/toggle code is untouched. Real cursor moves are counted so the confound is visible.
  ipcMain.removeAllListeners('drag-start'); ipcMain.removeAllListeners('drag-end');
  ipcMain.on('drag-start', () => rec('drag-start')); ipcMain.on('drag-end', () => rec('drag-end'));
  let last = null; C.cursorMoves = 0;
  setInterval(() => { const p = screen.getCursorScreenPoint(), k = p.x + ',' + p.y; if (last && k !== last) C.cursorMoves++; last = k; }, 20);
  return true;
}
// renderer probes on one clock (performance.now(); w = wall ms for cross-process): input events, #chat shown/hidden, the
// frames after it shows (rAF timestamp, opacity, rows drawn), the composer's focus, ticks
function probes() {
  const M = window.__m = { ev: [], ticks: 0 }, now = () => performance.now(), wall = () => performance.timeOrigin + performance.now();
  window.pet.on('tick', () => M.ticks++);
  for (const k of ['mousedown', 'mouseup']) window.addEventListener(k, e => M.ev.push({ k, t: e.timeStamp, at: now(), detail: e.detail }), true);
  const chat = document.getElementById('chat'); let was = chat.classList.contains('hidden');
  new MutationObserver(() => {
    const h = chat.classList.contains('hidden'); if (h === was) return; was = h;
    const t = now(); M.ev.push({ k: h ? 'hide' : 'show', t, w: wall() });
    if (h) return;
    const rec = { k: 'frames', t0: t, f: [] }; M.ev.push(rec);
    const step = ts => {
      const setup = !document.getElementById('setup').classList.contains('hidden');
      rec.f.push({ ts, w: performance.timeOrigin + ts, o: +getComputedStyle(chat).opacity, rows: setup ? document.getElementById('setup').childElementCount : document.querySelectorAll('#now .nr, #now .nempty').length });
      if (rec.f.length < 40 && !chat.classList.contains('hidden')) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }).observe(chat, { attributeFilter: ['class'] });
  document.getElementById('chatInput').addEventListener('focus', () => M.ev.push({ k: 'focus', t: now(), w: wall() }));
  return true;
}
async function start(tag, { state = {}, hotkey } = {}) {
  const v = await launch({ appDir: APP, root: ROOT, userData: UD(tag), state: { ...SEED, ...state }, hotkey, env: { ANTHROPIC_API_KEY: '', VIBEPET_CLAUDE_BIN: STUB } });
  await v.evalMain(instrument); await v.evalMain(stubs); await v.win.evaluate(probes);
  v.ev = (f, a) => v.win.evaluate(f, a);
  v.open = () => v.ev(() => !document.getElementById('chat').classList.contains('hidden'));
  v.events = () => v.ev(() => window.__m.ev);
  v.reset = () => v.ev(() => { window.__m.ev = []; });
  v.until = async (f, ms = 5000) => { const end = Date.now() + ms; for (;;) { const x = await v.ev(f); if (x) return x; if (Date.now() > end) return null; await sleep(25); } };
  v.ticks = () => v.ev(() => window.__m.ticks);
  v.nextTicks = async k => { const t0 = await v.ticks(); return v.until(new Function(`return window.__m.ticks >= ${t0 + k}`), 20000); };
  v.active = () => v.ev(() => { const a = document.activeElement, s = document.getElementById('setup');
    return { tag: a.tagName, id: a.id || null, k: a.dataset?.k || null, v: a.dataset?.v || null, perm: a.dataset?.perm || null, done: !!a.dataset?.done, text: (a.textContent || '').trim().slice(0, 40), inSetup: s.contains(a), bar: a.id === 'chatInput' }; });
  v.menuLabels = async () => {   // ⋯ → the native menu (captured, not shown): top items and Settings' items
    const t = Date.now(); await v.win.locator('#homeMore').click();
    for (let i = 0; i < 40 && !(await v.evalMain((_e, t) => globalThis.__canon.calls.some(c => c.kind === 'menuPopup' && c.at >= t), t)); i++) await sleep(50);
    return v.evalMain(() => { const m = globalThis.__canon.menus.at(-1); const s = m.items.find(i => i.label === 'Settings');
      return { top: m.items.map(i => i.label).filter(Boolean), settings: s ? s.submenu.items.map(i => ({ label: i.label, sub: i.submenu ? i.submenu.items.map(x => `${x.checked ? '●' : '○'} ${x.label}`) : undefined })).filter(i => i.label) : null }; });
  };
  v.menu = trail => v.evalMain(clickMenu, { trail });
  v.pt = await v.petPoint();
  return v;
}
// a click on Net with an explicit click count (CDP: Chromium takes MouseEvent.detail from it)
async function click(v, counts = [1], gap = 70) {
  await v.win.mouse.move(v.pt.x - 30, v.pt.y - 30); await v.win.mouse.move(v.pt.x, v.pt.y, { steps: 3 });
  for (let i = 0; i < counts.length; i++) { if (i) await sleep(gap); await v.win.mouse.down({ clickCount: counts[i] }); await sleep(50); await v.win.mouse.up({ clickCount: counts[i] }); }
}
const closeHome = async v => { if (await v.open()) { await v.win.keyboard.press('Escape'); await v.until(() => document.getElementById('chat').classList.contains('hidden')); } await sleep(250); };
// one open, read off the probes: ms from the last mouseup (or from w0, main's wall clock) to each mark
function marks(ev, w0, first = false) {
  const up = ev.filter(e => e.k === 'mouseup').at(first ? 0 : -1), show = ev.find(e => e.k === 'show'), fr = ev.find(e => e.k === 'frames'), focus = ev.find(e => e.k === 'focus');
  const f = fr ? fr.f : [], vis = f.find(x => x.o >= 0.5), rows = f.find(x => x.rows > 0);
  if (w0 != null) return { toShown: show && r1(show.w - w0), toFrame1: f[0] && r1(f[0].w - w0), toPainted: f[1] && r1(f[1].w - w0), toVisible: vis && r1(vis.w - w0), toRows: rows && r1(rows.w - w0), toFocus: focus && r1(focus.w - w0) };
  const t = up && up.t;
  return { detail: up && up.detail, toShown: show && r1(show.t - t), toFrame1: f[0] && r1(f[0].ts - t), toPainted: f[1] && r1(f[1].ts - t), toVisible: vis && r1(vis.ts - t), toRows: rows && r1(rows.ts - t), toFocus: focus && r1(focus.t - t), downToPainted: f[1] && r1(f[1].ts - ev.filter(e => e.k === 'mousedown').at(first ? 0 : -1).t) };
}
const summary = (rows, keys) => Object.fromEntries(keys.map(k => [k, med(rows.map(r => r[k]))]));

async function partA() {
  log('A: click latency');
  const v = await start('a'), A = R.a = { load0: load(), single: [], double: [], close: [] };
  try {
    await sleep(3500);   // a tick or two: rows are the live ones
    for (let i = 0; i < n; i++) {   // single click → Home, then Esc (the critic's protocol)
      await closeHome(v); await v.reset();
      await click(v, [1]);
      await v.until(() => (window.__m.ev.find(e => e.k === 'frames')?.f.length || 0) >= 12, 6000);
      const m = { ...marks(await v.events()), load: load() }; A.single.push(m); log(' single', i, JSON.stringify(m));
      if (i === 0) { await sleep(400); await v.shot(path.join(OUT, 'a1-single-click-open.png')); }
    }
    for (let i = 0; i < n; i++) {   // double click from closed: opens once, stays open; then a later single click closes
      await closeHome(v); await v.reset();
      await click(v, [1, 2]); await sleep(700);
      const ev = await v.events(), m = { ...marks(ev, null, true), shows: ev.filter(e => e.k === 'show').length, hides: ev.filter(e => e.k === 'hide').length, openAfter: await v.open(), ups: ev.filter(e => e.k === 'mouseup').map(e => e.detail) };
      if (i === 0) await v.shot(path.join(OUT, 'a2-double-click-open.png'));
      await v.reset(); await click(v, [1]);   // the next single click (700 ms on: CDP sends clickCount 1)
      await v.until(() => window.__m.ev.some(e => e.k === 'hide'), 3000);
      const ev2 = await v.events(), u = ev2.filter(e => e.k === 'mouseup').at(-1), h = ev2.find(e => e.k === 'hide');
      m.nextClickCloses = !(await v.open()); m.nextClickToHidden = u && h ? r1(h.t - u.t) : null; m.load = load();
      A.double.push(m); log(' double', i, JSON.stringify(m));
      if (i === 0) await v.shot(path.join(OUT, 'a3-next-click-closed.png'));
    }
    A.singleMedian = summary(A.single, ['toShown', 'toFrame1', 'toPainted', 'toVisible', 'toRows', 'toFocus', 'downToPainted']);
    A.doubleMedian = summary(A.double, ['toShown', 'toPainted', 'toVisible', 'nextClickToHidden']);   // from the double's first mouseup
    A.doubleOk = A.double.every(d => d.shows === 1 && d.hides === 0 && d.openAfter && d.nextClickCloses);
    A.load1 = load(); A.realCursorMoves = await v.evalMain(() => globalThis.__canon.cursorMoves); A.winBounds = await v.evalMain(() => globalThis.__vibepet.win().getBounds());
  } finally { A.close = await v.close(); save(); }
}

async function partB() {
  log('B: Open Home key handler, run in main');
  const v = await start('b'), B = R.b = { load0: load(), trials: [] };
  try {
    await sleep(3500);
    B.hasPress = await v.evalMain(() => typeof globalThis.__vibepet.press === 'function');
    B.keys = await v.evalMain(() => globalThis.__vibepet.keys ? globalThis.__vibepet.keys() : null);
    if (!B.hasPress) { B.note = 'no Open Home key in this build: __vibepet.press is missing (main binds only the jump key and ⌃⌥⌘R)'; return; }
    for (let i = 0; i < n; i++) {
      await closeHome(v); await v.reset();
      const w0 = await v.evalMain(() => { const t = performance.timeOrigin + performance.now(); globalThis.__vibepet.press('home'); return t; });
      await v.until(() => (window.__m.ev.find(e => e.k === 'frames')?.f.length || 0) >= 12, 6000);
      const m = { ...marks(await v.events(), w0), active: (await v.active()).id, open: await v.open(), load: load() };
      if (i === 0) { await sleep(300); await v.shot(path.join(OUT, 'b1-home-key-open-caret.png')); }
      await v.evalMain(() => globalThis.__vibepet.press('home'));   // the same key again closes it, as a launcher's does
      m.secondPressCloses = !!(await v.until(() => document.getElementById('chat').classList.contains('hidden'), 3000));
      B.trials.push(m); log(' key', i, JSON.stringify(m));
    }
    B.median = summary(B.trials, ['toShown', 'toFrame1', 'toPainted', 'toVisible', 'toRows', 'toFocus']);
    B.allCaretInBar = B.trials.every(t => t.active === 'chatInput' && t.open);
    B.load1 = load();
  } finally { B.close = await v.close(); save(); }
}

async function partC() {
  log('C: two instances, one key');
  const F19 = 'Control+Alt+Command+F19', F18 = 'Control+Alt+Command+F18', C = R.c = { load0: load(), accelerators: { jump: F19, home: F18 } };
  const lockDir = path.join(os.tmpdir(), 'vibepet-keys'), locks = () => { try { return fs.readdirSync(lockDir).map(f => ({ f, ...JSON.parse(fs.readFileSync(path.join(lockDir, f), 'utf8')) })); } catch { return []; } };
  const state = { hotkey: F19, homeKey: F18 };
  const A = await start('c-A', { state, hotkey: '' });   // '' = the saved keys (VIBEPET_HOTKEY empty): F19 + F18 for real; under test never ⌃⌥⌘R
  let B;
  try {
    C.A = { pid: A.pid, keys: await A.evalMain(() => globalThis.__vibepet.keys()), registered: await A.evalMain(({ globalShortcut }, k) => k.map(x => [x, globalShortcut.isRegistered(x)]), [F19, F18, 'Control+Alt+Command+R', 'Control+Alt+Command+J']) };
    B = await start('c-B', { state, hotkey: '' });
    C.B = { pid: B.pid, keys: await B.evalMain(() => globalThis.__vibepet.keys()), registered: await B.evalMain(({ globalShortcut }, k) => k.map(x => [x, globalShortcut.isRegistered(x)]), [F19, F18, 'Control+Alt+Command+R', 'Control+Alt+Command+J']) };
    C.locksBoth = locks();
    log(' A', JSON.stringify(C.A)); log(' B', JSON.stringify(C.B));
    for (const [tag, v] of [['A', A], ['B', B]]) {   // each one's menu and Setup's Keys row
      await click(v, [1]); await v.until(() => !document.getElementById('chat').classList.contains('hidden'));
      C[tag].menu = await v.menuLabels();
      C[tag].setupMenu = await v.menu(['^Setup']);
      await v.until(() => !document.getElementById('setup').classList.contains('hidden') && document.getElementById('setupKeys'));
      await sleep(400);
      C[tag].setupKeys = await v.ev(() => document.getElementById('setupKeys').textContent);
      await v.shot(path.join(OUT, `c${tag === 'A' ? 1 : 2}-${tag}-setup-keys${tag === 'B' ? '-taken' : ''}.png`));
      log(' ', tag, JSON.stringify(C[tag].menu.settings?.filter(i => /key/i.test(i.label))), JSON.stringify(C[tag].setupKeys));
    }
    // B: stub register first (record only, true): ⌥⌘J must not reach the OS. Prove the stub holds before any menu click
    C.B.stub = await B.evalMain(({ globalShortcut }) => {
      const calls = globalThis.__canon.registers = [], real = globalShortcut.register;
      globalShortcut.register = (k, fn) => { calls.push(k); return true; };
      globalShortcut.register('Control+Alt+Command+F17', () => {});
      return { replaced: globalShortcut.register !== real, recorded: calls.slice(), osRegistered: globalShortcut.isRegistered('Control+Alt+Command+F17') };
    });
    log(' B stub', JSON.stringify(C.B.stub));
    if (C.B.stub.replaced && C.B.stub.recorded.length === 1 && !C.B.stub.osRegistered) {
      for (const [label, file] of [['⌥⌘J', 'c3-B-setup-keys-alt-cmd-J.png'], ['Off', 'c4-B-setup-keys-off.png']]) {
        await B.menuLabels();
        const r = await B.menu(['^Settings$', '^Jump key', `^${label}$`]);
        await sleep(600);
        const row = await B.ev(() => document.getElementById('setupKeys').textContent), keys = await B.evalMain(() => globalThis.__vibepet.keys().jump);
        C.B[label] = { menuClick: r, setupKeys: row, jump: keys, setupStillOpen: await B.ev(() => !document.getElementById('setup').classList.contains('hidden')) };
        await B.shot(path.join(OUT, file));
        log(' B', label, JSON.stringify(C.B[label]));
      }
      C.B.menuAfter = (await B.menuLabels()).settings?.filter(i => /key/i.test(i.label));
      C.B.registerCalls = await B.evalMain(() => globalThis.__canon.registers);
    } else C.B.skipped = 'register stub did not hold: ⌥⌘J / Off not driven';
    // the holder quits: B's Open Home key (still F18, taken) is free, and B takes it over (main checks every 10 s)
    const tq = Date.now();
    C.A.close = await A.close();
    C.locksAfterAQuit = locks();
    let took = null;
    for (let i = 0; i < 80 && !(took = (await B.evalMain(() => globalThis.__vibepet.keys().home)).on); i++) await sleep(250);
    C.B.takeover = { homeOn: !!took, ms: Date.now() - tq, keys: await B.evalMain(() => globalThis.__vibepet.keys()) };
    await B.nextTicks(1);
    C.B.takeover.setupKeys = await B.ev(() => document.getElementById('setupKeys')?.textContent);
    await B.shot(path.join(OUT, 'c5-B-took-over-home-key.png'));
    log(' B takeover', JSON.stringify(C.B.takeover));
  } finally {
    if (!C.A.close) C.A.close = await A.close();
    if (B) C.B.close = await B.close();
    C.locksAfter = locks().filter(l => [A.pid, B?.pid].includes(l.pid));
    C.load1 = load(); save();
  }
}

async function partD() {
  log('D: /setup from the keyboard');
  const v = await start('d'), D = R.d = { load0: load(), steps: {} }, S = D.steps;
  const kb = v.win.keyboard, setupShown = () => v.ev(() => !document.getElementById('setup').classList.contains('hidden'));
  const barShown = () => v.ev(() => { const f = document.getElementById('chatForm'); return getComputedStyle(f).display !== 'none' && f.offsetHeight > 0; });
  const notes = () => v.ev(() => [...document.querySelectorAll('#msgs .msg.note')].map(m => m.textContent.slice(0, 60)));
  const pet = () => v.evalMain(() => globalThis.__vibepet.state().pet);
  try {
    await sleep(3500);
    await click(v, [1]); await v.until(() => !document.getElementById('chat').classList.contains('hidden'));
    await sleep(300);
    S.open = { active: await v.active() };
    await kb.type('/setup'); await kb.press('Enter'); await sleep(500);
    S.afterSetup = { setupShown: await setupShown(), barShown: await barShown(), active: await v.active() };
    await v.shot(path.join(OUT, 'd1-setup-bar-visible.png'));
    // Tab walk from where the caret is: every control, never the page behind
    const controls = await v.ev(() => [...document.querySelectorAll('#setup button:not(:disabled)')].map(b => b.dataset.k ? `${b.dataset.k}:${b.dataset.v}` : b.dataset.perm ? `perm:${b.dataset.perm}` : b.dataset.done ? 'done' : b.textContent.trim()));
    const walk = [];
    for (let i = 0; i < controls.length + 1; i++) { await kb.press('Tab'); const a = await v.active(); walk.push(a.bar ? 'BAR' : a.inSetup ? (a.k ? `${a.k}:${a.v}` : a.perm ? `perm:${a.perm}` : a.done ? 'done' : a.text) : `OUTSIDE:${a.tag}#${a.id}`); }
    const seen = new Set(walk.filter(w => controls.includes(w)));
    S.tab = { controls: controls.length, walk, allReached: controls.every(c => seen.has(c)), outside: walk.filter(w => w.startsWith('OUTSIDE')), barAt: walk.indexOf('BAR') };
    const atBar = (await v.active()).bar;
    await kb.press('Shift+Tab'); const sb = await v.active(); S.tab.shiftTabFromBar = atBar ? (sb.done ? 'done' : sb.bar ? 'BAR' : sb.inSetup ? `${sb.k}:${sb.v}` : `OUTSIDE:${sb.tag}#${sb.id}`) : 'walk did not end on the bar';
    await kb.press('Tab');   // back to the bar
    log(' tab', JSON.stringify(S.tab));
    // focus survives 3 ticks: Tab to Size · Medium, mark it, wait 3 ticks, then Tab on (lands on Large, not the top)
    for (let i = 0; i < controls.length + 1 && (await v.active()).v !== 'm'; i++) await kb.press('Tab');
    await v.ev(() => { document.activeElement.__mark = 1; });
    await v.shot(path.join(OUT, 'd2-focus-on-medium.png'));
    const t0 = await v.ticks(); await v.nextTicks(3);
    S.ticks = { waited: (await v.ticks()) - t0, kept: await v.ev(() => document.activeElement.__mark === 1 && document.activeElement.isConnected), active: await v.active() };
    await kb.press('Tab'); S.ticks.nextTab = (await v.active()).v;
    log(' ticks', JSON.stringify(S.ticks));
    // a choice from the keyboard: Enter on Alerts · + Finished, then on Everything; the pressed control keeps the focus
    const alerts0 = await v.evalMain(() => globalThis.__vibepet.state().alerts);
    for (let i = 0; i < controls.length + 1 && (await v.active()).v !== 'done'; i++) await kb.press('Tab');
    await kb.press('Enter'); await sleep(600);
    S.choice = { pressed: await v.active(), on: await v.ev(() => document.activeElement.classList.contains('on')), alerts: await v.evalMain(() => globalThis.__vibepet.state().alerts) };
    await kb.press('Tab'); await kb.press('Enter'); await sleep(600);
    S.choice.back = { active: await v.active(), alerts: await v.evalMain(() => globalThis.__vibepet.state().alerts), alerts0 };
    log(' choice', JSON.stringify(S.choice));
    // typing on a pet button never changes the pet: '/today' ⏎ with the focus on Sprout, then in the bar
    for (let i = 0; i < controls.length + 1 && (await v.active()).v !== 'sprout'; i++) await kb.press('Tab');
    const pet0 = await pet(), n0 = (await notes()).length, onSprout = (await v.active()).v;
    await kb.type('/today'); await kb.press('Enter'); await sleep(900);
    S.typedOnSprout = { focusWas: onSprout, pet0, pet: await pet(), notesAdded: (await notes()).length - n0, lastNote: (await notes()).at(-1) || null, active: await v.active(), setupShown: await setupShown() };
    await v.shot(path.join(OUT, 'd3-today-typed-on-sprout.png'));
    const n1 = (await notes()).length;
    await kb.type('/today'); await kb.press('Enter'); await sleep(900);
    S.typedInBar = { pet: await pet(), notesAdded: (await notes()).length - n1, active: await v.active(), setupShown: await setupShown() };
    log(' typed', JSON.stringify(S.typedOnSprout), JSON.stringify(S.typedInBar));
    // Esc leaves setup; the next open (a click on Net) is the Now list
    await kb.press('Escape'); await sleep(400);
    S.esc = { closed: !(await v.open()) };
    await click(v, [1]); await v.until(() => !document.getElementById('chat').classList.contains('hidden')); await sleep(500);
    S.esc.reopen = { setupShown: await setupShown(), nowShown: await v.ev(() => !document.getElementById('now').classList.contains('hidden') && document.getElementById('now').childElementCount > 0), active: (await v.active()).id };
    await v.shot(path.join(OUT, 'd4-esc-then-reopen-now.png'));
    log(' esc', JSON.stringify(S.esc));
    // Done from the keyboard: /setup, Shift+Tab (Done), Enter → Home, the caret back in the bar
    await kb.type('/setup'); await kb.press('Enter'); await sleep(400);
    await kb.press('Shift+Tab'); const onDone = (await v.active()).done;
    await kb.press('Enter'); await sleep(600);
    S.done = { onDone, setupShown: await setupShown(), nowShown: await v.ev(() => !document.getElementById('now').classList.contains('hidden')), active: (await v.active()).id, setupDone: await v.evalMain(() => globalThis.__vibepet.state().setupDone) };
    await v.shot(path.join(OUT, 'd5-done-caret-in-bar.png'));
    log(' done', JSON.stringify(S.done));
    D.load1 = load();
  } finally { D.close = await v.close(); save(); }
}

(async () => {
  for (const [p, fn] of [['a', partA], ['b', partB], ['c', partC], ['d', partD]]) if (parts.has(p)) {
    try { await fn(); } catch (e) { (R[p] ||= {}).error = e.stack.split('\n').slice(0, 4).join(' | '); log(p, 'ERROR', e.message); }
    save();
  }
  R.endedAt = new Date().toISOString(); save();
  log('wrote', resFile);
})();
