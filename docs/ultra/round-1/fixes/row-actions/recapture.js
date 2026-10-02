#!/usr/bin/env node
// row-actions recapture: the fixed Home rows against the LIVE fleet, $0. Runs the worktree's app through test/ultra/launch.js
// (isolated root, userData ~/.vibepet-ultra/userdata/r1-row-actions). send-to is canon's stub (records, never types) for every
// part except one: beacon's Other… answer goes through the real send-to, under beacon's lease, where tmux.js refuses it on
// screen before typing anything (a question is up). Writes after/*.png + after/recapture.json (uptime beside every timing).
//   node docs/ultra/round-1/fixes/row-actions/recapture.js [--repeat 3]
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const WT = path.join(os.homedir(), '.vibepet-ultra/wt/r1-row-actions');
const OUT = path.join(__dirname, 'after'), UD = path.join(os.homedir(), '.vibepet-ultra/userdata/r1-row-actions');
const { launch } = require(path.join(WT, 'test/ultra/launch'));
const { instrument, SEED, fleetTruth } = require(path.join(WT, 'test/ultra/canon'));
const FLEET = path.join(WT, 'test/fleet/fleet.js'), OWNER = 'r1-row-actions';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uptime = () => execFileSync('/usr/bin/uptime', { encoding: 'utf8' }).trim().replace(/^.*load averages?: /, 'load ');
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const REPEAT = +(process.argv[process.argv.indexOf('--repeat') + 1] || 3) || 3;
const J = { startedAt: new Date().toISOString(), app: WT, userData: UD, checks: [], timings: {}, uptime: [] };
const check = (id, ok, detail) => { J.checks.push({ id, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${id}${ok ? '' : ' ' + JSON.stringify(detail).slice(0, 300)}`); return !!ok; };
const time = (k, ms) => { (J.timings[k] ||= []).push({ ms, at: uptime() }); return ms; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  J.fleet = fleetTruth(FLEET);
  const bySid = new Map((J.fleet.members || []).map(m => [m.sessionId, m])), sidOf = n => (J.fleet.members || []).find(m => m.name === n)?.sessionId;
  try { fs.rmSync(path.join(UD, 'ledger.jsonl'), { force: true }); } catch {}   // a fresh day book: the counts below are this run's
  J.uptime.push(['launch', uptime()]);
  const v = await launch({ appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: UD, state: { ...SEED, xp: 0 }, env: { ANTHROPIC_API_KEY: '' } });   // xp from 0: the counts below are this run's
  const W = v.win, sel = id => `#now .nr[data-id="${id}"]`;
  const calls = async (t, kind) => (await v.evalMain(() => globalThis.__canon.calls)).filter(c => c.at >= t && (!kind || c.kind === kind));
  const waitCall = async (t, kind, ms = 8000) => { const end = Date.now() + ms; for (;;) { const c = await calls(t, kind); if (c.length) return c[0]; if (Date.now() > end) return null; await sleep(60); } };
  const shotEl = async (file, s) => { const l = W.locator(s).first(); await l.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {}); await sleep(150); const b = await l.boundingBox(); if (b) await v.shot(path.join(OUT, file), { clip: { x: Math.max(0, b.x - 4), y: Math.max(0, b.y - 4), width: b.width + 8, height: b.height + 8 } }); };
  const agentsNow = async () => (await v.evalMain(() => globalThis.__vibepet.snapshot())).agents || [];
  const xpNow = () => v.evalMain(() => globalThis.__vibepet.state().xp);
  const ledger = () => { try { return fs.readFileSync(path.join(UD, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } };
  const todayLine = async () => (String(await W.evaluate(() => window.pet.today())).match(/^Goals set: \d+ · hit: \d+/) || [null])[0];   // the counts, not the drift clock
  try {
    J.instrument = await v.evalMain(instrument, { stubSendTo: true });
    await v.openHome(); await sleep(3400);
    await v.shot(path.join(OUT, 'home.png'));
    // ---------- (a) each row's decision, in words ----------
    const rows = await W.evaluate(() => [...document.querySelectorAll('#now .nr[data-id]')].map(r => ({ id: r.dataset.id, cls: r.className, ask: r.querySelector('.na')?.textContent || null,
      buttons: [...r.querySelectorAll('.nb button[data-do]')].map(b => ({ do: b.dataset.do, key: b.dataset.key || null, label: [...b.childNodes].filter(n => n.nodeName !== 'KBD').map(n => n.textContent).join('').trim(), kbd: b.querySelector('kbd')?.textContent || null })) })));
    J.rows = rows.map(r => ({ member: bySid.get(r.id)?.name || r.id.slice(0, 8), cls: r.cls, ask: r.ask, buttons: r.buttons.map(b => `${b.do}${b.key ? ':' + b.key : ''}=${b.label}`) }));
    const row = n => rows.find(r => r.id === sidOf(n)), labels = n => (row(n)?.buttons || []).map(b => b.label);
    check('kestrel: Bash: ./deploy.sh --dry-run + Approve, Always: ./deploy.sh *, Deny', row('kestrel')?.ask === 'Bash: ./deploy.sh --dry-run' && ['Approve', 'Always: ./deploy.sh *', 'Deny'].every(x => labels('kestrel').includes(x)), J.rows.find(r => r.member === 'kestrel'));
    check('beacon: question + SQLite / Postgres / Redis / Other…', /\?/.test(row('beacon')?.ask || '') && JSON.stringify(row('beacon')?.buttons.filter(b => b.do === 'option' || b.do === 'other').map(b => b.label)) === JSON.stringify(['SQLite', 'Postgres', 'Redis', 'Other…']), J.rows.find(r => r.member === 'beacon'));
    for (const n of ['vibepet', 'atlas', 'delta']) if (row(n)) check(`${n} (done): Reply`, labels(n).includes('Reply'), J.rows.find(r => r.member === n));
    const glyphs = rows.flatMap(r => r.buttons.filter(b => !/[A-Za-z]/.test(b.label)).map(b => b.label));
    check('no glyph-only row control', !glyphs.length, glyphs);
    check('blocked rows: no goal control on the decision line', ['kestrel', 'beacon'].every(n => !(row(n)?.buttons || []).some(b => b.do === 'done')), ['kestrel', 'beacon'].map(n => labels(n)));
    for (const n of ['kestrel', 'beacon', 'vibepet']) if (row(n)) await shotEl(`row-${n}.png`, sel(row(n).id));
    // ---------- (b) Goal: inline edit, Mark done + Undo, counted once ----------
    const gid = sidOf('atlas') && row('atlas') ? sidOf('atlas') : rows.find(r => /ready/.test(r.cls))?.id, gname = bySid.get(gid)?.name;
    const goal0 = (await agentsNow()).find(a => a.id === gid)?.goal;
    await W.locator(`${sel(gid)} .ns [data-do=goal]`).click();
    await W.locator(`${sel(gid)} form.nrep input`).waitFor({ timeout: 4000 });
    const prefill = await W.locator(`${sel(gid)} form.nrep input`).inputValue();
    await shotEl('goal-edit-prefilled.png', sel(gid));
    let t = Date.now();
    await W.locator(`${sel(gid)} form.nrep input`).press('Enter');
    await sleep(1500);
    const sets = await calls(t, 'ipc:set-goal');
    J.goalEdit = { member: gname, goal: goal0, prefill, setGoal: sets.map(c => ({ same: c.id === gid, text: c.text })) };
    check(`inline edit of ${gname}'s auto goal is prefilled with it; Enter = 1 set-goal`, goal0?.auto && prefill === goal0.text && sets.length === 1 && sets[0].id === gid && sets[0].text === goal0.text, J.goalEdit);
    // Mark done ×REPEAT → Undo within 5 s, each time: slots stay, Undo takes the row and the xp back
    const did = sidOf('delta') && row('delta') ? sidOf('delta') : gid, dname = bySid.get(did)?.name;
    const boxes = () => W.evaluate(id => { const r = document.querySelector(`#now .nr[data-id="${id}"]`), rb = r.getBoundingClientRect(), c = document.getElementById('chat').getBoundingClientRect();
      return { bubble: !document.getElementById('bubble').classList.contains('hidden'), ...Object.fromEntries(['replay', 'goal', 'diff'].map(k => { const b = r.querySelector(`.ns [data-do=${k}]`).getBoundingClientRect();
        return [k, { view: [b.x, b.y, b.width, b.height], panel: [b.x - c.x, b.y - c.y], row: [b.x - rb.x, b.y - rb.y] }]; })) }; }, did);
    const noBubble = () => W.waitForFunction(() => document.getElementById('bubble').classList.contains('hidden'), null, { timeout: 9000 }).catch(() => {});
    J.markDone = [];
    for (let i = 0; i < REPEAT; i++) {
      await W.waitForFunction(id => !!document.querySelector(`#now .nr[data-id="${id}"] .nx [data-do=done]`), did, { timeout: 12e3 });
      await W.locator(`${sel(did)} .nx [data-do=done]`).scrollIntoViewIfNeeded().catch(() => {}); await noBubble(); await sleep(250);
      const before = await boxes(), xp0 = await xpNow(), led0 = ledger().filter(r => r.kind === 'goal_done' && r.id === did).length;
      t = Date.now();
      await W.locator(`${sel(did)} .nx [data-do=done]`).click();
      await W.waitForFunction(id => /Goal done/.test(document.querySelector(`#now .nr[data-id="${id}"] .nnote`)?.textContent || ''), did, { timeout: 10e3 });
      const noteMs = time('markDone→note', Date.now() - t);
      const after = await boxes();
      if (i === 0) await shotEl('mark-done-undo-offered.png', sel(did));
      const xp1 = await xpNow(), led1 = ledger().filter(r => r.kind === 'goal_done' && r.id === did).length;
      const tu = Date.now();
      await W.locator(`${sel(did)} .nnote [data-do=undo]`).click();
      await W.waitForFunction(id => { const r = document.querySelector(`#now .nr[data-id="${id}"]`); return r && !r.querySelector('.ng.done') && /open again/.test(r.querySelector('.nnote')?.textContent || ''); }, did, { timeout: 10e3 });
      const undoMs = time('undo→reopened', Date.now() - tu);
      if (i === 0) await shotEl('undo-done.png', sel(did));
      const xp2 = await xpNow(), led2 = ledger().filter(r => r.kind === 'goal_done' && r.id === did).length;
      const sameAs = w => ['replay', 'goal', 'diff'].every(k => JSON.stringify(before[k][w]) === JSON.stringify(after[k][w])), same = sameAs('view') || ((before.bubble || after.bubble) && sameAs('panel'));
      J.markDone.push({ i, noteMs, undoMs, undoAfterDoneMs: tu - t, xp: [xp0, xp1, xp2], goalDoneRows: [led0, led1, led2], slots: { sameOnScreen: sameAs('view'), sameInPanel: sameAs('panel'), sameInRow: sameAs('row'), before, after } });
      check(`Mark done #${i + 1} on ${dname}: Replay/Goal/Diff boxes identical; Undo inside 5 s restores the goal, drops its row, takes the xp back`,
        same && xp1 === xp0 + 15 && led1 === led0 + 1 && xp2 === xp0 && led2 === led0 && tu - t < 5000, J.markDone[i]);
    }
    // a goal is hit once: Mark done (counted), reset to the first prompt (the same text), Mark done → no hit, no xp
    const editTo = async (id, text) => { await W.locator(`${sel(id)} .ns [data-do=goal]`).click(); const i = W.locator(`${sel(id)} form.nrep input`); await i.waitFor({ timeout: 4000 }); await i.fill(text); await i.press('Enter'); };
    const offersDone = id => W.waitForFunction(id => !!document.querySelector(`#now .nr[data-id="${id}"] .nx [data-do=done]`), id, { timeout: 15e3 }).then(() => true).catch(() => false);
    await offersDone(did); t = Date.now();
    await W.locator(`${sel(did)} .nx [data-do=done]`).click(); await waitCall(t, 'ipc:goal-done'); await sleep(800);
    const today1 = await todayLine(), xpA = await xpNow();
    await editTo(did, ''); const back = await offersDone(did);
    t = Date.now();
    await W.locator(`${sel(did)} .nx [data-do=done]`).click();
    const again = await waitCall(t, 'ipc:goal-done'); await sleep(800);
    const today2 = await todayLine(), xpB = await xpNow();
    await shotEl('reset-mark-done-again.png', sel(did));
    await W.locator('#now [data-do=today]').click(); await sleep(700); await v.shot(path.join(OUT, 'today-after-reset.png'));
    J.once = { member: dname, reopenedAfterReset: back, result: again?.result || null, today: [today1, today2], xp: [xpA, xpB] };
    check(`reset + Mark done again on ${dname}: Today's hit count and xp unchanged`, back && again?.result?.ok && again.result.counted === false && today1 === today2 && xpA === xpB, J.once);
    // ---------- (c) Diff on vibepet's row: its repo, read-only window ----------
    const vid = sidOf('vibepet'), want = fs.realpathSync(path.join(os.homedir(), '.vibepet-ultra/fleet/vibepet'));
    J.diff = [];
    for (let i = 0; i < REPEAT; i++) {
      t = Date.now();
      await W.locator(`${sel(vid)} .ns [data-do=diff]`).click();
      const c = await waitCall(t, 'ipc:diff', 20e3);
      J.diff.push({ ms: c ? time('diff IPC (git + window)', c.ms) : null, result: c?.result || null });
      await sleep(500);
    }
    const dw = await v.evalMain(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => /^Diff · /.test(x.getTitle()));
      return w ? { title: w.getTitle(), wins: BrowserWindow.getAllWindows().filter(x => /^Diff · /.test(x.getTitle())).length, js: w.webContents.getLastWebPreferences?.().javascript, png: (await w.webContents.capturePage()).toPNG().toString('base64') } : null; });
    if (dw?.png) fs.writeFileSync(path.join(OUT, 'diff-vibepet.png'), Buffer.from(dw.png, 'base64'));
    // its file link opens that file in its app (shell.openPath, recorded by the instrument), never navigates the page
    t = Date.now();
    const link = await v.evalMain(async ({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => /^Diff · /.test(x.getTitle())); if (!w) return null;
      const before = w.webContents.getURL().length;   // Tab reaches the first file link (the page has no script to ask), Enter follows it
      for (const type of ['keyDown', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: 'Tab' }); await new Promise(r => setTimeout(r, 200));
      for (const type of ['keyDown', 'char', 'keyUp']) w.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Return' });
      await new Promise(r => setTimeout(r, 900)); return { sameUrl: w.webContents.getURL().length === before }; });
    const opened = await calls(t, 'openPath');
    J.diffWindow = { title: dw?.title, windows: dw?.wins, javascript: dw?.js, fileLink: { ...link, openPath: opened.map(o => o.path) } };
    check('Diff on vibepet opens ~/.vibepet-ultra/fleet/vibepet in one read-only window (reused)', J.diff.every(d => d.result?.ok && d.result.root === want) && /^Diff · vibepet$/.test(dw?.title || '') && dw.wins === 1, { diff: J.diff.map(d => d.result), window: J.diffWindow });
    await v.evalMain(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (/^Diff · /.test(w.getTitle())) w.close(); });
    // ---------- (c) keys on a focused row → send-to (stub) with that row's id ----------
    const focusRow = id => W.evaluate(id => document.querySelector(`#now .nr[data-id="${id}"]`)?.focus(), id);
    const press = async (id, key, exp, extra) => {
      await sleep(400); await focusRow(id); const t0 = Date.now();
      await W.keyboard.press(key); if (extra) await extra();
      const c = await waitCall(t0, 'ipc:send-to', 8000), got = c?.args?.[0] || null;
      return { key, member: bySid.get(id)?.name || id.slice(0, 8), ms: c ? time('key→send-to', c.at - t0) : null, ok: !!got && got.id === id && Object.entries(exp).every(([k, x]) => got[k] === x), sent: got && { ...got, id: got.id === id ? 'this row' : got.id } };
    };
    J.keys = [];
    for (let i = 0; i < REPEAT; i++) {
      J.keys.push(await press(sidOf('kestrel'), 'a', { action: 'approve' }), await press(sidOf('kestrel'), 'w', { action: 'always' }), await press(sidOf('kestrel'), 'd', { action: 'deny' }),
        await press(sidOf('beacon'), '2', { action: 'option', key: '2' }),
        await press(vid, 'r', { action: 'text', text: 'Reply with exactly: ok' }, async () => { await W.locator(`${sel(vid)} form.nrep input`).waitFor({ timeout: 3000 }); await W.keyboard.type('Reply with exactly: ok', { delay: 4 }); await W.keyboard.press('Enter'); }));
    }
    await shotEl('keys-kestrel-note.png', sel(sidOf('kestrel')));
    // S: no fleet member is running ($0: atlas and delta are paused), so main's tick reports atlas as running while send-to
    // stays stubbed. This checks the key and its in-place confirm only; the real interrupt is the spend-gated part
    const aid = sidOf('atlas');
    await v.evalMain((_, id) => { const w = globalThis.__vibepet.win(), wc = w.webContents; if (!wc.__send0) wc.__send0 = wc.send.bind(wc);
      wc.send = (ch, d) => wc.__send0(ch, ch === 'tick' && d?.agents ? { ...d, agents: d.agents.map(a => a.id === id ? { ...a, phase: 'working', kind: 'running', since: Date.now() - 42e3, ask: 'Bash: ./build.sh' } : a) } : d); }, aid);
    await W.waitForFunction(id => !!document.querySelector(`#now .nr[data-id="${id}"] [data-do=interrupt]`), aid, { timeout: 8000 });
    await focusRow(aid); t = Date.now();
    await W.keyboard.press('s'); await W.keyboard.press('s');   // a double press inside 0.4 s: only asks
    await sleep(300);
    const asked = await W.evaluate(id => document.querySelector(`#now .nr[data-id="${id}"] [data-do=interrupt]`)?.textContent || null, aid);
    await shotEl('stop-confirm.png', sel(aid));
    const early = await calls(t, 'ipc:send-to');
    await sleep(300); await W.keyboard.press('s');
    const sc = await waitCall(t, 'ipc:send-to', 6000);
    J.stop = { asked, sentOnDoublePress: early.length, sent: sc?.args?.[0] ? { ...sc.args[0], id: sc.args[0].id === aid ? 'this row' : sc.args[0].id } : null };
    check('S on a running row asks in place ("Stop now"), a double press sends nothing, S again sends interrupt to that row', asked === 'Stop now' && !early.length && sc?.args?.[0]?.id === aid && sc.args[0].action === 'interrupt', J.stop);
    J.keys.push({ key: 's', member: 'atlas (synthetic running)', ok: sc?.args?.[0]?.id === aid && sc.args[0].action === 'interrupt' });
    for (const k of ['a', 'w', 'd', '2', 'r']) check(`key ${k.toUpperCase()} on a focused row → send-to with the right action and that row's id (${REPEAT}×)`, J.keys.filter(x => x.key === k).length === REPEAT && J.keys.filter(x => x.key === k).every(x => x.ok), J.keys.filter(x => x.key === k));
    // Approve all: two approvals on the identical command (vibepet reported as a second './deploy.sh --dry-run' approval)
    await v.evalMain((_, [id, src]) => { const wc = globalThis.__vibepet.win().webContents;
      wc.send = (ch, d) => { if (ch !== 'tick' || !d?.agents) return wc.__send0(ch, d); const k = d.agents.find(a => a.id === src);
        return wc.__send0(ch, { ...d, agents: d.agents.map(a => a.id === id && k ? { ...a, phase: 'stalled', kind: 'approval', ask: k.ask, options: k.options, since: k.since + 1 } : a) }); }; }, [vid, sidOf('kestrel')]);
    await W.waitForFunction(() => document.querySelectorAll('#now [data-do=approveAll]').length === 2, null, { timeout: 8000 }).catch(() => {});
    await shotEl('approve-all.png', '#now .nlist');
    t = Date.now();
    const allLabel = await W.locator(`${sel(sidOf('kestrel'))} [data-do=approveAll]`).textContent().catch(() => null);
    await W.locator(`${sel(sidOf('kestrel'))} [data-do=approveAll]`).click().catch(() => {});
    await sleep(1500);
    const allCalls = (await calls(t, 'ipc:send-to')).map(c => c.args[0]);
    J.approveAll = { label: allLabel, sent: allCalls.map(x => ({ action: x.action, member: bySid.get(x.id)?.name })) };
    check('Approve all (2) when two approvals wait on the identical command → approve to both sessions', allLabel === 'Approve all (2)' && allCalls.length === 2 && allCalls.every(x => x.action === 'approve') && new Set(allCalls.map(x => x.id)).size === 2, J.approveAll);
    await v.evalMain(() => { const wc = globalThis.__vibepet.win().webContents; if (wc.__send0) wc.send = wc.__send0; });   // the truth again
    await sleep(3500);
    // Clear done: every finished row into a collapsed Idle group, and back out on request
    const finBefore = await W.evaluate(() => [...document.querySelectorAll('#now .nr.ready[data-id]')].length);
    await W.locator('#now [data-do=clear]').click();
    await sleep(400);
    const afterClear = await W.evaluate(() => ({ ready: document.querySelectorAll('#now .nr.ready[data-id]').length, idle: document.querySelector('#now [data-do=idle]')?.textContent || null }));
    await v.shot(path.join(OUT, 'clear-done.png'));
    await W.locator('#now [data-do=idle]').click(); await sleep(400);
    const expanded = await W.evaluate(() => document.querySelectorAll('#now .nr.idle[data-id]').length);
    await shotEl('idle-expanded.png', '#now .nlist');
    J.clearDone = { finishedBefore: finBefore, afterClear, idleRowsExpanded: expanded };
    check('Clear done collapses every finished row into Idle (N), which expands on request', finBefore > 0 && afterClear.ready === 0 && afterClear.idle === `${finBefore} idle ▸` && expanded === finBefore, J.clearDone);
  } finally {
    J.intercepted = (await v.evalMain(() => globalThis.__canon.calls).catch(() => [])).map(c => ({ kind: c.kind, at: c.at, args: c.args && c.kind === 'ipc:send-to' ? c.args.map(a => ({ ...a, id: bySid.get(a.id)?.name || a.id })) : undefined, result: c.result }));
    J.close = await v.close();
  }
  J.uptime.push(['part A done', uptime()]);

  // ---------- one real send-to, refused on screen: beacon's Other… while its question is up (lease held) ----------
  let leased = !process.argv.includes('--no-real');   // --no-real: part A only
  if (leased) try { J.lease = execFileSync(process.execPath, [FLEET, 'lease', 'beacon', OWNER, '--ttl', '600'], { encoding: 'utf8' }).trim(); } catch (e) { leased = false; J.lease = String(e.stdout || e.message).trim(); }   // exit 3: someone holds it
  try {
    const fb = leased ? fleetTruth(FLEET).members.find(m => m.name === 'beacon') : null;
    if (!leased || !fb?.inState || fb.registry?.waitingFor !== 'input needed') { J.other = { skipped: { lease: J.lease, beacon: fb && { inState: fb.inState, registry: fb.registry } } }; }
    else {
      const v2 = await launch({ appDir: WT, root: path.join(os.homedir(), '.vibepet-ultra/root/.claude'), userData: UD, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
      try {
        await v2.evalMain(instrument);   // spy only: this one send-to is real
        await v2.openHome(); await sleep(3400);
        const bid = fb.sessionId, W2 = v2.win;
        await W2.locator(`${sel(bid)} [data-do=other]`).click();
        await W2.locator(`${sel(bid)} form.nrep input`).waitFor({ timeout: 4000 });
        const ph = await W2.locator(`${sel(bid)} form.nrep input`).getAttribute('placeholder');
        await W2.locator(`${sel(bid)} form.nrep input`).fill('MongoDB');
        const l = W2.locator(sel(bid)); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox();
        await v2.shot(path.join(OUT, 'other-box.png'), { clip: { x: b.x - 4, y: b.y - 4, width: b.width + 8, height: b.height + 8 } });
        const t = Date.now();
        await W2.locator(`${sel(bid)} form.nrep input`).press('Enter');
        let c = null; for (let i = 0; i < 100 && !c; i++) { c = (await v2.evalMain(() => globalThis.__canon.calls)).find(x => x.at >= t && x.kind === 'ipc:send-to'); if (!c) await sleep(100); }
        await W2.waitForFunction(id => /question/.test(document.querySelector(`#now .nr[data-id="${id}"] .nnote`)?.textContent || ''), bid, { timeout: 8000 }).catch(() => {});
        const note = await W2.evaluate(id => { const n = document.querySelector(`#now .nr[data-id="${id}"] .nnote`); return n ? { text: n.textContent, cls: n.className } : null; }, bid);
        const b2 = await l.boundingBox(); await v2.shot(path.join(OUT, 'other-refused-in-row.png'), { clip: { x: b2.x - 4, y: b2.y - 4, width: b2.width + 8, height: b2.height + 8 } });
        await sleep(1500);
        const fa = fleetTruth(FLEET).members.find(m => m.name === 'beacon');
        J.other = { placeholder: ph, sent: c?.args?.[0] ? { action: c.args[0].action, text: c.args[0].text } : null, result: c?.result || null, ms: c?.ms ?? null, note, beaconAfter: { inState: fa?.inState, registry: fa?.registry } };
        if (c?.ms != null) time('send-to refusal (real, tmux guard)', c.ms);
        check("beacon's Other… → real send-to text, refused on screen before typing; the why shows in beacon's row, beacon still waiting", c?.result?.ok === false && /question/.test(c.result.why || '') && /question/.test(note?.text || '') && /err/.test(note?.cls || '') && fa?.registry?.waitingFor === 'input needed' && fa.registry.statusUpdatedAt === fb.registry.statusUpdatedAt, J.other);
      } finally { J.close2 = await v2.close(); }
    }
  } finally { if (leased) J.release = execFileSync(process.execPath, [FLEET, 'release', 'beacon', OWNER], { encoding: 'utf8' }).trim(); }
  J.uptime.push(['end', uptime()]);
  J.medians = Object.fromEntries(Object.entries(J.timings).map(([k, a]) => [k, { n: a.length, medianMs: median(a.map(x => x.ms)), runs: a }]));
  J.summary = { ok: J.checks.every(c => c.ok), checks: `${J.checks.filter(c => c.ok).length}/${J.checks.length}`, orphans: [J.close?.orphans?.length, J.close2?.orphans?.length] };
  fs.writeFileSync(path.join(OUT, 'recapture.json'), JSON.stringify(J, null, 2));
  console.log(JSON.stringify(J.summary), Object.entries(J.medians).map(([k, m]) => `${k}: ${m.medianMs} ms (n=${m.n})`).join(' · '));
  process.exit(J.summary.ok ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
