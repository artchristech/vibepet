// vibepet — a desktop pet that watches your coding agents and your repo.
const { app, BrowserWindow, ipcMain, screen, Menu, dialog, safeStorage, Notification, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const W = 360, H = 520;
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const TICK_MS = 3000;

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (!app.requestSingleInstanceLock()) app.quit();

// ---------- state ----------
const DEFAULTS = {
  name: 'Net', xp: 0, fuel: 80, mood: 70, commits: 0, quickDraws: 0, commitDays: [],
  repo: null, pos: null, model: 'claude-sonnet-5', keyEnc: null, keyPlain: null,
  muted: false, born: Date.now(), lastDecay: Date.now(), lastSnack: 0, lastPet: 0,
};
let state, saveTimer, win;
const statePath = () => path.join(app.getPath('userData'), 'state.json');
function load() {
  try { state = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(statePath(), 'utf8')) }; }
  catch { state = { ...DEFAULTS }; }
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  }, 300);
}

const clamp = v => Math.max(0, Math.min(100, v));
const levelFor = xp => Math.floor(Math.sqrt(xp / 40)) + 1; // L2=40, L3=160, L4=360, L5=640…
const xpForLevel = l => 40 * (l - 1) ** 2;
const UNLOCKS = { 2: 'blush', 3: 'sparkle trail', 4: 'headphones', 5: 'shades (hover me)', 7: 'crown' };
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA');

function streak() {
  const days = new Set(state.commitDays);
  const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

function decay() {
  const now = Date.now();
  const min = Math.min(240, (now - state.lastDecay) / 60000);
  if (min < 0.25) return;
  state.lastDecay = now;
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

function emit(kind, text, { notify = false, ...extra } = {}) {
  if (win && !win.isDestroyed()) win.webContents.send('event', { kind, text, ...extra });
  if (notify && !state.muted && Notification.isSupported()) {
    new Notification({ title: state.name, body: text, silent: false }).show();
  }
}

// ---------- claude code sessions ----------
const sessions = new Map(); // id -> { phase, since, … }

function readTail(file, bytes = 131072) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    return lines;
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

function classify(file, mtimeMs) {
  const idle = Date.now() - mtimeMs;
  const lines = readTail(file);
  let cwd = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd;
    if (d.isSidechain || d.isMeta || (d.type !== 'assistant' && d.type !== 'user')) continue;
    cwd = d.cwd || cwd;
    if (d.type === 'assistant') {
      const m = d.message || {};
      if ((m.content || []).some(c => c.type === 'tool_use')) return { phase: idle > 25000 ? 'stalled' : 'working', cwd };
      if (['end_turn', 'stop_sequence', 'max_tokens'].includes(m.stop_reason)) {
        return { phase: idle > 15 * 60e3 ? 'parked' : 'waiting', cwd };
      }
      return { phase: 'working', cwd };
    }
    const txt = textOf(d.message?.content);
    if (txt.startsWith('[Request interrupted')) return { phase: 'parked', cwd };
    return { phase: idle > 120000 ? 'parked' : 'working', cwd };
  }
  return null;
}

function scanAgents() {
  let dirs; try { dirs = fs.readdirSync(CLAUDE_DIR); } catch { return []; }
  const now = Date.now(), seen = new Set(), out = [];
  for (const dname of dirs) {
    if (dname.includes('private-tmp') || dname.includes('scratchpad')) continue; // throwaway worker sessions
    const dir = path.join(CLAUDE_DIR, dname);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      if (now - st.mtimeMs > 45 * 60e3) continue;
      let c; try { c = classify(fp, st.mtimeMs); } catch { continue; }
      if (!c) continue;
      const id = f.slice(0, -6);
      seen.add(id);
      const prev = sessions.get(id);
      const name = c.cwd ? path.basename(c.cwd) : dname.split('-').pop();
      if (prev && prev.phase !== c.phase) transition(name, prev, c.phase, now);
      const s = { id, file: fp, name, cwd: c.cwd, phase: c.phase, since: prev && prev.phase === c.phase ? prev.since : now, mtime: st.mtimeMs };
      sessions.set(id, s);
      if (c.phase !== 'parked') out.push(s);
    }
  }
  for (const id of [...sessions.keys()]) if (!seen.has(id)) sessions.delete(id);
  return out.sort((a, b) => b.mtime - a.mtime);
}

function transition(name, prev, phase, now) {
  if (phase === 'waiting' && (prev.phase === 'working' || prev.phase === 'stalled')) {
    emit('agentDone', `${name} finished — your move!`, { notify: true, agent: name });
  } else if (phase === 'stalled' && prev.phase === 'working') {
    emit('agentStalled', `${name} has gone quiet on a tool call. Needs your approval?`, { notify: true, agent: name });
  } else if (phase === 'working' && prev.phase === 'waiting') {
    const secs = (now - prev.since) / 1000;
    if (secs < 60) {
      state.quickDraws++; state.mood = clamp(state.mood + 3); gainXP(4);
      emit('quick', `Quick draw! Replied to ${name} in ${Math.round(secs)}s. +4xp`);
    }
  }
}

// ---------- git ----------
const git = (cwd, args) => new Promise(res =>
  execFile('git', args, { cwd, timeout: 5000, maxBuffer: 8e6 }, (e, out) => res(e ? null : out.trimEnd())));

const heads = new Map();      // root -> sha
const diffLevel = new Map();  // root -> 0/1/2 (calm / nervous / panic)
const rootCache = new Map();  // dir -> root|null
let gitInfo = null;

async function rootOf(dir) {
  if (!dir) return null;
  if (!rootCache.has(dir)) rootCache.set(dir, await git(dir, ['rev-parse', '--show-toplevel']));
  return rootCache.get(dir);
}

async function scanGit(agents) {
  const roots = new Set();
  for (const a of agents) { const r = await rootOf(a.cwd); if (r) roots.add(r); }
  const focusDir = state.repo || agents[0]?.cwd || gitInfo?.root;
  const focus = await rootOf(focusDir);
  if (focus) roots.add(focus);

  // commit detection across every repo an agent is touching
  for (const root of roots) {
    const last = await git(root, ['log', '-1', '--format=%H%x09%ct%x09%s']);
    if (!last) continue;
    const [sha, ct, ...subj] = last.split('\t');
    const prev = heads.get(root);
    heads.set(root, sha);
    if (prev && prev !== sha && +ct * 1000 > Date.now() - 10 * 60e3) {
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

  const lvl = lines > 1200 ? 2 : lines > 400 ? 1 : 0;
  const was = diffLevel.get(focus);
  diffLevel.set(focus, lvl);
  if (was !== undefined && lvl > was) {
    emit(lvl === 2 ? 'panic' : 'nervous', lvl === 2
      ? `${lines} uncommitted lines in ${gitInfo.name}. One bad agent turn and it's gone. COMMIT.`
      : `${lines} lines uncommitted in ${gitInfo.name}… save point?`, { notify: lvl === 2 });
  }
}

function onCommit(repo, subject, lines) {
  const xp = 10 + Math.min(40, Math.round(lines / 25));
  state.commits++;
  state.fuel = clamp(state.fuel + 30);
  state.mood = clamp(state.mood + 8);
  const today = dayKey();
  if (!state.commitDays.includes(today)) state.commitDays = [...state.commitDays, today].slice(-400);
  emit('commit', `nom! "${subject.slice(0, 60)}" +${xp}xp`, { repo });
  gainXP(xp);
}

// ---------- tick ----------
let busy = false, agents = [], lastNight = 0;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    decay();
    agents = scanAgents();
    await scanGit(agents);
    const h = new Date().getHours();
    if (h >= 1 && h < 5 && agents.length && Date.now() - lastNight > 60 * 60e3) {
      lastNight = Date.now();
      emit('night', `it's ${h}am. the bugs get braver at night. one more commit, then sleep?`);
    }
    if (win && !win.isDestroyed()) win.webContents.send('tick', snapshot());
    save();
  } catch (e) { console.error(e); }
  finally { busy = false; }
}

function snapshot() {
  const level = levelFor(state.xp);
  return {
    name: state.name, level, xp: state.xp, xpLo: xpForLevel(level), xpHi: xpForLevel(level + 1),
    fuel: state.fuel, mood: state.mood, commits: state.commits, quickDraws: state.quickDraws, streak: streak(),
    agents: agents.map(a => ({ name: a.name, phase: a.phase, since: a.since })),
    git: gitInfo, muted: state.muted, hasKey: !!getKey(), hour: new Date().getHours(),
    watching: state.repo ? 'manual' : 'auto',
  };
}

// ---------- chat ----------
function getKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (state.keyEnc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(state.keyEnc, 'base64')); } catch { return null; }
  }
  return state.keyPlain;
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
    `Pet stats: level ${levelFor(state.xp)}, fuel ${Math.round(state.fuel)}/100, mood ${Math.round(state.mood)}/100, commit streak ${streak()} days, total commits witnessed ${state.commits}.`,
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
  return parts.join('\n\n');
}

const SYSTEM = name => `You are ${name}, a tiny pixel creature who lives on the desktop of a "vibe coder" — someone who builds software mostly by directing AI coding agents like Claude Code. You watch their agents and their git repo. You eat commits (that's literally how you're fed).

Voice: warm, playful, a little cheeky, never cutesy-to-the-point-of-useless. Be genuinely useful: you can actually see their repo state and agent status below. Default to 1-3 short sentences unless asked for more or writing a commit message. No headers. Occasional pet flavor is fine (*wiggles*), but at most one per reply.

Things you care about: committing often (save points protect against a bad agent turn), reading diffs before shipping, answering the agent when it's waiting, not coding at 4am, and shipping.`;

ipcMain.handle('chat', async (_, { messages, mode }) => {
  const key = getKey();
  if (!key) return { error: 'nokey' };
  const ctx = await buildContext(mode);
  try {
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
  if (safeStorage.isEncryptionAvailable()) { state.keyEnc = key ? safeStorage.encryptString(key).toString('base64') : null; state.keyPlain = null; }
  else state.keyPlain = key || null;
  save();
  return !!getKey();
});

// ---------- window + interaction ----------
function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  let pos = state.pos;
  const onScreen = pos && screen.getAllDisplays().some(d => {
    const b = d.workArea; return pos.x > b.x - W / 2 && pos.x < b.x + b.width - W / 2 && pos.y > b.y - H / 2 && pos.y < b.y + b.height - 100;
  });
  if (!onScreen) pos = { x: workArea.x + workArea.width - W - 24, y: workArea.y + workArea.height - H };
  win = new BrowserWindow({
    width: W, height: H, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false,
    hasShadow: false, alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => tick());

  // eyes follow the cursor anywhere on screen
  setInterval(() => {
    if (win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), [x, y] = win.getPosition();
    win.webContents.send('cursor', { x: p.x - x, y: p.y - y });
  }, 60);
}

let drag = null;
ipcMain.on('set-ignore', (_, v) => win.setIgnoreMouseEvents(v, { forward: true }));
ipcMain.on('drag-start', () => {
  const c = screen.getCursorScreenPoint(), [x, y] = win.getPosition();
  clearInterval(drag?.timer);
  drag = { cx: c.x, cy: c.y, x, y, timer: setInterval(() => {
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
ipcMain.on('rename', (_, name) => { name = (name || '').trim().slice(0, 16); if (name) { state.name = name; save(); tick(); } });
ipcMain.on('pet', () => {
  if (Date.now() - state.lastPet > 10000) { state.lastPet = Date.now(); state.mood = clamp(state.mood + 2); save(); }
});

ipcMain.on('menu', () => {
  const g = gitInfo;
  Menu.buildFromTemplate([
    { label: `${state.name} · Lv ${levelFor(state.xp)} · ${state.xp}xp`, enabled: false },
    { label: g?.root ? `Watching ${g.name}${state.repo ? '' : ' (following your agent)'}` : 'No repo yet — start an agent or pick one', enabled: false },
    { type: 'separator' },
    { label: 'Chat…', click: () => emit('openChat') },
    { label: 'Watch a repo…', click: async () => {
      const r = await dialog.showOpenDialog({ properties: ['openDirectory'], defaultPath: g?.root || os.homedir() });
      if (!r.canceled && r.filePaths[0]) { state.repo = r.filePaths[0]; save(); tick(); }
    } },
    { label: 'Follow my active agent (auto)', type: 'checkbox', checked: !state.repo, click: () => { state.repo = null; save(); tick(); } },
    { type: 'separator' },
    { label: 'Toss a snack', click: () => {
      if (Date.now() - state.lastSnack < 30 * 60e3) return emit('snackNo', 'snacks are nice but I run on commits. (one snack per 30 min)');
      state.lastSnack = Date.now(); state.fuel = clamp(state.fuel + 10); save(); emit('snack', 'crunch. thanks! (commits are the real meal though)');
    } },
    { label: 'Open at login', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: m => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { label: 'Mute notifications', type: 'checkbox', checked: state.muted, click: m => { state.muted = m.checked; save(); tick(); } },
    { label: 'Model', submenu: ['claude-sonnet-5', 'claude-opus-5-5', 'claude-haiku-4-5-20251001'].map(m => ({
      label: m, type: 'radio', checked: state.model === m, click: () => { state.model = m; save(); } })) },
    { label: getKey() ? 'Change API key…' : 'Set Anthropic API key…', click: () => emit('openKey') },
    { label: 'Rename…', click: () => emit('openRename') },
    { type: 'separator' },
    { label: `Quit ${state.name}`, click: () => app.quit() },
  ]).popup({ window: win });
});

app.whenReady().then(() => {
  load();
  if (process.platform === 'darwin') app.dock?.hide();
  createWindow();
  setInterval(tick, TICK_MS);
});
app.on('window-all-closed', () => app.quit());
