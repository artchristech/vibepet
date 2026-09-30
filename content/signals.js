// signals — what the camera needs to know that the video can't say cheaply:
//   windows: the frontmost app's window rect every 2s while recording (CGWindowList: no Accessibility prompt)
//   ocr:     Apple Vision text boxes on the frame just before each prompt lands, to find the message bar
// Both are tiny Swift helpers compiled once into ~/Library/Caches/vibepet/bin (sources are copied out first, so
// this works from inside an asar). No swiftc (no Xcode tools) → both return nothing and the camera falls back.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const BIN = path.join(os.homedir(), 'Library', 'Caches', 'vibepet', 'bin');
const exec = (cmd, args, opt = {}) => new Promise(res => execFile(cmd, args, { timeout: 60e3, maxBuffer: 32e6, ...opt }, (e, out) => res(e ? null : out)));

const built = new Map();   // name -> Promise<path|null>
function helper(name) {
  if (built.has(name)) return built.get(name);
  const p = (async () => {
    let src; try { src = fs.readFileSync(path.join(__dirname, `${name}.swift`), 'utf8'); } catch { return null; }
    const hash = crypto.createHash('sha1').update(src).digest('hex').slice(0, 10), bin = path.join(BIN, `vp-${name}-${hash}`);
    if (fs.existsSync(bin)) return bin;
    const swiftc = ['/usr/bin/swiftc'].find(f => fs.existsSync(f));
    if (!swiftc) return null;
    fs.mkdirSync(BIN, { recursive: true });
    const tmp = path.join(BIN, `${name}-${hash}.swift`);
    fs.writeFileSync(tmp, src);
    await exec(swiftc, ['-O', tmp, '-o', bin], { timeout: 300e3 });
    fs.rmSync(tmp, { force: true });
    return fs.existsSync(bin) ? bin : null;
  })();
  built.set(name, p);
  return p;
}
const warm = () => { helper('windows'); helper('ocr'); };   // compile in the background when a session starts

// one sample: { app, bundle, x, y, w, h } in global points, or null
let sampling = false;
async function frontWindow() {
  if (sampling) return null;   // never stack spawns if one is slow
  sampling = true;
  try {
    const bin = await helper('windows'); if (!bin) return null;
    const out = await exec(bin, [], { timeout: 3000 });
    const o = out && JSON.parse(out);
    return o && o.w ? o : null;
  } catch { return null; } finally { sampling = false; }
}

// frames just before each prompt lands (build clips start 1s before the prompt; the text is in the input box ~0.4s before send)
async function ocrFrames({ dir, edl, ffmpeg = 'ffmpeg' }) {
  const bin = await helper('ocr');
  const out = edl.clips.map(() => null);
  if (!bin) return out;
  const fdir = path.join(dir, 'ocr'); fs.mkdirSync(fdir, { recursive: true });
  const src = path.join(dir, 'src.mkv'), files = [], idx = [];
  for (const [i, c] of edl.clips.entries()) {
    if (!c.overlay_prompt) continue;
    const f = path.join(fdir, `f${String(i).padStart(2, '0')}.png`);
    await exec(ffmpeg, ['-y', '-v', 'error', '-ss', String(Math.max(0, c.src_start + 0.6)), '-i', src, '-frames:v', '1', f]);
    if (fs.existsSync(f)) { files.push(f); idx.push(i); }
  }
  if (!files.length) return out;
  const res = await exec(bin, files, { timeout: 120e3 });
  let arr = []; try { arr = JSON.parse(res || '[]'); } catch {}
  arr.forEach((r, k) => { out[idx[k]] = r; });
  fs.writeFileSync(path.join(dir, 'ocr.json'), JSON.stringify(out));
  return out;
}

module.exports = { helper, warm, frontWindow, ocrFrames };
