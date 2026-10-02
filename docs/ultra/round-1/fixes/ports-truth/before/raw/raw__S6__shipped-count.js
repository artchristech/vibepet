// How many chips would the SHIPPED filter (no VIBEPET_CLAUDE_DIR) produce on this machine right now? Counts only:
// no process names, paths, titles or ports are printed, and no listener is contacted (ports.js would GET each one).
const { execFileSync } = require('child_process'); const os = require('os');
const P = require('/Users/christopherharris/.vibepet-ultra/int/ports.js');   // parse helpers only (isolated: env set by caller)
const sh = (c, a) => { try { return execFileSync(c, a, { encoding: 'utf8', maxBuffer: 64e6 }); } catch (e) { return e.stdout || ''; } };
const rows = P.parseListen(sh('/usr/sbin/lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpcn']));
const ps = new Map(P.parsePs(sh('/bin/ps', ['-axo', 'pid=,etime=,command='])).map(p => [p.pid, p]));
const pids = [...new Set(rows.map(r => r.pid))];
const cwd = P.parsePidFiles(sh('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]));
const SKIP_RE = /^\/(System|Applications|Library|usr\/(libexec|sbin))\/|\.app\/Contents\/|\/\.vscode|\/\.cursor|claude(\/| |$)|mcp|language-?server|tsserver|typingsInstaller|eslintServer|copilot/i;
const HOME = os.homedir();
const kept = rows.filter(r => { const dir = (cwd.get(r.pid) || [])[0] || null, args = ps.get(r.pid)?.args || r.cmd; return !(!dir?.startsWith(HOME) && SKIP_RE.test(args)); });
const fleet = kept.filter(r => ((cwd.get(r.pid) || [])[0] || '').includes('/.vibepet-ultra/'));
const v6only = kept.filter(r => r.host === '::1');
const multi = new Map(); for (const r of kept) multi.set(r.port, (multi.get(r.port) || 0) + 1);
console.log(JSON.stringify({ listeningSockets: rows.length, shippedChips: kept.length, ofWhichTestFleet: fleet.length, homeShowsAtMost: 8, hiddenByCap: Math.max(0, kept.length - 8),
  boundToIPv6LoopbackOnly: v6only.length, portsWithSeveralPids: [...multi.values()].filter(n => n > 1).length }));
