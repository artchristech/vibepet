// tmux — reach a Claude Code session that runs inside tmux, through the pane its registry entry names
// ('vp-kestrel:@8.%8' = session:@window.%pane). The tmux server is a daemon (ppid 1), so no terminal app is an ancestor
// of that claude: jump switches an attached client to the pane (main then raises the terminal hosting the client), and
// send-to types into the pane with send-keys, only after the pane's own screen shows what the action answers.
// Never Accessibility, never a focus change on this path; every action first proves the pane runs that claude.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const sh = (bin, args) => new Promise(res => execFile(bin, args, { timeout: 3000, maxBuffer: 4e6 }, (e, out) => res(e ? null : out)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// a GUI app's PATH lacks /opt/homebrew/bin: look where tmux lives, then ask a login shell (as main.js findClaude does)
let tmuxBin;   // undefined = not looked yet, null = none
function bin() {
  if (tmuxBin !== undefined) return Promise.resolve(tmuxBin);
  for (const p of ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/opt/local/bin/tmux', '/usr/bin/tmux', path.join(os.homedir(), '.local/bin/tmux')]) {
    try { fs.accessSync(p, fs.constants.X_OK); return Promise.resolve(tmuxBin = p); } catch {}
  }
  return new Promise(res => execFile('/bin/zsh', ['-lc', 'command -v tmux'], { timeout: 3000 }, (e, out) => {
    const p = !e && out.trim().split('\n').pop();
    res(tmuxBin = p && p.startsWith('/') ? p : null);
  }));
}
const tmux = async args => { const b = await bin(); return b ? sh(b, args) : null; };

// the registry's target → its parts; the pane id is what gets targeted (unique, stable for the pane's life)
function parseTarget(t) {
  const m = String(t || '').match(/^(?:([^:]+):)?(?:(@\d+)\.)?(%\d+)$/);
  return m ? { session: m[1] || null, window: m[2] || null, pane: m[3] } : null;
}
// the pane hosts this claude: its pane_pid is claude's pid or an ancestor of it
function owns(procs, panePid, pid) {
  for (let p = pid, n = 0; p > 1 && n < 32; p = procs.get(p)?.ppid, n++) if (p === panePid) return true;
  return false;
}
// display -p PANE → its parts, or null (copy mode and synchronize-panes decide whether keys would reach claude alone)
const PANE = '#{pane_pid} #{pane_in_mode} #{pane_synchronized} #{window_id} #{pane_id} #{session_name}';
function parsePane(out) {
  const m = String(out || '').trim().match(/^(\d+) ([01]) ([01]) (@\d+) (%\d+) (.+)$/);
  return m ? { panePid: +m[1], inMode: m[2] === '1', synced: m[3] === '1', window: m[4], pane: m[5], session: m[6] } : null;
}
// where the pane is now (a pane can be moved to another window or session) — only if it still runs this claude
async function locate(target, pid, procs, name) {
  const t = parseTarget(target);
  if (!t) return { why: `can't read ${name}'s tmux pane (${target})` };
  if (!await bin()) return { why: `${name} runs in tmux, but vibepet can't find the tmux command` };
  const p = parsePane(await tmux(['display', '-p', '-t', t.pane, PANE]));
  if (!p) return { why: `${name}'s tmux pane ${t.pane} is gone` };
  if (!owns(procs, p.panePid, pid)) return { why: `tmux pane ${t.pane} doesn't run ${name} anymore` };
  return p;
}

// attached clients ('#{client_tty} #{client_pid} #{client_activity} #{client_session}'): one already on the session, else the last used
function pickClient(out, session) {
  const cs = String(out || '').split('\n').map(l => l.match(/^(\S+) (\d+) (\d+) (.+)$/)).filter(Boolean)
    .map(m => ({ tty: m[1], pid: +m[2], activity: +m[3], session: m[4] }));
  return cs.sort((a, b) => (b.session === session) - (a.session === session) || b.activity - a.activity)[0] || null;
}
// jump: an attached client shows the pane → { ok, client: { tty, pid }, session }; main raises the terminal hosting the client
async function jump({ target, pid, procs, name }) {
  const at = await locate(target, pid, procs, name);
  if (at.why) return { ok: false, why: at.why };
  const c = pickClient(await tmux(['list-clients', '-F', '#{client_tty} #{client_pid} #{client_activity} #{client_session}']), at.session);
  const q = /^[\w@%+=:,./-]+$/.test(at.session) ? at.session : `'${at.session.replace(/'/g, `'\\''`)}'`;
  if (!c) return { ok: false, why: `no terminal is attached to tmux session ${at.session}`, attach: `tmux attach -t ${q}` };
  // one tmux call: switch (by pane id, so a session name can't prefix-match another), select, then read back what the client shows
  const out = await tmux([...(c.session === at.session ? [] : ['switch-client', '-c', c.tty, '-t', at.pane, ';']),
    'select-window', '-t', at.window, ';', 'select-pane', '-t', at.pane, ';', 'display', '-p', '-c', c.tty, '#{session_name} #{window_id} #{pane_id}']);
  if ((out || '').trim() !== `${at.session} ${at.window} ${at.pane}`) return { ok: false, why: `tmux didn't switch its client to ${name}'s pane` };
  return { ok: true, client: { tty: c.tty, pid: c.pid }, session: at.session };
}

// ---------- the screen: what the bottom of a Claude Code pane shows (capture-pane -e: text + SGR) ----------
const SGR = /\x1b\[[0-9;:]*m/g;
const RULE = /^\s*─{8,}\s*$/;
// typed into the input box = visible text that isn't grey, dim or inverse: a grey prompt suggestion (and the cursor
// cell on it) doesn't count. Grey = black/bright black, the 256-colour grey ramp, or an achromatic truecolour below #d0d0d0.
const grey256 = n => (n >= 232 && n <= 252) || [0, 8, 16, 59, 102, 145].includes(n);
function typed(raw) {
  let grey = false, dim = false, inv = false;
  for (const part of raw.replace(/^(?:\x1b\[[0-9;:]*m)*❯/, '').split(/(\x1b\[[0-9;:]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;:]*)m$/);
    if (!m) { if (!grey && !dim && !inv && /\S/.test(part)) return true; continue; }
    const ps = (m[1] || '0').split(/[;:]/).map(Number);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (p === 0) { grey = false; dim = false; inv = false; }
      else if (p === 2) dim = true; else if (p === 22) dim = false;
      else if (p === 7) inv = true; else if (p === 27) inv = false;
      else if (p === 39) grey = false;
      else if ((p >= 30 && p <= 37) || (p >= 90 && p <= 97)) grey = p === 30 || p === 90;
      else if (p === 38 || p === 48) {
        const [r, g, b] = ps.slice(i + 2, i + 5), tc = ps[i + 1] === 2;
        if (p === 38) grey = tc ? Math.max(r, g, b) - Math.min(r, g, b) < 16 && r < 208 : grey256(ps[i + 2]);
        i += tc ? 4 : 2;
      }
    }
  }
  return false;
}
// box: the input box (❯ right under a rule, closed by a rule, only the footer below); perm: 'Do you want to …?' with
// '1. Yes' under it (the approval prompt replaces the box); ask: an AskUserQuestion list ('Enter to select'); busy: 'esc to interrupt'
function screenState(raw) {
  const rows = String(raw || '').replace(/\r/g, '').split('\n');
  while (rows.length && !rows[rows.length - 1].replace(SGR, '').trim()) rows.pop();
  const tail = rows.slice(-40), lines = tail.map(l => l.replace(SGR, ''));
  let box = null;
  for (let i = lines.length - 1; i > 0 && !box; i--) {
    if (!/^❯/.test(lines[i]) || !RULE.test(lines[i - 1])) continue;
    const j = lines.findIndex((l, k) => k > i && RULE.test(l));
    if (j > i && j - i <= 12 && lines.length - 1 - j <= 6) box = { draft: tail.slice(i, j).some(typed) };
  }
  const foot = lines.slice(-4).join('\n');
  const ask = !box && /Enter to select/.test(foot);
  const q = box || ask ? -1 : lines.findLastIndex(l => /^\s*Do you want to .*\?\s*$/.test(l));
  const opts = q >= 0 && lines.length - q <= 12 ? lines.slice(q + 1) : [];
  const perm = opts.some(l => /^\s*(?:❯\s*)?1\.\s+Yes\b/.test(l)) ? { onYes: opts.some(l => /^\s*❯\s*1\.\s+Yes\b/.test(l)), always: opts.some(l => /^\s*(?:❯\s*)?2\.\s+Yes\b/.test(l)) } : null;
  const head = ask ? lines.findLastIndex(l => /[☐☒✔]/.test(l)) : -1;
  const keys = ask ? lines.slice(head >= 0 ? head : -24).map(l => (l.match(/^\s*(?:❯\s*)?(\d)\.\s/) || [])[1]).filter(Boolean) : [];
  return { box, perm, ask: ask ? { keys } : null, busy: !!box && /esc to interrupt/.test(lines.slice(-6).join('\n')) };
}
// null = the screen shows what this action answers, else why not (shown to the user as is)
function guard(raw, action, key, name) {
  const s = screenState(raw);
  if (action === 'approve' || action === 'always' || action === 'deny') {
    if (!s.perm) return `${name} isn't showing an approval prompt`;
    if (action === 'approve' && !s.perm.onYes) return `${name}'s approval prompt has another option selected`;
    if (action === 'always' && !s.perm.always) return `${name}'s approval prompt has no "don't ask again" option`;
    return null;
  }
  if (action === 'option') {
    if (!s.ask) return `${name} isn't showing a question`;
    return s.ask.keys.includes(String(key)) ? null : `${name}'s question has no option ${key}`;
  }
  if (action === 'text') {
    if (s.ask) return `${name} is showing a question: pick one of its options`;
    if (s.perm) return `${name} is showing an approval prompt, not its input box`;
    if (!s.box) return `${name} isn't showing its input box`;
    return s.box.draft ? `${name} has unsent text in its input box` : null;
  }
  if (action === 'interrupt') return s.busy ? null : `${name} isn't busy`;
  return `unknown action ${action}`;
}

// send-to: check the screen, then type the action's keys into the pane (approve = Enter on the highlighted '1. Yes')
const KEYS = { approve: ['Enter'], always: ['2'], deny: ['Escape'], interrupt: ['Escape'] };
// one line of literal text; tmux reads an argument ending in ';' as a command separator unless it ends in '\;'
const line = t => String(t ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 2000);
const literal = t => t.endsWith(';') ? t.slice(0, -1) + '\\;' : t;
async function send({ target, pid, procs, name, action, key, text }) {
  if (action === 'option' && !/^[1-9]$/.test(String(key))) return { ok: false, why: `no option ${key}` };
  if (action === 'text' && !line(text)) return { ok: false, why: 'nothing to send' };
  const at = await locate(target, pid, procs, name);
  if (at.why) return { ok: false, why: at.why };
  // keys would go to tmux's copy mode, or to every pane of the window (synchronize-panes), not to claude alone
  if (at.inMode) return { ok: false, why: `${name}'s tmux pane is in copy mode (scrolled back): leave it first` };
  if (at.synced) return { ok: false, why: `${name}'s tmux window has synchronize-panes on: keys would reach every pane` };
  const shot = () => tmux(['capture-pane', '-p', '-e', '-t', at.pane]);
  const raw = await shot();
  if (raw == null) return { ok: false, why: `couldn't read ${name}'s screen` };
  const why = guard(raw, action, key, name);
  if (why) return { ok: false, why };
  const keys = p => tmux(['send-keys', '-t', at.pane, ...p]).then(o => o != null);
  if (action !== 'text') return await keys(action === 'option' ? [String(key)] : KEYS[action]) ? { ok: true } : { ok: false, why: `tmux couldn't type into ${name}'s pane` };
  // Claude Code reads a fast Enter after typed text as part of a paste: type, wait, and press Enter only if the ❯ box now
  // holds typed text and nothing else came up (no box, or an empty one, means the keys went somewhere else: no Enter)
  if (!await keys(['-l', '--', literal(line(text))])) return { ok: false, why: `tmux couldn't type into ${name}'s pane` };
  await sleep(400);
  const now = screenState(await shot());
  if (!now.box?.draft || now.perm || now.ask) return { ok: false, why: `${name}'s screen changed while typing: the reply is in its pane but wasn't sent` };
  return await keys(['Enter']) ? { ok: true } : { ok: false, why: `tmux couldn't press Enter in ${name}'s pane` };
}

module.exports = { bin, parseTarget, parsePane, owns, pickClient, screenState, guard, typed, literal, jump, send };
