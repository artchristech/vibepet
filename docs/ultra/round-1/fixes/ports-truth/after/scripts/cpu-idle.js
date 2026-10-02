// what the listener watch costs: the app's main-process CPU over 60 s with Home closed (nothing changing), this build vs. the
// base (round-1 integration) — same root, same machine, run back to back. Writes ../cpu-idle.json
const L = require('./rlib'), fs = require('fs'), { execFileSync } = require('child_process');
const { launch } = require('/Users/christopherharris/.vibepet-ultra/wt/r1-ports-truth/test/ultra/launch');
const cpu = pid => { const t = execFileSync('/bin/ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim(); const [m, s] = t.split(':'); return +m * 60 + +s; };
const kids = pid => execFileSync('/bin/ps', ['-axo', 'pid=,ppid='], { encoding: 'utf8' }).split('\n').map(l => l.trim().split(/\s+/).map(Number)).filter(c => c[1] === pid).length;
(async () => {
  const out = { what: 'Electron main CPU seconds over 60 s, Home closed, isolated fleet root', runs: [] };
  for (const [name, appDir] of [['fix', L.WT], ['base', '/Users/christopherharris/.vibepet-ultra/int'], ['fix', L.WT], ['base', '/Users/christopherharris/.vibepet-ultra/int']]) {
    const ud = `/Users/christopherharris/.vibepet-ultra/userdata/r1-ports-truth-cpu-${name}`; fs.rmSync(ud, { recursive: true, force: true });
    const v = await launch({ appDir, root: L.ROOT, userData: ud, hotkey: 'off', state: { setupDone: true, muted: true } });
    try { await L.sleep(10e3); const c0 = cpu(v.pid), l0 = L.uptime(); await L.sleep(60e3); const c1 = cpu(v.pid);
      out.runs.push({ build: name, git: execFileSync('git', ['-C', appDir, 'log', '-1', '--format=%h'], { encoding: 'utf8' }).trim(), cpuSecPerMin: +(c1 - c0).toFixed(2), uptimeStart: l0, uptimeEnd: L.uptime() });
      console.log(JSON.stringify(out.runs.at(-1)));
    } finally { await v.close(); }
  }
  fs.writeFileSync(L.OUT + '/cpu-idle.json', JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
