// ports — what's listening on localhost, and what's running in the background (Claude Code bg tasks + long dev processes).
// Read-only: lsof/ps/launchctl list + one GET per new port. Polled by main.js no faster than every 10s; never blocks the tick.
// Detection ported from ~/projects/gauge (lsof -F parsing, cwd lookup, launchd-aware stop).
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { execFile } = require('child_process');
const { readTail } = require('./agents');
const overrides = require('./overrides');

const HOME = os.homedir();
const PROJECTS = overrides.projectsDir(), ISOLATED = overrides.isolated();   // ~/.claude/projects unless VIBEPET_CLAUDE_DIR
const TMP = `/private/tmp/claude-${process.getuid?.() ?? 501}`;
const DAY = 864e5;
// lsof exits 1 when any path is missing but still prints the rest, so keep stdout on error
const sh = (cmd, args, timeout = 4000) => new Promise(res =>
  execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (e, out) => res(out || '')));

// lsof -Fpcn → [{pid, cmd, host, port}]; one row per pid:port (v4+v6 dupes folded)
function parseListen(out) {
  const rows = [], seen = new Set();
  let pid = 0, cmd = '';
  for (const l of out.split('\n')) {
    const t = l[0], v = l.slice(1);
    if (t === 'p') pid = +v; else if (t === 'c') cmd = v;
    else if (t === 'n' && pid) {
      const m = v.match(/^(.*):(\d+)$/); if (!m) continue;
      const k = pid + ':' + m[2]; if (seen.has(k)) continue; seen.add(k);
      rows.push({ pid, cmd, host: m[1].replace(/^\[|\]$/g, ''), port: +m[2] });
    }
  }
  return rows.sort((a, b) => a.port - b.port);
}
// lsof -Fn (cwd or open files) → Map pid → [names]
function parsePidFiles(out) {
  const m = new Map(); let pid = 0;
  for (const l of out.split('\n')) {
    if (l[0] === 'p') pid = +l.slice(1);
    else if (l[0] === 'n' && pid) (m.get(pid) || m.set(pid, []).get(pid)).push(l.slice(1));
  }
  return m;
}
// ps etime "[[dd-]hh:]mm:ss" → ms
function etimeMs(s) {
  const [d, rest] = s.includes('-') ? s.split('-') : [0, s];
  const p = rest.split(':').map(Number); while (p.length < 3) p.unshift(0);
  return (((+d * 24 + p[0]) * 60 + p[1]) * 60 + p[2]) * 1000;
}
// ps -axo pid=,etime=,command= → [{pid, age, args}]
function parsePs(out) {
  return out.split('\n').map(l => l.trim().match(/^(\d+)\s+(\S+)\s+(.+)$/)).filter(Boolean)
    .map(m => ({ pid: +m[1], age: etimeMs(m[2]), args: m[3] }));
}
const titleOf = html => (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 60);

// project name for a dir: nearest package.json "name", else the folder
const nameCache = new Map();
function projectName(dir) {
  if (!dir) return null;
  if (nameCache.has(dir)) return nameCache.get(dir);
  let n = null;
  for (let d = dir; d.startsWith(HOME) && d !== HOME && !n; d = path.dirname(d)) {
    try { n = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name || null; } catch {}
  }
  n ||= dir === '/' ? null : path.basename(dir);
  nameCache.set(dir, n);
  return n;
}
// friendly server kind from the command line
const KINDS = [[/vite/, 'vite'], [/next(-server| dev)/, 'next'], [/webpack/, 'webpack'], [/astro/, 'astro'], [/remix/, 'remix'],
  [/http\.server/, 'http.server'], [/uvicorn/, 'uvicorn'], [/gunicorn/, 'gunicorn'], [/flask/, 'flask'], [/django|manage\.py/, 'django'],
  [/jupyter/, 'jupyter'], [/ollama/, 'ollama'], [/electron/i, 'electron'], [/ffmpeg/, 'ffmpeg'], [/wrangler/, 'wrangler']];
const kindOf = (args, cmd) => KINDS.find(([re]) => re.test(args))?.[1] || cmd;
// long-running dev processes worth showing even when they don't listen
const DEV_RE = /(^|\/)(node|bun|deno|python3?(\.\d+)?|ruby|ffmpeg|cargo|go|electron|Electron)( |$)|vite|next dev|webpack|nodemon|tsc --watch|uvicorn|jupyter|wrangler/;
const SKIP_RE = /^\/(System|Applications|Library|usr\/(libexec|sbin))\/|\.app\/Contents\/|\/\.vscode|\/\.cursor|claude(\/| |$)|mcp|language-?server|tsserver|typingsInstaller|eslintServer|copilot/i;

function probe(port, timeout = 800) {
  return new Promise(res => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout, headers: { accept: 'text/html' } }, r => {
      let s = ''; r.setEncoding('utf8');
      r.on('data', d => { s += d; if (s.length > 32768 || /<\/title>/i.test(s)) r.destroy(); });
      r.on('close', () => res({ http: true, status: r.statusCode, title: titleOf(s) }));
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => res({ http: false }));
  });
}

// ---------- Claude Code background tasks ----------
// <TMP>/<project-dir>/<session>/tasks/<id>.output — b…/r… = shell tasks, a<hex> = subagents
const projOfDir = d => d.includes('-projects-') ? d.split('-projects-').pop() : d.split('-').filter(Boolean).pop();
// the session jsonl says what the task is and how it ended
function taskInfo(text, id) {
  const esc = id.replace(/\W/g, '');
  const n = text.match(new RegExp(`<task-id>${esc}</task-id>[\\s\\S]*?<status>(\\w+)</status>(?:[\\s\\S]*?<summary>([^<]*))?`));
  let desc = text.match(new RegExp(`"agentId":"${esc}","description":"((?:[^"\\\\]|\\\\.)*)"`))?.[1] || null;   // async Agent launch
  const tu = desc ? null :text.match(new RegExp(`"tool_use_id":"(toolu_\\w+)"[^\\n]*?\\(ID: ${esc}\\)`)) || text.match(new RegExp(`<task-id>${esc}</task-id>\\\\n<tool-use-id>(toolu_\\w+)`));
  if (tu) { const line = text.match(new RegExp(`"id":"${tu[1]}"[^\\n]*`))?.[0] || '';   // the tool_use: description, else the command/prompt
    desc = line.match(/"description":"((?:[^"\\]|\\.)*)"/)?.[1] || line.match(/"(?:command|prompt)":"((?:[^"\\]|\\.){1,60})/)?.[1] || null; }
  const unq = x => x && x.replace(/\\n/g, ' ').replace(/\\"/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  const sum = unq(n?.[2]);
  return { status: n?.[1] || null, desc: unq(desc)?.slice(0, 80) || null, summary: sum ? sum.replace(/^Background command "?/, '').replace(/^(?:Agent|Monitor) "(.*)" \w+( \w+)?$/, '$1').slice(0, 80) : null };
}

const infoCache = new Map();   // id → taskInfo; finished ones are final, unresolved retried once a minute
async function listTasks(now = Date.now()) {
  const files = [];
  const watched = pd => !ISOLATED || fs.existsSync(path.join(PROJECTS, pd));   // an isolated root sees its own sessions' tasks, not the machine's
  for (const pd of safeDir(TMP).filter(watched)) for (const sd of safeDir(path.join(TMP, pd))) {
    const td = path.join(TMP, pd, sd, 'tasks');
    for (const f of safeDir(td)) {
      if (!f.endsWith('.output')) continue;
      const p = path.join(td, f); let st; try { st = fs.statSync(p); } catch { continue; }
      if (now - st.mtimeMs < DAY) files.push({ p, pd, sd, id: f.slice(0, -7), mtime: st.mtimeMs, born: st.birthtimeMs || st.ctimeMs });
    }
  }
  files.sort((a, b) => b.mtime - a.mtime); files.length = Math.min(files.length, 40);
  const open = new Set();   // a shell task's process holds its .output open (subagent .output is a symlink: lsof reports the target)
  if (files.length) for (const names of parsePidFiles(await sh('/usr/sbin/lsof', ['-nP', '-Fn', ...files.map(f => f.p)])).values()) names.forEach(n => open.add(n));
  const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
  // the tmp dir keeps the session id a task was born in; resumed sessions log under a newer jsonl, so look in the newest few too
  const texts = new Map(), textOf = f => {
    const key = f.pd + '/' + f.sd;
    if (!texts.has(key)) {
      const pdir = path.join(PROJECTS, f.pd), recent = safeDir(pdir).filter(x => x.endsWith('.jsonl'))
        .map(x => { try { return [x, fs.statSync(path.join(pdir, x)).mtimeMs]; } catch { return [x, 0]; } }).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
      texts.set(key, [...new Set([f.sd + '.jsonl', ...recent])].map(x => { try { return readTail(path.join(pdir, x), 524288, 524288); } catch { return ''; } }).join('\n'));
    }
    return texts.get(key);
  };
  return files.map(f => {
    const c = infoCache.get(f.id);
    const info = c && (c.status || now - c.at < 60e3) ? c : { ...taskInfo(textOf(f), f.id), at: now };
    infoCache.set(f.id, info);
    const running = open.has(f.p) || open.has(real(f.p)) || (!info.status && now - f.mtime < 30e3);
    return { id: f.id, kind: f.id[0] === 'a' ? 'agent' : 'shell', project: projOfDir(f.pd), name: info.desc || info.summary || f.id,
      running, status: running ? 'running' : info.status || 'done', age: Math.max(0, now - f.born), ended: running ? null : f.mtime, file: f.p };
  }).filter(t => t.running || now - t.ended < 6 * 36e5).slice(0, 20);
}
function safeDir(d) { try { return fs.readdirSync(d); } catch { return []; } }

// ---------- the poll ----------
const titles = new Map();   // pid:port → probe result (probe once per listener)
async function listServers() {
  const rows = parseListen(await sh('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
  const ps = new Map(parsePs(await sh('/bin/ps', ['-axo', 'pid=,etime=,command='])).map(p => [p.pid, p]));
  const devs = [...ps.values()].filter(p => p.pid !== process.pid && p.pid !== process.ppid && p.age > 60e3 && DEV_RE.test(p.args) && !SKIP_RE.test(p.args));
  const pids = [...new Set([...rows.map(r => r.pid), ...devs.map(d => d.pid)])];
  const cwd = pids.length ? parsePidFiles(await sh('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')])) : new Map();
  const cwdOf = pid => cwd.get(pid)?.[0] || null;
  const servers = [];
  for (const r of rows) {
    const p = ps.get(r.pid), dir = cwdOf(r.pid), args = p?.args || r.cmd;
    const sys = !dir?.startsWith(HOME) && SKIP_RE.test(args);
    if (sys) continue;   // AirPlay, ControlCenter, app helpers: not the user's
    const k = r.pid + ':' + r.port;
    if (!titles.has(k)) titles.set(k, probe(r.port));   // promise; new ports probed in parallel
    servers.push({ ...r, kind: kindOf(args, r.cmd), dir, project: projectName(dir), age: p?.age ?? null, k });
  }
  for (const s of servers) { Object.assign(s, await titles.get(s.k)); delete s.k; }
  for (const k of titles.keys()) if (!servers.some(s => s.pid + ':' + s.port === k)) titles.delete(k);
  const listening = new Set(rows.map(r => r.pid));
  const procs = devs.filter(d => !listening.has(d.pid) && cwdOf(d.pid)?.startsWith(HOME)).slice(0, 12)
    .map(d => ({ pid: d.pid, kind: kindOf(d.args, path.basename(d.args.split(' ')[0])), dir: cwdOf(d.pid), project: projectName(cwdOf(d.pid)), age: d.age, args: d.args.slice(0, 120) }));
  return { servers, procs };
}

let cache = { servers: [], procs: [], tasks: [], at: 0 }, inflight = null;
// kick a refresh if stale; returns the cache immediately
function poll(minMs = 10e3) {
  if (!inflight && Date.now() - cache.at >= minMs) inflight = (async () => {
    try { const [s, tasks] = await Promise.all([listServers(), listTasks()]); cache = { ...s, tasks, at: Date.now() }; }
    catch (e) { console.error('ports', e); cache.at = Date.now(); }
    finally { inflight = null; }
  })();
  return cache;
}
// new/gone listeners between two server lists → announcement lines
function diff(prev, next) {
  const key = s => s.pid + ':' + s.port, a = new Set(prev.map(key)), b = new Set(next.map(key));
  return [...next.filter(s => !a.has(key(s))).map(s => `${label(s)} on :${s.port} is up`),
    ...prev.filter(s => !b.has(key(s))).map(s => `${label(s)} on :${s.port} went down`)];
}
const label = s => s.project && s.project !== s.kind ? `${s.kind} (${s.project})` : s.kind;

// launchd-aware stop: bootout the job if launchd owns it (else it just respawns), otherwise SIGTERM
async function stop(pid) {
  const out = await sh('/bin/launchctl', ['list']);
  const lab = out.split('\n').map(l => l.split('\t')).find(p => p.length === 3 && +p[0] === pid)?.[2];
  if (lab && !lab.startsWith('com.apple.')) {
    const uid = process.getuid();
    return new Promise(res => execFile('/bin/launchctl', ['bootout', `gui/${uid}/${lab}`], e => res(e ? `couldn't stop ${lab}` : `stopped ${lab} (launchd)`)));
  }
  try { process.kill(pid, 'SIGTERM'); return `stopped pid ${pid}`; } catch (e) { return `couldn't stop pid ${pid}: ${e.code}`; }
}

module.exports = { parseListen, parsePidFiles, parsePs, etimeMs, titleOf, taskInfo, projOfDir, kindOf, diff, label, poll, stop, listTasks, listServers };
