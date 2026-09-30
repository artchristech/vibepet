// node test/short-real.js <screenshot.png> — full v1b pipeline on a looped real screenshot: OCR → camera → HyperFrames render.
// Manual (slow, needs swiftc + npx): prints the output path and camera findings.
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { directFallback } = require('../content/edl');
const { plan } = require('../content/camera');
const { build, renderHF } = require('../content/compose');
const { ocrFrames } = require('../content/signals');

(async () => {
  const shot = process.argv[2], prompt = process.argv[3] || 'Automatically release this version after App Review';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-hf-'));
  execFileSync('ffmpeg', ['-v', 'error', '-loop', '1', '-framerate', '12', '-t', '90', '-i', shot, '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-g', '24', '-pix_fmt', 'yuv420p', path.join(dir, 'src.mkv')]);
  const disp = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, scale: 2 };
  const windows = Array.from({ length: 45 }, (_, k) => ({ t: k * 2, app: 'Safari', x: 30, y: 39, w: 1395, h: 796 }));
  const edl = directFallback({ prompts: [{ t: 10, text: prompt }, { t: 50, text: 'ship it now please' }], results: [{ t: 30 }, { t: 70 }], duration: 90 });
  const ocr = await ocrFrames({ dir, edl });
  const cam = plan({ clips: edl.clips, windows, ocr, disp, srcW: 2880, srcH: 1800 });
  console.log(cam.map((c, i) => `${edl.clips[i].role}:${c.found}`).join(' '));
  const { hf } = await build({ dir, edl, cam, srcW: 2880, srcH: 1800, ffmpeg: 'ffmpeg', title: '2 prompts → shipped', sub: 'Building vibepet', project: 'vibepet', petPng: path.join(__dirname, '..', 'content', 'net.png'), onStep: s => process.stdout.write(s + '\r') });
  const t0 = Date.now();
  await renderHF({ hf, out: path.join(dir, 'short.mp4'), onStep: s => process.stdout.write(s + '   \r') });
  console.log(`\nrendered in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${path.join(dir, 'short.mp4')}`);
})().catch(e => { console.error(e); process.exit(1); });
