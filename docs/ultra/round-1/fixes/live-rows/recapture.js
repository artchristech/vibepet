#!/usr/bin/env node
// live-rows recapture — $0: no fleet member takes a turn and no key reaches a session (fleet spend estimate $3.3093 vs the
// $3.32 stop: the SPEND-GATED tta run can't happen). Runs the app from a checkout against the isolated fleet root, as held:
//   watch    which files the watcher arms (fleet paths only) and how many events the idle fleet sends it (0 = no feedback loop)
//   pipe     a watcher event (poke) → the tick it causes, 20×; fast vs full tick durations; renderHome cost
//   verdict  send-to for 8 actions the fleet's own state refuses, through the renderer's IPC (window.pet.sendTo, what the
//            row buttons call): the result, the note in the row (<= 2 s), main's act log; then the fleet's registry
//            entries and panes are unchanged (no key landed)
//   hold     the renderer's hold, fed through the test hook (real 'tick' sends paused): a row acted on keeps its slot with
//            its note for 5 s after the verdict, then joins its new group; the outcome note lands in place
//   cpu      idle app CPU (every process of the instance, ps cputime), Home closed, 60 s windows: fix vs base, interleaved
//   node recapture.js --app <checkout> --out <dir> --userdata <dir> [--parts watch,pipe,verdict,hold] [--cpu <fix>,<base> --runs 3]
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const OUT = path.resolve(arg('--out')), HOME = os.userInfo().homedir, ROOT = path.join(HOME, '.vibepet-ultra', 'root', '.claude');
const HARNESS = '/Users/christopherharris/.vibepet-ultra/wt/r1-live-rows';   // launch.js / canon.js / fleet lib (identical in base)
const { launch } = require(path.join(HARNESS, 'test/ultra/launch'));
const { instrument, SEED, fleetTruth } = require(path.join(HARNESS, 'test/ultra/canon'));
const FL = require(path.join(HARNESS, 'test/fleet/lib'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, 'load ');
const med = xs => { const v = xs.filter(x => x != null).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };
const tilde = p => String(p).split(HOME).join('~');
for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => { const l = `[${new Date().toISOString().slice(11, 23)}] ${a.join(' ')}`; console.log(l); fs.appendFileSync(path.join(OUT, 'recapture.log'), l + '\n'); };

// the fleet as held: member → session id, pid, registry; and a fingerprint of each pane (hash only, never its text)
const truth = fleetTruth(path.join(HARNESS, 'test/fleet/fleet.js'));
const M = Object.fromEntries((truth.members || []).map(m => [m.name, m]));
function fleetPrint() {
  const o = {};
  for (const m of truth.members || []) {
    if (!m.pid) continue;
    const r = FL.readRegistry(m.pid), pane = FL.capture(`vp-${m.name}:0.0`) || '';
    o[m.name] = { status: r?.status || null, waitingFor: r?.waitingFor || null, statusUpdatedAt: r?.statusUpdatedAt || null,
      pane: crypto.createHash('sha1').update(pane).digest('hex').slice(0, 12), dialog: /Do you want to proceed\?/.test(pane), select: /Enter to select/.test(pane) };
  }
  return o;
}

async function start(app, ud, extra = {}) {
  const t0 = Date.now(), v = await launch({ appDir: app, root: ROOT, userData: ud, state: SEED, env: { ANTHROPIC_API_KEY: '' }, ...extra });
  v.launchMs = Date.now() - t0;
  return v;
}
const rowsDom = v => v.win.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, sig: ['needs', 'stuck', 'ready', 'running', 'exited'].find(c => r.classList.contains(c)) || null,
  label: r.querySelector('.nm small')?.textContent || '', note: r.querySelector('.nnote')?.textContent || null, noteKind: r.querySelector('.nnote')?.className.replace('nnote', '').trim() || null,
  actions: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) })));
const nameOf = id => (truth.members || []).find(m => m.sessionId === id)?.name || id.slice(0, 8);

async function run() {
  const APP = path.resolve(arg('--app')), UD = path.resolve(arg('--userdata')), parts = String(arg('--parts', 'watch,pipe,verdict,hold')).split(',');
  let git = null; try { git = execFileSync('git', ['-C', APP, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim(); } catch {}
  const R = { app: APP, git, at: new Date().toISOString(), uptimeStart: uptime(), fleet: truth.members?.map(m => ({ name: m.name, state: m.state, inState: m.inState, paused: m.paused, registry: m.registry })), spend: truth.spend };
  const v = await start(APP, UD);
  R.launch = { ms: v.launchMs, readyMs: v.readyMs, uptime: uptime() };
  const has = await v.evalMain(() => ({ live: typeof globalThis.__vibepet.live === 'function', acts: Array.isArray(globalThis.__vibepet.acts) }));
  R.build = has;
  log(`app ${git} · live hook ${has.live} · ${R.launch.ms} ms to ready · ${R.launch.uptime}`);
  try {
    await v.evalMain(instrument);
    // renderer-side count of 'tick' snapshots (both builds): the base sends one every 3 s, the fix when a row changes or every 3 s
    await v.win.evaluate(() => { window.__lr = { ticks: [], results: [] }; window.pet.on('tick', () => window.__lr.ticks.push(Date.now())); window.pet.on('action-result', d => window.__lr.results.push({ t: Date.now(), ...d })); });

    if (parts.includes('watch')) {
      await sleep(4000);
      const a = has.live ? await v.evalMain(() => ({ live: globalThis.__vibepet.live(), ticks: globalThis.__vibepet.ticks() })) : null;
      const r0 = await v.win.evaluate(() => window.__lr.ticks.length), t0 = Date.now(), u0 = uptime();
      await sleep(30000);
      const b = has.live ? await v.evalMain(() => ({ live: globalThis.__vibepet.live(), ticks: globalThis.__vibepet.ticks() })) : null;
      const r1 = await v.win.evaluate(() => window.__lr.ticks.length), secs = (Date.now() - t0) / 1000;
      R.watch = { uptime: [u0, uptime()], secs,
        paths: a ? a.live.paths.map(tilde) : null, watching: a ? a.live.watching : 0,
        idle: { rendererSnapshots: r1 - r0, rendererPerSec: +((r1 - r0) / secs).toFixed(2),
          mainTicks: b ? b.ticks.n - a.ticks.n : null, mainTicksPerSec: b ? +((b.ticks.n - a.ticks.n) / secs).toFixed(2) : null,
          liveTicks: b ? b.ticks.fast - a.ticks.fast : null, watcherEvents: b ? b.live.events - a.live.events : null } };
      log(`watch: ${R.watch.watching} paths · idle ${secs.toFixed(0)} s: ${JSON.stringify(R.watch.idle)}`);
    }

    if (parts.includes('pipe') && has.live) {
      const lat = [], fast = [], u0 = uptime();
      for (let i = 0; i < 20; i++) {
        const r = await v.evalMain(async () => {
          const V = globalThis.__vibepet, t = Date.now(); V.poke();
          for (;;) { const k = V.ticks(); if (k.at >= t) return { ms: k.at + k.ms - t, tickMs: k.ms, fast: k.fast }; await new Promise(r => setTimeout(r, 5)); }
        });
        lat.push(r.ms); fast.push(r.tickMs); await sleep(700);
      }
      const render = await v.win.evaluate(async () => { const o = []; for (let i = 0; i < 10; i++) { const t = performance.now(); renderHome(); o.push(performance.now() - t); } return o; });
      await v.openHome().catch(() => {});
      await sleep(400);
      const renderOpen = await v.win.evaluate(async () => { const o = []; for (let i = 0; i < 10; i++) { const t = performance.now(); renderHome(); o.push(performance.now() - t); await new Promise(r => setTimeout(r, 20)); } return o; });
      await v.clickPet().catch(() => {}); await sleep(500);   // Home closed again
      R.pipe = { uptime: [u0, uptime()], pokeToTickDoneMs: lat, medianMs: med(lat), liveTickMs: fast, liveTickMedianMs: med(fast),
        renderHomeMs: renderOpen.map(x => +x.toFixed(2)), renderHomeMedianMs: +med(renderOpen).toFixed(2) };
      log(`pipe: poke → tick done median ${R.pipe.medianMs} ms (live tick ${R.pipe.liveTickMedianMs} ms) · renderHome ${R.pipe.renderHomeMedianMs} ms · ${R.pipe.uptime.join(' → ')}`);
    }

    if (parts.includes('verdict')) {
      if (await v.homeMode() !== 'now') await v.openHome();
      await sleep(1200);
      const before = fleetPrint();
      const CASES = [
        ['vibepet', { action: 'approve' }], ['vibepet', { action: 'interrupt' }], ['atlas', { action: 'approve' }],
        ['beacon', { action: 'deny' }], ['beacon', { action: 'option', key: '9' }],
        ['kestrel', { action: 'option', key: '2' }], ['kestrel', { action: 'text', text: 'hello from the recapture' }], ['kestrel', { action: 'interrupt' }],
      ];
      R.verdict = { uptime: [uptime()], cases: [] };
      const k0 = has.live ? await v.evalMain(() => globalThis.__vibepet.ticks()) : null, tk0 = Date.now();
      for (const [name, x] of CASES) {
        const id = M[name]?.sessionId; if (!id) { R.verdict.cases.push({ name, ...x, skipped: 'no session' }); continue; }
        const u = uptime();
        const res = await v.win.evaluate(async ([id, x]) => {
          const t = performance.now(), r = await window.pet.sendTo(id, x), ms = performance.now() - t;
          // the note in that session's row, as it reads <= 2 s after the call
          const want = r.ok ? r.note : r.why; let noteMs = null, note = null;
          for (const t1 = performance.now(); performance.now() - t1 < 2000;) {
            note = document.querySelector(`#now .nr[data-id="${id}"] .nnote`)?.textContent || null;
            if (note && note === want) { noteMs = performance.now() - t; break; }
            await new Promise(r => setTimeout(r, 16));
          }
          return { r, ms: Math.round(ms), note, noteMs: noteMs == null ? null : Math.round(noteMs) };
        }, [id, x]);
        const file = path.join(OUT, `verdict-${name}-${x.action}${x.key ? '-' + x.key : ''}.png`);
        await v.shot(file).catch(e => log('shot ' + e.message));
        R.verdict.cases.push({ name, ...x, result: res.r, ipcMs: res.ms, rowNote: res.note, rowNoteMs: res.noteMs, shot: path.basename(file), uptime: u });
        log(`verdict ${name} ${x.action}${x.key ? ' ' + x.key : ''}: ${JSON.stringify(res.r)} · ${res.ms} ms · row note ${res.noteMs == null ? 'NONE' : res.noteMs + ' ms'} · ${u}`);
        await sleep(600);
      }
      const k1 = has.live ? await v.evalMain(() => globalThis.__vibepet.ticks()) : null, secs = (Date.now() - tk0) / 1000;
      R.verdict.ticks = k1 ? { n: k1.n - k0.n, live: k1.fast - k0.fast, secs: +secs.toFixed(1), perSec: +((k1.n - k0.n) / secs).toFixed(2) } : null;
      await sleep(1500);
      const after = fleetPrint();
      R.verdict.fleetBefore = before; R.verdict.fleetAfter = after;
      R.verdict.fleetUnchanged = JSON.stringify(before) === JSON.stringify(after);
      R.verdict.acts = has.acts ? await v.evalMain(() => globalThis.__vibepet.acts.map(a => ({ ...a }))) : null;
      if (R.verdict.acts) for (const a of R.verdict.acts) a.name = a.name || nameOf(a.id);
      R.verdict.ipc = (await v.evalMain(() => globalThis.__canon.calls.filter(c => c.kind === 'ipc:send-to').map(c => ({ args: c.args, result: c.result, ms: c.ms })))).map(c => ({ ...c, member: nameOf(c.args[0]?.id || '') }));
      R.verdict.rendererResults = await v.win.evaluate(() => window.__lr.results);
      const acts = R.verdict.acts || [];
      R.verdict.summary = { calls: R.verdict.cases.length, logged: acts.length, unverifiedSuccesses: acts.filter(a => a.ok && a.verdict !== 'verified').length + (has.acts ? 0 : R.verdict.ipc.filter(c => c.result?.ok).length),
        okResults: R.verdict.ipc.filter(c => c.result?.ok).length, rowNoteMedianMs: med(R.verdict.cases.map(c => c.rowNoteMs)), rowNotesShown: R.verdict.cases.filter(c => c.rowNoteMs != null).length,
        ipcMedianMs: med(R.verdict.cases.map(c => c.ipcMs)), fleetUnchanged: R.verdict.fleetUnchanged };
      R.verdict.uptime.push(uptime());
      log(`verdict summary ${JSON.stringify(R.verdict.summary)}`);
    }

    if (parts.includes('hold') && has.live) {
      if (await v.homeMode() !== 'now') await v.openHome();
      await sleep(1000);
      // pause main's own 'tick' sends (the real state would re-render over the synthetic one); everything else passes
      await v.evalMain(() => { const wc = globalThis.__vibepet.win().webContents; if (!wc.__lrSend) { wc.__lrSend = wc.send.bind(wc); wc.send = (ch, ...a) => ch === 'tick' && globalThis.__lrPause ? undefined : wc.__lrSend(ch, ...a); } globalThis.__lrPause = true; });
      const s0 = await v.evalMain(() => globalThis.__vibepet.snapshot());
      const kid = M.kestrel?.sessionId, order0 = s0.agents.map(a => a.id);
      // kestrel approved: Claude Code now says busy; the queue moves it to the running group (last)
      const s1 = JSON.parse(JSON.stringify(s0)), k = s1.agents.find(a => a.id === kid);
      Object.assign(k, { phase: 'working', kind: 'running', since: Date.now(), ask: undefined, options: undefined });
      s1.agents = [...s1.agents.filter(a => a.id !== kid), k];
      const send = (ch, d) => v.evalMain((_, [ch, d]) => globalThis.__vibepet.win().webContents.__lrSend(ch, d), [ch, d]);
      const samples = [], t0 = Date.now(), u0 = uptime();
      const sample = async label => { const rows = await rowsDom(v); samples.push({ t: Date.now() - t0, label, order: rows.map(r => nameOf(r.id)), kestrel: rows.findIndex(r => r.id === kid), note: rows.find(r => r.id === kid)?.note || null }); };
      await sample('before');
      await send('action-result', { id: kid, text: 'Approving…', kind: '', phase: 'pending' }); await sample('pending');
      await send('tick', s1); await sample('snapshot: kestrel running');
      await send('action-result', { id: kid, text: 'Approved · kestrel running', kind: 'ok', phase: 'verdict' });
      const tv = Date.now(); await sample('verdict');
      await v.shot(path.join(OUT, 'hold-0.5s-verdict.png')).catch(() => {});
      for (let i = 0; i < 28; i++) {
        await sleep(250);
        if (i === 5) await send('action-result', { id: kid, text: './deploy.sh --dry-run ran · exit 0 · 3 lines', kind: 'ok', phase: 'outcome' });
        if (i === 8) await v.shot(path.join(OUT, 'hold-2s-outcome.png')).catch(() => {});
        if (i % 4 === 0) await send('tick', s1);   // the snapshot keeps arriving, as live ticks would
        await sample(`+${((Date.now() - tv) / 1000).toFixed(2)} s`);
      }
      await v.shot(path.join(OUT, 'hold-7s-moved.png')).catch(() => {});
      const held = samples.filter(s => s.t >= tv - t0 && s.kestrel === order0.indexOf(kid)), moved = samples.find(s => s.t > tv - t0 && s.kestrel === s.order.length - 1);
      R.hold = { uptime: [u0, uptime()], synthetic: 'renderer only: a copy of the real snapshot with kestrel set to running, sent through the test hook while main\'s own tick sends were paused',
        slotBefore: order0.indexOf(kid), heldFor: held.length ? held[held.length - 1].t - (tv - t0) : 0, movedAfterVerdictMs: moved ? moved.t - (tv - t0) : null, samples };
      await v.evalMain(() => { globalThis.__lrPause = false; return globalThis.__vibepet.tick(); });
      await sleep(800);
      R.hold.restored = (await rowsDom(v)).map(r => `${nameOf(r.id)}:${r.sig}`);
      log(`hold: slot ${R.hold.slotBefore} held ${R.hold.heldFor} ms after the verdict, moved at ${R.hold.movedAfterVerdictMs} ms · restored ${R.hold.restored.join(' ')}`);
    }
  } finally {
    const c = await v.close();
    R.close = { how: c.how, ms: c.ms, orphans: c.orphans.length };
    R.uptimeEnd = uptime();
    fs.writeFileSync(path.join(OUT, 'recapture.json'), JSON.stringify(R, null, 2));
    log(`closed ${c.how} ${c.ms} ms, ${c.orphans.length} orphans · ${R.uptimeEnd}`);
  }
}

// idle CPU: a fresh instance, Home closed, 15 s to settle, then the CPU time every process of it used in 60 s (ps cputime)
const cpuTime = pids => { if (!pids.length) return 0; const out = execFileSync('/bin/ps', ['-o', 'time=', '-p', pids.join(',')], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).reduce((s, l) => { const p = l.trim().split(':').map(Number); return s + (p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]); }, 0); };
async function cpu() {
  const [fix, base] = String(arg('--cpu')).split(',').map(p => path.resolve(p)), runs = +arg('--runs', 3), W = +arg('--window', 60);
  const R = { at: new Date().toISOString(), windowSec: W, runs: [] };
  for (let i = 1; i <= runs; i++) for (const [label, app] of i % 2 ? [['fix', fix], ['base', base]] : [['base', base], ['fix', fix]]) {
    const v = await start(app, path.join(HOME, '.vibepet-ultra', 'userdata', `r1-live-rows-cpu-${label}`));
    try {
      await sleep(15000);
      const pids = v.processes().map(p => p.pid), u0 = uptime(), c0 = cpuTime(pids), t0 = Date.now();
      const k0 = await v.evalMain(() => globalThis.__vibepet.ticks ? globalThis.__vibepet.ticks().n : null);
      await sleep(W * 1000);
      const c1 = cpuTime(pids), secs = (Date.now() - t0) / 1000, k1 = await v.evalMain(() => globalThis.__vibepet.ticks ? globalThis.__vibepet.ticks().n : null);
      const row = { run: i, label, procs: pids.length, cpuSec: +(c1 - c0).toFixed(2), secs: +secs.toFixed(1), cpuPct: +((c1 - c0) / secs * 100).toFixed(2), ticks: k0 == null ? null : k1 - k0, uptime: [u0, uptime()] };
      R.runs.push(row); log(`cpu ${label} #${i}: ${row.cpuPct}% of a core (${row.cpuSec} s CPU / ${row.secs} s, ${row.procs} procs, ticks ${row.ticks}) · ${row.uptime.join(' → ')}`);
    } finally { await v.close(); }
  }
  const m = l => med(R.runs.filter(r => r.label === l).map(r => r.cpuPct));
  R.median = { fix: m('fix'), base: m('base') }; R.deltaPoints = +(R.median.fix - R.median.base).toFixed(2);
  fs.writeFileSync(path.join(OUT, 'cpu.json'), JSON.stringify(R, null, 2));
  log(`cpu medians: fix ${R.median.fix}% · base ${R.median.base}% · delta ${R.deltaPoints} points`);
}

(arg('--cpu') ? cpu() : run()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
