// vibepet — a desktop pet that watches your coding agents and your repo.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, safeStorage, Notification, clipboard, powerMonitor, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { readTail, textOf, scan, psAll, locateSession, hostApp, bundleId, focusTty, run } = require('./agents');

const W = 360, H = 520;
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const TICK_MS = 3000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.disableHardwareAcceleration();   // a 224×208 pixel canvas + one CSS capsule: the GPU process costs memory, buys nothing
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();   // the running pet gets 'second-instance' instead

// ---------- state ----------
const DEFAULTS = {
  name: 'Net', xp: 0, fuel: 80, mood: 70, commits: 0, quickDraws: 0,
  repo: null, pos: null, model: 'claude-sonnet-5', keyEnc: null, keyPlain: null,
  muted: false, onTop: true, hotkey: 'Control+Alt+Command+J', animations: false, game: false, born: Date.now(), lastDecay: Date.now(), lastSnack: 0, lastPet: 0,
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
    agents: agents.map(a => ({ id: a.id, name: a.name, title: a.title, phase: a.phase, since: a.since, ask: a.ask, fanout: a.fanout })),
    git: gitInfo, muted: state.muted, animations: state.animations, game: state.game, hasKey: hasKey(), hour: new Date().getHours(),
    watching: state.repo ? 'manual' : 'auto',
  };
}

// ---------- chat ----------
// Only getKey() touches the keychain, and only when chat actually needs the key, so people who
// never chat never see a macOS keychain prompt. The decrypted key is cached for the session.
const hasKey = () => !!(process.env.ANTHROPIC_API_KEY || state.keyEnc || sessionKey);
function getKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (sessionKey) return sessionKey;
  if (state.keyEnc && safeStorage.isEncryptionAvailable()) {
    try { sessionKey = safeStorage.decryptString(Buffer.from(state.keyEnc, 'base64')); } catch { return null; }
  }
  return sessionKey;
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

const SYSTEM = name => `You are ${name}, a tiny pixel creature who lives on the desktop of a "vibe coder" — someone who builds software mostly by directing AI coding agents like Claude Code. You watch their agents and their git repo. You eat commits (that's literally how you're fed).

Voice: warm, playful, a little cheeky, never cutesy-to-the-point-of-useless. Be genuinely useful: you can actually see their repo state and agent status below. Default to 1-3 short sentences unless asked for more or writing a commit message. No headers. Occasional pet flavor is fine (*wiggles*), but at most one per reply.

Things you care about: committing often (save points protect against a bad agent turn), reading diffs before shipping, answering the agent when it's waiting, not coding at 4am, and shipping.`;

ipcMain.handle('chat', async (_, { messages, mode }) => {
  const key = getKey();
  if (!key) return { error: 'nokey' };
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
  save();
  return hasKey();
});

// ---------- window + interaction ----------
// pos if it's on some display, else the primary's bottom-right corner
function homePos(pos) {
  const onScreen = pos && screen.getAllDisplays().some(d => {
    const b = d.workArea; return pos.x > b.x - W / 2 && pos.x < b.x + b.width - W / 2 && pos.y > b.y - H / 2 && pos.y < b.y + b.height - 100;
  });
  if (onScreen) return pos;
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - W - 24, y: workArea.y + workArea.height - H };
}
function createWindow() {
  const pos = homePos(state.pos);
  win = new BrowserWindow({
    width: W, height: H, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    hasShadow: false, alwaysOnTop: state.onTop, skipTaskbar: true, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(state.onTop, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => tick());

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
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(), [x, y] = win.getPosition();
  clearInterval(drag?.timer);
  drag = { cx: c.x, cy: c.y, x, y, timer: setInterval(() => {
    if (!win || win.isDestroyed()) return clearInterval(drag?.timer);
    const p = screen.getCursorScreenPoint();
    win.setPosition(drag.x + p.x - drag.cx, drag.y + p.y - drag.cy);
  }, 16) };
});
ipcMain.on('drag-end', () => {
  if (!drag) return;
  clearInterval(drag.timer); drag = null;
  const [x, y] = win.getPosition(); state.pos = { x, y }; save();
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

ipcMain.on('menu', () => {
  const g = gitInfo;
  Menu.buildFromTemplate([
    { label: state.game ? `${state.name} · Lv ${levelFor(state.xp)} · ${state.xp}xp` : state.name, enabled: false },
    { label: g?.root ? `Watching ${g.name}${state.repo ? '' : ' (following your agent)'}` : 'No repo yet — start an agent or pick one', enabled: false },
    { type: 'separator' },
    { label: 'Chat…', click: () => emit('openChat') },
    { label: 'Watch a repo…', click: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: g?.root || os.homedir() });
      if (!r.canceled && r.filePaths[0]) { state.repo = r.filePaths[0]; save(); tick(); }
    } },
    { label: 'Follow my active agent (auto)', type: 'checkbox', checked: !state.repo, click: () => { state.repo = null; save(); tick(); } },
    { type: 'separator' },
    { label: 'Toss a snack', visible: state.game, click: () => {
      if (Date.now() - state.lastSnack < 30 * 60e3) return emit('snackNo', 'snacks are nice but I run on commits. (one snack per 30 min)');
      state.lastSnack = Date.now(); state.fuel = clamp(state.fuel + 10); save(); emit('snack', 'crunch. thanks! (commits are the real meal though)');
    } },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { label: 'Mute notifications', type: 'checkbox', checked: state.muted, click: m => { state.muted = m.checked; save(); tick(); } },
    { label: 'Game mode (XP, hunger, levels)', type: 'checkbox', checked: state.game, click: m => { state.game = m.checked; state.lastDecay = Date.now(); save(); tick(); } },
    { label: 'Animations', type: 'checkbox', checked: state.animations, click: m => { state.animations = m.checked; save(); tick(); } },
    { label: `Jump key${keyTaken ? ' (taken)' : ''}`, submenu: KEYS.map(([label, k]) => ({
      label, type: 'radio', checked: state.hotkey === k, click: () => { state.hotkey = k; save(); bindKey(); } })) },
    { label: 'Keep on top', type: 'checkbox', checked: state.onTop, click: m => { state.onTop = m.checked; win.setAlwaysOnTop(m.checked, 'floating'); save(); } },
    { label: 'Model', submenu: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'].map(m => ({
      label: m, type: 'radio', checked: state.model === m, click: () => { state.model = m; save(); } })) },
    { label: hasKey() ? 'Change API key…' : 'Set Anthropic API key…', click: () => emit('openKey') },
    { label: 'Rename…', click: () => emit('openRename') },
    { type: 'separator' },
    { label: `Quit ${state.name}`, click: () => { emit('exit'); setTimeout(() => app.quit(), 2500); } },
  ]).popup({ window: win });
});

// ---------- the jump door: a global key walks the renderer's queue (it owns pending()) ----------
const KEYS = [['⌃⌥⌘J', 'Control+Alt+Command+J'], ['⌥⌘J', 'Alt+Command+J'], ['Off', null]];   // not ⌥Space (Raycast/ChatGPT) or ⌃⌥Space (input source)
let keyTaken = false;
function bindKey() {
  globalShortcut.unregisterAll();
  let ok = true;
  if (state.hotkey) try { ok = globalShortcut.register(state.hotkey, () => send('hotkey')); } catch { ok = false; }
  keyTaken = !ok;   // someone else has it: stay quiet, the menu says so
}
app.on('will-quit', () => globalShortcut.unregisterAll());

// "Lost him? Open vibepet again." — a second launch re-homes the running pet and opens its pill once
app.on('second-instance', () => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition(), p = homePos({ x, y });
  if (p.x !== x || p.y !== y) { win.setPosition(p.x, p.y); state.pos = p; save(); }
  win.showInactive();
  send('summon');
});

app.whenReady().then(() => {
  if (!primary) return;
  load();
  if (process.platform === 'darwin') app.dock?.hide();
  createWindow();
  bindKey();
  setInterval(tick, TICK_MS);
  if (process.env.VIBEPET_TEST) globalThis.__vibepet = { banners, banner, bindKey, keyTaken: () => keyTaken };
});
app.on('window-all-closed', () => app.quit());
