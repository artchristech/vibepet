// node test/content.test.js — redaction, prompt tap, deterministic edit list; with ffmpeg present, a real render.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { redact, tapLine, directFallback, overlayText, outLen } = require('../content/edl');
const { humanAt, textOf } = require('../agents');

// redaction: planted secrets never survive; paths and short hashes do
const planted = 'deploy with sk-ant-api03-FAKEFAKEFAKEFAKEFAKE1234 and AKIAABCDEFGHIJKLMNOP then ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const r = redact(planted);
assert.strictEqual(r.n, 3); assert(!/sk-ant|AKIA|ghp_/.test(r.text), r.text);
assert.strictEqual(redact('edit /Users/me/projects/vibepet/content/render.js at e3d7773').n, 0);
assert.strictEqual(redact('STRIPE_SECRET_KEY=whatever123').text, '[redacted]');

// tap: a typed prompt and a turn end count; tool results, meta and sidechains don't
const ts = '2026-09-29T15:20:18.744Z';
assert.deepStrictEqual(tapLine(JSON.stringify({ type: 'user', timestamp: ts, cwd: '/p/app', message: { content: 'add dark mode' } }), humanAt, textOf),
  { kind: 'prompt', at: Date.parse(ts), text: 'add dark mode', cwd: '/p/app' });
assert.strictEqual(tapLine(JSON.stringify({ type: 'user', timestamp: ts, message: { content: [{ type: 'tool_result', content: 'x' }] } }), humanAt, textOf), null);
assert.strictEqual(tapLine(JSON.stringify({ type: 'user', isMeta: true, timestamp: ts, message: { content: 'x y z' } }), humanAt, textOf), null);
assert.strictEqual(tapLine(JSON.stringify({ type: 'assistant', timestamp: ts, message: { stop_reason: 'end_turn', content: [] } }), humanAt, textOf).kind, 'result');
assert(overlayText('x'.repeat(300)).length === 140);

// edl: 10-minute session, 3 prompts → 30–60s, hook first, every overlay is a real prompt
const prompts = [{ t: 30, text: 'add dark mode to settings' }, { t: 250, text: 'write tests for the theme store' }, { t: 480, text: 'ship it' }];
const results = [{ t: 140 }, { t: 400 }, { t: 560 }];
const e = directFallback({ prompts, results, duration: 600, cursor: [{ t: 30, x: 0.2 }] });
const tot = e.clips.reduce((n, c) => n + outLen(c), 0);
assert(tot >= 30 && tot <= 60, `total ${tot}`);
assert.strictEqual(e.clips[0].role, 'hook');
assert.deepStrictEqual(e.clips.filter(c => c.overlay_prompt).map(c => c.overlay_prompt), prompts.map(p => p.text));
assert(e.clips.every(c => c.src_start >= 0 && c.src_end <= 600 && c.speed >= 1 && c.speed <= 8));
assert.strictEqual(e.clips[0].focus_x, 0.2);
// no prompts: evenly spaced filler, still ≥30s
const e0 = directFallback({ duration: 600 });
assert(e0.clips.reduce((n, c) => n + outLen(c), 0) >= 30);
// many prompts: trimmed to ≤60s
const many = Array.from({ length: 30 }, (_, i) => ({ t: 20 + i * 100, text: `prompt ${i}` }));
assert(directFallback({ prompts: many, duration: 3200 }).clips.reduce((n, c) => n + outLen(c), 0) <= 60);
console.log('content edl ok');

// render: synthetic 10-minute-ish screen (fast: 1280x800, 12fps) through the real pipeline
let ff; try { ff = execFileSync('/usr/bin/which', ['ffmpeg'], { encoding: 'utf8' }).trim(); } catch {}
if (!ff || process.env.SKIP_RENDER) { console.log('render skipped (no ffmpeg)'); process.exit(0); }
const { render } = require('../content/render');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-short-'));
execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x800:rate=12:duration=600', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '300k', path.join(dir, 'raw.webm')]);
const card = path.join(dir, 'card'); fs.mkdirSync(card);
execFileSync(ff, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x0e0f14:size=1000x200:rate=15:duration=1.4', path.join(card, '%03d.png')]);
const t0 = Date.now();
render({ dir, edl: e, cards: e.clips.map(c => c.overlay_prompt ? card : null), title: null, pet: path.join(__dirname, '..', 'content', 'net.png') }).then(out => {
  const probe = JSON.parse(execFileSync(ff.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out.short], { encoding: 'utf8' }));
  const v = probe.streams.find(s => s.codec_type === 'video'), a = probe.streams.find(s => s.codec_type === 'audio');
  assert.deepStrictEqual([v.codec_name, v.width, v.height, a.codec_name], ['h264', 1080, 1920, 'aac']);
  assert(out.duration >= 30 && out.duration <= 60.5, `duration ${out.duration}`);
  assert(fs.existsSync(path.join(dir, 'cover.jpg')));
  console.log(`render ok: ${out.duration.toFixed(1)}s in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out.short}`);
}).catch(err => { console.error(err); process.exit(1); });
