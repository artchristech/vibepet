// node test/fanout.test.js — subagent fan-out: fanout()/settle() fixtures, the child cache, and scan() with a silent parent.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const A = require('../agents');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibepet-fanout-')), proj = path.join(root, '-x-app');
fs.mkdirSync(proj);
const iso = ago => new Date(Date.now() - ago).toISOString();
const write = (f, recs, ageMs) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, recs.map(r => JSON.stringify(r)).join('\n') + '\n');
  const t = (Date.now() - ageMs) / 1000; fs.utimesSync(f, t, t);
};
const prompt = ago => ({ type: 'user', cwd: '/x/app', timestamp: iso(ago), message: { role: 'user', content: 'fan out please' } });
const said = text => ({ type: 'assistant', cwd: '/x/app', message: { stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
const agentCall = { type: 'assistant', cwd: '/x/app', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Agent', input: { description: 'scan repo' } }] } };
const side = r => ({ ...r, isSidechain: true });
let n = 0;
function session(parentRecs, parentAge, kids = []) {   // kids: [{ done, age, depth, parent }]
  const id = 'sess-' + (++n), f = path.join(proj, id + '.jsonl');
  write(f, parentRecs, parentAge);
  kids.forEach((k, i) => {
    const kf = path.join(proj, id, 'subagents', `agent-a${i}.jsonl`);
    const last = k.done ? said('Found 3 call sites.') : { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'rg foo' } }] } };
    write(kf, [side({ type: 'user', message: { role: 'user', content: 'look for foo' } }), side(last)], k.age ?? 0);
    fs.writeFileSync(kf.slice(0, -6) + '.meta.json', JSON.stringify({ description: `child ${i}`, toolUseId: 't' + i, spawnDepth: k.depth ?? 1, ...(k.parent ? { parentAgentId: k.parent } : {}) }));
  });
  return f;
}
const run = f => { const st = fs.statSync(f), c = A.classify(f, st.mtimeMs), fo = A.fanout(f, c.turnAt); return { raw: c.phase, phase: A.settle(c, fo), fo }; };
const tf = fo => fo && [fo.total, fo.done];

// (a) pending Agent call 5 min old + an open child written now → working, {1,0}
const a = run(session([prompt(6 * 60e3), agentCall], 5 * 60e3, [{}]));
assert.deepStrictEqual([a.raw, a.phase, tf(a.fo)], ['stalled', 'working', [1, 0]]);
// (b) no subagents dir → stalled
const b = run(session([prompt(6 * 60e3), agentCall], 5 * 60e3));
assert.deepStrictEqual([b.phase, b.fo], ['stalled', null]);
// (c) parent end_turn with an open child → working;  (d) the child ended → ready
const c = run(session([prompt(60e3), agentCall, said('Launched it in the background.')], 1000, [{}]));
assert.deepStrictEqual([c.raw, c.phase], ['ready', 'working']);
const d = run(session([prompt(60e3), agentCall, said('Launched it in the background.')], 1000, [{ done: true }]));
assert.deepStrictEqual([d.phase, tf(d.fo)], ['ready', [1, 1]]);
// (e) five children, three done → {5,3}; grandchildren (parentAgentId) don't count
const e = run(session([prompt(60e3), agentCall], 1000, [{ done: true }, { done: true }, { done: true }, {}, {}, { depth: 2, parent: 'a0' }]));
assert.deepStrictEqual([tf(e.fo), e.fo.open, e.fo.items.length], [[5, 3], 2, 5]);
// (f) parent question with an open child → waiting
const f = run(session([prompt(60e3), said('Should I also cover the CLI?')], 1000, [{}]));
assert.strictEqual(f.phase, 'waiting');
// (g) children older than turnAt are excluded
const g = run(session([prompt(2 * 60e3), said('Done.')], 1000, [{ done: true, age: 10 * 60e3 }, { age: 5 * 60e3 }]));
assert.deepStrictEqual([g.phase, tf(g.fo)], ['ready', [0, 0]]);
// a parent stuck on a Bash approval stays stuck even with background children running
const bash = { type: 'assistant', cwd: '/x/app', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'rm -rf build' } }] } };
assert.strictEqual(run(session([prompt(6 * 60e3), bash], 5 * 60e3, [{}])).phase, 'stalled');
// a child silent 2 min on its own Bash call (an approval in the parent's terminal) keeps the parent stuck, on the child's ask
const stuckKid = session([prompt(6 * 60e3), agentCall], 5 * 60e3, [{ age: 2 * 60e3 }, {}]);
const sk = run(stuckKid);
assert.deepStrictEqual([sk.phase, sk.fo.open, sk.fo.stuck, sk.fo.stuckAsk], ['stalled', 2, 1, 'Bash: rg foo']);
assert.strictEqual(A.scan(root, new Map()).find(s => s.file === stuckKid).ask, 'Bash: rg foo');
// a child thinking 3 min after a tool result is still running, not done
const thinkF = session([prompt(6 * 60e3), agentCall], 5 * 60e3), tk = path.join(proj, path.basename(thinkF, '.jsonl'), 'subagents', 'agent-t.jsonl');
write(tk, [side({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } })], 3 * 60e3);
assert.deepStrictEqual([run(thinkF).phase, run(thinkF).fo.open], ['working', 1]);
console.log('fixtures a–g ok');

// 3. unchanged stats → 0 child reads
const ef = path.join(proj, 'sess-5.jsonl'), turnAt = A.classify(ef, fs.statSync(ef).mtimeMs).turnAt;
const open0 = fs.openSync; let reads = 0;
fs.openSync = (p, ...r) => { if (String(p).includes(path.sep + 'subagents' + path.sep)) reads++; return open0(p, ...r); };
A.fanout(ef, turnAt); const warm = reads; A.fanout(ef, turnAt);
fs.openSync = open0;
assert.strictEqual(reads - warm, 0);
console.log('cache ok: second fanout read', reads - warm, 'children');

// 4. parent silent 50 min, child wrote 1 min ago → still in scan()
const quiet = session([prompt(55 * 60e3), agentCall], 50 * 60e3, [{ age: 60e3 }]), qid = path.basename(quiet, '.jsonl');
const seen = A.scan(root, new Map(), () => {});
const q = seen.find(s => s.id === qid);
assert(q && q.phase === 'working' && q.fanout.open === 1, JSON.stringify(q));
console.log('scan ok:', seen.length, 'live; silent parent', q.phase, q.fanout.total + '/' + q.fanout.open);
fs.rmSync(root, { recursive: true, force: true });
