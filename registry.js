// registry — Claude Code's own session registry, <sessionsDir>/<pid>.json: which sessions are alive, what each one is
// doing (status idle|busy|waiting; waitingFor 'permission prompt'|'input needed'; statusUpdatedAt on Claude Code's
// clock) and where it runs (tmux pane). Read every tick. Nothing here writes or types anything: the processes it runs
// are ps and, once per dialog, a read-only `tmux capture-pane` of that session's own pane (what an approval or a question
// asks while Claude Code keeps the pending tool_use out of the transcript, about 1 dialog in 5).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const DIR = require('./overrides').sessionsDir();

const run = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 4000, maxBuffer: 8e6 }, (e, out) => res(e ? null : String(out))));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// pid -> { start, tty, at } | { gone, at }: ps once for a new pid, then every 30 s (a pid is reused only after its claude died).
// lstart in UTC and English, the way Claude Code writes procStart. ps failing (a loaded Mac) leaves kill(pid, 0) to decide.
const procs = new Map();
const ps = pids => new Promise(res => execFile('/bin/ps', ['-o', 'pid=,tty=,lstart=', '-p', pids.join(',')], { timeout: 4000, env: { TZ: 'UTC', LC_ALL: 'C' } },
  (e, out) => res(!e || e.code === 1 ? String(out || '') : null)));   // exit 1 = none of them exists
async function look(pids) {
  const now = Date.now(), want = pids.filter(p => !(now - (procs.get(p)?.at || 0) < 30e3));
  const out = want.length ? await ps(want) : null;
  if (out !== null) for (const p of want) procs.set(p, { gone: true, at: now });   // re-set below if listed
  for (const l of (out || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\S+)\s+(\w{3} \w{3}\s+\d+ [\d:]+ \d{4})$/);
    if (m) procs.set(+m[1], { start: Date.parse(m[3].replace(/\s+/g, ' ') + ' UTC'), tty: /^tty/.test(m[2]) ? '/dev/' + m[2] : null, at: now });
  }
  for (const p of procs.keys()) if (!pids.includes(p)) procs.delete(p);
}
// procStart is the start Claude Code read for its own pid (UTC on every machine seen; local time is accepted too)
function sameStart(s, start) {
  if (typeof s !== 'string' || !start) return true;   // nothing to compare: kill(pid, 0) decides alone
  const t = s.replace(/\s+/g, ' ');
  return [Date.parse(t + ' UTC'), Date.parse(t)].some(x => Math.abs(x - start) <= 2000);
}

// sessionId -> entry, for every registry file whose claude is alive and is the process that wrote it (same pid, same start).
// Symlinks are followed; a dangling one is a claude that exited. A file caught mid-rewrite keeps its last good parse.
const last = new Map();   // file name -> last parsed entry
async function read(dir = DIR) {
  let names; try { names = fs.readdirSync(dir).filter(n => /^\d+\.json$/.test(n)); } catch (e) { return e.code === 'ENOENT' ? new Map() : null; }
  const ents = [];
  for (const n of names) {
    let e; try { e = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch (x) { e = x.code === 'ENOENT' ? null : last.get(n); }
    if (!e) { last.delete(n); continue; }
    last.set(n, e);
    const pid = Number.isInteger(e.pid) ? e.pid : +n.slice(0, -5);
    if (typeof e.sessionId === 'string' && alive(pid)) ents.push({ ...e, pid });
  }
  for (const n of last.keys()) if (!names.includes(n)) last.delete(n);
  await look(ents.map(e => e.pid));
  const out = new Map();
  for (const e of ents) {
    const p = procs.get(e.pid);
    if (p && (p.gone || !sameStart(e.procStart, p.start))) continue;   // exited since, or the pid now belongs to another process
    e.tty = p?.tty || null;
    const had = out.get(e.sessionId);
    if (!had || (e.statusUpdatedAt || 0) >= (had.statusUpdatedAt || 0)) out.set(e.sessionId, e);
  }
  await dialogs(out);
  return out;
}

// ---------- the open dialog, from the session's own tmux pane ----------
// once per block (key: pid + statusUpdatedAt); a pane read before the dialog is drawn is retried, 4 tries at most
const seen = new Map();   // pid -> { key, d, tries, next }
async function dialogs(reg) {
  const pids = new Set();
  for (const e of reg.values()) {
    pids.add(e.pid);
    if (e.status !== 'waiting' || !e.tmux || !e.tty) continue;
    let h = seen.get(e.pid);
    if (h?.key !== e.statusUpdatedAt) seen.set(e.pid, h = { key: e.statusUpdatedAt, d: null, tries: 0, next: 0 });
    if (!h.d && h.tries < 4 && Date.now() >= h.next) {
      h.tries++; h.next = Date.now() + 2500;
      const bin = await tmuxBin();
      h.d = bin ? await capture(bin, e) : null;
    }
    e.dialog = h.d;
  }
  for (const pid of seen.keys()) if (!pids.has(pid)) seen.delete(pid);
}
// read-only: the pane's tty must be the claude's own tty, or nothing is read (another tmux server, a reused pane id)
async function capture(bin, e) {
  const pane = (String(e.tmux).match(/%\d+$/) || [String(e.tmux)])[0];
  const out = await run(bin, ['display-message', '-p', '-t', pane, '#{pane_tty}', ';', 'capture-pane', '-p', '-J', '-t', pane]);
  if (!out) return null;
  const [tty, ...lines] = out.split('\n');
  return tty.trim() === e.tty ? parseDialog(lines) : null;
}
// a GUI app's PATH has no /opt/homebrew/bin (findClaude in main.js has the same problem): look where tmux installs, then
// ask a login shell, once
let tmuxPath;   // undefined = not looked yet, null = none
function tmuxBin() {
  if (tmuxPath !== undefined) return Promise.resolve(tmuxPath);
  for (const p of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/opt/local/bin/tmux', '/usr/bin/tmux']) {
    try { fs.accessSync(p, fs.constants.X_OK); return Promise.resolve(tmuxPath = p); } catch {}
  }
  return run('/bin/zsh', ['-lc', 'command -v tmux']).then(out => { const p = out && out.trim().split('\n').pop(); return tmuxPath = p && p.startsWith('/') ? p : null; });
}

// Claude Code's dialog at the bottom of a pane: from the last full-width rule above the 'Esc to cancel' footer.
//   approval  'Bash command' / description / ╌╌ / the command / ╌╌ / 'Do you want to proceed?' / ❯ 1. Yes / 2. … / 3. No
//   question  '☐ Header' / the question / ❯ 1. SQLite / (its description) / … / 4. Type something. / ── / 5. Chat about this
// → { kind: 'approval' | 'plan' | 'question', ask, options: [{ key, label }] } or null
const OPT = /^\s*(?:❯\s*)?(\d+)\.\s+(.+?)\s*$/, RULE = /^\s*─{8,}\s*$/, DASH = /^\s*╌{4,}\s*$/;
const clip = (t, n = 160) => t.length <= n ? t : t.slice(0, n - 1) + '…';
function parseDialog(lines) {
  lines = lines.map(l => l.replace(/\s+$/, ''));
  let end = lines.length - 1;
  while (end >= 0 && !/Esc to (?:cancel|exit|go back)/.test(lines[end])) end--;
  let start = end - 1;
  while (start >= 0 && !(RULE.test(lines[start]) && !OPT.test(lines[start + 1] || ''))) start--;
  if (end < 0 || start < 0) return null;
  const block = lines.slice(start + 1, end).filter(l => l.trim() && !RULE.test(l));
  const options = block.map(l => l.match(OPT)).filter(Boolean).map(m => ({ key: m[1], label: m[2] }));
  const text = block.filter(l => !OPT.test(l) && !DASH.test(l)).map(l => l.trim());
  if (!options.length || !text.length) return null;
  if (/^[←☐☒✔□■]/.test(text[0])) {   // AskUserQuestion: header (or tab bar), the question, choices with indented descriptions
    const q = block.find(l => !OPT.test(l) && !/^\s*[←☐☒✔□■]/.test(l) && !/^\s{3,}\S/.test(l))?.trim() || text[0].replace(/^\S+\s*/, '');
    const choices = options.filter(o => !/^(?:Type something\.?|Chat about this|Other)$/i.test(o.label));   // free text and chat aren't choices
    return { kind: 'question', ask: clip(q + (choices.length ? ` (${choices.map(o => o.label).join(' / ')})` : '')), options: choices };
  }
  if (!options.some(o => /^Yes\b/.test(o.label))) return null;
  if (/plan/i.test(text[0]) || options.some(o => /keep planning/i.test(o.label))) return { kind: 'plan', ask: clip(`Plan: ${text[0]}`), options };
  // the command sits between the dashed rules; a tool with none (Edit, Fetch …) names its target on the line after the title
  const d = block.map((l, i) => DASH.test(l) ? i : -1).filter(i => i >= 0);
  const what = d.length >= 2 ? block.slice(d[0] + 1, d[1]).map(l => l.trim()).join(' ') : text[1] || '';
  const tool = text[0] === 'Bash command' ? 'Bash' : text[0];
  return { kind: 'approval', ask: clip(what ? `${tool}: ${what}` : tool), options };
}

module.exports = { read, parseDialog, sameStart, tmuxBin, DIR };
