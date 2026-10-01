// render — edit list → 1080×1920 short.mp4 with the system ffmpeg. Every step is a child process, so Net's
// renderer never waits on it. Overlay cards arrive as PNGs (this ffmpeg build has no drawtext/freetype).
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { outLen } = require('./edl');

const W = 1080, H = 1920, FG_W = 1080, FG_H = 1350, FG_Y = 400, FPS = 30;

function findBin(name) {
  for (const p of [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]) if (fs.existsSync(p)) return p;
  try { return execFileSync('/usr/bin/which', [name], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

// every ffmpeg/ffprobe started here dies with this process: quitting mid-render (or a killed test run) must not
// leave an encoder burning CPU for minutes with nobody left to read its output
const live = new Set();
process.on('exit', () => { for (const p of live) try { p.kill('SIGKILL'); } catch {} });
function track(p) { live.add(p); const drop = () => live.delete(p); p.once('close', drop); p.once('error', drop); return p; }

function run(bin, args, { cwd, timeout = 10 * 60e3 } = {}) {
  return new Promise((res, rej) => {
    const p = track(spawn(bin, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] }));
    let err = '';
    p.stderr.on('data', d => { err = (err + d).slice(-4000); });
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('error', e => { clearTimeout(t); rej(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? res() : rej(new Error(`${path.basename(bin)} exit ${code}: ${err.split('\n').slice(-4).join(' ')}`)); });
  });
}

async function probeDuration(ffprobe, file) {
  const out = await new Promise((res, rej) => {
    const p = track(spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]));
    let o = ''; p.stdout.on('data', d => o += d); p.on('close', c => c === 0 ? res(o) : rej(new Error('ffprobe failed'))); p.on('error', rej);
  });
  const d = parseFloat(out);
  if (!Number.isFinite(d)) throw new Error('no duration');
  return d;
}

// a MediaRecorder webm has no cues (every seek would decode from the start): copy it into an indexed mkv once
async function remux(ffmpeg, dir) {
  const src = path.join(dir, 'src.mkv');
  if (!fs.existsSync(src)) await run(ffmpeg, ['-y', '-v', 'error', '-fflags', '+genpts', '-i', path.join(dir, 'raw.webm'), '-c', 'copy', src]);
  return src;
}

// one clip: blurred full-frame background, a sharp 4:5 crop around where the cursor was, the prompt card on top,
// the title card over the first 2s of the hook, and Net in the corner
function clipArgs({ src, clip, i, cards, title, pet, out }) {
  const len = clip.src_end - clip.src_start, fx = clip.focus_x ?? 0.5;
  const args = ['-y', '-v', 'error', '-ss', String(clip.src_start), '-t', String(len), '-i', src];
  const f = [
    `[0:v]setpts=(PTS-STARTPTS)/${clip.speed},fps=${FPS},split[a][b]`,
    `[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28,eq=brightness=-0.18[bg]`,
    // crop width = 0.8×height (4:5), centred on the cursor, kept inside the frame
    `[b]crop=w='min(iw,ih*0.8)':h=ih:x='max(0,min(iw-min(iw,ih*0.8),${fx}*iw-min(iw,ih*0.8)/2))':y=0,scale=${FG_W}:${FG_H}:force_original_aspect_ratio=decrease,pad=${FG_W}:${FG_H}:(ow-iw)/2:(oh-ih)/2:color=black@0[fg]`,
    `[bg][fg]overlay=(W-w)/2:${FG_Y}[v0]`,
  ];
  let last = 'v0', n = 1;
  const card = cards[i];
  if (card) {
    args.push('-framerate', '15', '-i', path.join(card, '%03d.png'));
    f.push(`[${n}:v]format=rgba[c${n}]`, `[${last}][c${n}]overlay=(W-w)/2:70:eof_action=repeat[v${n}]`); last = `v${n}`; n++;
  }
  if (clip.role === 'hook' && title) {
    args.push('-loop', '1', '-t', '2', '-i', title);
    f.push(`[${last}][${n}:v]overlay=0:0:enable='lt(t,2)':eof_action=pass[v${n}]`); last = `v${n}`; n++;
  }
  if (pet) {
    args.push('-i', pet);
    f.push(`[${n}:v]scale=150:-1,format=rgba,colorchannelmixer=aa=0.85[p]`, `[${last}][p]overlay=W-w-40:H-h-60[v${n}]`); last = `v${n}`; n++;
  }
  f.push(`[${last}]format=yuv420p[out]`);
  args.push('-filter_complex', f.join(';'), '-map', '[out]', '-an', '-t', String(outLen(clip)),
    '-c:v', 'h264_videotoolbox', '-b:v', '10M', '-r', String(FPS), out);
  return args;
}

// edl + cards → short.mp4, cover.jpg. onStep(label) for Net's progress bubble.
async function render({ dir, edl, cards = [], title, pet, onStep = () => {} }) {
  const ffmpeg = findBin('ffmpeg'), ffprobe = findBin('ffprobe');
  if (!ffmpeg || !ffprobe) { const e = new Error('ffmpeg not found'); e.code = 'NOFFMPEG'; throw e; }
  const src = await remux(ffmpeg, dir);
  const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
  const parts = [];
  for (let i = 0; i < edl.clips.length; i++) {
    onStep(`Rendering ${i + 1}/${edl.clips.length}`);
    const out = path.join(work, `clip${String(i).padStart(2, '0')}.mp4`);
    await run(ffmpeg, clipArgs({ src, clip: edl.clips[i], i, cards, title, pet, out }));
    parts.push(out);
  }
  fs.writeFileSync(path.join(work, 'list.txt'), parts.map(p => `file '${p.replace(/'/g, `'\\''`)}'`).join('\n'));
  const video = path.join(work, 'video.mp4'), short = path.join(dir, 'short.mp4');
  await run(ffmpeg, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(work, 'list.txt'), '-c', 'copy', video]);
  onStep('Finishing');
  // v1a has no music: a silent AAC track keeps every uploader happy (v1c swaps in the score, same loudnorm slot)
  await run(ffmpeg, ['-y', '-v', 'error', '-i', video, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', short]);
  await run(ffmpeg, ['-y', '-v', 'error', '-ss', '1', '-i', short, '-frames:v', '1', '-q:v', '3', path.join(dir, 'cover.jpg')]);
  return { short, duration: await probeDuration(ffprobe, short) };
}

module.exports = { render, remux, probeDuration, findBin, clipArgs, run, live, W, H };
