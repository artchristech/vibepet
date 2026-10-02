// gathers the after/ results into after/recap.json: each acceptance item → what was measured, on which commit, at what load
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const A = path.resolve(__dirname, '..'), E = path.resolve(A, '..'), j = f => { try { return JSON.parse(fs.readFileSync(path.join(A, f), 'utf8')); } catch { return null; } };
const head = execFileSync('git', ['-C', '/Users/christopherharris/.vibepet-ultra/wt/r1-ports-truth', 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim();
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const stats = a => ({ n: a.length, median: median(a), min: Math.min(...a), max: Math.max(...a) });
const runs = ['a-timing-run1.json', 'a-timing-run2.json', 'a-timing-run3.json'].map(f => [f, j(f)]).filter(x => x[1]);
const trials = runs.flatMap(([, r]) => r.trials.filter(t => t.showMs != null && t.goneMs != null));
const prevA = ['a-timing.json', 'a-timing-run1.json', 'a-timing-run2.json', 'a-timing-run3.json'].map(f => j('prev-bdd556f/' + f)).filter(Boolean).flatMap(r => r.trials.filter(t => t.showMs != null));
const bc = j('bc-names-hosts.json'), bcRuns = ['bc-names-hosts.json', 'bc-names-hosts-run2.json', 'bc-names-hosts-run3.json', 'bc-names-hosts-run4.json'].map(f => [f, j(f)]).filter(x => x[1]);
const cs = j('c-slow.json'), d = j('d-many-stop.json'), e = j('e-stop-cmd.json'), cpu = j('cpu-idle.json');
const canon = (() => { try { const c = JSON.parse(fs.readFileSync(path.join(E, 'canon', 'canon.json'), 'utf8')); return { git: c.git, passed: c.assertions.filter(x => x.ok).length, total: c.assertions.length, failures: c.failures, ports: c.surfaces.ports }; } catch { return null; } })();
const R = {
  head, writtenAt: new Date().toISOString(),
  a: { what: runs[0]?.[1].what, show: stats(trials.map(t => t.showMs)), gone: stats(trials.map(t => t.goneMs)), goneAfterExit: stats(trials.map(t => t.goneAfterExitMs).filter(x => x != null)),
    loadPerTrial: stats(trials.map(t => t.load[0])), runs: runs.map(([f, r]) => ({ file: 'after/' + f, show: r.show, gone: r.gone, uptimeStart: r.uptimeStart, uptimeEnd: r.uptimeEnd })),
    previousCommit: { git: 'bdd556f (listed only by the full lsof, tick awaited it)', show: prevA.length ? stats(prevA.map(t => t.showMs)) : null, files: 'after/prev-bdd556f/a-timing*.json' } },
  b: bc && { chips: bc.chipsLate.filter(c => Object.values(bc.ports).includes(c.port)).map(c => c.label), file: 'after/bc-names-hosts.json' },
  c: bc && { opens: bc.opens.map(o => ({ chip: o.chip, openExternal: o.url, thatUrlServes: o.servesTitle })), binds: bc.binds, slowFirst: bc.slowFirst, slowOne: bc.slow,
    slowOneRuns: bcRuns.map(([f, r]) => ({ file: 'after/' + f, msAfterReady: r.slow?.msAfterReady ?? null, uptimeStart: r.uptimeStart })),
    slowN: cs && { afterReady: cs.afterReady, mainAfterReady: cs.mainAfterReady, reopenedHome: cs.reopened?.length ?? 0, firstShownInactive: cs.trials.map(t => t.firstShownInactive), uptimeStart: cs.uptimeStart, uptimeEnd: cs.uptimeEnd, file: 'after/c-slow.json' }, uptime: [bc.uptimeStart, bc.uptimeEnd] },
  d: d && { folded: d.folded, expanded: d.expanded, prefork: d.prefork, debugger: d.debugger, stale: d.stale, menuStop: d.menuStop, externalKill: d.externalKill, uptime: [d.uptimeStart, d.uptimeEnd], file: 'after/d-many-stop.json' },
  e: e && { what: e.what, chipGone: e.chipGone, note: e.note, notes: e.trials.map(t => t.note), uptimeStart: e.uptimeStart, uptimeEnd: e.uptimeEnd, file: 'after/e-stop-cmd.json' },
  f: { unitTest: "test/ports.test.js: 'listTasks: a running background task is named by its tool_use description (2.1.287 records, one record a line)' + the taskInfo asserts on the fleet record shapes", fleetTurns: 0 },
  cpu: cpu && { what: cpu.what, runs: cpu.runs, file: 'after/cpu-idle.json' },
  canon,
  shots: fs.readdirSync(path.join(A, 'shots')).sort().map(f => 'after/shots/' + f),
};
fs.writeFileSync(path.join(A, 'recap.json'), JSON.stringify(R, null, 1));
console.log(JSON.stringify({ head, a: [R.a.show, R.a.gone, R.a.loadPerTrial], prevShow: R.a.previousCommit.show, e: R.e && [R.e.chipGone, R.e.note], canon: canon && `${canon.passed}/${canon.total}` }));
