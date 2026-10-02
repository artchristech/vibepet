// ports-truth recapture helpers: a fresh, instrumented vibepet from the fix worktree against the isolated fleet root; fixture
// servers only (cwd = a fleet repo), each in its own process group, all killed at the end. $0: no fleet turn.
const os = require('os'), path = require('path'), fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-ports-truth';
const { launch } = require(WT + '/test/ultra/launch');
const ROOT = '/Users/christopherharris/.vibepet-ultra/root/.claude';
const USERDATA = '/Users/christopherharris/.vibepet-ultra/userdata/r1-ports-truth';
const OUT = '/Users/christopherharris/projects/vibepet/docs/ultra/round-1/fixes/ports-truth/after';
const FLEET = '/Users/christopherharris/.vibepet-ultra/fleet';
const FX = OUT + '/scripts/fx';
const sleep = ms => new Promise(r => setTimeout(r, ms)), L_sleep = sleep;
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const load = () => os.loadavg().map(x => +x.toFixed(2));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim();
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const stats = a => ({ n: a.length, median: median(a), min: Math.min(...a), max: Math.max(...a) });

// main-process instrumentation: dialogs answer themselves (C.answer), openExternal/menus/events only recorded
function instrumentMain({ dialog, shell, Menu }) {
  if (globalThis.__rc) return { already: true };
  const C = globalThis.__rc = { calls: [], menus: [], answer: 0 };
  const rec = (kind, data = {}) => C.calls.push({ kind, at: Date.now(), ...data });
  dialog.showMessageBox = async (...a) => { const o = a.find(x => x && typeof x === 'object' && 'message' in x) || {};
    rec('dialog', { message: String(o.message || ''), detail: String(o.detail || ''), answered: C.answer }); return { response: C.answer, checkboxChecked: false }; };
  shell.openExternal = async url => { rec('openExternal', { url: String(url) }); };
  shell.showItemInFolder = p => { rec('showItemInFolder', { path: String(p) }); };
  Menu.prototype.popup = function () { C.menus.push(this); rec('menuPopup', {}); };
  const wc = globalThis.__vibepet.win().webContents, o = wc.send.bind(wc);
  wc.send = (ch, d) => { if (ch === 'event') rec('event', { data: d }); else if (ch === 'tick') rec('tick', { servers: (d.servers || []).map(s => s.port) }); return o(ch, d); };
  return { ok: true };
}
function clickMenu(_e, { trail }) {
  const C = globalThis.__rc, menu = C.menus[C.menus.length - 1];
  if (!menu) return { ok: false, why: 'no menu' };
  let items = menu.items, item;
  for (const step of trail) { const re = new RegExp(step); item = items.find(i => i.label && re.test(i.label));
    if (!item) return { ok: false, why: `no ${step} in [${items.map(i => i.label).filter(Boolean).join(' | ')}]` };
    items = item.submenu ? item.submenu.items : []; }
  item.click(); return { ok: true, label: item.label };
}
const menuData = () => { const C = globalThis.__rc, m = C.menus[C.menus.length - 1]; if (!m) return null;
  const walk = items => items.map(i => ({ label: i.label, enabled: i.enabled, type: i.type, sub: i.submenu ? walk(i.submenu.items) : undefined })); return walk(m.items); };
// renderer: every chip set change (a port in / out of #now .srv) and every panel note, timed on the wall clock
function observe() {
  if (window.__rc) return;
  const R = window.__rc = { chips: [], notes: [] }; let cur = new Map();   // port → Open active?
  const look = () => { const now = new Map([...document.querySelectorAll('#now .srv')].map(e => [+e.dataset.port, e.querySelector('[data-do=open]')?.getAttribute('aria-disabled') !== 'true'])), t = Date.now();
    for (const [p, on] of now) if (!cur.has(p)) R.chips.push({ port: p, kind: 'add', on, at: t }); else if (cur.get(p) !== on) R.chips.push({ port: p, kind: on ? 'active' : 'inactive', at: t });
    for (const p of cur.keys()) if (!now.has(p)) R.chips.push({ port: p, kind: 'remove', at: t });
    cur = now; };
  new MutationObserver(look).observe(document.getElementById('now'), { childList: true, subtree: true, attributes: true });
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('msg')) R.notes.push({ text: n.textContent, cls: n.className, at: Date.now() }); })
    .observe(document.getElementById('msgs'), { childList: true });
  look();
}

async function start({ state = {}, fresh = true, userData = USERDATA } = {}) {
  if (fresh) fs.rmSync(userData, { recursive: true, force: true });
  const v = await launch({ appDir: WT, root: ROOT, userData, hotkey: 'off', state: { setupDone: true, muted: true, ...state } });
  v.inst = await v.evalMain(instrumentMain);
  v.calls = async (since = 0) => v.evalMain((_, s) => globalThis.__rc.calls.filter(c => c.at >= s), since);
  v.setAnswer = n => v.evalMain((_, n) => { globalThis.__rc.answer = n; }, n);
  v.menuData = () => v.evalMain(menuData);
  v.clickMenu = trail => v.evalMain(clickMenu, { trail });
  v.observe = () => v.win.evaluate(observe);
  v.rec = () => v.win.evaluate(() => window.__rc);
  v.chips = () => v.win.evaluate(() => [...document.querySelectorAll('#now .srv')].map(e => { const b = e.querySelector('[data-do=open]');
    return { port: +e.dataset.port, key: e.dataset.key, label: b.textContent, inactive: b.getAttribute('aria-disabled') === 'true', disabled: b.disabled, title: b.title, cls: b.className }; }));
  v.more = () => v.win.evaluate(() => document.querySelector('#now .srvmore')?.textContent || null);
  v.snap = () => v.evalMain(() => { const s = globalThis.__vibepet.snapshot(); return { servers: s.servers, local: s.local, alerts: s.alerts, agents: s.agents.map(a => ({ id: a.id, name: a.name, phase: a.phase })) }; });
  // a panel shot with the localhost footer scrolled into view (the session rows fill the panel above it)
  v.shotTo = async name => { const f = path.join(OUT, 'shots', name + '.png'); await v.win.evaluate(() => document.querySelector('#now .nfoot')?.scrollIntoView({ block: 'end' })).catch(() => {}); await L_sleep(150); await v.shot(f); return f; };
  v.shotFoot = async name => { const f = path.join(OUT, 'shots', name + '.png'); try { const el = await v.win.$('#now .nfoot'); if (el) await el.screenshot({ path: f, timeout: 8000 }); return f; } catch (e) { console.error('shotFoot', name, e.message.split('\n')[0]); return null; } };
  return v;
}

// fixture servers: cwd = a fleet repo, own process group (we stop exactly what we started)
const mine = [];
function serve(cmd, args, { cwd, tag } = {}) {
  const p = spawn(cmd, args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { tag, cmd: [cmd, ...args].join(' '), cwd, pid: p.pid, t0: Date.now(), out: '', listenAt: null, readyAt: null, exitAt: null, proc: p };
  p.stdout.on('data', d => { s.out += d; const m = String(d).match(/LISTENING (\d+)/); if (m && !s.listenAt) s.listenAt = +m[1]; const r = String(d).match(/READY_AT (\d+)/); if (r) s.readyAt = +r[1];
    if (!s.listenAt && /Serving HTTP/.test(String(d))) s.listenAt = Date.now(); });
  p.stderr.on('data', d => { s.out += d; if (!s.listenAt && /Serving HTTP/.test(String(d))) s.listenAt = Date.now(); });
  p.on('exit', (c, sig) => { s.exitAt = Date.now(); s.code = c; s.sig = sig; });
  mine.push(s); return s;
}
function listening(port) { try { return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } }
async function waitListen(s, port, ms = 15e3) { const t = Date.now(); while (!s.listenAt && Date.now() - t < ms) { if (listening(port).length) { s.listenAt ||= Date.now(); break; } await sleep(30); } return s.listenAt; }
function kill(s, sig = 'SIGTERM') { try { process.kill(-s.pid, sig); return true; } catch { try { process.kill(s.pid, sig); return true; } catch { return false; } } }
async function stopAll() { for (const s of mine) if (s.exitAt == null) kill(s); await sleep(800); for (const s of mine) if (s.exitAt == null) kill(s, 'SIGKILL'); await sleep(200);
  return mine.map(s => ({ tag: s.tag, pid: s.pid, exited: s.exitAt != null })); }
async function waitFor(fn, ms = 30e3, every = 50) { const t = Date.now(); while (Date.now() - t < ms) { const r = await fn(); if (r) return { r, ms: Date.now() - t }; await sleep(every); } return null; }
let portN = 47600 + Math.floor(Math.random() * 200);
const nextPort = () => { for (;;) { const p = portN++; if (!listening(p).length) return p; } };
const repo = n => path.join(FLEET, n);
module.exports = { WT, ROOT, USERDATA, OUT, FLEET, FX, sleep, load, uptime, median, stats, start, serve, waitListen, listening, kill, stopAll, waitFor, nextPort, repo, mine };
