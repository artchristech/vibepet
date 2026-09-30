// node test/theater.test.js — theater/model.js: session jsonl → Timeline (beats, chapters, lanes, stats). Synthetic fixtures only.
const assert = require('assert');
const { build, diff, parseGit, GAP, MIN } = require('../theater/model');

const T0 = Date.parse('2026-01-01T10:00:00Z'), iso = s => new Date(T0 + s * 1000).toISOString();
let seq = 0;
const cwd = '/x/app';
const prompt = (s, text) => ({ type: 'user', cwd, timestamp: iso(s), message: { role: 'user', content: text } });
const use = (s, name, input, side) => ({ type: 'assistant', cwd, timestamp: iso(s), ...(side ? { isSidechain: true } : {}),
  message: { content: [{ type: 'tool_use', id: 'tu' + (++seq), name, input }] } });
const res = (s, rec, content, is_error, side) => ({ type: 'user', cwd, timestamp: iso(s), ...(side ? { isSidechain: true } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: rec.message.content[0].id, content, ...(is_error ? { is_error: true } : {}) }] } });
const said = (s, text) => ({ type: 'assistant', cwd, timestamp: iso(s), message: { content: [{ type: 'text', text }] } });
const think = (s, thinking) => ({ type: 'assistant', cwd, timestamp: iso(s), message: { content: [{ type: 'thinking', thinking }] } });
const L = recs => recs.map(r => JSON.stringify(r));

// ---- diff
let d = diff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nD\ne\nf\ng\nh');
assert.ok(d.some(h => h.op === '-' && h.s === 'd') && d.some(h => h.op === '+' && h.s === 'D'));
assert.ok(!d.some(h => h.s === 'a'), 'context trimmed to 2 lines');
d = diff(null, 'x\ny');
assert.deepStrictEqual(d, [{ op: '+', s: 'x' }, { op: '+', s: 'y' }]);
assert.ok(diff('', Array(300).fill('l').join('\n')).pop().op === '…', 'huge writes cap');

// ---- a two-prompt session: read, edit, failing test, fix, passing test, subagent, secret, idle gap
const rd = use(2, 'Read', { file_path: '/x/app/src/a.js' });
const ed = use(4, 'Edit', { file_path: '/x/app/src/a.js', old_string: 'let x = 1', new_string: 'let x = 2\nlet y = 3' });
const t1 = use(6, 'Bash', { command: 'npm test 2>&1 | tail -5', description: 'Run tests' });
const t2 = use(9, 'Bash', { command: 'npm test' });
const sh = use(11, 'Bash', { command: 'echo hi', description: 'Say hi' });
const ag = use(3700, 'Agent', { description: 'Audit styles', prompt: 'look at css', subagent_type: 'Explore' });
const wr = use(3705, 'Write', { file_path: '/x/app/.env', content: 'API_KEY=sk-live-abcdefghijklmnop1234567890ABCDEFGH' });
const lines = L([
  prompt(0, 'fix the counter'), think(1, 'Need to look at a.js first.'), rd, res(2.5, rd, 'let x = 1'),
  ed, res(4.5, ed, 'ok'), t1, res(7, t1, '1 failed, 3 passed'), t2, res(10, t2, '4 passed'), sh, res(11.2, sh, 'hi'),
  said(12, 'Fixed. **All green.**'),
  prompt(3600, 'now audit css'),   // an hour later: collapses
  ag, wr, res(3706, wr, 'written'),
  { type: 'user', cwd, timestamp: iso(3601), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'nope', content: 'x' }] } },
  { type: 'user', isMeta: true, cwd, timestamp: iso(3602), message: { content: 'meta noise' } },
]);
const sub = { meta: { toolUseId: ag.message.content[0].id, description: 'Audit styles', agentType: 'Explore' },
  lines: L([use(3701, 'Grep', { pattern: 'color' }, true), res(3702, { message: { content: [{ id: 'tu' + seq }] } }, 'a.css:1', false, true)]) };
const tl = build(lines, { subagents: [sub], commits: parseGit('abcdef1234567\t' + (T0 / 1000 + 20) + '\tfix: counter\nnot a line') });

const kinds = tl.beats.map(b => b.kind);
assert.deepStrictEqual(tl.chapters.map(c => c.title), ['fix the counter', 'now audit css']);
assert.ok(kinds.includes('thinking') && kinds.includes('read') && kinds.includes('reply') && kinds.includes('commit'));
const checks = tl.beats.filter(b => b.kind === 'check');
assert.deepStrictEqual(checks.map(b => b.ok), [false, true], 'piped red read from output, then green');
assert.strictEqual(tl.beats.find(b => b.title === 'Say hi').kind, 'command');
const e = tl.beats.find(b => b.kind === 'edit');
assert.deepStrictEqual(e.files, ['src/a.js']); assert.strictEqual(e.add, 2); assert.strictEqual(e.del, 1); assert.strictEqual(e.ok, true);
// secrets never survive
assert.ok(!JSON.stringify(tl).includes('sk-live-abcdefghijklmnop'), 'redacted');
// subagent forks off the Agent beat onto lane 1
const a = tl.beats.find(b => b.kind === 'agent');
assert.strictEqual(a.branch, 1); assert.strictEqual(tl.lanes[0].title, 'Audit styles');
assert.ok(tl.beats.some(b => b.lane === 1 && b.kind === 'read'));
// idle hour collapsed: whole replay is short; every step ≥ MIN, ≤ GAP
const vs = tl.beats.map(b => b.v);
for (let k = 1; k < vs.length; k++) { const g = vs[k] - vs[k - 1]; assert.ok(g >= MIN && g <= GAP, 'gap ' + g); }
assert.ok(tl.meta.dur < 60e3);
assert.strictEqual(tl.stats.prompts, 2); assert.strictEqual(tl.stats.passed, 1); assert.strictEqual(tl.stats.failed, 1);
assert.strictEqual(tl.stats.commits, 1); assert.strictEqual(tl.stats.agents, 1);
assert.ok(tl.beats.every(b => b.ch >= 0 && b.ch < tl.chapters.length));
// garbage in → empty timeline, no throw
assert.strictEqual(build(['{bad', '', '{}']).beats.length, 0);
console.log('theater: ok', tl.stats);
