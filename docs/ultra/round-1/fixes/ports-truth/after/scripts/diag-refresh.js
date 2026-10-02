// how long one listServers() takes inside the app (lsof + ps + cwd lsof + ≤400 ms probe wait), and netstat, under the current load
const L = require('./rlib');
(async () => {
  const v = await L.start();
  try {
    const r = await v.evalMain(async () => {
      const req = globalThis.__vibepet.require, p = req('./ports'), { execFile } = req('child_process');
      const sh = (c, a) => new Promise(res => execFile(c, a, { maxBuffer: 8e6 }, (e, o) => res(o || '')));
      const t = async f => { const t0 = Date.now(); await f(); return Date.now() - t0; }, out = { list: [], lsof: [], ps: [], netstat: [], cwd: [] };
      for (let i = 0; i < 8; i++) {
        out.netstat.push(await t(() => sh('/usr/sbin/netstat', ['-anv', '-p', 'tcp'])));
        out.lsof.push(await t(() => sh('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpctn'])));
        out.ps.push(await t(() => sh('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,etime=,command='])));
        out.list.push(await t(() => p.listServers()));
      }
      return out;
    });
    const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
    console.log(L.uptime()); for (const [k, a] of Object.entries(r)) if (a.length) console.log(k, 'median', med(a), 'max', Math.max(...a), JSON.stringify(a));
  } finally { await v.close(); }
})().catch(e => { console.error(e); process.exit(1); });
