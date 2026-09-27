// node test/receipt.test.js — receipt(): what a turn touched and whether a check ran green after it; fixtures a–i + the read cache.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const A = require('../agents');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-receipt-')), proj = path.join(root, '-x-app');
fs.mkdirSync(proj);
const T0 = Date.now() - 10 * 60e3, iso = t => new Date(t).toISOString();
let seq = 0, n = 0;
const at = s => T0 + s * 1000;
const prompt = s => ({ type: 'user', cwd: '/x/app', timestamp: iso(at(s)), message: { role: 'user', content: 'do the thing' } });
const use = (s, name, input, side) => ({ type: 'assistant', cwd: '/x/app', timestamp: iso(at(s)), ...(side ? { isSidechain: true } : {}),
  message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + (++seq), name, input }] } });
const res = (s, rec, content, is_error, side) => ({ type: 'user', cwd: '/x/app', timestamp: iso(at(s)), ...(side ? { isSidechain: true } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: rec.message.content[0].id, content, ...(is_error ? { is_error: true } : {}) }] } });
const said = (s, text, side) => ({ type: 'assistant', cwd: '/x/app', timestamp: iso(at(s)), ...(side ? { isSidechain: true } : {}), message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const edit = (s, f, side) => use(s, 'Edit', { file_path: f, old_string: 'a', new_string: 'a\nb' }, side);
const bash = (s, command, side) => use(s, 'Bash', { command }, side);
const lines = recs => recs.map(r => JSON.stringify(r));
const write = (f, recs) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, lines(recs).join('\n') + '\n'); };
const classify = recs => { const f = path.join(proj, 's' + (++n) + '.jsonl'); write(f, recs); return A.classify(f, Date.now()).receipt; };

// (a) 2-file edit, then a passing npm test
let t = bash(3, 'npm test');
let r = classify([prompt(0), edit(1, 'src/a.js'), edit(2, '/abs/b.js'), t, res(4, t, 'ok 12 passed'), said(5, 'All green.')]);
assert.deepStrictEqual([...r.files].sort(), ['/abs/b.js', '/x/app/src/a.js']);
assert.strictEqual(r.check.ok, true); assert.strictEqual(r.stale, false); assert.strictEqual(r.check.cmd, 'npm test');
assert.strictEqual(r.add, 4); assert.strictEqual(r.del, 2); assert.strictEqual(r.truncated, false);
// (b) Exit code 1
t = bash(3, 'cargo test');
r = classify([prompt(0), edit(1, 'x.rs'), t, res(4, t, 'Exit code 1\nfailures: 2', true), said(5, 'One fails.')]);
assert.strictEqual(r.check.ok, false); assert.strictEqual(r.check.exit, 1);
// (c) pass, then an edit
t = bash(2, 'pnpm run test');
r = classify([prompt(0), edit(1, 'a.ts'), t, res(3, t, 'passed'), edit(4, 'a.ts'), said(5, 'Tweaked.')]);
assert.strictEqual(r.check.ok, true); assert.strictEqual(r.stale, true);
// (d) edits, no check
r = classify([prompt(0), edit(1, 'a.ts'), said(2, 'Done.')]);
assert.strictEqual(r.check, undefined); assert.strictEqual(r.files.size, 1);
// (e) a check with no result in the tail
r = classify([prompt(0), edit(1, 'a.ts'), bash(2, 'go test ./...')]);
assert.strictEqual(r.check.ok, undefined); assert.strictEqual(r.stale, false);
// (f) CHECK_RE is runner-specific
assert(!A.CHECK_RE.test('rm -rf build && mkdir build'));
assert(A.CHECK_RE.test('cd x && pnpm run test'));
for (const c of ['npm run build', 'yarn lint', 'bun test', 'npx tsc --noEmit', 'tsc -p .', 'pytest -q', 'go vet ./...', 'xcodebuild -scheme X build', 'swift test', 'make check', 'node --test test/', 'FOO=1 npm test'])
  assert(A.CHECK_RE.test(c), c);
for (const c of ['echo build', 'git commit -m "test"', 'ls test', 'npm install', 'cat build.log', 'grep -r test .'])
  assert(!A.CHECK_RE.test(c), c);
t = bash(2, 'cd /x/app && pnpm run test -- --watch=false');
r = classify([prompt(0), t, res(3, t, 'ok')]);
assert.strictEqual(r.check.cmd, 'pnpm run test -- --watch'); assert.strictEqual(r.check.full, 'cd /x/app && pnpm run test -- --watch=false');
// (g) records before turnAt are ignored
t = bash(1, 'npm test');
r = classify([prompt(0), edit(0.5, 'old.js'), t, res(1.5, t, 'Exit code 2', true), said(2, 'hm?'), prompt(10), edit(11, 'new.js'), said(12, 'Done.')]);
assert.deepStrictEqual([...r.files], ['/x/app/new.js']); assert.strictEqual(r.check, undefined);
// (h) the tail starts after turnAt: truncated
r = A.receipt(lines([edit(5, 'a.js'), said(6, 'Done.')]), at(0));
assert.strictEqual(r.truncated, true);
assert.strictEqual(A.receipt(lines([said(1, 'hi')]), at(0)), undefined);
// sidechain records are skipped unless side; a rejected edit touches nothing
r = A.receipt(lines([prompt(0), edit(1, 'side.js', true), edit(2, 'main.js')]), at(0));
assert.deepStrictEqual([...r.files], ['/x/app/main.js']);
const rej = edit(3, 'no.js');
r = A.receipt(lines([prompt(0), edit(1, 'yes.js'), rej, res(4, rej, "The user doesn't want to proceed", true)]), at(0));
assert.deepStrictEqual([...r.files], ['/x/app/yes.js']);

// (i) a child with a 3-file edit + cargo test folds into the parent receipt; unchanged stats → 0 extra reads
const f = path.join(proj, 'parent.jsonl');
const agentCall = use(2, 'Agent', { description: 'fix crate' });
write(f, [prompt(0), edit(1, 'README.md'), agentCall]);
const kf = path.join(proj, 'parent', 'subagents', 'agent-k1.jsonl'), ct = bash(8, 'cargo test', true);
write(kf, [{ type: 'user', isSidechain: true, timestamp: iso(at(3)), message: { role: 'user', content: 'fix it' } },
  edit(4, 'src/a.rs', true), edit(5, 'src/b.rs', true), edit(6, 'src/c.rs', true), ct, res(9, ct, 'test result: ok', false, true), said(10, 'Fixed.', true)]);
fs.writeFileSync(kf.slice(0, -6) + '.meta.json', JSON.stringify({ description: 'fix crate' }));
const sessions = new Map();
let out = A.scan(root, sessions);
const s = out.find(x => x.id === 'parent');
assert.strictEqual(s.receipt.files.size, 4); assert.strictEqual(s.receipt.check.cmd, 'cargo test'); assert.strictEqual(s.receipt.check.ok, true); assert.strictEqual(s.receipt.stale, false);
const opens = []; const o = fs.openSync;
fs.openSync = (p, ...a) => { opens.push(p); return o(p, ...a); };
A.scan(root, sessions);
fs.openSync = o;
assert(!opens.includes(kf), 'child re-read on unchanged stats');
assert.strictEqual(opens.filter(p => p === f).length, 1, 'parent read once per scan (as before receipts)');

// (j) a masked exit code never reads green on red output; a red test outranks a later green lint; a rerun of the same command supersedes
const chk = (...recs) => A.receipt(lines([prompt(0), edit(1, 'a.js'), ...recs]), at(0)).check;
t = bash(2, 'npm test 2>&1 | tail -5');
assert.strictEqual(chk(t, res(3, t, 'Tests: 3 failed, 10 passed')).ok, false);
t = bash(2, 'npm test 2>&1 | tail -5');
assert.strictEqual(chk(t, res(3, t, 'Tests: 13 passed')).ok, true);
t = bash(2, 'npx tsc --noEmit | head');
assert.strictEqual(chk(t, res(3, t, '')).ok, undefined);
t = bash(2, 'cargo test || true');
assert.strictEqual(chk(t, res(3, t, 'test result: FAILED. 1 passed; 1 failed')).ok, false);
let t2; t = bash(2, 'npm test'); t2 = bash(4, 'npm run lint');
assert.strictEqual(chk(t, res(3, t, 'Exit code 1', true), t2, res(5, t2, 'clean')).cmd, 'npm test');
t = bash(2, 'npm test'); t2 = bash(4, 'npm test');
assert.strictEqual(chk(t, res(3, t, 'Exit code 1', true), t2, res(5, t2, 'ok')).ok, true);

fs.rmSync(root, { recursive: true, force: true });
console.log('receipt: a–j ok, cache ok');
