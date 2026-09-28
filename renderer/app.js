// vibepet renderer — pixel pet, bubble, hud, chat.
const api = window.pet;
const $ = id => document.getElementById(id);
const cv = $('pet'), ctx = cv.getContext('2d');
const S = 4, GW = 56, GH = 52;
// OUT (ink) and the pixel engine for the other pets come from ../site/sprites.js, shared with the website
SHADOWS = false;   // the #hud pill is the ground shadow

let snap = null;
let cursor = { x: -999, y: -999 };
let anim = { kind: null, until: 0 };
let hovering = false, dragging = false, chatOpen = false;
let lastInteract = performance.now();
const parts = [];
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// ================= pixel helpers =================
function rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); }
function dots(x, y, pts, c) { ctx.fillStyle = c; for (const [a, b] of pts) ctx.fillRect(Math.round(x) + a, Math.round(y) + b, 1, 1); }
function outlined(x, y, pts, c) { // draw a sprite with a 1px ink outline
  const o = new Set(pts.map(p => p + ''));
  const ring = [];
  for (const [a, b] of pts) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) if (!o.has([a+dx, b+dy] + '')) ring.push([a+dx, b+dy]);
  dots(x, y, ring, OUT); dots(x, y, pts, c);
}
function ell(cx, cy, rx, ry, colorFn) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++)
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, r = dx * dx + dy * dy;
      if (r > 1) continue; const c = colorFn(dx, dy, r);
      if (c) { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); }
    }
}

const SPR = {
  heart: [[1,0],[3,0],[0,1],[1,1],[2,1],[3,1],[4,1],[1,2],[2,2],[3,2],[2,3]],
  z: [[0,0],[1,0],[2,0],[1,1],[0,2],[1,2],[2,2]],
  note: [[1,0],[2,0],[3,0],[1,1],[1,2],[0,3],[1,3]],
  drop: [[0,0],[0,1],[1,1]],
  bang: [[0,0],[1,0],[0,1],[1,1],[0,2],[1,2],[0,3],[1,3],[0,5],[1,5]],
  what: [[1,0],[2,0],[0,1],[3,1],[3,2],[2,3],[1,4],[1,6]],
  tick: [[4,0],[3,1],[4,1],[0,2],[2,2],[3,2],[0,3],[1,3],[2,3],[1,4]],
  crown: [[0,0],[3,0],[6,0],[0,1],[1,1],[3,1],[5,1],[6,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]],
};

// ================= particles =================
function spawn(kind, n, o = {}) {
  if (!snap?.animations && !exiting) return;
  for (let i = 0; i < n; i++) parts.push({
    kind, x: o.x ?? rand(16, 40), y: o.y ?? rand(14, 24),
    vx: rand(-0.35, 0.35) * (o.spread ?? 1), vy: -rand(0.25, 0.7) * (o.up ?? 1),
    g: o.g ?? 0, life: 1, decay: rand(0.008, 0.018) * (o.fast ?? 1),
    color: pick(o.colors || ['#fff']),
  });
  wake();
}
function drawParts() {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx; p.y += p.vy; p.vy += p.g; p.life -= p.decay;
    if (p.life <= 0 || p.y > GH + 4) { parts.splice(i, 1); continue; }
    ctx.globalAlpha = Math.min(1, p.life * 2);
    if (p.kind === 'spark') rect(p.x, p.y, 1, 1, p.color);
    else if (p.kind === 'drop') dots(p.x, p.y, SPR.drop, '#8fd3ff');
    else outlined(p.x, p.y, SPR[p.kind], p.color);
    ctx.globalAlpha = 1;
  }
}
const CONFETTI = ['#7ef0c1', '#ffcf3f', '#ff7ab0', '#8b7bff', '#8fd3ff', '#fff'];

// ================= state machine =================
// 'ready' (finished, unread) holds until the pet is hovered or clicked after it landed
const seenReady = new Set(), rkey = a => a.name + '@' + a.since;
const unseen = a => !(a.phase === 'ready' && seenReady.has(rkey(a)));
function agentsIn(phase) { return (snap?.agents || []).filter(a => a.phase === phase && unseen(a)); }
const heldReady = new Set();   // ready rows seen by this hover stay in the roster until the pill closes
function markSeen() { const r = agentsIn('ready'); for (const a of r) { seenReady.add(rkey(a)); heldReady.add(rkey(a)); } if (r.length) { renderHud(); wake(); } }
function baseState(now) {
  if (!snap) return 'idle';
  if (agentsIn('waiting').some(a => Date.now() - a.since < 8000)) return 'alert';
  if (agentsIn('waiting').length) return 'waiting';
  if (agentsIn('stalled').length) return 'stalled';
  if (agentsIn('ready').length) return 'ready';
  if (agentsIn('working').length) return 'working';
  if (snap.game && snap.fuel < 20) return 'hungry';
  const late = snap.hour >= 1 && snap.hour < 6;
  if ((late || now - lastInteract > 15 * 60e3) && !hovering && !chatOpen) return 'sleeping';
  return 'idle';
}
// one resolver for LED + face: needs input > stuck > ready > running > none; [0] wins, the rest become pips
const SIG = { waiting: 'needs', stalled: 'stuck', ready: 'ready', working: 'running' }, RANK = ['needs', 'stuck', 'ready', 'running'];
function agentSignals() { return (snap?.agents || []).filter(a => SIG[a.phase] && unseen(a)).map(a => SIG[a.phase]).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b)); }
const LED = { needs: '#ffcf3f', stuck: '#ff5c6c', ready: '#9ff5d6', running: '#3fe08f', none: '#8a93b8' };
// agents that want you, most urgent first (needs > stuck > ready), oldest first within a rank
function pending(held) {
  return (snap?.agents || []).filter(a => SIG[a.phase] && SIG[a.phase] !== 'running' && (unseen(a) || (held && heldReady.has(rkey(a)))))
    .sort((a, b) => RANK.indexOf(SIG[a.phase]) - RANK.indexOf(SIG[b.phase]) || a.since - b.since);
}
// exit: a hole opens under the pet and it drops in (ms offsets from the start)
let exiting = null;
const EX = { open: 300, antic: 380, hop: 600, fall: 950, close: 1300, done: 1380 };
function startExit() {
  if (exiting) return;
  exiting = { start: performance.now(), poofed: false };
  closeChat(); $('hud').classList.remove('show'); $('hud').classList.add('gone');
  say('bye! 👋', { prio: true, ms: 900 });
}
function transient(kind, ms) { if (!snap?.animations) return; anim = { kind, until: performance.now() + ms, start: performance.now() }; wake(); }

// ================= other pets: the site's cast, drawn by sprites.js onto the same canvas =================
// surfaces are integer fractions of the 224x208 canvas, so they scale up crisp; feet land where Net's do
const CAST = {
  slime: { w: 112, h: 104, draw: (S, st, t, l) => drawSlime(S, st, t, l) },
  cat: { w: 112, h: 104, draw: (S, st, t, l) => drawCat(S, st, t, l) },
  sprout: { w: 112, h: 104, draw: (S, st, t, l) => drawSprout(S, st, t, l) },
  shroom: { w: 112, h: 104, draw: (S, st, t, l) => drawShroom(S, st, t, l) },
  star: { w: 224, h: 208, draw: (S, st, t, l) => drawStar(S, st, t, l) },
  koi: { w: 224, h: 208, draw: (S, st, t, l) => drawKoi(S, st, t, l) },
};
const ENGINE = { working: 'working', alert: 'alert', waiting: 'alert', exitfall: 'alert', stalled: 'nervous', sleeping: 'sleep', celebrate: 'celebrate', levelup: 'celebrate', love: 'celebrate' };
const engineStatus = status;
let castLed = null;   // while a cast pet draws, its status tint follows the app's LED, held steady
status = (st, t) => castLed ? { h: castLed, glow: castLed !== LED.none } : engineStatus(st, t);
const surf = {};
function surfaceFor(id) {
  const c = CAST[id];
  if (!surf[id]) { const cv2 = document.createElement('canvas'); cv2.width = c.w; cv2.height = c.h; const x = cv2.getContext('2d'), img = x.createImageData(c.w, c.h); surf[id] = { cv: cv2, x, img, S: { w: c.w, h: c.h, buf: new Uint32Array(img.data.buffer) } }; }
  return surf[id];
}
function drawCast(id, st, t, look, sig, dy) {
  const c = CAST[id], s = surfaceFor(id);
  s.S.buf.fill(0);
  castLed = LED[sig];
  const g = c.draw(s.S, ENGINE[st] || 'idle', t, look) || { cx: c.w / 2, top: c.h * .3 };
  castLed = null;
  s.x.putImageData(s.img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(s.cv, 0, dy, GW, GH);
  // status LED + over-head mark, same grammar as Net's antenna
  const k = GW / c.w, x = Math.round(g.cx * k), top = Math.round(g.top * k) + dy;
  rect(x - 2, top - 5, 4, 4, OUT); if (!(st === 'sleeping' && sig === 'none')) rect(x - 1, top - 4, 2, 2, LED[sig]);
  if (st === 'alert' || st === 'waiting') outlined(x + 6, top - 9, SPR.bang, '#ffcf3f');
  else if (st === 'stalled') outlined(x + 6, top - 9, SPR.what, LED.stuck);
  else if (st === 'ready') outlined(x + 6, top - 8, SPR.tick, LED.ready);
}

// ================= drawing =================
let nextBlink = 0, blinkUntil = 0, emitT = {}, lastSig, haloUntil = 0, lastKey = '', lastCast = 0;
function every(key, ms, now) { if ((emitT[key] || 0) < now) { emitT[key] = now + ms; return true; } return false; }

function draw(now) {
  const t = now / 1000;
  let st = anim.kind && now < anim.until ? anim.kind : baseState(now);
  const ex = exiting ? now - exiting.start : -1;
  const moving = !!snap?.animations || ex >= 0;   // steady states hold still; only opt-in Animations or the exit move
  if (ex >= 0) st = ex < EX.antic ? 'idle' : ex < EX.hop ? 'love' : 'exitfall';
  const lvl = snap?.game ? snap.level : 1;
  const sigs = agentSignals(), sig = sigs[0] || 'none', pips = sigs.slice(1, 4);
  if (sig !== lastSig) { if (lastSig !== undefined && !reduceMotion) haloUntil = now + 500; lastSig = sig; }

  let cx = 28, cy = 34, rx = 13, ry = 11, bob = 0;
  const hop = (speed, height) => {
    const p = (t * speed) % 1, s = Math.sin(p * Math.PI);
    bob = -Math.round(Math.max(0, s) * height);
    if (p < 0.1 || p > 0.93) { rx += 1; ry -= 1; } else if (s > 0.5) { rx -= 1; ry += 1; }
  };
  if (moving) switch (st) {
    case 'alert': hop(1.3, 6); break;
    case 'celebrate': case 'levelup': hop(2.2, 9); break;
    case 'love': hop(1.6, 3); break;
    case 'poke': ry -= Math.round(Math.max(0, 1 - (now - anim.start) / 200) * 2); rx += ry < 11 ? 1 : 0; break;
    case 'sleeping': ry += Math.sin(t * 1.3) > 0 ? 0 : -1; rx += Math.sin(t * 1.3) > 0 ? 0 : 1; break;
    case 'working': bob = Math.round(Math.sin(t * 7) * 0.5); break;
    case 'hungry': bob = 1; ry -= 1; rx += 1; break;
    default: bob = Math.round(Math.sin(t * 2.2) * 0.7);
  }
  if (ex >= 0) {
    const e01 = (a, b) => Math.max(0, Math.min(1, (ex - a) / (b - a)));
    if (ex > 150 && ex < EX.antic) { const q = Math.sin(e01(150, EX.antic) * Math.PI); ry -= Math.round(q * 2); rx += Math.round(q); }
    else if (ex < EX.hop) { const q = e01(EX.antic, EX.hop); bob = -Math.round(Math.sin(q * Math.PI) * 5); if (q < .5) { rx -= 1; ry += 1; } }
    else { const q = e01(EX.hop, EX.fall); bob = Math.round(q * q * 44); rx -= 2; ry += 2; }
  }
  cy += bob;

  // gaze (decided up front so an unchanged frame can skip the repaint)
  const rc = cv.getBoundingClientRect();
  const pxX = rc.left + cx * S, pxY = rc.top + cy * S;
  let lx = Math.max(-1, Math.min(1, Math.round((cursor.x - pxX) / 90)));
  let ly = Math.max(-1, Math.min(1, Math.round((cursor.y - pxY) / 110)));
  if (st === 'working' || (ex >= 0 && ex < EX.antic)) { lx = 0; ly = 1; }
  if (st === 'sleeping') lx = ly = 0;
  if (moving && now > nextBlink) { blinkUntil = now + 110; nextBlink = now + rand(2500, 5500); }
  const blink = moving && now < blinkUntil;
  const shades = lvl >= 5 && hovering && !['sleeping', 'alert', 'waiting'].includes(st);
  const active = moving || parts.length > 0 || now < haloUntil;
  const pet = CAST[snap?.pet] ? snap.pet : null;
  const key = [pet, st, sig, pips.join('.'), lx, ly, cy, lvl, shades, snap?.game && snap.fuel, snap?.game && snap.mood].join();
  if (!active && key === lastKey) return false;
  if (pet && active && key === lastKey && now - lastCast < 33) return true;   // cast pets animate at ~30fps like the site
  lastKey = key;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, GW, GH);

  // the hole (exit only), then clip the pet to above its rim so it drops in
  if (ex >= 0) {
    const e01 = (a, b) => Math.max(0, Math.min(1, (ex - a) / (b - a)));
    const open = ex < EX.fall ? 1 - (1 - e01(0, EX.open)) ** 3 : 1 - e01(EX.fall + 50, EX.close) ** 2;
    const hr = 15 * open, hry = Math.max(.6, hr * .24);
    if (hr > .5) {
      ell(28, 47, hr + 1, hry + 1, () => '#2a2f47');
      ell(28, 47, hr, hry, (dx, dy) => dy < -.25 ? '#0f1119' : '#05060a');
    }
    if (ex > EX.fall && !exiting.poofed) {
      exiting.poofed = true;
      spawn('spark', 14, { x: 28, y: 45, spread: 2.2, up: 1.3, g: .05, colors: ['#7ef0c1', '#c7fff0', '#ffffff', '#8fd3ff'] });
      tune([523, 392, 262], 70);
    }
    if (ex > EX.done) { exiting = 'done'; api.exitDone(); return false; }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, GW, 47); ctx.clip();
  } else {
    // ground shadow is the #hud pill (see style.css)
  }

  // colors — hungry pets go pale
  const fuel = snap?.game ? snap.fuel : 80;
  const hue = 158, sat = Math.round(35 + fuel * 0.45);
  const C = { base: `hsl(${hue} ${sat}% 66%)`, shade: `hsl(${hue + 12} ${sat}% 50%)`, light: `hsl(${hue - 8} ${sat}% 86%)` };

  // feet (wiggle when happy)
  const happy = ['celebrate', 'levelup', 'love'].includes(st);
  if (ex >= 0 && ex > EX.fall) { ctx.restore(); drawParts(); return true; }
  if (pet) {
    lastCast = now;
    drawCast(pet, st, moving ? t : 0, { x: lx, y: ly, blink }, sig, ex >= 0 ? bob : 0);
    if (ex >= 0) ctx.restore();
    drawParts();
    return true;
  }
  const fw = happy ? Math.round(Math.sin(t * 20)) : 0;
  for (const s of [-1, 1]) {
    ell(cx + s * 6, cy + ry - 0.5 + (s === 1 ? fw : -fw) * 0.5, 3.4, 2.2, (dx, dy, r) => r > 0.62 ? OUT : C.shade);
  }
  // body
  ell(cx, cy, rx + 1, ry + 1, () => OUT);
  ell(cx, cy, rx, ry, (dx, dy) =>
    dy > 0.5 || (dx > 0.65 && dy > 0.05) ? C.shade :
    (dx + 0.45) ** 2 + (dy + 0.5) ** 2 < 0.05 ? C.light : C.base);

  // headphones (L4+)
  if (lvl >= 4) {
    ell(cx, cy - 1, rx + 2.2, ry + 2.2, (dx, dy, r) => r > 0.84 && dy < -0.15 ? '#3a3f55' : null);
    rect(cx - rx - 2, cy - 4, 3, 6, OUT); rect(cx - rx - 1, cy - 3, 2, 4, '#ff7ab0');
    rect(cx + rx, cy - 4, 3, 6, OUT); rect(cx + rx, cy - 3, 2, 4, '#ff7ab0');
  }

  // antenna = agent status LED
  const top = cy - ry;
  dots(cx, top, [[0,-1],[0,-2],[1,-3]], OUT);
  const led = LED[sig];                                   // held steady; a change plays one fading halo, once
  rect(cx, top - 7, 4, 4, OUT); if (!(st === 'sleeping' && sig === 'none')) rect(cx + 1, top - 6, 2, 2, led);   // asleep = unlit
  pips.forEach((p, i) => { const x = cx - 4 * (i + 1); rect(x, top - 6, 3, 3, OUT); rect(x + 1, top - 5, 1, 1, LED[p]); });   // other agents: small, static
  if (now < haloUntil) {
    ctx.globalAlpha = 0.5 * ((haloUntil - now) / 500) ** 2;
    rect(cx - 1, top - 8, 6, 1, led); rect(cx - 1, top - 3, 6, 1, led); rect(cx - 1, top - 7, 1, 4, led); rect(cx + 4, top - 7, 1, 4, led);
    ctx.globalAlpha = 1;
  }

  // crown (L7+)
  if (lvl >= 7) outlined(cx - 12, top - 6, SPR.crown, '#ffcf3f');   // perched on the headphone band, clear of the antenna

  // --- face ---
  const ey = cy - 3 + ly, exL = cx - 6 + lx, exR = cx + 4 + lx;
  const needs = st === 'alert' || st === 'waiting';

  for (const ex of [exL, exR]) {
    if (shades) continue;
    if (st === 'sleeping') dots(ex - 1, ey + 1, [[0,0],[1,1],[2,1],[3,0]], OUT);
    else if (happy) dots(ex, ey, [[0,2],[1,1],[2,2]], OUT);
    else if (st === 'stalled') { rect(ex - 1, ey, 4, 4, OUT); rect(ex, ey + 1, 2, 2, '#fff'); }
    else if (needs || st === 'exitfall') { rect(ex, ey - 1, 2, 4, OUT); rect(ex, ey - 1, 1, 1, '#fff'); }
    else if (blink) rect(ex, ey + 2, 2, 1, OUT);
    else if (st === 'hungry') { rect(ex, ey + 1, 2, 2, OUT); rect(ex - 1, ey, 4, 1, C.shade); }
    else { rect(ex, ey, 2, 3, OUT); rect(ex, ey, 1, 1, '#fff'); }
  }
  if (shades) { rect(exL - 2, ey, 14, 1, OUT); rect(exL - 1, ey, 5, 3, OUT); rect(exR - 1, ey, 5, 3, OUT); rect(exL, ey, 2, 1, '#6f7aa8'); rect(exR, ey, 2, 1, '#6f7aa8'); }

  // cheeks (L2+ or happy)
  if ((lvl >= 2 && (snap?.mood ?? 0) > 55) || happy) { rect(cx - 10 + lx, cy, 2, 1, '#ff9ec4'); rect(cx + 8 + lx, cy, 2, 1, '#ff9ec4'); }

  // mouth
  const mx = cx - 1 + lx, my = cy + 2 + ly;
  if (st === 'working') rect(mx - 1, my + 1, 4, 1, OUT);   // focused; stays visible above the laptop lid
  else if (needs && !moving) { rect(mx - 1, my, 4, 3, OUT); rect(mx, my + 1, 2, 1, C.base); }
  else if (st === 'eat') { if (Math.floor(t * 7) % 2) rect(mx - 1, my, 4, 3, OUT); else rect(mx - 1, my + 1, 4, 1, OUT); }
  else if (st === 'alert' || st === 'levelup' || st === 'exitfall') { rect(mx, my, 3, 3, OUT); rect(mx + 1, my + 1, 1, 1, '#ff7ab0'); }
  else if (st === 'stalled') dots(mx - 1, my + 1, [[0,1],[1,0],[2,1],[3,0],[4,1]], OUT);
  else if (st === 'sleeping') rect(mx + 1, my + 1, 1, 1, OUT);
  else if (st === 'hungry') dots(mx - 1, my + 1, [[0,1],[1,0],[2,0],[3,1]], OUT);
  else dots(mx - 1, my, [[0,0],[1,1],[2,1],[3,0]], OUT);

  // laptop while the agent works — little hands typing
  if (st === 'working' && moving) {
    const ly0 = cy + 5;                                   // low lid: the mouth stays in view
    rect(cx - 8, ly0, 16, 6, OUT); rect(cx - 7, ly0 + 1, 14, 4, '#c9cfdc'); rect(cx - 7, ly0 + 1, 14, 1, '#e6eaf2');
    rect(cx - 1, ly0 + 2, 2, 2, `hsl(152 80% ${60 + Math.sin(t * 3) * 10}%)`);
    rect(cx - 10, ly0 + 6, 20, 3, OUT); rect(cx - 9, ly0 + 7, 18, 1, '#8a92a8');
    const k = Math.floor(t * 10) % 2;
    rect(cx - 10, ly0 + 4 + k, 3, 2, C.base); rect(cx + 7, ly0 + 5 - k, 3, 2, C.base);
  }

  // over-head indicators
  if (needs) outlined(cx + 8, top - 10 + bob * 0, SPR.bang, '#ffcf3f');
  if (st === 'stalled') outlined(cx + 8, top - 10, SPR.what, LED.stuck);
  if (st === 'ready') outlined(cx + 8, top - 9, SPR.tick, LED.ready);

  // ambient emitters
  if (st === 'sleeping' && every('z', 1600, now)) spawn('z', 1, { x: cx + 9, y: top, up: 0.4, spread: 0.3, colors: ['#c7d0ff'], fast: 0.6 });
  if (st === 'working' && every('note', 3000, now)) spawn('note', 1, { x: cx - 12, y: top + 2, up: 0.4, colors: ['#7ef0c1', '#8fd3ff'], fast: 0.7 });
  if (happy && every('spark', 120, now)) spawn('spark', 3, { x: cx + rand(-12, 12), y: cy - 10, colors: CONFETTI, up: 1.4, g: 0.04 });
  if (lvl >= 3 && st === 'idle' && every('trail', 2500, now)) spawn('spark', 2, { x: cx + rand(-14, 14), y: cy + rand(-6, 8), up: 0.2, colors: ['#fff', '#c7fff0'], fast: 1.5 });

  if (ex >= 0) ctx.restore();
  drawParts();
  return true;
}

// loops run on rAF while something changes and park to a 10 Hz check once settled; wake() resumes at once
const loops = [];
function park(L, hot) { L.t = hot ? 0 : setTimeout(() => L.fn(performance.now()), 100); if (hot) requestAnimationFrame(L.fn); }
function wake() { for (const L of loops) if (L.t) { clearTimeout(L.t); park(L, true); } }
const drawL = { fn: now => park(drawL, draw(now) !== false && exiting !== 'done') };
loops.push(drawL);
requestAnimationFrame(drawL.fn);

// ================= speech bubble =================
const bubble = $('bubble');
let bubbleQ = [], bubbleBusy = false, bubbleTimer, typeTimer;
function say(text, { ms = 5500, prio = false, alert = false, quiet = false } = {}) {
  if (prio || !bubbleBusy) { bubbleQ = prio ? [] : bubbleQ; show({ text, ms, alert, quiet }); }
  else if (bubbleQ.length < 3) bubbleQ.push({ text, ms, alert, quiet });
}
function show({ text, ms, alert, quiet }) {
  clearTimeout(bubbleTimer); clearInterval(typeTimer);
  bubbleBusy = true;
  bubble.className = 'hit' + (alert === 'stuck' ? ' alert stuck' : alert ? ' alert' : '');
  bubble.textContent = '';
  let i = 0;
  typeTimer = setInterval(() => {
    bubble.textContent = text.slice(0, ++i);
    if (i % 3 === 0 && !quiet) blip(880 + Math.random() * 200, 0.015, 0.01);
    if (i >= text.length) clearInterval(typeTimer);
  }, 18);
  bubbleTimer = setTimeout(hideBubble, ms + text.length * 18);
}
function hideBubble() {
  clearTimeout(bubbleTimer); clearInterval(typeTimer);
  bubble.classList.add('hidden'); bubbleBusy = false;
  const n = bubbleQ.shift();
  if (n) setTimeout(() => show(n), 350);
}
bubble.addEventListener('click', hideBubble);

// ================= sound =================
let actx;
function blip(freq, dur = 0.08, vol = 0.035, type = 'square') {
  if (snap?.muted) return;
  try {
    actx ||= new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch {}
}
const tune = (notes, gap = 90) => notes.forEach((f, i) => setTimeout(() => blip(f, 0.1), i * gap));

// ================= chatter =================
const LINES = {
  idle: ['vibes: immaculate', 'ship it?', 'I believe in you. and your agent.', 'read the diff. or don\'t. I\'m a pet, not a cop.', 'what are we building next?', 'the best prompt is a specific prompt', '*stares at your cursor*'],
  working: a => [`${a} is cooking 🔥`, `watching ${a} type is my favorite show`, `${a}'s on it. stretch your legs?`, `shh… ${a} is thinking`],
  hungry: ['feed me a commit 🥺', '*stomach growls in merge conflict*', 'running on fumes. git commit pls'],
  night: h => [`it's ${h}am. the bugs are more confident at night.`, 'sleep is a performance optimization'],
};
let nextChatter = performance.now() + 25000;
setInterval(() => {
  const now = performance.now();
  if (!snap?.game || now < nextChatter || bubbleBusy || chatOpen) return;
  nextChatter = now + rand(3, 7) * 60e3;
  const st = baseState(now);
  if (st === 'sleeping' || st === 'alert') return;
  const working = agentsIn('working')[0];
  let pool = LINES.idle;
  if (working) pool = LINES.working(working.name);
  if (snap.fuel < 25) pool = LINES.hungry;
  else if (snap.hour >= 1 && snap.hour < 5) pool = LINES.night(snap.hour);
  say(pick(pool));
}, 15000);

// ================= main-process feeds =================
api.on('cursor', c => { cursor = c; wake(); });
api.on('tick', s => {
  const first = !snap;
  snap = s; wake();
  renderHud();
  if (first) {                                  // speak at launch only when someone is actually waiting on you
    const w = agentsIn('waiting');
    if (w.length) say(`${w.map(a => a.name).join(', ')} ${w.length > 1 ? 'are' : 'is'} waiting on you`, { alert: true });
  }
});
// the jump door. hotkey: a press < 4 s after the last walks on, else it snapshots the queue (markSeen reshuffles pending()).
// nothing waiting = nothing happens: no bubble, no sound
let cyc = { ids: [], i: 0, at: 0 };
api.on('hotkey', () => {
  const now = Date.now();
  cyc = now - cyc.at < 4000 && cyc.ids.length ? { ...cyc, i: cyc.i + 1, at: now } : { ids: pending().map(a => a.id), i: 0, at: now };
  const live = snap?.agents || [];
  for (let k = 0; k < cyc.ids.length; k++) {
    const j = (cyc.i + k) % cyc.ids.length, a = live.find(x => x.id === cyc.ids[j]);
    if (a && api.jump) { cyc.i = j; jumpTo(a); return; }
  }
});
api.on('jumpTo', ({ id } = {}) => {   // a clicked banner: its agent, else whoever is first in line
  const a = (snap?.agents || []).find(x => x.id === id) || pending()[0];
  if (a && api.jump) jumpTo(a);
});
api.on('summon', () => { document.body.classList.remove('away'); wantUntil = performance.now() + 1500; wake(); });   // relaunched / gesture: open the pill once, silently
api.on('hide', () => { closeChat(); document.body.classList.add('away'); });
// summon-gesture training: Net holds up a pad; each click-drag is one sample, main keeps the ones that agree
function gestDraw(cv, pts) {
  const c = cv.getContext('2d'), S = cv.width, b = pts.reduce((m, p) => Math.max(m, Math.abs(p.x), Math.abs(p.y)), 1), k = S * 0.36 / b;
  c.clearRect(0, 0, S, S); c.strokeStyle = '#7ef0c1'; c.lineWidth = S / 24; c.lineJoin = c.lineCap = 'round'; c.beginPath();
  pts.forEach((p, i) => c[i ? 'lineTo' : 'moveTo'](S / 2 + p.x * k, S / 2 + p.y * k)); c.stroke();
}
const pad = $('gestPad'), pc = pad.getContext('2d');
let ink = null, gestOpen = false;
function padClear() { pc.clearRect(0, 0, pad.width, pad.height); }
function padPt(e) { const r = pad.getBoundingClientRect(); return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height, t: Math.round(performance.now()) }; }
pad.addEventListener('pointerdown', e => {
  if (e.button) return;
  pad.setPointerCapture(e.pointerId); pad.classList.add('on'); padClear();
  ink = [padPt(e)]; pc.strokeStyle = '#7ef0c1'; pc.lineWidth = 7; pc.lineJoin = pc.lineCap = 'round';
});
pad.addEventListener('pointermove', e => {
  if (!ink) return;
  const p = padPt(e), q = ink[ink.length - 1];
  if (Math.hypot(p.x - q.x, p.y - q.y) < 1) return;
  ink.push(p); pc.beginPath(); pc.moveTo(q.x, q.y); pc.lineTo(p.x, p.y); pc.stroke();
});
function padUp() { if (!ink) return; const pts = ink; ink = null; pad.classList.remove('on'); api.gestureSample(pts); setTimeout(() => { if (!ink) padClear(); }, 350); }
pad.addEventListener('pointerup', padUp); pad.addEventListener('pointercancel', padUp);
function gestClose() { gestOpen = false; ink = null; padClear(); $('gest').classList.add('hidden'); }
api.on('gesture-rec', r => {
  const box = $('gest'), shots = [...box.querySelectorAll('#gestShots canvas')], prev = r.previews || [];
  gestOpen = true; box.classList.remove('hidden'); closeChat();
  shots.forEach((s, i) => { s.getContext('2d').clearRect(0, 0, s.width, s.height); s.classList.toggle('on', !!prev[i]); if (prev[i]) gestDraw(s, prev[i]); });
  $('gestUndo').disabled = r.done || !prev.length;
  $('gestMsg').textContent = r.done ? `Saved. Hide ${snap?.name || 'Net'}, then move the mouse in that shape to bring him back.`
    : r.hint || (prev.length ? `Nice — ${3 - prev.length} more, same shape.` : 'Draw your gesture 3 times on the pad.');
  if (r.done) setTimeout(gestClose, 2800);
});
$('gestUndo').onclick = () => api.gestureUndo();
$('gestCancel').onclick = () => { api.gestureCancel(); gestClose(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape' && gestOpen) { api.gestureCancel(); gestClose(); } });
api.on('event', e => {
  lastInteract = performance.now(); wake();
  switch (e.kind) {
    case 'agentDone': say(e.text, { prio: true, ms: 4000 }); break;   // routine finish: one quiet line, no amber, no sound
    case 'agentNeeds': say(e.text, { prio: true, alert: true, ms: 8000 }); tune([440, 330]); break;
    case 'agentStalled': say(e.text, { prio: true, alert: 'stuck', ms: 8000 }); break;   // stuck = red, same as LED + glyph
    case 'commit': transient('eat', 1300); setTimeout(() => transient('celebrate', 2200), 1300);
      spawn('spark', 30, { x: 28, y: 22, spread: 3, up: 2, g: 0.05, colors: CONFETTI }); say(e.text, { prio: true }); tune([523, 659, 784, 1047], 80); break;
    case 'levelup': transient('levelup', 3500); spawn('spark', 60, { x: 28, y: 20, spread: 4, up: 2.5, g: 0.05, colors: CONFETTI });
      say(e.text, { prio: true, ms: 7000 }); tune([523, 659, 784, 1047, 784, 1047, 1319], 110); break;
    case 'snack': transient('eat', 1200); say(e.text); break;
    case 'snackNo': say(e.text); break;
    case 'openChat': openChat(); break;
    case 'openKey': openChat(); $('keyForm').classList.remove('hidden'); $('keyInput').focus(); break;
    case 'exit': startExit(); break;
    case 'openRename': openChat(); $('renameForm').classList.remove('hidden'); $('renameInput').value = snap?.name || ''; $('renameInput').select(); break;
  }
});

// ================= hud =================
const ago = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderHud() {
  if (!snap) return;
  $('hud').classList.toggle('nogame', !snap.game);
  $('hudName').textContent = snap.name;
  $('hudLvl').textContent = `Lv${snap.level}`;
  $('barXp').style.width = `${Math.round(100 * (snap.xp - snap.xpLo) / (snap.xpHi - snap.xpLo))}%`;
  $('barFuel').style.width = `${snap.fuel}%`;
  $('barMood').style.width = `${snap.mood}%`;
  const g = snap.git;
  if (g?.root) {
    $('hudRepo').innerHTML = `⎇ <b>${esc(g.name)}</b>${g.branch ? '/' + esc(g.branch) : ''} · ±${g.lines} in ${g.files}f${g.untracked ? ` +${g.untracked}new` : ''} · ${g.lastCommitAt ? ago(Date.now() - g.lastCommitAt) : 'no commits'}`;
  } else $('hudRepo').textContent = g?.dir ? `${g.dir.split('/').pop()} isn't a git repo` : 'no repo — start an agent or right-click → watch';
  $('hudAgents').innerHTML = (snap.agents || []).slice(0, 6).map(a =>
    `<span class="chip ${a.phase}" title="${a.phase} since ${ago(Date.now() - a.since)}">${esc(a.name)}${a.phase === 'waiting' ? ' · your move' : a.phase === 'stalled' ? ' · stuck?' : a.phase === 'ready' ? ' · done' : ''}</span>`).join('');
  renderRoster();
}
// the question in the pill: what each waiting/stuck/finished agent wants, shown only while the pill is open.
// agents fanned out to subagents follow, with a static gauge: filled pip = child done, hollow = still running
function renderRoster() {
  const rows = pending(true), has = new Set(rows.map(a => a.id));
  rows.push(...(snap?.agents || []).filter(a => a.phase === 'working' && a.fanout?.open > 0 && !has.has(a.id)));
  $('roster').innerHTML = rows.slice(0, 4).map(a => { const sig = SIG[a.phase], fo = a.fanout, rc = (sig === 'ready' || sig === 'needs') && rcLine(a.receipt);
    const line = `${fo ? foPips(fo, LED[sig]) : ''}${esc(noteFor(a.id) || (sig === 'running' ? [`${fo.open} running`, fo.items.filter(k => k.open).map(k => k.desc).filter(Boolean).join(', ')].filter(Boolean).join(': ') : a.ask) ||
      (sig === 'needs' ? 'has a question' : sig === 'stuck' ? 'needs approval' : 'done'))}`;
    return `<button data-id="${esc(a.id)}"${fo ? ` title="${esc(foTitle(fo))}"` : ''}>` +
    `<i style="background:${LED[sig]}"></i><b>${esc(a.title || a.name)}</b><time>${ago(Date.now() - a.since)}</time>` +
    (rc ? `<span class="w"><span>${line}</span>${rc}</span></button>` : `<span>${line}</span></button>`); }).join('');
  rosterShow();
}
// the receipt: what the turn touched, and whether a check ran green after it. Pull-only: never feeds the LED, bubble or sound
const short = f => f.split('/').slice(-2).join('/');
function rcLine(rc) {
  const files = [...(rc?.files || [])], c = rc?.check;
  if (!files.length && !c) return '';
  const tip = [...files.slice(0, 12).map(short), files.length > 12 && `+${files.length - 12} more`, files.length && `+${rc.add} −${rc.del}`,
    c && c.full, c && c.ok === false && (c.exit != null ? `exit ${c.exit}` : 'failed')].filter(Boolean).join('\n');
  const v = !c ? '' : rc.stale ? `<var class="stale">– edited after ${esc(c.cmd)}</var>` : c.ok ? `<var class="ok">✓ ${esc(c.cmd)} ${ago(Date.now() - c.at)}</var>`
    : c.ok === false ? `<var class="bad">✗ ${esc(c.cmd)} ${c.exit != null ? 'exit ' + c.exit : 'failed'}</var>` : '';
  if (!files.length && !v) return '';
  return `<small class="rc" title="${esc(tip)}">${files.length ? `${rc.truncated ? '≥' : ''}${files.length} file${files.length === 1 ? '' : 's'}` : ''}${v}</small>`;
}
function foPips(fo, c) {
  const o = Math.min(fo.open, 8), d = Math.min(fo.done, 8 - o), more = fo.total - d - o;   // running pips first: they're the news
  return `<em style="color:${c}">${'<u class="f"></u>'.repeat(d)}${'<u></u>'.repeat(o)}${more > 0 ? `<small>+${more}</small>` : ''}</em>`;
}
function foTitle(fo) {
  const descs = fo.items.map(k => k.desc).filter(Boolean).join(', ');
  return [`${fo.done} of ${fo.total} subagents done`, fo.open && fo.oldestOpenAt && `oldest running ${Math.max(1, Math.round((Date.now() - fo.oldestOpenAt) / 60000))}m`, descs].filter(Boolean).join(' · ');
}
// a failed jump's note shows in the row itself: the roster hides the bubble while the pill is open
const notes = new Map();
function noteFor(id) { const n = notes.get(id); return n && n.until > Date.now() ? n.text : null; }
function rosterShow() {
  const r = $('roster'), on = $('hud').classList.contains('live') && r.children.length > 0;
  if (on === r.classList.contains('hidden')) r.classList.toggle('hidden', !on);
}
$('roster').onclick = e => {
  const id = e.target.closest('button[data-id]')?.dataset.id, a = (snap?.agents || []).find(x => x.id === id);
  if (!a) return;
  const v = e.target.closest('.rc var');   // the verdict chip copies its command; no jump, and the row stays unread
  if (v && a.receipt?.check) { api.copy(a.receipt.check.full); v.textContent = 'copied'; return; }
  if (api.jump) jumpTo(a); else if (a.ask) api.copy(a.ask);
};

// ================= mouse: click-through, drag, click =================
let ignoring = true;
const setIgnore = v => { if (v !== ignoring) { ignoring = v; api.setIgnore(v); } };
function petPixelHit(e) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor(e.clientX - r.left), y = Math.floor(e.clientY - r.top);
  for (const [dx, dy] of [[0,0],[6,0],[-6,0],[0,6],[0,-6]]) {
    try { if (ctx.getImageData(x + dx, y + dy, 1, 1).data[3] > 60) return true; } catch {}
  }
  return false;
}
// ---- hud reveal: a critically-damped spring toward an intent target (distance + approach prediction)
let hoverHit = false;
function showHud(on) { hoverHit = on; }
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = reduceMotion ? 40 : 22;            // spring angular freq; ζ = 1 (no overshoot)
const NEAR = 24, FAR = 120, GRACE = 500, TTA = 0.25, ACK = 0.25;   // distance alone only acknowledges; intent opens
let rp = 0, rv = 0, vel = { x: 0, y: 0 }, lastCur = null, wantUntil = 0, lastFrame = performance.now();
let aimHits = 0, still = null, nearSince = 0;
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = v => (v = clamp01(v), v * v * (3 - 2 * v));
function zoneRect() {           // pet body + full-size pill, in window coords (pill measured untransformed)
  const c = cv.getBoundingClientRect(), h = $('hud'), ro = $('roster'), rs = !ro.classList.contains('hidden');
  return { l: Math.min(c.left + 44, h.offsetLeft, rs ? ro.offsetLeft : 1e9), r: Math.max(c.right - 44, h.offsetLeft + h.offsetWidth, rs ? ro.offsetLeft + ro.offsetWidth : 0),
           t: rs ? Math.min(c.top + 56, ro.offsetTop) : c.top + 56, b: h.offsetTop + h.offsetHeight };
}
function hudTarget(now, dt) {
  if (dragging || chatOpen || exiting) return 0;
  // smoothed cursor velocity (px/s)
  if (lastCur && dt > 0) {
    const k = 1 - Math.exp(-dt / 0.06);
    vel.x += ((cursor.x - lastCur.x) / dt - vel.x) * k; vel.y += ((cursor.y - lastCur.y) / dt - vel.y) * k;
  }
  const moved = !lastCur || cursor.x !== lastCur.x || cursor.y !== lastCur.y;
  lastCur = { ...cursor };
  const z = zoneRect(), nx = Math.max(z.l, Math.min(z.r, cursor.x)), ny = Math.max(z.t, Math.min(z.b, cursor.y));
  const dx = cursor.x - nx, dy = cursor.y - ny, d = Math.hypot(dx, dy);
  let want = ACK * (1 - smooth((d - NEAR) / (FAR - NEAR))), aim = false;   // micro-ack: shadow widens, no icons (a = 0 below p .55)
  if (d > NEAR) {
    const vr = -(vel.x * dx + vel.y * dy) / d;                 // closing speed toward the zone
    const vt = Math.sqrt(Math.max(0, vel.x ** 2 + vel.y ** 2 - vr * vr));
    if (vr > 60 && (d - NEAR) / vr < TTA) aim = true;                          // arriving soon
    else if (vt > 700 && vr < vt * 0.5) want *= 0.3;                           // just passing by
    else if (vr < -150) want *= 0.5;                                           // heading away
  }
  if (moved) aimHits = aim ? aimHits + 1 : 0;                                  // aim must hold 2+ cursor samples: one jitter can't open it
  if (!still || Math.hypot(cursor.x - still.x, cursor.y - still.y) > 6) still = { x: cursor.x, y: cursor.y, t: now };
  nearSince = d < NEAR * 2 ? nearSince || now : 0;
  const intent = d < NEAR * 2 && (now - still.t >= 100 || now - nearSince >= 300);   // hoverIntent: slowed (<6px/100ms) or dwelled 300ms
  if (hoverHit || d === 0 || aimHits >= 2 || intent || (rp > 0.5 && d < NEAR * 2.5)) want = 1;   // in zone, aimed, intent, or hysteresis
  if (want > 0.9) wantUntil = now + GRACE;
  else if (now < wantUntil) want = 1;                                          // grace before collapsing
  return want;
}
let hudCur = '', hudP = '';
function hudFrame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  const target = hudTarget(now, dt);
  for (let i = 0, h = dt / 4; i < 4; i++) { rv += (W * W * (target - rp) - 2 * W * rv) * h; rp += rv * h; }
  if (Math.abs(target - rp) < 0.001 && Math.abs(rv) < 0.01) { rp = target; rv = 0; }
  const p = clamp01(rp), a = smooth((p - 0.55) / 0.45), hud = $('hud'), ps = p.toFixed(4);
  if (ps !== hudP) { hudP = ps; hud.style.setProperty('--p', ps); hud.style.setProperty('--a', a.toFixed(4)); if (!reduceMotion) $('roster').style.opacity = a.toFixed(4); }
  hud.classList.toggle('live', p > 0.6);
  rosterShow();
  const was = hovering; hovering = p > 0.5;
  if (hovering && !was) { lastInteract = now; markSeen(); }
  if (!hovering && was && heldReady.size) { heldReady.clear(); renderRoster(); }
  const cur = cursor.x + ',' + cursor.y, settled = rv === 0 && rp === target && cur === hudCur;
  hudCur = cur;
  park(hudL, !settled);                      // settled spring + still cursor: drop to the 10 Hz check
}
const hudL = { fn: hudFrame };
loops.push(hudL);
requestAnimationFrame(hudFrame);
document.addEventListener('mousemove', e => {
  wake();
  if (dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  let hit = el && el.closest('.hit');
  if (hit === cv && !petPixelHit(e)) hit = null;
  setIgnore(!hit);
  showHud(hit === cv || (hit && ($('hud').contains(hit) || $('roster').contains(hit))));
});
document.addEventListener('mouseleave', () => { if (!dragging) { setIgnore(true); showHud(false); } });

let down = null;
cv.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  down = { x: e.screenX, y: e.screenY, detail: e.detail };
  dragging = true; api.dragStart();
});
document.addEventListener('mouseup', e => {
  if (!down) return;
  api.dragEnd(); dragging = false;
  const moved = Math.hypot(e.screenX - down.x, e.screenY - down.y);
  const d = down; down = null;
  if (moved > 4) { say(pick(['wheee', 'new desk, who dis', 'ooh nice view']), { ms: 1800 }); return; }
  if (d.detail >= 2) { clearTimeout(jumpT); openChat(); return; }
  poke();
});
cv.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });

function poke() {
  lastInteract = performance.now();
  api.pet();
  const top = pending()[0];
  if (top && api.jump) { clearTimeout(jumpT); jumpT = setTimeout(() => jumpTo(top), 300); return; }   // the terminal coming forward is the feedback; waits out a double-click
  markSeen();
  transient(Math.random() < 0.5 ? 'love' : 'poke', 900);
  spawn('heart', 2, { x: 28 + rand(-8, 8), y: 18, colors: ['#ff5c8a', '#ff9ec4'] });
  blip(pick([740, 880, 988]), 0.07);
  if (Math.random() < 0.4) say(pick(['hehe', '*happy wiggle*', 'boop', 'again!', ...(snap?.game ? [`⚡${Math.round(snap.fuel)} ♥${Math.round(snap.mood)}`] : [])]), { ms: 1600 });
}

// go to the agent's terminal; if it can't be found, the resume command is on the clipboard: one quiet line, no sound
let jumpT;
async function jumpTo(a) {
  markSeen();
  let r; try { r = await api.jump(a.id); } catch { r = null; }
  if (r?.ok) return;
  const text = r?.cmd ? "couldn't find its terminal — resume command copied" : "couldn't find its terminal";
  notes.set(a.id, { text, until: Date.now() + 4000 }); renderRoster(); setTimeout(renderRoster, 4100);
  say(`${a.name}: ${text}`, { prio: true, quiet: true, ms: 4000 });
}

$('btnChat').onclick = () => openChat();
$('btnMenu').onclick = () => api.menu();

// ================= chat =================
let history = [], keyExplained = false;
async function openChat() {
  chatOpen = true; lastInteract = performance.now();
  $('chat').classList.remove('hidden');
  api.focus();
  let via = 'key'; try { via = await api.chatVia(); } catch {}
  if (!chatOpen) return;
  if (via === null) $('keyForm').classList.remove('hidden');
  if ($('renameForm').classList.contains('hidden')) ($('keyForm').classList.contains('hidden') ? $('chatInput') : $('keyInput')).focus();   // rename keeps its own focus
  $('chatNoteText').textContent = via === 'claude' ? 'Via Claude Code · sends message + repo context' : 'Sends your message + repo context to Anthropic';
  $('chat').classList.toggle('fresh', !$('msgs').children.length);
  // the OS keychain prompt comes on the first send: say so first, so it's expected rather than alarming
  if (via === 'key-locked' && !keyExplained) { keyExplained = true; addMsg('pet', 'macOS will ask to unlock the API key you saved when you send. It stays encrypted on this Mac.', 'note'); }
}
function closeChat() { chatOpen = false; $('chat').classList.add('hidden'); ['keyForm', 'renameForm'].forEach(id => $(id).classList.add('hidden')); }
$('chatClose').onclick = closeChat;
$('msgs').addEventListener('scroll', e => e.target.classList.toggle('fade', e.target.scrollTop > 0));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });
// clicking anywhere outside the pet window blurs it: treat that as dismiss (not mid-send — the keychain prompt blurs too)
window.addEventListener('blur', () => { if (chatOpen && !sending) closeChat(); });

function renderMd(text) {
  const blocks = [];
  let h = esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code.replace(/\n$/, '')); return `\u0000${blocks.length - 1}\u0000`; });
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><button class="copy" data-i="${i}">copy</button><code>${blocks[i]}</code></pre>`);
}
function addMsg(who, text, cls = '') {
  if (cls !== 'note') $('chat').classList.remove('fresh');
  const el = document.createElement('div');
  el.className = `msg ${who} ${cls}`;
  if (who === 'pet') el.innerHTML = renderMd(text); else el.textContent = text;
  el.querySelectorAll('.copy').forEach(b => b.onclick = () => {
    api.copy(b.nextElementSibling.textContent); b.textContent = 'copied!';
  });
  const m = $('msgs'); m.appendChild(el);
  m.scrollTop = who === 'pet' ? el.offsetTop - m.offsetTop - 6 : 1e9;   // a reply opens at its first line
  m.classList.toggle('fade', m.scrollTop > 0);
  return el;
}

const MODES = {
  commit: ['commit msg', 'Write a commit message for my current uncommitted changes. Conventional-commit subject ≤72 chars, blank line, 2–5 terse bullets. Output ONLY the message in a single ```text code block.'],
  vibe: ['vibe check', 'Vibe check: look at my diff size, time since last commit, and what my agents are doing. Anything risky in the diff? Give one blunt, specific recommendation.'],
  agent: ['what\'s my agent doing?', 'What is my coding agent doing right now / what did it last say? Summarize in 2–3 lines and tell me whether it needs me.'],
  next: ['next step?', 'Given my recent commits, current diff, and my agent\'s latest messages: what is the single best next step? One line, then a one-line why. If it helps, give me the exact prompt to paste to my agent.'],
};
let sending = false;
async function send(text, mode = 'chat') {
  if (sending) return;
  sending = true;
  const [label, prompt] = MODES[mode] || [text, text];
  addMsg('user', label);
  history.push({ role: 'user', content: prompt });
  const pending = addMsg('pet', '…');
  transient('poke', 300);
  let dots = 0; const dt = setInterval(() => { pending.textContent = '.'.repeat(1 + (dots++ % 3)); }, 300);
  let msgs = history.slice(-16);
  while (msgs.length && msgs[0].role !== 'user') msgs = msgs.slice(1);
  let r;
  try { r = await api.chat({ messages: msgs, mode }); }
  catch (e) { r = { error: e.message || String(e) }; }
  finally { clearInterval(dt); sending = false; }
  if (r.error === 'nokey') {
    pending.remove(); history.pop();
    $('keyForm').classList.remove('hidden'); $('keyInput').focus();
    return;
  }
  if (r.error) { history.pop(); pending.remove(); addMsg('pet', `That didn't work: ${r.error}`, 'err'); return; }
  pending.remove();
  if (r.note) addMsg('pet', r.note, 'note');
  addMsg('pet', r.text);
  history.push({ role: 'assistant', content: r.text });
  if (!chatOpen) say(r.text.slice(0, 140));
}
$('chatForm').onsubmit = e => {
  e.preventDefault();
  const v = $('chatInput').value.trim();
  if (!v) return;
  $('chatInput').value = ''; $('chatSend').disabled = true;
  send(v);
};
$('chatInput').addEventListener('input', e => { $('chatSend').disabled = !e.target.value.trim(); });
$('chips').onclick = e => { const m = e.target.closest('button')?.dataset.mode; if (m) send(null, m); };
$('keyForm').onsubmit = async e => {
  e.preventDefault();
  const ok = await api.setKey($('keyInput').value);
  $('keyInput').value = '';
  $('keyForm').classList.add('hidden');
  addMsg('pet', ok ? 'Key saved. Chat will use it.' : 'Key cleared.', 'note');
  if (snap) snap.hasKey = ok;
  $('chatInput').focus();
};
$('renameForm').onsubmit = e => {
  e.preventDefault();
  const n = $('renameInput').value.trim();
  if (n) { api.rename(n); addMsg('pet', `${n}. I love it.`); }
  $('renameForm').classList.add('hidden');
};
