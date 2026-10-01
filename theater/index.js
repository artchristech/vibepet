// theater/index.js — main-process side: read a session (+ subagents + git), list recent sessions, open the player window.
const fs = require('fs'), path = require('path');
const { execFile } = require('child_process');
const { build, parseGit } = require('./model');
const { humanAt, textOf } = require('../agents');
const { projectsDir } = require('../overrides');

const readLines = f => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return []; } };

function subagentsOf(file) {
  const dir = path.join(file.replace(/\.jsonl$/, ''), 'subagents');
  let names = []; try { names = fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')); } catch { return []; }
  return names.map(n => { let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, n.replace(/\.jsonl$/, '.meta.json')), 'utf8')); } catch {}
    return { meta, lines: readLines(path.join(dir, n)) }; });
}

const gitLog = (cwd, t0, t1) => new Promise(res => {
  if (!cwd || !fs.existsSync(cwd)) return res([]);
  execFile('git', ['-C', cwd, 'log', '--all', `--since=${Math.floor(t0 / 1000) - 60}`, `--until=${Math.ceil(t1 / 1000) + 300}`, '--format=%H%x09%at%x09%s'],
    { timeout: 4000 }, (e, out) => res(e ? [] : parseGit(out)));
});

async function timeline(file) {
  if (!file || !file.endsWith('.jsonl') || !path.resolve(file).startsWith(projectsDir() + path.sep)) throw new Error('not a session file');
  const lines = readLines(file), subagents = subagentsOf(file);
  const first = build(lines, { subagents });
  const commits = await gitLog(first.meta.cwd, first.meta.t0, first.meta.t1);
  const tl = commits.length ? build(lines, { subagents, commits }) : first;
  tl.meta.file = path.basename(file, '.jsonl');
  return tl;
}

// sessions touched in the last `hours`, newest first, titled by their first real prompt
function recent(dir, hours = 12, max = 15) {
  const since = Date.now() - hours * 3600e3, out = [];
  let projs = []; try { projs = fs.readdirSync(dir); } catch { return out; }
  for (const p of projs) {
    let names = []; try { names = fs.readdirSync(path.join(dir, p)).filter(n => n.endsWith('.jsonl')); } catch { continue; }
    for (const n of names) { const f = path.join(dir, p, n); try { const st = fs.statSync(f); if (st.mtimeMs >= since && st.size > 2000) out.push({ file: f, mtime: st.mtimeMs, size: st.size }); } catch {} }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, max).map(s => {
    let title = '', cwd = '';
    for (const l of readLines(s.file).slice(0, 400)) {
      let d; try { d = JSON.parse(l); } catch { continue; }
      if (d.type === 'ai-title' && d.aiTitle) title = d.aiTitle;
      cwd ||= d.cwd || '';
      if (!title && humanAt(d)) title = textOf(d.message?.content).trim().replace(/\s+/g, ' ');
      if (title && cwd) break;
    }
    return { ...s, title: (title || path.basename(s.file, '.jsonl')).slice(0, 50), project: path.basename(cwd || '') };
  });
}

// TODO(theater): "Export cinematic" — render the timeline as a HyperFrames composition via content/compose.js ensureCLI/renderHF (9:16 + 16:9).
// one player window per session file; reopening focuses it
const wins = new Map();
function open(BrowserWindow, file) {
  const w0 = wins.get(file);
  if (w0 && !w0.isDestroyed()) { w0.show(); w0.focus(); return w0; }
  const w = new BrowserWindow({ width: 1280, height: 800, minWidth: 820, minHeight: 520, title: 'Theater', backgroundColor: '#07080c', titleBarStyle: 'hiddenInset',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  w.loadFile(path.join(__dirname, 'player.html'));
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  wins.set(file, w); w.on('closed', () => wins.delete(file));
  return w;
}

// the player never names a file: main answers with the timeline of the window that asked
const fileFor = sender => { for (const [f, w] of wins) if (!w.isDestroyed() && w.webContents === sender) return f; return null; };

module.exports = { timeline, recent, open, fileFor };
