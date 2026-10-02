#!/usr/bin/env node
// session-console recapture: the command bar as a session console, against the LIVE fleet, $0. Runs the worktree's app through
// test/ultra/launch.js (isolated root, userData ~/.vibepet-ultra/userdata/r1-session-console). jump / send-to are the real ones
// (canon's instrument records each call): a jump with no tmux client attached only says so, and the one send-to (/approve vibepet,
// under vibepet's lease) is refused by tmux.js on vibepet's screen before any key. Writes after/*.png + after/recapture.json.
//   node docs/ultra/round-1/fixes/session-console/recapture.js [--repeat 3]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), WT = path.join(ULTRA, 'wt/r1-session-console');
const OUT = path.join(__dirname, 'after'), UD = path.join(ULTRA, 'userdata/r1-session-console'), ROOT = path.join(ULTRA, 'root/.claude');
const { launch } = require(path.join(WT, 'test/ultra/launch'));
const { instrument, SEED, fleetTruth } = require(path.join(WT, 'test/ultra/canon'));
const { screenState } = require(path.join(WT, 'tmux'));
const FLEET = path.join(WT, 'test/fleet/fleet.js'), OWNER = 'r1-session-console';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, 'load ');
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const REPEAT = +(process.argv[process.argv.indexOf('--repeat') + 1] || 3) || 3;
const J = { startedAt: new Date().toISOString(), app: WT, userData: UD, checks: [], timings: {}, uptime: [], skipped: [] };
const check = (id, ok, detail) => { J.checks.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}${ok ? '' : ' ' + JSON.stringify(detail).slice(0, 400)}`); return !!ok; };
const time = (k, ms) => { (J.timings[k] ||= []).push({ ms, at: uptime() }); return ms; };
const tmuxBin = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(p => fs.existsSync(p));
const pane = name => execFileSync(tmuxBin, ['capture-pane', '-p', '-e', '-t', `vp-${name}`], { encoding: 'utf8' });   // a fleet pane only (vp-*)
const fleet = (...a) => { try { return execFileSync(process.execPath, [FLEET, ...a], { encoding: 'utf8', timeout: 60e3 }).trim(); } catch (e) { return String(e.stdout || e.message).trim(); } };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  J.fleet = fleetTruth(FLEET);
  const M = n => (J.fleet.members || []).find(m => m.name === n) || {}, sid = n => M(n).sessionId;
  J.uptime.push(['launch', uptime()]);
  const v = await launch({ appDir: WT, root: ROOT, userData: UD, state: { ...SEED, goals: {} }, env: { ANTHROPIC_API_KEY: '' } });
  const W = v.win, inp = W.locator('#chatInput');
  J.pageErrors = []; W.on('pageerror', e => J.pageErrors.push(e.message)); W.on('console', m => { if (m.type() === 'error') J.pageErrors.push(m.text().slice(0, 200)); });
  const calls = async (t, kind) => (await v.evalMain(() => globalThis.__canon.calls)).filter(c => c.at >= t && (!kind || c.kind === kind));
  const waitCall = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = await calls(t, kind); if (c.length) return c[0]; if (Date.now() > end) return null; await sleep(40); } };
  const st = () => W.evaluate(() => { const c = document.getElementById('chatInput'), m = document.getElementById('slash');
    return { value: c.value, sel: c.value.slice(c.selectionStart, c.selectionEnd), focused: document.activeElement === c, home: !document.getElementById('chat').classList.contains('hidden'),
      menu: m.classList.contains('hidden') ? null : { items: [...m.querySelectorAll('button[data-i]')].map(b => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), on: b.classList.contains('on'), cmd: b.dataset.cmd || null })), foot: m.querySelector('small')?.textContent || '' } }; });
  const notes = () => W.evaluate(() => [...document.querySelectorAll('#msgs .msg.note')].map(n => n.textContent.trim()));
  const newNote = async (n0, ms = 8000) => { const end = Date.now() + ms; for (;;) { const n = await notes(); if (n.length > n0) return n[n.length - 1]; if (Date.now() > end) return null; await sleep(40); } };
  const typeIn = async s => { await inp.fill(''); await inp.pressSequentially(s, { delay: 12 }); };
  const shot = f => v.shot(path.join(OUT, f));
  const menuShown = (ms = 4000) => W.waitForSelector('#slash:not(.hidden)', { timeout: ms }).then(() => true).catch(() => false);
  try {
    J.instrument = await v.evalMain(instrument);
    await v.evalMain(({ ipcMain }) => { const C = globalThis.__canon; ipcMain.on('set-goal', (_, x) => C.calls.push({ kind: 'ipc:set-goal', at: Date.now(), args: [x] })); });
    const h = await v.openHome(); await sleep(3300);
    J.home = { mode: h.mode, ms: h.ms, at: uptime() };
    J.rows = await W.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, title: r.querySelector('.nm b')?.textContent, label: r.querySelector('.nm small')?.textContent })));
    await shot('00-home.png');

    // ---------- the menu's own cost in the renderer (no harness round trip): compute + draw, 10 runs each ----------
    J.renderMs = await W.evaluate(() => Object.fromEntries(['/', '/replay ', '/jump kest', '@', '/answer beacon '].map(v => {
      const a = []; for (let i = 0; i < 10; i++) { const t = performance.now(); slashHint(v); a.push(performance.now() - t); }
      a.sort((x, y) => x - y); showMenu(null); return [v, +((a[4] + a[5]) / 2).toFixed(2)]; })));
    J.renderMs.at = uptime();

    // ---------- '/' lists every command, keyboard-driven ----------
    for (let i = 0; i < REPEAT; i++) { await inp.fill(''); const t = Date.now(); await inp.press('/'); await menuShown(); time('slashMenuMs', Date.now() - t); }
    let s = await st();
    J.slash = s.menu;
    check("'/' opens the list: every command, the first highlighted", s.menu && s.menu.items.length === 15 && s.menu.items[0].on && ['/approve', '/always', '/deny', '/answer', '/reply', '/interrupt', '/new'].every(c => s.menu.items.some(x => x.cmd === c)), s.menu && s.menu.items.map(x => x.cmd));
    await shot('01-slash-list.png');
    await inp.press('Enter'); await sleep(250);
    s = await st();
    check("'/' ⏎ keeps the list open (no 'Unknown command /.')", s.value === '/' && s.menu && !(await notes()).some(n => /Unknown command \/\./.test(n)), { value: s.value, menu: !!s.menu });
    await inp.fill(''); await inp.press('/'); await menuShown();
    await inp.press('ArrowDown'); await inp.press('ArrowDown');
    s = await st(); const third = s.menu.items.findIndex(x => x.on);
    await shot('02-slash-down-down.png');
    await inp.press('Enter'); await sleep(300);
    const s3 = await st();
    J.downDownEnter = { highlighted: s.menu.items[third], after: s3 };
    check("'/' ↓ ↓ ⏎ acts on the third command (/approve: it takes a session, so ⏎ completes it and opens its session picker)", third === 2 && s.menu.items[2].cmd === '/approve' && s3.value === '/approve ' && s3.menu?.items[0]?.text.startsWith('kestrel'), J.downDownEnter);
    await shot('03-approve-picker.png');

    // ---------- '/jump kest' Tab → '/jump kestrel', ⏎ → the jump IPC for kestrel ----------
    for (let i = 0; i < REPEAT; i++) {
      await typeIn('/jump kest'); await menuShown();
      const t0 = Date.now(); await inp.press('Tab'); await W.waitForFunction(() => document.getElementById('chatInput').value === '/jump kestrel', null, { timeout: 3000 }).catch(() => {});
      time('tabCompleteMs', Date.now() - t0);
      s = await st();
      if (i === 0) { check("'/jump kest' + Tab completes to '/jump kestrel'", s.value === '/jump kestrel', s); await shot('04-jump-kest-tab.png'); }
      const n0 = (await notes()).length, t1 = Date.now();
      await inp.press('Enter');
      const c = await waitCall(t1, 'ipc:jump'); time('jumpIpcMs', c?.ms ?? null);
      const note = await newNote(n0, 4000);
      if (i === 0) { J.jump = { call: c && { args: c.args, result: c.result, ms: c.ms }, note }; check('⏎ jumps: the jump IPC carries kestrel\'s id (no tmux client attached: main says why, the note shows it)', c && c.args[0] === sid('kestrel'), J.jump); await shot('05-jump-kestrel-enter.png'); }
      await inp.fill('');
    }

    // ---------- '/rep' Tab → '/replay ' + a session picker; '@' → the same picker ----------
    await typeIn('/rep'); await menuShown(); await inp.press('Tab'); await sleep(250);
    s = await st();
    check("'/rep' + Tab → '/replay ' and a session picker (live + recent)", s.value === '/replay ' && s.menu && s.menu.items.length >= 3 && s.menu.items.some(x => x.text.startsWith('ember')), { value: s.value, items: s.menu?.items.map(x => x.text) });
    J.replayPicker = s.menu;
    await shot('06-rep-tab-picker.png');
    await typeIn('@'); await menuShown(); await sleep(150);
    s = await st();
    check("'@' opens the session picker (live sessions)", s.menu && s.menu.items.length >= 2 && s.menu.items[0].on, s.menu?.items.map(x => x.text));
    J.atPicker = s.menu;
    await shot('07-at-picker.png');
    await typeIn('@kestrel '); await sleep(250); s = await st();
    check("'@kestrel ' offers its dialog's choices (approve / always / deny)", JSON.stringify(s.menu?.items.map(x => x.text.split(' ')[0])) === '["approve","always","deny"]', s.menu?.items);
    await shot('08-at-kestrel-choices.png');
    await typeIn('/answer beacon '); await sleep(250); s = await st();
    check("'/answer beacon ' offers beacon's options", s.menu && s.menu.items.length === 3 && /Postgres/.test(s.menu.items[1].text), s.menu?.items);
    await shot('09-answer-beacon-options.png');

    // ---------- Esc closes the menu first; the next Esc closes Home ----------
    await typeIn('/rep'); await menuShown();
    await inp.press('Escape'); await sleep(200);
    const e1 = await st();
    await shot('10-esc-closes-menu.png');
    await inp.press('Escape'); await sleep(300);
    const e2 = { home: !!(await v.homeMode()) };
    check('Esc closes only the menu (Home and the draft stay); a second Esc closes Home', !e1.menu && e1.home && e1.value === '/rep' && !e2.home, { first: e1, second: e2 });
    await shot('11-esc-esc-closes-home.png');
    await v.openHome(); await sleep(400); await inp.fill('');

    // ---------- several matches are listed, never acted on ----------
    const q = await W.evaluate(() => { for (const c of 'aeiorstn') { const h = CmdBar.resolve(c, CmdBar.sessions(snap.agents, [])); if (h.length === 3) return c; } return 'a'; });
    const hitsQ = await W.evaluate(c => CmdBar.resolve(c, CmdBar.sessions(snap.agents, [])).map(s => s.name), q);
    let n0 = (await notes()).length, t = Date.now();
    await typeIn(`/jump ${q}`); await inp.press('Enter');
    let note = await newNote(n0, 4000); await sleep(300);
    s = await st();
    const jumped = await calls(t, 'ipc:jump');
    J.ambiguous = { q, hits: hitsQ, note, menu: s.menu?.items.map(x => x.text), jumps: jumped.length, value: s.value, sel: s.sel };
    check(`'/jump ${q}' with ${hitsQ.length} matches lists them and does not jump`, hitsQ.length >= 2 && new RegExp(`matches ${hitsQ.length} sessions`).test(note || '') && !jumped.length && s.menu?.items.length === hitsQ.length && s.value === `/jump ${q}`, J.ambiguous);
    await shot('12-jump-ambiguous.png');
    await inp.press('ArrowDown'); await sleep(100); s = await st();
    check('the listed matches are a picker: ↓ moves to the second one', s.menu?.items[1]?.on, s.menu?.items);
    await inp.fill('');

    // ---------- /replay ember (exited: only Theater…'s recent list has it) ----------
    const emberLive = await W.evaluate(id => (snap.agents || []).some(a => a.id === id), sid('ember'));
    const w0 = v.windows().length; n0 = (await notes()).length;
    await typeIn('/replay ember'); await sleep(150); t = Date.now(); await inp.press('Enter');
    const th = await waitCall(t, 'ipc:theater', 6000); time('replayIpcMs', th ? th.at - t : null);
    note = await newNote(n0, 4000);
    let thWin = null; for (let i = 0; i < 60 && !thWin; i++) { thWin = v.windows().find(p => /theater\/player\.html/.test(p.url())); if (!thWin) await sleep(100); }
    let thState = null; if (thWin) { await thWin.waitForLoadState().catch(() => {}); await sleep(1500); thState = await thWin.evaluate(() => ({ title: document.title, text: (document.querySelector('h1, header, .title')?.textContent || '').slice(0, 80) })).catch(e => ({ err: e.message })); }
    J.replayEmber = { emberInSnapshot: emberLive, ipc: th && th.id, emberSid: sid('ember'), note, windows: [w0, v.windows().length], theater: thState };
    check("'/replay ember' (exited) opens ember's replay", th && th.id === sid('ember') && !!thWin && /Theater|ember/i.test(JSON.stringify(thState || {})), J.replayEmber);
    if (thWin) await v.shot(path.join(OUT, '13-replay-ember-theater.png'), { page: thWin });
    await shot('14-replay-ember-note.png');

    // ---------- /goal kestrel: approve the deploy → kestrel's goal (the set-goal IPC carries kestrel's id) ----------
    n0 = (await notes()).length; t = Date.now();
    await typeIn('/goal kestrel: approve the deploy'); await inp.press('Enter');
    const g = await waitCall(t, 'ipc:set-goal', 4000); note = await newNote(n0, 4000);
    const rowGoal = await W.waitForFunction(id => (document.querySelector(`#now .nr[data-id="${id}"] .ng`)?.textContent || '').includes('approve the deploy'), sid('kestrel'), { timeout: 8000 }).then(() => true).catch(() => false);
    J.goal = { ipc: g?.args?.[0], kestrel: sid('kestrel'), note, rowGoal };
    check("'/goal kestrel: approve the deploy' sets kestrel's goal (set-goal carries kestrel's id)", g?.args?.[0]?.id === sid('kestrel') && g.args[0].text === 'approve the deploy' && rowGoal, J.goal);
    await shot('15-goal-kestrel.png');

    // ---------- a failed command keeps its text, the failing part selected ----------
    n0 = (await notes()).length;
    await typeIn('/jump zebra'); await inp.press('Enter'); note = await newNote(n0, 3000); await sleep(200);
    s = await st();
    J.zebra = { note, value: s.value, selected: s.sel, focused: s.focused, menu: s.menu?.items.length };
    check("after '/jump zebra' the bar still holds the text with 'zebra' selected", s.value === '/jump zebra' && s.sel === 'zebra' && s.focused && note === 'No session matches “zebra”.', J.zebra);
    await shot('16-jump-zebra-kept.png');

    // ---------- edge copy ----------
    n0 = (await notes()).length;
    await typeIn('/stop'); await inp.press('Enter'); note = await newNote(n0, 3000);
    J.stop = { note };
    check("'/stop' gives the needs-a-port copy", /^\/stop needs a port, e\.g\. \/stop \d+$/.test(note || ''), note);
    await shot('17-stop-needs-port.png');
    n0 = (await notes()).length;
    await typeIn('/Today'); await inp.press('Enter'); note = await newNote(n0, 4000);
    s = await st();
    J.today = { note: note && note.slice(0, 60), cleared: s.value === '' };
    check("'/Today' works (case-insensitive) and clears the bar", /^Goals set:/.test(note || '') && s.value === '', J.today);
    await shot('18-Today.png');
    n0 = (await notes()).length;
    await typeIn('/tod'); await inp.press('Enter'); note = await newNote(n0, 4000);
    check("'/tod' ⏎ (one command left) runs /today", /^Goals set:/.test(note || ''), note && note.slice(0, 40));

    // ---------- "tell <session> to …" asks first; Esc cancels: nothing sent ----------
    t = Date.now();
    await typeIn('tell the vibepet session to run its tests'); await inp.press('Enter'); await sleep(400);
    s = await st();
    J.tell = { menu: s.menu, value: s.value };
    await shot('19-tell-confirm.png');
    await inp.press('Escape'); await sleep(200);
    const sent = await calls(t, 'ipc:send-to'), s2 = await st();
    check("'tell the vibepet session to run its tests' asks 'Send to vibepet: “run its tests”?' first; Esc cancels, nothing sent", /Send to vibepet: “run its tests”\?/.test(s.menu?.items[0]?.text || '') && !sent.length && !s2.menu && s2.value === s.value, { ...J.tell, sendTo: sent.length });
    await inp.fill('');

    // ---------- the menu in dark mode (prefers-color-scheme emulated in the page) ----------
    await W.emulateMedia({ colorScheme: 'dark' }); await sleep(300);
    await typeIn('/'); await menuShown(); await sleep(150); await shot('21-dark-slash-list.png');
    await typeIn('/jump a'); await inp.press('Enter'); await sleep(500); await shot('22-dark-jump-ambiguous.png');
    await typeIn('@kestrel '); await sleep(250); await shot('23-dark-at-kestrel.png');
    await inp.fill(''); await W.emulateMedia({ colorScheme: null }); await sleep(300);

    // ---------- (b) guard: '/approve vibepet' (no dialog) is refused with the why, no keystroke (vibepet leased) ----------
    J.lease = fleet('lease', 'vibepet', OWNER, '--ttl', '300');
    const tfile = path.join(ROOT, 'projects', '-Users-christopherharris--vibepet-ultra-fleet-vibepet', `${sid('vibepet')}.jsonl`);
    const guard = [], held = /not taken/.test(J.lease);
    try {
      for (let i = 0; i < REPEAT && !held; i++) {
        if (screenState(pane('vibepet')).perm) { J.skipped.push({ part: 'guard', why: 'vibepet shows a dialog: no Enter risked' }); break; }   // never an Enter on a real prompt
        const raw0 = pane('vibepet'), size0 = fs.statSync(tfile).size, tries = [];
        let c;
        for (let k = 0; k < 5; k++) {   // ps can take > 3 s on this loaded laptop: main then refuses ("couldn't list processes"); press again
          n0 = (await notes()).length; t = Date.now();
          await typeIn('/approve vibepet'); await inp.press('Enter');
          c = await waitCall(t, 'ipc:send-to', 8000); note = await newNote(n0, 8000);
          tries.push({ why: c?.result?.why, ms: c?.ms, at: uptime() });
          if (!/couldn't list processes/.test(c?.result?.why || '')) break;
          await sleep(2000);
        }
        time('guardSendToMs', c?.ms ?? null); time('guardNoteMs', note ? Date.now() - t : null);
        await sleep(1500);
        const raw1 = pane('vibepet'), size1 = fs.statSync(tfile).size, b0 = screenState(raw0), b1 = screenState(raw1);
        s = await st();
        guard.push({ args: c?.args, result: c?.result, ms: c?.ms, note, transcriptBytes: [size0, size1], paneSame: crypto.createHash('sha1').update(raw0).digest('hex') === crypto.createHash('sha1').update(raw1).digest('hex'),
          box: [b0.box, b1.box], perm: [!!b0.perm, !!b1.perm], kept: s.value, tries });
        if (i === 0) await shot('20-approve-vibepet-refused.png');
      }
    } finally { J.release = held ? 'not ours' : fleet('release', 'vibepet', OWNER); }
    J.guard = guard;
    J.fleetAfterGuard = fleetTruth(FLEET).members?.find(m => m.name === 'vibepet')?.registry || null;
    // every press refused with its why in a note, the text kept, nothing typed (transcript unchanged, the input box empty, still
    // idle); the why is tmux.js's screen guard, or, when ps times out on a loaded Mac, main's own refusal to guess the pane
    check("'/approve vibepet' (no dialog) is refused with send-to's why, and nothing reached its pane",
      guard.length === REPEAT && guard.every(x => x.result?.ok === false && /isn't showing an approval prompt|couldn't list processes/.test(x.result.why) && x.note === `Couldn't approve: ${x.result.why}` && x.transcriptBytes[0] === x.transcriptBytes[1] && x.box[1] && !x.box[1].draft && x.kept === '/approve vibepet')
      && guard.some(x => /isn't showing an approval prompt/.test(x.result.why)) && J.fleetAfterGuard?.status === 'idle', { guard, registry: J.fleetAfterGuard });
  } finally {
    J.uptime.push(['close', uptime()]);
    try { J.intercepted = (await v.evalMain(() => globalThis.__canon.calls)).map(c => ({ kind: c.kind, args: c.args, id: c.id, result: c.result, ms: c.ms })); } catch {}
    J.close = await v.close();
  }
  J.skipped.push({ part: 'SPEND-GATED: /approve kestrel, @vibepet Reply with exactly: ok, /answer beacon 2', why: `fleet spend estimate ${J.fleet.spend?.estimateUsd ?? J.fleet.spend?.est ?? JSON.stringify(J.fleet.spend)} + 0.065 > the $3.32 stop` });
  J.medians = Object.fromEntries(Object.entries(J.timings).map(([k, a]) => [k, { median: median(a.map(x => x.ms)), n: a.length, runs: a }]));
  J.finishedAt = new Date().toISOString();
  check('no renderer errors', !J.pageErrors.length, J.pageErrors);
  J.ok = J.checks.every(c => c.ok);
  fs.writeFileSync(path.join(OUT, 'recapture.json'), JSON.stringify(J, null, 2));
  console.log(`${J.ok ? 'ALL OK' : 'FAILURES'}: ${J.checks.filter(c => c.ok).length}/${J.checks.length} · medians ${JSON.stringify(Object.fromEntries(Object.entries(J.medians).map(([k, x]) => [k, x.median])))} · close ${J.close?.how} orphans ${J.close?.orphans?.length}`);
  process.exit(J.ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
