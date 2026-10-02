#!/usr/bin/env node
// tmux-reach recapture driver — evidence only (docs/ultra/round-1/fixes/tmux-reach/after/), never committed.
// The real vibepet from the tmux-reach worktree (test/ultra/launch.js, isolated fleet root, userData r1-tmux-reach), canon's
// instrumentation (clipboard/openExternal recorded, jump + send-to spied), against the live fleet:
//   --phase attached  one Terminal.app window holds a read-only tmux client: hotkey walk, /jump <member>, row clicks × rounds
//   --phase detached  no client attached: row clicks × rounds, /jump <member>
//   --phase guard     send-to that must be refused (vibepet idle, beacon's AskUserQuestion): screen, transcript, registry unchanged
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const WT = '/Users/christopherharris/.vibepet-ultra/wt/r1-tmux-reach', ULTRA = path.join(os.homedir(), '.vibepet-ultra');
const ROOT = path.join(ULTRA, 'root', '.claude'), TMUX = '/opt/homebrew/bin/tmux';
const SP = '/private/tmp/claude-501/-Users-christopherharris-projects/2aec191f-bd46-4d22-b2da-e8c859fd18a3/scratchpad';
const { launch } = require(WT + '/test/ultra/launch');
const { instrument, SEED } = require(WT + '/test/ultra/canon');
const phase = arg('--phase'), OUT = path.resolve(arg('--out')), rounds = +arg('--rounds', 3);
const ORDER = ['kestrel', 'beacon', 'vibepet', 'atlas', 'delta'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sh = (f, a) => { try { return execFileSync(f, a, { encoding: 'utf8', timeout: 10e3, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };
const load = () => os.loadavg().map(x => +x.toFixed(2));
const uptime = () => sh('/usr/bin/uptime', []);
const front = () => (sh('/bin/sh', ['-c', 'lsappinfo info -only bundleid "$(lsappinfo front)"']) || '').replace(/^.*="?([^"]*)"?$/, '$1');
const clients = () => (sh(TMUX, ['list-clients', '-F', '#{client_tty} #{client_pid} #{client_flags} #{client_session}']) || '').split('\n').filter(Boolean)
  .map(l => { const [tty, pid, flags, ...s] = l.split(' '); return { tty, pid: +pid, flags, session: s.join(' ') }; });
const shows = tty => sh(TMUX, ['display', '-p', '-c', tty, '#{session_name} #{window_id} #{pane_id}']);
const want = t => { const m = String(t || '').match(/^(.+):(@\d+)\.(%\d+)$/); return m ? `${m[1]} ${m[2]} ${m[3]}` : null; };
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
// the live fleet as its registries say (the fleet's own symlinks under the isolated root)
function fleet() {
  const m = {};
  for (const f of fs.readdirSync(path.join(ROOT, 'sessions'))) {
    try { const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'sessions', f), 'utf8')); process.kill(r.pid, 0);
      m[path.basename(r.cwd)] = { pid: r.pid, sessionId: r.sessionId, tmux: r.tmux, status: r.status, waitingFor: r.waitingFor || null, statusUpdatedAt: r.statusUpdatedAt }; } catch {}
  }
  return m;
}
const transcript = sid => { for (const d of fs.readdirSync(path.join(ROOT, 'projects'))) { const f = path.join(ROOT, 'projects', d, sid + '.jsonl'); if (fs.existsSync(f)) return f; } return null; };
const tstat = sid => { const f = transcript(sid); if (!f) return null; const b = fs.readFileSync(f); return { bytes: b.length, records: b.toString('utf8').split('\n').filter(Boolean).length, mtimeMs: fs.statSync(f).mtimeMs }; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const F = fleet(), bySid = Object.fromEntries(Object.entries(F).map(([n, m]) => [m.sessionId, n]));
  const R = { phase, startedAt: new Date().toISOString(), uptimeStart: uptime(), fleet: F, clientsAtStart: clients(), terminalWindows: JSON.parse(sh(SP + '/tools/winlist', ['Terminal']) || '[]').length, trials: [], notes: [] };
  R.git = sh('git', ['-C', WT, 'log', '-1', '--format=%h %s']); R.worktreeDiff = sh('git', ['-C', WT, 'diff', '--stat']);
  const v = await launch({ appDir: WT, root: ROOT, userData: path.join(ULTRA, 'userdata', 'r1-tmux-reach'), state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  R.launch = { pid: v.pid, readyMs: v.readyMs };
  try {
    await v.evalMain(instrument);
    const calls = () => v.evalMain(() => globalThis.__canon.calls);
    const since = async (t, kind) => (await calls()).filter(c => c.at >= t && (!kind || c.kind === kind));
    const waitCall = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = await since(t, kind); if (c.length) return c[0]; if (Date.now() > end) return null; await sleep(20); } };
    // may this instance send Apple Events to Terminal? (asked without prompting: 0 yes, -1743 no, -1744 undecided = a real call would prompt)
    R.aeTerminal = await v.evalMain((_, p) => { try { return globalThis.__vibepet.require('child_process').execFileSync(p, ['com.apple.Terminal'], { encoding: 'utf8' }).trim(); } catch (e) { return 'err ' + e.message.split('\n')[0]; } }, SP + '/tools/aecheck');
    if ((phase === 'attached' || phase === 'hotkey') && R.aeTerminal !== '0' && R.aeTerminal !== '-1743') {
      // Undecided: focusTty's osascript would put a macOS consent prompt on the user's screen. Answer it the way a denied
      // permission does (osascript fails, -1743) so the jump takes its own fallback (open -b: Terminal comes forward), and count it.
      R.notes.push(`Apple Events to Terminal undecided from this instance (${R.aeTerminal}): osascript calls aimed at Terminal answer as a denied permission (-1743), no consent prompt is shown; the raise is the jump's own 'open -b' fallback`);
      await v.evalMain(() => {
        const cp = globalThis.__vibepet.require('child_process'), proto = cp.ChildProcess.prototype, orig = proto.spawn;
        globalThis.__aeDenied = [];
        proto.spawn = function (o) {
          if (o && o.file === '/usr/bin/osascript' && (o.args || []).some(a => /application id "com\.apple\.Terminal"/.test(String(a)))) {
            globalThis.__aeDenied.push(Date.now());
            o = { ...o, file: '/bin/sh', args: ['/bin/sh', '-c', 'echo "execution error: Not authorized to send Apple events to Terminal. (-1743)" >&2; exit 1'] };
          }
          return orig.call(this, o);
        };
      });
    }
    const W = v.win;
    const ensureHome = async () => { if (!(await v.homeMode())) await v.openHome(); };
    if (phase === 'hotkey') await sleep(3500); else { await v.openHome(); await sleep(3500); }
    R.rows = await W.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, cls: r.className, title: r.querySelector('.nm b')?.textContent,
      label: r.querySelector('.nm small')?.textContent, actions: [...r.querySelectorAll('.nb button[data-do]')].map(b => b.dataset.do) })));
    for (const r of R.rows) r.member = bySid[r.id] || null;
    await v.shot(path.join(OUT, 'home.png'));
    async function trial(how, member, act) {
      const t0 = Date.now();
      await act();
      const c = await waitCall(t0, 'ipc:jump');
      await sleep(250);   // the raise settles before the frontmost app is read
      const jumped = c ? bySid[c.args[0]] || c.args[0] : null, cl = clients();
      const rec = { how, asked: member, jumped, result: c ? c.result : null, handlerMs: c ? c.ms : null, clickToResultMs: c ? c.at - t0 : null, load: load(),
        target: want(F[jumped]?.tmux), clients: cl.map(x => ({ tty: x.tty, shows: shows(x.tty) })), front: front(), clipboardWrites: (await since(t0, 'clipboard')).length };
      rec.paneMatches = rec.clients.length ? rec.clients.every(x => x.shows === rec.target) : null;
      R.trials.push(rec);
      console.log(`${how} ${member || ''} → ${jumped}: ${JSON.stringify(rec.result)} ${rec.clickToResultMs} ms, shows ${rec.clients.map(x => x.shows).join('|') || '-'}, front ${rec.front}, clip ${rec.clipboardWrites}, load ${rec.load[0]}`);
      return rec;
    }
    const rowClick = async m => { await ensureHome(); const sel = `#now .nr[data-id="${F[m].sessionId}"] .nm`; await W.locator(sel).scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); return trial('row', m, () => W.locator(sel).click()); };
    const slashJump = async m => { await ensureHome(); return trial('/jump', m, async () => { await W.locator('#chatInput').fill('/jump ' + m); await W.locator('#chatInput').press('Enter'); }); };
    const hotkey = () => trial('hotkey', null, () => v.evalMain(() => { const w = globalThis.__vibepet.win(); if (!w.isVisible()) w.showInactive(), w.webContents.send('summon'); w.webContents.send('hotkey'); }));

    if (phase === 'hotkey') {   // Home never opened (clicking Net marks done rows seen): the jump key walks every row in line
      R.pendingAtStart = (await W.evaluate(() => pending().map(a => a.id))).map(id => bySid[id] || id);
      await v.shot(path.join(OUT, 'before-hotkey.png'));
      for (let i = 0; i < R.pendingAtStart.length; i++) { await hotkey(); await sleep(700); }
      await v.shot(path.join(OUT, 'after-hotkey.png'));
      R.aeDenied = await v.evalMain(() => (globalThis.__aeDenied || []).length);
    }
    if (phase === 'attached' || phase === 'detached') {
      if (phase === 'attached') {   // the jump key first, on a fresh instance: its walk is a snapshot of pending() (done rows still unseen)
        R.pendingAtStart = (await W.evaluate(() => pending().map(a => a.id))).map(id => bySid[id] || id);
        for (let i = 0; i < R.pendingAtStart.length; i++) { await hotkey(); await sleep(700); }
        await v.shot(path.join(OUT, 'after-hotkey.png'));
      }
      for (const m of ORDER) { await slashJump(m); await sleep(500); }
      await v.shot(path.join(OUT, 'after-slash-jump.png'));
      for (let r = 0; r < rounds; r++) for (const m of ORDER) { const rec = await rowClick(m); if (r === 0) await v.shot(path.join(OUT, `row-${m}.png`)); await sleep(400); }
      if (phase === 'detached') { await hotkey(); await v.shot(path.join(OUT, 'after-hotkey.png')); }
      R.aeDenied = phase === 'attached' ? await v.evalMain(() => (globalThis.__aeDenied || []).length) : undefined;
    }

    if (phase === 'guard') {
      const pane = m => want(F[m].tmux).split(' ')[2];
      const cap = m => ({ plain: sh(TMUX, ['capture-pane', '-p', '-t', pane(m)]), esc: sh(TMUX, ['capture-pane', '-p', '-e', '-t', pane(m)]) });
      const reg = m => { try { const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'sessions', F[m].pid + '.json'), 'utf8')); return { status: r.status, waitingFor: r.waitingFor || null, statusUpdatedAt: r.statusUpdatedAt }; } catch { return null; } };
      const GM = ['vibepet', 'beacon'], before = {};
      for (const m of GM) before[m] = { screen: cap(m), transcript: tstat(F[m].sessionId), registry: reg(m) };
      fs.writeFileSync(path.join(OUT, 'screens-before.json'), JSON.stringify(Object.fromEntries(GM.map(m => [m, before[m].screen])), null, 1));
      const sendTo = (id, x) => W.evaluate(([id, x]) => window.pet.sendTo(id, x), [id, x]);
      const cases = [
        ['vibepet', null, 'approve, as Approve sends it today (text null)'], ['vibepet', { action: 'approve' }], ['vibepet', { action: 'always' }], ['vibepet', { action: 'deny' }],
        ['vibepet', { action: 'interrupt' }], ['vibepet', { action: 'option', key: '1' }],
        ['beacon', 'SQLite', 'a text reply, as the Reply form sends it today (a string)'], ['beacon', { action: 'text', text: 'Postgres' }], ['beacon', { action: 'approve' }],
        ['beacon', { action: 'deny' }], ['beacon', { action: 'option', key: '9' }], ['beacon', { action: 'interrupt' }],
      ];
      R.sendTo = [];
      for (const [m, x, note] of cases) {
        const t0 = Date.now(), r = await sendTo(F[m].sessionId, x), c = await waitCall(t0, 'ipc:send-to', 5000);
        const rec = { member: m, sent: x, note, result: r, handlerMs: c ? c.ms : null, callToResultMs: c ? c.at - t0 : null, load: load() };
        R.sendTo.push(rec); console.log(`send-to ${m} ${JSON.stringify(x)} → ${JSON.stringify(r)} (${rec.callToResultMs} ms)`);
        await sleep(150);
      }
      // the real Reply flow on beacon's row: Reply → type → Send → the panel's note
      await ensureHome();
      const row = `#now .nr[data-id="${F.beacon.sessionId}"]`;
      if (await W.locator(`${row} button[data-do=reply]`).count()) {
        await W.locator(`${row} button[data-do=reply]`).click();
        await W.locator(`${row} form.nrep input`).fill('SQLite');
        await v.shot(path.join(OUT, 'beacon-reply-form.png'));
        const t0 = Date.now();
        await W.locator(`${row} form.nrep button`).click();
        const c = await waitCall(t0, 'ipc:send-to', 5000);
        await sleep(400);
        const note = await W.evaluate(() => { const n = [...document.querySelectorAll('#msgs .msg.note')]; return n.length ? n[n.length - 1].textContent : null; });
        await v.shot(path.join(OUT, 'beacon-reply-refused.png'));
        R.replyUi = { result: c ? c.result : null, clickToResultMs: c ? c.at - t0 : null, note, load: load() };
        console.log('reply UI →', JSON.stringify(R.replyUi));
      } else R.replyUi = { none: 'beacon row offers no Reply' };
      await sleep(1500);
      R.guard = {};
      const after = {};
      for (const m of GM) {
        after[m] = { screen: cap(m), transcript: tstat(F[m].sessionId), registry: reg(m) };
        R.guard[m] = { screenPlainSame: before[m].screen.plain === after[m].screen.plain, screenEscSame: before[m].screen.esc === after[m].screen.esc,
          transcript: { before: before[m].transcript, after: after[m].transcript, newRecords: after[m].transcript.records - before[m].transcript.records, bytes: after[m].transcript.bytes - before[m].transcript.bytes },
          registry: { before: before[m].registry, after: after[m].registry, same: JSON.stringify(before[m].registry) === JSON.stringify(after[m].registry) } };
      }
      fs.writeFileSync(path.join(OUT, 'screens-after.json'), JSON.stringify(Object.fromEntries(GM.map(m => [m, after[m].screen])), null, 1));
      R.keysTyped = 0;   // every case above was refused before send-keys (see results); the screens prove nothing landed
      console.log('guard', JSON.stringify(R.guard));
    }
    R.clipboard = (await calls()).filter(c => c.kind === 'clipboard').length;
    R.openExternal = (await calls()).filter(c => c.kind === 'openExternal').map(c => c.url);
  } finally {
    R.close = await v.close();
    R.uptimeEnd = uptime();
    const by = how => R.trials.filter(t => t.how === how);
    R.summary = Object.fromEntries(['hotkey', '/jump', 'row'].filter(h => by(h).length).map(h => [h, {
      n: by(h).length, ok: by(h).filter(t => t.result?.ok).length, levels: [...new Set(by(h).map(t => t.result?.level || t.result?.why))],
      medianClickToResultMs: med(by(h).map(t => t.clickToResultMs)), maxClickToResultMs: Math.max(...by(h).map(t => t.clickToResultMs ?? Infinity)),
      paneMatches: by(h).filter(t => t.paneMatches).length, terminalFront: by(h).filter(t => t.front === 'com.apple.Terminal').length,
      clipboardWrites: by(h).reduce((s, t) => s + t.clipboardWrites, 0),
      perMember: Object.fromEntries(ORDER.map(m => [m, { n: by(h).filter(t => t.jumped === m).length, medianMs: med(by(h).filter(t => t.jumped === m).map(t => t.clickToResultMs)) }])) }]));
    fs.writeFileSync(path.join(OUT, 'recap.json'), JSON.stringify(R, null, 1));
    console.log('summary', JSON.stringify(R.summary, null, 1), 'close', JSON.stringify(R.close));
  }
})().catch(e => { console.error(e); process.exit(1); });
