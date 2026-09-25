// vibepet renderer — pixel pet, bubble, hud, chat.
const api = window.pet;
const $ = id => document.getElementById(id);
const cv = $('pet'), ctx = cv.getContext('2d');
const S = 4, GW = 56, GH = 52;
const OUT = '#1b1f2e';

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
  crown: [[0,0],[3,0],[6,0],[0,1],[1,1],[3,1],[5,1],[6,1],[0,2],[1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]],
};

// ================= particles =================
function spawn(kind, n, o = {}) {
  for (let i = 0; i < n; i++) parts.push({
    kind, x: o.x ?? rand(16, 40), y: o.y ?? rand(14, 24),
    vx: rand(-0.35, 0.35) * (o.spread ?? 1), vy: -rand(0.25, 0.7) * (o.up ?? 1),
    g: o.g ?? 0, life: 1, decay: rand(0.008, 0.018) * (o.fast ?? 1),
    color: pick(o.colors || ['#fff']),
  });
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
function agentsIn(phase) { return (snap?.agents || []).filter(a => a.phase === phase); }
function baseState(now) {
  if (!snap) return 'idle';
  if (agentsIn('waiting').length) return 'alert';
  if (agentsIn('stalled').length) return 'stalled';
  const lines = snap.git?.lines || 0;
  if (lines > 1200) return 'panic';
  if (agentsIn('working').length) return 'working';
  if (snap.fuel < 20) return 'hungry';
  const late = snap.hour >= 1 && snap.hour < 6;
  if ((late || now - lastInteract > 15 * 60e3) && !hovering && !chatOpen) return 'sleeping';
  return 'idle';
}
function transient(kind, ms) { anim = { kind, until: performance.now() + ms, start: performance.now() }; }

// ================= drawing =================
let nextBlink = 0, blinkUntil = 0, emitT = {};
function every(key, ms, now) { if ((emitT[key] || 0) < now) { emitT[key] = now + ms; return true; } return false; }

function draw(now) {
  const t = now / 1000;
  const st = anim.kind && now < anim.until ? anim.kind : baseState(now);
  const lvl = snap?.level || 1;
  ctx.setTransform(S, 0, 0, S, 0, 0);
  ctx.clearRect(0, 0, GW, GH);

  let cx = 28, cy = 34, rx = 13, ry = 11, bob = 0;
  const hop = (speed, height) => {
    const p = (t * speed) % 1, s = Math.sin(p * Math.PI);
    bob = -Math.round(Math.max(0, s) * height);
    if (p < 0.1 || p > 0.93) { rx += 1; ry -= 1; } else if (s > 0.5) { rx -= 1; ry += 1; }
  };
  switch (st) {
    case 'alert': hop(1.3, 6); break;
    case 'celebrate': case 'levelup': hop(2.2, 9); break;
    case 'love': hop(1.6, 3); break;
    case 'poke': ry -= Math.round(Math.max(0, 1 - (now - anim.start) / 200) * 2); rx += ry < 11 ? 1 : 0; break;
    case 'panic': cx += Math.round(Math.sin(t * 45) * 0.8); break;
    case 'sleeping': ry += Math.sin(t * 1.3) > 0 ? 0 : -1; rx += Math.sin(t * 1.3) > 0 ? 0 : 1; break;
    case 'working': bob = Math.round(Math.sin(t * 7) * 0.5); break;
    case 'hungry': bob = 1; ry -= 1; rx += 1; break;
    default: bob = Math.round(Math.sin(t * 2.2) * 0.7);
  }
  cy += bob;

  // ground shadow
  const sw = Math.max(6, 12 + Math.round(bob / 2));
  ell(28, 47, sw, 1.6, () => 'rgba(0,0,0,.18)');

  // colors — hungry pets go pale
  const fuel = snap?.fuel ?? 80;
  const hue = st === 'panic' ? 150 : 158, sat = Math.round(35 + fuel * 0.45);
  const C = { base: `hsl(${hue} ${sat}% 66%)`, shade: `hsl(${hue + 12} ${sat}% 50%)`, light: `hsl(${hue - 8} ${sat}% 86%)` };

  // feet (wiggle when happy)
  const happy = ['celebrate', 'levelup', 'love'].includes(st);
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
  let led = '#59607a';
  if (agentsIn('waiting').length) led = Math.floor(t * 3) % 2 ? '#ffcf3f' : '#7a5f10';
  else if (agentsIn('stalled').length) led = Math.floor(t * 2) % 2 ? '#ff5c6c' : '#6b1f27';
  else if (agentsIn('working').length) led = `hsl(152 90% ${55 + Math.sin(t * 5) * 15}%)`;
  rect(cx, top - 6, 3, 3, OUT); rect(cx + 1, top - 5, 1, 1, led);
  if (led !== '#59607a') { ctx.globalAlpha = 0.35; rect(cx, top - 6, 3, 3, led); ctx.globalAlpha = 1; rect(cx + 1, top - 5, 1, 1, '#fff'); }

  // crown (L7+)
  if (lvl >= 7) outlined(cx - 10, top - 1, SPR.crown, '#ffcf3f');

  // --- face ---
  const rc = cv.getBoundingClientRect();
  const pxX = rc.left + cx * S, pxY = rc.top + cy * S;
  let lx = Math.max(-1, Math.min(1, Math.round((cursor.x - pxX) / 90)));
  let ly = Math.max(-1, Math.min(1, Math.round((cursor.y - pxY) / 110)));
  if (st === 'working') { lx = 0; ly = 1; }
  const ey = cy - 3 + ly, exL = cx - 6 + lx, exR = cx + 4 + lx;

  if (now > nextBlink) { blinkUntil = now + 110; nextBlink = now + rand(2500, 5500); }
  const blink = now < blinkUntil;
  const shades = lvl >= 5 && hovering && !['sleeping', 'panic', 'alert'].includes(st);

  for (const ex of [exL, exR]) {
    if (shades) continue;
    if (st === 'sleeping') rect(ex, ey + 2, 3, 1, OUT);
    else if (happy) dots(ex, ey, [[0,2],[1,1],[2,2]], OUT);
    else if (st === 'panic' || st === 'stalled') { rect(ex - 1, ey, 4, 4, OUT); rect(ex, ey + 1, 2, 2, '#fff'); if (st === 'panic') rect(ex + (Math.floor(t * 8) % 2), ey + 1, 1, 1, OUT); }
    else if (st === 'alert') { rect(ex - 1, ey - 1, 3, 4, OUT); rect(ex - 1, ey - 1, 1, 1, '#fff'); }
    else if (blink) rect(ex, ey + 2, 2, 1, OUT);
    else if (st === 'hungry') { rect(ex, ey + 1, 2, 2, OUT); rect(ex - 1, ey, 4, 1, C.shade); }
    else { rect(ex, ey, 2, 3, OUT); rect(ex, ey, 1, 1, '#fff'); }
  }
  if (shades) { rect(exL - 2, ey, 14, 1, OUT); rect(exL - 1, ey, 5, 3, OUT); rect(exR - 1, ey, 5, 3, OUT); rect(exL, ey, 2, 1, '#6f7aa8'); rect(exR, ey, 2, 1, '#6f7aa8'); }

  // cheeks (L2+ or happy)
  if ((lvl >= 2 && (snap?.mood ?? 0) > 55) || happy) { rect(cx - 10 + lx, cy, 2, 1, '#ff9ec4'); rect(cx + 8 + lx, cy, 2, 1, '#ff9ec4'); }

  // mouth
  const mx = cx - 1 + lx, my = cy + 2 + ly;
  if (st === 'working') { /* hidden behind laptop */ }
  else if (st === 'eat') { if (Math.floor(t * 7) % 2) rect(mx - 1, my, 4, 3, OUT); else rect(mx - 1, my + 1, 4, 1, OUT); }
  else if (st === 'alert' || st === 'levelup') { rect(mx, my, 3, 3, OUT); rect(mx + 1, my + 1, 1, 1, '#ff7ab0'); }
  else if (st === 'panic' || st === 'stalled') dots(mx - 1, my + 1, [[0,1],[1,0],[2,1],[3,0],[4,1]], OUT);
  else if (st === 'sleeping') rect(mx + 1, my + 1, 1, 1, OUT);
  else if (st === 'hungry') dots(mx - 1, my + 1, [[0,1],[1,0],[2,0],[3,1]], OUT);
  else dots(mx - 1, my, [[0,0],[1,1],[2,1],[3,0]], OUT);

  // laptop while the agent works — little hands typing
  if (st === 'working') {
    const ly0 = cy + 1;
    rect(cx - 8, ly0, 16, 9, OUT); rect(cx - 7, ly0 + 1, 14, 7, '#c9cfdc'); rect(cx - 7, ly0 + 1, 14, 1, '#e6eaf2');
    rect(cx - 1, ly0 + 4, 2, 2, `hsl(152 80% ${60 + Math.sin(t * 3) * 10}%)`);
    rect(cx - 10, ly0 + 9, 20, 3, OUT); rect(cx - 9, ly0 + 10, 18, 1, '#8a92a8');
    const k = Math.floor(t * 10) % 2;
    rect(cx - 10, ly0 + 7 + k, 3, 2, C.base); rect(cx + 7, ly0 + 8 - k, 3, 2, C.base);
  }

  // over-head indicators
  if (st === 'alert' && Math.floor(t * 3) % 3) outlined(cx + 8, top - 10 + bob * 0, SPR.bang, '#ffcf3f');
  if (st === 'stalled') outlined(cx + 8, top - 10, SPR.what, '#ff8a95');

  // ambient emitters
  if (st === 'sleeping' && every('z', 1600, now)) spawn('z', 1, { x: cx + 9, y: top, up: 0.4, spread: 0.3, colors: ['#c7d0ff'], fast: 0.6 });
  if ((st === 'panic' || (snap?.git?.lines || 0) > 400) && st !== 'sleeping' && every('drop', 900, now)) spawn('drop', 1, { x: cx + pick([-11, 10]), y: cy - 6, up: -0.3, g: 0.03 });
  if (st === 'working' && every('note', 3000, now)) spawn('note', 1, { x: cx - 12, y: top + 2, up: 0.4, colors: ['#7ef0c1', '#8fd3ff'], fast: 0.7 });
  if (happy && every('spark', 120, now)) spawn('spark', 3, { x: cx + rand(-12, 12), y: cy - 10, colors: CONFETTI, up: 1.4, g: 0.04 });
  if (lvl >= 3 && st === 'idle' && every('trail', 2500, now)) spawn('spark', 2, { x: cx + rand(-14, 14), y: cy + rand(-6, 8), up: 0.2, colors: ['#fff', '#c7fff0'], fast: 1.5 });

  drawParts();
}

function loop(now) { draw(now); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

// ================= speech bubble =================
const bubble = $('bubble');
let bubbleQ = [], bubbleBusy = false, bubbleTimer, typeTimer;
function say(text, { ms = 5500, prio = false, alert = false } = {}) {
  if (prio || !bubbleBusy) { bubbleQ = prio ? [] : bubbleQ; show({ text, ms, alert }); }
  else if (bubbleQ.length < 3) bubbleQ.push({ text, ms, alert });
}
function show({ text, ms, alert }) {
  clearTimeout(bubbleTimer); clearInterval(typeTimer);
  bubbleBusy = true;
  bubble.className = 'hit' + (alert ? ' alert' : '');
  bubble.textContent = '';
  let i = 0;
  typeTimer = setInterval(() => {
    bubble.textContent = text.slice(0, ++i);
    if (i % 3 === 0) blip(880 + Math.random() * 200, 0.015, 0.01);
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
  lines: (n, r) => [`${n} lines uncommitted in ${r}. one commit and I'd feel safer`, `that diff is getting chonky (${n} lines)`],
  stale: m => [`last commit was ${m} min ago. save point?`],
  night: h => [`it's ${h}am. the bugs are more confident at night.`, 'sleep is a performance optimization'],
};
let nextChatter = performance.now() + 25000;
setInterval(() => {
  const now = performance.now();
  if (!snap || now < nextChatter || bubbleBusy || chatOpen) return;
  nextChatter = now + rand(3, 7) * 60e3;
  const st = baseState(now);
  if (st === 'sleeping' || st === 'alert') return;
  const g = snap.git, working = agentsIn('working')[0];
  let pool = LINES.idle;
  if (working) pool = LINES.working(working.name);
  if (snap.fuel < 25) pool = LINES.hungry;
  else if (g?.lines > 250) pool = LINES.lines(g.lines, g.name);
  else if (g?.lines > 0 && g.lastCommitAt && Date.now() - g.lastCommitAt > 90 * 60e3) pool = LINES.stale(Math.round((Date.now() - g.lastCommitAt) / 60e3));
  else if (snap.hour >= 1 && snap.hour < 5) pool = LINES.night(snap.hour);
  say(pick(pool));
}, 15000);

// ================= main-process feeds =================
api.on('cursor', c => { cursor = c; });
api.on('tick', s => {
  const first = !snap;
  snap = s;
  renderHud();
  $('chatTitle').textContent = s.name;
  if (first) {
    const w = agentsIn('waiting');
    say(w.length ? `hi! ${w.map(a => a.name).join(', ')} ${w.length > 1 ? 'are' : 'is'} waiting on you` : pick(['hi! I\'m back', 'boot sequence complete ✨', 'reporting for vibe duty']), { alert: !!w.length });
  }
});
api.on('event', e => {
  lastInteract = performance.now();
  switch (e.kind) {
    case 'agentDone': say(e.text, { prio: true, alert: true, ms: 8000 }); tune([660, 880, 1320]); break;
    case 'agentStalled': say(e.text, { prio: true, alert: true, ms: 8000 }); tune([440, 330]); break;
    case 'commit': transient('eat', 1300); setTimeout(() => transient('celebrate', 2200), 1300);
      spawn('spark', 30, { x: 28, y: 22, spread: 3, up: 2, g: 0.05, colors: CONFETTI }); say(e.text, { prio: true }); tune([523, 659, 784, 1047], 80); break;
    case 'levelup': transient('levelup', 3500); spawn('spark', 60, { x: 28, y: 20, spread: 4, up: 2.5, g: 0.05, colors: CONFETTI });
      say(e.text, { prio: true, ms: 7000 }); tune([523, 659, 784, 1047, 784, 1047, 1319], 110); break;
    case 'quick': transient('love', 1500); spawn('heart', 3, { colors: ['#ff5c8a'] }); say(e.text); blip(1200, 0.12); break;
    case 'nervous': case 'panic': say(e.text, { prio: e.kind === 'panic', alert: e.kind === 'panic', ms: 7000 }); break;
    case 'snack': transient('eat', 1200); say(e.text); break;
    case 'snackNo': case 'night': say(e.text); break;
    case 'openChat': openChat(); break;
    case 'openKey': openChat(); $('keyForm').classList.remove('hidden'); $('keyInput').focus(); break;
    case 'openRename': openChat(); $('renameForm').classList.remove('hidden'); $('renameInput').value = snap?.name || ''; $('renameInput').select(); break;
  }
});

// ================= hud =================
const ago = ms => { const m = Math.round(ms / 60000); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderHud() {
  if (!snap) return;
  $('hudName').textContent = snap.name;
  $('hudLvl').textContent = `Lv${snap.level}`;
  $('hudStreak').textContent = snap.streak ? `🔥${snap.streak}` : '';
  $('barXp').style.width = `${Math.round(100 * (snap.xp - snap.xpLo) / (snap.xpHi - snap.xpLo))}%`;
  $('barFuel').style.width = `${snap.fuel}%`;
  $('barMood').style.width = `${snap.mood}%`;
  const g = snap.git;
  if (g?.root) {
    const cls = g.lines > 1200 ? 'bad' : g.lines > 400 ? 'warn' : '';
    $('hudRepo').innerHTML = `⎇ <b>${esc(g.name)}</b>${g.branch ? '/' + esc(g.branch) : ''} · <span class="${cls}">±${g.lines}</span> in ${g.files}f${g.untracked ? ` +${g.untracked}new` : ''} · ${g.lastCommitAt ? ago(Date.now() - g.lastCommitAt) : 'no commits'}`;
  } else $('hudRepo').textContent = g?.dir ? `${g.dir.split('/').pop()} isn't a git repo` : 'no repo — start an agent or right-click → watch';
  $('hudAgents').innerHTML = (snap.agents || []).slice(0, 6).map(a =>
    `<span class="chip ${a.phase}" title="${a.phase} since ${ago(Date.now() - a.since)}">${esc(a.name)}${a.phase === 'waiting' ? ' · your move' : a.phase === 'stalled' ? ' · stuck?' : ''}</span>`).join('');
}

// ================= mouse: click-through, drag, click =================
let ignoring = true, hudTimer;
const setIgnore = v => { if (v !== ignoring) { ignoring = v; api.setIgnore(v); } };
function petPixelHit(e) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor(e.clientX - r.left), y = Math.floor(e.clientY - r.top);
  for (const [dx, dy] of [[0,0],[6,0],[-6,0],[0,6],[0,-6]]) {
    try { if (ctx.getImageData(x + dx, y + dy, 1, 1).data[3] > 60) return true; } catch {}
  }
  return false;
}
function showHud(on) {
  clearTimeout(hudTimer);
  if (on) { $('hud').classList.add('show'); hovering = true; lastInteract = performance.now(); }
  else hudTimer = setTimeout(() => { $('hud').classList.remove('show'); hovering = false; }, 900);
}
document.addEventListener('mousemove', e => {
  if (dragging) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  let hit = el && el.closest('.hit');
  if (hit === cv && !petPixelHit(e)) hit = null;
  setIgnore(!hit);
  showHud(hit === cv || (hit && hit.id === 'hud') || (hit && $('hud').contains(hit)));
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
  if (d.detail >= 2) { openChat(); return; }
  poke();
});
cv.addEventListener('contextmenu', e => { e.preventDefault(); api.menu(); });

function poke() {
  lastInteract = performance.now();
  api.pet();
  const w = agentsIn('waiting'), s = agentsIn('stalled');
  if (w.length || s.length) {
    transient('poke', 250);
    say([...w.map(a => `${a.name} is waiting on you`), ...s.map(a => `${a.name} might need an approval`)].join('\n'), { prio: true, alert: true });
    return;
  }
  transient(Math.random() < 0.5 ? 'love' : 'poke', 900);
  spawn('heart', 2, { x: 28 + rand(-8, 8), y: 18, colors: ['#ff5c8a', '#ff9ec4'] });
  blip(pick([740, 880, 988]), 0.07);
  if (Math.random() < 0.4) say(pick(['hehe', '*happy wiggle*', 'boop', 'again!', snap ? `⚡${Math.round(snap.fuel)} ♥${Math.round(snap.mood)}` : 'hi']), { ms: 1600 });
}

$('btnChat').onclick = () => openChat();
$('btnMenu').onclick = () => api.menu();

// ================= chat =================
let history = [];
function openChat() {
  chatOpen = true; lastInteract = performance.now();
  $('chat').classList.remove('hidden');
  api.focus();
  if (snap && !snap.hasKey) $('keyForm').classList.remove('hidden');
  setTimeout(() => ($('keyForm').classList.contains('hidden') ? $('chatInput') : $('keyInput')).focus(), 50);
  if (!$('msgs').children.length) addMsg('pet', pick(['what\'s up?', 'hey :) try a chip below, or just talk', 'I see your repo. ask me anything.']));
}
function closeChat() { chatOpen = false; $('chat').classList.add('hidden'); ['keyForm', 'renameForm'].forEach(id => $(id).classList.add('hidden')); }
$('chatClose').onclick = closeChat;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeChat(); });

function renderMd(text) {
  const blocks = [];
  let h = esc(text).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code) => { blocks.push(code.replace(/\n$/, '')); return `\u0000${blocks.length - 1}\u0000`; });
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre><button class="copy" data-i="${i}">copy</button><code>${blocks[i]}</code></pre>`);
}
function addMsg(who, text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${who} ${cls}`;
  if (who === 'pet') el.innerHTML = renderMd(text); else el.textContent = text;
  el.querySelectorAll('.copy').forEach(b => b.onclick = () => {
    api.copy(b.nextElementSibling.textContent); b.textContent = 'copied!';
    say('copied. now go commit it 👀', { ms: 2500 });
  });
  $('msgs').appendChild(el);
  $('msgs').scrollTop = 1e9;
  return el;
}

const MODES = {
  commit: ['✍️ commit msg', 'Write a commit message for my current uncommitted changes. Conventional-commit subject ≤72 chars, blank line, 2–5 terse bullets. Output ONLY the message in a single ```text code block.'],
  vibe: ['🔍 vibe check', 'Vibe check: look at my diff size, time since last commit, and what my agents are doing. Anything risky in the diff? Give one blunt, specific recommendation.'],
  agent: ['🤖 what\'s my agent doing?', 'What is my coding agent doing right now / what did it last say? Summarize in 2–3 lines and tell me whether it needs me.'],
  next: ['🎯 next step?', 'Given my recent commits, current diff, and my agent\'s latest messages: what is the single best next step? One line, then a one-line why. If it helps, give me the exact prompt to paste to my agent.'],
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
  const r = await api.chat({ messages: msgs, mode });
  clearInterval(dt);
  sending = false;
  if (r.error === 'nokey') {
    pending.remove(); history.pop();
    $('keyForm').classList.remove('hidden'); $('keyInput').focus();
    return;
  }
  if (r.error) { history.pop(); pending.remove(); addMsg('pet', `hmm, that didn't work: ${r.error}`, 'err'); return; }
  pending.remove();
  addMsg('pet', r.text);
  history.push({ role: 'assistant', content: r.text });
  if (!chatOpen) say(r.text.slice(0, 140));
}
$('chatForm').onsubmit = e => {
  e.preventDefault();
  const v = $('chatInput').value.trim();
  if (!v) return;
  $('chatInput').value = '';
  send(v);
};
$('chips').onclick = e => { const m = e.target.closest('button')?.dataset.mode; if (m) send(null, m); };
$('keyForm').onsubmit = async e => {
  e.preventDefault();
  const ok = await api.setKey($('keyInput').value);
  $('keyInput').value = '';
  $('keyForm').classList.add('hidden');
  addMsg('pet', ok ? 'key saved 🔑 let\'s talk.' : 'key cleared.');
  if (snap) snap.hasKey = ok;
  $('chatInput').focus();
};
$('renameForm').onsubmit = e => {
  e.preventDefault();
  const n = $('renameInput').value.trim();
  if (n) { api.rename(n); addMsg('pet', `${n}. I love it.`); }
  $('renameForm').classList.add('hidden');
};
