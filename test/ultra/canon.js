#!/usr/bin/env node
// test/ultra/canon.js — the canonical capture: drive the REAL vibepet (any worktree) against the LIVE fixture fleet and
// open each of its 7 surfaces through the real UI, saving 1-3 named screenshots per surface plus canon.json (functional
// assertions, what each Home row shows vs. the fleet's true state, and every side effect the run intercepted).
//
//   node test/ultra/canon.js --app <worktree> --out <dir> [--userdata <dir>]
//        [--root DIR]     the isolated Claude root (default ~/.vibepet-ultra/root/.claude, the fleet's)
//        [--all-rows]     also a screenshot + a jump of every Home row (the baseline view)
//        [--act]          really press Approve / send a Reply (default: only open them). On a build that can reach tmux
//                         this answers a fleet session: it leaves its state and the next turn costs money; rearm after.
//        [--live-chat]    chat through the user's real `claude` login on Haiku (default: a local stub engine, $0)
//        [--ask TEXT]     after the first reply, type TEXT too and keep its reply, screenshot and context (repeatable;
//                         'mode:agent' sends that quick ask instead)
//        [--strict]       exit 1 when a Home row disagrees with the fleet's truth (default: only reachability fails)
//   node test/ultra/canon.js --compare <outA> <outB> [--json FILE]   two runs side by side (exit 1 if they differ)
//
// Surfaces (renderer/app.js, main.js; see docs/ultra/round-0/surface-map.md):
//   1 home      a real click on Net's pixels opens the Net Home panel; rows vs. `fleet.js status --json`
//   2 chat      type a message, Enter → the reply (stub engine by default: deterministic, no tokens, nothing leaves); the
//               context each send carried is kept (2-chat/contexts/) and must hold a line per session
//   3 command   '/' lists the commands; /today posts the day book
//   4 rows      the row actions: ◎ goal → /goal → ✓ done, Reply form, Approve, a row click (= jump to its terminal)
//   5 theater   ▶ on a row opens Theater for that session; it has beats; seek
//   6 ports     a fixture server started here (cwd = a fleet repo) shows in the localhost footer; Open; ✕ Stop kills it
//   7 keys      the jump key (main's shortcut handler sends 'hotkey') jumps to whoever is first in line;
//               ⋯ → Settings → Gesture → Record gesture… opens the pad; three strokes on it save a gesture
//
// Safety: launch()'s privacy guard (isolated root + userData under ~/.vibepet-ultra). In main, before anything is
// clicked: native dialogs answer themselves, shell.openExternal/openPath and the clipboard only record, native menus
// are captured instead of shown. Approve/Reply are pressed only with --act, and never when the fleet session's
// terminal is a GUI app (where they would type keystrokes into a real window). The only process signalled is the
// fixture server this script started.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ULTRA = path.join(os.userInfo().homedir, '.vibepet-ultra');
const HERE = path.resolve(__dirname, '..', '..');   // the checkout this script (and launch.js, test/fleet) comes from
const sleep = ms => new Promise(r => setTimeout(r, ms));
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = k => argv.includes(k);

// the shortcut's pick of what to show for a member in each true state (members.json `state`)
// An approval shows amber 'needs' with the command it asks for; a question its text and choices (renderer/app.js SIG: the
// red 'stuck' an approval used to get was the bug, r1-S7-06). Ask patterns are what the row's ask line must look like.
const EXPECT = {
  approval: { sig: ['needs'], act: 'approve', ask: /^[\w ]+: \S/, why: 'a permission dialog is open: it needs you, Approve' },
  question: { sig: ['needs'], act: 'reply', ask: /\? \(.+ \/ .+\)$/, why: 'an AskUserQuestion dialog is open: it needs you, Reply' },
  done: { sig: ['ready'], why: 'the turn ended with a statement: done, your move' },
  working: { sig: ['running'], why: 'a long foreground tool is running' },
  fanout: { sig: ['running'], why: 'three subagents are running' },
  loop: { sig: ['running', 'ready'], why: 'idle between /loop fires: alive and scheduled, not waiting on you' },
};
const PREFER = ['delta', 'kestrel', 'atlas', 'ember', 'vibepet', 'beacon'];   // a stable pick when one row is enough
// a Home row label's duration back to ms (renderer/app.js phaseTime: 'needs approval 42s', 'asking 14m', 'asking 2h 37m',
// 'done 3m ago', 'exited 20s ago', 'running 4m 50s'; older builds: 'stuck Nm', 'waiting Nm', 'just now'), or null
function labelMs(label) { return labelSpan(label)?.ms ?? null; }
// … and the label's unit: whole minutes are floored ('14m' = 14:00–14:59), so the true age is in [ms, ms + unit)
function labelSpan(label) {
  const t = String(label || '').split(' · ').pop().replace(/ ago$/, '');
  let m;
  if (/just now$/.test(t)) return { ms: 0, unit: 60e3 };
  if ((m = t.match(/(\d+)h (\d+)m$/))) return { ms: (+m[1] * 60 + +m[2]) * 60e3, unit: 60e3 };
  if ((m = t.match(/(\d+)m (\d+)s$/))) return { ms: +m[1] * 60e3 + +m[2] * 1e3, unit: 1e3 };
  if ((m = t.match(/(?:^|\s)(\d+)s$/))) return { ms: +m[1] * 1e3, unit: 1e3 };
  if ((m = t.match(/(\d+)m$/))) return { ms: +m[1] * 60e3, unit: 60e3 };
  if ((m = t.match(/(\d+)h$/))) return { ms: +m[1] * 3600e3, unit: 3600e3 };
  if ((m = t.match(/(\d+)d$/))) return { ms: +m[1] * 864e5, unit: 864e5 };
  return null;
}
const fmt = ms => ms < 90e3 ? `${Math.round(ms / 1000)}s` : ms < 5400e3 ? `${Math.round(ms / 60e3)}m` : `${(ms / 3600e3).toFixed(1)}h`;
const SEED = {   // a returning user, calm and quiet, nothing left over from an earlier run on the same --userdata
  setupDone: true, muted: true, alerts: 'all', model: 'claude-haiku-4-5-20251001', engine: 'claude', pos: null, name: 'Net',
  pet: 'net', size: 'm', feel: 'calm', animations: false, game: false, goals: {}, hotkey: null, onTop: true,
  gesture: { on: false, sens: 'med', templates: [] },
};

// ---------- fleet truth (read-only: `fleet.js status --json`, from this checkout) ----------
function fleetTruth(fleetJs) {
  if (!fs.existsSync(fleetJs)) return { error: `no ${path.relative(HERE, fleetJs)} in this checkout` };
  let out;
  try { out = execFileSync(process.execPath, [fleetJs, 'status', '--json'], { encoding: 'utf8', timeout: 90e3, maxBuffer: 32e6, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = e.stdout; }   // exit 1 = not all green; the JSON is still there
  try {
    const j = JSON.parse(String(out).slice(String(out).indexOf('{')));
    return {
      at: j.at, allOk: j.allOk, spend: j.spend,
      members: j.members.map(m => ({ name: m.name, state: m.state, inState: m.ok, paused: m.paused, pid: m.pid, sessionId: m.sessionId,
        registry: m.registry && { status: m.registry.status, waitingFor: m.registry.waitingFor || null, statusUpdatedAt: m.registry.statusUpdatedAt },
        last: m.last && { kind: m.last.kind, pending: m.last.pending, lastTs: m.last.lastTs }, toolProcs: m.toolProcs,
        subagents: (m.subagents || []).length, failing: m.ok ? [] : m.checks.filter(c => !c.ok).map(c => c.name) })),
    };
  } catch (e) { return { error: `fleet status: ${e.message.split('\n')[0]}` }; }
}

// ---------- the fixture server (ours: started here, the only thing this script may stop) ----------
function startServer(cwd) {
  const code = "const s=require('http').createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<!doctype html><title>canon fixture</title><p>vibepet canon</p>')});" +
    "s.listen(0,'127.0.0.1',()=>console.log('PORT '+s.address().port));setTimeout(()=>process.exit(0),300e3)";   // dies on its own after 5 min
  const p = spawn(process.execPath, ['-e', code], { cwd, stdio: ['ignore', 'pipe', 'ignore'], detached: false });
  return new Promise((res, rej) => {
    let buf = ''; const t = setTimeout(() => rej(new Error('fixture server: no port in 10 s')), 10e3);
    p.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) { clearTimeout(t); res({ proc: p, pid: p.pid, port: +m[1], cwd }); } });
    p.on('exit', c => { clearTimeout(t); rej(new Error(`fixture server exited ${c}`)); });
  });
}
const pidAlive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
// the GUI app a process runs under (its first ancestor inside an .app bundle), or null: a tmux pane has none (tmux's
// server is a daemon). Only the bundle's name leaves here, never a command line.
function guiHost(pid) {
  const rows = new Map(execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n')
    .map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => [+m[1], { ppid: +m[2], comm: m[3] }]));
  if (!rows.has(pid)) return 'unknown (no such pid)';
  for (let p = rows.get(pid).ppid, n = 0; p > 1 && n < 24; p = rows.get(p)?.ppid, n++) {
    const m = (rows.get(p)?.comm || '').match(/^(.*?\.app)\/Contents\//);
    if (m) return path.basename(m[1]);
  }
  return null;
}

// ---------- the stub chat engine: `claude -p --output-format json` shape, deterministic, no network ----------
function writeStub(dir) {
  const f = path.join(dir, 'stub-claude.js'), log = path.join(dir, 'stub-claude.jsonl');
  fs.writeFileSync(f, `#!${process.execPath}
// canon's chat engine (VIBEPET_CLAUDE_BIN): answers from the live context's "Agents:" line only, echoing it in its order
// ('name=state for age - ask', '; ' between sessions; an older build: 'name=phase for Ns', ', '). Logs flags + sizes, never text.
const fs = require('fs'); let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  const a = process.argv.slice(2), m = a.indexOf('--model'), line = (input.match(/^Agents: (.*)$/m) || [, ''])[1];
  const agents = line === 'none active.' ? [] : line.replace(/(\\w)\\.$/, '$1').split(/^(?:[^=,;]+=\\w+ for \\d+s(?:, |\\.?$))+$/.test(line) ? ', ' : '; ').filter(Boolean);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ at: Date.now(), model: m >= 0 ? a[m + 1] : null, print: a.includes('-p'), noPersist: a.includes('--no-session-persistence'), bytes: input.length, agents: agents.length }) + '\\n');
  const text = agents.length ? 'Canon stub engine. Live agents in my context: ' + agents.join('; ').replace(/[^.?!]$/, '$&.') : 'Canon stub engine. No live agents in my context.';
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, total_cost_usd: 0 }));
});
`, { mode: 0o755 });
  return { file: f, log };
}

// ---------- what the engine was sent: a pass-through in front of it (the stub, or the real `claude` with --live-chat) ----------
// It keeps each call's stdin in <out>/2-chat/contexts/, then gives the engine the same argv, stdin and stdout. The instance
// watches the isolated root, so that context holds fleet sessions and fleet repos only.
function writeTee(dir, target) {
  const f = path.join(dir, 'tee-claude.js'), ctx = path.join(dir, '2-chat', 'contexts');
  fs.mkdirSync(ctx, { recursive: true });
  fs.writeFileSync(f, `#!${process.execPath}
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const file = path.join(${JSON.stringify(ctx)}, Date.now() + '-' + process.pid + '.stdin.txt');
const c = spawn(${JSON.stringify(target)}, process.argv.slice(2), { stdio: ['pipe', 'inherit', 'inherit'] });
process.stdin.on('data', d => { fs.appendFileSync(file, d); c.stdin.write(d); }).on('end', () => c.stdin.end());
c.stdin.on('error', () => {}); c.on('error', () => process.exit(127)); c.on('exit', code => process.exit(code ?? 1));
for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => c.kill(s));
`, { mode: 0o755 });
  return { file: f, dir: ctx };
}
// the `claude` main.js's findClaude would pick: the user's own login
function realClaude() {
  const h = os.homedir();
  for (const p of [path.join(h, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(h, '.claude/local/claude')]) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  try { const p = execFileSync('/bin/zsh', ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').pop(); return p.startsWith('/') ? p : null; } catch { return null; }
}
// the <live_context> blocks sent so far, oldest first: from raw stdin, or from the strings inside a stream-json engine's lines
function contextsSent(dir) {
  const out = [], grab = t => { for (const m of t.matchAll(/<live_context>\n?([\s\S]*?)\n?<\/live_context>/g)) out.push(m[1]); };
  let files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.stdin.txt')).sort((a, b) => parseInt(a) - parseInt(b)); } catch {}
  for (const f of files) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    if (!t.trimStart().startsWith('{')) { grab(t); continue; }
    for (const l of t.split('\n')) { try { JSON.stringify(JSON.parse(l), (k, v) => (typeof v === 'string' && v.includes('<live_context>') && grab(v), v)); } catch {} }
  }
  return out;
}

// ---------- main-process instrumentation: stubs for everything that would leave the instance, spies on the IPC we assert on ----------
function instrument({ dialog, shell, clipboard, Menu, ipcMain }) {
  if (globalThis.__canon) return { already: true };
  const C = globalThis.__canon = { calls: [], menus: [] };
  const rec = (kind, data = {}) => { C.calls.push({ kind, at: Date.now(), ...data }); };
  dialog.showMessageBox = async (...a) => { const o = a.find(x => x && typeof x === 'object' && 'message' in x) || {}; rec('dialog', { message: String(o.message || '').slice(0, 120), buttons: o.buttons }); return { response: 0, checkboxChecked: false }; };
  dialog.showMessageBoxSync = () => { rec('dialogSync'); return 0; };
  dialog.showOpenDialog = async () => { rec('openDialog'); return { canceled: true, filePaths: [] }; };
  shell.openExternal = async url => { rec('openExternal', { url: String(url).slice(0, 200) }); };
  shell.openPath = async p => { rec('openPath', { path: String(p).slice(0, 200) }); return ''; };
  clipboard.writeText = text => { rec('clipboard', { text: String(text).slice(0, 300) }); };
  Menu.prototype.popup = function () { C.menus.push(this); rec('menuPopup', { items: this.items.map(i => i.label).filter(Boolean) }); };
  // ipcMain.handle keeps its handlers in _invokeHandlers (the handler itself; older Electron: a wrapper answering through
  // event._reply): re-register each so the call is recorded with its arguments and result, and the original does the work
  const H = ipcMain._invokeHandlers, spied = [];
  for (const ch of ['jump', 'send-to']) {
    const h = H && H.get(ch); if (typeof h !== 'function') continue;
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, async (e, ...a) => {
      const t = Date.now(); let out, err, ret;
      const e2 = Object.create(e); e2._reply = v => { out = v; }; e2._throw = x => { err = x; };
      try { ret = await h(e2, ...a); } catch (x) { err = x; }
      if (out === undefined) out = ret;
      rec('ipc:' + ch, { args: a, result: out, error: err ? String(err.message || err) : undefined, ms: Date.now() - t });
      if (err) throw err;
      return out;
    });
    spied.push(ch);
  }
  ipcMain.on('theater', (_, id) => rec('ipc:theater', { id }));
  ipcMain.on('local-open', (_, port) => rec('ipc:local-open', { port }));
  ipcMain.on('local-stop', (_, pid) => rec('ipc:local-stop', { pid }));
  ipcMain.on('gesture-sample', (_, pts) => rec('ipc:gesture-sample', { points: Array.isArray(pts) ? pts.length : 0 }));
  return { spied };
}
// a captured native menu: walk labels (strings or RegExps) and click the item, as a hand on the native menu would
function clickMenu(_e, { trail }) {
  const C = globalThis.__canon, menu = C.menus[C.menus.length - 1];
  if (!menu) return { ok: false, why: 'no menu was popped up' };
  let items = menu.items, item;
  for (const step of trail) {
    const re = new RegExp(step);
    item = items.find(i => i.label && re.test(i.label));
    if (!item) return { ok: false, why: `no item ${step} in [${items.map(i => i.label).filter(Boolean).join(' | ')}]` };
    items = item.submenu ? item.submenu.items : [];
  }
  item.click();
  return { ok: true, label: item.label };
}

// ---------- the run ----------
async function run(opts) {
  const appDir = path.resolve(opts.app || HERE), out = path.resolve(opts.out), root = path.resolve(opts.root || path.join(ULTRA, 'root', '.claude'));
  fs.mkdirSync(out, { recursive: true });
  // nothing of the calling Claude Code session leaks into the app or a `claude` it spawns
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const { launch } = require('./launch');
  const T0 = Date.now(), R = { app: appDir, out, root, startedAt: new Date().toISOString(), flags: { allRows: !!opts.allRows, act: !!opts.act, liveChat: !!opts.liveChat, asks: (opts.asks || []).length },
    git: null, fleet: null, surfaces: {}, assertions: [], rows: [], compare: [], intercepted: [], timings: {}, failures: [] };
  try { R.git = execFileSync('git', ['-C', appDir, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim() + ' @ ' + execFileSync('git', ['-C', appDir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
  const assert = (surface, id, ok, detail) => { R.assertions.push({ surface, id, ok: !!ok, detail }); if (!ok) R.failures.push(`${surface}/${id}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); return !!ok; };
  const timed = async (name, fn) => { const t = Date.now(); try { return await fn(); } catch (e) { assert(name, 'ran', false, e.message.split('\n')[0]); } finally { R.timings[name] = Date.now() - t; } };
  const dir = s => { const d = path.join(out, s); fs.mkdirSync(d, { recursive: true }); return d; };

  // truth first: what the fleet is doing right now (re-read at the end to bracket the capture)
  R.fleet = fleetTruth(path.join(HERE, 'test', 'fleet', 'fleet.js'));
  const members = R.fleet.members || [];
  const bySid = new Map(members.map(m => [m.sessionId, m])), repoNames = new Set(members.map(m => m.name));
  const fleetRepo = name => path.join(ULTRA, 'fleet', name);

  // the fixture server runs in a fleet repo that has a session dir in the root, so the isolated instance may show it
  const srvRepo = PREFER.find(n => repoNames.has(n) && fs.existsSync(fleetRepo(n))) || null;
  let srv = null;
  if (srvRepo) srv = await startServer(fleetRepo(srvRepo)).catch(e => { assert('ports', 'fixtureServer', false, e.message); return null; });
  const stub = opts.liveChat ? null : writeStub(out);
  try { if (stub) fs.rmSync(stub.log, { force: true }); } catch {}
  try { fs.rmSync(path.join(out, '2-chat', 'contexts'), { recursive: true, force: true }); } catch {}
  const engine = stub ? stub.file : realClaude(), tee = engine ? writeTee(out, engine) : null;

  let v;
  const tLaunch = Date.now();
  try {
    v = await launch({ appDir, root, userData: opts.userdata ? path.resolve(opts.userdata) : undefined, state: SEED,
      env: { ANTHROPIC_API_KEY: '', ...(tee ? { VIBEPET_CLAUDE_BIN: tee.file } : {}) } });
  } catch (e) { if (srv) try { process.kill(srv.pid, 'SIGTERM'); } catch {} throw e; }
  // the first snapshot the renderer got (launch() returns once it has one): who needed you from the very first tick
  const snap0 = await v.evalMain(() => globalThis.__vibepet.snapshot()).catch(() => null);
  R.launch = { pid: v.pid, readyMs: v.readyMs, paths: { claude: v.paths.claude, userData: path.relative(ULTRA, v.paths.userData) }, perms: snap0?.perms || null,
    first: { msAfterLaunchCall: Date.now() - tLaunch, agents: (snap0?.agents || []).map(a => ({ member: bySid.get(a.id)?.name || null, name: a.name, kind: a.kind || null, phase: a.phase, ask: a.ask || null })) } };
  const W = v.win;
  const inst = await v.evalMain(instrument);
  R.instrument = inst;
  const calls = () => v.evalMain(() => globalThis.__canon.calls);
  const callsSince = async (t, kind) => (await calls()).filter(c => c.at >= t && (!kind || c.kind === kind));
  const waitCall = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = await callsSince(t, kind); if (c.length) return c; if (Date.now() > end) return []; await sleep(100); } };
  const ensureHome = async () => { if (!(await v.homeMode())) await v.openHome(); };
  const rowsDom = () => W.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({
    id: r.dataset.id, sig: ['needs', 'stuck', 'ready', 'running', 'exited'].find(c => r.classList.contains(c)) || null,
    title: r.querySelector('.nm b')?.textContent || '', label: r.querySelector('.nm small')?.textContent || '',
    goal: r.querySelector('.ng')?.textContent || null, goalDone: !!r.querySelector('.ng.done'), ask: r.querySelector('.na')?.textContent || null,
    actions: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) })));
  const rowSel = id => `#now .nr[data-id="${id}"]`;
  const memberOf = row => bySid.get(row.id)?.name || null;
  const rowFor = (rows, pred) => { for (const n of PREFER) { const r = rows.find(x => (memberOf(x) || x.name) === n && pred(x)); if (r) return r; } return rows.find(pred) || null; };
  // Approve / Reply: first the row of a member whose true state calls for that action (kestrel's dialog, beacon's question)
  const rowForAct = (rows, act) => rowFor(rows, r => r.actions.includes(act) && EXPECT[bySid.get(r.id)?.state]?.act === act && bySid.get(r.id)?.inState) || rowFor(rows, r => r.actions.includes(act));
  // an element's own pixels: scrolled into view first (the Now list scrolls: rows below its fold are clipped by it)
  const shotEl = async (file, sel, page = W) => {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {}); await sleep(150);
    const b = await loc.boundingBox(); if (!b) throw new Error(`no box for ${sel}`);
    return v.shot(file, { page, clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.width + 8, height: b.height + 8 } });
  };

  try {
    // ---------------- 1. Net Home panel ----------------
    await timed('home', async () => {
      const d = dir('1-home');
      await v.shot(path.join(d, 'pet.png'));
      const h = await v.openHome();
      R.surfaces.home = { mode: h.mode, ms: h.ms };
      assert('home', 'panelOpens', h.mode === 'now', `mode ${h.mode} in ${h.ms} ms`);
      await sleep(3300);   // one more tick, so the rows are the live ones
      await v.shot(path.join(d, 'panel.png'));
      const rows = await rowsDom(), snap = await v.evalMain(() => globalThis.__vibepet.snapshot());
      R.surfaces.home.readAt = Date.now();
      // how many rows the panel shows without scrolling (the Now list is a scroll box)
      R.surfaces.home.aboveFold = await W.evaluate(() => { const box = document.getElementById('now').getBoundingClientRect();
        return [...document.querySelectorAll('#now .nr[data-id]')].filter(r => { const b = r.getBoundingClientRect(); return b.top >= box.top - 1 && b.bottom <= box.bottom + 1; }).length; });
      const sa = new Map((snap.agents || []).map(a => [a.id, a]));
      R.rows = rows.map(r => ({ ...r, member: memberOf(r), name: sa.get(r.id)?.name || null, phase: sa.get(r.id)?.phase || null, kind: sa.get(r.id)?.kind || null, since: sa.get(r.id)?.since ?? null,
        fanout: sa.get(r.id)?.fanout ? { total: sa.get(r.id).fanout.total, open: sa.get(r.id).fanout.open, stuck: sa.get(r.id).fanout.stuck } : null }));
      // one order: Home's rows are the snapshot's, which is the order main sorts by (and pending() keeps)
      R.surfaces.home.order = { home: rows.map(r => memberOf(r) || r.id.slice(0, 8)), snapshot: (snap.agents || []).map(a => bySid.get(a.id)?.name || a.id.slice(0, 8)) };
      assert('home', 'rowsInSnapshotOrder', rows.every((r, i) => r.id === (snap.agents || [])[i]?.id), R.surfaces.home.order);
      R.surfaces.home.rows = rows.length;
      R.surfaces.home.snapshotAgents = (snap.agents || []).length;
      assert('home', 'rowsRender', rows.length > 0 || (snap.agents || []).length === 0, `${rows.length} rows, ${(snap.agents || []).length} agents in the snapshot`);
      assert('home', 'rowsMatchSnapshot', rows.length === Math.min(8, (snap.agents || []).length), `${rows.length} rows vs ${(snap.agents || []).length} snapshot agents (Home caps at 8)`);
      if (opts.allRows) for (const r of R.rows) await shotEl(path.join(d, `row-${r.member || r.name || r.id.slice(0, 8)}.png`), rowSel(r.id)).catch(() => {});
    });

    // ---------------- truth vs. what Home shows ----------------
    // a member out of its fixture state (paused: atlas/delta idle at the prompt) is still a live claude: scored on its registry
    const BY_REG = { idle: { sig: ['ready', 'needs'], why: 'idle at its prompt (registry): done, or asking' }, busy: { sig: ['running'], why: 'busy (registry): running' },
      waiting: { sig: ['needs'], why: 'a dialog is open (registry waiting): it needs you' } };
    const first = new Map((R.launch.first?.agents || []).filter(a => a.member).map(a => [a.member, a]));
    for (const m of members) {
      const row = R.rows.find(r => r.id === m.sessionId) || null, e = (m.inState ? EXPECT[m.state] : m.registry && BY_REG[m.registry.status]) || {}, c = { member: m.name, state: m.state, inState: m.inState,
        truth: m.registry ? `${m.registry.status}${m.registry.waitingFor ? ` (${m.registry.waitingFor})` : ''}` : 'no claude', shown: !!row,
        sig: row?.sig || null, label: row?.label || null, ask: row?.ask || null, phase: row?.phase || null, kind: row?.kind || null, actions: row?.actions || [], expected: e.sig || null, problems: [] };
      if (!m.inState && !m.registry) c.problems.push(`not in its fixture state (${m.paused ? 'paused' : 'failing: ' + m.failing.join(',')}): not scored`);
      else if (!row) c.problems.push(`missing: ${e.why}, but Home has no row for it`);
      else {
        if (e.sig && !e.sig.includes(row.sig)) c.problems.push(`shows '${row.sig}' (${row.label}); truth: ${e.why}`);
        if (e.act && !row.actions.includes(e.act)) c.problems.push(`no ${e.act} action`);
        if (e.ask && !e.ask.test(row.ask || '')) c.problems.push(`ask: '${row.ask}' (wanted ${e.ask})`);
        if (e.act && first.get(m.name) && !['approval', 'question', 'plan', 'input'].includes(first.get(m.name).kind)) c.problems.push(`at launch: '${first.get(m.name).kind || first.get(m.name).phase}' in the first snapshot`);
        // ages: the row counts from its since, which must be the registry's statusUpdatedAt (±3 s); the label must read that since
        const readAt = R.surfaces.home?.readAt, trueMs = m.registry?.statusUpdatedAt && readAt ? readAt - m.registry.statusUpdatedAt : null;
        const sinceMs = row.since && readAt ? readAt - row.since : null, sp = labelSpan(row.label);
        c.age = { trueMs, sinceMs, shownMs: sp ? sp.ms : null, unit: sp ? sp.unit : null };
        if (trueMs != null && sinceMs != null && Math.abs(sinceMs - trueMs) > 3000) c.problems.push(`age: counts from ${fmt(sinceMs)} ago (${row.label}), the registry says ${m.registry.status} for ${fmt(trueMs)}`);
        else if (sp && sinceMs != null && (sinceMs < sp.ms - 1500 || sinceMs > sp.ms + sp.unit + 4000)) c.problems.push(`label: '${row.label}' doesn't read ${fmt(sinceMs)}`);   // rendered ≤ 1 tick before the read
      }
      c.ok = m.inState || m.registry ? c.problems.length === 0 : null;
      R.compare.push(c);
    }
    for (const r of R.rows) if (!r.member) R.compare.push({ member: null, extra: true, row: { id: r.id.slice(0, 8), name: r.name, sig: r.sig, label: r.label },
      ok: false, problems: [repoNames.has(r.name) ? `extra row: an old session of ${r.name}, not its live one` : `extra row: not a fleet session (${r.name})`] });

    // ---------------- 2. chat ----------------
    await timed('chat', async () => {
      const d = dir('2-chat'); await ensureHome();
      const st = await W.evaluate(() => ({ input: !!document.getElementById('chatInput') && !document.getElementById('chatInput').disabled && document.getElementById('chatInput').offsetParent !== null,
        chips: [...document.querySelectorAll('#chips button[data-mode]')].filter(b => b.offsetParent !== null).map(b => b.dataset.mode),
        fresh: document.getElementById('chat').classList.contains('fresh'), meta: document.getElementById('chatMeta').textContent, note: document.getElementById('chatNoteText').textContent }));
      R.surfaces.chat = { ...st };
      assert('chat', 'inputVisible', st.input, st);
      assert('chat', 'chipsVisible', st.chips.length >= 1, st.chips);
      const n0 = await W.locator('#msgs .msg').count(), snapS = await v.evalMain(() => globalThis.__vibepet.snapshot());   // what the context is built from (±1 tick)
      await W.locator('#chatInput').fill("what's running?");
      await W.locator('#chatInput').press('Enter');
      await W.waitForFunction(n => document.querySelectorAll('#msgs .msg.user').length > 0 && document.querySelectorAll('#msgs .msg').length > n, n0, { timeout: 5000 }).catch(() => {});
      await v.shot(path.join(d, 'sending.png'));
      const ok = await W.waitForFunction(() => { const m = [...document.querySelectorAll('#msgs .msg.pet')].filter(x => !x.classList.contains('typing')); return m.length ? { err: m[m.length - 1].classList.contains('err'), text: m[m.length - 1].textContent.slice(0, 1200) } : null; },
        null, { timeout: opts.liveChat ? 90e3 : 20e3 }).then(h => h.jsonValue()).catch(() => null);
      await sleep(400); await v.shot(path.join(d, 'reply.png'));
      R.surfaces.chat.reply = ok;
      assert('chat', 'userMessage', (await W.locator('#msgs .msg.user').count()) >= 1, 'the typed message shows');
      assert('chat', 'reply', ok && !ok.err, ok);
      if (stub) { let log = []; try { log = fs.readFileSync(stub.log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch {}
        R.surfaces.chat.engine = { kind: 'stub', calls: log };
        assert('chat', 'engineCalled', log.length === 1 && log[0].print && log[0].noPersist, log); }
      else R.surfaces.chat.engine = { kind: 'live claude login', model: SEED.model, bin: engine };
      // what the send carried: a line per session with its state and age, ask, title and repo, then an Overlaps line. Scored:
      // the sessions live both before the send and after the reply, each against either snapshot (a tick may fall between)
      const sent = tee ? contextsSent(tee.dir) : [], ctx = sent[sent.length - 1] || null, snapC = await v.evalMain(() => globalThis.__vibepet.snapshot());
      if (ctx) fs.writeFileSync(path.join(d, 'context.txt'), ctx);
      const lines = (ctx || '').split('\n').filter(l => l.startsWith('- ')), after = new Map((snapC.agents || []).map(a => [a.id, a]));
      const per = (snapS.agents || []).filter(a => after.has(a.id)).map(a => { const both = [a, after.get(a.id)], l = lines.find(x => x.startsWith(`- ${a.name} `) && both.some(b => !b.title || x.includes(`"${b.title}"`))) || null;
        return { member: bySid.get(a.id)?.name || null, name: a.name, line: l, has: l && { stateAge: / for \d+(?:s|m \d+s|h \d+m)(?: · |$)/.test(l), ask: both.some(b => !b.ask || l.includes(b.ask)), title: both.some(b => !b.title || l.includes(`"${b.title}"`)),
          repo: / · repo [^ ]+\/[^ ]+ · /.test(l) || l.includes(' · not in a git repo · ') } }; });
      const moved = [...(snapS.agents || []).filter(a => !after.has(a.id)), ...(snapC.agents || []).filter(a => !(snapS.agents || []).some(b => b.id === a.id))].map(a => bySid.get(a.id)?.name || a.name);
      R.surfaces.chat.context = { file: ctx ? '2-chat/context.txt' : null, bytes: ctx ? ctx.length : 0, sends: sent.length, sessions: per, cameOrWent: moved, overlaps: (ctx || '').split('\n').find(l => l.startsWith('Overlaps:')) || null };
      assert('chat', 'contextSessions', !!ctx && per.every(p => p.line && Object.values(p.has).every(Boolean)) && !!R.surfaces.chat.context.overlaps,
        ctx ? per.filter(p => !p.line || !Object.values(p.has).every(Boolean)).map(p => `${p.member || p.name}: ${p.line ? JSON.stringify(p.has) : 'no line'}`).join('; ') || `a line for each of ${per.length} sessions + Overlaps` : 'no context captured');
      if (stub) assert('chat', 'stubEchoesEverySession', ok && per.every(p => ok.text.includes(`${p.name}=`)), ok && ok.text);
      // --ask: more questions, one at a time: the reply, a screenshot, the context it was sent with, the load
      R.surfaces.chat.asks = [];
      for (const [i, q] of (opts.asks || []).entries()) {
        const n = await W.locator('#msgs .msg.pet:not(.typing)').count(), before = (tee ? contextsSent(tee.dir) : []).length, load = os.loadavg().map(x => x.toFixed(2)).join(' '), t = Date.now();
        if (/^mode:\w+$/.test(q)) await W.evaluate(m => send(null, m), q.slice(5));   // a quick ask, as its chip sends it (chips show on a fresh chat only)
        else { await W.locator('#chatInput').fill(q); await W.locator('#chatInput').press('Enter'); }
        const r = await W.waitForFunction(n => { const m = [...document.querySelectorAll('#msgs .msg.pet')].filter(x => !x.classList.contains('typing')); return m.length > n ? { err: m[m.length - 1].classList.contains('err'), text: m[m.length - 1].textContent.slice(0, 2000) } : null; },
          n, { timeout: opts.liveChat ? 120e3 : 20e3 }).then(h => h.jsonValue()).catch(() => null);
        const ms = Date.now() - t;
        await sleep(400); await v.shot(path.join(d, `ask-${i + 1}.png`));
        const all = tee ? contextsSent(tee.dir) : [], c = all.length > before ? all[all.length - 1] : null;
        if (c) fs.writeFileSync(path.join(d, `ask-${i + 1}.context.txt`), c);
        R.surfaces.chat.asks.push({ q, reply: r, ms, load: { before: load, after: os.loadavg().map(x => x.toFixed(2)).join(' ') }, context: c ? `2-chat/ask-${i + 1}.context.txt` : null,
          about: c ? [...c.matchAll(/^About (.+?) \((.+?)\):$/gm)].map(m => ({ session: m[1], why: m[2] })) : [], overlaps: c ? c.split('\n').find(l => l.startsWith('Overlaps:')) || null : null });
        assert('chat', `ask${i + 1}`, r && !r.err, { q, reply: r });
      }
    });

    // ---------------- 3. command bar ----------------
    await timed('command', async () => {
      const d = dir('3-command'); await ensureHome();
      await W.locator('#chatInput').fill('');
      await W.locator('#chatInput').pressSequentially('/');
      await W.waitForSelector('#slash:not(.hidden) button[data-cmd]', { timeout: 3000 }).catch(() => {});
      const cmds = await W.evaluate(() => [...document.querySelectorAll('#slash button[data-cmd]')].map(b => b.dataset.cmd));
      R.surfaces.command = { cmds };
      await v.shot(path.join(d, 'slash.png'));
      assert('command', 'barOpens', cmds.length >= 8, cmds);
      const n0 = await W.locator('#msgs .msg.note').count();
      await W.locator('#chatInput').fill('/today');
      await W.locator('#chatInput').press('Enter');
      const ok = await W.waitForFunction(n => document.querySelectorAll('#msgs .msg.note').length > n, n0, { timeout: 5000 }).then(() => true).catch(() => false);
      await sleep(300); await v.shot(path.join(d, 'today.png'));
      R.surfaces.command.today = ok;
      assert('command', 'todayRuns', ok, '/today posts its note');
    });

    // ---------------- 4. row actions ----------------
    await timed('rows', async () => {
      const d = dir('4-rows'); await ensureHome();
      const S = R.surfaces.rows = { actions: {} };
      let rows = await rowsDom();
      if (!rows.length) { assert('rows', 'anyRow', false, 'no rows to act on'); return; }
      await shotEl(path.join(d, 'list.png'), '#now');   // the scroll box: what the list shows without scrolling
      // ◎ goal → "/goal <text>" in the command bar → the row shows it → ✓ marks it done
      const g = rowFor(rows, () => true), gm = memberOf(g) || g.id.slice(0, 8);
      await W.locator(`${rowSel(g.id)} button[data-do=goal]`).click();
      const pre = await W.locator('#chatInput').inputValue();
      await W.locator('#chatInput').fill('/goal canon goal');
      await W.locator('#chatInput').press('Enter');
      const set = await W.waitForFunction(id => (document.querySelector(`#now .nr[data-id="${id}"] .ng`)?.textContent || '').includes('canon goal'), g.id, { timeout: 8000 }).then(() => true).catch(() => false);
      await shotEl(path.join(d, 'goal.png'), rowSel(g.id)).catch(() => {});
      // ✓ is lost when it lands while main's tick is between scanAgents() and goalFor() (main.js tick → unstick awaits
      // ps/lsof while `agents` holds fresh objects with no .goal, so goalDone() returns early). A person clicks again:
      // so does canon, once, and records that the first click was dropped (round-0 baseline notes, B-goal-race).
      let done = false, clicks = 0;
      while (set && !done && clicks < 2) {
        clicks++;
        await W.locator(`${rowSel(g.id)} button[data-do=done]`).click().catch(() => {});
        done = await W.waitForFunction(id => !!document.querySelector(`#now .nr[data-id="${id}"] .ng.done`), g.id, { timeout: 7000 }).then(() => true).catch(() => false);
      }
      S.actions.goal = { member: gm, prefill: pre, set, done, clicks, firstClickDropped: done && clicks > 1 };
      assert('rows', 'goalPrefill', pre.startsWith('/goal'), pre);
      assert('rows', 'goalSet', set, `◎ then /goal on ${gm}`);
      assert('rows', 'goalDone', done, `✓ on ${gm}`);
      // Reply (a row that waits on an answer): the inline form opens; --act sends it
      rows = await rowsDom();
      const q = rowForAct(rows, 'reply');
      if (q) {
        await W.locator(`${rowSel(q.id)} button[data-do=reply]`).click();
        const form = await W.waitForSelector(`${rowSel(q.id)} form.nrep input`, { timeout: 3000 }).then(() => true).catch(() => false);
        await W.locator(`${rowSel(q.id)} form.nrep input`).fill('SQLite').catch(() => {});
        await shotEl(path.join(d, 'reply.png'), rowSel(q.id)).catch(() => {});
        S.actions.reply = { member: memberOf(q), form };
        assert('rows', 'replyForm', form, memberOf(q));
        if (opts.act) S.actions.reply.sent = await press(q, `${rowSel(q.id)} form.nrep button`);
        else { await W.locator(`${rowSel(q.id)} button[data-do=reply]`).click().catch(() => {}); }   // close it again
      } else S.actions.reply = { none: 'no row offers Reply' };
      // Approve (a row stuck on a tool): --act presses it
      rows = await rowsDom();
      const ap = rowForAct(rows, 'approve');
      if (ap) {
        S.actions.approve = { member: memberOf(ap), button: true };
        if (opts.act) { S.actions.approve.pressed = await press(ap, `${rowSel(ap.id)} button[data-do=approve]`); await shotEl(path.join(d, 'approve.png'), '#chat').catch(() => {}); }
      } else S.actions.approve = { none: 'no row offers Approve' };
      // a click on the row body = jump to its terminal
      rows = await rowsDom();
      const targets = opts.allRows ? rows : [rowFor(rows, () => true)];
      S.actions.jump = [];
      for (const r of targets) {
        const t = Date.now();
        await W.locator(`${rowSel(r.id)} .nm`).click();
        const c = (await waitCall(t, 'ipc:jump'))[0], clip = (await callsSince(t, 'clipboard')).length;
        await sleep(500);
        const name = memberOf(r) || r.id.slice(0, 8);
        await v.shot(path.join(d, opts.allRows ? `jump-${name}.png` : 'jump.png'));
        S.actions.jump.push({ member: name, result: c ? c.result : null, ms: c?.ms, clipboardWrites: clip });
        assert('rows', `jumpRuns:${name}`, !!c, c ? c.result : 'the jump IPC never fired');
        await ensureHome();
      }
    });

    // Approve/Reply for real (--act only): never where the session's terminal is a GUI app, whose window would get keystrokes
    async function press(row, sel) {
      const m = bySid.get(row.id);
      const host = m && m.pid ? guiHost(m.pid) : 'unknown pid';
      if (host) return { refused: `its terminal is ${host}: a keystroke there could land in a real window` };
      const t = Date.now();
      await W.locator(sel).click();
      const c = (await waitCall(t, 'ipc:send-to', 15000))[0];
      await sleep(600);
      const note = await W.evaluate(() => { const n = [...document.querySelectorAll('#msgs .msg.note')]; return n.length ? n[n.length - 1].textContent.slice(0, 160) : null; });
      return { result: c ? c.result : null, note, settingsOpened: (await callsSince(t, 'openExternal')).map(x => x.url) };
    }

    // ---------------- 5. Theater ----------------
    await timed('theater', async () => {
      const d = dir('5-theater'); await ensureHome();
      const rows = await rowsDom(), r = rowFor(rows, x => x.actions.includes('replay'));
      if (!r) { assert('theater', 'replayButton', false, 'no row offers ▶'); return; }
      const name = memberOf(r) || r.id.slice(0, 8);
      const opened = v.app.waitForEvent('window', { timeout: 15e3, predicate: p => /theater\/player\.html$/.test(p.url()) });
      await W.locator(`${rowSel(r.id)} button[data-do=replay]`).click();
      const th = await opened.catch(() => null);
      R.surfaces.theater = { member: name };
      if (!assert('theater', 'opens', !!th, `▶ on ${name}`)) return;
      await th.waitForLoadState('load');
      const st = await th.waitForFunction(() => { const n = document.querySelectorAll('#beats .b').length, t = document.getElementById('title')?.textContent || '';
        return n > 0 || /Could not|Nothing to replay/.test(t) ? { beats: n, title: t.slice(0, 80) } : null; }, null, { timeout: 15e3 }).then(h => h.jsonValue()).catch(() => null);
      Object.assign(R.surfaces.theater, st || {});
      assert('theater', 'hasBeats', st && st.beats > 0 && !/Could not/.test(st.title), st);
      await sleep(2600);   // past the opening chapter card
      await v.shot(path.join(d, 'open.png'), { page: th });
      if (st && st.beats > 0) {   // the middle beat, paused and pinned like a click on the rail
        R.surfaces.theater.midBeat = await th.evaluate(() => { const n = document.querySelectorAll('#beats .b').length, i = Math.floor(n / 2); window.__theater.beat(i); return i; });
        await sleep(600); await v.shot(path.join(d, 'seek-mid.png'), { page: th });
      }
      await th.close().catch(() => {});
    });

    // ---------------- 6. ports / localhost ----------------
    await timed('ports', async () => {
      const d = dir('6-ports'); await ensureHome();
      if (!srv) { assert('ports', 'fixtureServer', false, 'no fixture server'); return; }
      R.surfaces.ports = { fixture: { port: srv.port, repo: srvRepo } };
      const sel = `#now .srv[data-port="${srv.port}"]`;
      const shown = await W.waitForSelector(sel, { timeout: 30e3 }).then(() => true).catch(() => false);
      const foot = await W.evaluate(() => ({ servers: [...document.querySelectorAll('#now .srv')].map(s => ({ port: +s.dataset.port, text: s.textContent.trim().slice(0, 60) })) }));
      R.surfaces.ports.footer = foot;
      if (shown) await shotEl(path.join(d, 'footer.png'), '#now .nfoot').catch(() => {});
      assert('ports', 'sectionRenders', foot.servers.length > 0, foot);
      if (!assert('ports', 'fixtureListed', shown, `:${srv.port} (cwd ${srvRepo})`)) return;
      let t = Date.now();
      await W.locator(`${sel} button[data-do=open]`).click({ timeout: 3000 }).catch(() => {});
      const open = (await waitCall(t, 'openExternal', 3000))[0];
      R.surfaces.ports.open = open ? open.url : null;
      assert('ports', 'openButton', open && open.url === `http://localhost:${srv.port}`, open || 'shell.openExternal never called');
      t = Date.now();
      await W.locator(`${sel} button[data-do=stop]`).click();
      const dlg = (await waitCall(t, 'dialog', 5000))[0];
      let gone = false; for (let i = 0; i < 40 && !gone; i++) { await sleep(150); gone = !pidAlive(srv.pid); }
      await sleep(800); await v.shot(path.join(d, 'stopped.png'));
      R.surfaces.ports.stop = { confirm: dlg ? dlg.message : null, killed: gone };
      assert('ports', 'stopConfirms', !!dlg, dlg || 'no confirm dialog');
      assert('ports', 'stopKills', gone, `fixture pid ${srv.pid}`);
    });

    // ---------------- 7. jump key + gestures ----------------
    await timed('keys', async () => {
      const d = dir('7-keys'); await ensureHome();
      const k = R.surfaces.keys = {};
      k.jumpKey = await v.evalMain(() => ({ key: globalThis.__vibepet.jumpKey(), taken: globalThis.__vibepet.keyTaken() }));
      const queue = await W.evaluate(() => pending().map(a => ({ id: a.id, name: a.name, phase: a.phase })));
      k.queue = queue.map(a => ({ member: bySidName(a.id) || a.name, phase: a.phase }));
      // what the global shortcut's handler does (main.js bindKey): show Net if hidden, then send 'hotkey' to the pet
      const t = Date.now();
      await v.evalMain(() => { const w = globalThis.__vibepet.win(); if (!w.isVisible()) w.showInactive(), w.webContents.send('summon'); w.webContents.send('hotkey'); });
      const c = (await waitCall(t, 'ipc:jump', 6000))[0];
      // a second press within 4 s of the first walks on to the next in line (renderer/app.js 'hotkey'); later, it starts over
      let c2 = null, gap = null;
      if (queue.length > 1) {
        const t2 = Date.now(); gap = t2 - t;
        await v.evalMain(() => globalThis.__vibepet.win().webContents.send('hotkey'));
        c2 = (await waitCall(t2, 'ipc:jump', 6000))[0];
      }
      await sleep(600); await v.shot(path.join(d, 'hotkey.png'));
      k.hotkey = { jumped: c ? c.args[0] : null, expected: queue[0]?.id || null, result: c ? c.result : null };
      assert('keys', 'hotkeyJumps', queue.length ? c && c.args[0] === queue[0].id : !c, queue.length ? `${k.queue[0].member} first in line` : 'nothing in line: no jump');
      if (queue.length > 1) {
        k.hotkey2 = { jumped: c2 ? c2.args[0] : null, member: c2 ? bySidName(c2.args[0]) : null, expected: queue[1].id, gapMs: gap };
        assert('keys', 'hotkeyWalks', gap >= 4000 || (c2 && c2.args[0] === queue[1].id), gap >= 4000 ? `second press ${gap} ms after the first: a new walk` : `then ${k.queue[1].member}`);
      }
      // ⋯ → Settings → Gesture → Record gesture… (a native menu: captured, then its item clicked)
      await ensureHome();
      const t2 = Date.now();
      await W.locator('#homeMore').click();
      const pop = (await waitCall(t2, 'menuPopup', 3000))[0];
      assert('keys', 'menuOpens', !!pop, pop ? pop.items.length + ' items' : 'no native menu');
      const clicked = pop ? await v.evalMain(clickMenu, { trail: ['^Settings$', '^Gesture$', '^Record'] }) : { ok: false };
      const padOpen = await W.waitForSelector('#gest:not(.hidden) #gestPad', { timeout: 4000 }).then(() => true).catch(() => false);
      k.gesture = { menu: clicked, padOpen };
      assert('keys', 'gesturePadOpens', padOpen, clicked);
      if (padOpen) {
        await v.shot(path.join(d, 'gesture-pad.png'));
        const b = await W.locator('#gestPad').boundingBox();
        for (let s = 0; s < 3; s++) {   // the same loop three times: a consistent set
          const cx = b.x + b.width / 2, cy = b.y + b.height / 2, rr = b.width * 0.32;
          await W.mouse.move(cx + rr, cy); await W.mouse.down();
          for (let i = 1; i <= 36; i++) { const a = i / 36 * 2 * Math.PI * 0.95; await W.mouse.move(cx + rr * Math.cos(a), cy + rr * Math.sin(a)); await sleep(8); }
          await W.mouse.up(); await sleep(450);
        }
        const msg = await W.waitForFunction(() => /^Saved/.test(document.getElementById('gestMsg')?.textContent || '') && document.getElementById('gestMsg').textContent, null, { timeout: 4000 }).then(h => h.jsonValue()).catch(async () => W.evaluate(() => document.getElementById('gestMsg')?.textContent || ''));
        await v.shot(path.join(d, 'gesture-saved.png'));
        const saved = await v.evalMain(() => (globalThis.__vibepet.state().gesture?.templates || []).length);
        k.gesture.message = String(msg).slice(0, 120); k.gesture.templates = saved;
        assert('keys', 'gestureSaved', saved === 3, k.gesture.message);
      }
    });
    function bySidName(id) { return bySid.get(id)?.name || null; }
  } finally {
    try { R.intercepted = (await calls()).map(c => ({ ...c, at: c.at - T0 })); } catch {}
    try { R.notes = (await v.evalMain(() => globalThis.__vibepet.notes.length)); } catch {}
    R.close = await v.close();
    if (srv && pidAlive(srv.pid)) { try { process.kill(srv.pid, 'SIGTERM'); } catch {} R.fixtureKilledByCanon = true; }
  }
  assert('run', 'cleanClose', R.close.how === 'quit' && !R.close.orphans.length, R.close);
  R.fleetAfter = fleetTruth(path.join(HERE, 'test', 'fleet', 'fleet.js'));
  R.fleetChanged = (R.fleet.members || []).filter(m => { const a = (R.fleetAfter.members || []).find(x => x.name === m.name); return !a || a.inState !== m.inState; }).map(m => m.name);
  R.ms = Date.now() - T0;
  R.summary = {
    ok: !R.failures.length, assertions: `${R.assertions.filter(a => a.ok).length}/${R.assertions.length}`,
    rows: R.rows.map(r => `${r.member || '?' + (r.name || '')}:${r.sig}`),
    fleetMembers: members.length, inState: members.filter(m => m.inState).length,
    mismatches: R.compare.filter(c => c.ok === false).map(c => `${c.member || 'extra'}: ${c.problems.join('; ')}`),
  };
  fs.writeFileSync(path.join(out, 'canon.json'), JSON.stringify(R, null, 2));
  return R;
}

// two canon outputs side by side: assertions, rows, truth mismatches, and how much each screenshot changed
function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(a, 'canon.json'), 'utf8')), B = JSON.parse(fs.readFileSync(path.join(b, 'canon.json'), 'utf8'));
  const { decodePng } = require('./launch');
  const byId = R => new Map(R.assertions.map(x => [`${x.surface}/${x.id}`, x.ok]));
  const aa = byId(A), bb = byId(B), ids = [...new Set([...aa.keys(), ...bb.keys()])];
  const rows = R => Object.fromEntries(R.rows.map(r => [r.member || r.name || r.id.slice(0, 8), r.sig]));
  // the kind of each problem, not its clock: "waiting for 21m" and "waiting for 22m" are the same finding
  const probs = R => Object.fromEntries(R.compare.map(c => [c.member || 'extra', (c.problems || []).join('; ').replace(/\d+(\.\d+)?/g, '#')]));
  const pngs = d => { const o = []; const walk = x => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.png')) o.push(path.relative(d, p)); } }; walk(d); return o; };
  const shots = [];
  for (const f of [...new Set([...pngs(a), ...pngs(b)])].sort()) {
    if (!fs.existsSync(path.join(a, f)) || !fs.existsSync(path.join(b, f))) { shots.push({ file: f, only: fs.existsSync(path.join(a, f)) ? 'a' : 'b' }); continue; }
    const x = decodePng(fs.readFileSync(path.join(a, f))), y = decodePng(fs.readFileSync(path.join(b, f)));
    if (x.w !== y.w || x.h !== y.h) { shots.push({ file: f, size: [`${x.w}x${x.h}`, `${y.w}x${y.h}`] }); continue; }
    let diff = 0; for (let i = 0; i < x.rgba.length; i += 4) if (Math.abs(x.rgba[i] - y.rgba[i]) > 8 || Math.abs(x.rgba[i + 1] - y.rgba[i + 1]) > 8 || Math.abs(x.rgba[i + 2] - y.rgba[i + 2]) > 8) diff++;
    shots.push({ file: f, changedPct: +(100 * diff / (x.w * x.h)).toFixed(2) });
  }
  const ra = rows(A), rb = rows(B), pa = probs(A), pb = probs(B);
  return {
    a, b, gitA: A.git, gitB: B.git, msA: A.ms, msB: B.ms,
    assertions: { a: A.summary.assertions, b: B.summary.assertions, differ: ids.filter(i => aa.get(i) !== bb.get(i)).map(i => ({ id: i, a: aa.get(i) ?? null, b: bb.get(i) ?? null })) },
    rows: { a: ra, b: rb, differ: [...new Set([...Object.keys(ra), ...Object.keys(rb)])].filter(k => ra[k] !== rb[k]) },
    mismatches: { a: A.summary.mismatches, b: B.summary.mismatches, differ: [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(k => pa[k] !== pb[k]) },
    fleet: { a: `${A.summary.inState}/${A.summary.fleetMembers}`, b: `${B.summary.inState}/${B.summary.fleetMembers}`, changedDuring: [A.fleetChanged, B.fleetChanged] },
    notes: { goalFirstClickDropped: [A, B].map(R => !!R.surfaces?.rows?.actions?.goal?.firstClickDropped), aboveFold: [A, B].map(R => R.surfaces?.home?.aboveFold ?? null) },
    shots,
  };
}

if (require.main === module && flag('--compare')) {
  const i = argv.indexOf('--compare'), [a, b] = [argv[i + 1], argv[i + 2]].map(x => x && path.resolve(x));
  if (!a || !b) { console.error('usage: node test/ultra/canon.js --compare <outA> <outB> [--json FILE]'); process.exit(2); }
  const c = compare(a, b);
  if (arg('--json')) fs.writeFileSync(path.resolve(arg('--json')), JSON.stringify(c, null, 2));
  const same = !c.assertions.differ.length && !c.rows.differ.length && !c.mismatches.differ.length;
  console.log(`${same ? 'same' : 'DIFFERENT'}: assertions ${c.assertions.a} vs ${c.assertions.b}; rows ${JSON.stringify(c.rows.a)}${c.rows.differ.length ? ' vs ' + JSON.stringify(c.rows.b) : ''}`);
  for (const d of c.assertions.differ) console.log(`  assertion ${d.id}: ${d.a} → ${d.b}`);
  for (const k of c.mismatches.differ) console.log(`  mismatch ${k} differs`);
  for (const s of c.shots) console.log(`  ${s.file}: ${s.only ? 'only in ' + s.only : s.size ? 'size ' + s.size.join(' vs ') : s.changedPct + '% of pixels changed'}`);
  process.exit(same ? 0 : 1);
} else if (require.main === module) {
  const opts = { app: arg('--app'), out: arg('--out'), userdata: arg('--userdata'), root: arg('--root'), allRows: flag('--all-rows'), act: flag('--act'), liveChat: flag('--live-chat'),
    asks: argv.flatMap((a, i) => a === '--ask' && argv[i + 1] != null ? [argv[i + 1]] : []) };
  if (!opts.out) { console.error('usage: node test/ultra/canon.js --app <worktree> --out <dir> [--userdata <dir>] [--root DIR] [--all-rows] [--act] [--live-chat] [--ask TEXT]... [--strict]'); process.exit(2); }
  run(opts).then(R => {
    const s = R.summary;
    console.log(`${s.ok ? 'ok' : 'FAIL'} ${s.assertions} assertions in ${(R.ms / 1000).toFixed(1)} s → ${R.out}`);
    console.log(`rows: ${s.rows.join(' ') || '(none)'}   fleet: ${s.inState}/${s.fleetMembers} in state${R.fleetChanged.length ? `, changed during the run: ${R.fleetChanged}` : ''}`);
    for (const m of s.mismatches) console.log('  mismatch ' + m);
    for (const f of R.failures) console.log('  FAIL ' + f);
    process.exit(!s.ok || (flag('--strict') && s.mismatches.length) ? 1 : 0);
  }).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { run, compare, fleetTruth, instrument, clickMenu, labelMs, EXPECT, SEED };
