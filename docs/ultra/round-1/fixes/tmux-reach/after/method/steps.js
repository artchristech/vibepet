// where a tmux jump's time goes: psAll, locateSession, tmux.jump, and one no-op AppleScript round trip to Terminal (no raise)
process.env.VIBEPET_CLAUDE_DIR = require('path').join(require('os').homedir(), '.vibepet-ultra/root/.claude');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-tmux-reach';
const { psAll, locateSession, hostApp, run } = require(WT + '/agents'), tmux = require(WT + '/tmux');
const fs = require('fs'), os = require('os'), path = require('path');
const S = path.join(process.env.VIBEPET_CLAUDE_DIR, 'sessions'), F = {};
for (const f of fs.readdirSync(S)) { try { const r = JSON.parse(fs.readFileSync(path.join(S, f), 'utf8')); process.kill(r.pid, 0); F[path.basename(r.cwd)] = r; } catch {} }
const t = async fn => { const a = process.hrtime.bigint(); const r = await fn(); return [Number(process.hrtime.bigint() - a) / 1e6, r]; };
(async () => {
  const rows = [];
  for (let i = 0; i < 3; i++) for (const m of ['kestrel', 'beacon', 'vibepet', 'atlas', 'delta']) {
    const s = { id: F[m].sessionId, cwd: F[m].cwd, file: '/dev/null' };
    const [ps, procs] = await t(psAll), [loc, l] = await t(() => locateSession(s, procs));
    const [tj, j] = await t(() => tmux.jump({ target: l.reg.tmux, pid: l.pid, procs, name: m }));
    const [ae] = await t(() => run('/usr/bin/osascript', ['-e', 'tell application id "com.apple.Terminal" to count windows'], 5000));
    rows.push({ m, ps: +ps.toFixed(0), locate: +loc.toFixed(0), tmuxJump: +tj.toFixed(0), osascriptNoop: +ae.toFixed(0), ok: j.ok, host: j.ok ? path.basename(hostApp(j.client.pid, procs) || '-') : j.why, load: +os.loadavg()[0].toFixed(2), procs: procs.size });
  }
  const med = k => { const a = rows.map(r => r[k]).sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };
  console.log(JSON.stringify({ uptime: require('child_process').execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim(), median: { ps: med('ps'), locate: med('locate'), tmuxJump: med('tmuxJump'), osascriptNoop: med('osascriptNoop') }, rows }, null, 1));
})();
