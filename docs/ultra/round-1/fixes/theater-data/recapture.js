// theater-data recapture: does Theater tell each fleet session's own story? node recapture.js <appDir> <outDir> [userData] [--runs N]
// The real app (test/ultra/launch.js, isolated fleet root, own userData) against the live fleet, $0: no fleet member takes
// a turn and nothing is typed anywhere. The ⋯ menu is a native menu: canon's instrument captures it and its Theater… item
// is clicked in main (the call a hand on the menu makes). Truth comes from the fleet transcripts (fleet dirs only: record
// types, timestamps, the fleet's own prompts) and `fleet.js status --json` (registry). Writes results.json + PNGs.
'use strict';
const path = require('path'), os = require('os'), fs = require('fs'), { execSync, execFileSync } = require('child_process');
const args = process.argv.slice(2), [APP, OUT, UD] = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));
const RUNS = +(args[args.indexOf('--runs') + 1] || 3) || 3;
const ULTRA = path.join(os.homedir(), '.vibepet-ultra'), ROOT = path.join(ULTRA, 'root', '.claude'), userData = UD || path.join(ULTRA, 'userdata', 'r1-theater-data');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; };
const iso = t => t ? new Date(t).toISOString() : null;
fs.mkdirSync(OUT, { recursive: true });
const R = { app: APP, git: (() => { try { return execFileSync('git', ['-C', APP, 'log', '-1', '--format=%h %s'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return process.env.APP_GIT || 'not a checkout'; } })(), startedAt: new Date().toISOString(), userData, runs: RUNS };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const { launch } = require(path.join(APP, 'test', 'ultra', 'launch.js'));
const { instrument, SEED } = require(path.join(APP, 'test', 'ultra', 'canon.js'));

// ---------- truth: a fleet transcript read directly (refuses anything but a fleet session dir) ----------
function truth(file) {
  if (!file.split(path.sep).some(s => s.includes('-vibepet-ultra-fleet-'))) throw new Error('not a fleet transcript');
  const T = { file: path.basename(file), lastRecord: null, firstPrompt: null, fires: 0, exits: 0, costStates: 0, asks: 0, ask: null, gitCommitCmds: 0, agents: [] };
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    let d; try { d = JSON.parse(l); } catch { continue; }
    if (d.type === 'cost-state') T.costStates++;
    if (d.timestamp) T.lastRecord = d.timestamp;
    if (d.type === 'system' && d.subtype === 'scheduled_task_fire') T.fires++;
    const c = d.message?.content, txt = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('\n') : '';
    if (d.type === 'user' && !d.isMeta && !d.isSidechain && !(Array.isArray(c) && c.some(b => b.type === 'tool_result'))) {
      const t = txt.trim();
      if (/^<command-name>\/(?:exit|quit)</.test(t)) T.exits++;
      if (!T.firstPrompt && t && !t.startsWith('[Request interrupted') && (!t.startsWith('<') || t.startsWith('<command-'))) {
        const cn = t.match(/<command-name>([^<]*)<\/command-name>/);
        T.firstPrompt = (cn ? `${cn[1]} ${(t.match(/<command-args>([^<]*)<\/command-args>/) || [])[1] || ''}` : t).trim().replace(/\s+/g, ' ');
      }
    }
    for (const b of Array.isArray(c) ? c : []) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'AskUserQuestion') { T.asks++; const q = b.input?.questions?.[0]; T.ask ||= q && { question: q.question, options: (q.options || []).map(o => o.label) }; }
      if (b.name === 'Bash' && /\bgit\b[^\n]*\bcommit\b/.test(b.input?.command || '')) T.gitCommitCmds++;
      if (b.name === 'Agent' || b.name === 'Task') T.agents.push({ at: d.timestamp, desc: b.input?.description });
    }
  }
  return T;
}
const fleet = () => { try { return JSON.parse(execFileSync(process.execPath, [path.join(APP, 'test', 'fleet', 'fleet.js'), 'status', '--json'], { encoding: 'utf8', timeout: 60e3 })); } catch (e) { return JSON.parse(e.stdout || '{}'); } };

// ---------- main-side hooks (after canon's instrument) ----------
// every theater-timeline answer is timed in main, through the real handler; the Theater… item for a file is clicked
// with a main-clock stamp (the same call a hand on the native menu makes)
function hookTimeline({ ipcMain }) {
  const H = ipcMain._invokeHandlers, h = H && H.get('theater-timeline'), C = globalThis.__canon;
  if (typeof h !== 'function' || C.tlHooked) return { hooked: !!C.tlHooked };
  ipcMain.removeHandler('theater-timeline');
  ipcMain.handle('theater-timeline', async (e, ...a) => {
    const t = Date.now(); let out, err; const e2 = Object.create(e); e2._reply = v => { out = v; }; e2._throw = x => { err = x; };
    let ret; try { ret = await h(e2, ...a); } catch (x) { err = x; }
    if (out === undefined) out = ret;
    C.calls.push({ kind: 'ipc:theater-timeline', at: t, ms: Date.now() - t, beats: out?.beats?.length, file: out?.meta?.file, error: err ? String(err.message || err) : undefined });
    if (err) throw err; return out;
  });
  return { hooked: C.tlHooked = true };
}
function theaterItems() {
  const C = globalThis.__canon, menu = C.menus[C.menus.length - 1], th = menu?.items.find(i => /^Theater/.test(i.label || ''));
  return th?.submenu ? th.submenu.items.map(i => ({ label: i.label, file: i.toolTip || null, enabled: i.enabled })) : null;
}
function clickTheater(_e, file) {
  const C = globalThis.__canon, menu = C.menus[C.menus.length - 1], th = menu?.items.find(i => /^Theater/.test(i.label || ''));
  const item = th?.submenu?.items.find(i => i.toolTip === file);
  if (!item) return { ok: false };
  const at = Date.now(); item.click(); return { ok: true, at, label: item.label };
}
// in every Theater page, before its scripts: the first frame after the rail has beats, on the wall clock
function firstFrame() {
  if (!/theater\/player\.html$/.test(location.href)) return;
  const mo = new MutationObserver(() => { if (!window.__ff && document.querySelector('#beats .b')) { mo.disconnect(); requestAnimationFrame(() => { window.__ff = performance.timeOrigin + performance.now(); }); } });
  document.addEventListener('DOMContentLoaded', () => mo.observe(document.body, { subtree: true, childList: true }));
}
const READ = () => {   // what the replay holds and shows (fields a build lacks come back undefined)
  const T = window.__theater?.T; if (!T) return null;
  return { header: document.getElementById('title').textContent, stats: T.stats, meta: { t0: T.meta.t0, t1: T.meta.t1, dur: T.meta.dur, cwd: T.meta.cwd, file: T.meta.file },
    chapters: T.chapters.map(c => ({ i: c.i, title: c.title, beat: c.beat, t: c.t })), lanes: (T.lanes || []).map(l => ({ lane: l.lane, from: l.from, title: l.title })),
    beats: T.beats.map(b => ({ i: b.i, kind: b.kind, t: b.t, lane: b.lane, ch: b.ch, title: b.title, branch: b.branch, options: b.options, answer: b.answer, state: b.state, since: b.since, at: b.at, detail: b.kind === 'commit' ? b.detail : undefined })) };
};
const STAGE = () => ({ kicker: document.querySelector('#focus .kicker')?.textContent || null, headline: document.querySelector('#focus .headline')?.textContent || null,
  text: (document.getElementById('focus').innerText || '').slice(0, 600), pin: document.getElementById('pin').classList.contains('hidden') ? null : (document.getElementById('pin').innerText || '').slice(0, 900),
  chap: document.getElementById('chap').textContent, clock: document.getElementById('clock').textContent });

(async () => {
  R.loadStart = load();
  R.fleetSpendBefore = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim().slice(0, 140);
  const F = fleet(); R.fleet = { at: F.at, members: (F.members || []).map(m => ({ name: m.name, state: m.state, ok: m.ok, paused: m.paused, pid: m.pid, sessionId: m.sessionId, registry: m.registry && { status: m.registry.status, waitingFor: m.registry.waitingFor, statusUpdatedAt: m.registry.statusUpdatedAt, since: iso(m.registry.statusUpdatedAt) }, lastTs: m.last?.lastTs })) };
  fs.rmSync(userData, { recursive: true, force: true });
  for (const k of Object.keys(process.env)) if (/^CLAUDE(CODE$|_CODE_|_PID$|_EFFORT$)/.test(k)) delete process.env[k];
  const v = await launch({ appDir: APP, root: ROOT, userData, state: SEED, env: { ANTHROPIC_API_KEY: '' } });
  const W = v.win;
  try {
    await v.evalMain(instrument); R.hook = await v.evalMain(hookTimeline);
    await v.app.context().addInitScript(firstFrame);
    R.readyMs = v.readyMs;
    await v.evalMain(() => globalThis.__vibepet.win().webContents.send('event', { kind: 'openChat' }));
    for (let i = 0; i < 100 && !(await v.homeMode()); i++) await sleep(50);
    await sleep(2500);   // the first ticks: registry, panes, rows
    const popMenu = async () => {
      const n0 = (await v.evalMain(() => globalThis.__canon.menus.length));
      const t = Date.now(); await W.locator('#homeMore').click();
      for (let i = 0; i < 60; i++) { if ((await v.evalMain(() => globalThis.__canon.menus.length)) > n0) break; await sleep(50); }
      return Date.now() - t;
    };
    // ---- Theater… entries: labels, ages and order vs. each transcript's last record ----
    await popMenu();
    const now = Date.now(), items = await v.evalMain(theaterItems);
    R.menu = { at: iso(now), load: load(), items: (items || []).map(x => {
      const fl = x.file && x.file.split(path.sep).some(s => s.includes('-vibepet-ultra-fleet-')) ? truth(x.file) : null;
      const m = (x.label || '').match(/^(.*?)\s+· (\S+) · (\d+)([mhd])$/), unit = m ? { m: 60e3, h: 3600e3, d: 864e5 }[m[4]] : null;
      const trueAge = fl?.lastRecord ? now - Date.parse(fl.lastRecord) : null, shown = m ? +m[3] * unit : null;
      let mtime = null; try { mtime = fs.statSync(x.file).mtimeMs; } catch {}
      return { label: x.label, title: m ? m[1] : null, project: m ? m[2] : null, age: m ? m[3] + m[4] : null, member: x.file ? x.file.split('-vibepet-ultra-fleet-')[1]?.split(path.sep)[0] : null,
        session: x.file ? path.basename(x.file, '.jsonl').slice(0, 8) : null, lastRecord: fl?.lastRecord || null, mtime: iso(mtime), trueAgeMin: trueAge == null ? null : +(trueAge / 60e3).toFixed(2),
        shownAgeMin: shown == null ? null : shown / 60e3, ageErrMin: trueAge == null || shown == null ? null : +((shown - trueAge) / 60e3).toFixed(2),
        roundsTo: trueAge == null ? null : unit === 60e3 ? Math.round(trueAge / 60e3) + 'm' : unit === 3600e3 ? Math.round(trueAge / 3600e3) + 'h' : Math.round(trueAge / 864e5) + 'd', file: x.file };
    }) };
    // what main's recent() returned (its `at`, when the build has one), and a 24 h listing labelled the way main.js labels
    // the menu, so a session past the 12 h window (ember's earlier one) shows next to its sibling
    R.menu.recent = await v.evalMain(() => { const V = globalThis.__vibepet, dir = V.require('./overrides').projectsDir(), now = Date.now();
      const agoS = ms => ms < 3600e3 ? `${Math.round(ms / 60e3)}m` : ms < 864e5 ? `${Math.round(ms / 3600e3)}h` : `${Math.round(ms / 864e5)}d`;
      const row = x => ({ file: x.file, title: x.title, project: x.project, at: x.at ?? null, mtime: x.mtime ?? null, label: `${x.title} · ${x.project} · ${agoS(now - (x.at ?? x.mtime))}` });
      const th = V.require('./theater'); return { now, h12: th.recent(dir).map(row), h24: th.recent(dir, 24).map(row) }; });
    for (const x of [...R.menu.recent.h12, ...R.menu.recent.h24]) { const fl = truth(x.file); x.lastRecord = fl.lastRecord; x.atMinusLastRecordMs = x.at == null ? null : x.at - Date.parse(fl.lastRecord); x.session = path.basename(x.file, '.jsonl').slice(0, 8); delete x.file; }
    R.menu.orderByLastRecord = R.menu.items.every((x, k, a) => !k || !x.lastRecord || !a[k - 1].lastRecord || Date.parse(a[k - 1].lastRecord) >= Date.parse(x.lastRecord));
    R.menu.rawMarkup = R.menu.items.filter(x => /<\/?command-/.test(x.label)).length;
    log('menu', JSON.stringify(R.menu.items.map(x => [x.label, x.roundsTo])));
    save();
    // ---- each member's current session: open from Theater… RUNS times (timings), capture on the first ----
    const want = ['vibepet', 'kestrel', 'beacon', 'ember', 'delta', 'atlas'];
    const pick = name => R.menu.items.find(x => x.member === name && (R.fleet.members.find(m => m.name === name)?.sessionId || '').startsWith(x.session)) || R.menu.items.find(x => x.member === name);
    R.replays = {};
    for (const name of want) {
      const it = pick(name); if (!it) { R.replays[name] = { missing: 'not in Theater…' }; continue; }
      const rep = R.replays[name] = { session: it.session, label: it.label, truth: truth(it.file), opens: [] };
      for (let run = 0; run < RUNS; run++) {
        await popMenu();
        const opened = v.app.waitForEvent('window', { timeout: 15e3, predicate: p => /theater\/player\.html$/.test(p.url()) });
        const c = await v.evalMain(clickTheater, it.file);
        const th = await opened.catch(() => null);
        if (!th) { rep.opens.push({ ok: false, clicked: c }); continue; }
        await th.waitForFunction(() => window.__theater?.T || /Could not|Nothing/.test(document.getElementById('title')?.textContent || ''), null, { timeout: 15e3 }).catch(() => {});
        await th.waitForFunction(() => window.__ff, null, { timeout: 5e3 }).catch(() => {});
        const ff = await th.evaluate(() => window.__ff || null);
        const call = (await v.evalMain(() => globalThis.__canon.calls.filter(x => x.kind === 'ipc:theater-timeline'))).filter(x => x.at >= c.at).pop();
        rep.opens.push({ ok: true, firstFrameMs: ff ? Math.round(ff - c.at) : null, mainBuildMs: call?.ms ?? null, beats: call?.beats ?? null, load: load() });
        if (run === 0) {
          await sleep(2600);   // past the opening chapter card
          const data = rep.replay = await th.evaluate(READ);
          const shot = async (n, fn) => { if (fn) await th.evaluate(fn.f, fn.a); await sleep(700); await v.shot(path.join(OUT, `${name}-${n}.png`), { page: th }); return th.evaluate(STAGE); };
          rep.shots = {};
          rep.shots.open = await shot('open');
          const B = data.beats, last = B.length - 1, at = (k) => ({ f: i => window.__theater.beat(i), a: k });
          rep.shots.end = await shot('end', at(last));
          rep.shots.endPinned = await shot('end-pinned', { f: i => window.__theater.pin(i), a: last });
          await th.evaluate(i => window.__theater.pin(i), last);   // unpin
          const firstPrompt = B.findIndex(b => b.kind === 'prompt');
          if (name === 'vibepet') rep.shots.chapter1 = await shot('chapter1', at(Math.max(0, firstPrompt)));
          if (name === 'beacon') {
            let q = B.findIndex(b => b.kind === 'question'); if (q < 0) q = B.findIndex(b => b.kind === 'read' && /^AskUserQuestion/.test(b.title));   // the old build: 'LOOK · AskUserQuestion'
            if (q >= 0) { rep.shots.question = await shot('question', at(q)); rep.shots.questionPinned = await shot('question-pinned', { f: i => window.__theater.pin(i), a: q }); await th.evaluate(i => window.__theater.pin(i), q); }
          }
          if (name === 'ember') {
            const fire = B.findIndex(b => b.kind === 'fire'), res = B.findIndex(b => b.kind === 'resume');
            const exitCh = data.chapters.findIndex(ch => /^\/exit/.test(ch.title));
            if (fire >= 0) rep.shots.fire = await shot('fire', at(fire));
            if (res >= 0) rep.shots.resumed = await shot('resumed', at(res));
            if (exitCh >= 0) rep.shots.exitChapter = await shot('exit-chapter-tick', at(Math.min(last, (B.findIndex(b => b.ch === exitCh && b.kind === 'command') + 1 || data.chapters[exitCh].beat + 1) - 1)));
            const tickIn = ch => B.filter(b => b.ch === ch && b.kind === 'command').length;
            rep.chapterTicks = data.chapters.map(ch => ({ title: ch.title, ticks: tickIn(ch.i) }));
          }
          if (name === 'delta') {
            const ag = B.filter(b => b.kind === 'agent').slice(0, 6);
            rep.firstFanouts = ag.map(b => ({ i: b.i, t: iso(b.t), title: b.title, branch: b.branch ?? null }));
            if (ag[0]) rep.shots.branch1 = await shot('first-agent', at(ag[0].i));
            if (ag[1]) rep.shots.branch2 = await shot('second-agent', at(ag[1].i));
            if (ag[2]) rep.shots.branch3 = await shot('third-agent', at(ag[2].i));
          }
          save();
        }
        await th.close().catch(() => {});
        await sleep(300);
      }
      rep.firstFrameMedian = med(rep.opens.map(o => o.firstFrameMs)); rep.mainBuildMedian = med(rep.opens.map(o => o.mainBuildMs));
      log(name, 'beats', rep.replay?.beats.length, 'ff', rep.opens.map(o => o.firstFrameMs).join(','), 'build', rep.opens.map(o => o.mainBuildMs).join(','));
      save();
    }
    // ---- verdicts against the acceptance ----
    const r = R.replays, B = n => r[n]?.replay?.beats || [], CH = n => r[n]?.replay?.chapters || [], last = n => B(n)[B(n).length - 1];
    const kReg = R.fleet.members.find(m => m.name === 'kestrel')?.registry, bReg = R.fleet.members.find(m => m.name === 'beacon')?.registry;
    R.checks = {
      a_vibepet: { commits: B('vibepet').filter(b => b.kind === 'commit').length, header: r.vibepet?.replay?.header, chapter1: CH('vibepet')[0]?.title, firstPrompt: r.vibepet?.truth.firstPrompt,
        gitCommitCmdsInTranscript: r.vibepet?.truth.gitCommitCmds },
      b_kestrel: { lastKind: last('kestrel')?.kind, lastTitle: last('kestrel')?.title, lastSince: iso(last('kestrel')?.since), registrySince: kReg?.since, lastStage: r.kestrel?.shots?.end },
      b_beacon: { lastKind: last('beacon')?.kind, lastTitle: last('beacon')?.title, options: last('beacon')?.options, lastSince: iso(last('beacon')?.since), registrySince: bReg?.since },
      c_beacon_questions: { questionBeats: B('beacon').filter(b => b.kind === 'question').length, asksInTranscript: r.beacon?.truth.asks, sample: B('beacon').filter(b => b.kind === 'question').slice(0, 2).map(b => ({ title: b.title, options: b.options, answer: b.answer })),
        lookAskBeats: B('beacon').filter(b => b.kind === 'read' && /AskUserQuestion/.test(b.title)).length },
      c_ember: { fireBeats: B('ember').filter(b => b.kind === 'fire').length, firesInTranscript: r.ember?.truth.fires, resumedChapters: CH('ember').filter(c => c.title === 'Resumed').length,
        exitChaptersWithTicks: (r.ember?.chapterTicks || []).filter(c => /^\/exit/.test(c.title) && c.ticks).length, chapters: r.ember?.chapterTicks, exitsInTranscript: r.ember?.truth.exits, costStates: r.ember?.truth.costStates },
      d_menu: { recentAtVsLastRecordMs: R.menu.recent.h12.map(x => x.atMinusLastRecordMs), ember24h: R.menu.recent.h24.filter(x => x.project === 'ember').map(x => x.label),
        ember: R.menu.items.filter(x => x.member === 'ember').map(x => ({ label: x.label, lastRecord: x.lastRecord, roundsTo: x.roundsTo, ageErrMin: x.ageErrMin })), rawMarkup: R.menu.rawMarkup, orderByLastRecord: R.menu.orderByLastRecord,
        ages: R.menu.items.map(x => ({ member: x.member, session: x.session, age: x.age, roundsTo: x.roundsTo, trueAgeMin: x.trueAgeMin, ageErrMin: x.ageErrMin })) },
      e_delta: { firstFanout: (r.delta?.firstFanouts || []).slice(0, 3).map(x => x.branch), next: (r.delta?.firstFanouts || []).slice(3, 6).map(x => x.branch) },
    };
    R.timing = Object.fromEntries(Object.entries(r).map(([n, x]) => [n, { firstFrameMs: x.opens?.map(o => o.firstFrameMs), firstFrameMedian: x.firstFrameMedian, mainBuildMs: x.opens?.map(o => o.mainBuildMs), mainBuildMedian: x.mainBuildMedian, load: x.opens?.map(o => o.load) }]));
    save();
  } finally {
    R.close = await v.close().catch(e => ({ error: e.message }));
    R.loadEnd = load(); R.endedAt = new Date().toISOString();
    R.fleetSpendAfter = execSync(`node ${path.join(APP, 'test', 'fleet', 'fleet.js')} spend 2>/dev/null | head -1`).toString().trim().slice(0, 140);
    save(); log('done', JSON.stringify(R.close));
  }
})().catch(e => { console.error(e); R.error = String(e.stack || e); save(); process.exit(1); });
