// Phase B — F1 the realistic way: the vibepet fleet session itself starts a dev server (Bash, run_in_background), the
// approval is answered in its pane, then: when does Home show the server, how is it labelled, is it tied to the
// session? Then F2 on it: Open (URL recorded, then fetched by us), ✕ Stop (dialog answered Stop) → exactly that pid
// dies, the claude session survives, feedback.
'use strict';
const fs = require('fs'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const L = require('./lib');
const { sleep } = L;
const INT = L.INT, PORT = 47120;
const fleet = (...a) => spawnSync(process.execPath, [INT + '/test/fleet/fleet.js', ...a], { cwd: INT, encoding: 'utf8', timeout: 120e3 });
const regOf = pid => { try { return JSON.parse(fs.readFileSync(`/Users/christopherharris/.vibepet-ultra/root/.claude/sessions/${pid}.json`, 'utf8')); } catch { return null; } };
async function connectable(port) { const r = await L.get(`http://127.0.0.1:${port}/`, 400); return !r.error; }
(async () => {
  const truth0 = L.fleetTruth();
  const vm = truth0.members.find(m => m.name === 'vibepet');
  console.log('vibepet truth', JSON.stringify(vm));
  if (!vm || !vm.ok || !vm.pid) { console.log('vibepet not in its done state; abort'); process.exit(2); }
  const lease = fleet('lease', 'vibepet', 'r1-S6', '--ttl', '900'); console.log(lease.stdout.trim(), lease.stderr.trim());
  if (!/taken|renewed|broke/.test(lease.stdout)) { console.log('lease not taken; abort'); process.exit(2); }
  const ctx = await L.start({ phase: 'B' });
  const { R } = ctx; R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  const claudePid = vm.pid;
  try {
    await ctx.openHome(); await sleep(800);
    await ctx.shot('F1s', 'home-before-ask');
    // 1. ask the session to start its dev server
    const prompt = 'Serve this folder so I can browse it: use the Bash tool with run_in_background set to true to run exactly `python3 -m http.server ' + PORT + ' --bind 127.0.0.1`. Do not run anything else. Once it has started, reply with one plain sentence (a statement, not a question).';
    const sendAt = Date.now();
    const s = fleet('send', 'vibepet', prompt, '--as', 'r1-S6'); console.log('send', s.status, s.stdout.trim(), s.stderr.trim());
    if (s.status !== 0) throw new Error('send failed');
    R.sendAt = sendAt;
    // 2. wait for its permission prompt (registry), answer it in the pane (Enter = the highlighted "Yes")
    let reg, t0 = Date.now(), dialogAt = null;
    while (Date.now() - t0 < 90e3) { reg = regOf(claudePid); if (reg && reg.status === 'waiting') { dialogAt = Date.now(); break; } if (await connectable(PORT)) break; await sleep(250); }
    ctx.note({ step: 'registry before approve', reg: reg && { status: reg.status, waitingFor: reg.waitingFor } , msSinceSend: Date.now() - sendAt });
    if (dialogAt) {
      await sleep(1500);
      await ctx.shot('F1s', 'session-asks-permission');
      const p = spawnSync(process.execPath, [INT + '/test/fleet/probe.js', 'vibepet', '--keys', 'Enter', '--secs', '2', '--label', 'r1s6-approve'], { cwd: INT, encoding: 'utf8', timeout: 60e3 });
      ctx.note({ step: 'approved in pane', code: p.status, out: (p.stdout || '').slice(-200), err: (p.stderr || '').slice(-200) });
    }
    // 3. the server comes up (we only observe: poll-connect)
    let listenAt = null; t0 = Date.now();
    while (Date.now() - t0 < 60e3) { if (await connectable(PORT)) { listenAt = Date.now(); break; } await sleep(50); }
    if (!listenAt) throw new Error('the session never started its server');
    const ls = L.listeners(PORT); R.sessionServer = { port: PORT, listenAt, listeners: ls };
    // whose child is it? (ppid chain up to the claude pid)
    const chain = []; try { let p = ls[0].pid; for (let k = 0; k < 6 && p > 1; k++) { const o = execFileSync('/bin/ps', ['-o', 'ppid=,comm=', '-p', String(p)], { encoding: 'utf8' }).trim().match(/^(\d+)\s+(.*)$/); chain.push({ pid: p, comm: o && o[2].split('/').pop() }); if (!o || p === claudePid) break; p = +o[1]; } } catch {}
    R.sessionServer.chain = chain;
    ctx.note({ step: 'session server listening', listenAt: L.iso(listenAt), listeners: ls, chain });
    const shown = await ctx.waitFooter(f => f.some(x => x.port === PORT), listenAt, 60e3);
    ctx.timing('F1', 'session-started server listening → shown in Home localhost (vibepet session, python http.server, bg Bash)', shown ? shown.at - listenAt : null, { n: 1, port: PORT });
    R.sessionServer.label = shown && shown.srv.find(x => x.port === PORT);
    await sleep(600);
    await ctx.shot('F1s', 'session-server-shown');
    // 4. the session's turn ends: the row vs the server chip
    t0 = Date.now(); while (Date.now() - t0 < 60e3) { reg = regOf(claudePid); if (reg && reg.status === 'idle') break; await sleep(500); }
    ctx.note({ step: 'registry after turn', reg: reg && { status: reg.status, waitingFor: reg.waitingFor } });
    await sleep(4000);   // a tick or two for the row
    await ctx.shot('F1s', 'turn-done-row-and-chip');
    // 5. the native Localhost submenu (⋯ → Localhost): servers + background tasks
    const menu = await ctx.menu();
    R.menuAfterStart = menu; ctx.note({ step: 'menu', localhost: menu && menu.localhost });
    // 6. F2: Open → the URL; does it reach this server?
    let since = Date.now();
    await ctx.v.win.click(`#now .srv[data-port="${PORT}"] button[data-do=open]`);
    await sleep(400);
    const opens = await ctx.calls(since, 'openExternal');
    const url = opens[0] && opens[0].url; const got = url ? await L.get(url) : null;
    ctx.note({ step: 'F2 open', url, fetched: got && { status: got.status, remote: got.remote, body: (got.body || '').slice(0, 80) } });
    R.open = { url, got, clickToCallMs: opens[0] ? opens[0].at - since : null };
    ctx.timing('F2', 'click Open → shell.openExternal called', opens[0] ? opens[0].at - since : null, { n: 1 });
    // 7. F2: ✕ Stop → confirm dialog (answered Stop) → that pid dies, claude lives
    const victim = ls[0].pid;
    await ctx.setAnswer(0);
    since = Date.now();
    await ctx.v.win.click(`#now .srv[data-port="${PORT}"] button[data-do=stop]`);
    const deadAt = await L.waitDead(victim, 10e3);
    const dlg = (await ctx.calls(since, 'dialog'))[0];
    const gone = await ctx.waitFooter(f => !f.some(x => x.port === PORT), since, 30e3);
    await sleep(300);
    const shotStop = await ctx.shot('F2s', 'after-stop');
    const evs = (await ctx.calls(since, 'event')).map(c => ({ at: c.at, ...c.data }));
    R.stop = { victim, dialog: dlg, deadMs: deadAt ? deadAt - since : null, goneMs: gone ? gone.at - since : null, events: evs, claudeAlive: L.alive(claudePid), view: shotStop.view };
    ctx.timing('F2', 'click ✕ (dialog answered Stop) → server process dead', R.stop.deadMs, { n: 1, port: PORT });
    ctx.timing('F2', 'click ✕ (dialog answered Stop) → chip gone from Home', R.stop.goneMs, { n: 1, port: PORT });
    ctx.note({ step: 'F2 stop', dialog: dlg, deadMs: R.stop.deadMs, goneMs: R.stop.goneMs, events: evs, claudeAlive: R.stop.claudeAlive, bubble: shotStop.view.bubble });
    // 8. the session after its server was killed: does it take a turn (task notification)?
    t0 = Date.now(); let saw = []; while (Date.now() - t0 < 45e3) { reg = regOf(claudePid); const k = reg && reg.status; if (k && saw[saw.length - 1] !== k) saw.push(k); await sleep(500); }
    ctx.note({ step: 'registry after stop (45 s)', statuses: saw });
    await ctx.shot('F2s', 'session-after-stop');
  } catch (e) { console.error('PHASE B ERROR', e); R.error = String(e.stack || e); }
  finally {
    // our cleanup: nothing of ours should listen on PORT now; never touch anything else
    const left = L.listeners(PORT); R.leftOnPort = left;
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close), 'left on port', JSON.stringify(left));
    console.log('vibepet after', JSON.stringify(R.truth1.members && R.truth1.members.find(m => m.name === 'vibepet')));
    process.exit(0);
  }
})();
