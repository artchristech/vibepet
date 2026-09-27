// agents — read Claude Code session tails, and find the terminal a session lives in.
// Nothing here runs a process except locate/focus, which main.js calls only from the 'jump' handler (a click).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const SESS_DIR = path.join(os.homedir(), '.claude', 'sessions');   // Claude Code's own <pid>.json registry

function readTail(file, bytes = 131072, maxBytes = 16 * 1048576) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    for (;;) {
      const start = Math.max(0, size - bytes);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift();
      // a single huge record can swallow the whole window; widen until we get a full line
      if (start === 0 || bytes >= maxBytes || lines.some(l => l.trim())) return lines;
      bytes *= 4;
    }
  } finally { fs.closeSync(fd); }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  return (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

// one line for the pill: markdown stripped, whitespace collapsed, ≤ n chars (a question keeps its '?')
const plain = t => t.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*>#]+|\d+\.)\s*/, '').replace(/\s+/g, ' ').trim();
function cap(t, n = 120) {
  if (t.length <= n) return t;
  return t.endsWith('?') ? t.slice(0, n - 2).trimEnd() + '…?' : t.slice(0, n - 1).trimEnd() + '…';
}
const lastLine = t => plain(t.trim().split('\n').filter(l => l.trim()).pop() || '');
const firstSentence = t => { const p = plain(t.trim().split(/\n\s*\n/)[0] || ''); return (p.match(/^.*?[.!?](?=\s|$)/) || [p])[0]; };
function toolAsk(c) {
  const i = c.input || {};
  return `${c.name}: ${plain(String(i.command || i.file_path || i.pattern || i.url || i.description || ''))}`.replace(/: $/, '');
}

// a real human prompt: typed text (or a /command), not a tool result, hook echo or background-task notice
function humanAt(d) {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return 0;
  const c = d.message?.content;
  if (Array.isArray(c) && c.some(b => b.type === 'tool_result')) return 0;
  const t = textOf(c).trimStart();
  if (!t || t.startsWith('[Request interrupted') || (t.startsWith('<') && !t.startsWith('<command-'))) return 0;
  return Date.parse(d.timestamp) || 0;
}

// side: a subagent's own file, whose records are all sidechain
function classify(file, mtimeMs, side = false) {
  const idle = Date.now() - mtimeMs;
  const lines = readTail(file);
  let cwd = null, title, turnAt = 0;
  for (let i = lines.length - 1; i >= 0 && title === undefined; i--) {
    if (!lines[i].includes('"ai-title"')) continue;
    try { const d = JSON.parse(lines[i]); if (d.type === 'ai-title' && d.aiTitle) title = String(d.aiTitle).slice(0, 80); } catch {}
  }
  for (let i = lines.length - 1; i >= 0 && !side && !turnAt; i--) {
    if (!lines[i].includes('"type":"user"')) continue;
    try { turnAt = humanAt(JSON.parse(lines[i])); } catch {}
  }
  turnAt ||= Date.now() - 45 * 60e3;
  const out = (phase, ask, extra) => ({ phase, cwd, title, turnAt, ...(ask ? { ask: cap(ask) } : {}), ...extra });
  for (let i = lines.length - 1; i >= 0; i--) {
    let d; try { d = JSON.parse(lines[i]); } catch { continue; }
    if (!cwd && d.cwd) cwd = d.cwd;
    if ((d.isSidechain && !side) || d.isMeta || (d.type !== 'assistant' && d.type !== 'user')) continue;
    cwd = d.cwd || cwd;
    if (d.type === 'assistant') {
      const m = d.message || {}, tools = (m.content || []).filter(c => c.type === 'tool_use');
      if (tools.length) return idle > 90000 ? out('stalled', toolAsk(tools[tools.length - 1]), { agentWait: tools.some(c => c.name === 'Agent' || c.name === 'Task') }) : out('working');
      if (['end_turn', 'stop_sequence', 'max_tokens'].includes(m.stop_reason)) {
        if (idle > 5 * 60e3) return out('parked');
        const t = textOf(m.content).trim();
        return t.endsWith('?') ? out('waiting', lastLine(t)) : out('ready', firstSentence(t));   // a question needs you; anything else is just done
      }
      return out('working');
    }
    const txt = textOf(d.message?.content);
    if (txt.startsWith('[Request interrupted')) return out('parked');
    return out(idle > 120000 && !side ? 'parked' : 'working');   // a subagent thinking past 2 min after a tool result is still running (fanout ages it out at 10)
  }
  return null;
}

// ---------- fan-out: the subagents a session is waiting on ----------
// The parent jsonl goes silent while its children run; their files live in <session>/subagents/.
const kidCache = new Map(), metaCache = new Map();   // child path -> { size, mtimeMs, k: { phase, stuck, ask } } | meta
function meta(fp) {
  if (metaCache.has(fp)) return metaCache.get(fp);
  let m = {}; try { m = JSON.parse(fs.readFileSync(fp.slice(0, -6) + '.meta.json', 'utf8')) || {}; } catch {}
  if (metaCache.size > 4000) metaCache.clear();
  metaCache.set(fp, m); return m;
}
function kidPhase(fp, st) {
  const hit = kidCache.get(fp);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.k;
  let c = null; try { c = classify(fp, st.mtimeMs, true); } catch {}
  // stuck: silent > 90 s on a tool that isn't itself an Agent call. Subagent approvals block in the parent's terminal.
  const k = { phase: c?.phase || null, stuck: c?.phase === 'stalled' && !c.agentWait, ask: c?.ask };
  if (kidCache.size > 4000) kidCache.clear();
  kidCache.set(fp, { size: st.size, mtimeMs: st.mtimeMs, k });
  return k;
}
function fanout(file, turnAt = Date.now() - 45 * 60e3) {
  const dir = path.join(file.slice(0, -6), 'subagents');
  let names; try { names = fs.readdirSync(dir); } catch { return null; }
  // workflow runs keep their agents one level down: subagents/workflows/<run>/agent-*.jsonl
  let wf = []; try { wf = fs.readdirSync(path.join(dir, 'workflows')).map(w => path.join('workflows', w)); } catch {}
  for (const w of wf) try { names.push(...fs.readdirSync(path.join(dir, w)).map(n => path.join(w, n))); } catch {}
  const now = Date.now(), kids = [];
  let newestAt = 0;
  for (const n of names) {
    if (!n.endsWith('.jsonl') || !path.basename(n).startsWith('agent-')) continue;
    const fp = path.join(dir, n);
    let st; try { st = fs.statSync(fp); } catch { continue; }
    if (st.mtimeMs < turnAt) continue;                    // finished before this turn began
    newestAt = Math.max(newestAt, st.mtimeMs);
    kids.push({ fp, st, m: meta(fp) });
  }
  const top = kids.filter(k => !k.m.parentAgentId), depth = k => k.m.spawnDepth ?? 1;
  const min = Math.min(...kids.map(depth));
  const direct = (top.length ? top : kids.filter(k => depth(k) === min)).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs).slice(0, 32);
  let open = 0, oldestOpenAt = null, stuck = 0, stuckAsk;
  const items = direct.map(k => {
    const p = kidPhase(k.fp, k.st), o = (p.phase === 'working' || p.phase === 'stalled') && now - k.st.mtimeMs < 10 * 60e3;
    if (o) { open++; const b = k.st.birthtimeMs || k.st.mtimeMs; oldestOpenAt = Math.min(oldestOpenAt ?? b, b); }
    if (o && p.stuck) { stuck++; stuckAsk ??= p.ask; }
    return { desc: cap(plain(String(k.m.description || '')), 60), open: o };
  });
  return { total: direct.length, done: direct.length - open, open, stuck, stuckAsk, oldestOpenAt, newestAt: newestAt || null, items };
}
// open children keep a parent working: not done, and not stuck on the Agent call it's waiting on. A question still needs you,
// and so does a child stuck on its own tool (its approval prompt is in the parent's terminal): then the parent is stuck, on the child's ask.
function settle(c, fo) {
  if (!c || !(fo?.open > 0)) return c?.phase;
  if (c.phase === 'ready' || c.phase === 'parked' || (c.phase === 'stalled' && c.agentWait)) return fo.stuck > 0 ? 'stalled' : 'working';
  return c.phase;
}

// every live session under root (~/.claude/projects); onChange(s, prev) on a phase change
function scan(root, sessions, onChange) {
  let dirs; try { dirs = fs.readdirSync(root); } catch { return []; }
  const now = Date.now(), seen = new Set(), out = [];
  for (const dname of dirs) {
    if (dname.includes('private-tmp') || dname.includes('scratchpad')) continue; // throwaway worker sessions
    const dir = path.join(root, dname);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let st; try { st = fs.statSync(fp); } catch { continue; }
      const age = now - st.mtimeMs;
      if (age > 45 * 60e3 && (age > 12 * 3600e3 || !(now - (fanout(fp)?.newestAt || 0) <= 45 * 60e3))) continue;   // silent parent, but children may still run
      let c; try { c = classify(fp, st.mtimeMs); } catch { continue; }
      if (!c) continue;
      const fo = fanout(fp, c.turnAt), phase = settle(c, fo);
      const id = f.slice(0, -6);
      seen.add(id);
      const prev = sessions.get(id);
      const name = c.cwd ? path.basename(c.cwd) : dname.split('-').pop();
      const s = { id, file: fp, name, cwd: c.cwd, phase, since: prev && prev.phase === phase ? prev.since : now, mtime: Math.max(st.mtimeMs, fo?.newestAt || 0),
        ask: phase === 'stalled' && fo?.stuck && (c.phase !== 'stalled' || c.agentWait) ? fo.stuckAsk : c.ask, title: c.title || prev?.title, fanout: fo?.total ? fo : undefined };
      if (prev && prev.phase !== phase) onChange?.(s, prev);
      sessions.set(id, s);
      if (phase !== 'parked') out.push(s);
    }
  }
  for (const id of [...sessions.keys()]) if (!seen.has(id)) sessions.delete(id);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// ---------- where does a session live? (on click only) ----------
const run = (cmd, args, timeout = 3000) => new Promise(res =>
  execFile(cmd, args, { timeout, maxBuffer: 8e6 }, (e, out) => res(e ? null : out)));

async function psAll() {
  const out = await run('/bin/ps', ['-axo', 'pid=,ppid=,tty=,lstart=,comm=']);
  const procs = new Map();
  for (const l of (out || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.+)$/);
    if (m) procs.set(+m[1], { pid: +m[1], ppid: +m[2], tty: m[3].startsWith('tty') ? '/dev/' + m[3] : null, start: Date.parse(m[4].replace(/\s+/g, ' ')), comm: m[5] });
  }
  return procs;
}

const locCache = new Map();   // session id -> { pid, tty }
const isClaude = p => !!p && path.basename(p.comm) === 'claude';
async function locateSession(s, procs) {
  procs ||= await psAll();
  const hit = locCache.get(s.id);
  if (hit && isClaude(procs.get(hit.pid))) return hit;
  locCache.delete(s.id);
  const cands = [...procs.values()].filter(isClaude);
  const keep = p => { const v = { pid: p.pid, tty: p.tty }; locCache.set(s.id, v); return v; };
  for (const p of cands) {          // exact: Claude Code records which session each pid is running
    try { if (JSON.parse(fs.readFileSync(path.join(SESS_DIR, p.pid + '.json'), 'utf8')).sessionId === s.id) return keep(p); } catch {}
  }
  if (!s.cwd) return null;
  const cwds = await Promise.all(cands.map(p => run('/usr/sbin/lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'])));
  const same = cands.filter((p, i) => (cwds[i] || '').split('\n').find(l => l.startsWith('n'))?.slice(1) === s.cwd);
  if (!same.length) return null;
  let born = Infinity; try { born = fs.statSync(s.file).birthtimeMs; } catch {}
  const gap = p => p.start <= born ? born - p.start : 1e13 + p.start - born;   // started closest to, and not after, the session
  return keep(same.sort((a, b) => gap(a) - gap(b))[0]);
}

// the terminal host: walk up from the shell to the first process inside an .app bundle (outermost bundle wins)
function hostApp(pid, procs) {
  for (let p = procs.get(procs.get(pid)?.ppid), n = 0; p && p.pid > 1 && n < 24; p = procs.get(p.ppid), n++) {
    const m = p.comm.match(/^(.*?\.app)\/Contents\//);
    if (m) return m[1];
  }
  return null;
}
async function bundleId(app) {
  const out = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(app, 'Contents', 'Info.plist')]);
  return out ? out.trim() : null;
}

const FOCUS = {
  'com.googlecode.iterm2': `on run argv
  tell application id "com.googlecode.iterm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is (item 1 of argv) then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "no"
end run`,
  'com.apple.Terminal': `on run argv
  tell application id "com.apple.Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then
          set selected tab of w to t
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "no"
end run`,
};
async function focusTty(bid, tty) {
  if (!FOCUS[bid] || !tty) return false;
  return (await run('/usr/bin/osascript', ['-e', FOCUS[bid], tty], 5000))?.trim() === 'ok';
}

module.exports = { readTail, textOf, classify, fanout, settle, scan, psAll, locateSession, hostApp, bundleId, focusTty, run };
