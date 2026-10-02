// gesture recapture: the summon gesture on a live test instance (isolated root), trusted CDP input through test/ultra/launch.js.
// node recapture.js <appDir> <outDir> <userData> [oldGesture.js]   → <outDir>/results.json, offline.json, PNGs
// $0: no fleet member takes a turn. The watcher reads the OS cursor (screen.getCursorScreenPoint). The real pointer is the
// user's and stays untouched, so main's cursor feed is replaced by a replay (a timed path, else a parked point): the user's
// own mouse never reaches this instance (OS mouse input passes through the test window too). Net drags are real CDP
// mousedown/up on his pixels, the window following the replayed cursor (main's own drag loop). The gesture is trained on
// the pad with CDP drags (as canon.js does). Every watcher sample (the calls coming from gesture.js) is logged with main's
// drag-start/drag-end, and re-scored offline with this build's gesture.js (and the old one, if given).
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const [APP, OUT, UD, OLDG] = process.argv.slice(2);
if (!APP || !OUT || !UD) { console.error('usage: node recapture.js <appDir> <outDir> <userData> [oldGesture.js]'); process.exit(2); }
const ROOT = path.join(require('os').homedir(), '.vibepet-ultra', 'root', '.claude');
const sleep = ms => new Promise(r => setTimeout(r, ms)), until = t => sleep(Math.max(0, t - Date.now()));
const load = () => execSync('uptime').toString().trim().replace(/^.*load averages?: /, '');
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; };
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
fs.mkdirSync(OUT, { recursive: true });
const R = { app: APP, git: execSync(`git -C ${APP} log -1 --format='%h %s' 2>/dev/null || echo export`).toString().trim(), startedAt: new Date().toISOString(), userData: UD, loadStart: load(), trials: [], resummon: [], copy: {}, failures: [] };
const save = () => fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
const { launch } = require(path.join(APP, 'test', 'ultra', 'launch.js'));
const { instrument, clickMenu } = require(path.join(APP, 'test', 'ultra', 'canon.js'));

// ---- paths (screen px, sampled at constant speed) ----
const sample = (f, n = 400) => Array.from({ length: n + 1 }, (_, i) => f(i / n)).map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
const circle = (c, r, dir = 1, a0 = 0, turns = 1) => u => [c.x + r * Math.cos(a0 + dir * 2 * Math.PI * turns * u), c.y + r * Math.sin(a0 + dir * 2 * Math.PI * turns * u)];
const poly = V => { const L = V.slice(1).map((p, i) => Math.hypot(p[0] - V[i][0], p[1] - V[i][1])), T = L.reduce((a, b) => a + b);
  return u => { let d = u * T, i = 0; while (i < L.length - 1 && d > L[i]) d -= L[i++]; const f = Math.min(1, d / L[i]); return [V[i][0] + (V[i + 1][0] - V[i][0]) * f, V[i][1] + (V[i + 1][1] - V[i][1]) * f]; }; };
const at = (c, P) => P.map(([x, y]) => [c.x + x, c.y + y]);
const SQ = [[-90, -90], [90, -90], [90, 90], [-90, 90], [-90, -90]];                   // 180 px, clockwise on screen (y down)
const ZIG = [[-120, -60], [-60, 60], [0, -60], [60, 60], [120, -60]], ZED = [[-100, -80], [100, -80], [-100, 80], [100, 80]];

// ---- main: the cursor replay, the toggle log, the drag log ----
function install(electron) {
  const { screen, ipcMain } = electron;
  const G = globalThis.__gr = { pts: null, t0: 0, ms: 0, park: { x: 0, y: 0 }, samples: [], events: [], drags: [], onHide: null };
  screen.__real ||= screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint = () => {
    const now = Date.now(); let p = G.park;
    if (G.pts && now >= G.t0) {
      const u = Math.min(1, (now - G.t0) / G.ms), f = u * (G.pts.length - 1), i = Math.floor(f), k = f - i, a = G.pts[i], b = G.pts[Math.min(G.pts.length - 1, i + 1)];
      p = { x: Math.round(a[0] + (b[0] - a[0]) * k), y: Math.round(a[1] + (b[1] - a[1]) * k) };
      if (u >= 1) { G.park = p; G.pts = null; }
    }
    if (/gesture\.js/.test(new Error().stack)) { G.samples.push({ x: p.x, y: p.y, t: now }); if (G.samples.length > 40000) G.samples.splice(0, 10000); }
    return p;
  };
  // the test window sits on the real screen, always on top: real OS mouse input passes through it (to the user's own windows)
  // and never reaches this instance, so a stray real move or click can't end a CDP press; CDP input is unaffected
  const w = globalThis.__vibepet.win();
  w.__sime ||= w.setIgnoreMouseEvents.bind(w); w.setIgnoreMouseEvents = () => w.__sime(true, { forward: false }); w.__sime(true, { forward: false });
  const wc = w.webContents;
  wc.__gsend ||= wc.send.bind(wc);
  wc.send = (ch, ...a) => {
    if (ch === 'hide' || ch === 'summon') { const t = Date.now(); G.events.push({ ch, t }); if (ch === 'hide' && G.onHide) { const h = G.onHide; G.onHide = null; h(t); } }
    return wc.__gsend(ch, ...a);
  };
  ipcMain.on('drag-start', () => G.drags.push({ start: Date.now(), end: null }));
  ipcMain.on('drag-end', () => { const d = G.drags[G.drags.length - 1]; if (d && !d.end) d.end = Date.now(); });
  return true;
}

(async () => {
  const v = await launch({ appDir: APP, root: ROOT, userData: UD, state: { setupDone: true, gesture: { on: false, sens: 'med', templates: [] } } });
  const W = v.win;
  try {
    R.readyMs = v.readyMs;
    await v.evalMain(instrument); await v.evalMain(install);
    const vis = () => v.evalMain(() => globalThis.__vibepet.win().isVisible());
    const bounds = () => v.evalMain(() => globalThis.__vibepet.win().getBounds());
    const park = p => v.evalMain((_, p) => { globalThis.__gr.park = { x: Math.round(p[0]), y: Math.round(p[1]) }; globalThis.__gr.pts = null; }, p);
    // the path starts `lead` ms after main receives it (main's clock): a slow evalMain under load can't skip its start
    const setPath = (pts, ms, lead = 80) => v.evalMain((_, a) => { const G = globalThis.__gr; Object.assign(G, { pts: a.pts, ms: a.ms, t0: Date.now() + a.lead }); return G.t0; }, { pts, ms, lead });
    const events = since => v.evalMain((_, s) => globalThis.__gr.events.filter(e => e.t >= s), since);
    const shot = async name => { try { await Promise.race([v.shot(path.join(OUT, name)), sleep(4000).then(() => { throw new Error('shot timeout'); })]); return name; } catch (e) { return `${name}: ${e.message}`; } };
    const petScreen = async () => { const p = await v.petPoint(), b = await bounds(); return { page: p, screen: { x: b.x + p.x, y: b.y + p.y } }; };
    // a press point on Net that nothing covers (an open Home or a bubble can sit over part of him): the opaque pixel nearest
    // launch.js's own pick whose topmost element is his canvas; also says what covered launch.js's pick, if anything
    const petPress = async () => {
      const home = await v.homeMode(), p0 = await v.petPoint(), b = await bounds();
      const r = await W.evaluate(p0 => {
        const c = document.getElementById('pet'), cr = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const who = el => !el ? null : el === c ? 'pet' : (el.id ? '#' + el.id : el.tagName.toLowerCase()) + (el.closest('[id]') && el.closest('[id]') !== el ? ' in #' + el.closest('[id]').id : '');
        const A = (x, y) => x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : d[(y * c.width + x) * 4 + 3];
        let best = null;
        for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
          if (A(x, y) < 250 || [[6, 0], [-6, 0], [0, 6], [0, -6]].some(([dx, dy]) => A(x + dx, y + dy) < 200)) continue;
          const px = cr.left + (x + 0.5) * cr.width / c.width, py = cr.top + (y + 0.5) * cr.height / c.height;
          if (document.elementFromPoint(px, py) !== c) continue;
          const dd = Math.hypot(px - p0.x, py - p0.y); if (!best || dd < best.dd) best = { x: px, y: py, dd };
        }
        return { at0: who(document.elementFromPoint(p0.x, p0.y)), best };
      }, p0);
      const p = r.best || p0;
      return { page: { x: p.x, y: p.y }, screen: { x: b.x + p.x, y: b.y + p.y }, coveredBy: r.at0 === 'pet' ? null : r.at0, uncovered: !!r.best, home };
    };
    const menu = async trail => {   // ⋯ on Home → a native menu (captured by canon's instrument) → click down the trail
      if (!(await v.homeMode())) await v.openHome();
      const t = Date.now(); await W.locator('#homeMore').click();
      for (let i = 0; i < 30 && !(await v.evalMain((_, t) => globalThis.__canon.calls.some(c => c.kind === 'menuPopup' && c.at >= t), t)); i++) await sleep(100);
      return v.evalMain(clickMenu, { trail });
    };
    // where strokes are drawn: up-left of where Net starts (bottom-right of the main display)
    const S0 = (await petScreen()).screen, C0 = { x: Math.round(S0.x - 260), y: Math.round(S0.y - 220) };
    R.home = { petScreen: S0, strokeCentre: C0, bounds: await bounds() };
    let lastToggle = 0, restoreShape = () => circle(C0, 110), tplKind = 'circle';   // the trained shape brings him back / sends him away

    // ---- train on the pad: 3 strokes, CDP drags on the canvas (canon.js's loop for a circle) ----
    async function train(kind, shots) {
      await park([C0.x - 400, C0.y - 200]); await sleep(600);   // the cursor away from Net while training (near him, his pill opens over the pad)
      const m = await menu(['^Settings$', '^Gesture$', '^Record']);
      const open = await W.waitForSelector('#gest:not(.hidden) #gestPad', { timeout: 5000 }).then(() => true).catch(() => false);
      if (!open) throw new Error(`pad did not open: ${JSON.stringify(m)}`);
      await sleep(300);
      const out = { kind, menu: m };
      if (shots?.pad) { out.padCopy = await W.evaluate(() => document.querySelector('#gest p.dim')?.textContent); out.padShot = await shot(shots.pad); }
      const b = await W.locator('#gestPad').boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2, rr = b.width * 0.32;
      const P = kind === 'circle' ? Array.from({ length: 37 }, (_, i) => { const a = i / 36 * 2 * Math.PI * 0.95; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)]; })
        : sample(poly((kind === 'zigzag' ? ZIG : ZED).map(([x, y]) => [cx + x * rr / 120, cy + y * rr / 120])), 36);
      for (let s = 0; s < 3; s++) {
        await W.mouse.move(P[0][0], P[0][1]); await W.mouse.down();
        for (const [x, y] of P.slice(1)) { await W.mouse.move(x, y); await sleep(8); }
        await W.mouse.up(); await sleep(450);
      }
      out.saved = await W.waitForFunction(() => /^Saved/.test(document.getElementById('gestMsg')?.textContent || '') && document.getElementById('gestMsg').textContent, null, { timeout: 5000 }).then(h => h.jsonValue()).catch(() => null);
      if (shots?.saved) out.savedShot = await shot(shots.saved);
      out.templates = await v.evalMain(() => (globalThis.__vibepet.state().gesture?.templates || []).length);
      out.on = await v.evalMain(() => globalThis.__vibepet.state().gesture?.on);
      await sleep(3000);   // the pad closes itself 2.8 s after Saved
      log('trained', kind, out.saved, out.templates);
      return out;
    }

    // ---- one stroke: park at its start (still), replay it; drag = press on Net first, release at its end ----
    async function trial(label, mk, ms, { drag = false, expect = null, group = null, shots = null } = {}) {
      await until(lastToggle + 2700);   // every trial clear of the old build's 2.5 s lockout (r12 has its own trials below)
      let pp = null, start = null, press = null;
      if (drag) { press = await petPress(); pp = press.page; start = press.screen; }
      const f = mk(start), pts = sample(f), vis0 = await vis(), l = load();
      await park(pts[0]); await sleep(450);
      if (shots?.before) await shot(shots.before);
      let downAt = null, upAt = null;
      if (drag) { await W.mouse.move(pp.x, pp.y); await W.mouse.down(); downAt = Date.now(); await sleep(60); }
      const b0 = drag ? await bounds() : null, t0 = await setPath(pts, ms), end = t0 + ms;
      let bMid = null;
      if (drag) { await until(t0 + ms / 2); bMid = await bounds(); }   // the window follows the cursor while main's drag is on
      await until(end + 25);
      if (drag) { await W.mouse.up(); upAt = Date.now(); if (shots?.release) await shot(shots.release); }
      await until(end + 1100);
      const ev = await events(t0), vis1 = await vis();
      if (ev.length) lastToggle = ev[ev.length - 1].t;
      if (shots?.after) await shot(shots.after);
      const r = { label, group, tplKind, drag, ms, t0, end, downAt, upAt, vis0, vis1, toggled: ev[0]?.ch || null, msAfterEnd: ev[0] ? ev[0].t - end : null, toggles: ev.length, expect, load: l };
      if (drag) {   // main's drag-start/drag-end around this press: it must span the whole loop (a drag-end before the release = the press was lost)
        const d = (await v.evalMain(() => globalThis.__gr.drags)).filter(x => x.start >= downAt - 400 && x.start <= end);
        r.mainDrag = d.map(x => ({ startVsT0: x.start - t0, endVsEnd: x.end == null ? null : x.end - end }));
        r.dragSpansLoop = d.some(x => x.start <= t0 && (x.end == null || x.end >= end));
        r.windowFollowed = !!(b0 && bMid && Math.hypot(bMid.x - b0.x, bMid.y - b0.y) > 40);
        r.press = { coveredAtLaunchPick: press.coveredBy, onUncoveredPixel: press.uncovered, homeAtPress: press.home };
      }
      r.pass = expect == null ? null : expect === 'none' ? !ev.length : ev[0]?.ch === expect;
      R.trials.push(r); save();
      log(label.padEnd(44), `vis ${vis0}→${vis1}`, `toggled ${r.toggled}${r.msAfterEnd != null ? ` +${r.msAfterEnd} ms` : ''}`, expect ? (r.pass ? 'PASS' : 'FAIL') : '');
      return r;
    }
    // back to visible/hidden with the trained shape, after any lockout (the old build's is 2.5 s)
    async function ensure(want) {
      for (let i = 0; i < 2 && (await vis()) !== want; i++) await trial(`restore → ${want ? 'visible' : 'hidden'}`, restoreShape, 700, { group: 'restore' });
      if ((await vis()) !== want) throw new Error(`could not get Net ${want ? 'visible' : 'hidden'}`);
    }

    // 1. a clockwise circle, trained on the pad; the pad and Saved copy
    R.train = [await train('circle', { pad: '01-pad-copy.png', saved: '02-saved-copy.png' })];
    R.copy = { pad: R.train[0].padCopy, saved: R.train[0].saved };
    R.templates = { circle: await v.evalMain(() => globalThis.__vibepet.state().gesture.templates) };
    await ensure(true);
    await trial('sanity: cw circle r110 600 ms (visible)', () => circle(C0, 110), 600, { group: 'sanity', expect: 'hide' });
    await ensure(false); await sleep(400);
    await trial('sanity: cw circle r110 600 ms (hidden)', () => circle(C0, 110), 600, { group: 'sanity', expect: 'summon' });

    // 2. dragging Net round a closed loop, button held on him (r09): 4 closed loops, then a 0.85 and a 0.8 turn
    for (let i = 0; i < 4; i++) {
      await ensure(true); await sleep(400);
      await trial(`loop drag of Net #${i + 1}: closed r110 900 ms, button held`, s => circle({ x: s.x - 110 * Math.SQRT1_2, y: s.y - 110 * Math.SQRT1_2 }, 110, 1, Math.PI / 4), 900,
        { drag: true, group: 'drag', expect: 'none', shots: i ? null : { before: '03-loop-drag-before.png', release: '04-loop-drag-released.png', after: '05-loop-drag-after-1s.png' } });
    }
    for (const turns of [0.85, 0.8]) {
      await ensure(true); await sleep(400);
      await trial(`loop drag of Net: ${turns} turn r110 900 ms, button held`, s => circle({ x: s.x - 110 * Math.SQRT1_2, y: s.y - 110 * Math.SQRT1_2 }, 110, 1, Math.PI / 4, turns), 900, { drag: true, group: 'drag-partial', expect: 'none' });
    }
    // control: the same closed loop from the same spot, no button → it is the gesture
    await ensure(true); await sleep(400);
    { const s = (await petScreen()).screen;
      await trial('control: same closed loop, no button', () => circle({ x: s.x - 110 * Math.SQRT1_2, y: s.y - 110 * Math.SQRT1_2 }, 110, 1, Math.PI / 4), 900, { group: 'drag-control', expect: 'hide' }); }

    // 3. a 180 px square, clockwise, 0.8 s (r10): Medium ×3, then Low ×2 (with a circle at Low as the control)
    for (let i = 0; i < 3; i++) {
      await ensure(true); await sleep(400);
      await trial(`square 180 px cw 800 ms #${i + 1} (Medium)`, () => poly(at(C0, SQ)), 800, { group: 'square-med', expect: 'none', shots: i === 2 ? { after: '06-square-medium-after.png' } : null });
    }
    await ensure(true); R.lowMenu = await menu(['^Settings$', '^Gesture$', '^Sensitivity$', '^Low$']); await sleep(300);
    R.sensAfterLow = await v.evalMain(() => globalThis.__vibepet.state().gesture.sens);
    for (let i = 0; i < 2; i++) { await ensure(true); await sleep(400); await trial(`square 180 px cw 800 ms #${i + 1} (Low)`, () => poly(at(C0, SQ)), 800, { group: 'square-low', expect: 'none' }); }
    await ensure(true); await sleep(400);
    await trial('control: cw circle (Low)', () => circle(C0, 110), 600, { group: 'low-control', expect: 'hide' });
    await ensure(true); R.medMenu = await menu(['^Settings$', '^Gesture$', '^Sensitivity$', '^Medium$']); await sleep(300);
    R.sensAfterMed = await v.evalMain(() => globalThis.__vibepet.state().gesture.sens);

    // 4. counter-clockwise circles, r110 0.6 s (r11): each one toggles
    await ensure(true); await sleep(400);
    for (let i = 0; i < 3; i++) {
      const want = (await vis()) ? 'hide' : 'summon';
      await trial(`ccw circle r110 600 ms #${i + 1}`, () => circle(C0, 110, -1, i * 2.1), 600, { group: 'ccw', expect: want, shots: want === 'summon' ? { after: '07-ccw-circle-summoned.png' } : null });
      await sleep(400);
    }

    // 5. hide, then redraw at once (r12): the re-summon circle ends 0.55 / 1.2 / 1.9 s after the hide was sent.
    // The second path is scheduled inside main off the 'hide' send itself, so its timing doesn't depend on this script.
    for (const [target, ms2] of [[550, 450], [1200, 600], [1900, 600]]) {
      await ensure(true); await until(lastToggle + 2700);
      const pts = sample(circle(C0, 110)), l = load();
      await park(pts[0]); await sleep(450);
      await v.evalMain((_, a) => { const G = globalThis.__gr; G.resum = null; G.onHide = t => { const t0 = Math.max(Date.now() + 20, t + a.target - a.ms2); G.resum = { hideAt: t, t0, end: t0 + a.ms2 }; Object.assign(G, { pts: a.pts, t0, ms: a.ms2 }); }; }, { target, ms2, pts });
      const t0 = await setPath(pts, 600);
      await until(t0 + 600 + 1600 + target);
      const rs = await v.evalMain(() => globalThis.__gr.resum), ev = await events(t0), vis1 = await vis();
      if (ev.length) lastToggle = ev[ev.length - 1].t;
      const sum = rs ? ev.find(e => e.ch === 'summon' && e.t > rs.hideAt) : null;
      const r = { target, ms2, hid: !!rs, hideAt: rs?.hideAt ?? null, resummonEnd: rs?.end ?? null, endAfterHide: rs ? rs.end - rs.hideAt : null, summoned: !!sum, msAfterEnd: sum ? sum.t - rs.end : null, vis1, load: l, pass: !!sum && vis1 };
      R.resummon.push(r); save();
      log(`re-summon ending ${r.endAfterHide} ms after the hide`.padEnd(44), `summoned ${r.summoned}${r.msAfterEnd != null ? ` +${r.msAfterEnd} ms` : ''}`, r.pass ? 'PASS' : 'FAIL');
      if (target === 1200) await shot('08-resummoned.png');
      await v.evalMain(() => { globalThis.__gr.onHide = null; });
    }

    // 6. the earlier true positives at Medium: a circle (above), a zig-zag and a Z, each trained on the pad
    for (const [kind, P] of [['zigzag', ZIG], ['Z', ZED]]) {
      await ensure(true); await sleep(300);
      R.train.push(await train(kind));
      R.templates[kind] = await v.evalMain(() => globalThis.__vibepet.state().gesture.templates);
      restoreShape = () => poly(at(C0, P)); tplKind = kind;
      await ensure(true); await sleep(400);
      for (let i = 0; i < 2; i++) {
        const want = (await vis()) ? 'hide' : 'summon';
        await trial(`${kind} 700 ms #${i + 1} (trained ${kind}, Medium)`, () => poly(at(C0, P)), 700, { group: `tp-${kind}`, expect: want });
        await sleep(400);
        if (want === 'hide') { await ensure(false); }
      }
      await sleep(300);
    }
    await ensure(true);
    await shot('09-end.png');

    // ---- offline: the watcher's own samples per trial, through gesture.js (this build, and the old one) ----
    const S = await v.evalMain(() => ({ samples: globalThis.__gr.samples, drags: globalThis.__gr.drags }));
    const builds = { this: require(path.join(APP, 'gesture.js')), ...(OLDG ? { other: require(path.resolve(OLDG)) } : {}) };
    const tplFor = t => R.templates[t.tplKind || 'circle'];
    const held = t => S.drags.some(d => d.start <= t && (d.end == null || d.end >= t));
    const offline = { note: 'samples = what the watcher polled (screen.getCursorScreenPoint called from gesture.js); held = inside a drag-start..drag-end of main; best = top recognize() score of the strokes cut from the samples with no button info; fires = a stroke cut with the button info fires at that level; scores against the templates trained in this run',
      gesture: { this: path.join(APP, 'gesture.js'), other: OLDG ? path.resolve(OLDG) : null }, thresholds: { this: builds.this.THRESH, other: builds.other?.THRESH }, trials: [] };
    for (const t of R.trials) {
      const pts = S.samples.filter(p => p.t >= t.t0 - 700 && p.t <= t.end + 900), row = { label: t.label, group: t.group, samples: pts.length };
      for (const [k, G] of Object.entries(builds)) {
        const strokes = [], seg = G.segmenter(s => strokes.push(s));
        for (const p of pts) seg.push({ ...p, held: held(p.t) });
        const raw = []; const seg2 = G.segmenter(s => raw.push(s)); for (const p of pts) seg2.push({ x: p.x, y: p.y, t: p.t });   // the same samples with no button info
        const sc = raw.map(s => G.recognize(s, tplFor(t), 'high').score);
        row[k] = { strokes: strokes.length, strokesIgnoringButton: raw.length, best: sc.length ? +Math.max(...sc).toFixed(3) : 0,
          fires: Object.fromEntries(['low', 'med', 'high'].map(s => [s, strokes.some(st => G.recognize(st, tplFor(t), s).ok)])) };
      }
      offline.trials.push(row);
    }
    fs.writeFileSync(path.join(OUT, 'offline.json'), JSON.stringify(offline, null, 2));
    fs.writeFileSync(path.join(OUT, 'samples.json'), JSON.stringify(S));
    R.offline = offline.trials.map(r => ({ label: r.label, this: r.this?.best, other: r.other?.best, thisFiresMed: r.this?.fires.med, otherFiresMed: r.other?.fires.med }));
  } catch (e) { R.failures.push(e.stack || String(e)); R.appLog = v.logs.join('').slice(-4000); log('ERROR', e.message); }
  finally {
    const by = g => R.trials.filter(t => t.group === g);
    const tally = g => { const a = by(g); return { n: a.length, toggled: a.filter(t => t.toggles).length, pass: a.filter(t => t.pass).length, medianMsAfterEnd: med(a.map(t => t.msAfterEnd)) }; };
    R.summary = { drag: tally('drag'), dragPartial: tally('drag-partial'), dragControl: tally('drag-control'), squareMed: tally('square-med'), squareLow: tally('square-low'), lowControl: tally('low-control'),
      ccw: tally('ccw'), sanity: tally('sanity'), zigzag: tally('tp-zigzag'), Z: tally('tp-Z'),
      resummon: { n: R.resummon.length, pass: R.resummon.filter(r => r.pass).length, endAfterHide: R.resummon.map(r => r.endAfterHide), medianMsAfterEnd: med(R.resummon.map(r => r.msAfterEnd)) },
      toggleLatencyMs: { median: med(R.trials.filter(t => t.toggles).map(t => t.msAfterEnd)), n: R.trials.filter(t => t.toggles).length } };
    R.loadEnd = load();
    R.close = await v.close().catch(e => ({ error: e.message }));
    R.finishedAt = new Date().toISOString(); save();
    log('summary', JSON.stringify(R.summary));
    log('close', JSON.stringify(R.close));
  }
})();
