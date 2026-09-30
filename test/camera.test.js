// node test/camera.test.js — OCR prompt matching, framing, and the per-clip camera plan with and without signals.
const assert = require('assert');
const { promptBox, frameFor, plan, toVideo } = require('../content/camera');
const { html } = require('../content/compose');
const { directFallback } = require('../content/edl');

const W = 2880, H = 1800, disp = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, scale: 2 };
// the prompt appears twice (transcript above, input box below): the lower one wins
const lines = [
  { text: '> add dark mode to the settings page', x: 0.1, y: 0.30, w: 0.4, h: 0.02 },
  { text: 'Reading settings.tsx', x: 0.1, y: 0.40, w: 0.2, h: 0.02 },
  { text: '> add dark mode to the settings page', x: 0.1, y: 0.86, w: 0.4, h: 0.02 },
];
const box = promptBox(lines, 'add dark mode to the settings page', W, H);
assert(box && Math.abs(box.y - 0.86 * H) < 2, JSON.stringify(box));
assert.strictEqual(promptBox(lines, 'deploy the worker to production', W, H), null);
assert.strictEqual(promptBox(lines, 'add dark mode to the settings page', W, H, { x: 0, y: 0, w: W, h: H * 0.5 }).y, Math.round(0.30 * H));   // restricted to a window

// framing: a view near the bottom edge of its mask never leaves dead space below
const win = { x: 0, y: 0, w: 2800, h: 1600 }, low = { x: 800, y: 1400, w: 1000, h: 200 };
const f = frameFor(low, { bound: win });
assert(f.y + f.scale * (win.y + win.h) >= 1920 - 1 || f.scale * win.h < 1920, JSON.stringify(f));
assert(frameFor({ x: 0, y: 0, w: 100, h: 100 }).scale <= 1.6);   // never blows text up past 1.6×

assert.deepStrictEqual(toVideo({ x: 30, y: 39, w: 1395, h: 796 }, disp), { x: 60, y: 78, w: 2790, h: 1592, app: undefined });

// plan: with window + OCR → zoom on the box then pull out; payoff fits the front window; nothing → cursor column
const edl = directFallback({ prompts: [{ t: 10, text: 'add dark mode to the settings page' }], results: [{ t: 30 }], duration: 90 });
const windows = Array.from({ length: 45 }, (_, k) => ({ t: k * 2, app: 'Terminal', x: 30, y: 39, w: 1395, h: 796 }));
const ocr = edl.clips.map(c => c.overlay_prompt ? { lines } : null);
const cam = plan({ clips: edl.clips, windows, ocr, disp, srcW: W, srcH: H });
const bi = edl.clips.findIndex(c => c.overlay_prompt);
assert.strictEqual(cam[bi].found, 'ocr'); assert.strictEqual(cam[bi].keys.length, 2);
assert(cam[bi].keys[0].view.w < cam[bi].keys[1].view.w, 'starts tighter than it ends');
assert.strictEqual(cam[edl.clips.findIndex(c => c.role === 'payoff')].found, 'window');
const bare = plan({ clips: edl.clips, windows: [], ocr: [], disp, srcW: W, srcH: H });
assert.strictEqual(bare[bi].found, 'strip');
assert(bare.filter((c, i) => !edl.clips[i].overlay_prompt).every(c => c.found === 'cursor' || c.found === 'window'));

// composition: one timeline key, every clip's media timed, no nested timed video, no CSS filter (keeps fast capture)
const { doc, T } = html({ edl, cam, srcW: W, srcH: H, title: 'x', sub: 'y', project: 'p' });
assert(doc.includes('window.__timelines["short"]') && doc.includes(`data-duration="${T}"`));
assert.strictEqual((doc.match(/<video /g) || []).length, edl.clips.length * 2);
assert(!/filter:\s*blur/.test(doc));
assert(!doc.includes('class="card') || edl.clips.some((c, i) => c.overlay_prompt && cam[i].found !== 'ocr'));
console.log('camera ok');
