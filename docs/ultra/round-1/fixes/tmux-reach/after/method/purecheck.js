// pure-worktree check (no stand-in shim): the committed jump handler, called over the renderer's own IPC (window.pet.jump)
// for each live fleet session, whether or not Home lists it. Parked sessions stay in main's sessions map for 45 min.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-tmux-reach', ULTRA = path.join(os.homedir(), '.vibepet-ultra'), ROOT = path.join(ULTRA, 'root', '.claude');
const { launch } = require(WT + '/test/ultra/launch');
const { instrument, SEED } = require(WT + '/test/ultra/canon');
const OUT = process.argv[2], sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  fs.mkdirSync(OUT, { recursive: true });
  const F = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'sessions'))) { try { const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'sessions', f), 'utf8')); process.kill(r.pid, 0); F[path.basename(r.cwd)] = { sessionId: r.sessionId, tmux: r.tmux }; } catch {} }
  const R = { git: execFileSync('git', ['-C', WT, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim(), worktreeClean: execFileSync('git', ['-C', WT, 'status', '--short', '--untracked-files=no'], { encoding: 'utf8' }).trim() === '',
    uptime: execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim(), clients: execFileSync('/opt/homebrew/bin/tmux', ['list-clients'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length, jumps: [] };
  const v = await launch({ appDir: WT, root: ROOT, userData: path.join(ULTRA, 'userdata', 'r1-tmux-reach'), state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  try {
    await v.evalMain(instrument); await sleep(3500);
    R.rows = (await v.evalMain(() => globalThis.__vibepet.snapshot())).agents.length;
    for (const [m, x] of Object.entries(F)) {
      const t0 = Date.now(), r = await v.win.evaluate(id => window.pet.jump(id), x.sessionId);
      R.jumps.push({ member: m, result: r, ms: Date.now() - t0, load: os.loadavg().map(n => +n.toFixed(2)) });
    }
    const calls = await v.evalMain(() => globalThis.__canon.calls);
    R.clipboardWrites = calls.filter(c => c.kind === 'clipboard').length;
  } finally { R.close = await v.close(); fs.writeFileSync(path.join(OUT, 'pure-jump.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); }
})().catch(e => { console.error(e); process.exit(1); });
