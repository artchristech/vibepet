// node test/gesture.test.js — summon gesture, end to end on synthetic input:
// templates are drawn on the training pad (pointer events, pad scale), summons are free cursor motion polled at
// 16 ms through the real segmenter (speed changes, brief pauses, 0.7–1.6× scale, ±25°, jitter, 1–3 loops),
// and ≥3,000 ordinary-mouse negatives go through the same segmenter. Target: ≥97% recall, 0 false positives at Medium.
const assert = require('assert');
const G = require('../gesture');

let seed = 11;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
const U = (a, b) => a + rnd() * (b - a);

// shapes on a ±100 box; circle takes loops + start phase
const SHAPES = {
  circle: (u, o) => { const a = o.phase + 2 * Math.PI * u * o.loops * o.dir; return [100 * Math.cos(a), 100 * Math.sin(a)]; },
  Z: u => { const s = u * 3; return s < 1 ? [-100 + 200 * s, -80] : s < 2 ? [100 - 200 * (s - 1), -80 + 160 * (s - 1)] : [-100 + 200 * (s - 2), 80]; },
  zigzag: u => [-120 + 240 * u, (Math.floor(u * 4) % 2 ? 1 : -1) * (60 - 120 * ((u * 4) % 1))],
  triangle: u => { const P = [[0, -100], [95, 70], [-95, 70], [0, -100]], s = u * 3, i = Math.min(2, Math.floor(s)), f = s - i; return [P[i][0] + (P[i + 1][0] - P[i][0]) * f, P[i][1] + (P[i + 1][1] - P[i][1]) * f]; },
};
const xf = ([x, y], { scale, rot, ox, oy }) => [ox + (x * Math.cos(rot) - y * Math.sin(rot)) * scale, oy + (x * Math.sin(rot) + y * Math.cos(rot)) * scale];

// training sample: pointer events on the ~240 px pad (~8 ms apart), hand wobble
function padSample(kind, o) {
  const n = 40 + Math.floor(rnd() * 80), out = [], at = { scale: U(0.6, 0.95), rot: U(-0.12, 0.12), ox: 120, oy: 120 };
  for (let i = 0; i < n; i++) {
    const [x, y] = xf(SHAPES[kind](i / (n - 1), o), at);
    out.push({ x: x + gauss() * 1.5, y: y + gauss() * 1.5, t: i * 8 });
  }
  return out;
}
// free cursor motion, polled at 16 ms: still lead-in, uneven speed, brief pauses, still tail → segmenter strokes
function cursorRun(path, { ms, scale = 1, rot = 0, noise = 2, pauses = 0 }) {
  const pts = [], t0 = 1e6, ox = U(300, 1400), oy = U(300, 800);
  let t = t0, u = 0;
  const push = ([x, y]) => pts.push({ x: Math.round(x + gauss() * noise), y: Math.round(y + gauss() * noise), t });
  const p0 = xf(path(0), { scale, rot, ox, oy });
  for (let i = 0; i < 12; i++, t += 16) pts.push({ x: Math.round(p0[0]), y: Math.round(p0[1]), t });   // resting
  const pauseAt = Array.from({ length: pauses }, () => U(0.15, 0.85));
  while (u < 1) {
    const speed = U(0.55, 1.6) / ms;                    // uneven hand speed
    u = Math.min(1, u + speed * 16);
    push(xf(path(u), { scale, rot, ox, oy })); t += 16;
    for (let k = 0; k < pauseAt.length; k++) if (pauseAt[k] < u) { pauseAt.splice(k, 1); const hold = U(40, 110), last = pts[pts.length - 1]; for (let h = 0; h < hold; h += 16, t += 16) pts.push({ ...last, t }); }
  }
  const last = pts[pts.length - 1];
  for (let i = 0; i < 20; i++, t += 16) pts.push({ ...last, t });                                      // resting
  const strokes = [], seg = G.segmenter(s => strokes.push(s));
  for (const p of pts) seg.push(p);
  return strokes;
}

// ---- training on the pad ----
const opt = kind => kind === 'circle' ? { loops: 1 + Math.floor(rnd() * 3), phase: U(0, 6.28), dir: 1 } : {};
const trained = {};
for (const kind of Object.keys(SHAPES)) for (let trial = 0; trial < 20; trial++) {
  const samples = [0, 1, 2].map(() => padSample(kind, opt(kind)));
  assert(samples.every(s => !G.trivial(s)), `${kind}: pad samples must not be trivial`);
  assert.strictEqual(G.consistentSet(samples).length, 3, `${kind}: 3 pad samples (trial ${trial}) should agree`);
  if (!trial) trained[kind] = samples.map(G.template);
}
const mixed = G.consistentSet([padSample('circle', opt('circle')), padSample('Z', {}), padSample('circle', opt('circle'))]);
assert.strictEqual(mixed.length, 2, 'circle, Z, circle → keeps the two circles, asks for one more');
assert(G.trivial([{ x: 0, y: 0 }, { x: 5, y: 3 }]) && G.trivial(Array.from({ length: 20 }, (_, i) => ({ x: i, y: i }))), 'dots and flicks are trivial');
assert(JSON.parse(JSON.stringify(trained.circle))[0].p.length === 64, 'templates survive JSON (state.json)');

// ---- summons: free cursor motion anywhere on screen ----
// A stroke's score doesn't depend on sensitivity, only the bar does: recognize() each stroke once at the most
// permissive level and read the stricter levels off that same score (re-scoring per level cost ~4x the time).
const SENS = ['low', 'med', 'high'];
assert(G.THRESH.high < G.THRESH.med && G.THRESH.med < G.THRESH.low, 'high is the most permissive level');
const okAt = (r, s) => r.ok && r.score >= G.THRESH[s];
const recall = Object.fromEntries(SENS.map(s => [s, 0])); let posN = 0; const missBy = {};
for (const kind of Object.keys(SHAPES)) for (let i = 0; i < 150; i++) {
  const o = opt(kind), loops = o.loops || 1;
  const strokes = cursorRun(u => SHAPES[kind](u, o), { ms: U(450, 900) * loops, scale: U(0.7, 1.6), rot: U(-0.44, 0.44), noise: U(0.5, 3), pauses: Math.floor(rnd() * 3) });
  posN++;
  const rs = strokes.map(st => G.recognize(st, trained[kind], 'high'));
  for (const s of SENS) if (rs.some(r => okAt(r, s))) recall[s]++; else if (s === 'med') missBy[kind] = (missBy[kind] || 0) + 1;
}

// ---- negatives: what the cursor does all day, through the same segmenter ----
const NEG = {
  move: () => { const L = U(150, 1200), a = U(0, 6.28), bend = U(-60, 60); return [u => { const e = u * u * (3 - 2 * u); return [Math.cos(a) * L * e - Math.sin(a) * bend * Math.sin(Math.PI * u), Math.sin(a) * L * e + Math.cos(a) * bend * Math.sin(Math.PI * u)]; }, U(150, 700)]; },
  L: () => { const w = U(100, 400), h = U(100, 400); return [u => u < .5 ? [w * u * 2, 0] : [w, h * (u - .5) * 2], U(300, 900)]; },
  arc: () => { const R = U(80, 300), sweep = U(0.5, 1.2) * Math.PI; return [u => [R * Math.cos(sweep * u), R * Math.sin(sweep * u)], U(250, 800)]; },
  walk: () => { const P = [[0, 0]]; let vx = 0, vy = 0; for (let i = 0; i < 80; i++) { vx += gauss() * 5; vy += gauss() * 5; const [x, y] = P[P.length - 1]; P.push([x + vx, y + vy]); } return [u => P[Math.min(79, Math.floor(u * 79))], U(600, 2400)]; },
  select: () => { const w = U(200, 600), lines = 1 + Math.floor(rnd() * 5); return [u => [w * ((u * lines) % 1), 18 * Math.floor(u * lines)], U(400, 1500)]; },
  shake: () => { const A = U(40, 200), k = 3 + Math.floor(rnd() * 6); return [u => [A * Math.sin(u * k * Math.PI), U(-8, 8)], U(400, 1200)]; },
  back: () => { const L = U(150, 500), a = U(0, 6.28); return [u => { const e = u < .5 ? u * 2 : 2 - u * 2; return [Math.cos(a) * L * e, Math.sin(a) * L * e + U(-6, 6)]; }, U(300, 900)]; },
  // a real scribble, not an ellipse traced over and over (equal x/y frequencies ARE a circle — that's the gesture)
  scribble: () => { const fx = U(5, 19); let fy = U(5, 19); while (fy / fx > 0.7 && fy / fx < 1.45) fy = U(5, 19); const px = U(0, 6), A = U(60, 160), B = U(40, 140); return [u => [A * Math.sin(u * fx + px), B * Math.cos(u * fy)], U(700, 2500)]; },
  hover: () => { const P = []; let x = 0, y = 0; for (let i = 0; i < 60; i++) { x += gauss() * 14; y += gauss() * 14; P.push([x, y]); } return [u => P[Math.min(59, Math.floor(u * 59))], U(800, 2400)]; },
};
const fp = Object.fromEntries(SENS.map(s => [s, 0])); const fpBy = {}; let negN = 0, maxNeg = 0;
const allT = Object.entries(trained);
for (let i = 0; i < 3200; i++) {
  const kind = Object.keys(NEG)[i % Object.keys(NEG).length], [path, ms] = NEG[kind]();
  for (const st of cursorRun(path, { ms, rot: U(0, 6.28), noise: U(0.5, 3), pauses: Math.floor(rnd() * 2) })) {
    negN++;
    const rs = allT.map(([, T]) => G.recognize(st, T, 'high'));   // score is 0 unless plausible: the max is over plausible strokes
    for (const r of rs) maxNeg = Math.max(maxNeg, r.score);
    for (const s of SENS) if (rs.some(r => okAt(r, s))) { fp[s]++; if (s === 'med') fpBy[kind] = (fpBy[kind] || 0) + 1; }
  }
}

const pct = (a, b) => (100 * a / b).toFixed(1) + '%';
for (const s of SENS) console.log(`${s.padEnd(4)} (≥${G.THRESH[s]}): recall ${recall[s]}/${posN} = ${pct(recall[s], posN)} · false positives ${fp[s]}/${negN} strokes`);
console.log(`misses at med by shape:`, missBy, `· med FPs by kind:`, fpBy, `· best negative score ${maxNeg.toFixed(3)}`);
assert(recall.med / posN >= 0.97, 'recall at Medium below 97%');
assert.strictEqual(fp.med, 0, 'false positives at Medium');
console.log('ok');
