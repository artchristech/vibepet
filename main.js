// vibepet — a desktop pet that watches your coding agents and your repo.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, safeStorage, Notification, clipboard, powerMonitor, globalShortcut, Tray } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { readTail, textOf, scan, psAll, locateSession, hostApp, bundleId, focusTty, run } = require('./agents');
const gesture = require('./gesture');

const W = 360, H = 520;
const { place, areaFor, minY } = require('./place');
let petTop = 276;   // Net's top inside the window (panels-above layout); the renderer reports the real value
let virt = null, below = false;   // wanted window pos (panels above; may sit above the screen top) + current flip
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const TICK_MS = 3000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();   // a 224×208 pixel canvas + one CSS capsule: the GPU process costs memory, buys nothing
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();   // the running pet gets 'second-instance' instead

// ---------- state ----------
const PETS = [['net', 'Net'], ['slime', 'Slime'], ['cat', 'Cat'], ['sprout', 'Sprout'], ['shroom', 'Shroom'], ['star', 'Star'], ['koi', 'Koi']];   // the site hero's cast (site/sprites.js)
const DEFAULTS = {
  name: 'Net', xp: 0, fuel: 80, mood: 70, commits: 0, quickDraws: 0,
  repo: null, pos: null, model: 'claude-sonnet-5', keyEnc: null, keyPlain: null, engine: null,   // engine: null = auto (Claude Code login first), 'claude' | 'key'
  muted: false, onTop: true, hotkey: 'Control+Alt+Command+J', animations: false, game: false, pet: 'net', born: Date.now(), lastDecay: Date.now(), lastSnack: 0, lastPet: 0,
};
let state, saveTimer, win, sessionKey = null;
const statePath = () => path.join(app.getPath('userData'), 'state.json');
function load() {
  try { state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }; }
  catch { state = { ...DEFAULTS }; }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
    } catch (e) { console.error('save failed:', e.message); }
  }, 300);
}

const clamp = v => Math.max(0, Math.min(100, v));
const levelFor = xp => Math.floor(Math.sqrt(xp / 40)) + 1; // L2=40, L3=160, L4=360, L5=640…
const xpForLevel = l => 40 * (l - 1) ** 2;
const UNLOCKS = { 2: 'blush', 3: 'sparkle trail', 4: 'headphones', 5: 'shades (hover me)', 7: 'crown' };

function decay() {
  const now = Date.now();
  const min = Math.min(240, (now - state.lastDecay) / 60000);
  if (min < 0.25) return;
  state.lastDecay = now;
  if (!state.game) return;
  state.fuel = clamp(state.fuel - min / 3);               // empty in ~5h without commits
  state.mood = clamp(state.mood + (state.fuel < 25 ? -min / 2 : (55 - state.mood) * 0.01 * min));
}

function gainXP(n) {
  const before = levelFor(state.xp);
  state.xp += n;
  const after = levelFor(state.xp);
  if (after > before) {
    const unlock = UNLOCKS[after];
    emit('levelup', `LEVEL ${after}!${unlock ? ` unlocked: ${unlock}` : ''}`, { notify: true, level: after });
  }
}

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
function emit(kind, text, { notify = false, ...extra } = {}) {
  send('event', { kind, text, ...extra });
  if (notify && !state.muted && Notification.isSupported()) banner(text, extra.id);
}
// a banner is a door: click → that agent's terminal (the renderer's queue decides). Electron drops the click
// handler once a Notification is GC'd, so each one is held until it closes or is clicked.
const banners = new Set();
function banner(body, id, silent = false) {
  const n = new Notification({ title: state.name, body, silent }), drop = () => banners.delete(n);
  banners.add(n);
  if (banners.size > 16) banners.delete(banners.values().next().value);   // macOS never fires 'close' for one left in Notification Center
  n.on('click', () => { drop(); if (id) send('jumpTo', { id }); });
  n.on('close', drop);
  n.show();
  return n;
}

// batch "finished" OS notifications: at most one per 20s
const DONE_GAP = 20000;
let doneQueue = [], doneTimer = null, lastDoneNote = 0;
function queueDone(a) {   // { name, id }
  if (!doneQueue.some(d => d.id === a.id)) doneQueue.push(a);
  if (doneTimer) return;
  doneTimer = setTimeout(flushDone, Math.max(0, lastDoneNote + DONE_GAP - Date.now()));
}
function flushDone() {
  doneTimer = null;
  const done = doneQueue; doneQueue = [];
  if (!done.length || state.muted || !Notification.isSupported()) return;
  lastDoneNote = Date.now();
  const who = done.length > 2 ? `${done.length} agents` : done.map(d => d.name).join(', ');
  banner(`${who} done`, done[0].id, true);
}
// the pet can't be seen (hidden, or the user stepped away): only then does an OS banner earn its interruption
const away = () => !win || win.isDestroyed() || !win.isVisible() || powerMonitor.getSystemIdleTime() > 60;

// ---------- claude code sessions ----------
const sessions = new Map(); // id -> { phase, since, … }

// phases are settled against each session's subagents (agents.js fanout/settle), so a fan-out never reads as stuck or done
const scanAgents = () => scan(CLAUDE_DIR, sessions, transition);

function transition(s, prev) {
  const { name, id, phase } = s, was = prev.phase === 'working' || prev.phase === 'stalled';
  if (phase === 'ready' && was) {
    emit('agentDone', `${name} is done`, { agent: name, id });
    if (away()) queueDone({ name, id });
  } else if (phase === 'waiting' && was) {
    emit('agentNeeds', `${name} has a question`, { agent: name, id, notify: away() });
  } else if (phase === 'stalled' && prev.phase === 'working') {
    emit('agentStalled', `${name} needs approval`, { agent: name, id, notify: away() });
  }
}

// ---------- git ----------
const git = (cwd, args) => new Promise(res =>
  execFile('git', args, { cwd, timeout: 5000, maxBuffer: 8e6 }, (e, out) => res(e ? null : out.trimEnd())));

const heads = new Map();      // root -> sha
const rootCache = new Map();  // dir -> root|null
let gitInfo = null;

async function rootOf(dir) {
  if (!dir) return null;
  if (rootCache.has(dir)) return rootCache.get(dir);
  const root = await git(dir, ['rev-parse', '--show-toplevel']);
  if (root) rootCache.set(dir, root); // don't cache misses: the dir may be `git init`ed later
  return root;
}

async function scanGit(agents) {
  const roots = new Set();
  for (const a of agents) { const r = await rootOf(a.cwd); if (r) roots.add(r); }
  // auto-focus is sticky: only move off the current repo once no live agent is working in it
  const live = agents.filter(a => a.phase !== 'parked'), cur = gitInfo?.root;
  const stick = cur && (!live.length || live.some(a => a.cwd === cur || a.cwd?.startsWith(cur + path.sep)));
  const focusDir = state.repo || (stick ? cur : live[0]?.cwd || agents[0]?.cwd) || cur;
  const focus = await rootOf(focusDir);
  if (focus) roots.add(focus);

  // commit detection across every repo an agent is touching
  for (const root of roots) {
    const last = await git(root, ['log', '-1', '--format=%H%x09%P%x09%ct%x09%s']);
    if (!last) continue;
    const [sha, parents, ct, ...subj] = last.split('\t');
    const prev = heads.get(root);
    heads.set(root, sha);
    // only a new commit on top of the previous HEAD counts (not checkout/reset/fast-forward)
    const isNewCommit = prev && prev !== sha && parents.split(' ').includes(prev);
    if (isNewCommit && +ct * 1000 > Date.now() - 10 * 60e3) {
      onCommit(path.basename(root), subj.join('\t'), gitInfo?.root === root ? gitInfo.lines : 0);
    }
  }

  if (!focus) { gitInfo = focusDir ? { root: null, dir: focusDir } : null; return; }
  const [numstat, untracked, last, branch] = await Promise.all([
    git(focus, ['diff', 'HEAD', '--numstat']),
    git(focus, ['ls-files', '--others', '--exclude-standard']),
    git(focus, ['log', '-1', '--format=%ct%x09%s']),
    git(focus, ['branch', '--show-current']),
  ]);
  let lines = 0, files = 0;
  for (const l of (numstat || '').split('\n')) {
    if (!l) continue;
    const [a, d] = l.split('\t');
    files++; lines += (parseInt(a) || 0) + (parseInt(d) || 0);
  }
  const [ct, ...subj] = (last || '').split('\t');
  gitInfo = {
    root: focus, name: path.basename(focus), branch, lines, files,
    untracked: untracked ? untracked.split('\n').filter(Boolean).length : 0,
    lastCommitAt: ct ? +ct * 1000 : null, lastSubject: subj.join('\t'),
  };
}

function onCommit(repo, subject, lines) {
  const xp = 10 + Math.min(40, Math.round(lines / 25));
  state.commits++;
  if (!state.game) return;
  state.fuel = clamp(state.fuel + 30);
  state.mood = clamp(state.mood + 8);
  emit('commit', `nom! "${subject.slice(0, 60)}" +${xp}xp`, { repo });
  gainXP(xp);
}

// ---------- tick ----------
let busy = false, agents = [];
async function tick() {
  if (busy) return;
  busy = true;
  try {
    decay();
    agents = scanAgents();
    await scanGit(agents);
    if (win && !win.isDestroyed()) win.webContents.send('tick', snapshot());
    save();
  } catch (e) { console.error(e); }
  finally { busy = false; }
}

function snapshot() {
  const level = levelFor(state.xp);
  return {
    name: state.name, level, xp: state.xp, xpLo: xpForLevel(level), xpHi: xpForLevel(level + 1),
    fuel: state.fuel, mood: state.mood, commits: state.commits,
    agents: agents.map(a => ({ id: a.id, name: a.name, title: a.title, phase: a.phase, since: a.since, ask: a.ask, fanout: a.fanout,
      receipt: a.receipt && { ...a.receipt, files: [...a.receipt.files] } })),
    git: gitInfo, muted: state.muted, animations: state.animations, game: state.game, pet: state.pet, hasKey: hasKey(), hour: new Date().getHours(),
    watching: state.repo ? 'manual' : 'auto',
  };
}

// ---------- chat ----------
// The keychain is touched only by getKey(), only at send time, and only when the saved key is the
// engine: the user's own `claude` login is the default, so most people never see a keychain prompt.
// A denied/failed unlock is remembered for the session so macOS doesn't ask again and again.
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || state.keyEnc || sessionKey);
let keyDenied = false;
function getKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (sessionKey) return sessionKey;
  if (keyDenied || !state.keyEnc || !safeStorage.isEncryptionAvailable()) return null;
  try { sessionKey = safeStorage.decryptString(Buffer.from(state.keyEnc, 'base64')) || null; } catch { sessionKey = null; }
  if (!sessionKey) keyDenied = true;
  return sessionKey;
}
// 'key' ready · 'key-locked' saved key, macOS will ask on first send · 'claude' login · null nothing yet
async function engine() {
  if (process.env.ANTHROPIC_API_KEY || sessionKey) return state.engine === 'claude' && await findClaude() ? 'claude' : 'key';
  const bin = state.engine === 'key' && state.keyEnc && !keyDenied ? null : await findClaude();
  if (bin) return 'claude';
  return state.keyEnc && !keyDenied ? 'key-locked' : null;
}

function agentTranscript(s, n = 4) {
  if (!s) return '(no active agent session)';
  const out = [];
  const lines = readTail(s.file, 262144);
  for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    if (d.isSidechain || d.isMeta) continue;
    if (d.type === 'assistant') {
      const t = textOf(d.message?.content).trim();
      const tools = (d.message?.content || []).filter(c => c.type === 'tool_use').map(c => c.name + ' ' + JSON.stringify(c.input).slice(0, 160));
      if (t) out.push('AGENT: ' + t.slice(0, 700));
      else if (tools.length) out.push('AGENT TOOL: ' + tools.join('; '));
    } else if (d.type === 'user') {
      const t = textOf(d.message?.content).trim();
      if (t && !t.startsWith('<')) out.push('HUMAN: ' + t.slice(0, 400));
    }
  }
  return `[${s.name} · ${s.phase}]\n` + out.reverse().join('\n');
}

async function buildContext(mode) {
  const g = gitInfo;
  const parts = [
    state.game && `Pet stats: level ${levelFor(state.xp)}, fuel ${Math.round(state.fuel)}/100, mood ${Math.round(state.mood)}/100, total commits witnessed ${state.commits}.`,
    `Local time: ${new Date().toLocaleString()}.`,
    `Agents: ${agents.length ? agents.map(a => `${a.name}=${a.phase} for ${Math.round((Date.now() - a.since) / 1000)}s`).join(', ') : 'none active'}.`,
  ];
  if (g?.root) {
    parts.push(`Repo: ${g.name} (branch ${g.branch || '?'}): ${g.lines} uncommitted lines across ${g.files} files, ${g.untracked} untracked files. Last commit ${g.lastCommitAt ? Math.round((Date.now() - g.lastCommitAt) / 60000) + ' min ago' : 'never'}: "${g.lastSubject}".`);
    const [stat, log] = await Promise.all([git(g.root, ['diff', 'HEAD', '--stat']), git(g.root, ['log', '--oneline', '-8'])]);
    parts.push('Recent commits:\n' + (log || '(none)'));
    parts.push('Diff stat:\n' + (stat || '(clean)').split('\n').slice(-30).join('\n'));
    if (mode === 'commit' || mode === 'vibe') {
      const [diff, untracked] = await Promise.all([git(g.root, ['diff', 'HEAD']), git(g.root, ['ls-files', '--others', '--exclude-standard'])]);
      parts.push('Diff (truncated):\n' + (diff || '').slice(0, 16000));
      if (untracked) parts.push('Untracked files:\n' + untracked.split('\n').slice(0, 30).join('\n'));
    }
  } else parts.push('Repo: none detected.');
  if (mode === 'agent' || mode === 'next') parts.push('Latest agent transcript:\n' + agentTranscript(agents[0]));
  return parts.filter(Boolean).join('\n\n');
}

const SYSTEM = name => `You are ${name}, a small desktop companion for someone who builds software by directing AI coding agents like Claude Code. You can see their live repo state and agent status (attached as context).

How to answer:
- Answer the question first, in 1-3 short sentences. Longer only when asked, or when writing a commit message or a prompt.
- Calm, friendly, plain. No roleplay or *actions*, no emojis unless the user uses them, no exclamation-mark enthusiasm.
- Never nag: don't push them to commit, ship, or reply to an agent unless they ask what to do.
- Use the context to be specific, but don't recite raw stats (line counts, seconds, timestamps) unless asked. Say "a few minutes", "a sizeable diff", or name the file instead.
- A greeting gets a one-line friendly reply plus one concrete, useful offer based on the context (e.g. "Want a commit message for the renderer changes?").
- If you don't know, say so briefly.`;

// no key: the user's own `claude` login. Looked up on the first chat open only, then cached for the process.
let claudeBin;   // undefined = not looked yet, null = none
function findClaude() {
  if (claudeBin !== undefined) return Promise.resolve(claudeBin);
  const h = os.homedir();
  for (const p of [process.env.VIBEPET_CLAUDE_BIN, path.join(h, '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(h, '.claude/local/claude')]) {
    if (!p) continue;
    try { fs.accessSync(p, fs.constants.X_OK); return Promise.resolve(claudeBin = p); } catch {}
  }
  return new Promise(res => execFile('/bin/zsh', ['-lc', 'command -v claude'], { timeout: 3000 }, (e, out) => {
    const p = !e && out.trim().split('\n').pop();
    res(claudeBin = p && p.startsWith('/') ? p : null);
  }));
}
ipcMain.handle('chat-via', () => engine());

const AUTH_RE = /log ?in|auth|api key|credential|unauthori[sz]ed|\b401\b/i;
function runClaude(bin, args, input) {
  return new Promise(res => {
    const dir = path.join(os.tmpdir(), 'vibepet-chat');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    let out = '', done = false;
    const fin = code => { if (done) return; done = true; clearTimeout(t); app.removeListener('will-quit', quit); res({ code, out }); };
    let c; try { c = spawn(bin, args, { cwd: dir, stdio: ['pipe', 'pipe', 'ignore'] }); } catch { return res({ code: -2, out: '' }); }
    const quit = () => c.kill('SIGKILL'); app.once('will-quit', quit);   // no orphan claude after the pet exits
    const t = setTimeout(() => { c.kill('SIGKILL'); fin(-1); }, 90000);
    c.stdout.on('data', b => { out += b; });
    c.on('error', () => fin(-2));
    c.on('close', fin);
    c.stdin.on('error', () => {});
    c.stdin.end(input);
  });
}
let claudeBusy = false;
async function chatViaClaude(bin, messages, mode) {
  if (claudeBusy) return { error: 'still thinking about the last one' };
  claudeBusy = true;
  try {
    // the repo context (diff included) rides stdin, never argv: argv is readable by `ps` and logged by endpoint agents
    const sys = SYSTEM(state.name) + '\n\nThe user\'s message starts with a <live_context> block the app attached: their live repo and agent state.';
    const input = '<live_context>\n' + await buildContext(mode) + '\n</live_context>\n\n' +
      messages.map(m => `${m.role === 'user' ? 'User' : state.name}: ${m.content}`).join('\n\n');
    const base = ['-p', '--no-session-persistence', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--output-format', 'json'];
    const parse = s => { try { return JSON.parse(s); } catch { return null; } };
    let r = await runClaude(bin, [...base, '--model', state.model, '--system-prompt', sys], input), j = parse(r.out);
    // a model this login can't use comes back as parsable JSON with is_error (exit 1): retry once on the CLI's own default
    if (!j && r.code > 0 || j?.is_error && (j.api_error_status === 404 || /selected model/i.test(j.result || ''))) { r = await runClaude(bin, [...base, '--system-prompt', sys], input); j = parse(r.out); }
    if (!j) return AUTH_RE.test(r.out) ? { error: 'nokey' } : { error: r.code === -1 ? 'claude timed out' : r.code === -2 ? (claudeBin = undefined, 'couldn\'t start claude') : `claude exited ${r.code}` };
    const text = String(j.result || '').trim();
    if (j.is_error || !text) return AUTH_RE.test(text) ? { error: 'nokey' } : { error: text || 'claude returned nothing' };
    state.mood = clamp(state.mood + 1);
    return { text, via: 'claude' };
  } finally { claudeBusy = false; }
}

ipcMain.handle('chat', async (_, { messages, mode }) => {
  const via = await engine();
  const key = via === 'key' || via === 'key-locked' ? getKey() : null;
  if (!key) {
    const bin = await findClaude();
    if (!bin) return { error: 'nokey' };
    const r = await chatViaClaude(bin, messages, mode);
    return via === 'key-locked' && !r.error ? { ...r, note: 'Couldn\'t unlock the saved key, so I used your Claude Code login.' } : r;
  }
  try {
    const ctx = await buildContext(mode);
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: state.model, max_tokens: 800,
        system: SYSTEM(state.name) + '\n\n<live_context>\n' + ctx + '\n</live_context>',
        messages,
      }),
    });
    const j = await r.json();
    if (!r.ok) return { error: j.error?.message || `HTTP ${r.status}` };
    state.mood = clamp(state.mood + 1);
    return { text: (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() };
  } catch (e) { return { error: e.message }; }
});

ipcMain.handle('set-key', (_, key) => {
  key = (key || '').trim();
  state.keyPlain = null;
  if (safeStorage.isEncryptionAvailable()) { state.keyEnc = key ? safeStorage.encryptString(key).toString('base64') : null; sessionKey = key || null; }
  else sessionKey = key || null; // no keychain: keep it in memory only, never write plaintext to disk
  keyDenied = false;
  state.engine = key ? 'key' : null;
  save();
  return hasKey();
});

// ---------- window + interaction ----------
// pos if it's on some display, else the primary's bottom-right corner
function homePos(pos) {
  const onScreen = pos && screen.getAllDisplays().some(d => {
    const b = d.workArea; return pos.x > b.x - W / 2 && pos.x < b.x + b.width - W / 2 && pos.y >= b.y - petTop && pos.y < b.y + b.height - 100;
  });
  if (onScreen) return pos;
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - W - 24, y: workArea.y + workArea.height - H };
}
const areas = () => screen.getAllDisplays().map(d => d.workArea);
// every move goes through here: panels flip below Net when there's no room above him (see place.js)
function moveTo(v) {
  const a = areaFor({ x: v.x + W / 2, y: v.y + petTop + 104 }, areas());
  virt = { x: Math.round(v.x), y: Math.round(Math.max(v.y, minY(a, petTop))) };
  const p = place(virt, areas(), W, petTop);
  if (!win || win.isDestroyed()) return p;
  if (p.below !== below) { below = p.below; win.webContents.send('below', below); }
  const [x, y] = win.getPosition();
  if (x !== p.x || y !== p.y) win.setPosition(p.x, p.y);
  return p;
}
function createWindow() {
  const pos = homePos(state.pos);
  win = new BrowserWindow({
    width: W, height: H, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    hasShadow: false, alwaysOnTop: state.onTop, skipTaskbar: true, fullscreenable: false, backgroundColor: '#00000000',
    acceptFirstMouse: true,   // Net is never the key window: without this macOS eats the first click to activate him
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(state.onTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => { tick(); below = false; moveTo(pos); });
  screen.on('display-metrics-changed', () => virt && moveTo(virt));

  // eyes follow the cursor anywhere on screen: sent only on change; 60 Hz near the pet while moving, 10 Hz otherwise
  let last = '', movedAt = 0;
  (function feed() {
    if (win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), [x, y] = win.getPosition(), c = { x: p.x - x, y: p.y - y }, k = c.x + ',' + c.y;
    if (k !== last) { last = k; movedAt = Date.now(); win.webContents.send('cursor', c); }
    const near = c.x > -220 && c.x < W + 220 && c.y > -220 && c.y < H + 220;
    setTimeout(feed, near && Date.now() - movedAt < 500 ? 16 : 100);
  })();
}

let drag = null;
ipcMain.on('set-ignore', (_, v) => !win.isDestroyed() && win.setIgnoreMouseEvents(v, { forward: true }));
ipcMain.on('pet-top', (_, t) => { if (t > 0 && t < H && t !== petTop) { petTop = t; if (virt && !below) moveTo(virt); } });
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(), { x, y } = virt || { x: win.getPosition()[0], y: win.getPosition()[1] };
  clearInterval(drag?.timer);
  drag = { cx: c.x, cy: c.y, x, y, timer: setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(drag?.timer);
    const p = screen.getCursorScreenPoint();
    moveTo({ x: drag.x + p.x - drag.cx, y: drag.y + p.y - drag.cy });
  }, 16) };
});
ipcMain.on('drag-end', () => {
  if (!drag) return;
  clearInterval(drag.timer); drag = null;
  state.pos = { ...virt }; save();
});
ipcMain.on('focus', () => { app.focus({ steal: true }); win.focus(); });
ipcMain.on('copy', (_, text) => clipboard.writeText(text));
// click → the terminal tab that session runs in (iTerm2/Terminal), else its app, else copy a resume command.
// The only place ps/lsof/osascript ever run; nothing is typed into any terminal.
const shq = s => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
ipcMain.handle('jump', async (_, id) => {
  const s = sessions.get(id);
  if (!s) return { ok: false };
  try {
    const procs = await psAll(), loc = await locateSession(s, procs), host = loc && hostApp(loc.pid, procs);
    if (host) {
      const bid = await bundleId(host);
      if (await focusTty(bid, loc.tty)) return { ok: true, level: 'tab' };
      if (await run('/usr/bin/open', bid ? ['-b', bid] : ['-a', host]) !== null) return { ok: true, level: 'app' };
    }
  } catch (e) { console.error('jump:', e.message); }
  const cmd = `${s.cwd ? `cd ${shq(s.cwd)} && ` : ''}claude --resume ${shq(id)}`;
  clipboard.writeText(cmd);
  return { ok: false, cmd };
});
ipcMain.on('rename', (_, name) => { name = (name || '').trim().slice(0, 16); if (name) { state.name = name; save(); tick(); } });
ipcMain.on('exit-done', () => app.quit());
ipcMain.on('pet', () => {
  if (Date.now() - state.lastPet > 10000) { state.lastPet = Date.now(); state.mood = clamp(state.mood + 2); save(); }
});

function buildMenu() {
  const g = gitInfo;
  const pickRepo = async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: g?.root || os.homedir() });
    if (!r.canceled && r.filePaths[0]) { state.repo = r.filePaths[0]; save(); tick(); }
  };
  const toggle = (label, key, after) => ({ label, type: 'checkbox', checked: !!state[key], click: m => { state[key] = m.checked; after?.(m.checked); save(); tick(); } });
  return Menu.buildFromTemplate([
    { label: g?.root ? `Watching ${g.name}` : 'No repo yet', submenu: [
      { label: 'Follow my agent', type: 'radio', checked: !state.repo, click: () => { state.repo = null; save(); tick(); } },
      { label: 'Choose a repo…', type: 'radio', checked: !!state.repo, click: pickRepo },
    ] },
    { label: 'Chat…', click: () => emit('openChat') },
    { label: 'Pet', submenu: PETS.map(([id, label]) => ({ label, type: 'radio', checked: state.pet === id, click: () => { state.pet = id; save(); tick(); } })) },
    { label: 'Toss a snack', visible: state.game, click: () => {
      if (Date.now() - state.lastSnack < 30 * 60e3) return emit('snackNo', 'snacks are nice but I run on commits. (one snack per 30 min)');
      state.lastSnack = Date.now(); state.fuel = clamp(state.fuel + 10); save(); emit('snack', 'crunch. thanks! (commits are the real meal though)');
    } },
    { type: 'separator' },
    { label: 'Settings', submenu: [
      { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
      toggle('Keep on top', 'onTop', v => win.setAlwaysOnTop(v, 'floating')),
      toggle('Mute notifications', 'muted'),
      { type: 'separator' },
      toggle('Animations', 'animations'),
      toggle('Game mode', 'game', () => { state.lastDecay = Date.now(); }),
      { type: 'separator' },
      { label: `Jump key${keyTaken ? ' (taken)' : ''}`, submenu: KEYS.map(([label, k]) => ({
        label, type: 'radio', checked: state.hotkey === k, click: () => { state.hotkey = k; save(); bindKey(); } })) },
      { label: 'Gesture', submenu: [
        { label: 'On', type: 'radio', enabled: !!gest().templates.length, checked: gest().on && !!gest().templates.length, click: () => { gest().on = true; save(); syncWatch(); } },
        { label: 'Off', type: 'radio', checked: !(gest().on && gest().templates.length), click: () => { gest().on = false; save(); syncWatch(); } },
        { type: 'separator' },
        { label: gest().templates.length ? 'Record a new gesture…' : 'Record gesture…', click: recordGesture },
        { label: 'Sensitivity', submenu: [['Low', 'low'], ['Medium', 'med'], ['High', 'high']].map(([label, v]) => ({
          label, type: 'radio', checked: gest().sens === v, click: () => { gest().sens = v; save(); } })) },
      ] },
      { label: 'Chat engine', submenu: [
        { label: `Claude Code login (recommended)${claudeBin === null ? ' — not found' : ''}`, type: 'radio', enabled: claudeBin !== null, checked: state.engine !== 'key', click: () => { state.engine = 'claude'; save(); } },
        { label: hasKey() ? 'Anthropic API key' : 'Anthropic API key…', type: 'radio', checked: state.engine === 'key', click: () => { if (hasKey()) { state.engine = 'key'; keyDenied = false; save(); } else emit('openKey'); } },
      ] },
      { label: 'Chat model', submenu: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'].map(m => ({
        label: m, type: 'radio', checked: state.model === m, click: () => { state.model = m; save(); } })) },
      { label: hasKey() ? 'Change API key…' : 'Set API key…', click: () => emit('openKey') },
      { label: `Rename ${state.name}…`, click: () => emit('openRename') },
    ] },
    { label: `${win.isVisible() ? 'Hide' : 'Show'} ${state.name}`, click: () => toggleNet(trayPoint()) },
    { type: 'separator' },
    { label: `Quit ${state.name}`, click: () => { emit('exit'); setTimeout(() => app.quit(), 2500); } },
  ]);
}
ipcMain.on('menu', () => buildMenu().popup({ window: win }));

// ---------- menu bar icon: click toggles Net (he spawns under the icon), right-click is his menu ----------
let tray = null;
const trayPoint = () => { const b = tray?.getBounds(); return b?.width ? { x: b.x + b.width / 2, y: b.y + b.height } : screen.getCursorScreenPoint(); };
function createTray() {
  tray = new Tray(path.join(__dirname, 'renderer', 'trayTemplate.png'));
  tray.setToolTip(state.name);
  tray.on('click', () => toggleNet(trayPoint()));
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
}

// ---------- the jump door: a global key walks the renderer's queue (it owns pending()) ----------
const KEYS = [['⌃⌥⌘J', 'Control+Alt+Command+J'], ['⌥⌘J', 'Alt+Command+J'], ['Off', null]];   // not ⌥Space (Raycast/ChatGPT) or ⌃⌥Space (input source)
let keyTaken = false;
function bindKey() {
  globalShortcut.unregisterAll();
  let ok = true;
  if (state.hotkey) try { ok = globalShortcut.register(state.hotkey, () => { if (!win.isVisible()) win.showInactive(), send('summon'); send('hotkey'); }); } catch { ok = false; }
  keyTaken = !ok;   // someone else has it: stay quiet, the menu says so
}
app.on('will-quit', () => globalShortcut.unregisterAll());

// ---------- summon gesture: draw your own trained shape anywhere — Net vanishes, draw it again and he appears at the cursor ----------
// Cursor-position polling only (gesture.js) — no event hooks, no Accessibility — and only while a gesture is on or being recorded.
const gest = () => (state.gesture ||= { on: false, sens: 'med', templates: [] });
let rec = null, toggledAt = 0;   // rec = { samples } while training on the pad
const gw = gesture.watcher(screen, stroke => {
  const g = gest();
  if (!rec && Date.now() - toggledAt > 2500 && gesture.recognize(stroke, g.templates, g.sens).ok) toggleNet(stroke[stroke.length - 1]);
});
function syncWatch() { const g = gest(); !rec && g.on && g.templates.length ? gw.start() : gw.stop(); }
// training happens on a pad Net holds up: each click-drag is one sample. Forgiving: only a dot or a flick is
// refused, and if two of three agree we keep those two and ask for one more instead of starting over.
const recSend = (extra = {}) => send('gesture-rec', { previews: rec ? rec.samples.map(gesture.normalize) : [], ...extra });
ipcMain.on('gesture-sample', (_, pts) => {
  if (!rec || !Array.isArray(pts)) return;
  pts = pts.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)).slice(0, 2000).map(p => ({ x: +p.x, y: +p.y, t: +p.t || 0 }));
  if (gesture.trivial(pts)) return recSend({ hint: 'That was tiny — draw it a little bigger.' });
  rec.samples.push(pts);
  if (rec.samples.length < 3) return recSend();
  const set = gesture.consistentSet(rec.samples);
  if (set.length >= 3) {
    const g = gest(); g.templates = set.slice(0, 3).map(gesture.template); g.on = true; save();
    const previews = set.slice(0, 3).map(gesture.normalize);
    rec = null; syncWatch();
    return send('gesture-rec', { previews, done: true });
  }
  rec.samples = set.length === 2 ? set : rec.samples.slice(-1);
  recSend({ hint: set.length === 2 ? 'Two of those match — once more like those.' : 'Those looked different — draw the same shape as the last one.' });
});
ipcMain.on('gesture-undo', () => { if (rec) { rec.samples.pop(); recSend(); } });
function summonAt(p) {
  const d = screen.getDisplayNearestPoint(p).workArea;
  const x = Math.round(Math.min(Math.max(p.x - W / 2, d.x), d.x + d.width - W)), y = Math.round(Math.min(Math.max(p.y - H + 120, minY(d, petTop)), d.y + d.height - H));
  moveTo({ x, y }); state.pos = { ...virt }; save();
  win.showInactive(); send('summon');
}
function toggleNet(p) { toggledAt = Date.now(); win.isVisible() ? hideNet() : summonAt(p); }
function hideNet() { send('hide'); setTimeout(() => { if (!win.isDestroyed()) win.hide(); }, 260); }
function recordGesture() { rec = { samples: [] }; if (!win.isVisible()) send('summon'); win.show(); app.focus({ steal: true }); win.focus(); syncWatch(); recSend({ start: true }); }
ipcMain.on('gesture-cancel', () => { rec = null; syncWatch(); });

// "Lost him? Open vibepet again." — a second launch re-homes the running pet and opens its pill once
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  const p = homePos(virt);
  if (p !== virt) { moveTo(p); state.pos = { ...virt }; save(); }
  win.showInactive();
  send('summon');
});

app.whenReady().then(() => {
  if (!primary) return;
  load();
  if (process.platform === 'darwin') app.dock?.hide();
  createWindow();
  createTray();
  bindKey();
  syncWatch();
  setTimeout(findClaude, 3000);   // so the Chat engine menu knows whether the login exists
  setInterval(tick, TICK_MS);
  if (process.env.VIBEPET_TEST) globalThis.__vibepet = { banners, banner, bindKey, keyTaken: () => keyTaken };
});
app.on('window-all-closed', () => app.quit());
