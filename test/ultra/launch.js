// test/ultra/launch.js — drive the real vibepet (Electron) through Playwright, cut off from the user's own Claude data.
//
//   const { launch } = require('./test/ultra/launch');
//   const v = await launch({ root: `${os.homedir()}/.vibepet-ultra/root/.claude`, state: { setupDone: true } });
//   const { mode } = await v.openHome();   // a real click on Net's pixels → the Home panel ('now', or 'setup' on a first run)
//   await v.shot('home.png');              // composited onto neutral grey; { alpha: true } keeps the transparency
//   const snap = await v.evalMain(() => globalThis.__vibepet.snapshot());
//   const { orphans } = await v.close();   // quits, then proves no process of this instance outlived it
//
// Privacy guard: `root` (the Claude config root the instance watches, VIBEPET_CLAUDE_DIR) must resolve, symlinks
// followed, inside ~/.vibepet-ultra, and so must userData. Under root/projects and root/sessions every symlink must land
// inside ~/.vibepet-ultra or in a fixture-fleet session dir (its name contains -vibepet-ultra-fleet-); sessions/ may also
// link one Claude Code registry file (<pid>.json). launch() throws before anything starts otherwise, and shot() checks
// again before every capture. See test/ultra/README.md.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');

const ULTRA = path.join(os.userInfo().homedir, '.vibepet-ultra');   // from the user database: a changed $HOME can't move it
const APP_DIR = path.resolve(__dirname, '..', '..');
const FLEET = '-vibepet-ultra-fleet-';   // a fixture-fleet session dir: the only real ~/.claude/projects dirs a test may watch
const BG = '#8a8f98';   // neutral mid grey: dark panels, light cards and the pale sprites all read against it
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- privacy guard ----------
// realpath of p, or of its deepest existing ancestor plus the rest: a symlink anywhere on the way is followed
function real(p) {
  let head = path.resolve(p); const tail = [];
  for (;;) {
    try { return path.join(fs.realpathSync.native(head), ...tail); } catch {}
    const up = path.dirname(head);
    if (up === head) return path.resolve(p);
    tail.unshift(path.basename(head)); head = up;
  }
}
const within = (base, p) => { const r = path.relative(base, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
const inside = (base, p) => within(real(base), real(p));
// where a symlink under the watched root may land: the ultra scratch root, a fleet session dir, or (sessions/ only) one
// Claude Code registry file. Anything else would put the user's real transcripts in front of the test instance.
function allowedTarget(t, kind, base) {
  if (within(real(base), t)) return true;
  if (t.split(path.sep).some(seg => seg.includes(FLEET))) return true;
  return kind === 'sessions' && path.basename(path.dirname(t)) === 'sessions' && /^\d+\.json$/.test(path.basename(t));
}
// throws unless root (with everything vibepet reads under it) and userData stay inside base (default ~/.vibepet-ultra)
function checkRoot(root, { userData, base = ULTRA } = {}) {
  if (!root) throw new Error('launch: `root` is required: the isolated Claude config root the instance watches (VIBEPET_CLAUDE_DIR)');
  for (const p of [root, path.join(root, 'projects'), path.join(root, 'sessions')])
    if (!inside(base, p)) throw new Error(`launch: refusing root: ${p} resolves to ${real(p)}, outside ${base} (privacy guard: never the real ~/.claude)`);
  if (userData && !inside(base, userData)) throw new Error(`launch: refusing userData ${userData}: it resolves outside ${base}`);
  for (const kind of ['projects', 'sessions']) {
    const walk = (dir, depth) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) {
          const t = real(p);
          if (!allowedTarget(t, kind, base)) throw new Error(`launch: refusing root: ${p} links to ${t}, which is neither under ${base} nor a fixture-fleet dir (*${FLEET}*)`);
        } else if (e.isDirectory() && depth < 4) walk(p, depth + 1);
      }
    };
    walk(path.join(root, kind), 0);
  }
}

// ---------- processes: ours = descendants of the Electron we launched + new processes naming this instance's userData ----
function psRows() {
  const ps = o => execFileSync('/bin/ps', ['-axo', o], { encoding: 'utf8', maxBuffer: 64e6 }).split('\n');
  const cmd = new Map(ps('pid=,command=').map(l => l.trim().match(/^(\d+)\s+(.*)$/)).filter(Boolean).map(m => [+m[1], m[2]]));
  const rows = [];
  for (const l of ps('pid=,ppid=,lstart=,comm=')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
    if (m) rows.push({ pid: +m[1], ppid: +m[2], start: m[3].replace(/\s+/g, ' '), t: Date.parse(m[3]), comm: m[4], cmd: cmd.get(+m[1]) || '' });
  }
  return rows;
}
// pid and every descendant, plus every process started since `since` whose command line names `mark` (a path unique to
// one instance) — never this harness or its ancestors. Only pid, ppid, start and the executable's base name leave here:
// other people's command lines are never returned.
function ours(pid, { mark, since = 0 } = {}, rows = psRows()) {
  const byPid = new Map(rows.map(r => [r.pid, r])), out = new Map(), q = [pid], mine = new Set();
  for (let p = process.pid; p > 1 && !mine.has(p); p = byPid.get(p)?.ppid ?? 0) mine.add(p);
  while (q.length) { const p = q.shift(), r = byPid.get(p); if (!r || out.has(p)) continue; out.set(p, r); for (const c of rows) if (c.ppid === p) q.push(c.pid); }
  if (mark) for (const r of rows) if (r.cmd.includes(mark) && r.t >= since - 2000 && !mine.has(r.pid)) out.set(r.pid, r);
  return [...out.values()].map(r => ({ pid: r.pid, ppid: r.ppid, start: r.start, name: path.basename(r.comm).slice(0, 60) }));
}
// a pid is only still "ours" while its start time matches (pids get reused on a busy Mac)
const alive = (procs, rows = psRows()) => { const now = new Map(rows.map(r => [r.pid, r.start])); return procs.filter(p => now.get(p.pid) === p.start); };

// ---------- screenshots: transparent window → PNG with alpha → composited onto an opaque background ----------
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = ~0; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (~c) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// 8-bit RGBA/RGB non-interlaced PNG (what Chromium writes) → { w, h, rgba }
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let w, h, ct; const idat = [];
  for (let o = 8; o < buf.length;) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12] !== 0 || ![2, 6].includes(ct)) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(d);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[row + x] = (src[x] + pred) & 255;
    }
  }
  if (bpp === 4) return { w, h, rgba: px };
  const rgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0, j = 0; i < px.length; i += 3, j += 4) px.copy(rgba, j, i, i + 3);
  return { w, h, rgba };
}
// 8-bit RGB (3 bytes/px) or RGBA (4) → PNG, filter 0
function encodePng(w, h, px, bpp = 3) {
  const raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * bpp + 1) + 1, y * w * bpp, (y + 1) * w * bpp);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// straight-alpha "over" onto an opaque colour → RGB PNG
function compositePng(buf, bg = BG) {
  const { w, h, rgba } = decodePng(buf), [R, G, B] = [1, 3, 5].map(i => parseInt(bg.slice(i, i + 2), 16)), rgb = Buffer.alloc(w * h * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const a = rgba[i + 3] / 255;
    rgb[j] = Math.round(rgba[i] * a + R * (1 - a)); rgb[j + 1] = Math.round(rgba[i + 1] * a + G * (1 - a)); rgb[j + 2] = Math.round(rgba[i + 2] * a + B * (1 - a));
  }
  return encodePng(w, h, rgb);
}

// ---------- launch ----------
async function launch({ appDir = APP_DIR, root, userData, env = {}, hotkey, state, timeout = 90e3 } = {}) {
  root = root && path.resolve(root);
  checkRoot(root, { userData: userData && path.resolve(userData) });
  let ownUserData = false;
  if (!userData) { fs.mkdirSync(path.join(ULTRA, 'userdata'), { recursive: true }); userData = fs.mkdtempSync(path.join(ULTRA, 'userdata', 'run-')); ownUserData = true; }
  userData = path.resolve(userData);
  fs.mkdirSync(userData, { recursive: true });
  checkRoot(root, { userData });
  // seed the profile (e.g. { setupDone: true } for a returning user's Home), merged over what's saved, as load() merges
  if (state) {
    const f = path.join(userData, 'state.json');
    let prev = {}; try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    fs.writeFileSync(f, JSON.stringify({ ...prev, ...state }, null, 2));
  }

  // the guarded keys go last: `env` can add anything (ANTHROPIC_BASE_URL for fault injection, …) but can't point the
  // instance back at real data or at a shared profile
  const childEnv = { ...process.env, ...env, VIBEPET_TEST: '1', VIBEPET_CLAUDE_DIR: root, VIBEPET_USER_DATA: userData, VIBEPET_HOTKEY: hotkey ?? 'off' };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  const { _electron } = require('playwright-core');
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: createRequire(path.join(appDir, 'package.json'))('electron'), args: [appDir], cwd: appDir, env: childEnv, timeout });
  const proc = app.process(), pid = proc.pid, logs = [];
  const keep = d => { logs.push(String(d)); if (logs.length > 400) logs.shift(); };
  proc.stdout?.on('data', keep); proc.stderr?.on('data', keep);

  const v = { app, pid, root, userData, logs, t0 };
  const seen = [];   // every process of this instance observed so far: close() proves each one gone
  const note = () => { try { for (const p of ours(pid, { mark: userData, since: t0 })) if (!seen.some(s => s.pid === p.pid && s.start === p.start)) seen.push(p); } catch {} };
  try {
    // the pet = the window showing renderer/index.html (theater and the recorder are other windows)
    const deadline = Date.now() + timeout, left = () => Math.max(1000, deadline - Date.now());
    while (!(v.win = app.windows().find(p => /\/renderer\/index\.html$/.test(p.url())))) {
      if (Date.now() > deadline) throw new Error('launch: the pet window never appeared');
      await app.waitForEvent('window', { timeout: 1000 }).catch(() => {});
    }
    await v.win.waitForLoadState('load');
    while (!(await app.evaluate(() => !!globalThis.__vibepet))) {   // main's test hook lands at the end of whenReady
      if (Date.now() > deadline) throw new Error('launch: main never installed globalThis.__vibepet (VIBEPET_TEST)');
      await sleep(100);
    }
    v.paths = await app.evaluate(() => globalThis.__vibepet.paths);
    if (v.paths.claude !== root || real(v.paths.userData) !== real(userData)) throw new Error(`launch: the app reads ${JSON.stringify(v.paths)}, not the isolated root and userData`);
    await v.win.waitForFunction(() => {   // Net is drawn (his canvas has opaque pixels) and the first snapshot arrived
      const c = document.getElementById('pet'), d = c && c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let drawn = false;
      for (let i = 3; d && i < d.length && !drawn; i += 16) drawn = d[i] > 200;
      return drawn && typeof snap !== 'undefined' && !!snap;   // the renderer's `let snap` (renderer/app.js)
    }, null, { timeout: left() });
    v.readyMs = Date.now() - t0;
    note();
  } catch (e) { await close().catch(() => {}); throw new Error(`${e.message}\n--- app log ---\n${logs.join('').slice(-3000)}`); }

  v.windows = () => app.windows();
  v.evalMain = (fn, arg) => app.evaluate(fn, arg);   // fn(electron, arg), run in the main process
  v.processes = () => { note(); return alive(seen); };
  // a point on Net's own pixels: his canvas is mostly transparent, and only opaque pixels take the mouse (petPixelHit)
  v.petPoint = () => v.win.evaluate(() => {
    const c = document.getElementById('pet'), r = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const A = (x, y) => x < 0 || y < 0 || x >= c.width || y >= c.height ? 0 : d[(y * c.width + x) * 4 + 3];
    let best = null;
    for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
      if (A(x, y) < 250 || [[6, 0], [-6, 0], [0, 6], [0, -6]].some(([dx, dy]) => A(x + dx, y + dy) < 200)) continue;   // solid, not an edge
      const dist = Math.hypot(x - c.width / 2, y - c.height * 0.6);
      if (!best || dist < best.dist) best = { x, y, dist };
    }
    if (!best) throw new Error('no opaque pixel on the pet canvas');
    return { x: r.left + (best.x + 0.5) * r.width / c.width, y: r.top + (best.y + 0.5) * r.height / c.height };
  });
  // a real click: trusted mouse events through Chromium's input pipeline (hover → down → up), the same handlers a hand
  // hits. CDP-dispatched: the person's own cursor, keyboard and frontmost app are left alone.
  v.clickPet = async () => {
    const p = await v.petPoint();
    await v.win.mouse.move(p.x - 30, p.y - 30); await v.win.mouse.move(p.x, p.y, { steps: 4 });
    await v.win.mouse.down(); await sleep(60); await v.win.mouse.up();
    return p;
  };
  // which Home is open: 'now' (sessions + chat), 'setup' (the first-run card), or null (closed)
  v.homeMode = () => v.win.evaluate(() => {
    const $ = id => document.getElementById(id), shown = id => $(id) && !$(id).classList.contains('hidden');
    return !shown('chat') ? null : shown('setup') && $('setup').childElementCount ? 'setup' : shown('now') && $('now').childElementCount ? 'now' : null;
  });
  // one click on Net = Home, after the renderer's 220 ms double-click wait
  v.openHome = async ({ timeout: t = 15e3 } = {}) => {
    if (await v.homeMode()) throw new Error('openHome: Home is already open (another click would close it)');
    const t1 = Date.now(), at = await v.clickPet();
    let mode;
    while (!(mode = await v.homeMode())) { if (Date.now() - t1 > t) throw new Error('openHome: no Home panel after the click'); await sleep(50); }
    const ms = Date.now() - t1;
    await sleep(500);   // let the panel's open transition finish before anyone screenshots it
    return { mode, at, ms };
  };
  // screenshot of a window (default: the pet) composited onto `bg`; { alpha: true } writes the raw transparent capture
  v.shot = async (file, { bg = BG, alpha = false, page = v.win, clip } = {}) => {
    checkRoot(root, { userData });   // the root may have changed since launch: never capture a view of real data
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    const png = await page.screenshot({ omitBackground: true, clip });
    fs.writeFileSync(file, alpha ? png : compositePng(png, bg));
    return file;
  };
  // quit, wait for the exit, then prove that no process of this instance outlived it. Stragglers are ours (descendants
  // of the Electron launched here, or started since and naming this instance's own userData): SIGKILLed, reported.
  async function close({ timeout: t = 20e3 } = {}) {
    note();
    const c0 = Date.now();
    let how = 'quit';
    await Promise.race([app.close().catch(e => { how = `close failed: ${e.message.split('\n')[0]}`; }), sleep(t).then(() => { how = 'timeout'; })]);
    const until = Date.now() + 5000;
    let left = alive(seen);
    while (left.length && Date.now() < until) { await sleep(150); left = alive(seen); }
    let late = []; try { late = ours(-1, { mark: userData, since: t0 }).filter(p => !left.some(l => l.pid === p.pid)); } catch {}
    const orphans = [...left, ...late];
    for (const p of orphans) try { process.kill(p.pid, 'SIGKILL'); } catch {}
    if (ownUserData) fs.rmSync(userData, { recursive: true, force: true });
    return { how, ms: Date.now() - c0, procs: seen.length, orphans: orphans.map(p => ({ pid: p.pid, name: p.name })) };
  }
  v.close = close;
  return v;
}

module.exports = { launch, checkRoot, compositePng, decodePng, encodePng, ours, alive, ULTRA, APP_DIR, BG, FLEET };
