// node --test test/harness.test.js — test/ultra/launch.js without Electron: the privacy guard, the screenshot
// compositing, and the process bookkeeping close() relies on. Fixtures in a temp dir stand in for ~/.vibepet-ultra.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const H = require('./ultra/launch');

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-harness-')));
function world(t) {   // base = a stand-in for ~/.vibepet-ultra; elsewhere = the rest of the disk (the real ~/.claude, …)
  const base = tmp(), elsewhere = tmp();
  t.after(() => { for (const d of [base, elsewhere]) fs.rmSync(d, { recursive: true, force: true }); });
  const root = path.join(base, 'root', '.claude');
  for (const d of ['projects', 'sessions']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const mk = (p, file) => { fs.mkdirSync(file ? path.dirname(p) : p, { recursive: true }); if (file) fs.writeFileSync(p, '{}'); return p; };
  return { base, elsewhere, root, mk, ok: (r = root, o = {}) => H.checkRoot(r, { base, ...o }) };
}

test('guard: the real ~/.claude and anything outside ~/.vibepet-ultra are refused before a byte is read', async () => {
  assert.throws(() => H.checkRoot(path.join(os.homedir(), '.claude')), /privacy guard/);
  assert.throws(() => H.checkRoot(undefined), /root` is required/);
  assert.strictEqual(H.ULTRA, path.join(os.userInfo().homedir, '.vibepet-ultra'));
  // launch() runs the guard first: nothing is spawned, no userData dir is made
  await assert.rejects(H.launch({ root: path.join(os.homedir(), '.claude') }), /privacy guard/);
  await assert.rejects(H.launch({ root: path.join(H.ULTRA, 'root-x', '.claude'), userData: os.tmpdir() }), /refusing userData/);
});

test('guard: an isolated root inside the base passes, with fleet links and registry links', t => {
  const w = world(t);
  w.ok();
  // the fleet layout: projects/<fleet dir> → the real ~/.claude/projects/<fleet dir>, sessions/<pid>.json → the registry
  const fleet = w.mk(path.join(w.elsewhere, '.claude', 'projects', '-Users-x--vibepet-ultra-fleet-kestrel'));
  fs.symlinkSync(fleet, path.join(w.root, 'projects', path.basename(fleet)));
  fs.symlinkSync(w.mk(path.join(w.elsewhere, '.claude', 'sessions', '4821.json'), true), path.join(w.root, 'sessions', '4821.json'));
  fs.symlinkSync(w.mk(path.join(w.base, 'fixtures', 'p')), path.join(w.root, 'projects', '-local'));   // inside the base
  w.ok(w.root, { userData: path.join(w.base, 'userdata', 'run-1') });
});

test('guard: every way back to real data is refused', t => {
  const w = world(t), real = w.mk(path.join(w.elsewhere, '.claude', 'projects', '-Users-x-projects-secret'));
  const refuse = (setup, re = /privacy guard|refusing/) => {
    const v = world(t); setup(v); assert.throws(() => v.ok(), re);
  };
  // the root itself, or its projects/ or sessions/, resolving outside
  refuse(v => { fs.rmSync(v.root, { recursive: true }); fs.symlinkSync(path.join(w.elsewhere, '.claude'), v.root); });
  refuse(v => { fs.rmSync(path.join(v.root, 'projects'), { recursive: true }); fs.symlinkSync(path.dirname(real), path.join(v.root, 'projects')); });
  refuse(v => { fs.rmSync(path.join(v.root, 'sessions'), { recursive: true }); fs.symlinkSync(w.mk(path.join(w.elsewhere, 's')), path.join(v.root, 'sessions')); });
  // a real (non-fleet) project dir linked in, at the top or nested inside a local dir
  refuse(v => fs.symlinkSync(real, path.join(v.root, 'projects', 'looks-local')), /neither under/);
  refuse(v => fs.symlinkSync(w.mk(path.join(real, 'a.jsonl'), true), path.join(v.mk(path.join(v.root, 'projects', '-x', 'subagents')), 'a.jsonl')), /neither under/);
  // sessions/ takes registry files only, and projects/ takes none
  refuse(v => fs.symlinkSync(w.mk(path.join(w.elsewhere, '.claude', 'sessions', '77.json'), true), path.join(v.root, 'projects', '77.json')), /neither under/);
  refuse(v => fs.symlinkSync(w.mk(path.join(w.elsewhere, 'notes', '1.json'), true), path.join(v.root, 'sessions', '1.json')), /neither under/);
  refuse(v => fs.symlinkSync(real, path.join(v.root, 'sessions', 'p')), /neither under/);
  // userData outside the base
  assert.throws(() => w.ok(w.root, { userData: path.join(w.elsewhere, 'ud') }), /refusing userData/);
});

test('shot(): a transparent capture is composited onto the neutral background, straight alpha', () => {
  // 4×1 RGBA: transparent, opaque red, half-white, opaque black
  const px = Buffer.from([0, 0, 0, 0, 255, 0, 0, 255, 255, 255, 255, 128, 0, 0, 0, 255]);
  const out = H.decodePng(H.compositePng(H.encodePng(4, 1, px, 4)));
  const [R, G, B] = [1, 3, 5].map(i => parseInt(H.BG.slice(i, i + 2), 16)), half = (c, bg) => Math.round(c * 128 / 255 + bg * (1 - 128 / 255));
  assert.deepStrictEqual([...out.rgba], [R, G, B, 255, 255, 0, 0, 255, half(255, R), half(255, G), half(255, B), 255, 0, 0, 0, 255]);
  assert.deepStrictEqual([...H.decodePng(H.compositePng(H.encodePng(1, 1, Buffer.from([0, 0, 0, 0]), 4), '#ffffff')).rgba], [255, 255, 255, 255]);
});

test('close() bookkeeping: a process tree is ours, a dead pid is not, other people\'s command lines never come back', async t => {
  const k = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60e3)', '--', 'vibepet-harness-mark'], { stdio: 'ignore' });
  t.after(() => k.kill('SIGKILL'));
  await new Promise(r => k.once('spawn', r));
  const mine = H.ours(process.pid);
  assert.ok(mine.some(p => p.pid === process.pid) && mine.some(p => p.pid === k.pid), 'self + child');
  assert.ok(mine.every(p => Object.keys(p).join() === 'pid,ppid,start,name'), 'pid, ppid, start, name only');
  const byMark = H.ours(-1, { mark: 'vibepet-harness-mark', since: Date.now() - 60e3 });
  assert.deepStrictEqual(byMark.map(p => p.pid), [k.pid], 'found by its mark; this test process (an ancestor) is never its own orphan');
  assert.deepStrictEqual(H.ours(-1, { mark: 'vibepet-harness-mark', since: Date.now() + 60e3 }), [], 'started before `since`: not ours');
  assert.strictEqual(H.alive(mine).length, mine.length - mine.filter(p => p.name === 'ps').length);   // ps itself has exited
  k.kill('SIGKILL'); await new Promise(r => k.once('exit', r));
  assert.ok(!H.alive(mine).some(p => p.pid === k.pid), 'gone once it exits');
});
