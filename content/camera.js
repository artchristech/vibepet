// camera — where the 9:16 frame looks, per clip. Pure: rects in source-video pixels, times in clip-local output seconds.
//   build  : open tight on the message bar as the prompt lands (OCR box, else the window's bottom strip), then pull out to the window
//   wait   : the window, fitted, with a slow push-in
//   payoff : whatever window is in front when the reply ends (terminal, browser, simulator), fitted: the output, full frame
// A keyframe is { t, view, clip, ease }: `view` is centred and scaled into the frame, `clip` masks everything outside it.

const OUT_W = 1080, OUT_H = 1920;
const NET_APPS = /^(electron|vibepet)$/i;

// window samples [{ t, app, x, y, w, h }] in global points → the one nearest t (ignoring Net itself), in video pixels
function windowAt(samples, t, disp, { maxGap = 6, after = false } = {}) {
  let best = null, bd = Infinity;
  for (const s of samples || []) {
    if (!s.w || NET_APPS.test(s.app || '')) continue;
    if (after && s.t < t - 0.5) continue;
    const d = Math.abs(s.t - t);
    if (d < bd) { bd = d; best = s; }
  }
  if (!best || bd > maxGap) return null;
  return toVideo(best, disp);
}
// global points → video pixels, clipped to the recorded display
function toVideo(r, disp) {
  const k = disp.scale || 1, b = disp.bounds;
  let x = (r.x - b.x) * k, y = (r.y - b.y) * k, w = r.w * k, h = r.h * k;
  const W = b.width * k, H = b.height * k;
  const x2 = Math.min(W, x + w), y2 = Math.min(H, y + h);
  x = Math.max(0, x); y = Math.max(0, y);
  if (x2 - x < 100 || y2 - y < 100) return null;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y), app: r.app };
}

// OCR lines (normalized) → the box around the lines that spell the prompt, in video pixels, or null
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
function promptBox(lines, prompt, W, H, within) {
  const want = new Set(norm(prompt).split(' ').filter(w => w.length >= 3));
  if (want.size < 2 || !lines?.length) return null;
  const hits = [];
  for (const l of lines) {
    const px = { x: l.x * W, y: l.y * H, w: l.w * W, h: l.h * H };
    if (within && (px.x + px.w / 2 < within.x || px.x + px.w / 2 > within.x + within.w || px.y + px.h / 2 < within.y || px.y + px.h / 2 > within.y + within.h)) continue;
    const words = norm(l.text).split(' ').filter(w => w.length >= 3);
    if (!words.length) continue;
    const got = words.filter(w => want.has(w)).length;
    if (got >= 2 && got / words.length >= 0.6) hits.push({ ...px, got });
  }
  if (!hits.length) return null;
  // the prompt shows twice once sent (input box, then the transcript): keep the lowest run, where the input box lives
  hits.sort((a, b) => b.y - a.y);
  const run = [hits[0]];
  for (const h of hits.slice(1)) if (run[run.length - 1].y - (h.y + h.h) < h.h * 1.2) run.push(h); else break;
  if (run.reduce((n, h) => n + h.got, 0) < Math.min(3, want.size)) return null;
  const x = Math.min(...run.map(h => h.x)), y = Math.min(...run.map(h => h.y));
  const x2 = Math.max(...run.map(h => h.x + h.w)), y2 = Math.max(...run.map(h => h.y + h.h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
}

// pad a text box into a readable 9:16-friendly view: at least ~40% of the window wide, some air above/below, inside the window
function messageView(box, win) {
  const w = Math.max(box.w * 1.15, win.w * 0.32), h = Math.max(box.h * 2.2, w * 0.35);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  return clampInto({ x: cx - w / 2, y: cy - h / 2, w, h }, win);
}
// the window's bottom strip, where Claude Code's input box always is
const inputStrip = win => ({ x: win.x, y: win.y + win.h * 0.78, w: win.w, h: win.h * 0.22 });
function clampInto(r, o) {
  const w = Math.min(r.w, o.w), h = Math.min(r.h, o.h);
  return { x: Math.round(Math.min(Math.max(r.x, o.x), o.x + o.w - w)), y: Math.round(Math.min(Math.max(r.y, o.y), o.y + o.h - h)), w: Math.round(w), h: Math.round(h) };
}

// transform that puts rect r at the frame centre. scale = fit (capped so text is never blown up past 1.6× source);
// minH lifts a wide window to a readable height (cropping its sides around fx); `bound` (the mask) is kept covering
// the frame on any axis where it's big enough, so a zoom near a window edge never shows dead space
function frameFor(r, { fill = 0.94, maxScale = 1.6, minH = 0, fx = null, bound = null } = {}) {
  let s = Math.min(maxScale, (OUT_W * fill) / r.w, (OUT_H * fill) / r.h);
  if (minH) s = Math.max(s, Math.min(maxScale, minH / r.h, OUT_W * 2.2 / r.w));
  const cx = fx != null ? Math.min(r.x + r.w, Math.max(r.x, fx)) : r.x + r.w / 2;
  let x = OUT_W / 2 - s * cx, y = OUT_H / 2 - s * (r.y + r.h / 2);
  if (bound) {
    const fit = (v, lo, len, OUT) => s * len >= OUT ? Math.min(-s * lo, Math.max(OUT - s * (lo + len), v)) : OUT / 2 - s * (lo + len / 2);
    x = fit(x, bound.x, bound.w, OUT_W); y = fit(y, bound.y, bound.h, OUT_H);
  }
  return { scale: +s.toFixed(4), x: Math.round(x), y: Math.round(y) };
}
// keyframe → transform: a window view gets the readable-height lift, centred on where the cursor was
const frameOf = (k, fx) => frameFor(k.view, { bound: k.clip, ...(k.view === k.clip ? { minH: 860, fx } : {}) });

// plan: edl clips + signals → per clip { keys: [{ t, view, clip, ease, dur }], found }
function plan({ clips, windows, ocr, disp, srcW, srcH }) {
  const screenRect = { x: 0, y: 0, w: srcW, h: srcH };
  return clips.map((c, i) => {
    const len = (c.src_end - c.src_start) / c.speed, mid = (c.src_start + c.src_end) / 2;
    // no window info: a 4:5 column around the cursor, as v1a did
    const col = () => { const w = Math.min(srcW, srcH * 0.8), fx = c.focus_x ?? 0.5; return clampInto({ x: fx * srcW - w / 2, y: 0, w, h: srcH }, screenRect); };
    const win = windowAt(windows, mid, disp) || col();
    const fx = c.focus_x != null ? c.focus_x * srcW : null;   // cursor, source px: where to centre a cropped window
    if (c.role === 'payoff') {
      const out = windowAt(windows, c.src_start + 0.5, disp, { after: true }) || win;
      return { fx, keys: [{ t: 0, view: out, clip: out, from: 1.08 }], found: 'window' };
    }
    if (c.overlay_prompt) {
      const at = c.src_start + 1;   // the prompt lands 1s into a build clip
      const w = windowAt(windows, at, disp) || win, o = ocr?.[i];
      const box = o && promptBox(o.lines, c.overlay_prompt, srcW, srcH, w);
      const tight = messageView(box || inputStrip(w), w);
      const pull = Math.max(0.6, len - 0.8);
      return { fx, keys: [{ t: 0, view: tight, clip: w }, { t: pull, dur: Math.min(0.8, len - pull), view: w, clip: w, ease: 'power2.inOut' }], found: box ? 'ocr' : 'strip' };
    }
    return { fx, keys: [{ t: 0, view: win, clip: win, push: 1.05 }], found: windowAt(windows, mid, disp) ? 'window' : 'cursor' };
  });
}

module.exports = { plan, frameFor, frameOf, promptBox, messageView, windowAt, toVideo, inputStrip, OUT_W, OUT_H };
