// content — "Net makes content": toggle a recording, work in Claude Code, toggle off → a 9:16 short.
// Session folder (~/Movies/Vibepet/<YYYY-MM-DD_HHmm>/) holds every stage's output, so any stage can re-run alone:
//   raw.webm (5s chunks) · session.json · prompts.jsonl (redacted) · cursor.json · edl.json · cards/ · short.mp4 · cover.jpg · caption.txt
const { BrowserWindow, ipcMain, desktopCapturer, screen, systemPreferences, shell, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { humanAt, textOf } = require('../agents');
const { redact, tapLine, directFallback, caption } = require('./edl');
const { render, findBin, remux, probeDuration } = require('./render');
const signals = require('./signals');
const { plan } = require('./camera');
const compose = require('./compose');

const ROOT = path.join(os.homedir(), 'Movies', 'Vibepet');
const CLAUDE_DIR = require('../overrides').projectsDir();
const MAX_MS = 2 * 3600e3, MIN_FREE = 2 * 1024 ** 3;

let ctx;              // { emit, getState, save, refresh, petPng }
let recWin = null;    // hidden recorder window
let cur = null;       // live session: { dir, json, offsets, prompts, results, cursor, timer, fd }
let busy = false;     // rendering
const cardWaits = new Map();

const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2));
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const say = (text, extra) => ctx.emit('content', text, extra);

function recorder() {
  if (recWin && !recWin.isDestroyed()) return recWin;
  recWin = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  recWin.loadFile(path.join(__dirname, 'recorder.html'));
  return recWin;
}
const ready = w => w.webContents.isLoading() ? new Promise(r => w.webContents.once('did-finish-load', r)) : Promise.resolve();

// ---------- permission ----------
function screenAccess() { return process.platform !== 'darwin' ? 'granted' : systemPreferences.getMediaAccessStatus('screen'); }
function openScreenSettings() { shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); }

// ---------- prompt tap: only bytes appended after the session started ----------
function listJsonl() {
  const out = [];
  let dirs; try { dirs = fs.readdirSync(CLAUDE_DIR); } catch { return out; }
  for (const d of dirs) {
    if (d.includes('private-tmp') || d.includes('scratchpad')) continue;
    let fl; try { fl = fs.readdirSync(path.join(CLAUDE_DIR, d)); } catch { continue; }
    for (const f of fl) if (f.endsWith('.jsonl')) out.push(path.join(CLAUDE_DIR, d, f));
  }
  return out;
}
function tapInit() {
  const offsets = new Map();
  for (const f of listJsonl()) { try { offsets.set(f, fs.statSync(f).size); } catch {} }
  return offsets;
}
function tapPoll() {
  const s = cur; if (!s) return;
  for (const f of listJsonl()) {
    let size; try { size = fs.statSync(f).size; } catch { continue; }
    const off = s.offsets.has(f) ? s.offsets.get(f) : 0;   // a file born mid-session is read from its start
    if (size <= off) { s.offsets.set(f, size); continue; }
    const len = Math.min(size - off, 32 * 1048576), buf = Buffer.alloc(len);
    const fd = fs.openSync(f, 'r'); try { fs.readSync(fd, buf, 0, len, off); } finally { fs.closeSync(fd); }
    const text = buf.toString('utf8'), cut = text.lastIndexOf('\n');
    if (cut < 0) continue;                               // no complete line yet
    s.offsets.set(f, off + Buffer.byteLength(text.slice(0, cut + 1)));
    for (const line of text.slice(0, cut).split('\n')) {
      const ev = tapLine(line, humanAt, textOf);
      if (!ev || ev.at < s.json.startAt - 2000) continue;
      const t = Math.round((ev.at - s.json.startAt) / 10) / 100;
      if (ev.kind === 'result') { s.results.push({ t }); continue; }
      const r = redact(ev.text);
      s.redactions += r.n;
      const row = { t_ms_from_start: Math.round(t * 1000), text: r.text, project: ev.cwd ? path.basename(ev.cwd) : null, redacted: r.n };
      s.prompts.push({ t, ...row });
      fs.appendFileSync(path.join(s.dir, 'prompts.jsonl'), JSON.stringify(row) + '\n');
    }
  }
}

// ---------- session lifecycle ----------
async function start() {
  if (cur || busy) return;
  const access = screenAccess();
  if (access === 'denied' || access === 'restricted') {
    say('I need Screen Recording permission to film your session. Opening System Settings: turn vibepet on, then restart me.', { alert: true });
    openScreenSettings();
    return;
  }
  const disp = ctx.display();   // the display Net is on
  let sources;
  try { sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }); }
  catch (e) { say(`couldn't list screens: ${e.message}`, { alert: true }); return; }
  if (screenAccess() !== 'granted') { say('Allow Screen Recording for vibepet in System Settings, then start again.', { alert: true }); openScreenSettings(); return; }
  const src = sources.find(s => String(s.display_id) === String(disp.id)) || sources[0];
  if (!src) { say('no screen to record', { alert: true }); return; }
  fs.mkdirSync(ROOT, { recursive: true });
  let free = Infinity; try { const st = fs.statfsSync(ROOT); free = st.bavail * st.bsize; } catch {}
  if (free < MIN_FREE) { say('less than 2 GB free: not recording', { alert: true }); return; }
  const dir = path.join(ROOT, stamp(new Date()));
  fs.mkdirSync(dir, { recursive: true });
  const json = { state: 'starting', display: { id: disp.id, bounds: disp.bounds, scale: disp.scaleFactor }, fps: 30 };
  writeJson(path.join(dir, 'session.json'), json);
  signals.warm();
  cur = { dir, json, offsets: tapInit(), prompts: [], results: [], cursor: [], windows: [], redactions: 0, fd: fs.openSync(path.join(dir, 'raw.webm'), 'a') };
  const w = recorder(); await ready(w);
  w.webContents.send('start', { sourceId: src.id, width: Math.round(disp.bounds.width * disp.scaleFactor), height: Math.round(disp.bounds.height * disp.scaleFactor), fps: 30 });
}

ipcMain.on('rec-started', (_, info) => {
  if (!cur) return;
  Object.assign(cur.json, { state: 'recording', startAt: info.at, width: info.width, height: info.height, fps: Math.round(info.fps || 30), mime: info.mime });
  writeJson(path.join(cur.dir, 'session.json'), cur.json);
  const b = cur.json.display.bounds;
  cur.timer = setInterval(() => {
    tapPoll();
    const p = screen.getCursorScreenPoint();   // where the action is: no Accessibility needed
    const s = cur, t = Math.round((Date.now() - s.json.startAt) / 100) / 10;
    signals.frontWindow().then(w => { if (w && s === cur) s.windows.push({ t, ...w }); });   // what's in front, for the camera
    if (p.x >= b.x && p.x < b.x + b.width) cur.cursor.push({ t: Math.round((Date.now() - cur.json.startAt) / 100) / 10, x: Math.round((p.x - b.x) / b.width * 1000) / 1000 });
    if (Date.now() - cur.json.startAt > MAX_MS) { say('2 hour cap reached: wrapping up'); stop(); }
  }, 2000);
  ctx.refresh();
  say('recording. click me or pick "Stop & make short" when you\'re done');
});
ipcMain.on('rec-chunk', (_, { buf }) => {
  if (!cur?.fd) return;
  try { fs.writeSync(cur.fd, Buffer.from(buf)); } catch (e) { say(`recording write failed: ${e.message}`, { alert: true }); stop(); return; }
  try { const st = fs.statfsSync(cur.dir); if (st.bavail * st.bsize < MIN_FREE / 2) { say('disk almost full: stopping'); stop(); } } catch {}
});
ipcMain.on('rec-failed', (_, msg) => {
  say(`couldn't start recording: ${msg}`, { alert: true });
  if (cur) { clearInterval(cur.timer); try { fs.closeSync(cur.fd); } catch {} fs.rmSync(cur.dir, { recursive: true, force: true }); cur = null; ctx.refresh(); }
});

let stopWait = null;
function stop() {
  if (!cur || stopWait) return;
  stopWait = new Promise(res => ipcMain.once('rec-stopped', res));
  recWin?.webContents.send('stop');
  const s = cur;
  stopWait.then(() => {
    clearInterval(s.timer); tapPoll();
    try { fs.closeSync(s.fd); } catch {}
    s.json.state = 'recorded'; s.json.stopAt = Date.now(); s.json.redactions = s.redactions;
    writeJson(path.join(s.dir, 'session.json'), s.json);
    writeJson(path.join(s.dir, 'cursor.json'), s.cursor);
    writeJson(path.join(s.dir, 'windows.json'), s.windows);
    writeJson(path.join(s.dir, 'results.json'), s.results);
    cur = null; stopWait = null; ctx.refresh();
    make(s.dir);
  });
}

// ---------- make: direct → cards → render. Re-runnable on any recorded session folder ----------
async function cards(kind, text, extra = {}) {
  const w = recorder(); await ready(w);
  const id = Math.random().toString(36).slice(2);
  const p = new Promise(res => { cardWaits.set(id, res); setTimeout(() => { cardWaits.delete(id); res(null); }, 20000); });
  w.webContents.send('cards', { id, kind, text, ...extra });
  return p;
}
ipcMain.on('rec-cards', (_, { id, frames }) => { const r = cardWaits.get(id); if (r) { cardWaits.delete(id); r(frames); } });

async function make(dir) {
  if (busy) return;
  busy = true; ctx.refresh();
  const json = readJson(path.join(dir, 'session.json')) || {};
  try {
    if (!findBin('ffmpeg')) {
      say('I need ffmpeg to cut the short. Install it with: brew install ffmpeg. Your recording is kept; pick "Finish last session" after.', { alert: true });
      return;
    }
    say('Selecting moments…');
    const src = await remux(findBin('ffmpeg'), dir);
    const duration = await probeDuration(findBin('ffprobe'), src);
    const prompts = fs.existsSync(path.join(dir, 'prompts.jsonl'))
      ? fs.readFileSync(path.join(dir, 'prompts.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).map(r => ({ ...r, t: r.t_ms_from_start / 1000 })) : [];
    const results = readJson(path.join(dir, 'results.json')) || [];
    const cursor = readJson(path.join(dir, 'cursor.json')) || [];
    const project = prompts.map(p => p.project).filter(Boolean).pop() || null;
    const edl = directFallback({ prompts, results, duration, target: ctx.getState().contentTarget || 45, title: project ? `Building ${project}` : 'Built with Claude Code', cursor });
    writeJson(path.join(dir, 'edl.json'), edl);
    if (!edl.clips.length) { say('that recording was too short to cut anything from', { alert: true }); return; }

    let out;
    try { out = await smartRender({ dir, edl, json, project }); }
    catch (e) {
      console.error('content: smart render failed, falling back:', e);
      say(`smart camera failed (${e.message.slice(0, 80)}): making a simple cut instead`);
      out = await simpleRender({ dir, edl, project });
    }
    const minutes = Math.max(1, Math.round(duration / 60));
    fs.writeFileSync(path.join(dir, 'caption.txt'), caption({ project, prompts: prompts.length, minutes }) + '\n');
    json.state = 'done'; json.short = out.short; writeJson(path.join(dir, 'session.json'), json);
    const red = json.redactions || prompts.reduce((n, p) => n + (p.redacted || 0), 0);
    ctx.emit('contentDone', `Your short is ready (${Math.round(out.duration)}s)${red ? ` · ${red} secret${red === 1 ? '' : 's'} redacted` : ''}`, { dir });
    if (ctx.getState().deleteRaw) { fs.rmSync(path.join(dir, 'raw.webm'), { force: true }); fs.rmSync(path.join(dir, 'src.mkv'), { force: true }); }
    readyDialog(dir, out.duration, red);
  } catch (e) {
    console.error('content:', e);
    say(`couldn't make the short: ${e.message.slice(0, 140)}. The recording is kept.`, { alert: true });
  } finally { busy = false; ctx.refresh(); }
}

// v1b: OCR finds the message bar, the camera zooms to it, pulls out to the window, shows the output full frame; HyperFrames renders
async function smartRender({ dir, edl, json, project }) {
  const ffmpeg = findBin('ffmpeg');
  say('Finding your prompts on screen…');
  const ocr = await signals.ocrFrames({ dir, edl, ffmpeg });
  const windows = readJson(path.join(dir, 'windows.json')) || [];
  const srcW = json.width, srcH = json.height;
  if (!srcW || !srcH) throw new Error('no recording size');
  const cam = plan({ clips: edl.clips, windows, ocr, disp: { bounds: json.display.bounds, scale: srcW / json.display.bounds.width }, srcW, srcH });
  writeJson(path.join(dir, 'camera.json'), cam);
  const { hf } = await compose.build({ dir, edl, cam, srcW, srcH, ffmpeg, title: edl.hook_text, sub: edl.title, project, petPng: ctx.petPng, onStep: t => say(`${t}…`) });
  const raw = path.join(dir, 'work-hf.mp4');
  await compose.renderHF({ hf, out: raw, onStep: t => say(`${t}…`) });
  return finish({ dir, video: raw });
}
// silent AAC (music is v1c), faststart, cover
async function finish({ dir, video }) {
  const ffmpeg = findBin('ffmpeg'), short = path.join(dir, 'short.mp4');
  await compose.run(ffmpeg, ['-y', '-v', 'error', '-i', video, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', short]);
  await compose.run(ffmpeg, ['-y', '-v', 'error', '-ss', '1', '-i', short, '-frames:v', '1', '-q:v', '3', path.join(dir, 'cover.jpg')]);
  fs.rmSync(video, { force: true });
  return { short, duration: await probeDuration(findBin('ffprobe'), short) };
}
// v1a path: cursor-follow crop + typewriter cards via plain ffmpeg. Used when the smart path can't run
async function simpleRender({ dir, edl, project }) {
  say('Drawing the overlays…');
  const cardDir = path.join(dir, 'cards'); fs.rmSync(cardDir, { recursive: true, force: true }); fs.mkdirSync(cardDir, { recursive: true });
  const cardPaths = [];
  for (const [i, c] of edl.clips.entries()) {
    if (!c.overlay_prompt) { cardPaths.push(null); continue; }
    const frames = await cards('prompt', c.overlay_prompt, { project });
    if (!frames) { cardPaths.push(null); continue; }
    const d = path.join(cardDir, `c${String(i).padStart(2, '0')}`); fs.mkdirSync(d);
    frames.forEach((f, k) => fs.writeFileSync(path.join(d, `${String(k).padStart(3, '0')}.png`), Buffer.from(f)));
    cardPaths.push(d);
  }
  const tf = await cards('title', edl.hook_text, { sub: edl.title });
  const title = tf ? path.join(cardDir, 'title.png') : null;
  if (tf) fs.writeFileSync(title, Buffer.from(tf[0]));
  return render({ dir, edl, cards: cardPaths, title, pet: ctx.petPng, onStep: t => say(`${t}…`) });
}

async function readyDialog(dir, dur, red) {
  const { response } = await dialog.showMessageBox({ message: 'Your short is ready', detail: `${Math.round(dur)}s · 1080×1920${red ? ` · ${red} secret${red === 1 ? '' : 's'} redacted` : ''}\n${dir}`,
    buttons: ['Preview', 'Show in Finder', 'Discard', 'Close'], defaultId: 0, cancelId: 3 });
  const short = path.join(dir, 'short.mp4');
  if (response === 0) shell.openPath(short);
  else if (response === 1) shell.showItemInFolder(short);
  else if (response === 2) {
    const c = await dialog.showMessageBox({ message: 'Discard this short and its recording?', buttons: ['Discard', 'Cancel'], defaultId: 1, cancelId: 1 });
    if (c.response === 0) shell.trashItem(dir).catch(() => {});
  }
}

// the newest session folder left unfinished (quit mid-record, render failed, ffmpeg missing)
function unfinished() {
  let dirs; try { dirs = fs.readdirSync(ROOT).sort().reverse(); } catch { return null; }
  for (const d of dirs.slice(0, 10)) {
    const dir = path.join(ROOT, d), j = readJson(path.join(dir, 'session.json'));
    if (!j || j.state === 'done' || (cur && cur.dir === dir)) continue;
    let size = 0; try { size = fs.statSync(path.join(dir, 'raw.webm')).size; } catch {}
    if (size > 0 && j.startAt) return dir;
  }
  return null;
}
function finishLast() {
  const dir = unfinished();
  if (!dir || busy || cur) return;
  const j = readJson(path.join(dir, 'session.json'));
  if (j.state !== 'recorded') { j.state = 'recorded'; writeJson(path.join(dir, 'session.json'), j); }
  make(dir);
}

function init(c) {
  ctx = c;
  const u = unfinished();
  if (u) setTimeout(() => say(`a recording from ${path.basename(u)} never became a short. "Finish last session" is in my menu.`), 4000);
}

const status = () => ({ recording: !!cur && cur.json.state === 'recording', starting: !!cur && cur.json.state !== 'recording', busy });
const toggle = () => cur ? stop() : start();
const openFolder = () => { fs.mkdirSync(ROOT, { recursive: true }); shell.openPath(ROOT); };
// quitting mid-record: close the file cleanly; the chunks on disk are the footage
app.on('before-quit', () => { if (cur) { try { fs.closeSync(cur.fd); } catch {} cur.json.state = 'recorded'; try { writeJson(path.join(cur.dir, 'session.json'), cur.json); writeJson(path.join(cur.dir, 'cursor.json'), cur.cursor); writeJson(path.join(cur.dir, 'windows.json'), cur.windows); writeJson(path.join(cur.dir, 'results.json'), cur.results); } catch {} } });

module.exports = { init, toggle, start, stop, make, status, openFolder, finishLast, unfinished, ROOT };
