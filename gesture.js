// vibepet summon gesture — a $1-unistroke recognizer (Wobbrock et al. 2007) over the global cursor stream.
// No hooks, no Accessibility: we only sample screen.getCursorScreenPoint(), and only while a gesture is on or being recorded.
const N = 64, SIZE = 250, HALF_DIAG = 0.5 * Math.hypot(SIZE, SIZE), PHI = 0.5 * (Math.sqrt(5) - 1), RANGE = Math.PI / 4, PREC = Math.PI / 90;
const THRESH = { low: 0.88, med: 0.85, high: 0.825 };   // min $1 score to fire (tuned by test/gesture.test.js)

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const pathLen = pts => pts.reduce((s, p, i) => i ? s + dist(pts[i - 1], p) : 0, 0);
const centroid = pts => { let x = 0, y = 0; for (const p of pts) { x += p.x; y += p.y; } return { x: x / pts.length, y: y / pts.length }; };
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function resample(pts, n = N) {
  const I = pathLen(pts) / (n - 1), out = [{ ...pts[0] }], src = pts.map(p => ({ x: p.x, y: p.y }));
  let D = 0;
  for (let i = 1; i < src.length; i++) {
    const d = dist(src[i - 1], src[i]);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d, q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y) };
      out.push(q); src.splice(i, 0, q); D = 0;
    } else D += d;
  }
  while (out.length < n) out.push({ ...src[src.length - 1] });
  return out.slice(0, n);
}
function rotateBy(pts, a) {
  const c = centroid(pts), cos = Math.cos(a), sin = Math.sin(a);
  return pts.map(p => ({ x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x, y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y }));
}
// resample → rotate to indicative angle → scale to box → centre on origin
function normalize(raw) {
  let pts = resample(raw);
  const c = centroid(pts);
  pts = rotateBy(pts, -Math.atan2(c.y - pts[0].y, c.x - pts[0].x));
  const b = bbox(pts);
  pts = pts.map(p => ({ x: p.x * SIZE / (b.w || 1), y: p.y * SIZE / (b.h || 1) }));
  const c2 = centroid(pts);
  return pts.map(p => ({ x: +(p.x - c2.x).toFixed(2), y: +(p.y - c2.y).toFixed(2) }));
}
const pathDist = (a, b) => a.reduce((s, p, i) => s + dist(p, b[i]), 0) / a.length;
function distAtBestAngle(pts, T) {
  let a = -RANGE, b = RANGE, x1 = PHI * a + (1 - PHI) * b, x2 = (1 - PHI) * a + PHI * b;
  let f1 = pathDist(rotateBy(pts, x1), T), f2 = pathDist(rotateBy(pts, x2), T);
  while (Math.abs(b - a) > PREC) {
    if (f1 < f2) { b = x2; x2 = x1; f2 = f1; x1 = PHI * a + (1 - PHI) * b; f1 = pathDist(rotateBy(pts, x1), T); }
    else { a = x1; x1 = x2; f1 = f2; x2 = (1 - PHI) * a + PHI * b; f2 = pathDist(rotateBy(pts, x2), T); }
  }
  return Math.min(f1, f2);
}
// total signed turning of a path, in turns (a circle ≈ ±1, three loops ≈ ±3)
function turns(pts) {
  let a = 0, prev = null;
  for (let i = 2; i < pts.length; i++) {
    const h0 = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x), h1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; a += d;
  }
  return a / (2 * Math.PI);
}
// A loopy stroke (circle drawn 1–3 times) is compared by its first full loop, so "one circle" and
// "a scribbled triple circle" are the same gesture. Only when it really is the same loop repeated: every loop
// must close, sit on the same spot, be the same size and the same shape — a scribble's loops never are.
function loopsOf(pts) {
  const r = resample(pts, 128), out = [];
  let a = 0, from = 0;
  for (let i = 2; i < r.length; i++) {
    const h0 = Math.atan2(r[i - 1].y - r[i - 2].y, r[i - 1].x - r[i - 2].x), h1 = Math.atan2(r[i].y - r[i - 1].y, r[i].x - r[i - 1].x);
    let d = h1 - h0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; a += d;
    if (Math.abs(a) >= 2 * Math.PI * 0.97) { out.push(r.slice(from, i + 1)); from = i; a = 0; }
  }
  return { loops: out, rest: r.slice(from) };
}
function firstLoop(pts) {
  if (Math.abs(turns(resample(pts, 96))) < 1.5) return null;
  const { loops, rest } = loopsOf(pts);
  if (loops.length < 1 || loops.length + (rest.length > 12 ? 1 : 0) < 2) return null;
  const L = loops[0], bL = bbox(L), dL = Math.hypot(bL.w, bL.h), cL = centroid(L), nL = normalize(L);
  if (L.length < 12 || dist(L[0], L[L.length - 1]) > 0.35 * dL) return null;
  for (const M of loops.slice(1)) {
    const bM = bbox(M), dM = Math.hypot(bM.w, bM.h);
    if (dM / dL < 0.6 || dM / dL > 1.6 || dist(centroid(M), cL) > 0.35 * dL || dist(M[0], M[M.length - 1]) > 0.35 * dM) return null;
    if (M.length >= 12 && 1 - distAtBestAngle(normalize(M), nL) / HALF_DIAG < 0.8) return null;
  }
  return L;
}
// every shape a stroke can be compared as: itself, and its first loop if it's a closed multi-loop scribble
function variants(raw) {
  const v = [normalize(raw)], l = firstLoop(raw);
  if (l) v.push(normalize(l));
  return v;
}
// best $1 score (0..1) of a stroke (normalized, or its variants) against normalized templates (+ their loop variants)
function score(norm, templates) {
  const A = Array.isArray(norm[0]) ? norm : [norm];
  let best = 0;
  for (const T of templates) for (const t of Array.isArray(T) ? [T] : [T.p, ...(T.loop ? [T.loop] : [])]) for (const a of A) best = Math.max(best, 1 - distAtBestAngle(a, t) / HALF_DIAG);
  return best;
}
// a stored template: its normalized points, plus its first loop when it's a multi-loop circle
// (plain arrays from older saves still work)
function template(raw) { const l = firstLoop(raw); return { p: normalize(raw), loop: l ? normalize(l) : null }; }

// Cheap shape gates that ordinary mouse use fails long before $1 runs: big enough in BOTH dimensions
// (kills lines, scrolls, window-to-window moves), and a path that doubles back on itself (kills L-shapes and arcs).
const GATE = { minSide: 35, minBig: 90, minTurn: 1.6, minPts: 8, maxMs: 3500 };
function plausible(raw) {
  if (raw.length < GATE.minPts) return false;
  const b = bbox(raw), ms = raw[raw.length - 1].t - raw[0].t;
  if (Math.max(b.w, b.h) < GATE.minBig || Math.min(b.w, b.h) < GATE.minSide || ms > GATE.maxMs) return false;
  return pathLen(raw) / Math.hypot(b.w, b.h) >= GATE.minTurn;
}
function recognize(raw, templates, sens = 'med') {
  if (!templates?.length || !plausible(raw)) return { ok: false, score: 0 };
  const s = score(variants(raw), templates);
  return { ok: s >= (THRESH[sens] || THRESH.med), score: s };
}
// training samples drawn on the pad: only reject the truly trivial (a dot, a flick)
const trivial = raw => raw.length < 8 || Math.max(bbox(raw).w, bbox(raw).h) < 25;
const CONSIST = 0.74;   // pairwise agreement between training samples (forgiving: same shape, not same stroke)
const agree = (a, b) => score(variants(a), [template(b)]) >= CONSIST || score(variants(b), [template(a)]) >= CONSIST;
// the largest group of samples that all agree with each other (3 → done; 2 → ask for one more)
function consistentSet(samples) {
  let best = samples.length ? [samples[samples.length - 1]] : [];
  const n = samples.length;
  for (let m = 0; m < 1 << n; m++) {
    const g = samples.filter((_, i) => m >> i & 1);
    if (g.length <= best.length) continue;
    if (g.every((a, i) => g.every((b, j) => j <= i || agree(a, b)))) best = g;
  }
  return best;
}
const consistent = samples => consistentSet(samples).length === samples.length;

// Stroke segmentation over polled cursor points: starts when speed passes START px/s, ends after STILL ms without
// motion — so a brief slowdown mid-circle (<150 ms) doesn't split the stroke. Pure, so tests can drive it.
function segmenter(onStroke, { START = 260, STILL = 160 } = {}) {
  let prev = null, stroke = null, stillAt = 0;
  return {
    push(q) {
      const now = q.t;
      if (prev) {
        const d = dist(prev, q), v = d / Math.max(1, now - prev.t) * 1000;
        if (!stroke && v > START) { stroke = [prev, q]; stillAt = 0; }
        else if (stroke) {
          if (d > 0.5) { stroke.push(q); stillAt = 0; } else if (!stillAt) stillAt = now;
          if ((stillAt && now - stillAt >= STILL) || now - stroke[0].t > GATE.maxMs + 500) { const s = stroke; stroke = null; if (now - s[0].t <= GATE.maxMs + 200) onStroke(s); }
        }
      }
      prev = q;
      return !!stroke;
    },
    reset() { prev = null; stroke = null; },
  };
}
// Polls at 50 ms while idle, 16 ms mid-stroke; nothing runs unless start() was called.
function watcher(screen, onStroke, opts) {
  let timer = null;
  const seg = segmenter(onStroke, opts);
  function poll() {
    const p = screen.getCursorScreenPoint();
    const mid = seg.push({ x: p.x, y: p.y, t: Date.now() });
    timer = setTimeout(poll, mid ? 16 : 50);
  }
  return {
    start() { if (!timer) { seg.reset(); poll(); } },
    stop() { clearTimeout(timer); timer = null; seg.reset(); },
    get running() { return !!timer; },
  };
}

module.exports = { normalize, template, variants, recognize, consistent, consistentSet, trivial, plausible, score, turns, firstLoop, segmenter, watcher, THRESH, GATE, CONSIST };
