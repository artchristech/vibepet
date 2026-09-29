// node test/goal.test.js — goal terms, intent filter, drift verdicts, commit matching.
const assert = require('assert');
const { goalTerms, intentful, judge, commitMatches, evidence } = require('../goal');

assert(!intentful('cd vibepet')); assert(!intentful('commit it, and then run it')); assert(!intentful('yes'));
assert(intentful('image the pet is how you switch sessions and projects'));
assert.deepStrictEqual(goalTerms('Fix the flaky auth tests'), ['flaky', 'auth', 'test']);

const on = Array(10).fill('src/auth/login.ts').concat(Array(4).fill('npm test'));
assert.strictEqual(judge('ship the auth login flow', on).state, 'on');
const off = Array(12).fill('renderer/style.css tweak colors').concat(Array(6).fill('src/auth/login.ts'));
assert.strictEqual(judge('ship the auth login flow', off).state, 'drift');
assert.strictEqual(judge('ship the auth login flow', off.slice(0, 12)).state, 'unknown');   // never matched: not confident it's drift
assert.strictEqual(judge('fix it', on).state, 'unknown');                                    // too vague to judge
assert.strictEqual(judge('ship the auth login flow', on.slice(0, 4)).state, 'unknown');      // too little evidence

assert(commitMatches('Goal line per session with auto guess', 'Goal line per session (auto from first prompt)'));
assert(!commitMatches('ship the auth login flow', 'Tweak roster colors'));

const rec = (tools, side) => JSON.stringify({ type: 'assistant', isSidechain: side, message: { content: tools.map(input => ({ type: 'tool_use', name: 'X', input })) } });
const ev = evidence([rec([{ file_path: '/a/goal.js' }, { command: 'npm test', description: 'run tests' }]), rec([{ file_path: '/side' }], true)]);
assert.deepStrictEqual(ev, ['run tests npm test', '/a/goal.js']);
console.log('goal ok');
