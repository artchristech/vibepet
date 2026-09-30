// compose — edit list + camera plan → a HyperFrames project (session/hf/), rendered with the HyperFrames CLI.
// One monolithic composition: per clip, a blurred full-frame background video and a sharp foreground video inside a
// camera wrapper that GSAP moves (translate + scale + clip-path). Media is cut to per-clip segments first, so the
// renderer never seeks an unindexed webm.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { frameOf, OUT_W, OUT_H } = require('./camera');

const HF_VERSION = '0.8.94';   // pinned: renders stay reproducible; bump deliberately
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r3 = x => Math.round(x * 1000) / 1000;

function run(bin, args, { cwd, timeout = 15 * 60e3, onLine, env = {} } = {}) {
  return new Promise((res, rej) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || '/usr/bin:/bin'}`, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    const eat = d => { const s = String(d); log = (log + s).slice(-8000); if (onLine) s.split(/\r?\n/).filter(Boolean).forEach(onLine); };
    p.stdout.on('data', eat); p.stderr.on('data', eat);
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', e => { clearTimeout(t); rej(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? res(log) : rej(new Error(`${path.basename(bin)} exit ${code}: ${log.split('\n').filter(Boolean).slice(-5).join(' | ')}`)); });
  });
}

// view rect → CSS inset() for the inner wrapper (source-pixel units; the mask rides the transform)
const inset = (r, W, H, round = 18) => `inset(${r.y}px ${W - r.x - r.w}px ${H - r.y - r.h}px ${r.x}px round ${round}px)`;

function html({ edl, cam, srcW, srcH, cards, title, sub, project }) {
  const T = r3(edl.clips.reduce((n, c) => n + (c.src_end - c.src_start) / c.speed, 0));
  let t0 = 0;
  const body = [], tl = [];
  edl.clips.forEach((c, i) => {
    const len = r3((c.src_end - c.src_start) / c.speed), st = r3(t0), id = String(i).padStart(2, '0');
    const media = `data-start="${st}" data-duration="${len}" data-media-start="0" data-playback-rate="${c.speed}"`;
    body.push(
      `<div class="bgw"><video id="v${id}b" class="bgv" src="media/bg${id}.mp4" ${media} data-track-index="0" muted playsinline></video></div>`,
      `<div class="fgw"><div class="inner" id="n${id}"><video id="v${id}" class="fgv" src="media/clip${id}.mp4" ${media} data-track-index="1" muted playsinline></video></div></div>`);
    // camera
    const keys = cam[i].keys, sel = `#n${id}`;
    const fx = cam[i].fx, fr = k => frameOf(k, fx), k0 = keys[0];
    const f0 = k0.from ? { ...fr(k0), scale: +(fr(k0).scale * k0.from).toFixed(4) } : fr(k0);
    if (k0.from) { const f = fr(k0); f0.x = Math.round(OUT_W / 2 - (OUT_W / 2 - f.x) * k0.from); f0.y = Math.round(OUT_H / 2 - (OUT_H / 2 - f.y) * k0.from); }
    tl.push(`tl.set("${sel}", { x: ${f0.x}, y: ${f0.y}, scale: ${f0.scale}, clipPath: "${inset(k0.clip, srcW, srcH)}" }, ${st});`);
    if (k0.from) { const f = fr(k0); tl.push(`tl.to("${sel}", { x: ${f.x}, y: ${f.y}, scale: ${f.scale}, duration: ${r3(Math.min(0.7, len))}, ease: "power3.out" }, ${st});`); }
    if (k0.push) { const f = fr(k0), k = k0.push; f.x = Math.round(OUT_W / 2 - (OUT_W / 2 - f.x) * k); f.y = Math.round(OUT_H / 2 - (OUT_H / 2 - f.y) * k); f.scale = +(f.scale * k).toFixed(4); tl.push(`tl.to("${sel}", { x: ${f.x}, y: ${f.y}, scale: ${f.scale}, duration: ${len}, ease: "none" }, ${st});`); }
    for (const k of keys.slice(1)) {
      const f = fr(k);
      tl.push(`tl.to("${sel}", { x: ${f.x}, y: ${f.y}, scale: ${f.scale}, clipPath: "${inset(k.clip, srcW, srcH)}", duration: ${r3(k.dur || 0.6)}, ease: "${k.ease || 'power2.inOut'}" }, ${r3(st + k.t)});`);
    }
    // the prompt as a card only when the camera couldn't find it on screen
    if (c.overlay_prompt && cam[i].found !== 'ocr') {
      body.push(`<div id="k${id}" class="card clip" data-start="${st}" data-duration="${len}" data-track-index="2"><div class="cardi" id="ki${id}"><div class="bar"><i></i><i></i><i></i><span>${esc(project ? `claude · ${project}` : 'claude')}</span></div><p><b>&gt;</b> ${esc(c.overlay_prompt)}</p></div></div>`);
      tl.push(`tl.fromTo("#ki${id}", { y: -30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ${r3(st + 0.4)});`);
    }
    t0 += len;
  });
  if (title) {
    body.push(`<div id="title" class="clip" data-start="0" data-duration="2" data-track-index="3"><div class="ti" id="tii"><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div>`);
    tl.push(`tl.fromTo("#tii", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, 0);`, `tl.to("#tii", { opacity: 0, duration: 0.3 }, 1.7);`);
  }
  body.push(`<img id="net" class="clip" src="net.png" data-start="0" data-duration="${T}" data-track-index="4" alt="">`);
  return { T, doc: `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${OUT_W}, height=${OUT_H}">
<title>vibepet short</title>
<script src="gsap.min.js"></script>
<style>
body { margin: 0; background: #07080b; }
#root { position: relative; width: 100%; height: 100%; overflow: hidden; background: #07080b; }
.bgw, .fgw { position: absolute; inset: 0; overflow: hidden; }
.bgv { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.inner { position: absolute; left: 0; top: 0; width: ${srcW}px; height: ${srcH}px; transform-origin: 0 0; }
.fgv { display: block; width: 100%; height: 100%; }
.card { position: absolute; left: 40px; right: 40px; top: 70px; }
.cardi { background: rgba(14, 15, 20, 0.92); border: 2px solid rgba(255, 255, 255, 0.12); border-radius: 28px; padding: 26px 44px 34px; color: #e8ecf5; font-family: monospace; }
.bar { display: flex; align-items: center; gap: 12px; font-size: 24px; color: rgba(255, 255, 255, 0.45); margin-bottom: 14px; }
.bar i { width: 18px; height: 18px; border-radius: 50%; background: #ff5f57; }
.bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; margin-right: 18px; }
.cardi p { margin: 0; font-size: 38px; line-height: 1.32; font-weight: 700; }
.cardi b { color: #7ef0c1; }
#title { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8, 9, 12, 0.72); }
.ti { width: 940px; text-align: center; color: #fff; font-family: sans-serif; }
.ti h1 { margin: 0; font-size: 92px; line-height: 1.1; font-weight: 800; }
.ti p { margin: 28px 0 0; font-size: 40px; color: #7ef0c1; font-family: monospace; font-weight: 600; }
#net { position: absolute; right: 40px; bottom: 60px; width: 150px; height: 150px; opacity: 0.85; image-rendering: pixelated; }
</style>
</head>
<body>
<div id="root" data-composition-id="short" data-start="0" data-width="${OUT_W}" data-height="${OUT_H}" data-duration="${T}">
${body.join('\n')}
</div>
<script>
const tl = gsap.timeline({ paused: true });
${tl.join('\n')}
window.__timelines["short"] = tl;
</script>
</body>
</html>
` };
}

// build the project folder: per-clip segments, gsap, Net, index.html
async function build({ dir, edl, cam, srcW, srcH, ffmpeg, title, sub, project, petPng, onStep = () => {} }) {
  const hf = path.join(dir, 'hf'), media = path.join(hf, 'media');
  fs.rmSync(hf, { recursive: true, force: true }); fs.mkdirSync(media, { recursive: true });
  const src = path.join(dir, 'src.mkv');
  for (const [i, c] of edl.clips.entries()) {
    onStep(`Cutting ${i + 1}/${edl.clips.length}`);
    await run(ffmpeg, ['-y', '-v', 'error', '-ss', String(c.src_start), '-t', String(r3(c.src_end - c.src_start)), '-i', src,
      '-an', '-c:v', 'h264_videotoolbox', '-b:v', '14M', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(media, `clip${String(i).padStart(2, '0')}.mp4`),
      // the background, pre-blurred small: a CSS blur would force the renderer's slow screenshot capture
      '-an', '-vf', 'scale=270:480:force_original_aspect_ratio=increase,crop=270:480,gblur=sigma=10,eq=brightness=-0.22:saturation=1.2',
      '-c:v', 'h264_videotoolbox', '-b:v', '1M', '-g', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(media, `bg${String(i).padStart(2, '0')}.mp4`)]);
  }
  fs.copyFileSync(require.resolve('gsap/dist/gsap.min.js'), path.join(hf, 'gsap.min.js'));
  fs.copyFileSync(petPng, path.join(hf, 'net.png'));
  const { doc, T } = html({ edl, cam, srcW, srcH, title, sub, project });
  fs.writeFileSync(path.join(hf, 'index.html'), doc);
  fs.writeFileSync(path.join(hf, 'camera.json'), JSON.stringify(cam, null, 1));
  return { hf, T };
}

// The CLI (with its own headless Chrome) is installed once into ~/Library/Caches/vibepet, then run on this process's
// own runtime: Electron is Node 24 underneath (ELECTRON_RUN_AS_NODE), so the user's node version never matters.
const CLI_DIR = path.join(require('os').homedir(), 'Library', 'Caches', 'vibepet', `hyperframes-${HF_VERSION}`);
function findNpm() {
  const h = process.env.HOME || '';
  for (const p of [path.join(h, '.local/bin/npm'), '/opt/homebrew/bin/npm', '/usr/local/bin/npm', path.join(h, '.volta/bin/npm')]) if (fs.existsSync(p)) return p;
  return null;
}
async function ensureCLI(onStep = () => {}) {
  const pkg = path.join(CLI_DIR, 'node_modules', 'hyperframes', 'package.json');
  if (!fs.existsSync(pkg)) {
    const npm = findNpm();
    if (!npm) { const e = new Error('npm not found (needed once, to install the HyperFrames renderer)'); e.code = 'NONPM'; throw e; }
    onStep('Installing the renderer (one time)');
    fs.mkdirSync(CLI_DIR, { recursive: true });
    await run(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', '--prefix', CLI_DIR, `hyperframes@${HF_VERSION}`], { timeout: 20 * 60e3 });
  }
  const j = JSON.parse(fs.readFileSync(pkg, 'utf8')), bin = typeof j.bin === 'string' ? j.bin : j.bin?.hyperframes || Object.values(j.bin || {})[0];
  return path.join(path.dirname(pkg), bin);
}
async function renderHF({ hf, out, onStep = () => {} }) {
  const cli = await ensureCLI(onStep);
  onStep('Rendering');
  let last = 0;
  await run(process.execPath, [cli, 'render', '--quality', 'looks', '--gpu', '--output', out], {
    cwd: hf, env: { ELECTRON_RUN_AS_NODE: '1' },
    onLine: l => { const m = l.match(/(\d{1,3})%/); if (m && +m[1] >= last + 10) { last = +m[1]; onStep(`Rendering ${last}%`); } } });
  return out;
}

module.exports = { build, renderHF, ensureCLI, html, HF_VERSION, run };
