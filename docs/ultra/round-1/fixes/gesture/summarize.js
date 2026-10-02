// node summarize.js <newGesture.js> <oldGesture.js> → summary.json: the acceptance checklist from after/ (and before/harness/
// when it exists), plus the after run's recorded strokes re-scored offline against the round-1 critic's own templates.
const path = require('path'), fs = require('fs');
const D = __dirname, [NEWG, OLDG] = process.argv.slice(2);
const rd = f => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch { return null; } };
const A = rd('after/results.json'), S = rd('after/samples.json'), B = rd('before/harness/results.json'), A2 = rd('after/repeat/results.json'), critT = rd('before/critic/gesture-templates.json');
const G = { new: require(path.resolve(NEWG)), old: require(path.resolve(OLDG)) };
const by = (R, g) => (R?.trials || []).filter(t => t.group === g);
const frac = (a, f) => `${a.filter(f).length}/${a.length}`;
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; };
// the critic's templates (trained on their own pad, round 1) against what the watcher really polled in the after run
const held = t => S.drags.some(d => d.start <= t && (d.end == null || d.end >= t));
const critic = (A?.trials || []).filter(t => t.group && t.group !== 'restore' && !/^tp-/.test(t.group)).map(t => {
  const pts = S.samples.filter(p => p.t >= t.t0 - 700 && p.t <= t.end + 900), row = { label: t.label };
  for (const [k, g] of Object.entries(G)) {
    const raw = [], seg = g.segmenter(s => raw.push(s)); for (const p of pts) seg.push({ x: p.x, y: p.y, t: p.t });
    const kept = [], seg2 = g.segmenter(s => kept.push(s)); for (const p of pts) seg2.push({ ...p, held: held(p.t) });
    row[k] = { best: +Math.max(0, ...raw.map(s => g.recognize(s, critT, 'high').score)).toFixed(3), firesMed: kept.some(s => g.recognize(s, critT, 'med').ok), firesLow: kept.some(s => g.recognize(s, critT, 'low').ok) };
  }
  return row;
});
const live = R => R && {
  loopDragHides: frac(by(R, 'drag'), t => t.toggled === 'hide'), loopDragPressSpansLoop: frac(by(R, 'drag'), t => t.dragSpansLoop), loopDragWindowFollowed: frac(by(R, 'drag'), t => t.windowFollowed),
  partialLoopDragHides: frac(by(R, 'drag-partial'), t => t.toggled === 'hide'), sameLoopNoButtonHides: frac(by(R, 'drag-control'), t => t.toggled === 'hide'),
  squareMediumToggles: frac(by(R, 'square-med'), t => t.toggles), squareLowToggles: frac(by(R, 'square-low'), t => t.toggles), circleLowToggles: frac(by(R, 'low-control'), t => t.toggles),
  ccwCircleToggles: frac(by(R, 'ccw'), t => t.toggles), resummon: R.resummon.map(r => ({ endAfterHideMs: r.endAfterHide, summoned: r.summoned, msAfterEnd: r.msAfterEnd, load: r.load })),
  resummonSummoned: `${R.resummon.filter(r => r.summoned).length}/${R.resummon.length}`,
  truePositivesMedium: { circle: frac(by(R, 'sanity'), t => t.toggles), zigzag: frac(by(R, 'tp-zigzag'), t => t.toggles), Z: frac(by(R, 'tp-Z'), t => t.toggles) },
  toggleLatencyMs: { median: med(R.trials.filter(t => t.toggles).map(t => t.msAfterEnd)), n: R.trials.filter(t => t.toggles).length },
  copy: R.copy, load: { start: R.loadStart, end: R.loadEnd, perTrial: R.trials.map(t => t.load) }, failures: R.failures, close: R.close,
};
const sq = critic.filter(r => /^square/.test(r.label));
const out = {
  branch: 'ultra/r1/gesture', app: A?.app, git: A?.git, after: live(A), afterRepeat: live(A2), beforeSameHarness: live(B),
  toggleLatencyMedianOfRunsMs: med([live(A)?.toggleLatencyMs.median, live(A2)?.toggleLatencyMs.median]),
  canon: ['canon', 'canon-r2'].map(d => { const c = rd(`${d}/canon.json`); return c && { dir: d, git: c.git, pass: `${c.assertions.filter(x => x.ok).length}/${c.assertions.length}`, uptime: fs.readFileSync(path.join(D, `${d}.uptime`), 'utf8').trim().split('\n') }; }),
  npmTest: (() => { try { const t = fs.readFileSync(path.join(D, 'npm-test.txt'), 'utf8'); return { pass: (t.match(/^# pass (\d+)/m) || [])[1], fail: (t.match(/^# fail (\d+)/m) || [])[1], total: (t.match(/^npm test.*?([\d.]+) total$/m) || [])[1] + ' s' }; } catch { return null; } })(),
  offline: {
    note: 'after-run watcher samples re-scored with gesture.js (new = this branch, old = ultra/round-1 8e5fe27). best = top score ignoring the button; firesMed/firesLow = a stroke kept after the drag check fires',
    againstThisRunsTemplates: (rd('after/offline.json')?.trials || []).filter(r => r.group !== 'restore').map(r => ({ label: r.label, new: r.this?.best, old: r.other?.best, newFiresMed: r.this?.fires.med, oldFiresMed: r.other?.fires.med })),
    againstCriticTemplates: critic,
    squareVsThresholds: { thresholds: G.new.THRESH, newBest: Math.max(...sq.map(r => r.new.best)), oldBest: Math.max(...sq.map(r => r.old.best)) },
  },
};
fs.writeFileSync(path.join(D, 'summary.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ after: out.after && { ...out.after, load: undefined, resummon: undefined }, before: out.beforeSameHarness && { ...out.beforeSameHarness, load: undefined, resummon: undefined, copy: undefined }, square: out.offline.squareVsThresholds }, null, 1));
