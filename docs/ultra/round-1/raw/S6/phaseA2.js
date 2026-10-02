// Phase A — F1 (a server starts in a session's repo → how long until Home's localhost section shows it, and how is it
// labelled) and F4 (it exits → how long until it is gone). Servers run with the member's repo as cwd, the way that
// session would run them: kestrel's own `npm start` (PORT=…), and `python3 -m http.server` in beacon's repo.
'use strict';
const L = require('./lib');
const { sleep } = L;
(async () => {
  const truth0 = L.fleetTruth();
  const ctx = await L.start({ phase: 'A2' });
  const { R } = ctx;
  R.truth0 = truth0; R.pmset0 = L.pmsetTail();
  try {
    const h = await ctx.openHome();
    ctx.timing('home', 'open (click on Net → panel shown)', h.ms, { n: 1 });
    await sleep(800);
    
    const trials = [];
    for (let i = 0; i < 8; i++) { await sleep(Math.round(Math.random() * 12000));
      const kestrel = i % 2 === 0, port = 47131 + i;
      const t = { i, member: 'vibepet', port };
      const s = kestrel ? await L.nodeServer({ cwd: L.repo('vibepet'), port }) : await L.pyHttp({ cwd: L.repo('vibepet'), port });
      t.kind = s.kind; t.listener = s.listener; t.listenAt = s.listenAt;
      const shown = await ctx.waitFooter(f => f.some(x => x.port === port), s.listenAt, 60e3);
      t.shownAt = shown && shown.at; t.f1ms = shown ? shown.at - s.listenAt : null;
      t.label = shown && shown.srv.find(x => x.port === port);
      ctx.timing('F1', `server listening → shown in Home localhost (${t.member}, ${t.kind})`, t.f1ms, { trial: i, port });
      
      await sleep(Math.round(Math.random() * 12000));
      // F4: the server exits (Ctrl-C in its terminal = SIGINT to its process group)
      const sigAt = Date.now(); L.stopOurs(s, 'SIGINT');
      const dead = await L.waitDead(s.listener, 10e3);
      t.deadAt = dead; t.killMs = dead ? dead - sigAt : null;
      const gone = await ctx.waitFooter(f => !f.some(x => x.port === port), dead || sigAt, 60e3);
      t.goneAt = gone && gone.at; t.f4ms = gone && dead ? gone.at - dead : null;
      ctx.timing('F4', `server exited → gone from Home localhost (${t.member})`, t.f4ms, { trial: i, port });
      
      trials.push(t);
      await sleep(500 + Math.round(Math.random() * 2500));
    }
    R.trials = trials;
    const f1 = trials.map(t => t.f1ms), f4 = trials.map(t => t.f4ms);
    R.summary = { f1: { median: L.median(f1), min: Math.min(...f1), max: Math.max(...f1), n: f1.length, all: f1 }, f4: { median: L.median(f4), min: Math.min(...f4), max: Math.max(...f4), n: f4.length, all: f4 } };
    const polls = await ctx.polls(0); const gaps = polls.slice(1).map((p, k) => p.at - polls[k].at);
    R.pollGaps = { median: L.median(gaps), min: Math.min(...gaps), max: Math.max(...gaps), n: gaps.length };
    console.log('SUMMARY', JSON.stringify(R.summary), 'pollGaps', JSON.stringify(R.pollGaps));
  } catch (e) { console.error('PHASE A ERROR', e); R.error = String(e.stack || e); }
  finally {
    R.truth1 = L.fleetTruth(); R.pmset1 = L.pmsetTail();
    const r = await ctx.finish();
    console.log('close', JSON.stringify(r.close));
    process.exit(0);
  }
})();
