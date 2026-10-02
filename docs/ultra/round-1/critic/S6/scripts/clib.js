// S6 critic helpers: launch a fresh, instrumented vibepet against the isolated fleet root; servers in fleet repos.
const os = require('os'), path = require('path'), fs = require('fs');
const { execFileSync, spawn } = require('child_process');
const INT = '/Users/christopherharris/.vibepet-ultra/int';
const { launch } = require(INT + '/test/ultra/launch');
const ROOT = '/Users/christopherharris/.vibepet-ultra/root/.claude';
const USERDATA = '/Users/christopherharris/.vibepet-ultra/userdata/r1-S6-critic';
const OUT = '/Users/christopherharris/projects/vibepet/docs/ultra/round-1/critic/S6';
const FLEET = '/Users/christopherharris/.vibepet-ultra/fleet';
const FX = OUT + '/scripts/fx';
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
const load = () => os.loadavg().map(x => +x.toFixed(2));
const iso = (t = Date.now()) => new Date(t).toISOString();
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

// main-process instrumentation (runs inside Electron main)
function instrumentMain({ dialog, shell, clipboard, Menu }) {
  if (globalThis.__crit) return { already: true };
  const C = globalThis.__crit = { calls: [], menus: [], answer: 0 };
  const rec = (kind, data = {}) => C.calls.push({ kind, at: Date.now(), ...data });
  dialog.showMessageBox = async (...a) => { const o = a.find(x => x && typeof x === 'object' && 'message' in x) || {};
    rec('dialog', { message: String(o.message || ''), detail: String(o.detail || ''), buttons: o.buttons, defaultId: o.defaultId, answered: C.answer });
    return { response: C.answer, checkboxChecked: false }; };
  dialog.showMessageBoxSync = () => { rec('dialogSync'); return 1; };
  shell.openExternal = async url => { rec('openExternal', { url: String(url) }); };
  shell.showItemInFolder = p => { rec('showItemInFolder', { path: String(p) }); };
  shell.openPath = async p => { rec('openPath', { path: String(p) }); return ''; };
  clipboard.writeText = t => { rec('clipboard', { text: String(t).slice(0, 200) }); };
  Menu.prototype.popup = function () { C.menus.push(this); rec('menuPopup', { items: this.items.map(i => i.label).filter(Boolean) }); };
  const w = globalThis.__vibepet.win(), wc = w.webContents, o = wc.send.bind(wc);
  wc.send = (ch, d) => { if (ch === 'event') rec('event', { data: d }); else if (ch === 'tick') rec('tick', { servers: (d.servers || []).map(s => s.port + ':' + s.pid) }); return o(ch, d); };
  return { ok: true };
}
// the captured native menu as data (labels, enabled, nested)
function menuData() {
  const C = globalThis.__crit, m = C.menus[C.menus.length - 1]; if (!m) return null;
  const walk = items => items.map(i => ({ label: i.label, enabled: i.enabled, type: i.type, sub: i.submenu ? walk(i.submenu.items) : undefined }));
  return walk(m.items);
}
function clickMenu(_e, { trail }) {
  const C = globalThis.__crit, menu = C.menus[C.menus.length - 1];
  if (!menu) return { ok: false, why: 'no menu' };
  let items = menu.items, item;
  for (const step of trail) { const re = new RegExp(step); item = items.find(i => i.label && re.test(i.label));
    if (!item) return { ok: false, why: `no ${step} in [${items.map(i => i.label).filter(Boolean).join(' | ')}]` };
    items = item.submenu ? item.submenu.items : []; }
  item.click(); return { ok: true, label: item.label };
}

async function start({ state = {}, fresh = false } = {}) {
  if (fresh) fs.rmSync(USERDATA, { recursive: true, force: true });
  const v = await launch({ appDir: INT, root: ROOT, userData: USERDATA, hotkey: 'off', state: { setupDone: true, muted: true, ...state } });
  v.inst = await v.evalMain(instrumentMain);
  v.calls = async (since = 0) => (await v.evalMain((_, s) => globalThis.__crit.calls.filter(c => c.at >= s), since));
  v.setAnswer = n => v.evalMain((_, n) => { globalThis.__crit.answer = n; }, n);
  v.menuData = () => v.evalMain(menuData);
  v.clickMenu = trail => v.evalMain(clickMenu, { trail });
  v.chips = () => v.win.evaluate(() => [...document.querySelectorAll('#now .srv')].map(e => { const b = e.querySelector('[data-do=open]');
    return { port: +e.dataset.port, pid: +e.dataset.pid, label: b.textContent, disabled: b.disabled, title: b.title }; }));
  v.rows = () => v.win.evaluate(() => [...document.querySelectorAll('#now .nr')].map(e => e.querySelector('.nm')?.innerText.replace(/\s+/g, ' ').trim()));
  v.nowText = () => v.win.evaluate(() => document.querySelector('#now')?.innerText || '');
  v.cache = () => v.evalMain(() => { const p = globalThis.__vibepet.require('./ports').poll(1e15); return { at: p.at, servers: p.servers.map(s => ({ pid: s.pid, port: s.port, host: s.host, kind: s.kind, project: s.project, dir: s.dir, http: s.http, status: s.status, title: s.title })), procs: p.procs.length, tasks: p.tasks.map(t => ({ id: t.id, name: t.name, project: t.project, running: t.running, status: t.status })) }; });
  v.snap = () => v.evalMain(() => { const s = globalThis.__vibepet.snapshot(); return { servers: s.servers, local: s.local, agents: s.agents.map(a => ({ name: a.name, phase: a.phase })), alerts: s.alerts }; });
  v.bubble = () => v.win.evaluate(() => { const b = document.getElementById('bubble'); const r = b.getBoundingClientRect(); const chat = document.getElementById('chat');
    const vis = !b.classList.contains('hidden') && getComputedStyle(b).display !== 'none' && r.width > 0;
    const pts = vis ? [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 8, r.top + r.height / 2], [r.right - 8, r.top + r.height / 2]] : [];
    const hits = pts.map(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? (el === b || b.contains(el) ? 'bubble' : chat.contains(el) ? 'chat:' + (el.id || el.className || el.tagName) : (el.id || el.tagName)) : null; });
    return { text: b.textContent, visible: vis, rect: [r.left, r.top, r.width, r.height].map(Math.round), z: getComputedStyle(b).zIndex, chatOpen: !chat.classList.contains('hidden'), chatZ: getComputedStyle(chat).zIndex, hits, occluded: vis && hits.every(h => h && h.startsWith('chat')) }; });
  v.snapShot = async name => { const f = path.join(OUT, 'shots', name + '.png'); await v.shot(f); return f; };
  return v;
}

// servers we start (cwd = a fleet repo); each in its own process group so we stop exactly what we started
const mine = [];
function serve(cmd, args, { cwd, env = {}, tag } = {}) {
  const t0 = Date.now();
  const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const s = { tag, cmd: [cmd, ...args].join(' '), cwd, pid: p.pid, t0, out: '', listenAt: null, exitAt: null, proc: p };
  p.stdout.on('data', d => { s.out += d; const m = String(d).match(/LISTENING (\d+)/); if (m && !s.listenAt) s.listenAt = +m[1]; if (!s.listenAt && /Serving HTTP/.test(String(d))) s.listenAt = Date.now(); });
  p.stderr.on('data', d => { s.out += d; });
  p.on('exit', (c, sig) => { s.exitAt = Date.now(); s.code = c; s.sig = sig; });
  mine.push(s); return s;
}
async function waitListen(s, port, ms = 10e3) { const t = Date.now(); while (!s.listenAt && Date.now() - t < ms) { if (listening(port).length) { s.listenAt ||= Date.now(); break; } await sleep(50); } return s.listenAt; }
function listening(port) { try { return execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } }
function kill(s, sig = 'SIGTERM') { try { process.kill(-s.pid, sig); return true; } catch { try { process.kill(s.pid, sig); return true; } catch { return false; } } }
async function stopAll() { for (const s of mine) if (s.exitAt == null) kill(s); await sleep(600); for (const s of mine) if (s.exitAt == null) kill(s, 'SIGKILL'); }
async function waitFor(fn, ms = 30e3, every = 100) { const t = Date.now(); while (Date.now() - t < ms) { const r = await fn(); if (r) return { r, ms: Date.now() - t }; await sleep(every); } return null; }
function fleetStatus() { try { return JSON.parse(execFileSync('node', [INT + '/test/fleet/fleet.js', 'status', '--json'], { encoding: 'utf8', timeout: 60e3 })); } catch (e) { try { return JSON.parse(e.stdout); } catch { return { error: String(e.message).slice(0, 200) }; } } }
function truthLine(st) { if (!st || !st.members) return st; return st.members.map(m => `${m.name}:${m.state}${m.ok ? '' : '(FAIL)'} reg=${m.registry ? m.registry.status + (m.registry.waitingFor ? '(' + m.registry.waitingFor + ')' : '') : '-'} last=${m.last && m.last.kind}`); }
module.exports = { INT, ROOT, USERDATA, OUT, FLEET, FX, sleep, load, iso, median, start, serve, waitListen, listening, kill, stopAll, waitFor, fleetStatus, truthLine, mine };
