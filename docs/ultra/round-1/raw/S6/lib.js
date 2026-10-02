// S6 drive helpers: launch the real vibepet against the isolated fleet root, instrument main (dialogs answer from a
// variable, openExternal/clipboard/menus record), watch the Home footer in the renderer, start/stop OUR fixture servers.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), http = require('http');
const { spawn, execFileSync } = require('child_process');
const INT = '/Users/christopherharris/.vibepet-ultra/int';
const ROOT = '/Users/christopherharris/.vibepet-ultra/root/.claude';
const USERDATA = '/Users/christopherharris/.vibepet-ultra/userdata/r1-S6';
const FLEET = '/Users/christopherharris/.vibepet-ultra/fleet';
const PACK = '/Users/christopherharris/projects/vibepet/docs/ultra/round-1/packs/S6';
const SP = path.join(__dirname);
const FX = path.join(SP, 'fx');
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (const k of Object.keys(process.env)) if (/^CLAUDE/.test(k)) delete process.env[k];   // nothing of this session leaks
const { launch } = require(INT + '/test/ultra/launch');

const load = () => os.loadavg().map(x => +x.toFixed(2));
const iso = t => new Date(t).toISOString().slice(11, 23) + 'Z';

// ---------- our processes (the only ones this drive may signal) ----------
const OURS = path.join(SP, 'ours.jsonl');
const kids = [];
function own(proc, meta) { kids.push(proc); fs.appendFileSync(OURS, JSON.stringify({ pid: proc.pid, at: Date.now(), ...meta }) + '\n'); return proc; }
process.on('exit', () => { for (const k of kids) { try { process.kill(-k.pid, 'SIGTERM'); } catch {} try { k.kill('SIGTERM'); } catch {} } });
const env = extra => { const e = { ...process.env, ...extra }; for (const k of Object.keys(e)) if (/^CLAUDE/.test(k)) delete e[k]; return e; };
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function waitDead(pid, timeout = 15e3) { const t = Date.now(); while (alive(pid)) { if (Date.now() - t > timeout) return null; await sleep(15); } return Date.now(); }
function listeners(port) {
  let out = ''; try { out = execFileSync('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8' }); } catch (e) { out = e.stdout || ''; }
  const rows = []; let pid = 0;
  for (const l of out.split('\n')) { if (l[0] === 'p') pid = +l.slice(1); else if (l[0] === 'n' && pid) rows.push({ pid, addr: l.slice(1) }); }
  return rows;
}
function lineWaiter(proc, re, timeout = 15e3) {
  return new Promise((res, rej) => {
    let buf = ''; const t = setTimeout(() => rej(new Error(`no ${re} in ${timeout} ms: ${buf.slice(-300)}`)), timeout);
    const on = d => { buf += d; const m = buf.match(re); if (m) { clearTimeout(t); res({ m, at: Date.now(), buf }); } };
    proc.stdout.on('data', on); proc.stderr.on('data', on);
    proc.on('exit', c => { clearTimeout(t); rej(new Error(`exited ${c} before ${re}: ${buf.slice(-300)}`)); });
  });
}
const repo = name => path.join(FLEET, name);
// node fixture: fx/server.js <port> [host] [title] [lifeMs]
async function nodeServer({ cwd, port, host = '', title = '', life = 900e3, extraArgs = [] }) {
  const p = own(spawn(process.execPath, [...extraArgs, path.join(FX, 'server.js'), String(port), host, title, String(life)], { cwd, env: env(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { kind: 'node', cwd, port });
  const r = await lineWaiter(p, /\{"(listenAt|error)".*\}/);
  const j = JSON.parse(r.m[0]);
  if (j.error) return { proc: p, error: j.error, at: j.at, pid: p.pid, port, cwd };
  return { proc: p, pid: p.pid, listener: p.pid, port, cwd, listenAt: j.listenAt, address: j.address, kind: 'node' };
}
// python3 -m http.server (the stdlib one-liner), unbuffered so its "Serving HTTP" line marks the listen
async function pyHttp({ cwd, port, bind = '127.0.0.1', dir = null }) {
  const args = ['-u', '-m', 'http.server', String(port), '--bind', bind, ...(dir ? ['--directory', dir] : [])];
  const p = own(spawn('python3', args, { cwd, env: env(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { kind: 'python', cwd, port });
  const r = await lineWaiter(p, /Serving HTTP on .*port (\d+)|Address already in use/);
  if (/already in use/.test(r.m[0])) return { proc: p, error: 'EADDRINUSE', at: r.at, pid: p.pid, port, cwd };
  return { proc: p, pid: p.pid, listener: p.pid, port, cwd, listenAt: r.at, kind: 'python http.server' };
}
// kestrel's own dev command: `npm start` = node src/server.js, PORT from env (README: serves GET /health)
async function npmStart({ cwd, port }) {
  const p = own(spawn('npm', ['start'], { cwd, env: env({ PORT: String(port) }), detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { kind: 'npm start', cwd, port });
  const r = await lineWaiter(p, new RegExp(`on :${port}`));
  const l = listeners(port)[0];
  return { proc: p, pid: p.pid, listener: l && l.pid, port, cwd, listenAt: r.at, kind: 'npm start → node src/server.js' };
}
async function prefork({ cwd, port, workers = 3, title = 'prefork app' }) {
  const p = own(spawn('python3', ['-u', path.join(FX, 'prefork.py'), String(port), String(workers), title], { cwd, env: env(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { kind: 'prefork', cwd, port });
  p.respawns = []; p.stdout.on('data', d => { for (const l of String(d).split('\n')) { try { const j = JSON.parse(l); if (j.respawned) p.respawns.push(j); } catch {} } });
  const r = await lineWaiter(p, /\{"listenAt".*\}/);
  const j = JSON.parse(r.m[0]);
  return { proc: p, pid: p.pid, listener: p.pid, workers: j.workers, port, cwd, listenAt: j.listenAt, kind: 'prefork' };
}
async function rawTcp({ cwd, port }) {
  const p = own(spawn(process.execPath, [path.join(FX, 'rawtcp.js'), String(port)], { cwd, env: env(), detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), { kind: 'rawtcp', cwd, port });
  const r = await lineWaiter(p, /\{"listenAt".*\}/);
  return { proc: p, pid: p.pid, listener: p.pid, port, cwd, listenAt: JSON.parse(r.m[0]).listenAt, kind: 'raw tcp' };
}
function idle({ cwd, secs = 900 }) {   // a long-running non-listening dev process (a watcher)
  return own(spawn(process.execPath, ['-e', `setInterval(()=>{},1000);setTimeout(()=>process.exit(0),${secs * 1000})`], { cwd, env: env(), detached: true, stdio: 'ignore' }), { kind: 'idle', cwd });
}
function stopOurs(s, sig = 'SIGTERM') { try { process.kill(-s.proc.pid, sig); } catch { try { process.kill(s.proc.pid, sig); } catch {} } }
function get(url, timeout = 1500) {
  return new Promise(res => {
    const q = http.get(url, { timeout }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b.slice(0, 200), remote: r.socket && r.socket.remoteAddress })); });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', e => res({ error: e.code || e.message }));
  });
}

// ---------- main-process instrumentation ----------
function instrument({ dialog, shell, clipboard, Menu }) {
  if (globalThis.__s6) return { already: true };
  const C = globalThis.__s6 = { calls: [], menus: [], answer: 0, polls: [] };
  const rec = (kind, data = {}) => { C.calls.push({ kind, at: Date.now(), ...data }); if (C.calls.length > 3000) C.calls.shift(); };
  dialog.showMessageBox = async (...a) => { const o = a.find(x => x && typeof x === 'object' && 'message' in x) || {}; rec('dialog', { message: String(o.message || ''), detail: String(o.detail || ''), buttons: o.buttons, defaultId: o.defaultId, answer: C.answer }); return { response: C.answer, checkboxChecked: false }; };
  dialog.showMessageBoxSync = () => { rec('dialogSync'); return 1; };
  dialog.showOpenDialog = async () => { rec('openDialog'); return { canceled: true, filePaths: [] }; };
  shell.openExternal = async url => { rec('openExternal', { url: String(url) }); };
  shell.openPath = async p => { rec('openPath', { path: String(p) }); return ''; };
  shell.showItemInFolder = p => { rec('showItemInFolder', { path: String(p) }); };
  clipboard.writeText = t => { rec('clipboard', { text: String(t).slice(0, 200) }); };
  Menu.prototype.popup = function () { C.menus.push(this); rec('menuPopup', { items: this.items.map(i => i.label).filter(Boolean) }); };
  const wc = globalThis.__vibepet.win().webContents, orig = wc.send.bind(wc);
  wc.send = (ch, data) => { if (ch === 'event') rec('event', { data }); return orig(ch, data); };
  const ports = globalThis.__vibepet.require('./ports');
  let lastAt = -1;
  C.timer = setInterval(() => { const c = ports.poll(1e15); if (c.at !== lastAt) { lastAt = c.at; C.polls.push({ at: c.at, seen: Date.now(), servers: c.servers.map(s => s.pid + ':' + s.port), procs: c.procs.length, tasks: c.tasks.length }); if (C.polls.length > 600) C.polls.shift(); } }, 100);
  return { ok: true };
}
// the localhost submenu of the last captured native menu, as labels (nested one level)
function menuLocalhost() {
  const C = globalThis.__s6, m = C.menus[C.menus.length - 1]; if (!m) return null;
  const walk = items => items.map(i => ({ label: i.label || (i.type === 'separator' ? '—' : ''), enabled: i.enabled, sub: i.submenu ? walk(i.submenu.items) : undefined }));
  const L = m.items.find(i => /^Localhost/.test(i.label || ''));
  return { top: m.items.map(i => i.label).filter(Boolean), localhost: L ? { label: L.label, items: walk(L.submenu.items) } : null };
}
function clickMenu(_e, { trail }) {
  const C = globalThis.__s6, menu = C.menus[C.menus.length - 1];
  if (!menu) return { ok: false, why: 'no menu' };
  let items = menu.items, item;
  for (const step of trail) { const re = new RegExp(step); item = items.find(i => i.label && re.test(i.label)); if (!item) return { ok: false, why: `no ${step} in [${items.map(i => i.label).filter(Boolean).join(' | ')}]` }; items = item.submenu ? item.submenu.items : []; }
  item.click(); return { ok: true, label: item.label };
}

// ---------- renderer observer: every distinct footer state, with the time it rendered ----------
function observe() {
  if (window.__s6) return 'already';
  const S = window.__s6 = { log: [], renders: 0, events: [] };
  const now = () => document.getElementById('now');
  const footer = () => [...document.querySelectorAll('#now .srv')].map(e => { const b = e.querySelector('button[data-do=open]'); return { port: +e.dataset.port, pid: +e.dataset.pid, label: b.textContent, disabled: b.disabled, title: b.title }; });
  let last = '';
  const rec = () => { S.renders++; const f = footer(), k = JSON.stringify(f); if (k !== last) { last = k; S.log.push({ at: Date.now(), srv: f }); if (S.log.length > 2000) S.log.shift(); } };
  new MutationObserver(rec).observe(now(), { childList: true, subtree: true });
  window.pet.on('event', e => S.events.push({ at: Date.now(), kind: e.kind, text: e.text }));
  rec();
  return 'ok';
}
const view = () => {
  const $ = id => document.getElementById(id);
  const rows = [...document.querySelectorAll('#now .nr')].map(r => ({ id: r.dataset.id, sig: r.className.replace('nr ', ''), title: r.querySelector('.nm b')?.textContent, small: r.querySelector('.nm small')?.textContent, ask: r.querySelector('.na')?.textContent || null, acts: [...r.querySelectorAll('.nb button')].map(b => b.dataset.do) }));
  const srv = [...document.querySelectorAll('#now .srv')].map(e => { const b = e.querySelector('button[data-do=open]'); const r = e.getBoundingClientRect(), nr = $('now').getBoundingClientRect(); return { port: +e.dataset.port, pid: +e.dataset.pid, label: b.textContent, disabled: b.disabled, visibleInScrollBox: r.top >= nr.top - 1 && r.bottom <= nr.bottom + 1, clipped: b.scrollWidth > b.clientWidth }; });
  const bub = $('bubble'), br = bub.getBoundingClientRect(), chat = $('chat').getBoundingClientRect();
  const occluded = !$('chat').classList.contains('hidden') && br.width > 0 && !(br.bottom <= chat.top || br.top >= chat.bottom || br.right <= chat.left || br.left >= chat.right);
  return { home: !$('chat').classList.contains('hidden'), empty: $('now').querySelector('.nempty')?.textContent || null, rows, srv,
    nowScroll: { top: $('now').scrollTop, height: $('now').clientHeight, full: $('now').scrollHeight },
    bubble: { text: bub.textContent, hidden: bub.classList.contains('hidden') || getComputedStyle(bub).display === 'none', occludedByPanel: occluded },
    roster: { hidden: $('roster').classList.contains('hidden'), local: $('roster').querySelector('small.local')?.textContent || null },
    msgs: [...document.querySelectorAll('#msgs .msg')].slice(-4).map(m => m.textContent.slice(0, 160)) };
};

// ---------- the drive context ----------
async function start({ phase, state = {}, open = true } = {}) {
  const R = { phase, startedAt: new Date().toISOString(), load0: load(), shots: [], timings: [], notes: [] };
  const v = await launch({ appDir: INT, root: ROOT, userData: USERDATA, hotkey: 'off', state: { setupDone: true, muted: true, alerts: 'done', model: 'claude-haiku-4-5-20251001', ...state } });
  R.readyMs = v.readyMs;
  await v.evalMain(instrument);
  await v.win.evaluate(observe);
  const ctx = {
    v, R,
    async openHome() { const r = await v.openHome(); R.notes.push({ at: Date.now(), openHome: r }); return r; },
    async closeHome() { if (await v.homeMode()) { await v.clickPet(); await sleep(600); } },
    view: () => v.win.evaluate(view),
    async shot(flow, step) {
      const nf = path.join(SP, 'shotno'); let n = 1; try { n = +fs.readFileSync(nf, 'utf8') + 1; } catch {}
      fs.writeFileSync(nf, String(n));
      const name = `${String(n).padStart(2, '0')}-${flow}-${step}.png`;
      await v.shot(path.join(PACK, 'shots', name));
      const vw = await ctx.view();
      R.shots.push({ name, at: Date.now(), view: vw });
      return { name, view: vw };
    },
    calls: async (since = 0, kind) => (await v.evalMain((_, a) => globalThis.__s6.calls.filter(c => c.at >= a.since && (!a.kind || c.kind === a.kind)), { since, kind })),
    polls: async (since = 0) => (await v.evalMain((_, a) => globalThis.__s6.polls.filter(p => p.seen >= a.since), { since })),
    setAnswer: n => v.evalMain((_, n) => { globalThis.__s6.answer = n; }, n),
    log: async (since = 0) => (await v.win.evaluate(s => window.__s6.log.filter(e => e.at >= s), since)),
    events: async (since = 0) => (await v.win.evaluate(s => window.__s6.events.filter(e => e.at >= s), since)),
    // first footer state at/after `since` where pred(srv[]) holds → its render time (ms epoch), else null
    async waitFooter(pred, since, timeout = 45e3) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const hit = (await ctx.log(since - 1)).find(e => e.at >= since && pred(e.srv));
        if (hit) return hit;
        // the state may already hold from before `since` (no new entry): check the current footer
        const cur = await v.win.evaluate(() => window.__s6.log[window.__s6.log.length - 1]);
        if (cur && pred(cur.srv) && cur.at < since) return { at: since, srv: cur.srv, already: true };
        await sleep(100);
      }
      return null;
    },
    timing(flow, step, ms, extra = {}) { const t = { flow, step, ms, load: load(), at: iso(Date.now()), ...extra }; R.timings.push(t); console.log('TIMING', JSON.stringify(t)); return t; },
    note(x) { R.notes.push({ at: Date.now(), ...x }); console.log('NOTE', JSON.stringify(x).slice(0, 600)); },
    async menu() { const t = Date.now(); await v.win.click('#homeMore'); await sleep(400); return v.evalMain(menuLocalhost); },
    clickMenu: trail => v.evalMain(clickMenu, { trail }),
    async finish() {
      R.load1 = load(); R.endedAt = new Date().toISOString();
      try { R.polls = await ctx.polls(0); } catch {}
      try { R.allCalls = await ctx.calls(0); } catch {}
      try { R.footerLog = await ctx.log(0); R.rendererEvents = await ctx.events(0); } catch {}
      const c = await v.close(); R.close = c;
      fs.writeFileSync(path.join(SP, `results-${phase}.json`), JSON.stringify(R, null, 1));
      return R;
    },
  };
  return ctx;
}
function fleetTruth() {
  try {
    const out = execFileSync(process.execPath, [INT + '/test/fleet/fleet.js', 'status', '--json'], { cwd: INT, encoding: 'utf8', maxBuffer: 64e6, timeout: 60e3, stdio: ['ignore', 'pipe', 'ignore'] });
    const j = JSON.parse(out);
    const ms = j.members || j;
    return { at: new Date().toISOString(), members: ms.map(m => ({ name: m.name, state: m.state, ok: m.ok, paused: m.paused, pid: m.pid, reg: m.registry ? `${m.registry.status}${m.registry.waitingFor ? '(' + m.registry.waitingFor + ')' : ''}` : null, last: m.last && m.last.kind, lease: m.lease ? m.lease.owner : null })) };
  } catch (e) {
    const out = e.stdout || '';
    try { const j = JSON.parse(out); const ms = j.members || j; return { at: new Date().toISOString(), exit: e.status, members: ms.map(m => ({ name: m.name, state: m.state, ok: m.ok, paused: m.paused, pid: m.pid, reg: m.registry ? `${m.registry.status}${m.registry.waitingFor ? '(' + m.registry.waitingFor + ')' : ''}` : null, last: m.last && m.last.kind, lease: m.lease ? m.lease.owner : null })) }; }
    catch { return { error: String(e.message).split('\n')[0] }; }
  }
}
const median = a => { const s = [...a].filter(x => x != null).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
function pmsetTail() { try { return execFileSync('/bin/sh', ['-c', "pmset -g log | grep -E ' (Sleep|Wake|DarkWake) ' | tail -2"], { encoding: 'utf8', timeout: 20e3 }).trim().split('\n'); } catch { return []; } }

module.exports = { start, fleetTruth, median, sleep, load, iso, repo, nodeServer, pyHttp, npmStart, prefork, rawTcp, idle, stopOurs, waitDead, listeners, alive, get, pmsetTail, PACK, SP, FX, FLEET, INT };
