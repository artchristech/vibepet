// node --test test/fleet-lease.test.js — fleet.js lease / release: one holder per member, atomic across processes,
// stale after the ttl, renewable by the holder, shown by status, and checked by the commands that change a member.
// Every run is pointed at a temp ULTRA, and tmux / claude at /usr/bin/false, so nothing reaches the live fleet.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, spawnSync } = require('child_process');
const L = require('./fleet/lib');

const FLEET_JS = path.join(__dirname, 'fleet', 'fleet.js');
function sandbox(t) {
  const ultra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-lease-')));
  t.after(() => fs.rmSync(ultra, { recursive: true, force: true }));
  const env = { ...process.env, VIBEPET_ULTRA: ultra, VP_TMUX: '/usr/bin/false', VP_CLAUDE: '/usr/bin/false', VIBEPET_ULTRA_EVID: path.join(ultra, 'evid') };
  delete env.VP_LEASE_OWNER;
  const cli = (...args) => spawnSync(process.execPath, [FLEET_JS, ...args], { env, encoding: 'utf8', timeout: 30000 });
  return { ultra, dir: path.join(ultra, 'fleet', '.leases'), env, cli };
}

test('lease: taken, held against others, renewed by the holder, released', t => {
  const { dir } = sandbox(t);
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  const a = L.acquireLease('kestrel', 'alice', { dir, now: t0, ttlSec: 600 });
  assert.strictEqual(a.ok, true); assert.strictEqual(a.action, 'taken');
  assert.strictEqual(a.lease.owner, 'alice'); assert.strictEqual(a.lease.leftSec, 600); assert.strictEqual(a.lease.stale, false);
  const b = L.acquireLease('kestrel', 'bob', { dir, now: t0 + 1000 });
  assert.strictEqual(b.ok, false); assert.strictEqual(b.action, 'held'); assert.strictEqual(b.lease.owner, 'alice');
  // another member is independent
  assert.strictEqual(L.acquireLease('beacon', 'bob', { dir, now: t0 }).action, 'taken');
  // the holder taking it again renews it (new ttl, new clock)
  const r = L.acquireLease('kestrel', 'alice', { dir, now: t0 + 500e3, ttlSec: 900 });
  assert.strictEqual(r.action, 'renewed'); assert.strictEqual(r.lease.leftSec, 900);
  assert.notStrictEqual(r.lease.token, a.lease.token);
  // owner-scoped release refuses someone else's lease unless forced; a bare release frees whoever holds it
  assert.strictEqual(L.releaseLease('kestrel', { dir, owner: 'bob' }).action, 'not-yours');
  assert.strictEqual(L.readLease('kestrel', { dir }).owner, 'alice');
  assert.strictEqual(L.releaseLease('kestrel', { dir, owner: 'alice' }).action, 'released');
  assert.strictEqual(L.readLease('kestrel', { dir }), null);
  assert.strictEqual(L.releaseLease('kestrel', { dir }).action, 'free');
  assert.strictEqual(L.releaseLease('beacon', { dir, owner: 'carol', force: true }).action, 'released');
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing left behind');
});

test('lease: a lease past its ttl is stale, and the next taker breaks it', t => {
  const { dir } = sandbox(t);
  const t0 = Date.parse('2026-10-01T12:00:00Z');
  L.acquireLease('delta', 'alice', { dir, now: t0, ttlSec: 10 });
  assert.strictEqual(L.acquireLease('delta', 'bob', { dir, now: t0 + 9000 }).action, 'held');
  const l = L.readLease('delta', { dir, now: t0 + 10000 });
  assert.strictEqual(l.stale, true); assert.match(L.leaseLabel(l), /^alice STALE$/);
  const b = L.acquireLease('delta', 'bob', { dir, now: t0 + 11000 });
  assert.strictEqual(b.ok, true); assert.strictEqual(b.action, 'broke-stale');
  assert.strictEqual(b.broke.owner, 'alice'); assert.strictEqual(b.lease.owner, 'bob');
  assert.deepStrictEqual(fs.readdirSync(dir), ['delta'], 'the stale lease moved aside is deleted');
  // a bare lock dir (a taker that died between mkdir and writing owner.json): held by nobody known, aged by mtime
  fs.mkdirSync(path.join(dir, 'ember'));
  const u = L.acquireLease('ember', 'carol', { dir });
  assert.strictEqual(u.action, 'held'); assert.strictEqual(u.lease.owner, null);
  assert.strictEqual(L.acquireLease('ember', 'carol', { dir, now: Date.now() + (L.LEASE_TTL_SEC + 1) * 1000 }).action, 'broke-stale');
});

test('lease: names that could escape the lease dir are refused; move-aside leftovers are not leases', t => {
  const { dir } = sandbox(t);
  for (const bad of ['../kestrel', 'a/b', 'kestrel.stale-1', '', '.']) assert.throws(() => L.acquireLease(bad, 'alice', { dir }), /bad member name/);
  assert.throws(() => L.acquireLease('kestrel', ' ', { dir }), /owner/);
  assert.throws(() => L.acquireLease('kestrel', 'a\nb', { dir }), /owner/);
  assert.throws(() => L.acquireLease('kestrel', 'alice', { dir, ttlSec: 0 }), /bad ttl/);
  L.acquireLease('atlas', 'alice', { dir });
  fs.mkdirSync(path.join(dir, 'kestrel.stale-123-abcd'));
  assert.deepStrictEqual(L.listLeases({ dir }).map(l => `${l.member}:${l.owner}`), ['atlas:alice']);
});

test('lease CLI: of 8 processes racing for one member exactly one wins (exit 0), the rest get exit 3', async t => {
  const { env, cli, dir } = sandbox(t);
  const run = (owner) => new Promise(res => {
    const p = spawn(process.execPath, [FLEET_JS, 'lease', 'kestrel', owner, '--ttl', '120'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { out += d; });
    p.on('close', code => res({ owner, code, out }));
  });
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => run(`racer-${i}`)));
  const won = rs.filter(r => r.code === 0), lost = rs.filter(r => r.code === 3);
  assert.strictEqual(won.length, 1, rs.map(r => `${r.owner}:${r.code} ${r.out.trim()}`).join('\n'));
  assert.strictEqual(lost.length, 7);
  assert.match(won[0].out, /lease taken by racer-\d for 120s/);
  for (const r of lost) assert.match(r.out, new RegExp(`held by ${won[0].owner}`));
  assert.strictEqual(L.readLease('kestrel', { dir }).owner, won[0].owner);
  // --ttl=N form, renew, wrong-owner release (exit 3), release
  assert.match(cli('lease', 'kestrel', won[0].owner, '--ttl=300').stdout, /renewed .* for 300s/);
  const no = cli('release', 'kestrel', 'someone-else');
  assert.strictEqual(no.status, 3); assert.match(no.stdout, /not released: held by racer-/);
  const ok = cli('release', 'kestrel');
  assert.strictEqual(ok.status, 0); assert.match(ok.stdout, /released \(was racer-/);
  assert.strictEqual(cli('lease', 'nobody', 'alice').status, 1, 'unknown member');
});

test('status shows holders; rearm/pause warn, or refuse when --as names someone else', t => {
  const { cli } = sandbox(t);
  assert.strictEqual(cli('lease', 'atlas', 'driver-a', '--ttl', '600').status, 0);
  const st = cli('status', '--json');
  const j = JSON.parse(st.stdout);
  const atlas = j.members.find(m => m.name === 'atlas');
  assert.strictEqual(atlas.lease.owner, 'driver-a'); assert.strictEqual(atlas.lease.stale, false);
  assert.strictEqual(j.members.find(m => m.name === 'kestrel').lease, null);
  assert.match(cli('status', 'atlas').stdout, /\[lease: driver-a \d+s left\]/);
  // a refusal happens before anything is touched
  const ref = cli('rearm', 'atlas', '--as', 'driver-b');
  assert.strictEqual(ref.status, 1); assert.match(ref.stderr, /refusing rearm: atlas is leased by driver-a .* you are driver-b/);
  // without an identity it is a warning and the command goes on (here: pause finds nothing running)
  const warn = cli('pause', 'atlas');
  assert.match(warn.stderr, /WARNING pause: atlas is leased by driver-a/);
  assert.match(warn.stdout, /atlas: not running/);
  // the holder itself passes the gate
  assert.doesNotMatch(cli('pause', 'atlas', '--as', 'driver-a').stderr, /WARNING|refusing/);
});
